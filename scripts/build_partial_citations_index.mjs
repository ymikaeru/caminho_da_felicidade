#!/usr/bin/env node
// ============================================================
// build_partial_citations_index.mjs — gera data/partial_citations_index.json
// mapeando ensinamentos com "(Citação parcial)" / "（一部のみ引用）" para o
// ensinamento COMPLETO correspondente (mesmo title + mesma date, em outro
// arquivo, sem o marker).
//
// Estrutura do output:
//   {
//     "mioshiec3/hentai2.html#10": {
//       "vol": "mioshiec3",
//       "file": "puraguma.html",
//       "topic_idx": 0,
//       "title_jp": "明主様御教え　「プラグマチズム」",
//       "title_pt": "Ensinamento de Meishu-Sama: \"Pragmatismo\""
//     },
//     ...
//   }
//
// Só inclui matches 1:1 (sem ambiguidade) — opção conservadora.
//
// Uso:
//   node scripts/build_partial_citations_index.mjs
//   node scripts/build_partial_citations_index.mjs --dry-run
// ============================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TEACHINGS_DIR = join(ROOT, '.local-edits', 'teachings');
const OUTPUT_PATH = join(ROOT, 'data', 'partial_citations_index.json');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const DRY_RUN = !!args['dry-run'];

const VOLS = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];
const PARTIAL_RE = /一部のみ引用|Citação parcial/;

// ─── Coleta todos os topics ──────────────────────────────────
const allTopics = [];

for (const vol of VOLS) {
  const dir = join(TEACHINGS_DIR, vol);
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); }
  catch { continue; }
  for (const file of files) {
    let data;
    try { data = JSON.parse(readFileSync(join(dir, file), 'utf8')); }
    catch (e) { console.warn(`[skip] ${vol}/${file}: ${e.message.slice(0, 60)}`); continue; }
    if (!data.themes) continue;
    let globalIdx = 0;
    for (const theme of data.themes) {
      for (const t of theme.topics || []) {
        const isPartial = PARTIAL_RE.test((t.content || '') + (t.content_ptbr || ''));
        allTopics.push({
          vol,
          file: file.replace(/\.json$/, ''),
          topic_idx: globalIdx,
          title_jp: (t.title || '').trim(),
          title_pt: (t.title_ptbr || '').trim(),
          date: (t.date || '').trim(),
          isPartial,
        });
        globalIdx++;
      }
    }
  }
}

const partials = allTopics.filter((t) => t.isPartial);
const fulls = allTopics.filter((t) => !t.isPartial);

console.log(`Total topics: ${allTopics.length}`);
console.log(`Citações parciais: ${partials.length}`);
console.log(`Textos completos potenciais: ${fulls.length}`);

// ─── Indexa fulls por (title + date) ─────────────────────────
const fullIndex = new Map();
for (const f of fulls) {
  if (!f.title_jp || !f.date) continue;
  const key = `${f.title_jp}|||${f.date}`;
  if (!fullIndex.has(key)) fullIndex.set(key, []);
  fullIndex.get(key).push(f);
}

// ─── Constrói o índice de partial → full + lista de unmatched ───
const autoLinked = {};
const unmatchedList = [];
let matched = 0;
let ambiguous = 0;

for (const p of partials) {
  const partialKey = `${p.vol}/${p.file}#${p.topic_idx}`;
  if (!p.title_jp) {
    unmatchedList.push({ ...p, reason: 'sem title_jp' });
    continue;
  }
  if (!p.date) {
    unmatchedList.push({ ...p, reason: 'sem date' });
    continue;
  }
  const key = `${p.title_jp}|||${p.date}`;
  const candidates = fullIndex.get(key);
  if (!candidates) {
    unmatchedList.push({ ...p, reason: 'sem candidato no corpus' });
    continue;
  }
  const others = candidates.filter((c) => !(c.vol === p.vol && c.file === p.file && c.topic_idx === p.topic_idx));
  if (others.length === 0) {
    unmatchedList.push({ ...p, reason: 'só self-match' });
    continue;
  }
  if (others.length > 1) {
    ambiguous++;
    unmatchedList.push({ ...p, reason: 'ambíguo', candidates: others });
    continue;
  }
  const target = others[0];
  autoLinked[partialKey] = {
    vol: target.vol,
    file: target.file,
    topic_idx: target.topic_idx,
    title_jp: target.title_jp,
    title_pt: target.title_pt,
    date: target.date,
  };
  matched++;
}

console.log(`✓ Auto-matched 1:1: ${matched}`);
console.log(`⚠ Ambíguos (pulados): ${ambiguous}`);
console.log(`⊘ Unmatched (incluindo ambíguos): ${unmatchedList.length}`);

// ─── Output ──────────────────────────────────────────────────
const sortedAuto = {};
for (const k of Object.keys(autoLinked).sort()) sortedAuto[k] = autoLinked[k];

// Adiciona conteúdo preview pros unmatched (pra admin UI)
function _previewContent(vol, file, topicIdx) {
  try {
    const data = JSON.parse(readFileSync(join(TEACHINGS_DIR, vol, `${file}.json`), 'utf8'));
    let i = 0;
    for (const theme of data.themes || []) {
      for (const t of theme.topics || []) {
        if (i === topicIdx) {
          const pt = (t.content_ptbr || t.content_pt || '').replace(/<[^>]+>/g, '').trim();
          return pt.slice(0, 240);
        }
        i++;
      }
    }
  } catch (_) {}
  return '';
}

const unmatchedSorted = unmatchedList
  .map((u) => ({
    vol: u.vol,
    file: u.file,
    topic_idx: u.topic_idx,
    title_jp: u.title_jp,
    title_pt: u.title_pt,
    date: u.date,
    reason: u.reason,
    content_preview: _previewContent(u.vol, u.file, u.topic_idx),
  }))
  .sort((a, b) => {
    if (a.vol !== b.vol) return a.vol.localeCompare(b.vol);
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.topic_idx - b.topic_idx;
  });

const payload = {
  generated_at: new Date().toISOString(),
  stats: {
    total_partials: partials.length,
    auto_linked: matched,
    ambiguous,
    unmatched: unmatchedSorted.length,
  },
  note: 'auto_linked: matches 1:1 garantidos (title_jp + date). unmatched: precisam mapeamento manual via admin.',
  auto_linked: sortedAuto,
  unmatched: unmatchedSorted,
};

if (DRY_RUN) {
  console.log('\n[DRY] não gravando. Stats:', payload.stats);
} else {
  // 1) JSON canônico em data/
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`✓ ${OUTPUT_PATH}`);

  // 2) Versão JS pré-carregada em site_data/ (window._partialCitations)
  //    pra reader.html consumir síncrono via <script>. Aqui só os
  //    auto-linked — manual_citation_links.json é mergeado em runtime
  //    pelo reader (carregado do Storage quando o admin atualizar).
  const JS_PATH = join(ROOT, 'site_data', 'partial_citations_index.js');
  mkdirSync(dirname(JS_PATH), { recursive: true });
  const jsContent = `// Gerado por scripts/build_partial_citations_index.mjs em ${payload.generated_at}
// ${matched} citações parciais auto-mapeadas. Manual overrides ficam em
// data/manual_citation_links.json e são mergeados em runtime pelo reader.
window._partialCitations = ${JSON.stringify(sortedAuto, null, 2)};
`;
  writeFileSync(JS_PATH, jsContent, 'utf8');
  console.log(`✓ ${JS_PATH}`);

  // 3) Stub vazio do manual_citation_links.json se ainda não existir.
  const MANUAL_PATH = join(ROOT, 'data', 'manual_citation_links.json');
  if (!existsSync(MANUAL_PATH)) {
    const stub = {
      generated_at: new Date().toISOString(),
      note: 'Mapeamentos manuais de citações parciais → ensinamento completo (interno). Editado via admin → aba "Citações Parciais".',
      links: {},
    };
    writeFileSync(MANUAL_PATH, JSON.stringify(stub, null, 2) + '\n', 'utf8');
    console.log(`✓ ${MANUAL_PATH} (stub criado)`);
  }

  // Mostra a entry do Pragmatismo se existir
  const pragma = sortedAuto['mioshiec3/hentai2.html#10'];
  if (pragma) {
    console.log('\nExemplo (Pragmatismo, auto-linked):');
    console.log('  partial: mioshiec3/hentai2.html#10');
    console.log(`  → ${pragma.vol}/${pragma.file}#${pragma.topic_idx}`);
  }
}
