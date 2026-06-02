// TEMP diagnostic — read-only. Quem gerou os eventos do audio "Orientacao do
// Dirigente Espiritual" (recem-lancado)? Eventos = cta orientacao_dirigente_open/
// _download + audio_play/pause/ended com props.audio = 'orientacao_dirigente_1983'.
// Compara cada anon_id com o do preview local (localhost:8014) pra responder "sou eu?".
import { loadEnv, makeClient } from './_storage_sync_lib.mjs';

await loadEnv();
const sb = makeClient(); // service role: bypassa RLS

const PREVIEW_ANON = 'cd5e97d2-4128-4937-b322-76c503c3bdf0'; // anon do preview (Claude)
const AUDIO_KEY = 'orientacao_dirigente_1983';
const OPEN_LBL  = 'orientacao_dirigente_open';
const DL_LBL    = 'orientacao_dirigente_download';

const DAYS = 3; // o audio subiu hoje; 3d cobre tudo com folga
const since = new Date(Date.now() - DAYS * 864e5).toISOString();

const { data: rows, error } = await sb.from('site_events')
  .select('event_type,anon_id,session_id,props,path,created_at')
  .eq('site', 'johrei')
  .in('event_type', ['cta', 'audio_play', 'audio_pause', 'audio_ended'])
  .gte('created_at', since)
  .order('created_at', { ascending: true })
  .limit(5000);

if (error) { console.error('fetch error:', error.message); process.exit(1); }
console.log(`\nrows brutos (cta+audio, ${DAYS}d) = ${rows.length}${rows.length >= 5000 ? '  <-- ATINGIU O CAP, pode faltar!' : ''}`);

// Filtra só os eventos do audio do Dirigente
const dir = rows.filter(r => {
  const p = r.props || {};
  if (r.event_type === 'cta') return p.label === OPEN_LBL || p.label === DL_LBL;
  return p.audio === AUDIO_KEY; // audio_play/pause/ended
});

console.log(`\n=== Eventos do audio "Orientacao do Dirigente Espiritual" ===`);
console.log(`total = ${dir.length}`);

const byAnon = {};
for (const r of dir) {
  const k = String(r.anon_id);
  byAnon[k] ??= { anon: r.anon_id, opens: 0, downloads: 0, plays: 0, pauses: 0, endeds: 0, sessions: new Set(), paths: {}, first: r.created_at, last: r.created_at };
  const b = byAnon[k];
  const p = r.props || {};
  if (r.event_type === 'cta' && p.label === OPEN_LBL) b.opens++;
  if (r.event_type === 'cta' && p.label === DL_LBL) b.downloads++;
  if (r.event_type === 'audio_play') b.plays++;
  if (r.event_type === 'audio_pause') b.pauses++;
  if (r.event_type === 'audio_ended') b.endeds++;
  b.sessions.add(r.session_id);
  b.paths[r.path] = (b.paths[r.path] || 0) + 1;
  if (r.created_at < b.first) b.first = r.created_at;
  if (r.created_at > b.last) b.last = r.created_at;
}

for (const [k, b] of Object.entries(byAnon)) {
  const isPreview = k === PREVIEW_ANON;
  console.log(`\nanon = ${k}`);
  console.log(`  ${isPreview ? '>>> E O MEU PREVIEW (localhost:8014, Claude testando) <<<' : '>>> NAO e o preview (outro navegador) <<<'}`);
  console.log(`  aberturas=${b.opens}  plays=${b.plays}  pauses=${b.pauses}  endeds=${b.endeds}  downloads=${b.downloads}`);
  console.log(`  sessoes=${b.sessions.size}  paths=${JSON.stringify(b.paths)}`);
  console.log(`  1o evento = ${b.first}`);
  console.log(`  ult evento= ${b.last}`);
}
