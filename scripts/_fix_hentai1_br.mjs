// One-off: reposiciona 3 <br/> no PT de hentai1.html.json que separavam
// artigo/preposição do substantivo enfatizado ("o que é uma | comédia trágica",
// "inevitavelmente um | truque", "transformando em um | estado mental anormal").
// Move a quebra para um ponto natural do PT, mantendo a frase enfatizada em
// linha própria (recurso retórico do original). SÓ no content_ptbr (o JA mantém
// o layout fiel). Idempotente. --apply grava; sem flag só mostra preview.
//
// GARANTIA: cada troca só MOVE a tag <br/> — o texto visível (tags removidas) NÃO
// muda, então os offsets dos grifos do usuário ficam intactos. O script ABORTA se
// o texto visível mudar.
import fs from 'node:fs';

const FILE = '.local-edits/teachings/mioshiec3/hentai1.html.json';
const APPLY = process.argv.includes('--apply');

const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const t = j.themes[0].topics;

// Sanidade de identidade
const expect = { 2: "Ensinamento de Meishu-Sama: 'Uma Organização Misteriosa'", 3: 'Estado Mental Anormal' };
for (const [i, title] of Object.entries(expect)) {
  if (t[i]?.title_ptbr !== title) {
    console.error(`✗ ABORT: topic[${i}].title_ptbr=${JSON.stringify(t[i]?.title_ptbr)} (esperava ${JSON.stringify(title)})`);
    process.exit(1);
  }
}

const vis = (s) => (s || '').replace(/<[^>]+>/g, ''); // texto visível (sem tags) — base dos offsets

// [topicIdx, antes, depois]
const edits = [
  [2,
    ', o que é uma <br/><b><font color="#0000ff" size="+1">comédia trágica',
    ', <br/>o que é uma <b><font color="#0000ff" size="+1">comédia trágica'],
  [2,
    'usam inevitavelmente um <br/><b><font color="#0000ff" size="+1">truque',
    'usam <br/>inevitavelmente um <b><font color="#0000ff" size="+1">truque'],
  [3,
    ' acaba transformando em um <br/><b><font color="#0000ff" size="+2"><u>estado mental anormal',
    ' <br/>acaba transformando em um <b><font color="#0000ff" size="+2"><u>estado mental anormal'],
];

for (const [idx, before, after] of edits) {
  const cur = t[idx].content_ptbr;
  const n = cur.split(before).length - 1;
  if (n !== 1) { console.error(`✗ ABORT: topic[${idx}] alvo encontrado ${n}x (esperava 1):\n  ${before}`); process.exit(1); }
  const next = cur.replace(before, after);
  // INVARIÂNCIA DE OFFSET: o texto visível tem de ser idêntico (só a tag se moveu)
  if (vis(cur) !== vis(next)) {
    console.error(`✗ ABORT: topic[${idx}] o texto visível MUDOU — abortando p/ não deslocar grifos.`);
    const a = vis(cur), b = vis(next);
    for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) { console.error(`  diverge no char ${k}: ${JSON.stringify(a.slice(k-10,k+10))} vs ${JSON.stringify(b.slice(k-10,k+10))}`); break; }
    process.exit(1);
  }
  t[idx].content_ptbr = next;
}

// Preview: simula o merge do reader (T2 + fragmento T3) e mostra como fica
const render = (s) => vis(s).replace(/\s+/g, ' ');
const merged = render(t[2].content_ptbr + t[3].content_ptbr);
console.log(APPLY ? '\n=== APLICADO ===' : '\n=== PREVIEW (rode com --apply p/ gravar) ===');
console.log('\nInvariância de offset: OK (texto visível idêntico em T2 e T3).');
console.log('\n--- T2 content_ptbr com as tags <br/> (PT) ---');
console.log(t[2].content_ptbr.replace(/<br\/?>/g, '⏎<br/>\n   '));
console.log('\n--- T3 content_ptbr (fragmento) ---');
console.log(t[3].content_ptbr.replace(/<br\/?>/g, '⏎<br/>\n   '));
console.log('\n--- trecho final renderizado (T2→T3, como o leitor mostra, ⏎=quebra) ---');
const withBreaks = (t[2].content_ptbr + t[3].content_ptbr).replace(/<br\/?>/g, ' ⏎ ');
console.log('   …' + render(withBreaks).slice(-220));

if (APPLY) {
  fs.writeFileSync(FILE, JSON.stringify(j, null, 4) + '\n', 'utf8');
  console.log(`\n✅ gravado em ${FILE}`);
}
