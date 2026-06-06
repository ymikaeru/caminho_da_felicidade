// ============================================================
// build_alignment_candidates.mjs
// Varre o espelho local (.local-edits/teachings/mioshiecN) com o
// align_engine e gera data/alignment_candidates.json — a worklist da aba
// "Alinhamento" do admin. Não altera nenhum dado; só indexa.
//
// Rode `npm run storage:pull` ANTES p/ o espelho refletir o Storage.
//   node scripts/build_alignment_candidates.mjs
// ============================================================

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const E = require('../js/align-engine.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIR = join(ROOT, '.local-edits', 'teachings');
const VOLS = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];

const stripTags = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const candidates = [];
const stats = { total: 0, walls: 0, untranslated: 0, files: 0 };

for (const vol of VOLS) {
  let files;
  try { files = readdirSync(join(MIR, vol)).filter((f) => f.endsWith('.json')); }
  catch { console.warn(`[skip] ${vol} ausente no espelho`); continue; }

  for (const file of files) {
    let json;
    try { json = JSON.parse(readFileSync(join(MIR, vol, file), 'utf8')); }
    catch { continue; }
    if (!Array.isArray(json.themes)) continue;
    stats.files++;

    json.themes.forEach((theme, ti) => {
      (theme.topics || []).forEach((topic, pi) => {
        stats.total++;
        const pt = topic.content_ptbr || '';
        if (!pt.trim()) { stats.untranslated++; return; }     // PT vazio (não traduzido)
        if (!E.isWall(pt)) return;                            // renderiza OK (Q&A etc.)

        // conserto determinístico: \n\n / <br> → <br/> (preserva palavras)
        const ptFixed = E.wallFix(pt);
        if (E.wordsOnly(ptFixed) !== E.wordsOnly(pt)) return; // sanidade
        stats.walls++;
        const intended = E.splitPtParas(pt).length;
        const rendered = E.renderedParasProxy(pt);
        candidates.push({
          vol, file, theme_idx: ti, topic_idx: pi,
          title: stripTags(topic.title_ptbr || topic.title || '').slice(0, 120),
          intended,                       // parágrafos pretendidos (\n\n)
          rendered,                       // que o leitor mostra hoje (aprox.)
          gain: intended - rendered,      // parágrafos "perdidos" no paredão
        });
      });
    });
  }
}

// ordena por ganho desc, depois vol/file/topic p/ estabilidade
candidates.sort((a, b) =>
  b.gain - a.gain ||
  a.vol.localeCompare(b.vol) ||
  a.file.localeCompare(b.file) ||
  a.theme_idx - b.theme_idx ||
  a.topic_idx - b.topic_idx
);

const outPath = join(ROOT, 'data', 'alignment_candidates.json');
writeFileSync(outPath, JSON.stringify({
  generated_for: 'mioshiec (College)',
  count: candidates.length,
  stats,
  candidates,
}, null, 2), 'utf8');

console.log('=== alignment candidates (PAREDÃO: \\n\\n→<br> preservando o PT) ===');
console.log(stats);
console.log('Paredões listados:', candidates.length);
console.log('→', outPath);
