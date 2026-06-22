#!/usr/bin/env node
/**
 * _fix_komyo_add_sama.cjs — 2ª passada: acrescenta "-Sama" a "Komyo Nyorai"
 * APENAS nas ocorrências onde o japonês traz 光明如来様 (com 様).
 * Onde o japonês traz 光明如来 sem 様 (reikaiSHUUKYOU, sinra1, e o 「光明如来」
 * citado no pergaminho do Gigi#3, e o お願い final do Gigi#1) -> fica "Komyo Nyorai".
 *
 * Roda DEPOIS de _fix_komyo_nyorai_names.cjs --apply.
 * Uso: node scripts/_fix_komyo_add_sama.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');
const APPLY = process.argv.includes('--apply');
const ROOT = path.join(__dirname, '..', '.local-edits', 'teachings');

// [relpath, find, replace, esperado]
const REPS = [
  ['mioshiec1/SRsanpai.html.json', 'orei ao Komyo Nyorai e me senti', 'orei ao Komyo Nyorai-Sama e me senti', 1],
  ['mioshiec1/Sbunke.html.json', 'Imagem do Komyo Nyorai no tokonoma', 'Imagem do Komyo Nyorai-Sama no tokonoma', 1],

  // Gigi#1: occ1,2,3 têm 様 ; occ4 (お願い) fica plain
  ['mioshiec3/Gigi.html.json', "tanto o 'Komyo Nyorai' quanto", "tanto o 'Komyo Nyorai-Sama' quanto", 1],
  ['mioshiec3/Gigi.html.json', 'em suma, o Komyo Nyorai atua', 'em suma, o Komyo Nyorai-Sama atua', 1],
  ['mioshiec3/Gigi.html.json', 'por isso, o Komyo Nyorai está entronizado', 'por isso, o Komyo Nyorai-Sama está entronizado', 1],
  // Gigi#3: occ1 (「光明如来」 do pergaminho) fica plain ; occ2,3 têm 様
  ['mioshiec3/Gigi.html.json', 'eu estou acima do Komyo Nyorai.', 'eu estou acima do Komyo Nyorai-Sama.', 1],
  ['mioshiec3/Gigi.html.json', 'coloque o Komyo Nyorai acima', 'coloque o Komyo Nyorai-Sama acima', 1],

  // Gkishou#13: todas com 様 (título aparece em title_ptbr + prefixo do content = 2x)
  ['mioshiec3/Gkishou.html.json', 'O Komyo Nyorai Nos Avisa Sobre o Erro dos Desinfetantes', 'O Komyo Nyorai-Sama Nos Avisa Sobre o Erro dos Desinfetantes', 2],
  ['mioshiec3/Gkishou.html.json', 'Imagem do Komyo-Nyorai na casa', 'Imagem do Komyo Nyorai-Sama na casa', 1],
  ['mioshiec3/Gkishou.html.json', 'estar diante do Komyo Nyorai e não estar', 'estar diante do Komyo Nyorai-Sama e não estar', 1],
  ['mioshiec3/Gkishou.html.json', 'O Komyo Nyorai nos avisou', 'O Komyo Nyorai-Sama nos avisou', 1],
  // Gkishou#14: 光明如来様 (resposta) -> -Sama  (大光明如来様 da pergunta = "Daikomyo Nyorai", deixado)
  ['mioshiec3/Gkishou.html.json', 'Como o Komyo Nyorai é a luz do Sol', 'Como o Komyo Nyorai-Sama é a luz do Sol', 1],

  ['mioshiec4/kinzyuu.html.json', 'salvas por Komyo Nyorai.', 'salvas por Komyo Nyorai-Sama.', 1],
];

function countOcc(hay, needle){ let n=0,i=0; while((i=hay.indexOf(needle,i))!==-1){n++;i+=needle.length;} return n; }

let ok = true;
const byFile = {};
for (const r of REPS) (byFile[r[0]] ||= []).push(r);

console.log(APPLY ? '== APLICANDO -Sama ==' : '== DRY-RUN -Sama ==');
for (const [rel, reps] of Object.entries(byFile)) {
  const p = path.join(ROOT, rel);
  let txt = fs.readFileSync(p, 'utf8');
  const before = txt;
  for (const [, find, repl, exp] of reps) {
    const got = countOcc(txt, find);
    const st = got === exp ? 'OK' : '*** MISMATCH ***';
    if (got !== exp) ok = false;
    console.log(`  ${rel}  "${find.slice(0,38)}…"  achou=${got} esp=${exp}  ${st}`);
    txt = txt.split(find).join(repl);
  }
  try { JSON.parse(txt); } catch (e) { console.log('  !!! JSON inválido: '+rel+': '+e.message); ok=false; }
  if (APPLY && ok && txt !== before) { fs.writeFileSync(p, txt); console.log('  -> gravado '+rel); }
}

// search_index_mioshiec3 título do Gkishou#13 -> -Sama
{
  const sp = path.join(ROOT, 'search_index_mioshiec3.json');
  const arr = JSON.parse(fs.readFileSync(sp, 'utf8'));
  let hits = 0;
  for (const r of arr) {
    if (r.f === 'Gkishou' && r.t === 'O Komyo Nyorai Nos Avisa Sobre o Erro dos Desinfetantes') {
      r.t = 'O Komyo Nyorai-Sama Nos Avisa Sobre o Erro dos Desinfetantes'; hits++;
    }
  }
  console.log(`  search_index_mioshiec3 título -Sama: ${hits} (esp 1)`);
  if (hits !== 1) ok = false;
  if (APPLY && ok) { fs.writeFileSync(sp, JSON.stringify(arr)); console.log('  -> gravado search_index_mioshiec3.json'); }
}

console.log(ok ? '\nOK.' : '\n*** PROBLEMA ***');
process.exit(ok ? 0 : 1);
