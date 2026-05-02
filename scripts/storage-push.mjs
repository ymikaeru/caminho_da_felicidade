#!/usr/bin/env node
// ============================================================
// storage-push — sobe ao bucket `teachings` apenas os arquivos
// LOCAIS cujo SHA-256 mudou em relação ao manifest do último pull,
// ou que sejam novos.
//
// SEGURANÇA: por padrão é DRY-RUN. Só sobe de verdade com --confirm.
// Por padrão NÃO apaga arquivos remotos que sumiram do local;
// use --delete-missing para deletar.
//
// Uso:
//   node scripts/storage-push.mjs                 # dry-run, mostra plano
//   node scripts/storage-push.mjs --confirm       # sobe modificados+novos
//   node scripts/storage-push.mjs --confirm --delete-missing
//   node scripts/storage-push.mjs --prefix=mioshiec1 --confirm
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadEnv, makeClient, BUCKET, MIRROR_DIR, sha256,
  readManifest, writeManifest, runWithConcurrency,
  parseArgs, pathMatchesPrefix
} from './_storage_sync_lib.mjs';

await loadEnv();
const args = parseArgs(process.argv);
const supabase = makeClient();
const prefixes = args.prefix ? String(args.prefix).split(',').map(s => s.trim()).filter(Boolean) : [];
const confirm  = !!args.confirm;
const deleteMissing = !!args['delete-missing'];

async function walk(dir, base = '') {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory())   out.push(...await walk(abs, rel));
    else if (e.isFile())   out.push(rel);
  }
  return out;
}

const manifest = await readManifest();
if (!manifest.generatedAt) {
  console.error('⚠ Nenhum manifest. Rode primeiro: node scripts/storage-pull.mjs');
  process.exit(1);
}

console.log(`📤 Push para bucket "${BUCKET}"`);
console.log(`   Manifest do último pull: ${manifest.generatedAt}`);
if (prefixes.length) console.log(`   Filtro: ${prefixes.join(', ')}`);
console.log(`   Modo: ${confirm ? 'EXECUTAR' : 'DRY-RUN (use --confirm para subir)'}`);
console.log(`   Apagar remotos faltantes: ${deleteMissing ? 'SIM' : 'não'}`);
console.log('');

const localFiles = (await walk(MIRROR_DIR)).filter(p => pathMatchesPrefix(p, prefixes));
const knownFiles = Object.keys(manifest.files).filter(p => pathMatchesPrefix(p, prefixes));

const toUpload = [];   // { rel, buf, hash, size, isNew }
const localSet = new Set();
for (const rel of localFiles) {
  localSet.add(rel);
  const buf = await fs.readFile(path.join(MIRROR_DIR, rel));
  const hash = sha256(buf);
  const known = manifest.files[rel];
  if (!known)              toUpload.push({ rel, buf, hash, size: buf.length, isNew: true });
  else if (known.sha256 !== hash) toUpload.push({ rel, buf, hash, size: buf.length, isNew: false });
}
const toDelete = deleteMissing ? knownFiles.filter(p => !localSet.has(p)) : [];

if (toUpload.length === 0 && toDelete.length === 0) {
  console.log('Nada a fazer — tudo sincronizado.');
  process.exit(0);
}

console.log(`Plano:`);
console.log(`   ↑ Subir: ${toUpload.length} (${toUpload.filter(u => u.isNew).length} novos, ${toUpload.filter(u => !u.isNew).length} modificados)`);
if (deleteMissing) console.log(`   ✕ Apagar do remoto: ${toDelete.length}`);
console.log('');

if (!confirm) {
  console.log('━━━ DRY-RUN — preview do que aconteceria ━━━');
  for (const u of toUpload.slice(0, 30)) {
    console.log(`   ${u.isNew ? '+' : '✎'} ${u.rel}  (${u.size} bytes)`);
  }
  if (toUpload.length > 30) console.log(`   …e mais ${toUpload.length - 30} arquivo(s).`);
  if (deleteMissing) {
    for (const p of toDelete.slice(0, 30)) console.log(`   - ${p}`);
    if (toDelete.length > 30) console.log(`   …e mais ${toDelete.length - 30} arquivo(s) a apagar.`);
  }
  console.log('');
  console.log('Adicione --confirm para executar de verdade.');
  process.exit(0);
}

// ---------------- EXECUÇÃO ----------------
function contentTypeFor(rel) {
  if (rel.endsWith('.json')) return 'application/json';
  if (rel.endsWith('.js'))   return 'application/javascript';
  if (rel.endsWith('.html')) return 'text/html';
  return 'application/octet-stream';
}

const uploadOne = async (item) => {
  const blob = new Blob([item.buf], { type: contentTypeFor(item.rel) });
  const { error } = await supabase.storage.from(BUCKET).upload(item.rel, blob, {
    upsert: true,
    contentType: contentTypeFor(item.rel),
    cacheControl: '0'
  });
  if (error) throw new Error(`upload ${item.rel}: ${error.message}`);
  manifest.files[item.rel] = { sha256: item.hash, size: item.size };
};
uploadOne._label = 'subindo';

const deleteOne = async (rel) => {
  const { error } = await supabase.storage.from(BUCKET).remove([rel]);
  if (error) throw new Error(`remove ${rel}: ${error.message}`);
  delete manifest.files[rel];
};
deleteOne._label = 'apagando';

const upErrors  = await runWithConcurrency(toUpload, uploadOne);
const delErrors = toDelete.length ? await runWithConcurrency(toDelete, deleteOne) : [];

manifest.generatedAt = new Date().toISOString();
await writeManifest(manifest);

const upOk  = toUpload.length - upErrors.length;
const delOk = toDelete.length - delErrors.length;
console.log(`\n✅ ${upOk} subido(s)${deleteMissing ? `, ${delOk} apagado(s)` : ''}.`);
if (upErrors.length || delErrors.length) {
  console.log(`⚠ Falhas:`);
  for (const e of [...upErrors, ...delErrors].slice(0, 20)) console.log(`   ${e.item.rel || e.item}: ${e.error.message}`);
  process.exit(1);
}
