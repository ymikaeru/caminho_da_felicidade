// ============================================================
// sync-teaching-topic — webhook handler para storage.objects
// ============================================================
// Recebe payload de Database Webhook do Supabase quando objetos
// no bucket `teachings` são INSERIDOS/ATUALIZADOS/DELETADOS.
// Atualiza a tabela `teachings_topics` para refletir a mudança.
//
// Configuração no painel:
//   Database → Webhooks → Create
//     - Table: storage.objects
//     - Events: INSERT, UPDATE, DELETE
//     - HTTP Request → POST → URL desta função
//     - HTTP Headers → Authorization: Bearer <SYNC_WEBHOOK_SECRET>
//
// Variáveis de ambiente esperadas (supabase secrets set ...):
//   SUPABASE_URL                  (auto)
//   SUPABASE_SERVICE_ROLE_KEY     (auto)
//   SYNC_WEBHOOK_SECRET           (definir manualmente, mesmo valor do header acima)
// ============================================================

import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { extractTopicsFromJson } from '../_shared/topic_normalize.mjs';

const PATH_RE = /^(mioshiec[1-9])\/(.+)\.json$/;
const BUCKET = 'teachings';
const BATCH_SIZE = 100;

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: {
    bucket_id?: string;
    name?: string;
    updated_at?: string;
  } | null;
  old_record: {
    bucket_id?: string;
    name?: string;
  } | null;
};

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Auth: shared secret via Authorization header.
  const expected = Deno.env.get('SYNC_WEBHOOK_SECRET');
  if (!expected) {
    return new Response('Server misconfigured (SYNC_WEBHOOK_SECRET unset)', { status: 500 });
  }
  const auth = req.headers.get('Authorization') || '';
  const got = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (got !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  // Garante que é um evento da tabela storage.objects.
  if (payload.schema !== 'storage' || payload.table !== 'objects') {
    return new Response('Ignored (not storage.objects)', { status: 200 });
  }

  const isDelete = payload.type === 'DELETE';
  const rec = isDelete ? payload.old_record : payload.record;
  if (!rec || rec.bucket_id !== BUCKET || !rec.name) {
    return new Response('Ignored (bucket/path mismatch)', { status: 200 });
  }

  const m = rec.name.match(PATH_RE);
  if (!m) {
    return new Response('Ignored (path does not match mioshiecN/*.json)', { status: 200 });
  }
  const vol = m[1];
  const fileKey = m[2];

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    if (isDelete) {
      const { error } = await supabase
        .from('teachings_topics')
        .delete()
        .eq('vol', vol)
        .eq('file', fileKey);
      if (error) throw new Error(`delete: ${error.message}`);
      return new Response(JSON.stringify({ ok: true, action: 'deleted', vol, file: fileKey }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // INSERT/UPDATE: baixa, normaliza, upsert + trim.
    const { data: blob, error: dlErr } = await supabase
      .storage
      .from(BUCKET)
      .download(`${vol}/${fileKey}.json`);
    if (dlErr) throw new Error(`download: ${dlErr.message}`);

    let json: unknown;
    try {
      json = JSON.parse(await blob.text());
    } catch (e) {
      throw new Error(`parse: ${(e as Error).message}`);
    }

    const { rows } = extractTopicsFromJson({ vol, file: fileKey, json });
    const sourceTs = rec.updated_at || null;
    const enriched = rows.map((r: any) => ({ ...r, source_updated_at: sourceTs }));

    // Upsert primeiro (sem gap): atualiza topics existentes e insere novos.
    for (let i = 0; i < enriched.length; i += BATCH_SIZE) {
      const { error } = await supabase
        .from('teachings_topics')
        .upsert(enriched.slice(i, i + BATCH_SIZE), { onConflict: 'vol,file,topic_idx' });
      if (error) throw new Error(`upsert: ${error.message}`);
    }

    // Trim: apaga rows com topic_idx fora do conjunto novo
    // (caso o arquivo tenha perdido topics).
    const maxIdx = enriched.length === 0 ? -1 : Math.max(...enriched.map((r: any) => r.topic_idx));
    const { error: trimErr } = await supabase
      .from('teachings_topics')
      .delete()
      .eq('vol', vol)
      .eq('file', fileKey)
      .gt('topic_idx', maxIdx);
    if (trimErr) throw new Error(`trim: ${trimErr.message}`);

    return new Response(
      JSON.stringify({ ok: true, action: payload.type.toLowerCase(), vol, file: fileKey, rows: enriched.length }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    console.error(`[sync-teaching-topic] ${vol}/${fileKey}:`, err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message, vol, file: fileKey }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
});
