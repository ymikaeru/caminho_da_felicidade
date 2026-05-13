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

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-3';
const VOYAGE_MAX_CHARS = 6000;

function buildEmbedInput(r: any): string {
  const parts = [
    r.title_pt, r.nav_title_pt, r.section_pt, r.content_pt,
    r.title_ja, r.nav_title_ja, r.section_ja, r.content_ja,
  ].filter(Boolean);
  let text = parts.join('\n\n');
  if (text.length > VOYAGE_MAX_CHARS) text = text.slice(0, VOYAGE_MAX_CHARS);
  return text;
}

// Reembedda os topics tocados nesse webhook. Falhas são log-only — não
// quebram o sync de FTS. Embedding fica stale até o próximo reconcile
// ou re-trigger manual.
async function reembedRows(supabase: any, vol: string, fileKey: string): Promise<{ ok: boolean; n: number; reason?: string }> {
  const key = Deno.env.get('VOYAGE_API_KEY');
  if (!key) return { ok: false, n: 0, reason: 'no_key' };

  const { data: rows, error } = await supabase
    .from('teachings_topics')
    .select('vol,file,topic_idx,title_pt,nav_title_pt,section_pt,content_pt,title_ja,nav_title_ja,section_ja,content_ja')
    .eq('vol', vol)
    .eq('file', fileKey);
  if (error) return { ok: false, n: 0, reason: `select: ${error.message}` };
  if (!rows || rows.length === 0) return { ok: true, n: 0 };

  const inputs = rows.map(buildEmbedInput);
  const valid = rows.map((_r: any, i: number) => inputs[i].length > 0);
  const toSend = inputs.filter((_t: string, i: number) => valid[i]);
  if (toSend.length === 0) return { ok: true, n: 0 };

  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: toSend, model: VOYAGE_MODEL, input_type: 'document' }),
  });
  if (!res.ok) {
    return { ok: false, n: 0, reason: `voyage_${res.status}` };
  }
  const json = await res.json();
  const embeds: number[][] = (json?.data || []).map((d: any) => d.embedding);
  if (embeds.length !== toSend.length) return { ok: false, n: 0, reason: 'voyage_shape' };

  const nowIso = new Date().toISOString();
  let cursor = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!valid[i]) continue;
    const emb = embeds[cursor++];
    const { error: uerr } = await supabase
      .from('teachings_topics')
      .update({ embedding: emb, embedding_updated_at: nowIso })
      .eq('vol', rows[i].vol)
      .eq('file', rows[i].file)
      .eq('topic_idx', rows[i].topic_idx);
    if (uerr) return { ok: false, n: cursor - 1, reason: `update: ${uerr.message}` };
  }
  return { ok: true, n: toSend.length };
}

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

    // Nota: nav_title_pt/ja e section_pt/ja são gravados apenas pelo seeder
    // (seed_teachings_topics.mjs) a partir de site_data/section_map.js.
    // O upsert daqui NÃO inclui essas colunas, então o ON CONFLICT preserva
    // os valores existentes em updates. Em INSERTs novos (arquivo criado via
    // Storage sem passar pelo seeder), ficam NULL até a próxima rodada do
    // seeder — aceitável dado que a navegação canônica também não conhece
    // arquivos não-curados ainda.

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

    // Re-embedda os topics afetados. Falha aqui não derruba o sync FTS —
    // o RPC híbrido degrada gracioso pra FTS-only enquanto embeddings
    // ficam stale. Reconcile noturno pode pegar o que faltou.
    const embedResult = await reembedRows(supabase, vol, fileKey).catch((err) => ({
      ok: false, n: 0, reason: (err as Error).message,
    }));
    if (!embedResult.ok && embedResult.reason !== 'no_key') {
      console.warn(`[sync-teaching-topic] embedding falhou ${vol}/${fileKey}: ${embedResult.reason}`);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        action: payload.type.toLowerCase(),
        vol,
        file: fileKey,
        rows: enriched.length,
        embedded: embedResult.n,
      }),
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
