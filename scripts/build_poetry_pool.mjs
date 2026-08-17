/**
 * build_poetry_pool.mjs — gera os pools do card "Poema do Momento".
 * Fonte = os dados de poesia do próprio Caminho, com o id de deep-link que
 * cada leitor espera (?poem=<id> → _scrollToPoemCard).
 *
 * Dois arquivos, dois públicos:
 *
 *   data/poetry/poetry_pool.json      → home do site (index.html)
 *       SÓ o Akemaro Kin'eishū (明麿近詠集), a coletânea poética pessoal de
 *       Meishu-Sama, com TODOS os poemas traduzidos.
 *
 *   data/poetry/poetry_pool_all.json  → home da poesia (poesia.html)
 *       As SEIS coletâneas da seção. Amostrado: o pool inteiro daria 4.119
 *       poemas / 1,6 MB (548 KB comprimido) — peso demais pra uma página de
 *       entrada. Com AMOSTRA_POR_COLETANEA=150 fica em ~900 poemas / ~300 KB
 *       (110 KB comprimido), e ninguém esgota 900 poemas no botão 🔀.
 *
 * A amostra é DETERMINÍSTICA e espalhada por toda a coletânea (não os 150
 * primeiros, que viriam só das primeiras seções): índices distribuídos por
 * regra de três. Rodar de novo não embaralha o arquivo — o diff só muda se a
 * fonte mudar.
 *
 * Rodar: node scripts/build_poetry_pool.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, 'data', 'poetry');
const J = (p) => JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf8'));

const AMOSTRA_POR_COLETANEA = 150;

// prefix = esquema de topicId do leitor (?poem=). O Warai no Izumi tem
// estrutura própria (lista plana, id pronto, translation_pt) — daí o `flat`.
const COLLECTIONS = [
  { file: 'akimaro_kineishu.json', prefix: 'akimaro',  u: 'akimaro-kineishu.html', col: 'Akemaro Kin’eishū' },
  { file: 'yama_to_mizu.json',     prefix: 'yama',     u: 'yama-to-mizu.html',     col: 'Yama to Mizu' },
  { file: 'warai_no_izumi.json',   prefix: 'waraino',  u: 'warai-no-izumi.html',   col: 'Warai no Izumi', flat: true },
  { file: 'gosanka_shoban.json',   prefix: 'shoban',   u: 'gosanka-shoban.html',   col: 'Gosanka-shū (1ª ed.)' },
  { file: 'gosanka_kaitei.json',   prefix: 'kaitei',   u: 'gosanka-kaitei.html',   col: 'Gosanka-shū (rev.)' },
  { file: 'gosanka_shikiten.json', prefix: 'shikiten', u: 'gosanka-shikiten.html', col: 'Gosanka das Cerimônias' }
];

// Só poemas já traduzidos: o card é bilíngue e o japonês sozinho não serve
// pra quem não lê japonês.
function ler(c) {
  const d = J(c.file);
  const out = [];

  if (c.flat) {
    (d.poems || []).forEach(p => {
      const pt = (p.translation_pt || '').trim();
      if (!pt || p.num == null) return;
      out.push({
        id: p.id || `${c.prefix}_${String(p.num).padStart(4, '0')}`,
        u: c.u,
        // O título do Warai é japonês (空財布), não português como nas outras
        // coletâneas — fica vazio pra não aparecer japonês na linha em PT.
        t: '',
        jp: (p.original || '').trim(),
        rj: (p.reading || '').trim(),
        pt,
        col: c.col
      });
    });
    return out;
  }

  (d.sections || []).forEach(s => (s.poems || []).forEach(p => {
    if (p.number == null) return;
    const pt = (p.translation || '').trim();
    if (!pt) return;
    out.push({
      id: `${c.prefix}_n${p.number}`,
      u: c.u,
      t: (p.title || '').trim(),
      jp: (p.original || '').trim(),
      rj: (p.reading || '').trim(),
      pt,
      col: c.col
    });
  }));
  return out;
}

// Amostra espalhada: pega `n` itens em posições distribuídas do começo ao fim.
function amostrar(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * (arr.length - 1) / (n - 1))]);
  return out;
}

function gravar(nome, poems, v) {
  const out = path.join(DIR, nome);
  fs.writeFileSync(out, JSON.stringify({ v, poems }));
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  const byCol = {};
  poems.forEach(p => { byCol[p.col] = (byCol[p.col] || 0) + 1; });
  console.log(`✓ ${nome}: ${poems.length} poemas (${kb} KB)`);
  console.log('  por coletânea:', byCol);
}

const porColecao = COLLECTIONS.map(c => ({ c, poems: ler(c) }));

// Home do site: só o Akemaro, completo.
gravar('poetry_pool.json', porColecao.find(x => x.c.prefix === 'akimaro').poems, 1);

// Home da poesia: as seis coletâneas, amostradas.
const todos = [];
porColecao.forEach(({ poems }) => todos.push(...amostrar(poems, AMOSTRA_POR_COLETANEA)));
gravar('poetry_pool_all.json', todos, 2);
