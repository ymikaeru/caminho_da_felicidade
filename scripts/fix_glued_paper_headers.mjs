// ============================================================
// Fix "cabeçalho de papel colado": insere <br/> antes dos blocos
// 信者の質問/明主様御垂示 (e traduções PT — âncora é a COR do <font>,
// #990000/#0000ff/#660000, igual nos dois idiomas) que estão colados
// no fim da linha anterior, nos 4 volumes mioshiec.
//
// Como offsets de grifos (user_highlights) e trechos recomendados
// (study_recommendations.excerpt_ranges) contam o TEXTO RENDERIZADO
// (inclusive whitespace), o script:
//   1) simula o render real (lib _glued_fix_lib) antes/depois;
//   2) exige que a mudança no texto seja SÓ-INSERÇÃO (two-pointer);
//      tópico que violar fica de fora (não recebe <br/>);
//   3) remapeia offsets dos grifos validados; re-ancora por busca de
//      texto os que já estavam quebrados (drift legado) quando o texto
//      salvo ocorre exatamente 1 vez; o resto fica intocado.
//
// Uso:
//   node scripts/fix_glued_paper_headers.mjs              # relatório (dry-run)
//   node scripts/fix_glued_paper_headers.mjs --apply      # grava espelho + DB
//
// Depois do --apply: node scripts/storage-push.mjs --prefix=mioshiec1,mioshiec2,mioshiec3,mioshiec4 --confirm
// ============================================================
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, htmlToText, mergeContinuations, simulateTopicText,
  gluedHeaderPositions, insertBreaks, buildOffsetMap, wsNorm,
} from './_glued_fix_lib.mjs';

const APPLY = process.argv.includes('--apply');
const VOLS = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ---------- 1) calcula as mudanças por arquivo/tópico ----------
// fileChanges: vol/file -> { json, changedTopics: Map(idxGlobal -> camposNovos) }
// topicMaps:   vol/file#idx -> { mapPt, mapJa, oldPt, newPt, oldJa, newJa }
const fileChanges = new Map();
const topicMaps = new Map();
const stats = {
  filesChanged: 0, topicsChanged: 0, insertedJa: 0, insertedPt: 0,
  topicsRejected: [],          // mudança não é só-inserção → revertido
  cmpEqBefore: 0, cmpEqAfter: 0, cmpDegraded: [], cmpImproved: 0,
};

// contagem de segmentos do modo comparação (reader-render l.499)
const segCount = (raw) => raw.split(/<br\s*\/?>[\s\n]*/gi).filter(s => s.trim()).length;

for (const vol of VOLS) {
  const dir = path.join(ROOT, '.local-edits', 'teachings', vol);
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const json = JSON.parse(raw);
    const flatOld = [];   // tópicos originais (rasos)
    const flatNew = [];   // tópicos com campos corrigidos
    const changedIdx = new Map();
    let gIdx = 0;
    for (const th of json.themes || []) {
      for (const t of th.topics || []) {
        const fixed = { ...t };
        let changed = false;
        for (const field of ['content', 'content_pt', 'content_ptbr']) {
          if (!t[field]) continue;
          const nv = insertBreaks(t[field]);
          if (nv !== t[field]) {
            fixed[field] = nv;
            changed = true;
            const n = gluedHeaderPositions(t[field]).length;
            if (field === 'content') stats.insertedJa += n; else stats.insertedPt += n;
          }
        }
        flatOld.push({ ...t });
        flatNew.push(fixed);
        if (changed) changedIdx.set(gIdx, fixed);
        gIdx++;
      }
    }
    if (!changedIdx.size) continue;

    const mergedOld = mergeContinuations(flatOld.map(t => ({ ...t })));
    const mergedNew = mergeContinuations(flatNew.map(t => ({ ...t })));

    // valida só-inserção por tópico RAIZ renderizável; rejeita o tópico
    // (e seus fragmentos) se o diff não for puro-inserção em algum idioma
    const rejected = new Set();
    for (let i = 0; i < mergedOld.length; i++) {
      // tópico raiz cuja cadeia contém alguma mudança?
      // (fragmentos mesclados re-renderizam dentro do raiz)
      let chainChanged = changedIdx.has(i);
      for (let k = i + 1; k < mergedOld.length && mergedOld[k]._mergedAway; k++) {
        if (changedIdx.has(k)) chainChanged = true;
      }
      if (mergedOld[i]._mergedAway || !chainChanged) continue;

      const oldPt = simulateTopicText(mergedOld, i, 'pt');
      const newPt = simulateTopicText(mergedNew, i, 'pt');
      const oldJa = simulateTopicText(mergedOld, i, 'ja');
      const newJa = simulateTopicText(mergedNew, i, 'ja');
      const mapPt = oldPt === newPt ? ((p) => p) : buildOffsetMap(oldPt, newPt);
      const mapJa = oldJa === newJa ? ((p) => p) : buildOffsetMap(oldJa, newJa);
      if (!mapPt || !mapJa) {
        rejected.add(i);
        for (let k = i + 1; k < mergedOld.length && mergedOld[k]._mergedAway; k++) rejected.add(k);
        stats.topicsRejected.push(`${vol}/${f}#${i}${!mapPt ? ' [pt]' : ''}${!mapJa ? ' [ja]' : ''}`);
        continue;
      }
      topicMaps.set(`${vol}/${f.replace(/\.json$/, '')}#${i}`, { mapPt, mapJa, oldPt, newPt, oldJa, newJa });

      // impacto no modo comparação (pareamento por contagem de segmentos)
      const ptOldRaw = mergedOld[i].content_ptbr || mergedOld[i].content_pt || mergedOld[i].content || '';
      const ptNewRaw = mergedNew[i].content_ptbr || mergedNew[i].content_pt || mergedNew[i].content || '';
      const eqB = segCount(mergedOld[i].content || '') === segCount(ptOldRaw);
      const eqA = segCount(mergedNew[i].content || '') === segCount(ptNewRaw);
      if (eqB) stats.cmpEqBefore++;
      if (eqA) stats.cmpEqAfter++;
      if (eqB && !eqA) stats.cmpDegraded.push(`${vol}/${f}#${i}`);
      if (!eqB && eqA) stats.cmpImproved++;
    }
    for (const i of rejected) changedIdx.delete(i);
    if (!changedIdx.size) continue;

    fileChanges.set(`${vol}/${f}`, { json, changedIdx });
    stats.filesChanged++;
    stats.topicsChanged += changedIdx.size;
  }
}

console.log(`arquivos a mudar: ${stats.filesChanged}`);
console.log(`tópicos a mudar:  ${stats.topicsChanged}`);
console.log(`<br/> inseridos:  JA=${stats.insertedJa}  PT=${stats.insertedPt}`);
console.log(`tópicos REJEITADOS (diff não é só-inserção): ${stats.topicsRejected.length}`);
stats.topicsRejected.slice(0, 15).forEach(s => console.log('  REJ', s));
console.log(`modo comparação: pareáveis antes=${stats.cmpEqBefore} depois=${stats.cmpEqAfter} (degradados=${stats.cmpDegraded.length}, melhorados=${stats.cmpImproved})`);

// ---------- 2) plano de migração dos grifos ----------
let allH = [], from = 0;
for (;;) {
  const { data, error } = await supa.from('user_highlights')
    .select('id,user_id,volume,file,topic_index,start_char,end_char,text,color')
    .in('volume', VOLS).range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  allH.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

const plan = [];            // { id, newStart, newEnd, mode }
const skipped = [];         // { key, reason }
for (const h of allH) {
  const key = `${h.volume}/${h.file}#${h.topic_index}`;
  const tm = topicMaps.get(key);
  if (!tm) continue; // tópico não muda — nada a fazer
  const { mapPt, mapJa, oldPt, newPt, oldJa, newJa } = tm;
  const valid = h.start_char >= 0 && h.end_char > h.start_char;

  let done = false;
  for (const [oldT, newT, map, lang] of [[oldPt, newPt, mapPt, 'pt'], [oldJa, newJa, mapJa, 'ja']]) {
    if (!valid || oldT.slice(h.start_char, h.end_char) !== h.text) continue;
    const ns = map(h.start_char), ne = map(h.end_char);
    const slice = newT.slice(ns, ne);
    if (slice === h.text) {
      plan.push({ id: h.id, key, newStart: ns, newEnd: ne, mode: `remap-${lang}` });
    } else if (wsNorm(slice) === wsNorm(h.text)) {
      // grifo atravessa um run de whitespace substituído (' '→'\n'):
      // mesmo trecho visual; atualiza também o text salvo
      plan.push({ id: h.id, key, newStart: ns, newEnd: ne, newText: slice, mode: `remap-${lang}-ws` });
    } else {
      skipped.push({ key, reason: `remap-${lang} verificação falhou` });
    }
    done = true; break;
  }
  if (done) continue;
  // drift legado (já não bate com o render atual): re-ancora se o texto
  // salvo ocorrer exatamente 1 vez no texto novo
  if (h.text && h.text.length >= 8) {
    for (const [txt, mode] of [[newPt, 'reanchor-pt'], [newJa, 'reanchor-ja']]) {
      const first = txt.indexOf(h.text);
      if (first >= 0 && txt.indexOf(h.text, first + 1) < 0) {
        plan.push({ id: h.id, key, newStart: first, newEnd: first + h.text.length, mode });
        break;
      }
    }
    if (plan.length && plan[plan.length - 1].id === h.id) continue;
  }
  skipped.push({ key, reason: valid ? 'drift legado, texto não-único/não encontrado' : 'range inválido no banco' });
}
const byMode = {};
for (const p of plan) byMode[p.mode] = (byMode[p.mode] || 0) + 1;
console.log(`\ngrifos nos tópicos alterados: ${plan.length + skipped.length}`);
console.log(`  migráveis: ${plan.length} ${JSON.stringify(byMode)}`);
console.log(`  intocados: ${skipped.length}`);
const reasons = {};
for (const s of skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
console.log('  motivos:', JSON.stringify(reasons));

// ---------- 3) trechos recomendados ----------
const { data: recs, error: recErr } = await supa.from('study_recommendations')
  .select('id,vol,file,topic_idx,excerpt_ranges,excerpt_start_char,excerpt_end_char')
  .in('vol', VOLS)
  .or('excerpt_ranges.not.is.null,excerpt_start_char.not.is.null');
if (recErr) { console.error(recErr); process.exit(1); }
const recPlan = [];
for (const r of recs) {
  const tm = topicMaps.get(`${r.vol}/${r.file}#${r.topic_idx}`);
  if (!tm) continue;
  // excerpts são criados dos destaques do admin no modo PT
  const upd = { id: r.id };
  if (Array.isArray(r.excerpt_ranges)) {
    upd.excerpt_ranges = r.excerpt_ranges.map(([s, e]) => [tm.mapPt(s, false), tm.mapPt(e, true)]);
  }
  if (r.excerpt_start_char != null) {
    upd.excerpt_start_char = tm.mapPt(r.excerpt_start_char, false);
    upd.excerpt_end_char = tm.mapPt(r.excerpt_end_char, true);
  }
  recPlan.push(upd);
}
console.log(`recomendações com trecho a remapear: ${recPlan.length}`);

if (!APPLY) {
  console.log('\nDRY-RUN — nada gravado. Rode com --apply para executar.');
  process.exit(0);
}

// ---------- 4) APPLY: backup + grava espelho + atualiza DB ----------
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const bdir = path.join(ROOT, '.local-edits', '_backup_glued_fix', stamp);
fs.mkdirSync(bdir, { recursive: true });
fs.writeFileSync(path.join(bdir, 'user_highlights_before.json'),
  JSON.stringify(allH.filter(h => topicMaps.has(`${h.volume}/${h.file}#${h.topic_index}`)), null, 1));
fs.writeFileSync(path.join(bdir, 'study_recommendations_before.json'), JSON.stringify(recs, null, 1));
fs.writeFileSync(path.join(bdir, 'plan.json'), JSON.stringify({ plan, recPlan, skipped }, null, 1));

let filesWritten = 0;
for (const [key, { json, changedIdx }] of fileChanges) {
  const [vol, ...rest] = key.split('/');
  const fname = rest.join('/');
  const abs = path.join(ROOT, '.local-edits', 'teachings', vol, fname);
  // backup do original
  const bsub = path.join(bdir, 'files', vol);
  fs.mkdirSync(bsub, { recursive: true });
  fs.copyFileSync(abs, path.join(bsub, fname));
  // aplica nos tópicos certos (mesma ordem de varredura)
  let gIdx = 0;
  for (const th of json.themes || []) {
    for (const t of th.topics || []) {
      const fixed = changedIdx.get(gIdx);
      if (fixed) {
        for (const field of ['content', 'content_pt', 'content_ptbr']) {
          if (fixed[field] !== undefined) t[field] = fixed[field];
        }
      }
      gIdx++;
    }
  }
  fs.writeFileSync(abs, JSON.stringify(json, null, 4));
  filesWritten++;
}
console.log(`\narquivos gravados no espelho: ${filesWritten}`);
console.log(`backup em: ${path.relative(ROOT, bdir)}`);

let okH = 0, errH = 0;
for (const p of plan) {
  const upd = { start_char: p.newStart, end_char: p.newEnd };
  if (p.newText) upd.text = p.newText;
  const { error } = await supa.from('user_highlights')
    .update(upd)
    .eq('id', p.id);
  if (error) { errH++; console.error('  ERRO highlight', p.id, error.message); }
  else okH++;
}
console.log(`user_highlights atualizados: ${okH} (erros: ${errH})`);

let okR = 0, errR = 0;
for (const r of recPlan) {
  const { id, ...fields } = r;
  const { error } = await supa.from('study_recommendations').update(fields).eq('id', id);
  if (error) { errR++; console.error('  ERRO rec', id, error.message); }
  else okR++;
}
console.log(`study_recommendations atualizadas: ${okR} (erros: ${errR})`);
console.log('\nAgora publique: node scripts/storage-push.mjs --prefix=' + VOLS.join(',') + ' --confirm');
