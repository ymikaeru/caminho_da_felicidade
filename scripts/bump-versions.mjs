#!/usr/bin/env node
/**
 * bump-versions.mjs — gerencia o cache-bust `?v=N` dos assets em TODOS os HTMLs.
 *
 * O padrão do projeto é versionar manualmente (`js/nav.js?v=52`), mas o bump
 * manual em 20+ HTMLs dessincroniza (ex.: styles.min.css?v=155 no index e
 * ?v=157 no reader → o navegador baixa o MESMO arquivo duas vezes).
 *
 * Uso:
 *   node scripts/bump-versions.mjs --list                 # mostra versões e divergências
 *   node scripts/bump-versions.mjs sync <asset...>        # alinha todos à MAIOR versão existente
 *   node scripts/bump-versions.mjs bump <asset...>        # alinha e incrementa (+1) em todos
 *   node scripts/bump-versions.mjs set <asset> <N>        # força versão N em todos
 *
 * <asset> é o nome do arquivo (ex.: styles.min.css, highlights.js) — o caminho
 * (css/, js/, ../css/) é resolvido automaticamente.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDE_DIRS = new Set(['node_modules', 'Backup', 'backups', '.local-edits', '.git', '.agent', '.claude', 'docs', 'ComandosUteis']);

function findHtmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findHtmlFiles(full));
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

// referência: href/src=".../<asset>?v=N" — o nome precisa casar inteiro
// (lookbehind impede que "highlights.js" case "poetry-highlights.js")
function assetRegex(asset) {
  const esc = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w.-])((?:[\\w.-]+/)*${esc})\\?v=(\\d+)`, 'g');
}

function scan(asset, files) {
  const re = assetRegex(asset);
  const refs = []; // { file, version }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) refs.push({ file, version: Number(m[2]) });
  }
  return refs;
}

function apply(asset, files, target) {
  const re = assetRegex(asset);
  let changed = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const next = text.replace(re, (_, path) => `${path}?v=${target}`);
    if (next !== text) {
      writeFileSync(file, next);
      changed++;
    }
  }
  return changed;
}

const files = findHtmlFiles(ROOT);
const args = process.argv.slice(2);

if (!args.length || args[0] === '--list') {
  // levanta todos os assets versionados e aponta divergências
  const re = /([\w./-]+\.(?:js|css|json))\?v=(\d+)/g;
  const byAsset = new Map();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      const base = m[1].split('/').pop();
      if (!byAsset.has(base)) byAsset.set(base, new Map());
      const vmap = byAsset.get(base);
      const v = Number(m[2]);
      if (!vmap.has(v)) vmap.set(v, []);
      vmap.get(v).push(file.slice(ROOT.length + 1));
    }
  }
  let divergent = 0;
  for (const [asset, vmap] of [...byAsset].sort()) {
    const versions = [...vmap.keys()].sort((a, b) => a - b);
    if (versions.length > 1) {
      divergent++;
      console.log(`✗ ${asset}: versões ${versions.join(', ')}`);
      for (const v of versions) console.log(`    v=${v}: ${vmap.get(v).join(', ')}`);
    }
  }
  if (!divergent) console.log('✓ Todos os assets com versão única.');
  else console.log(`\n${divergent} asset(s) divergente(s). Use: node scripts/bump-versions.mjs sync <asset>`);
  process.exit(0);
}

const cmd = args[0];
if (cmd === 'set') {
  const [, asset, n] = args;
  if (!asset || !/^\d+$/.test(n ?? '')) { console.error('Uso: set <asset> <N>'); process.exit(1); }
  const changed = apply(asset, files, Number(n));
  console.log(`${asset} → v=${n} em ${changed} arquivo(s).`);
} else if (cmd === 'sync' || cmd === 'bump') {
  const assets = args.slice(1);
  if (!assets.length) { console.error(`Uso: ${cmd} <asset...>`); process.exit(1); }
  for (const asset of assets) {
    const refs = scan(asset, files);
    if (!refs.length) { console.warn(`(aviso) nenhuma referência a ${asset}?v= encontrada`); continue; }
    const max = Math.max(...refs.map((r) => r.version));
    const target = cmd === 'bump' ? max + 1 : max;
    const changed = apply(asset, files, target);
    console.log(`${asset}: v máx ${max} → v=${target} em ${changed} arquivo(s) (${refs.length} referência(s)).`);
  }
} else {
  console.error(`Comando desconhecido: ${cmd}. Use --list, sync, bump ou set.`);
  process.exit(1);
}
