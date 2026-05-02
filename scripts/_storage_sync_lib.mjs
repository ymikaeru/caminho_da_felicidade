// ============================================================
// Helpers compartilhados pelos scripts storage-pull/push/status.
// Sem dependências externas (só @supabase/supabase-js, já no package.json).
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const BUCKET       = 'teachings';
export const LOCAL_ROOT   = '.local-edits';
export const MIRROR_DIR   = path.join(LOCAL_ROOT, BUCKET);
export const MANIFEST_PATH = path.join(LOCAL_ROOT, '.manifest.json');
export const LIST_PAGE    = 1000;
export const PARALLEL     = 16;

// ---------------- env ----------------
// Carrega SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY de process.env ou de .env.local
// (parser simples — uma var por linha, KEY=VALUE, com quotes opcionais).
export async function loadEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const txt = await fs.readFile('.env.local', 'utf8');
    for (const raw of txt.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

export function makeClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY.');
    console.error('Coloque no .env.local (gitignored) ou exporte na shell antes de rodar.');
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---------------- listagem recursiva ----------------
// O .list() do Supabase só retorna 1 nível; folders aparecem com id=null.
// Esta função desce recursivamente e devolve uma lista plana de paths
// relativos ao bucket (ex: "mioshiec1/foo.html.json").
export async function listAllFiles(supabase, prefix = '') {
  const out = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list("${prefix}"): ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Folders no Supabase Storage têm id=null e metadata=null
      if (entry.id === null) {
        const sub = await listAllFiles(supabase, full);
        out.push(...sub);
      } else {
        out.push(full);
      }
    }
    if (data.length < LIST_PAGE) break;
    offset += data.length;
  }
  return out;
}

// ---------------- hash ----------------
export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ---------------- manifest ----------------
// { generatedAt: ISO, files: { [bucketPath]: { sha256, size } } }
export async function readManifest() {
  try {
    const txt = await fs.readFile(MANIFEST_PATH, 'utf8');
    const m = JSON.parse(txt);
    if (!m.files) m.files = {};
    return m;
  } catch (e) {
    if (e.code === 'ENOENT') return { generatedAt: null, files: {} };
    throw e;
  }
}

export async function writeManifest(manifest) {
  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

// ---------------- progress (linha única na mesma TTY) ----------------
export function progress(label, done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const line = `${label}: ${done}/${total} (${pct}%)`;
  if (process.stdout.isTTY) {
    process.stdout.write(`\r${line.padEnd(80)}`);
    if (done === total) process.stdout.write('\n');
  } else {
    if (done === total || done % 50 === 0) console.log(line);
  }
}

// ---------------- paralelização ----------------
// Roda `jobs` em paralelo com concorrência limitada. Devolve quando todos terminam.
export async function runWithConcurrency(items, worker, concurrency = PARALLEL) {
  let i = 0;
  let done = 0;
  const errors = [];
  const total = items.length;
  async function next() {
    while (true) {
      const idx = i++;
      if (idx >= total) return;
      try {
        await worker(items[idx], idx);
      } catch (e) {
        errors.push({ item: items[idx], error: e });
      }
      done++;
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, total) }, () => next());
  // Reporter
  const reportTimer = setInterval(() => progress(worker._label || 'progresso', done, total), 250);
  try {
    await Promise.all(runners);
  } finally {
    clearInterval(reportTimer);
    progress(worker._label || 'progresso', total, total);
  }
  return errors;
}

// ---------------- filtragem CLI ----------------
export function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

export function pathMatchesPrefix(p, prefixes) {
  if (!prefixes || prefixes.length === 0) return true;
  return prefixes.some(pref => p === pref || p.startsWith(pref + '/'));
}
