// Validação READ-ONLY do simulador de render (_glued_fix_lib.mjs):
// pra cada user_highlight de mioshiec1-4, simula o texto renderizado do
// tópico (PT e JA) e confere se slice(start,end) === text salvo.
// Taxa alta = simulador fiel = remapeamento de offsets é seguro.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadTopics, simulateTopicText } from './_glued_fix_lib.mjs';

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const VOLS = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];
let all = [], from = 0;
for (;;) {
  const { data, error } = await supa.from('user_highlights')
    .select('id,user_id,volume,file,topic_index,start_char,end_char,text')
    .in('volume', VOLS)
    .range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`grifos a validar: ${all.length}`);

const cacheTopics = new Map(); // vol/file -> topics
const cacheText = new Map();   // vol/file#idx#lang -> rendered text

function rendered(vol, file, idx, lang) {
  const k = `${vol}/${file}#${idx}#${lang}`;
  if (cacheText.has(k)) return cacheText.get(k);
  const fk = `${vol}/${file}`;
  if (!cacheTopics.has(fk)) {
    try { cacheTopics.set(fk, loadTopics(vol, file)); }
    catch { cacheTopics.set(fk, null); }
  }
  const topics = cacheTopics.get(fk);
  let txt = null;
  if (topics && topics[idx]) {
    try { txt = simulateTopicText(topics, idx, lang); } catch (e) { txt = null; }
  }
  cacheText.set(k, txt);
  return txt;
}

let ok = 0, okJa = 0, badRange = 0, miss = 0, noFile = 0;
const missSamples = [];
for (const h of all) {
  if (h.start_char == null || h.end_char == null || h.start_char < 0 || h.end_char <= h.start_char) { badRange++; continue; }
  const pt = rendered(h.volume, h.file, h.topic_index, 'pt');
  if (pt == null) { noFile++; continue; }
  if (pt.slice(h.start_char, h.end_char) === h.text) { ok++; continue; }
  const ja = rendered(h.volume, h.file, h.topic_index, 'ja');
  if (ja != null && ja.slice(h.start_char, h.end_char) === h.text) { okJa++; continue; }
  miss++;
  if (missSamples.length < 12) {
    missSamples.push({
      key: `${h.volume}/${h.file}#${h.topic_index} [${h.start_char},${h.end_char}]`,
      want: (h.text || '').slice(0, 50),
      gotPt: pt.slice(h.start_char, h.end_char).slice(0, 50),
    });
  }
}
console.log(`validados PT: ${ok}`);
console.log(`validados JA: ${okJa}`);
console.log(`range inválido (end<=start ou negativo — já quebrados no banco): ${badRange}`);
console.log(`arquivo/tópico não encontrado: ${noFile}`);
console.log(`MISS (slice difere do texto salvo): ${miss}`);
for (const s of missSamples) {
  console.log(`\n  ${s.key}`);
  console.log(`    salvo:    ${JSON.stringify(s.want)}`);
  console.log(`    simulado: ${JSON.stringify(s.gotPt)}`);
}
