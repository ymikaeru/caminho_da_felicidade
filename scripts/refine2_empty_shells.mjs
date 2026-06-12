// ============================================================
// Refino 2: remove "cascas vazias" de rótulo — blocos <b><font color…>
// SEM texto (ex.: <b><font color="#0000ff"><i></i></font></b>), sobras de
// edições antigas no editor do admin. Quando coladas entre o rótulo e a
// resposta junto de um <br/>, o normalizador quebrava parágrafo após o
// rótulo e deixava um <br> órfão antes da resposta (linha em branco).
// Remove a casca + UM <br> adjacente (preferindo o seguinte). Tags e <br>
// não têm texto → diff renderizado é só-whitespace → mesmo remap de
// offsets do fix principal.
//
// Uso: node scripts/refine2_empty_shells.mjs [--apply]
// ============================================================
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, mergeContinuations, simulateTopicText, buildOffsetMap, wsNorm,
} from './_glued_fix_lib.mjs';

const APPLY = process.argv.includes('--apply');
const VOLS = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const SHELL = String.raw`(?:<b[^>]*>\s*<font[^>]*>\s*(?:<i>\s*<\/i>\s*|\s)*<\/font>\s*<\/b>|<font[^>]*>\s*<b[^>]*>\s*(?:<i>\s*<\/i>\s*|\s)*<\/b>\s*<\/font>)`;
const SHELL_BR_AFTER = new RegExp(SHELL + String.raw`\s*<br\s*\/?>`, 'gi');
const BR_SHELL_BEFORE = new RegExp(String.raw`<br\s*\/?>\s*` + SHELL, 'gi');
const SHELL_ALONE = new RegExp(SHELL, 'gi');

function cleanShells(html) {
  let out = html.replace(SHELL_BR_AFTER, '');
  out = out.replace(BR_SHELL_BEFORE, '');
  out = out.replace(SHELL_ALONE, '');
  return out;
}

const fileWrites = new Map();
const topicMaps = new Map();
let topicsChanged = 0, rejected = 0;

for (const vol of VOLS) {
  const dir = path.join(ROOT, '.local-edits', 'teachings', vol);
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const abs = path.join(dir, f);
    const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const flatCur = [], flatFix = [];
    const changedIdx = new Set();
    let gi = 0;
    for (const th of json.themes || []) {
      for (const t of th.topics || []) {
        const fixT = { ...t };
        for (const field of ['content', 'content_pt', 'content_ptbr']) {
          if (!t[field]) continue;
          const nv = cleanShells(t[field]);
          if (nv !== t[field]) { fixT[field] = nv; changedIdx.add(gi); }
        }
        flatCur.push({ ...t }); flatFix.push(fixT); gi++;
      }
    }
    if (!changedIdx.size) continue;

    const mergedCur = mergeContinuations(flatCur.map(t => ({ ...t })));
    const mergedFix = mergeContinuations(flatFix.map(t => ({ ...t })));
    let fileOk = true;
    const maps = [];
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
      maps.push([`${vol}/${f.replace(/\.json$/, '')}#${i}`, { mapPt, mapJa, oldPt, newPt, oldJa, newJa }]);
    }
    if (!fileOk) continue;
    for (const [k, v] of maps) topicMaps.set(k, v);
    topicsChanged += changedIdx.size;
    console.log('limpa:', vol, f, '— tópicos', [...changedIdx].join(','));

    gi = 0;
    for (const th of json.themes || []) {
      for (const t of th.topics || []) {
        if (changedIdx.has(gi)) {
          for (const field of ['content', 'content_pt', 'content_ptbr']) {
            if (flatFix[gi][field] !== undefined) t[field] = flatFix[gi][field];
          }
        }
        gi++;
      }
    }
    fileWrites.set(abs, json);
  }
}
console.log(`\narquivos: ${fileWrites.size}; tópicos: ${topicsChanged}; rejeitados: ${rejected}`);

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
  for (const [oldT, newT, map] of [[tm.oldPt, tm.newPt, tm.mapPt], [tm.oldJa, tm.newJa, tm.mapJa]]) {
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
console.log(`grifos a remapear: ${plan.length}; fora: ${skipped.length}`);

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
const bdir = path.join(ROOT, '.local-edits', '_backup_glued_fix', stamp + '-shells');
fs.mkdirSync(bdir, { recursive: true });
fs.writeFileSync(path.join(bdir, 'plan.json'), JSON.stringify({ plan, recPlan, skipped }, null, 1));
fs.writeFileSync(path.join(bdir, 'user_highlights_before.json'),
  JSON.stringify(allH.filter(h => topicMaps.has(`${h.volume}/${h.file}#${h.topic_index}`)), null, 1));
for (const [abs, json] of fileWrites) {
  const rel = path.relative(path.join(ROOT, '.local-edits', 'teachings'), abs);
  const dst = path.join(bdir, 'files', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(abs, dst);
  fs.writeFileSync(abs, JSON.stringify(json, null, 4));
}
console.log(`arquivos gravados: ${fileWrites.size}; backup: ${path.relative(ROOT, bdir)}`);

let ok = 0, err = 0;
for (const p of plan) {
  const upd = { start_char: p.newStart, end_char: p.newEnd };
  if (p.newText) upd.text = p.newText;
  const { error } = await supa.from('user_highlights').update(upd).eq('id', p.id);
  if (error) { err++; console.error('  ERRO', p.id, error.message); } else ok++;
}
console.log(`user_highlights: ${ok} ok, ${err} erros`);
for (const r of recPlan) {
  const { id, ...fields } = r;
  const { error } = await supa.from('study_recommendations').update(fields).eq('id', id);
  if (error) console.error('  ERRO rec', id, error.message);
}
console.log('\nAgora: node scripts/storage-push.mjs --prefix=' + VOLS.join(',') + ' --confirm');
