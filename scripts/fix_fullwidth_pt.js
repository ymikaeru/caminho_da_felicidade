#!/usr/bin/env node
// Normaliza dígitos fullwidth (１-９０) e parênteses fullwidth (（）) → ASCII
// somente nos campos `pt` em site_data/{section_map,global_index_titles}.js.
// Os campos `ja`/`sectionJa` ficam intocados.

const fs = require('fs');
const path = require('path');

const FULL_TO_ASCII = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  '（': '(', '）': ')'
};
const RE = /[０-９（）]/g;
const normalize = (s) => typeof s === 'string' ? s.replace(RE, (c) => FULL_TO_ASCII[c]) : s;

function processFile(filename, globalName, ptFieldWalker) {
  const filePath = path.join(__dirname, '..', 'site_data', filename);
  const src = fs.readFileSync(filePath, 'utf8');
  const m = src.match(new RegExp(`^window\\.${globalName}\\s*=\\s*(.+);\\s*$`, 's'));
  if (!m) {
    console.error(`Não consegui parsear ${filename}.`);
    return;
  }
  const data = JSON.parse(m[1]);
  const changed = ptFieldWalker(data);
  const out = `window.${globalName} = ${JSON.stringify(data)};\n`;
  fs.writeFileSync(filePath, out, 'utf8');
  console.log(`Normalizados: ${changed} títulos pt em ${filename}`);
}

// section_map.js: estrutura {volId: {file: {pt, ja, section, sectionJa}}}
processFile('section_map.js', 'SECTION_MAP', (data) => {
  let n = 0;
  for (const v of Object.keys(data)) {
    for (const f of Object.keys(data[v])) {
      const e = data[v][f];
      if (e && typeof e.pt === 'string') {
        const after = normalize(e.pt);
        if (after !== e.pt) { e.pt = after; n++; }
      }
    }
  }
  return n;
});

// global_index_titles.js: estrutura {volPath: {pt, ja, section}}
processFile('global_index_titles.js', 'GLOBAL_INDEX_TITLES', (data) => {
  let n = 0;
  for (const k of Object.keys(data)) {
    const e = data[k];
    if (e && typeof e.pt === 'string') {
      const after = normalize(e.pt);
      if (after !== e.pt) { e.pt = after; n++; }
    }
  }
  return n;
});
