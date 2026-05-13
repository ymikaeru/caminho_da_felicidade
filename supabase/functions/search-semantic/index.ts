// ============================================================
// search-semantic — Edge Function que faz busca híbrida (FTS + vetor).
// ============================================================
// Fluxo por request:
//   1. Recebe { q, lang, scope, max_results } do cliente autenticado.
//   2. Embedda a query via Voyage AI (input_type=query, model=voyage-3).
//   3. Chama RPC search_teachings_hybrid passando q + q_embedding.
//   4. Devolve resultados no mesmo shape de search_teachings (drop-in).
//
// Fallback: se Voyage falhar (rate limit, timeout, key inválida), cai
// pra search_teachings_hybrid com q_embedding=null — o RPC degrada
// gracioso pra FTS puro (mesma behavior da busca antiga).
//
// Variáveis de ambiente (supabase secrets set ...):
//   SUPABASE_URL                  (auto)
//   SUPABASE_SERVICE_ROLE_KEY     (auto, usado só pra _user_blocks via JWT do user)
//   SUPABASE_ANON_KEY             (auto)
//   VOYAGE_API_KEY                (definir manualmente)
// ============================================================

import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-3';
const VOYAGE_TIMEOUT_MS = 4000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function embedQuery(q: string): Promise<number[] | null> {
  const key = Deno.env.get('VOYAGE_API_KEY');
  if (!key) {
    console.warn('VOYAGE_API_KEY não configurada — caindo pra FTS-only');
    return null;
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), VOYAGE_TIMEOUT_MS);
  try {
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: [q],
        model: VOYAGE_MODEL,
        input_type: 'query',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`Voyage ${res.status}: ${await res.text().catch(() => '')}`);
      return null;
    }
    const json = await res.json();
    const v = json?.data?.[0]?.embedding;
    return Array.isArray(v) ? v : null;
  } catch (err) {
    console.warn('Voyage fetch falhou:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Forward o JWT do usuário pro supabase-js — RPC roda como security
  // invoker e usa auth.uid() em _user_blocks() pra filtrar permissões.
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'missing auth' }), {
      status: 401,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  let body: { q?: string; lang?: string; scope?: string; max_results?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), {
      status: 400,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const q = (body.q || '').trim();
  const lang = body.lang === 'ja' ? 'ja' : 'pt';
  const scope = ['all', 'title', 'content'].includes(body.scope || '') ? body.scope : 'all';
  const max_results = Math.min(Math.max(parseInt(String(body.max_results ?? 50), 10) || 50, 1), 100);

  if (q.length < 2) {
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );

  const embedding = await embedQuery(q);

  // Serializa o embedding como pgvector literal ('[1.0,2.0,...]'). PostgREST
  // aceita JSON-array em alguns casos, mas a forma string é universalmente
  // aceita e elimina ambiguidade de cast. Null passa direto pro RPC degradar
  // pra FTS-only.
  const q_embedding = embedding ? '[' + embedding.join(',') + ']' : null;

  const { data, error } = await supabase.rpc('search_teachings_hybrid', {
    q,
    q_embedding,
    lang,
    max_results,
    scope,
  });

  if (error) {
    console.error('search_teachings_hybrid error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      data: data || [],
      semantic: embedding != null,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    }
  );
});
