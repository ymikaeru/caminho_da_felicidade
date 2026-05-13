// ============================================================
// search-semantic — Edge Function de busca híbrida + rerank.
// ============================================================
// Fluxo por request:
//   1. Recebe { q, lang, scope, max_results } do cliente autenticado.
//   2. Embedda a query via Voyage (input_type=query, model=voyage-3).
//   3. Chama RPC search_teachings_hybrid → top N candidatos via RRF
//      (FTS + cosine). Inclui content_excerpt em cada candidato.
//   4. Manda os candidatos pro Voyage rerank-2.5-lite, que lê
//      query + conteúdo de cada um e devolve scores reais de relevância.
//   5. Reordena pelos scores do reranker, remove content_excerpt do
//      payload, devolve no shape esperado pelo frontend.
//
// Fallbacks:
//   - Voyage embed falha → q_embedding=null, RPC vira FTS puro.
//   - Voyage rerank falha → mantém ordem do RRF (semântico ainda ativo,
//     só não tem a re-pontuação final).
//   - Sempre 200 se a RPC respondeu.
//
// Vars de ambiente (supabase secrets set ...):
//   SUPABASE_URL, SUPABASE_ANON_KEY              (auto)
//   VOYAGE_API_KEY                               (definir manualmente)
// ============================================================

import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VOYAGE_EMBED_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_RERANK_URL = 'https://api.voyageai.com/v1/rerank';
const VOYAGE_EMBED_MODEL = 'voyage-3';
const VOYAGE_RERANK_MODEL = 'rerank-2.5';
const VOYAGE_TIMEOUT_MS = 4000;
const RERANK_INPUT_CAP = 50; // máx docs por chamada de rerank

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
    const res = await fetch(VOYAGE_EMBED_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: [q], model: VOYAGE_EMBED_MODEL, input_type: 'query' }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`Voyage embed ${res.status}: ${await res.text().catch(() => '')}`);
      return null;
    }
    const json = await res.json();
    const v = json?.data?.[0]?.embedding;
    return Array.isArray(v) ? v : null;
  } catch (err) {
    console.warn('Voyage embed fetch falhou:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Voyage rerank: recebe query + N documentos, devolve relevance_score por
// doc. Documento = title + excerpt (concatenados). Resultado é um array de
// objetos { index, relevance_score, document } — usamos `index` pra mapear
// de volta no array original de candidatos.
type RerankResult = { index: number; relevance_score: number };

async function rerankCandidates(
  q: string,
  docs: string[],
): Promise<RerankResult[] | null> {
  const key = Deno.env.get('VOYAGE_API_KEY');
  if (!key || docs.length === 0) return null;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), VOYAGE_TIMEOUT_MS);
  try {
    const res = await fetch(VOYAGE_RERANK_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q,
        documents: docs,
        model: VOYAGE_RERANK_MODEL,
        // top_k não setado → reranker devolve todos, a ordem é o sinal.
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`Voyage rerank ${res.status}: ${await res.text().catch(() => '')}`);
      return null;
    }
    const json = await res.json();
    const arr = json?.data;
    if (!Array.isArray(arr)) return null;
    return arr
      .map((d: any) => ({ index: d.index, relevance_score: d.relevance_score }))
      .filter((d: RerankResult) => Number.isFinite(d.index) && Number.isFinite(d.relevance_score));
  } catch (err) {
    console.warn('Voyage rerank fetch falhou:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Forward JWT do usuário — RPC é security invoker e usa auth.uid() em
  // _user_blocks() pra filtrar permissões.
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'missing auth' }), {
      status: 401, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  let body: { q?: string; lang?: string; scope?: string; max_results?: number };
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'bad json' }), {
      status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const q = (body.q || '').trim();
  const lang = body.lang === 'ja' ? 'ja' : 'pt';
  const scope = ['all', 'title', 'content'].includes(body.scope || '') ? body.scope : 'all';
  const max_results = Math.min(Math.max(parseInt(String(body.max_results ?? 50), 10) || 50, 1), 100);

  if (q.length < 2) {
    return new Response(JSON.stringify({ data: [] }), {
      status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' },
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
  const q_embedding = embedding ? '[' + embedding.join(',') + ']' : null;

  // Heurística: queries de 4+ palavras são conceituais ("como cuidar de
  // alguém doente", "sofrimento após perda"). FTS tende a injetar matches
  // lexicais em contextos tematicamente distantes (tokens "alguém doente"
  // aparecem em teachings sobre gato-monstro, dragão, etc.), que sobrevivem
  // ao rerank pelo overlap textual mesmo sem relevância prática.
  //
  // Quando temos embedding semântico, é mais limpo pular FTS pra essas
  // queries — o candidato pool fica 100% vetorial. Queries curtas (1-3
  // palavras) continuam usando FTS, onde matches lexicais geralmente
  // são doutrinariamente importantes (termos como "Johrei", "Daijo",
  // "Princípio do Johrei").
  const word_count = q.split(/\s+/).filter(Boolean).length;
  const use_fts = !(embedding && word_count >= 4);

  const { data, error } = await supabase.rpc('search_teachings_hybrid', {
    q, q_embedding, lang, max_results, scope, use_fts,
  });

  if (error) {
    console.error('search_teachings_hybrid error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  let results: any[] = Array.isArray(data) ? data : [];
  let reranked = false;

  // Rerank apenas quando tem embedding (caminho semântico ativo) e mais
  // de 1 resultado. Resultados <2 não precisam reordenar.
  if (embedding && results.length > 1) {
    const cap = Math.min(results.length, RERANK_INPUT_CAP);
    const slice = results.slice(0, cap);
    const docs = slice.map((r) => {
      const isJa = lang === 'ja';
      const section = (isJa ? r.section_ja : r.section_pt) || r.section_pt || r.section_ja || '';
      const navTitle = (isJa ? r.nav_title_ja : r.nav_title_pt) || '';
      const title = (isJa ? r.title_ja : r.title_pt) || r.title_pt || r.title_ja || '';
      const excerpt = r.content_excerpt || '';
      // Formato pro reranker: [seção] título doutrinário + excerpt.
      // Seção dá ao reranker contexto temático ("Johrei para animais" vs
      // "Sobre a saúde") que diferencia matches lexicais coincidentes em
      // domínios distantes. nav_title é o rótulo curado quando difere do
      // título doutrinário — incluído se existir, pra dar peso de "isto
      // é como o teaching é navegado no site".
      const header = [section, navTitle && navTitle !== title ? navTitle : null, title]
        .filter(Boolean)
        .join(' — ');
      return `${header}\n\n${excerpt}`.trim();
    });
    const scores = await rerankCandidates(q, docs);
    if (scores && scores.length === slice.length) {
      // Reordena slice pelos scores; mantém a "cauda" (resultados além
      // do cap) na ordem original do RRF, ao final. Anexa rerank_score
      // em cada item — usado pelo cliente pra debug/threshold visual e
      // pra eventual filtro futuro.
      const scoreById = new Map(scores.map((s) => [s.index, s.relevance_score]));
      const ordered = scores
        .slice()
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .map((s) => ({ ...slice[s.index], rerank_score: s.relevance_score }))
        .filter(Boolean);
      results = [...ordered, ...results.slice(cap)];
      reranked = true;
    }
  }

  // Strip content_excerpt antes do response — só era pro reranker, não
  // deve voar pro cliente (response menor, sem duplicação de payload).
  const out = results.map((r) => {
    const { content_excerpt: _drop, ...rest } = r;
    return rest;
  });

  return new Response(
    JSON.stringify({ data: out, semantic: embedding != null, reranked, use_fts }),
    { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } }
  );
});
