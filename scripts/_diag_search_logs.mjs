// Diagnóstico: saúde da busca via search_logs. Read-only.
// Volume, taxa de zero-resultado, top queries (com e sem resultado), latência.
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
  const { data, error } = await supa.from('search_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

if (!all.length) { console.log('search_logs vazia.'); process.exit(0); }

console.log(`colunas: ${Object.keys(all[0]).join(', ')}`);
console.log(`total de buscas logadas: ${all.length}`);
const users = new Set(all.map(r => r.user_id));
console.log(`usuários distintos: ${users.size}`);
const oldest = all[all.length - 1].created_at, newest = all[0].created_at;
console.log(`período: ${oldest} → ${newest}`);

// últimos 90 dias
const cutoff = new Date(Date.now() - 90 * 864e5).toISOString();
const recent = all.filter(r => r.created_at >= cutoff);
console.log(`\n— últimos 90 dias: ${recent.length} buscas, ${new Set(recent.map(r => r.user_id)).size} usuários`);

const zero = recent.filter(r => r.results_count === 0);
console.log(`zero resultados: ${zero.length} (${(100 * zero.length / (recent.length || 1)).toFixed(1)}%)`);
// results_count = -1: busca de conteúdo indisponível (timeout/erro) — logado
// assim desde o refactor da busca de 07/2026, pra não poluir a taxa de zeros.
const failed = recent.filter(r => r.results_count < 0);
console.log(`indisponível/timeout (-1): ${failed.length} (${(100 * failed.length / (recent.length || 1)).toFixed(1)}%)`);

const freq = (rows) => {
  const m = {};
  rows.forEach(r => { const q = (r.query || '').trim().toLowerCase(); if (q) m[q] = (m[q] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};

console.log('\nTOP 25 queries (90d):');
freq(recent).slice(0, 25).forEach(([q, n]) => {
  const zeros = recent.filter(r => (r.query || '').trim().toLowerCase() === q && r.results_count === 0).length;
  console.log(`  ${String(n).padStart(4)}× ${q}${zeros ? `  (${zeros} c/ zero)` : ''}`);
});

console.log('\nTOP 25 queries com ZERO resultados (90d):');
freq(zero).slice(0, 25).forEach(([q, n]) => console.log(`  ${String(n).padStart(4)}× ${q}`));

// latência
const lat = recent.map(r => r.latency_ms).filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
if (lat.length) {
  const pct = p => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
  console.log(`\nlatência (${lat.length} amostras): p50=${pct(.5)}ms p75=${pct(.75)}ms p90=${pct(.9)}ms p99=${pct(.99)}ms max=${lat[lat.length - 1]}ms`);
  console.log(`acima de 3s: ${lat.filter(v => v > 3000).length} · acima de 8s (timeout): ${lat.filter(v => v >= 8000).length}`);
}

// buscas por dia (últimas 4 semanas) — pra ter noção de uso
const byDay = {};
recent.forEach(r => { const d = r.created_at.slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; });
const days = Object.keys(byDay).sort().slice(-28);
console.log('\nbuscas/dia (últimos 28 dias com atividade):');
days.forEach(d => console.log(`  ${d}: ${byDay[d]}`));
