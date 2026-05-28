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

// ─── Constrói o índice de partial → full ─────────────────────
const index = {};
let matched = 0;
let ambiguous = 0;

for (const p of partials) {
  if (!p.title_jp || !p.date) continue;
  const key = `${p.title_jp}|||${p.date}`;
  const candidates = fullIndex.get(key);
  if (!candidates) continue;
  const others = candidates.filter((c) => !(c.vol === p.vol && c.file === p.file && c.topic_idx === p.topic_idx));
  if (others.length === 0) continue;
  if (others.length > 1) {
    ambiguous++;
    continue; // conservador: pula ambíguos
  }
  const target = others[0];
  const partialKey = `${p.vol}/${p.file}#${p.topic_idx}`;
  index[partialKey] = {
    vol: target.vol,
    file: target.file,
    topic_idx: target.topic_idx,
    title_jp: target.title_jp,
    title_pt: target.title_pt,
    date: target.date,
  };
  matched++;
}

console.log(`✓ Matches 1:1: ${matched}`);
console.log(`⚠ Ambíguos (pulados): ${ambiguous}`);

// ─── Output ──────────────────────────────────────────────────
const sorted = {};
for (const k of Object.keys(index).sort()) sorted[k] = index[k];

const payload = {
  generated_at: new Date().toISOString(),
  total_partials: partials.length,
  total_linked: matched,
  note: 'Mapeia citações parciais → ensinamento completo correspondente. Apenas matches 1:1 por title_jp + date.',
  index: sorted,
};

if (DRY_RUN) {
  console.log('\n[DRY] não gravando. Amostra de 5 entries:');
  const entries = Object.entries(sorted).slice(0, 5);
  for (const [k, v] of entries) {
    console.log(`  ${k}`);
    console.log(`    → ${v.vol}/${v.file}#${v.topic_idx}`);
    console.log(`      ${v.title_pt || v.title_jp} (${v.date})`);
  }
} else {
  // 1) JSON canônico em data/
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`✓ ${OUTPUT_PATH}`);

  // 2) Versão JS pré-carregada em site_data/ (window._partialCitations)
  //    pra reader.html consumir síncrono via <script>.
  const JS_PATH = join(ROOT, 'site_data', 'partial_citations_index.js');
  mkdirSync(dirname(JS_PATH), { recursive: true });
  const jsContent = `// Gerado por scripts/build_partial_citations_index.mjs em ${payload.generated_at}
// ${matched} citações parciais mapeadas para o ensinamento completo correspondente.
window._partialCitations = ${JSON.stringify(sorted, null, 2)};
`;
  writeFileSync(JS_PATH, jsContent, 'utf8');
  console.log(`✓ ${JS_PATH}`);

  // Mostra a entry do Pragmatismo se existir
  const pragma = sorted['mioshiec3/hentai2.html#10'];
  if (pragma) {
    console.log('\nExemplo (Pragmatismo):');
    console.log('  partial: mioshiec3/hentai2.html#10');
    console.log(`  → ${pragma.vol}/${pragma.file}#${pragma.topic_idx}`);
  }
}
