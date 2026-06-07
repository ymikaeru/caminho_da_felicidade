// ============================================================
// retrad_fix_divider.mjs — restaura a linha divisória (<hr/>) que a
// retradução-paredão do Vol 1 perdeu entre as publicações.
//
// CONTEXTO: cada tópico (publicação) guarda no fim do content/content_ptbr um
// ` <hr/>\n ` que o leitor renderiza como divisória entre publicações. A
// retradução trocou content_ptbr e dropou esse <hr/> final (o JA, intocado,
// ainda o tem). Este script reanexa o <hr/> ao content_ptbr SÓ onde o JA
// (content) termina em <hr/> — assim espelha exatamente a estrutura original
// (o último tópico de cada arquivo, que não tem divisória, fica intocado).
//
// SEGURO POR PADRÃO: --dry-run é o default. Sem --apply, NÃO escreve nada.
//   - anti-clobber: só toca tópicos cujo content_ptbr vivo NÃO termina em <hr/>
//   - idempotente: rodar de novo não duplica
//   - pula continues_previous (fragmento que é mesclado ao raiz no render —
//     um <hr/> ali plantaria divisória no meio do texto)
//   - escopo = manifesto data/retrad_prev_index.json (os 617 retraduzidos)
//
// Uso:
//   node scripts/retrad_fix_divider.mjs                 # DRY-RUN (relatório)
//   node scripts/retrad_fix_divider.mjs --only=kuni3.html.json   # 1 arquivo
//   node scripts/retrad_fix_divider.mjs --apply         # grava no Storage
// Depois de --apply: `npm run storage:pull` p/ re-sincronizar o espelho.
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, makeClient, BUCKET, parseArgs } from './_storage_sync_lib.mjs';

const ROOT = process.cwd();
const HR_SUFFIX = ' <hr/>\n ';
const endsWithHr = (s) => /<hr\s*\/?>\s*$/i.test((s || '').trim());

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
  const only = args.only || null;       // ex.: --only=kuni3.html.json
  const volFilter = args.vol || null;

  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'retrad_prev_index.json'), 'utf8'));
  let sel = manifest;
  if (only) sel = sel.filter((x) => x.file === only);
  if (volFilter) sel = sel.filter((x) => x.vol === volFilter);

  // agrupa por arquivo: 1 download/upload por arquivo (não por tópico)
  const byFile = {};
  for (const it of sel) (byFile[`${it.vol}/${it.file}`] ||= []).push(it);
  const fileKeys = Object.keys(byFile);

  console.log(`${apply ? '🔴 APPLY' : '🟢 DRY-RUN'} · arquivos=${fileKeys.length} · tópicos no escopo=${sel.length}${only ? ` · only=${only}` : ''}${volFilter ? ` · vol=${volFilter}` : ''}`);
  if (!fileKeys.length) { console.log('Nada no escopo.'); return; }

  let filesChanged = 0, topicsFixed = 0, skippedHasHr = 0, skippedNoJaHr = 0, skippedCont = 0, errs = 0;
  const log = [];

  for (const fk of fileKeys) {
    let live;
    try { live = await downloadJson(supabase, fk); }
    catch (e) { errs++; console.log(`  ✗ ${fk}: ${e.message}`); continue; }

    let fileTouched = false;
    for (const it of byFile[fk]) {
      const topic = live?.themes?.[it.theme_idx]?.topics?.[it.topic_idx];
      if (!topic) { errs++; log.push({ fk, t: it.topic_idx, status: 'tópico-sumiu' }); continue; }

      if (topic.continues_previous) { skippedCont++; continue; }      // não plantar <hr/> no meio do raiz
      if (!endsWithHr(topic.content)) { skippedNoJaHr++; continue; }   // JA não tem divisória aqui (ex.: último tópico)
      if (endsWithHr(topic.content_ptbr)) { skippedHasHr++; continue; } // já corrigido (idempotente)

      // rtrim + remove <br/> finais órfãos, depois anexa o sufixo canônico
      let c = (topic.content_ptbr || '').replace(/\s+$/, '').replace(/(?:<br\s*\/?>\s*)+$/i, '').replace(/\s+$/, '');
      topic.content_ptbr = c + HR_SUFFIX;
      topicsFixed++; fileTouched = true;
      log.push({ fk, t: it.topic_idx, status: 'fix' });
    }

    if (fileTouched) {
      filesChanged++;
      if (apply) {
        const blob = new Blob([JSON.stringify(live, null, 2)], { type: 'application/json' });
        const { error } = await supabase.storage.from(BUCKET)
          .upload(fk, blob, { upsert: true, contentType: 'application/json', cacheControl: '0' });
        if (error) { errs++; console.log(`  ✗ upload ${fk}: ${error.message}`); }
        else console.log(`  ✓ ${fk}`);
      } else {
        console.log(`  ~ ${fk} (${byFile[fk].filter((it) => log.some((l) => l.fk === fk && l.t === it.topic_idx && l.status === 'fix')).length} tópico(s))`);
      }
    }
  }

  console.log(`\n[${apply ? 'aplicado' : 'dry-run'}] arquivos alterados=${filesChanged} · tópicos com <hr/>=${topicsFixed}`);
  console.log(`pulados → já-tinha-hr=${skippedHasHr} · JA-sem-hr(último/sem-divisória)=${skippedNoJaHr} · continues_previous=${skippedCont} · erros=${errs}`);
  if (!apply) console.log('\nRode de novo com --apply para gravar no Storage.');
  else console.log('\nDepois: `npm run storage:pull` p/ re-sincronizar o espelho.');
}

main().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
