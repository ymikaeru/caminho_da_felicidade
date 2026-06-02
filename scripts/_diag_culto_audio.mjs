// TEMP diagnostic — read-only. Investiga "escutas completas" do Culto Mensal.
// Pergunta: 3 anon_ids concentram 115 de 148 escutas — bug ou usuários reais?
// Hipóteses testadas:
//  (A) anon_id colapsado (null/vazio) virando 1 "super-recorrente"
//  (B) ended > play (impossível num fluxo legítimo) => double-fire
//  (C) muitos ended em segundos => disparo repetido
//  (D) total_played << duration => seek-to-end (falsa conclusão)
import { loadEnv, makeClient } from './_storage_sync_lib.mjs';

await loadEnv();
const sb = makeClient(); // service role: bypassa RLS

const DAYS = 30;
const since = new Date(Date.now() - DAYS * 864e5).toISOString();

// Puxa todos os eventos de áudio do johrei na janela (= Culto Mensal; é o
// único emissor de audio_* no site).
const { data: rows, error } = await sb.from('site_events')
  .select('event_type,anon_id,session_id,props,created_at')
  .eq('site', 'johrei')
  .in('event_type', ['audio_play', 'audio_pause', 'audio_ended'])
  .gte('created_at', since)
  .order('created_at', { ascending: true });

if (error) { console.error('fetch error:', error.message); process.exit(1); }

const ended = rows.filter(r => r.event_type === 'audio_ended');
const plays = rows.filter(r => r.event_type === 'audio_play');
console.log(`\n=== Culto Mensal áudio — últimos ${DAYS}d ===`);
console.log(`audio_play=${plays.length}  audio_ended=${ended.length}  (total rows=${rows.length})`);

// --- (A) anon_id: quantos ended têm anon_id null/vazio? ---
const nullEnded = ended.filter(r => r.anon_id == null || r.anon_id === '');
console.log(`\n[A] audio_ended com anon_id null/vazio: ${nullEnded.length}`);
const distinctEndedAnons = new Set(ended.map(r => r.anon_id));
console.log(`    anon_ids distintos entre os ended: ${distinctEndedAnons.size}`);

// --- Agrega por anon (reproduz a lógica do dashboard) ---
const byAnon = {};
for (const r of rows) {
  const k = String(r.anon_id); // <- mesmo cast implícito do dashboard (objeto key)
  byAnon[k] ??= { anon: r.anon_id, play: 0, ended: 0, sessions: new Set(), endedRows: [] };
  if (r.event_type === 'audio_play') byAnon[k].play++;
  if (r.event_type === 'audio_ended') { byAnon[k].ended++; byAnon[k].endedRows.push(r); }
  byAnon[k].sessions.add(r.session_id);
}

const ranked = Object.values(byAnon).filter(a => a.ended > 0).sort((x, y) => y.ended - x.ended);
console.log(`\n[B/C/D] Top anon_ids por nº de 'ended':`);
for (const a of ranked.slice(0, 8)) {
  const times = a.endedRows.map(r => new Date(r.created_at).getTime()).sort((x, y) => x - y);
  // menor gap entre dois ended consecutivos (segundos)
  let minGap = Infinity;
  for (let i = 1; i < times.length; i++) minGap = Math.min(minGap, (times[i] - times[i - 1]) / 1000);
  const span = times.length > 1 ? (times[times.length - 1] - times[0]) / 864e5 : 0; // dias
  const played = a.endedRows.map(r => Number((r.props || {}).total_played_seconds) || 0);
  const durs = a.endedRows.map(r => Number((r.props || {}).duration_seconds) || 0).filter(Boolean);
  const dur = durs.length ? Math.round(durs.reduce((s, v) => s + v, 0) / durs.length) : null;
  const lowPlayed = dur ? played.filter(p => p < dur * 0.5).length : '?'; // ended com <50% ouvido
  console.log(
    `  anon=${JSON.stringify(a.anon)}  ended=${a.ended}  play=${a.play}` +
    `${a.ended > a.play ? '  <-- ENDED>PLAY!' : ''}` +
    `  sessões=${a.sessions.size}  span=${span.toFixed(1)}d  minGap=${isFinite(minGap) ? minGap.toFixed(1) + 's' : '—'}` +
    `  dur≈${dur}s  ended_com_<50%=${lowPlayed}`
  );
}

// --- Resumo replicando os números do painel ---
const counts = ranked.map(a => a.ended);
const comp1 = counts.filter(n => n === 1).length;
const comp25 = counts.filter(n => n >= 2 && n <= 5).length;
const comp6 = counts.filter(n => n >= 6).length;
const comp6Listens = counts.filter(n => n >= 6).reduce((s, n) => s + n, 0);
console.log(`\n[resumo painel ATUAL] uniques=${counts.length}  1x=${comp1}  2-5x=${comp25}  6+x=${comp6}  (6+ concentram ${comp6Listens}/${ended.length})`);

// --- Resumo CORRIGIDO: conta ended só se total_played >= 85% da duração ---
const THRESH = 0.80; // = CM_COMPLETE_MIN_RATIO do dashboard
const realByAnon = {};
for (const r of ended) {
  const p = r.props || {};
  const played = Number(p.total_played_seconds) || 0;
  const dur = Number(p.duration_seconds) || 0;
  if (dur && played < dur * THRESH) continue; // descarta seek-to-end / rajada (espelha o dashboard)
  const k = String(r.anon_id);
  realByAnon[k] = (realByAnon[k] || 0) + 1;
}
const realCounts = Object.values(realByAnon);
const realTotal = realCounts.reduce((s, n) => s + n, 0);
const r1 = realCounts.filter(n => n === 1).length;
const r25 = realCounts.filter(n => n >= 2 && n <= 5).length;
const r6 = realCounts.filter(n => n >= 6).length;
console.log(`[resumo CORRIGIDO ≥${THRESH * 100}%] escutas completas reais=${realTotal}  uniques=${realCounts.length}  1x=${r1}  2-5x=${r25}  6+x=${r6}`);

// --- Quebra por pessoa (corrigida), do maior pro menor ---
console.log(`\n[por pessoa, CORRIGIDO] escutas completas reais por anon:`);
Object.entries(realByAnon).sort((a, b) => b[1] - a[1]).forEach(([anon, n], i) => {
  console.log(`  ${String(i + 1).padStart(2)}. ${anon.slice(0, 8)}…  ${n} escuta(s) completa(s)`);
});
