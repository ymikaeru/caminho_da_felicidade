/**
 * build_poetry_pool.mjs — gera data/poetry/poetry_pool.json (pool do "Poema do
 * Momento" da home). Reaproveita a curadoria de 366 poemas do new_mioshie_zenshu
 * (data/poetry/poetry_daily.json), mas:
 *   - remapeia as URLs pras páginas do Caminho (yamatomizu→yama-to-mizu, etc.)
 *   - converte os ids pro esquema de deep-link do Caminho (yama_n{n}, akimaro_n{n};
 *     gôsanka já é {key}_n{n})
 *   - VALIDA cada id contra os dados reais do Caminho — descarta o que não casar,
 *     pra nenhum "Ler no leitor →" cair no vazio.
 *
 * Rodar: node scripts/build_poetry_pool.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ZEN = 'D:/Mioshie_Sites/new_mioshie_zenshu/data/poetry/poetry_daily.json';
const OUT = path.join(ROOT, 'data', 'poetry', 'poetry_pool.json');
const J = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// Conjunto de topicIds válidos no Caminho, por coletânea (mesmo esquema dos
// leitores: poetry-yama.js/gosanka.js/akimaro.js).
function idsFrom(file, prefix) {
  const d = J(path.join(ROOT, 'data', 'poetry', file));
  const ids = new Set();
  (d.sections || []).forEach(s => (s.poems || []).forEach(p => {
    if (p && p.number != null) ids.add(`${prefix}_n${p.number}`);
  }));
  return ids;
}
const VALID = {
  'yama-to-mizu.html':     idsFrom('yama_to_mizu.json', 'yama'),
  'akimaro-kineishu.html': idsFrom('akimaro_kineishu.json', 'akimaro'),
  'gosanka-shoban.html':   idsFrom('gosanka_shoban.json', 'shoban'),
  'gosanka-kaitei.html':   idsFrom('gosanka_kaitei.json', 'kaitei'),
  'gosanka-shikiten.html': idsFrom('gosanka_shikiten.json', 'shikiten')
};

// zenshu url → caminho url
const U_MAP = {
  'yamatomizu.html': 'yama-to-mizu.html',
  'akimaro.html': 'akimaro-kineishu.html',
  'gosanka-shoban.html': 'gosanka-shoban.html',
  'gosanka-kaitei.html': 'gosanka-kaitei.html',
  'gosanka-shikiten.html': 'gosanka-shikiten.html'
};
// prefixo de id por url do caminho
const PREFIX = {
  'yama-to-mizu.html': 'yama',
  'akimaro-kineishu.html': 'akimaro',
  'gosanka-shoban.html': 'shoban',
  'gosanka-kaitei.html': 'kaitei',
  'gosanka-shikiten.html': 'shikiten'
};
// "Akemaro" é a grafia de exibição no site (arquivos/ids seguem "akimaro").
const COL_FIX = { 'Akimaro Kin’eishū': 'Akemaro Kin’eishū', 'Akimaro Kin\'eishū': 'Akemaro Kin’eishū' };

const zen = J(ZEN).days;
const pool = [];
const dropped = [];
for (const p of zen) {
  const u = U_MAP[p.u];
  if (!u) { dropped.push([p.u, p.id, 'url desconhecida']); continue; }
  // id do caminho: gôsanka já vem "{key}_n{n}"; yama/akimaro vêm número puro.
  const raw = String(p.id);
  const id = /_n\d+$/.test(raw) ? raw : `${PREFIX[u]}_n${raw}`;
  if (!VALID[u].has(id)) { dropped.push([u, id, 'id inexistente no Caminho']); continue; }
  pool.push({
    id, u,
    t: p.t || '',
    jp: p.jp || '',
    rj: p.rj || '',
    pt: p.pt || '',
    col: COL_FIX[p.col] || p.col || ''
  });
}

fs.writeFileSync(OUT, JSON.stringify({ v: 1, poems: pool }));
const bytes = fs.statSync(OUT).size;
console.log(`✓ ${pool.length} poemas → ${path.relative(ROOT, OUT)} (${(bytes / 1024).toFixed(0)} KB)`);
const byCol = {};
pool.forEach(p => { byCol[p.col] = (byCol[p.col] || 0) + 1; });
console.log('por coletânea:', byCol);
if (dropped.length) {
  console.log(`\n${dropped.length} descartados:`);
  dropped.slice(0, 20).forEach(d => console.log('  ', d.join(' | ')));
}
