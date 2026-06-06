// ============================================================
// retrad_revert.mjs — DESFAZ a publicação da retradução (restaura o PT antigo).
//
// SEGURO POR PADRÃO: --dry-run é o default. Sem --apply, NÃO escreve nada.
//
// Lógica (auto-detecta o que foi publicado, não depende de log):
//   p/ cada item do staging (default status 'ok'; --status=ok,flagged p/ todos):
//     baixa o vivo
//     - live.content_ptbr === rec.new_ptbr  → restaura rec.old_ptbr (REVERTE)
//     - live.content_ptbr === rec.old_ptbr  → já é o original (nada a fazer)
//     - senão                                → DRIFT (editado depois) → PULA
//
// Uso:
//   node scripts/retrad_revert.mjs                      # DRY-RUN (relatório)
//   node scripts/retrad_revert.mjs --apply              # reverte os 'ok'
//   node scripts/retrad_revert.mjs --status=ok,flagged --apply
//   node scripts/retrad_revert.mjs --only=<key.json> --apply
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

  const index = JSON.parse(await fs.readFile(path.join(STAGING_DIR, '_index.json'), 'utf8'));
  let sel = index.filter((x) => statuses.includes(x.status));
  if (only) sel = sel.filter((x) => x.key === only);

  console.log(`${apply ? '🔴 APPLY (revert)' : '🟢 DRY-RUN (revert)'} · candidatos: ${sel.length} (status=${statuses.join(',')})`);

  let revert = 0, original = 0, drift = 0, err = 0;
  const log = [];
  for (const x of sel) {
    const rec = JSON.parse(await fs.readFile(path.join(STAGING_DIR, x.key), 'utf8'));
    try {
      const live = await downloadJson(supabase, `${rec.vol}/${rec.file}`);
      const topic = live?.themes?.[rec.theme_idx]?.topics?.[rec.topic_idx];
      if (!topic) throw new Error('tópico não encontrado');
      const now = topic.content_ptbr || '';
      if (now === rec.old_ptbr) { original++; log.push({ key: x.key, status: 'já-original' }); continue; }
      if (now !== rec.new_ptbr) { drift++; log.push({ key: x.key, status: 'DRIFT-pulado' }); console.log(`  ⚠ DRIFT ${x.key}: vivo não é nem o novo nem o antigo — PULADO.`); continue; }
      if (apply) {
        topic.content_ptbr = rec.old_ptbr;
        delete topic.content_ptbr_prev; // remove o arquivo da versão anterior (undo limpo)
        const blob = new Blob([JSON.stringify(live, null, 2)], { type: 'application/json' });
        const { error } = await supabase.storage.from(BUCKET)
          .upload(`${rec.vol}/${rec.file}`, blob, { upsert: true, contentType: 'application/json', cacheControl: '0' });
        if (error) throw error;
      }
      revert++; log.push({ key: x.key, status: apply ? 'revertido' : 'reverteria' });
    } catch (e) { err++; log.push({ key: x.key, status: 'erro', error: e.message }); console.log(`  ✗ ${x.key}: ${e.message}`); }
  }

  await fs.writeFile(path.join(STAGING_DIR, '_reverted.json'),
    JSON.stringify({ at: new Date().toISOString(), apply, statuses, revert, original, drift, err, log }, null, 2), 'utf8');
  console.log(`\n[${apply ? 'revertido' : 'dry-run'}] ${apply ? 'revertidos' : 'reverteria'}=${revert} · já-original=${original} · drift=${drift} · erros=${err}`);
  if (apply) console.log('Depois: `npm run storage:pull` p/ re-sincronizar o espelho.');
}

main().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
