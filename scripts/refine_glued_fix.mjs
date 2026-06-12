// ============================================================
// Refino do fix dos cabeçalhos colados: remove os <br/> inseridos por
// FALSO POSITIVO — cabeçalhos que já estavam separados por um <br> COM
// atributos (ex.: <br data-soft="1"> do editor do admin), que o detector
// original não reconhecia como separador. Nesses tópicos o <br/> extra
// isolava o rótulo num parágrafo próprio com espaço sobrando.
//
// Reconstrói a partir do BACKUP (estado pré-fix): o conteúdo correto =
// backup + inserções APENAS nas posições da detecção corrigida. Depois
// remapeia offsets de grifos do estado ATUAL → CORRIGIDO (mesma lib,
// diff só-whitespace) e atualiza espelho + banco.
//
// Uso:
//   node scripts/refine_glued_fix.mjs <backupDir>            # dry-run
//   node scripts/refine_glued_fix.mjs <backupDir> --apply
// ============================================================
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, mergeContinuations, simulateTopicText,
  insertBreaks, buildOffsetMap, wsNorm,
} from './_glued_fix_lib.mjs';

const backupDir = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!backupDir) { console.error('uso: node scripts/refine_glued_fix.mjs <backupDir> [--apply]'); process.exit(1); }

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const filesDir = path.join(ROOT, backupDir, 'files');
const VOLS = fs.readdirSync(filesDir);

const fileWrites = new Map(); // abs path -> json corrigido
const topicMaps = new Map();  // vol/file#idx -> {mapPt,mapJa,oldPt,newPt,oldJa,newJa}
let topicsRefined = 0, brRemoved = 0, filesSkipped = 0, rejected = 0;

for (const vol of VOLS) {
  const bdir = path.join(filesDir, vol);
  for (const f of fs.readdirSync(bdir).filter(f => f.endsWith('.json'))) {
    const backupJson = JSON.parse(fs.readFileSync(path.join(bdir, f), 'utf8'));
    const curAbs = path.join(ROOT, '.local-edits', 'teachings', vol, f);
    const curJson = JSON.parse(fs.readFileSync(curAbs, 'utf8'));

    const flatBak = [], flatCur = [], flatFix = [];
    for (const th of backupJson.themes || []) for (const t of th.topics || []) flatBak.push(t);
    for (const th of curJson.themes || []) for (const t of th.topics || []) flatCur.push(t);
    if (flatBak.length !== flatCur.length) { filesSkipped++; console.log('SKIP (estrutura mudou):', vol, f); continue; }

    const changedIdx = new Set();
    for (let i = 0; i < flatBak.length; i++) {
      const fixT = { ...flatCur[i] };
      for (const field of ['content', 'content_pt', 'content_ptbr']) {
        if (!flatBak[i][field]) continue;
        const corrected = insertBreaks(flatBak[i][field]); // detecção CORRIGIDA sobre o backup
        if (corrected !== flatCur[i][field]) {
          // paranoia: o atual tem que ser o corrigido + <br/>s extras (i.e.,
          // diff de markup só de <br/>) — se o admin editou o arquivo depois
          // do push, o campo atual diverge de outro jeito → pula o arquivo
          const curStripped = (flatCur[i][field] || '').split('<br/>').join('');
          const corStripped = corrected.split('<br/>').join('');
          if (curStripped !== corStripped) { changedIdx.clear(); break; }
          fixT[field] = corrected;
          changedIdx.add(i);
          brRemoved += (flatCur[i][field].split('<br/>').length - 1) - (corrected.split('<br/>').length - 1);
        }
      }
      flatFix.push(fixT);
      if (flatFix.length !== i + 1) break; // saiu do loop interno por divergência
    }
    if (flatFix.length !== flatBak.length || !changedIdx.size) {
      if (flatFix.length !== flatBak.length) { filesSkipped++; console.log('SKIP (edição manual pós-push?):', vol, f); }
      continue;
    }

    const mergedCur = mergeContinuations(flatCur.map(t => ({ ...t })));
    const mergedFix = mergeContinuations(flatFix.map(t => ({ ...t })));
    let fileOk = true;
    const fileTopicMaps = [];
    for (let i = 0; i < mergedCur.length; i++) {
      let chainChanged = changedIdx.has(i);
      for (let k = i + 1; k < mergedCur.length && mergedCur[k]._mergedAway; k++) if (changedIdx.has(k)) chainChanged = true;
      if (mergedCur[i]._mergedAway || !chainChanged) continue;
      const oldPt = simulateTopicText(mergedCur, i, 'pt');
      const newPt = simulateTopicText(mergedFix, i, 'pt');
      const oldJa = simulateTopicText(mergedCur, i, 'ja');
      const newJa = simulateTopicText(mergedFix, i, 'ja');
      const mapPt = oldPt === newPt ? ((p) => p) : buildOffsetMap(oldPt, newPt);
      const mapJa = oldJa === newJa ? ((p) => p) : buildOffsetMap(oldJa, newJa);
      if (!mapPt || !mapJa) { fileOk = false; rejected++; console.log('REJ (diff não-ws):', vol, f, '#' + i); break; }
      fileTopicMaps.push([`${vol}/${f.replace(/\.json$/, '')}#${i}`, { mapPt, mapJa, oldPt, newPt, oldJa, newJa }]);
    }
    if (!fileOk) continue;
    for (const [k, v] of fileTopicMaps) topicMaps.set(k, v);
    topicsRefined += changedIdx.size;

    // grava de volta na ESTRUTURA original do arquivo atual
    let gi = 0;
    for (const th of curJson.themes || []) {
      for (const t of th.topics || []) {
        if (changedIdx.has(gi)) {
          for (const field of ['content', 'content_pt', 'content_ptbr']) {
            if (flatFix[gi][field] !== undefined) t[field] = flatFix[gi][field];
          }
        }
        gi++;
      }
    }
    fileWrites.set(curAbs, curJson);
  }
}

console.log(`arquivos a regravar: ${fileWrites.size} (pulados: ${filesSkipped}, tópicos rejeitados: ${rejected})`);
console.log(`tópicos refinados: ${topicsRefined}; <br/> removidos: ${brRemoved}`);

// ---------- remapeia grifos dos tópicos afetados ----------
let allH = [], from = 0;
for (;;) {
  const { data, error } = await supa.from('user_highlights')
    .select('id,user_id,volume,file,topic_index,start_char,end_char,text')
    .in('volume', VOLS).range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  allH.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
const plan = [], skipped = [];
for (const h of allH) {
  const tm = topicMaps.get(`${h.volume}/${h.file}#${h.topic_index}`);
  if (!tm) continue;
  const valid = h.start_char >= 0 && h.end_char > h.start_char;
  let done = false;
  for (const [oldT, newT, map, lang] of [[tm.oldPt, tm.newPt, tm.mapPt, 'pt'], [tm.oldJa, tm.newJa, tm.mapJa, 'ja']]) {
    if (!valid || oldT.slice(h.start_char, h.end_char) !== h.text) continue;
    const ns = map(h.start_char), ne = map(h.end_char);
    const slice = newT.slice(ns, ne);
    if (slice === h.text) plan.push({ id: h.id, newStart: ns, newEnd: ne });
    else if (wsNorm(slice) === wsNorm(h.text)) plan.push({ id: h.id, newStart: ns, newEnd: ne, newText: slice });
    else skipped.push(h.id);
    done = true; break;
  }
  if (!done) skipped.push(h.id);
}
console.log(`grifos a remapear: ${plan.length}; fora (já quebrados antes): ${skipped.length}`);

const { data: recs } = await supa.from('study_recommendations')
  .select('id,vol,file,topic_idx,excerpt_ranges,excerpt_start_char,excerpt_end_char')
  .in('vol', VOLS)
  .or('excerpt_ranges.not.is.null,excerpt_start_char.not.is.null');
const recPlan = [];
for (const r of recs || []) {
  const tm = topicMaps.get(`${r.vol}/${r.file}#${r.topic_idx}`);
  if (!tm) continue;
  const upd = { id: r.id };
  if (Array.isArray(r.excerpt_ranges)) upd.excerpt_ranges = r.excerpt_ranges.map(([s, e]) => [tm.mapPt(s), tm.mapPt(e)]);
  if (r.excerpt_start_char != null) { upd.excerpt_start_char = tm.mapPt(r.excerpt_start_char); upd.excerpt_end_char = tm.mapPt(r.excerpt_end_char); }
  recPlan.push(upd);
}
console.log(`recomendações a remapear: ${recPlan.length}`);

if (!APPLY) { console.log('\nDRY-RUN — nada gravado. Rode com --apply.'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const bdir2 = path.join(ROOT, '.local-edits', '_backup_glued_fix', stamp + '-refine');
fs.mkdirSync(bdir2, { recursive: true });
fs.writeFileSync(path.join(bdir2, 'plan.json'), JSON.stringify({ plan, recPlan, skipped }, null, 1));
fs.writeFileSync(path.join(bdir2, 'user_highlights_before.json'),
  JSON.stringify(allH.filter(h => topicMaps.has(`${h.volume}/${h.file}#${h.topic_index}`)), null, 1));
for (const [abs, json] of fileWrites) {
  const rel = path.relative(path.join(ROOT, '.local-edits', 'teachings'), abs);
  const dst = path.join(bdir2, 'files', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(abs, dst);
  fs.writeFileSync(abs, JSON.stringify(json, null, 4));
}
console.log(`arquivos gravados: ${fileWrites.size}; backup: ${path.relative(ROOT, bdir2)}`);

let ok = 0, err = 0;
for (const p of plan) {
  const upd = { start_char: p.newStart, end_char: p.newEnd };
  if (p.newText) upd.text = p.newText;
  const { error } = await supa.from('user_highlights').update(upd).eq('id', p.id);
  if (error) { err++; console.error('  ERRO', p.id, error.message); } else ok++;
}
console.log(`user_highlights: ${ok} ok, ${err} erros`);
let okR = 0, errR = 0;
for (const r of recPlan) {
  const { id, ...fields } = r;
  const { error } = await supa.from('study_recommendations').update(fields).eq('id', id);
  if (error) { errR++; console.error('  ERRO rec', id, error.message); } else okR++;
}
console.log(`study_recommendations: ${okR} ok, ${errR} erros`);
console.log('\nAgora: node scripts/storage-push.mjs --prefix=' + VOLS.join(',') + ' --confirm');
