#!/usr/bin/env node
/**
 * build_titles_index.mjs — gera o índice ENXUTO de títulos por-tópico que
 * alimenta o modo "Título" da busca (client-side, determinístico).
 *
 * Fonte: .local-edits/teachings/search_index_mioshiecN.json (campo `t` = título
 *        real do tópico, `tj` = título JA; `c` = conteúdo pesado, DESCARTADO).
 * Saída: site_data/titles_index_mioshiecN.json — registros { f, i, t, tj }.
 *        (o volume está implícito no nome do arquivo; servido estático, ~330 KB/vol)
 *
 * Por que existe: nas publicações-contêiner ("Coletânea de fragmentos..."), o
 * title_pt do servidor é o NOME DO CONTÊINER — o título real de cada ensinamento
 * só existe aqui (campo `t`). Sem este índice, "Título" não acha esses ensinamentos.
 *
 * Uso:  node scripts/build_titles_index.mjs
 * REGENERAR sempre que o search_index mudar (após reprocessar ensinamentos),
 * depois commitar os site_data/titles_index_*.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOLS = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];
const SRC_DIR = join(ROOT, '.local-edits', 'teachings');
const OUT_DIR = join(ROOT, 'site_data');

let totalIn = 0, totalOut = 0;
for (const vol of VOLS) {
  const srcPath = join(SRC_DIR, `search_index_${vol}.json`);
  if (!existsSync(srcPath)) {
    console.warn(`! ${srcPath} ausente — pulei ${vol} (rode storage:pull?)`);
    continue;
  }
  const rows = JSON.parse(readFileSync(srcPath, 'utf8'));
  // Projeção enxuta: só o necessário pro match e exibição do modo Título.
  const slim = rows.map(r => {
    const o = { f: r.f, i: r.i, t: r.t || '' };
    if (r.tj) o.tj = r.tj;
    return o;
  });
  const outPath = join(OUT_DIR, `titles_index_${vol}.json`);
  const json = JSON.stringify(slim);
  writeFileSync(outPath, json, 'utf8');
  const inKb = (readFileSync(srcPath).length / 1024).toFixed(0);
  const outKb = (Buffer.byteLength(json) / 1024).toFixed(0);
  totalIn += Number(inKb); totalOut += Number(outKb);
  console.log(`✓ ${vol}: ${rows.length} tópicos — ${inKb} KB → ${outKb} KB  (site_data/titles_index_${vol}.json)`);
}
console.log(`\nTotal: ${totalIn} KB → ${totalOut} KB`);
