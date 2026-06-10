// Diagnóstico: quanto do histórico (reading_positions) daria pra semear
// como "Ensinamento lido"? Read-only. Pagina além do cap de 1000 linhas.
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

let all = [], from = 0;
for (;;) {
  const { data, error } = await supa.from('reading_positions')
    .select('user_id,volume,file,topic_index,total_topics,progress_pct,max_scroll_pct,time_spent_seconds,updated_at')
    .order('updated_at')
    .range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

const users = new Set(all.map(r => r.user_id));
console.log(`reading_positions: ${all.length} linhas, ${users.size} usuários`);

const withScroll = all.filter(r => (r.max_scroll_pct ?? 0) > 0);
console.log(`com captura de scroll (max_scroll_pct > 0): ${withScroll.length}`);

for (const th of [90, 80, 70]) {
  const hit = all.filter(r => (r.max_scroll_pct ?? 0) >= th);
  const byUser = {};
  hit.forEach(r => { byUser[r.user_id] = (byUser[r.user_id] || 0) + 1; });
  console.log(`max_scroll_pct >= ${th}: ${hit.length} publicações, ${Object.keys(byUser).length} usuários`);
}

// sem scroll mas com tempo relevante (leituras antigas, pré-captura de scroll)
const oldStyle = all.filter(r => (r.max_scroll_pct ?? 0) === 0 && (r.time_spent_seconds ?? 0) >= 300);
console.log(`sem scroll, mas >= 5min de tempo: ${oldStyle.length} publicações`);

// distribuição por usuário no limiar 90 (top 8)
const byUser90 = {};
all.filter(r => (r.max_scroll_pct ?? 0) >= 90).forEach(r => {
  byUser90[r.user_id] = (byUser90[r.user_id] || 0) + 1;
});
const top = Object.entries(byUser90).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('top usuários (>=90%):', top.map(([u, n]) => `${u.slice(0, 8)}…=${n}`).join('  '));

// datas: a captura de scroll começou quando?
const datedScroll = withScroll.map(r => r.updated_at).sort();
if (datedScroll.length) console.log(`updated_at com scroll: ${datedScroll[0]} → ${datedScroll[datedScroll.length - 1]}`);
