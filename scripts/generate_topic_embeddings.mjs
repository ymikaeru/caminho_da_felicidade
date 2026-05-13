#!/usr/bin/env node
// ============================================================
// Embedding generator — popula teachings_topics.embedding via Voyage AI.
// ============================================================
//
// Uso:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   VOYAGE_API_KEY=pa-... \
//   node scripts/generate_topic_embeddings.mjs
//
// Flags opcionais:
//   --vols=mioshiec1,mioshiec3   só estes volumes
//   --force                      reembedda mesmo rows que já têm embedding
//   --dry-run                    não escreve no banco
//   --batch=128                  tamanho do batch enviado pra Voyage (max 128)
//
// Custo: ~$0.50 setup único (17k topics × ~800 tokens médios × $0.06/1M).
// Voyage free tier: 200M tokens/mês — sobra muito.
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !VOYAGE_API_KEY) {
  console.error('Faltam env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const onlyVols = args.vols ? String(args.vols).split(',').map((s) => s.trim()).filter(Boolean) : null;
const force = !!args.force;
const dryRun = !!args['dry-run'];
const BATCH = Math.min(Math.max(parseInt(args.batch ?? '128', 10), 1), 128);

const VOYAGE_MODEL = 'voyage-3';
const VOYAGE_DIM = 1024;
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Voyage tem limite de 120k tokens por request (~32k por doc). Mantemos
// docs em ~6000 chars (~1500 tokens PT, mais em JA): seguro pro corpus
// e cabe 80+ docs por request mesmo no pior caso.
const MAX_CHARS_PER_DOC = 6000;

function buildInput(row) {
  const parts = [
    row.title_pt,
    row.nav_title_pt,
    row.section_pt,
    row.content_pt,
    row.title_ja,
    row.nav_title_ja,
    row.section_ja,
    row.content_ja,
  ].filter(Boolean);
  let text = parts.join('\n\n');
  if (text.length > MAX_CHARS_PER_DOC) text = text.slice(0, MAX_CHARS_PER_DOC);
  return text;
}

async function embedBatch(texts, attempt = 0) {
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: 'document',
    }),
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`Voyage ${res.status} após 5 tentativas`);
    const wait = Math.min(60_000, 2 ** attempt * 1000 + Math.random() * 500);
    console.warn(`Voyage ${res.status}, retry em ${Math.round(wait)}ms (tentativa ${attempt + 1}/5)`);
    await new Promise((r) => setTimeout(r, wait));
    return embedBatch(texts, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage ${res.status}: ${body}`);
  }
  const json = await res.json();
  if (!Array.isArray(json.data) || json.data.length !== texts.length) {
    throw new Error(`Voyage shape inesperado: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.data.map((d) => d.embedding);
}

async function fetchPending() {
  // Pula rows sem nenhum conteúdo textual (content_pt vazio + content_ja vazio).
  let query = supabase
    .from('teachings_topics')
    .select('vol,file,topic_idx,title_pt,nav_title_pt,section_pt,content_pt,title_ja,nav_title_ja,section_ja,content_ja,embedding')
    .order('vol', { ascending: true })
    .order('file', { ascending: true })
    .order('topic_idx', { ascending: true });
  if (onlyVols && onlyVols.length) query = query.in('vol', onlyVols);
  if (!force) query = query.is('embedding', null);

  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(`select: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function updateEmbeddings(rows) {
  // Atualizações paralelas com concorrência limitada. Versão sequencial
  // ficava em ~1.5 rows/s (gargalo de RTT no PostgREST), o batch inteiro
  // demorava ~85s. Em paralelo com 16 em vôo, sobe pra ~30-50 rows/s.
  // Não usamos upsert porque embedding é update, não insert — keep as-is.
  const nowIso = new Date().toISOString();
  const toDo = rows.filter((r) => r._embedding);
  const CONC = 16;
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= toDo.length) return;
      const r = toDo[i];
      const { error } = await supabase
        .from('teachings_topics')
        .update({ embedding: r._embedding, embedding_updated_at: nowIso })
        .eq('vol', r.vol)
        .eq('file', r.file)
        .eq('topic_idx', r.topic_idx);
      if (error) throw new Error(`update ${r.vol}/${r.file}#${r.topic_idx}: ${error.message}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
}

(async () => {
  const t0 = Date.now();
  console.log(`Voyage ${VOYAGE_MODEL} (dim=${VOYAGE_DIM}), batch=${BATCH}${dryRun ? ', DRY RUN' : ''}${force ? ', FORCE' : ''}`);

  const pending = await fetchPending();
  // Filtra rows sem conteúdo embedável.
  const work = pending.filter((r) => buildInput(r).length > 0);
  const skipped = pending.length - work.length;
  console.log(`Total a embeddar: ${work.length} (${skipped} pulados por conteúdo vazio)`);

  if (work.length === 0) {
    console.log('Nada a fazer.');
    return;
  }

  let done = 0;
  let tokensIn = 0;
  for (let i = 0; i < work.length; i += BATCH) {
    const slice = work.slice(i, i + BATCH);
    const texts = slice.map(buildInput);
    const embeddings = await embedBatch(texts);
    embeddings.forEach((e, j) => { slice[j]._embedding = e; });
    if (!dryRun) await updateEmbeddings(slice);
    done += slice.length;
    tokensIn += texts.reduce((a, t) => a + Math.ceil(t.length / 4), 0); // proxy
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const rate = (done / Math.max(0.1, (Date.now() - t0) / 1000)).toFixed(1);
    console.log(`[${done}/${work.length}] elapsed=${elapsed}s rate=${rate}/s tokens~${tokensIn}`);
  }

  console.log(`Feito em ${((Date.now() - t0) / 1000).toFixed(1)}s. Tokens ~${tokensIn} (proxy). Custo aprox: $${(tokensIn / 1_000_000 * 0.06).toFixed(4)}.`);
})().catch((err) => {
  console.error('Erro:', err);
  process.exit(1);
});
