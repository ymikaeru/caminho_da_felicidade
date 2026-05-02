#!/usr/bin/env node
// ============================================================
// storage-pull — baixa todos os arquivos do bucket `teachings`
// para .local-edits/teachings/ e gera um manifest com SHA-256.
//
// Uso:
//   node scripts/storage-pull.mjs                 # tudo
//   node scripts/storage-pull.mjs --prefix=mioshiec1
//   node scripts/storage-pull.mjs --prefix=mioshiec1,mioshiec2
//   node scripts/storage-pull.mjs --only-json     # ignora .js e outros
//
// Idempotente: roda quantas vezes quiser; sobrescreve local com remoto.
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadEnv, makeClient, BUCKET, MIRROR_DIR, listAllFiles,
  sha256, readManifest, writeManifest, runWithConcurrency,
  parseArgs, pathMatchesPrefix
} from './_storage_sync_lib.mjs';

await loadEnv();
const args = parseArgs(process.argv);
const supabase = makeClient();
const prefixes = args.prefix ? String(args.prefix).split(',').map(s => s.trim()).filter(Boolean) : [];
const onlyJson = !!args['only-json'];

console.log(`📥 Pull de bucket "${BUCKET}" → ${MIRROR_DIR}`);
if (prefixes.length) console.log(`   Filtros de prefix: ${prefixes.join(', ')}`);
if (onlyJson)        console.log(`   Apenas .json`);

console.log('Listando arquivos remotos…');
const allRemote = await listAllFiles(supabase);
const filtered  = allRemote.filter(p => {
  if (!pathMatchesPrefix(p, prefixes)) return false;
  if (onlyJson && !p.endsWith('.json')) return false;
  return true;
});
console.log(`   ${filtered.length} arquivo(s) para baixar (de ${allRemote.length} no bucket).`);

if (filtered.length === 0) {
  console.log('Nada a fazer.');
  process.exit(0);
}

const manifest = { generatedAt: new Date().toISOString(), files: {} };
// Preserva entries fora do filtro (pra não perder hash de arquivos já baixados antes)
const prev = await readManifest();
for (const [p, info] of Object.entries(prev.files || {})) {
  if (!pathMatchesPrefix(p, prefixes)) manifest.files[p] = info;
}

const downloadOne = async (remotePath) => {
  const { data, error } = await supabase.storage.from(BUCKET).download(remotePath);
  if (error) throw new Error(`download ${remotePath}: ${error.message}`);
  if (!data)  throw new Error(`download ${remotePath}: vazio`);
  const buf = Buffer.from(await data.arrayBuffer());
  const localPath = path.join(MIRROR_DIR, remotePath);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, buf);
  manifest.files[remotePath] = { sha256: sha256(buf), size: buf.length };
};
downloadOne._label = 'baixando';

const errors = await runWithConcurrency(filtered, downloadOne);

await writeManifest(manifest);

console.log(`\n✅ ${filtered.length - errors.length} arquivo(s) baixado(s).`);
if (errors.length) {
  console.log(`⚠ ${errors.length} falha(s):`);
  for (const e of errors.slice(0, 20)) console.log(`   ${e.item}: ${e.error.message}`);
  if (errors.length > 20) console.log(`   …e mais ${errors.length - 20}.`);
  process.exit(1);
}
console.log(`📋 Manifest salvo em ${path.relative(process.cwd(), 'scripts').replace(/\\/g, '/')}/../.local-edits/.manifest.json`);
console.log('\nAgora edita à vontade em .local-edits/teachings/ e roda:');
console.log('   node scripts/storage-status.mjs       # vê o que mudou');
console.log('   node scripts/storage-push.mjs --confirm');
