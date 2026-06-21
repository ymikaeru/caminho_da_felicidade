// One-off: remove os <br/> INTERNOS das passagens enfatizadas (<u>…</u>) de
// hentai1.html.json, em JA (content) e PT (content_ptbr), T2 e T3. As frases
// enfatizadas viram prosa corrida; o destaque (negrito/cor/sublinhado) FICA.
// Mantém as quebras de PARÁGRAFO (<br> antes de "Sobre este ponto"/"この点",
// "No entanto"/"しかるに", e o <br/>…</b><br/> antes de "Isso está"/"これは").
//
// OFFSET-NEUTRO: <br/> é tag → não conta nos offsets dos grifos. Removê-lo não
// altera o texto visível. O script ABORTA se o texto visível mudar.
// Idempotente (pula âncora já removida). --apply grava.
import fs from 'node:fs';

const FILE = '.local-edits/teachings/mioshiec3/hentai1.html.json';
const APPLY = process.argv.includes('--apply');
const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const t = j.themes[0].topics;
const vis = (s) => (s || '').replace(/<[^>]+>/g, '');

// [topicIdx, campo, âncora-com-<br/>] — remove SÓ o <br/> dessa âncora
const removals = [
  // ---- JA (content), T2 — 6 quebras internas ----
  [2, 'content', 'それは、<br/><font color="#0000ff" size="+1"><b>苦しむ'],
  [2, 'content', 'のであるから、その<br/><font color="#0000ff" size="+1"><b>罪障を消すべく'],
  [2, 'content', 'と言うので、 <br/><font color="#0000ff" size="+1"><b>苦悩が来れば'],
  [2, 'content', 'を掛けるという<br/><b><font color="#0000ff" size="+1">悲惨なる喜劇'],
  [2, 'content', '止むを得ず<br/><b><font color="#0000ff" size="+1">トリック'],
  [2, 'content', 'それは、<br/><font color="#0000ff" size="+1"><b>不幸や苦痛も'],
  // ---- PT (content_ptbr), T2 — 6 quebras internas ----
  [2, 'content_ptbr', 'Dizem que <br/><font color="#0000ff" size="+1"><b>sofrer'],
  [2, 'content_ptbr', ', portanto, <br/><font color="#0000ff" size="+1"><b>deve-se'],
  [2, 'content_ptbr', ' e assim, <br/><font color="#0000ff" size="+1"><b>quanto mais'],
  [2, 'content_ptbr', ', <br/>o que é uma <b><font color="#0000ff" size="+1">comédia'],
  [2, 'content_ptbr', 'usam <br/>inevitavelmente um <b><font color="#0000ff" size="+1">truque'],
  [2, 'content_ptbr', 'Isso é, dizem que <br/><font color="#0000ff" size="+1"><b>devemos agradecer'],
  // ---- PT (content_ptbr), T3 — a quebra que sobrou antes de "acaba" ----
  [3, 'content_ptbr', ' <br/>acaba transformando em um <b>'],
];

let done = 0, skipped = 0;
for (const [idx, field, anchor] of removals) {
  const cur = t[idx][field];
  const without = anchor.replace('<br/>', '');
  const nWith = cur.split(anchor).length - 1;
  if (nWith === 0) {
    if (cur.includes(without)) { skipped++; continue; } // já removido
    console.error(`✗ ABORT: topic[${idx}].${field} âncora não encontrada:\n  ${anchor}`); process.exit(1);
  }
  if (nWith !== 1) { console.error(`✗ ABORT: topic[${idx}].${field} âncora ${nWith}x (esperava 1):\n  ${anchor}`); process.exit(1); }
  const next = cur.replace(anchor, without);
  if (vis(cur) !== vis(next)) { console.error(`✗ ABORT: texto visível mudou em topic[${idx}].${field}`); process.exit(1); }
  t[idx][field] = next;
  done++;
}

// Verificação: quebras de PARÁGRAFO preservadas
const keep = [
  [2, 'content', '<br>この点について'],
  [2, 'content', '有り得ない。</font><br/>'],
  [2, 'content_ptbr', '<br>Sobre este ponto'],
  [2, 'content_ptbr', 'inferno.</font><br/>'],
  [3, 'content', '<br>しかるに'],
  [3, 'content_ptbr', '<br>No entanto'],
];
const keptOk = keep.every(([i, f, s]) => t[i][f].includes(s));

// Resíduo: nenhum <br/> deve sobrar DENTRO dos <u>…</u> (sanity)
const brInsideU = (s) => (s.match(/<u>[\s\S]*?<\/u>/g) || []).some(seg => /<br\s*\/?>/.test(seg));

console.log(APPLY ? '=== APLICADO ===' : '=== PREVIEW (use --apply) ===');
console.log(`Removidos: ${done}  |  já-removidos (skip): ${skipped}`);
console.log(`Quebras de parágrafo preservadas: ${keptOk ? 'OK' : '✗ FALHOU'}`);
console.log(`<br> remanescente dentro de <u> — T2 JA: ${brInsideU(t[2].content)}  T2 PT: ${brInsideU(t[2].content_ptbr)}  (esperado: false)`);
for (const idx of [2, 3]) {
  console.log(`\n--- T${idx} JA (render) ---\n   ${vis(t[idx].content).replace(/\s+/g,' ').slice(0, 360)}…`);
  console.log(`--- T${idx} PT (render) ---\n   ${vis(t[idx].content_ptbr).replace(/\s+/g,' ').slice(0, 360)}…`);
}
if (!keptOk) { console.error('\n✗ parágrafo perdido — não gravando.'); process.exit(1); }

if (APPLY) {
  fs.writeFileSync(FILE, JSON.stringify(j, null, 4) + '\n', 'utf8');
  console.log(`\n✅ gravado em ${FILE}`);
} else {
  console.log('\n(preview — rode com --apply pra gravar)');
}
