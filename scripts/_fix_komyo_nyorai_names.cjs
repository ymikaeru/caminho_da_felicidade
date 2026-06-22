#!/usr/bin/env node
/**
 * _fix_komyo_nyorai_names.cjs — corrige o NOME do Deus 光明如来 que foi
 * TRADUZIDO como "Buda da Luz" em vez de romanizado ("Komyo Nyorai").
 *
 * Convenção do corpus (1387x): 光明如来 -> "Komyo Nyorai", 大光明如来 -> "Daikomyo Nyorai".
 *
 * NÃO toca:
 *   - 無碍光如来 -> "Mugeko Nyorai (Buda da Luz Desimpedida)" (outro Deus; gloss em parênteses)
 *   - 光の仏様 -> "Buda da luz" (minúsculo; EPÍTETO descritivo, o nome já está presente)
 *   - campos *_prev (backup, não exibidos)
 *
 * Uso: node scripts/_fix_komyo_nyorai_names.cjs            (dry-run)
 *      node scripts/_fix_komyo_nyorai_names.cjs --apply    (grava)
 */
const fs = require('fs');
const path = require('path');
const APPLY = process.argv.includes('--apply');
const ROOT = path.join(__dirname, '..', '.local-edits', 'teachings');

// Substituições por arquivo de conteúdo (texto cru, exato). [find, replace, esperado]
const CONTENT = {
  'mioshiec1/reikaiSHUUKYOU.html.json': [
    ['o Buda da Luz (Koumyou Nyorai - Kanzeon Bosatsu)', 'o Komyo Nyorai (Kanzeon Bosatsu)', 1],
  ],
  'mioshiec1/Sbunke.html.json': [
    ['Imagem do Buda da Luz no tokonoma', 'Imagem do Komyo Nyorai no tokonoma', 1],
  ],
  'mioshiec1/sinra1.html.json': [
    ['apareceu o Buda da Luz, ou seja, o Kanzeon Bosatsu', 'apareceu o Komyo Nyorai, ou seja, o Kanzeon Bosatsu', 1],
  ],
  'mioshiec1/Skaimyou.html.json': [
    ['a Imagem do Buda da Luz (Komyo Nyorai-Sama)', 'a Imagem de Komyo Nyorai-Sama', 1],
  ],
  'mioshiec1/SRsanpai.html.json': [
    ['orei ao Buda da Luz (Koumyou Nyorai)', 'orei ao Komyo Nyorai', 1],
  ],
  'mioshiec3/Gigi.html.json': [
    ['Buda da Luz', 'Komyo Nyorai', 7],   // 4 (topic#1) + 3 (topic#3), todos = nome 光明如来
  ],
  'mioshiec3/Gkishou.html.json': [
    ['Buda da Luz', 'Komyo Nyorai', 5],   // titulo#13 + 3 (conteudo#13) + 1 (conteudo#14)
  ],
  'mioshiec4/kinzyuu.html.json': [
    ['Komyo Nyorai (Buda da Luz)', 'Komyo Nyorai', 1],  // remove gloss redundante
  ],
};

function countOcc(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

let ok = true;
console.log(APPLY ? '== APLICANDO ==' : '== DRY-RUN ==');
for (const [rel, reps] of Object.entries(CONTENT)) {
  const p = path.join(ROOT, rel);
  let txt = fs.readFileSync(p, 'utf8');
  const before = txt;
  for (const [find, repl, exp] of reps) {
    const got = countOcc(txt, find);
    const status = got === exp ? 'OK' : '*** MISMATCH ***';
    if (got !== exp) ok = false;
    console.log(`  ${rel}  "${find.slice(0, 40)}..."  encontrado=${got} esperado=${exp}  ${status}`);
    txt = txt.split(find).join(repl);
  }
  // Sanidade: o arquivo continua sendo JSON válido?
  try { JSON.parse(txt); } catch (e) { console.log(`  !!! JSON inválido após edição: ${rel}: ${e.message}`); ok = false; }
  if (APPLY && txt !== before && ok) { fs.writeFileSync(p, txt); console.log(`  -> gravado ${rel}`); }
}

// search_index_mioshiec3.json: corrige só o TÍTULO do Gkishou#13 (alimenta titles_index)
const SI3 = path.join(ROOT, 'search_index_mioshiec3.json');
{
  const arr = JSON.parse(fs.readFileSync(SI3, 'utf8'));
  let hits = 0;
  for (const r of arr) {
    if (r.f === 'Gkishou' && typeof r.t === 'string' && r.t.includes('Buda da Luz')) {
      console.log(`  search_index_mioshiec3  ${r.f}#${r.i} title: "${r.t}"`);
      r.t = r.t.split('Buda da Luz').join('Komyo Nyorai');
      hits++;
    }
  }
  console.log(`  search_index_mioshiec3 títulos corrigidos: ${hits} (esperado 1)`);
  if (hits !== 1) ok = false;
  if (APPLY && ok) { fs.writeFileSync(SI3, JSON.stringify(arr)); console.log('  -> gravado search_index_mioshiec3.json'); }
}

console.log(ok ? '\nTudo OK.' : '\n*** HOUVE PROBLEMA — revise ***');
process.exit(ok ? 0 : 1);
