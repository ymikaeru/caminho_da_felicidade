#!/usr/bin/env node
// ============================================================
// build_jp_search_index.mjs — gera índices de busca em japonês
// pra usar dentro do admin (aba Citações). Permite localizar
// um trecho japonês entre os 17k+ tópicos sem precisar abrir
// editor externo.
//
// Output: data/jp_search/mioshiec[1-4].json
//   [
//     { v: 'mioshiec1', f: 'huku6SHUGOSIN.html', i: 0,
//       t: '明主様御教え 「守護神」より',
//       d: '昭和18年10月23日',
//       c: '...primeiros 1000 chars de content (JP)...' },
//     ...
//   ]
//
// Por que separado por vol: facilita lazy-load no admin (1-2 MB
// cada em vez de baixar tudo de uma vez).
// ============================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TEACHINGS_DIR = join(ROOT, '.local-edits', 'teachings');
const OUT_DIR = join(ROOT, 'data', 'jp_search');

const VOLS = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];
const MAX_CONTENT_CHARS = 800; // suficiente pra match de trechos distintivos sem inchar o índice

mkdirSync(OUT_DIR, { recursive: true });

let grandTotal = 0;

for (const vol of VOLS) {
  const dir = join(TEACHINGS_DIR, vol);
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); }
  catch { console.warn(`[skip] ${vol}: dir não encontrado`); continue; }

  const entries = [];
  for (const file of files) {
    let data;
    try { data = JSON.parse(readFileSync(join(dir, file), 'utf8')); }
    catch (e) { console.warn(`  [skip parse] ${file}`); continue; }
    if (!data.themes) continue;

    let globalIdx = 0;
    for (const theme of data.themes) {
      for (const t of theme.topics || []) {
        const contentJa = (t.content || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
        if (contentJa) {
          entries.push({
            v: vol,
            f: file.replace(/\.json$/, ''),
            i: globalIdx,
            t: (t.title || '').trim(),
            d: (t.date || '').trim(),
            c: contentJa.slice(0, MAX_CONTENT_CHARS),
          });
        }
        globalIdx++;
      }
    }
  }

  const outPath = join(OUT_DIR, `${vol}.json`);
  writeFileSync(outPath, JSON.stringify(entries), 'utf8'); // sem indent — economiza espaço
  const sizeMb = (Buffer.byteLength(JSON.stringify(entries)) / 1024 / 1024).toFixed(2);
  console.log(`[${vol}] ${entries.length} tópicos com JP · ${sizeMb} MB · ${outPath}`);
  grandTotal += entries.length;
}

console.log(`\nTotal: ${grandTotal} tópicos com conteúdo japonês indexados`);
