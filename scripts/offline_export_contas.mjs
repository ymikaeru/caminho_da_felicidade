#!/usr/bin/env node
// ============================================================
// offline_export_contas — copia da nuvem as CONTAS dos membros e os dados
// pessoais de leitura (grifos, salvos, pastas, lidos, posição), para o
// pacote offline poder oferecer "entrar com a própria conta".
//
// Saída (fora do git deste repositório): .local-edits/offline-contas/
//   contas.json          { email: { id, hash, role, lang, name, perms } }
//   nuvem/<user_id>.json { tabela: [linhas] }
//
// ⚠ DADOS SENSÍVEIS. contas.json leva o hash bcrypt da senha real de cada
// membro (é o que permite usar a MESMA senha do site). O servidor.py nunca
// entrega esse arquivo pela rede, mas quem tiver a PASTA do pacote tem os
// hashes. Trate o pacote e o repositório privado como confidenciais.
//
// Precisa de SUPABASE_DB_URL no .env.local e do `psql` no PATH.
// Uso:  node scripts/offline_export_contas.mjs
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTAS_DIR = path.join(ROOT, '.local-edits', 'offline-contas');

// Tabelas pessoais (todas têm user_id). As que não existirem no banco são puladas.
export const USER_TABLES = ['user_highlights', 'synced_favorites', 'favorite_folders', 'read_marks', 'reading_positions'];

async function dbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  try {
    const txt = await fs.readFile(path.join(ROOT, '.env.local'), 'utf8');
    const m = txt.match(/^SUPABASE_DB_URL\s*=\s*(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* sem .env.local */ }
  throw new Error('Falta SUPABASE_DB_URL (no .env.local ou no ambiente).');
}

function psql(url, sql) {
  return execFileSync('psql', [url, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8', maxBuffer: 1 << 30, env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
  }).trim();
}

export async function exportContas({ log = console.log } = {}) {
  const url = await dbUrl();

  const existing = psql(url,
    `select coalesce(string_agg(table_name, ','), '') from information_schema.tables
     where table_schema = 'public' and table_name in (${USER_TABLES.map(t => `'${t}'`).join(',')})`)
    .split(',').filter(Boolean);

  // Um único documento JSON: evita depender de separadores do psql.
  const parts = [
    `'users', (select coalesce(json_agg(json_build_object(
        'id', u.id, 'email', lower(u.email), 'hash', u.encrypted_password, 'profile', to_jsonb(p))), '[]'::json)
      from auth.users u left join public.user_profiles p on p.id = u.id
      where u.email is not null and coalesce(u.encrypted_password, '') <> ''
        and u.deleted_at is null and (u.banned_until is null or u.banned_until < now()))`,
    `'user_permissions', (select coalesce(json_agg(json_build_object(
        'user_id', t.user_id, 'volume', t.volume, 'files', t.files)), '[]'::json) from public.user_permissions t)`,
    ...existing.map(t => `'${t}', (select coalesce(json_agg(to_jsonb(t)), '[]'::json) from public.${t} t)`),
  ];
  const doc = JSON.parse(psql(url, `select json_build_object(${parts.join(', ')})`));

  const contas = {};
  const ids = new Set();
  for (const u of doc.users) {
    if (!/^\$2[aby]\$\d\d\$/.test(u.hash || '')) continue;      // só bcrypt (login por senha)
    const p = u.profile || {};
    contas[u.email] = {
      id: u.id,
      hash: u.hash,
      role: p.role || 'member',
      lang: p.preferred_lang || null,
      name: p.name || p.full_name || p.display_name || '',
      perms: doc.user_permissions.filter(r => r.user_id === u.id).map(r => ({ volume: r.volume, files: r.files })),
    };
    ids.add(u.id);
  }

  const perUser = new Map([...ids].map(id => [id, {}]));
  const totals = {};
  for (const t of existing) {
    totals[t] = 0;
    for (const row of doc[t] || []) {
      const bag = perUser.get(row.user_id);
      if (!bag) continue;
      (bag[t] ||= []).push(row);
      totals[t]++;
    }
  }

  await fs.rm(CONTAS_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(CONTAS_DIR, 'nuvem'), { recursive: true });
  await fs.writeFile(path.join(CONTAS_DIR, 'contas.json'), JSON.stringify(contas));
  for (const [id, bag] of perUser) {
    await fs.writeFile(path.join(CONTAS_DIR, 'nuvem', `${id}.json`), JSON.stringify(bag));
  }
  await fs.writeFile(path.join(CONTAS_DIR, 'info.json'),
    JSON.stringify({ exportedAt: new Date().toISOString(), contas: ids.size, tabelas: totals }, null, 2));

  log(`     ${ids.size} contas; ` + Object.entries(totals).map(([t, n]) => `${t}: ${n}`).join(', '));
  return { contas: ids.size, totals };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  exportContas().catch(e => { console.error('✖ ' + e.message.split('\n')[0]); process.exit(1); });
}
