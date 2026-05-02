#!/usr/bin/env node
// ============================================================
// storage-status — varre .local-edits/teachings/, calcula SHA-256
// de cada arquivo e compara com o manifest gerado pelo último pull.
// Lista o que está modificado, novo (não estava no manifest) ou
// faltando (estava no manifest mas sumiu local).
//
// NÃO altera nada — só lê e imprime.
//
// Uso:
//   node scripts/storage-status.mjs
//   node scripts/storage-status.mjs --prefix=mioshiec1
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  MIRROR_DIR, MANIFEST_PATH, sha256, readManifest, parseArgs, pathMatchesPrefix
} from './_storage_sync_lib.mjs';

const args = parseArgs(process.argv);
const prefixes = args.prefix ? String(args.prefix).split(',').map(s => s.trim()).filter(Boolean) : [];

async function walk(dir, base = '') {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...await walk(abs, rel));
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

const manifest = await readManifest();
if (!manifest.generatedAt) {
  console.log('⚠ Nenhum manifest encontrado. Rode primeiro:');
  console.log('   node scripts/storage-pull.mjs');
  process.exit(1);
}

const localFiles = (await walk(MIRROR_DIR)).filter(p => pathMatchesPrefix(p, prefixes));
const knownFiles = Object.keys(manifest.files).filter(p => pathMatchesPrefix(p, prefixes));

const localSet = new Set(localFiles);
const knownSet = new Set(knownFiles);

const modified = [];
const novel    = [];
const missing  = [];
const same     = [];

for (const rel of localFiles) {
  const buf = await fs.readFile(path.join(MIRROR_DIR, rel));
  const hash = sha256(buf);
  const known = manifest.files[rel];
  if (!known) {
    novel.push({ path: rel, size: buf.length });
  } else if (known.sha256 !== hash) {
    modified.push({ path: rel, oldSize: known.size, newSize: buf.length });
  } else {
    same.push(rel);
  }
}
for (const rel of knownFiles) {
  if (!localSet.has(rel)) missing.push(rel);
}

console.log(`📋 Manifest: ${manifest.generatedAt}`);
console.log(`📂 Local:    ${MIRROR_DIR}`);
if (prefixes.length) console.log(`🔍 Filtro:   ${prefixes.join(', ')}`);
console.log('');
console.log(`✓ Inalterados:  ${same.length}`);
console.log(`✎ Modificados:  ${modified.length}`);
console.log(`+ Novos:        ${novel.length}`);
console.log(`- Faltando:     ${missing.length}`);
console.log('');

if (modified.length) {
  console.log('━━━ Modificados (vão ser sobrescritos no push) ━━━');
  for (const m of modified) {
    const delta = m.newSize - m.oldSize;
    const sign = delta >= 0 ? '+' : '';
    console.log(`   ✎ ${m.path}  (${sign}${delta} bytes)`);
  }
  console.log('');
}
if (novel.length) {
  console.log('━━━ Novos (vão ser criados no push) ━━━');
  for (const n of novel) console.log(`   + ${n.path}  (${n.size} bytes)`);
  console.log('');
}
if (missing.length) {
  console.log('━━━ Faltando local (push NÃO apaga remoto por padrão) ━━━');
  for (const p of missing) console.log(`   - ${p}`);
  console.log('   (use --delete-missing no push se quiser remover do remoto)');
  console.log('');
}

if (modified.length === 0 && novel.length === 0) {
  console.log('Tudo sincronizado. Nada a subir.');
}
