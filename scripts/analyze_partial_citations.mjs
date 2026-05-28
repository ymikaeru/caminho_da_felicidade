#!/usr/bin/env node
// Análise: lê todos os ensinamentos em .local-edits/teachings/mioshiec*/,
// identifica citações parciais e procura o texto completo correspondente
// (mesmo title + mesma date, em outro arquivo, sem o marker de citação).
//
// Não escreve nada — só relata estatísticas.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TEACHINGS = join(ROOT, '.local-edits', 'teachings');

const VOLS = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];

const PARTIAL_RE = /一部のみ引用|Citação parcial/;

// Carrega tudo em memória
const allTopics = []; // { vol, file, topic_idx, title, date, isPartial }
for (const vol of VOLS) {
  const dir = join(TEACHINGS, vol);
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); }
  catch { continue; }
  for (const file of files) {
    let data;
    try { data = JSON.parse(readFileSync(join(dir, file), 'utf8')); }
    catch (e) { console.warn(`[skip] ${vol}/${file}: ${e.message.slice(0, 60)}`); continue; }
    if (!data.themes) continue;
    for (const theme of data.themes) {
      const topics = theme.topics || [];
      for (let i = 0; i < topics.length; i++) {
        const t = topics[i];
        const isPartial = PARTIAL_RE.test((t.content || '') + (t.content_ptbr || ''));
        allTopics.push({
          vol,
          file,
          topic_idx: i,
          title: (t.title || '').trim(),
          date: (t.date || '').trim(),
          isPartial,
        });
      }
    }
  }
}

console.log(`Total topics analisados: ${allTopics.length}`);
const partials = allTopics.filter((t) => t.isPartial);
const fulls = allTopics.filter((t) => !t.isPartial);
console.log(`Citações parciais: ${partials.length}`);
console.log(`Textos completos (potencial alvo): ${fulls.length}`);

// Indexar fulls por (title + date)
const fullIndex = new Map();
for (const f of fulls) {
  if (!f.title || !f.date) continue;
  const key = `${f.title}|||${f.date}`;
  if (!fullIndex.has(key)) fullIndex.set(key, []);
  fullIndex.get(key).push(f);
}

// Pra cada parcial, achar o full correspondente
let matched = 0;
let ambiguous = 0;
let notFound = 0;
const notFoundSamples = [];
const ambiguousSamples = [];

for (const p of partials) {
  if (!p.title || !p.date) {
    notFound++;
    if (notFoundSamples.length < 5) notFoundSamples.push({ ...p, reason: 'sem title/date' });
    continue;
  }
  const key = `${p.title}|||${p.date}`;
  const candidates = fullIndex.get(key);
  if (!candidates || candidates.length === 0) {
    notFound++;
    if (notFoundSamples.length < 5) notFoundSamples.push({ ...p, reason: 'sem match' });
    continue;
  }
  // Filtrar pra não ser o mesmo topic
  const others = candidates.filter((c) => !(c.vol === p.vol && c.file === p.file && c.topic_idx === p.topic_idx));
  if (others.length === 0) {
    notFound++;
    if (notFoundSamples.length < 5) notFoundSamples.push({ ...p, reason: 'só o próprio match' });
    continue;
  }
  if (others.length > 1) {
    ambiguous++;
    if (ambiguousSamples.length < 3) ambiguousSamples.push({ partial: p, candidates: others });
    continue;
  }
  matched++;
}

console.log('');
console.log(`✓ Matched (1:1):  ${matched}  (${((matched / partials.length) * 100).toFixed(1)}%)`);
console.log(`⚠ Ambíguos (>1):  ${ambiguous}`);
console.log(`✗ Não encontrado: ${notFound}`);

if (notFoundSamples.length) {
  console.log('\nAmostras de não-encontrado:');
  for (const s of notFoundSamples) {
    console.log(`  - ${s.vol}/${s.file}#${s.topic_idx}: "${s.title}" (${s.date}) — ${s.reason}`);
  }
}

if (ambiguousSamples.length) {
  console.log('\nAmostras de ambíguos:');
  for (const a of ambiguousSamples) {
    console.log(`  - ${a.partial.vol}/${a.partial.file}#${a.partial.topic_idx}: "${a.partial.title}"`);
    for (const c of a.candidates) console.log(`    → ${c.vol}/${c.file}#${c.topic_idx}`);
  }
}
