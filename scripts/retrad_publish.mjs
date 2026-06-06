// ============================================================
// retrad_publish.mjs — PUBLICA a retradução do staging no Storage (live).
//
// SEGURO POR PADRÃO: --dry-run é o default. Sem --apply, NÃO escreve nada.
//
// Para cada item selecionado:
//   1. baixa o JSON vivo do Storage
//   2. ANTI-CLOBBER: confere que o content_ptbr vivo ainda == staged old_ptbr.
//      Se divergiu (alguém editou / já publicado), PULA e avisa.
//   3. troca content_ptbr = new_ptbr (JA intocado) e faz upsert
//   4. registra em scripts/retrad_staging/_published.json
//
// Seleção (default: só status 'ok'):
//   --status=ok,flagged   inclui flagged
//   --only=<key.json>     um item só
//   --vol=mioshiec1       filtra volume
//
// Destaques: conta user_highlights nos arquivos afetados (service-role) e avisa.
//
// Uso:
//   node scripts/retrad_publish.mjs                       # DRY-RUN (só relatório)
//   node scripts/retrad_publish.mjs --status=ok --apply   # publica os 'ok'
//   node scripts/retrad_publish.mjs --only=mioshiec1__kuni3__t1.json --apply
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, makeClient, BUCKET, parseArgs } from './_storage_sync_lib.mjs';

const ROOT = process.cwd();
const STAGING_DIR = path.join(ROOT, 'scripts', 'retrad_staging');

async function downloadJson(supabase, p) {
  const { data, error } = await supabase.storage.from(BUCKET).download(p);
  if (error) throw new Error(`download ${p}: ${error.message}`);
  return JSON.parse(await data.text());
}

async function main() {
  await loadEnv();
  const supabase = makeClient();
  const args = parseArgs(process.argv);
  const apply = !!args.apply;
  const statuses = (args.status ? String(args.status) : 'ok').split(',').map((s) => s.trim());
  const only = args.only || null;
  const volFilter = args.vol || null;

  const index = JSON.parse(await fs.readFile(path.join(STAGING_DIR, '_index.json'), 'utf8'));
  let sel = index.filter((x) => statuses.includes(x.status));
  if (only) sel = sel.filter((x) => x.key === only);
  if (volFilter) sel = sel.filter((x) => x.vol === volFilter);

  console.log(`${apply ? '🔴 APPLY' : '🟢 DRY-RUN'} · selecionados: ${sel.length} (status=${statuses.join(',')}${only ? ', only=' + only : ''}${volFilter ? ', vol=' + volFilter : ''})`);
  if (!sel.length) { console.log('Nada a publicar.'); return; }

  // contagem de destaques nos arquivos afetados (service-role ignora RLS)
  const files = [...new Set(sel.map((x) => x.file))];
  let totalHl = 0; const hlByFile = {};
  for (const f of files) {
    const { count } = await supabase.from('user_highlights').select('id', { count: 'exact', head: true }).eq('file', f);
    if (count) { hlByFile[f] = count; totalHl += count; }
  }
  if (totalHl) {
    console.log(`\n⚠ ${totalHl} destaque(s) salvos em ${Object.keys(hlByFile).length} arquivo(s) afetado(s) — a retradução desloca/quebra a marcação visual (texto grifado fica no banco).`);
    for (const [f, n] of Object.entries(hlByFile)) console.log(`   ${f}: ${n}`);
  } else {
    console.log('\n✓ Nenhum destaque salvo nos arquivos afetados.');
  }

  const log = [];
  let pub = 0, drift = 0, err = 0;
  for (const x of sel) {
    const rec = JSON.parse(await fs.readFile(path.join(STAGING_DIR, x.key), 'utf8'));
    try {
      const live = await downloadJson(supabase, `${rec.vol}/${rec.file}`);
      const topic = live?.themes?.[rec.theme_idx]?.topics?.[rec.topic_idx];
      if (!topic) throw new Error('tópico não encontrado');
      const liveNow = topic.content_ptbr || '';
      const ptDone = liveNow === rec.new_ptbr;            // já tem o novo
      const prevDone = topic.content_ptbr_prev === rec.old_ptbr; // já tem o arquivo da versão anterior
      if (ptDone && prevDone) { log.push({ key: x.key, status: 'já-completo' }); continue; }
      // anti-clobber: o vivo precisa ser o ANTIGO (não publicado) ou o NOVO (já publicado, falta só o prev)
      if (liveNow !== rec.old_ptbr && liveNow !== rec.new_ptbr) {
        drift++; log.push({ key: x.key, status: 'DRIFT-pulado' });
        console.log(`  ⚠ DRIFT ${x.key}: o vivo mudou desde a geração — PULADO (não clobba).`);
        continue;
      }
      if (apply) {
        topic.content_ptbr = rec.new_ptbr;        // JA (topic.content) intocado
        topic.content_ptbr_prev = rec.old_ptbr;   // arquivo da versão anterior (conferência/garimpo)
        const blob = new Blob([JSON.stringify(live, null, 2)], { type: 'application/json' });
        const { error } = await supabase.storage.from(BUCKET)
          .upload(`${rec.vol}/${rec.file}`, blob, { upsert: true, contentType: 'application/json', cacheControl: '0' });
        if (error) throw error;
      }
      pub++; log.push({ key: x.key, status: apply ? (ptDone ? 'prev-backfill' : 'publicado') : 'publicaria' });
    } catch (e) {
      err++; log.push({ key: x.key, status: 'erro', error: e.message });
      console.log(`  ✗ ${x.key}: ${e.message}`);
    }
  }

  await fs.writeFile(path.join(STAGING_DIR, '_published.json'),
    JSON.stringify({ at: new Date().toISOString(), apply, statuses, totalHl, hlByFile, log }, null, 2), 'utf8');

  console.log(`\n[${apply ? 'publicado' : 'dry-run'}] ${apply ? 'publicados' : 'publicaria'}=${pub} · drift-pulados=${drift} · erros=${err}`);
  if (!apply) console.log('Rode de novo com --apply para gravar no Storage.');
  else console.log('Depois: `npm run storage:pull` p/ re-sincronizar o espelho/manifest.');
}

main().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
