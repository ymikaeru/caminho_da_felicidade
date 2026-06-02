// TEMP — limpa os eventos de TESTE do anon do preview do Claude (localhost:8014)
// que poluíram o analytics do johrei em producao. Sem --delete = só conta (read-only).
// Com --delete = apaga. Scope: site=johrei AND anon_id = ANON (= localhost, confirmado
// pelos paths sem /guia_do_johrei/).
import { loadEnv, makeClient } from './_storage_sync_lib.mjs';
await loadEnv();
const sb = makeClient();

const ANON = 'cd5e97d2-4128-4937-b322-76c503c3bdf0';
const doDelete = process.argv.includes('--delete');

const { data, error } = await sb.from('site_events')
  .select('event_type,path,created_at')
  .eq('site', 'johrei').eq('anon_id', ANON)
  .order('created_at', { ascending: true })
  .limit(10000);
if (error) { console.error('read error:', error.message); process.exit(1); }

const byType = {}; const paths = {};
for (const r of data) {
  byType[r.event_type] = (byType[r.event_type] || 0) + 1;
  paths[r.path] = (paths[r.path] || 0) + 1;
}
console.log(`\nanon de teste = ${ANON}`);
console.log(`total de eventos (johrei) = ${data.length}`);
console.log(`por tipo = ${JSON.stringify(byType)}`);
console.log(`paths = ${JSON.stringify(paths)}`);
console.log(`janela = ${data.length ? data[0].created_at + ' .. ' + data[data.length - 1].created_at : '-'}`);

// Sanity: confirma que NENHUM path tem /guia_do_johrei/ (= seria producao real, nao apagar)
const realPaths = Object.keys(paths).filter(p => (p || '').includes('/guia_do_johrei/'));
console.log(`paths de PRODUCAO real neste anon (deve ser []): ${JSON.stringify(realPaths)}`);

if (doDelete) {
  if (realPaths.length) { console.error('ABORTADO: este anon tem paths de producao real — nao vou apagar.'); process.exit(1); }
  const { error: delErr, count } = await sb.from('site_events')
    .delete({ count: 'exact' })
    .eq('site', 'johrei').eq('anon_id', ANON);
  if (delErr) { console.error('DELETE error:', delErr.message); process.exit(1); }
  console.log(`\n>>> DELETADOS ${count} eventos de teste do anon ${ANON.slice(0, 8)}... <<<`);
} else {
  console.log(`\n(read-only — rode com --delete pra apagar)`);
}
