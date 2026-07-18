/**
 * build_poetry_pool.mjs — gera data/poetry/poetry_pool.json (pool do "Poema do
 * Momento" da home). Fonte = os dados de poesia do próprio Caminho, com o id de
 * deep-link que cada leitor espera (?poem=<id> → _scrollToPoemCard).
 *
 * Hoje o pool usa SÓ o Akemaro Kin'eishū (明麿近詠集), a coletânea poética
 * pessoal de Meishu-Sama. Pra incluir outras coletâneas de novo, basta
 * descomentar as entradas em COLLECTIONS (os ids seguem o esquema do leitor:
 * yama_n{n} / akimaro_n{n} / {key}_n{n} pro gôsanka).
 *
 * Rodar: node scripts/build_poetry_pool.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'data', 'poetry', 'poetry_pool.json');
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'poetry', p), 'utf8'));

// Coletâneas ativas no pool. prefix = esquema de topicId do leitor.
const COLLECTIONS = [
  { file: 'akimaro_kineishu.json', prefix: 'akimaro', u: 'akimaro-kineishu.html', col: 'Akemaro Kin’eishū' }
  // { file: 'yama_to_mizu.json',     prefix: 'yama',     u: 'yama-to-mizu.html',     col: 'Yama to Mizu 山と水' },
  // { file: 'gosanka_shoban.json',   prefix: 'shoban',   u: 'gosanka-shoban.html',   col: 'Gosanka-shū (1ª ed.)' },
  // { file: 'gosanka_kaitei.json',   prefix: 'kaitei',   u: 'gosanka-kaitei.html',   col: 'Gosanka-shū (rev.)' },
  // { file: 'gosanka_shikiten.json', prefix: 'shikiten', u: 'gosanka-shikiten.html', col: 'Cerimônias 各式典' }
];

const pool = [];
for (const c of COLLECTIONS) {
  const d = J(c.file);
  (d.sections || []).forEach(s => (s.poems || []).forEach(p => {
    if (p.number == null) return;
    const pt = (p.translation || '').trim();
    if (!pt) return; // só poemas já traduzidos (bilíngue no card)
    pool.push({
      id: `${c.prefix}_n${p.number}`,
      u: c.u,
      t: (p.title || '').trim(),
      jp: (p.original || '').trim(),
      rj: (p.reading || '').trim(),
      pt,
      col: c.col
    });
  }));
}

fs.writeFileSync(OUT, JSON.stringify({ v: 1, poems: pool }));
const bytes = fs.statSync(OUT).size;
console.log(`✓ ${pool.length} poemas → ${path.relative(ROOT, OUT)} (${(bytes / 1024).toFixed(0)} KB)`);
const byCol = {};
pool.forEach(p => { byCol[p.col] = (byCol[p.col] || 0) + 1; });
console.log('por coletânea:', byCol);
