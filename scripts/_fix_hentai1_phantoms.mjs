// One-off: marca os phantom topics de hentai1.html.json (palavras enfatizadas
// lidas como título → continues_previous) e limpa as emendas (espaço + aspa solta).
// Idempotente. Roda com --apply pra gravar; sem flag só mostra o preview.
import fs from 'node:fs';

const FILE = '.local-edits/teachings/mioshiec3/hentai1.html.json';
const APPLY = process.argv.includes('--apply');

const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const t = j.themes[0].topics;

// Sanidade: confirma que cada índice é quem esperamos antes de mexer.
const expect = {
  0: 'Ensinamento de Meishu-Sama: \'A Extinção dos Pecados e Impurezas\'',
  1: 'Como Loucos',
  2: 'Ensinamento de Meishu-Sama: \'Uma Organização Misteriosa\'',
  3: 'Estado Mental Anormal',
  4: 'Ensinamento de Meishu-Sama: Extraído de \'Existe a Verdadeira Religião?\'',
  5: 'Escravos do Sofrimento',
  6: 'Ilusões Religiosas',
  8: 'Texto Satírico de Meishu-Sama: \'Anakashiko\'',
  9: 'Seduzir a esposa de um fiel é profanar o Solo Sagrado',
};
for (const [i, title] of Object.entries(expect)) {
  if ((t[i]?.title_ptbr) !== title) {
    console.error(`✗ ABORT: topic[${i}].title_ptbr = ${JSON.stringify(t[i]?.title_ptbr)} (esperava ${JSON.stringify(title)})`);
    process.exit(1);
  }
}

const lead = (s) => (s.startsWith(' ') ? s : ' ' + s); // prepend 1 espaço, idempotente

// --- Phantoms NOVOS: marca continues_previous ---
t[1].continues_previous = true;   // "Como Loucos"  -> continua T0
t[3].continues_previous = true;   // "Estado Mental Anormal" -> continua T2
t[9].continues_previous = true;   // "Seduzir a esposa..." -> continua T8

// --- Emendas: garante espaço entre o fim do raiz e o início do fragmento (PT) ---
t[1].content_ptbr = lead(t[1].content_ptbr);   // "entre eles," + " há pessoas"
t[3].content_ptbr = lead(t[3].content_ptbr);   // "verdadeiramente" + " acaba"
t[5].content_ptbr = lead(t[5].content_ptbr);   // "por assim dizer," + " a realidade" (já-live)
t[6].content_ptbr = lead(t[6].content_ptbr);   // "grandes" + " ilusões" (já-live)
// T9: T8 já termina com espaço ("monetárias, ") — não mexe.

// --- Aspa solta no fim do T2 (artefato de tradução; o JA fecha em "まことに") ---
t[2].content_ptbr = t[2].content_ptbr.replace(/<\/u>",\s*$/, '</u>');

// ---- Verificação: simula o merge do reader-render e mostra a costura ----
const vis = (s) => s.replace(/<[^>]+>/g, '');            // tira tags, MANTÉM espaços
const render = (s) => vis(s).replace(/\s+/g, ' ');        // colapsa whitespace (como o HTML), SEM trim
const seams = [[0,1],[2,3],[4,5],[5,6],[8,9]];
console.log(APPLY ? '\n=== APLICADO — costuras (PT) ===' : '\n=== PREVIEW — costuras (PT) ===');
for (const [r,f] of seams) {
  const tail = vis(t[r].content_ptbr).slice(-28);
  const head = vis(t[f].content_ptbr).slice(0, 28);
  const rendered = render(t[r].content_ptbr + t[f].content_ptbr); // concat BRUTO, como o reader
  const joinAt = render(t[r].content_ptbr).length;
  const around = rendered.slice(Math.max(0, joinAt - 35), joinAt + 35);
  console.log(`\n[${r}→${f}] frag="${t[f].title_ptbr}" cont_prev=${!!t[f].continues_previous}`);
  console.log(`   junção bruta:  "${tail}"⟦+⟧"${head}"`);
  console.log(`   renderizado:   …${around}…`);
}

if (APPLY) {
  fs.writeFileSync(FILE, JSON.stringify(j, null, 4) + '\n', 'utf8');
  console.log(`\n✅ gravado em ${FILE}`);
} else {
  console.log('\n(preview — rode com --apply pra gravar)');
}
