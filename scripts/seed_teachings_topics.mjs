#!/usr/bin/env node
// ============================================================
// Seeder one-shot — popular `teachings_topics` a partir dos JSONs
// em storage://teachings/mioshiec{1..4}/*.json
// ============================================================
//
// Uso:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/seed_teachings_topics.mjs
//
// Opcional:
//   --vols=mioshiec1,mioshiec3   processa apenas os volumes listados
//   --dry-run                    não escreve no banco; só imprime o que faria
//
// Idempotente: rodar 2x produz o mesmo estado final.
// Para cada (vol, file): apaga rows existentes e re-insere — assim
// renomeações de topics e mudanças de topic_count ficam consistentes.
// Ao final, apaga rows órfãs (vol, file) que sumiram do Storage.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { extractTopicsFromJson } from '../supabase/functions/_shared/topic_normalize.mjs';

const VOLUMES_DEFAULT = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];
const BUCKET = 'teachings';
const BATCH_SIZE = 100;
const LIST_PAGE = 1000;

// ---------------- args ----------------
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const volsArg = args.find(a => a.startsWith('--vols='));
const volumes = volsArg
  ? volsArg.replace('--vols=', '').split(',').map(s => s.trim()).filter(Boolean)
  : VOLUMES_DEFAULT;

// ---------------- env ----------------
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('ERROR: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  process.exit(1);
}
if (key.length < 100 || !key.startsWith('eyJ')) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY parece inválido (esperava JWT começando com eyJ...).');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------- helpers ----------------
async function listAllFiles(vol) {
  // Storage list é paginado. Repete até vir uma página menor que LIST_PAGE.
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .storage
      .from(BUCKET)
      .list(vol, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${vol}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      if (item.name && item.name.endsWith('.json')) {
        all.push({
          name: item.name,
          updated_at: item.updated_at || item.metadata?.lastModified || null,
        });
      }
    }
    if (data.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }
  return all;
}

async function downloadJson(vol, name) {
  const { data, error } = await supabase.storage.from(BUCKET).download(`${vol}/${name}`);
  if (error) throw new Error(`download ${vol}/${name}: ${error.message}`);
  const text = await data.text();
  return JSON.parse(text);
}

async function upsertBatch(rows) {
  if (dryRun || rows.length === 0) return;
  const { error } = await supabase
    .from('teachings_topics')
    .upsert(rows, { onConflict: 'vol,file,topic_idx' });
  if (error) throw new Error(`upsert: ${error.message}`);
}

async function deleteForFile(vol, file) {
  if (dryRun) return;
  // NOTA: re-runs têm uma janela curta (uns ms) onde rows são deletadas
  // antes do upsert. Aceitável para um seeder one-shot. O webhook de
  // produção usará upsert+trim para evitar essa janela.
  const { error } = await supabase
    .from('teachings_topics')
    .delete()
    .eq('vol', vol)
    .eq('file', file);
  if (error) throw new Error(`delete ${vol}/${file}: ${error.message}`);
}

async function deleteOrphans(vol, keepFiles) {
  if (dryRun) return 0;
  // Busca distincts no banco para esse vol e remove os que sumiram do Storage.
  const { data, error } = await supabase
    .from('teachings_topics')
    .select('file')
    .eq('vol', vol);
  if (error) throw new Error(`list-distinct ${vol}: ${error.message}`);
  const inDb = Array.from(new Set((data || []).map(r => r.file)));
  const orphans = inDb.filter(f => !keepFiles.has(f));
  for (const f of orphans) {
    await deleteForFile(vol, f);
  }
  return orphans.length;
}

// ---------------- main ----------------
async function processFile(vol, fileEntry) {
  const fileKey = fileEntry.name.replace(/\.json$/, '');
  const json = await downloadJson(vol, fileEntry.name);
  const { rows, topicsSeen, topicsSkipped } = extractTopicsFromJson({
    vol,
    file: fileKey,
    json,
  });

  // Inclui source_updated_at em cada row para evitar segundo round-trip
  // e a janela onde rows existem com source_updated_at = NULL.
  const enriched = rows.map(r => ({
    ...r,
    source_updated_at: fileEntry.updated_at || null,
  }));

  // Substituição atômica por arquivo: delete + reinsert garante que
  // mudanças no topic_count não deixam linhas stale.
  await deleteForFile(vol, fileKey);

  for (let i = 0; i < enriched.length; i += BATCH_SIZE) {
    await upsertBatch(enriched.slice(i, i + BATCH_SIZE));
  }

  return { fileKey, topicsSeen, topicsSkipped, inserted: enriched.length };
}

async function processVolume(vol) {
  console.log(`\n━━━ ${vol} ━━━`);
  const files = await listAllFiles(vol);
  console.log(`  ${files.length} arquivo(s) JSON encontrado(s).`);

  const stats = {
    files_total: files.length,
    files_processed: 0,
    files_failed: 0,
    topics_seen: 0,
    topics_skipped_empty: 0,
    rows_inserted: 0,
  };
  const seenFiles = new Set();

  for (const f of files) {
    try {
      const r = await processFile(vol, f);
      seenFiles.add(r.fileKey);
      stats.files_processed++;
      stats.topics_seen += r.topicsSeen;
      stats.topics_skipped_empty += r.topicsSkipped;
      stats.rows_inserted += r.inserted;
      process.stdout.write(`\r  processados ${stats.files_processed}/${files.length}...`);
    } catch (e) {
      stats.files_failed++;
      console.warn(`\n  WARN ${vol}/${f.name}: ${e.message}`);
    }
  }
  console.log('');

  const orphans = await deleteOrphans(vol, seenFiles);
  if (orphans > 0) console.log(`  Removidas ${orphans} arquivo(s) órfão(s) do banco.`);

  return stats;
}

(async () => {
  const startedAt = Date.now();
  console.log(`Seeder iniciado${dryRun ? ' [DRY-RUN]' : ''}.`);
  console.log(`Volumes: ${volumes.join(', ')}`);

  const report = {};
  for (const vol of volumes) {
    try {
      report[vol] = await processVolume(vol);
    } catch (e) {
      console.error(`\nERRO em ${vol}: ${e.message}`);
      report[vol] = { error: e.message };
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n${'='.repeat(60)}`);
  console.log('RESUMO');
  console.log('='.repeat(60));
  for (const [vol, s] of Object.entries(report)) {
    if (s.error) {
      console.log(`${vol.padEnd(12)} ERRO: ${s.error}`);
      continue;
    }
    console.log(
      `${vol.padEnd(12)} ` +
      `arquivos ${s.files_processed}/${s.files_total}` +
      (s.files_failed ? ` (${s.files_failed} falharam)` : '') +
      ` · topics vistos ${s.topics_seen}` +
      ` · pulados(vazios) ${s.topics_skipped_empty}` +
      ` · rows inseridas ${s.rows_inserted}`
    );
  }
  console.log(`\nTempo: ${elapsed}s${dryRun ? ' [DRY-RUN — nada foi escrito]' : ''}`);

  // Sanity: divergência entre topics_seen e (rows_inserted + topics_skipped_empty)
  // indica bug — todo topic visto deve ou ter row inserida ou ter sido pulado.
  for (const [vol, s] of Object.entries(report)) {
    if (s.error) continue;
    const expected = s.rows_inserted + s.topics_skipped_empty;
    if (expected !== s.topics_seen) {
      console.warn(
        `WARN ${vol}: topics_seen=${s.topics_seen} ≠ rows_inserted+pulados=${expected}. Investigar.`
      );
    }
  }
})().catch(e => {
  console.error('\nFATAL:', e);
  process.exit(1);
});
