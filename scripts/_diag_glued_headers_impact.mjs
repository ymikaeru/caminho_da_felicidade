// Diagnóstico READ-ONLY: quantos grifos (user_highlights) e excerpts de
// recomendações existem nos volumes mioshiec1-4, e quantos caem em tópicos
// que têm cabeçalho de papel colado (信者の質問/明主様御垂示 sem <br> antes) —
// os que seriam deslocados por uma correção nos dados.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const VOLS = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];
const HDR = /(?:<b[^>]*>\s*<font[^>]*color="?#(?:0000ff|990000|660000)"?[^>]*>|<font[^>]*color="?#(?:0000ff|990000|660000)"?[^>]*>\s*<b[^>]*>)/gi;

function hasGlued(html) {
  if (!html) return false;
  HDR.lastIndex = 0;
  let m;
  while ((m = HDR.exec(html)) !== null) {
    const tail = html.slice(0, m.index).replace(/[\s　]+$/, '');
    if (tail !== '' && !/<br\s*\/?>$/i.test(tail)) return true;
  }
  return false;
}

// mapa vol/file -> Set(topic_idx afetados, em QUALQUER idioma)
const affected = new Map();
for (const vol of VOLS) {
  const dir = join(ROOT, '.local-edits', 'teachings', vol);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const topics = (j.themes || []).flatMap(t => t.topics || []);
    topics.forEach((t, i) => {
      if (hasGlued(t.content) || hasGlued(t.content_ptbr || t.content_pt)) {
        const key = `${vol}/${f.replace(/\.json$/, '')}`;
        if (!affected.has(key)) affected.set(key, new Set());
        affected.get(key).add(i);
      }
    });
  }
}

let all = [], from = 0;
for (;;) {
  const { data, error } = await supa.from('user_highlights')
    .select('user_id,volume,file,topic_index,start_char,end_char,text')
    .in('volume', VOLS)
    .range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`user_highlights em mioshiec1-4: ${all.length}`);
const byVol = {};
for (const h of all) byVol[h.volume] = (byVol[h.volume] || 0) + 1;
console.log('por volume:', JSON.stringify(byVol));

const hit = all.filter(h => affected.get(`${h.volume}/${h.file}`)?.has(h.topic_index));
console.log(`grifos em TÓPICOS AFETADOS (deslocariam): ${hit.length}`);
console.log(`usuários distintos atingidos: ${new Set(hit.map(h => h.user_id)).size}`);
for (const h of hit.slice(0, 15)) {
  console.log(`  ${h.volume}/${h.file}#${h.topic_index} [${h.start_char},${h.end_char}] "${(h.text || '').slice(0, 40)}"`);
}

// excerpt_ranges em recomendações apontando pra esses volumes
const { data: recs, error: recErr } = await supa.from('study_recommendations')
  .select('id,vol,file,topic_idx,excerpt_ranges,excerpt_start_char')
  .in('vol', VOLS)
  .or('excerpt_ranges.not.is.null,excerpt_start_char.not.is.null');
if (recErr) console.warn('recommendations:', recErr.message);
else {
  console.log(`\nrecomendações com excerpt em mioshiec1-4: ${recs.length}`);
  const rHit = recs.filter(r => affected.get(`${r.vol}/${r.file}`)?.has(r.topic_idx));
  console.log(`  em tópicos afetados: ${rHit.length}`);
  rHit.slice(0, 10).forEach(r => console.log(`  rec#${r.id} ${r.vol}/${r.file}#${r.topic_idx}`));
}
