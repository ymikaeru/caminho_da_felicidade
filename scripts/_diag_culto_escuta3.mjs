// Diagnóstico 3: números REAIS (paginando além do cap de 1000 linhas)
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

const since = new Date(Date.now() - 30 * 86400000).toISOString();
let all = [], from = 0;
for (;;) {
  const { data, error } = await supa.from('site_events')
    .select('event_type,session_id,anon_id,props')
    .eq('site', 'johrei')
    .in('event_type', ['audio_play', 'audio_pause', 'audio_ended'])
    .gte('created_at', since)
    .order('created_at')
    .range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`eventos totais: ${all.length}`);

const DIR_KEY = 'orientacao_dirigente_1983';
for (const [nome, rows] of [
  ['CULTO MENSAL', all.filter(r => (r.props || {}).audio !== DIR_KEY)],
  ['DIRIGENTE', all.filter(r => (r.props || {}).audio === DIR_KEY)]
]) {
  const playedBySession = {}, playSessions = new Set();
  rows.forEach(r => {
    if (r.event_type === 'audio_play') { playSessions.add(r.session_id); return; }
    const t = Number((r.props || {}).total_played_seconds) || 0;
    if (t > (playedBySession[r.session_id] || 0)) playedBySession[r.session_id] = t;
  });
  const dur = Number((rows.find(r => (r.props || {}).duration_seconds)?.props || {}).duration_seconds) || 0;
  const totals = Object.values(playedBySession);
  const sum = totals.reduce((a, b) => a + b, 0);
  const med = [...totals].sort((a, b) => a - b)[Math.floor(totals.length / 2)] || 0;
  const fmt = s => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
  console.log(`\n── ${nome} (dur ${fmt(dur)}) ──`);
  console.log(`sessões c/ play: ${playSessions.size} | sessões c/ tempo medido: ${totals.length}`);
  console.log(`média ÷ sessões c/ play (conta atual do admin): ${fmt(sum / (playSessions.size || 1))} = ${dur ? Math.round(sum / (playSessions.size || 1) / dur * 100) : '?'}%`);
  console.log(`média ÷ sessões medidas (conta correta):        ${fmt(sum / (totals.length || 1))} = ${dur ? Math.round(sum / (totals.length || 1) / dur * 100) : '?'}%`);
  console.log(`mediana:                                        ${fmt(med)} = ${dur ? Math.round(med / dur * 100) : '?'}%`);
}
