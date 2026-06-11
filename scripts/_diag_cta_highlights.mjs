// Diagnóstico READ-ONLY: quantos grifos (user_highlights) existem em tópicos
// que hoje exibem o CTA "Ler texto completo" de citação parcial?
// Classifica por updated_at vs 2026-05-28 (commit 4b42f6e, quando o CTA
// passou a injetar texto dentro do #topic-N e mudou a base dos offsets).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 1) Citações auto (site_data/partial_citations_index.js — window._partialCitations = {...})
const autoSrc = readFileSync(join(ROOT, 'site_data', 'partial_citations_index.js'), 'utf8');
const autoJson = autoSrc.slice(autoSrc.indexOf('{'), autoSrc.lastIndexOf('}') + 1);
const auto = JSON.parse(autoJson.replace(/,\s*}$/, '}'));

// 2) Citações manuais publicadas (Storage > teachings/data/manual_citation_links.json)
let manual = {};
try {
  const { data, error } = await supa.storage.from('teachings').download('data/manual_citation_links.json');
  if (error) throw error;
  manual = JSON.parse(await data.text())?.links || {};
} catch (e) {
  console.warn('manual_citation_links.json (Storage) indisponível:', e.message || e);
}

// no_full_text não gera CTA — não conta
const ctaKeys = new Set();
for (const [k, v] of Object.entries(auto)) if (v?.type !== 'no_full_text') ctaKeys.add(k);
for (const [k, v] of Object.entries(manual)) if (v?.type !== 'no_full_text') ctaKeys.add(k);
console.log(`Tópicos com CTA: ${ctaKeys.size} (auto=${Object.keys(auto).length}, manual=${Object.keys(manual).length})`);

// 3) Grifos nesses tópicos (pagina além do cap de 1000)
let all = [], from = 0;
for (;;) {
  const { data, error } = await supa.from('user_highlights')
    .select('user_id,volume,file,topic_index,topic_id,start_char,end_char,text,updated_at')
    .order('updated_at')
    .range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`user_highlights total: ${all.length} linhas`);

const CTA_SHIP = new Date('2026-05-28T00:00:00Z').getTime();
const hit = all.filter(h => ctaKeys.has(`${h.volume}/${h.file}#${h.topic_index}`));
const pre = hit.filter(h => new Date(h.updated_at).getTime() < CTA_SHIP);
const post = hit.filter(h => new Date(h.updated_at).getTime() >= CTA_SHIP);
console.log(`\nGrifos em tópicos com CTA: ${hit.length}`);
console.log(`  tocados ANTES do CTA (28/05) — base sem CTA, já deslocados hoje: ${pre.length}`);
console.log(`  tocados DEPOIS do CTA — base com CTA, corretos hoje: ${post.length}`);
const users = new Set(hit.map(h => h.user_id));
console.log(`  usuários afetados: ${users.size}`);
for (const h of hit) {
  console.log(`  - ${h.volume}/${h.file}#${h.topic_index} [${h.start_char},${h.end_char}] ${new Date(h.updated_at).toISOString().slice(0,10)} user=${h.user_id.slice(0,8)} "${(h.text||'').slice(0,40)}"`);
}
