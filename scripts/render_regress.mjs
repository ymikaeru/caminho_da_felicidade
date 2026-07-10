// ============================================================
// render_regress.mjs — regressão de renderização do leitor (A/B de motores).
//
// Compara DUAS versões de js/reader-content.js sobre o corpus inteiro do
// espelho local (.local-edits/teachings — zero egress) e classifica cada
// tópico em tiers:
//   T1  saída HTML byte-idêntica
//   T2  HTML difere, textContent idêntico (só markup — grifos intactos)
//   T3  textContent difere SÓ em whitespace (curável pela cura por snapshot)
//   T4  TEXTO VISÍVEL difere — PROIBIDO (exit 1, salvo --allow-t4)
//
// Lanes (espelham os caminhos reais de render):
//   topic     pipeline completo do leitor: mergeContinuations + header +
//             _normalizeContent com marked REAL (via _glued_fix_lib.mjs, que
//             porta reader-render.js verbatim). É a régua ABI dos grifos:
//             o textContent de #topic-N. PT e JA.
//   nomarked  _normalizeContent puro sem marked (caminho _fallbackFormat),
//             campos content + content_pt — condições idênticas ao harness
//             histórico de 11/07/2026 (números de baseline 790/5206).
//   cells     modo comparação: _stripHeader + split por <br> + mergeHeadings
//             + normalize por célula (porte de reader-render.js:506-550).
//             A replicação é harness-side e IGUAL para os dois motores — o
//             A/B mede o motor, não a fidelidade do porte.
//
// Métricas absolutas (por motor): rótulos de resposta grudados e blocos <p>
// órfãos (mesmas regexes do harness de 11/07/2026, p/ comparabilidade).
//
// Uso:
//   node scripts/render_regress.mjs                       # HEAD vs worktree
//   node scripts/render_regress.mjs --old <git-ref>       # ref vs worktree
//   node scripts/render_regress.mjs --old-file a.js --new-file b.js
//   node scripts/render_regress.mjs --write-baseline      # grava baseline
//   node scripts/render_regress.mjs --lanes topic,cells --samples 20
//
// Baseline (scripts/render_regress.baseline.json) é PINADA ao hash do
// manifest do corpus: se o corpus mudou (storage:pull, edição), os números
// da baseline NÃO são comparáveis — o harness avisa em vez de "falhar".
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, makeEngine, htmlToText, mergeContinuations, topicInnerHtml } from './_glued_fix_lib.mjs';

// ---------- CLI ----------
const argv = process.argv.slice(2);
const opt = (name, def) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes('--' + name);

const CORPUS = path.resolve(ROOT, opt('corpus', '.local-edits/teachings'));
const LANES = opt('lanes', 'topic,nomarked,cells').split(',').map(s => s.trim());
const N_SAMPLES = parseInt(opt('samples', '10'), 10);
const BASELINE_PATH = path.resolve(ROOT, opt('baseline', 'scripts/render_regress.baseline.json'));

// ---------- motores ----------
function loadEngineSrc(refOpt, fileOpt, defRef) {
    const file = opt(fileOpt, null);
    if (file) return { label: file, src: fs.readFileSync(path.resolve(file), 'utf8') };
    const ref = opt(refOpt, defRef);
    if (ref === 'worktree') {
        return { label: 'worktree', src: fs.readFileSync(path.join(ROOT, 'js', 'reader-content.js'), 'utf8') };
    }
    const src = execFileSync('git', ['show', ref + ':js/reader-content.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return { label: ref, src };
}
const OLD = loadEngineSrc('old', 'old-file', 'HEAD');
const NEW = loadEngineSrc('new', 'new-file', 'worktree');

const engOld = makeEngine(OLD.src);
const engNew = makeEngine(NEW.src);
const engOldNoMk = makeEngine(OLD.src, { withMarked: false });
const engNewNoMk = makeEngine(NEW.src, { withMarked: false });

// ---------- corpus ----------
function listJsonFiles(dir) {
    const out = [];
    (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.json')) out.push(p);
        }
    })(dir);
    return out.sort();
}

// Arrays de tópicos em ordem de documento (themes[].topics etc.): qualquer
// array cujos elementos tenham content/content_pt. Objetos-tópico soltos
// viram arrays singleton.
function collectTopicArrays(root) {
    const arrays = [];
    const seen = new Set();
    (function walk(o) {
        if (!o || typeof o !== 'object' || seen.has(o)) return;
        seen.add(o);
        if (Array.isArray(o)) {
            const topicish = o.filter(x => x && typeof x === 'object' && (x.content || x.content_pt || x.content_ptbr));
            if (topicish.length) arrays.push(topicish);
            o.forEach(walk);
            return;
        }
        for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') walk(o[k]);
    })(root);
    return arrays;
}

function corpusManifestHash(files) {
    const h = crypto.createHash('sha256');
    for (const f of files) {
        const fh = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
        h.update(path.relative(CORPUS, f).replace(/\\/g, '/') + '\0' + fh + '\n');
    }
    return h.digest('hex');
}

// ---------- tiers & métricas ----------
const collapseWs = (s) => s.replace(/[\s 　]+/g, ' ').trim();
function tierOf(a, b) {
    if (a === b) return 1;
    const ta = htmlToText(a), tb = htmlToText(b);
    if (ta === tb) return 2;
    if (collapseWs(ta) === collapseWs(tb)) return 3;
    return 4;
}
function firstDiff(a, b) {
    const ta = collapseWs(htmlToText(a)), tb = collapseWs(htmlToText(b));
    let i = 0;
    while (i < ta.length && i < tb.length && ta[i] === tb[i]) i++;
    const s = Math.max(0, i - 50);
    return { old: ta.slice(s, i + 70), new: tb.slice(s, i + 70) };
}

// Regexes do harness histórico (11/07/2026) — manter p/ comparabilidade.
const ORPHAN_RE = /<p>\s*(?:<(?:b|strong|font|i)>\s*)*(?:<\/(?:b|strong|font|i)>\s*)*<\/p>|<p>\s*(?:<(?:b|strong|font|i)[^>]*>\s*)+<\/p>/gi;
const GLUE_RE = /[」。"'”’)\wà-úÀ-Ú]\s{0,2}(?:<(?:b|font|i)[^>]*>\s*){1,3}(?:<i>\s*)?(?:明主様御垂示|Resposta de)/;

// ---------- lanes ----------
// Porte de reader-render.js:506-550 (modo comparação). Igual pros 2 motores.
const PART_HEADING_RE = /^(?:第\s*[一二三四五六七八九十百千\d]+|Parte\s+(?:[IVXLCDM]+|\d+))$/i;
function comparisonCells(topic, eng) {
    const rawJa = eng.stripHeader(topic.content || '');
    const rawPt = eng.stripHeader(topic.content_ptbr || topic.content_pt || topic.content || '');
    const splitRaw = (raw) => raw.split(/<br\s*\/?>[\s\n]*/gi).filter(s => s.trim());
    const isPartHeading = (seg) => {
        const txt = seg.replace(/<[^>]+>/g, '').replace(/[\s　]+/g, ' ').trim();
        return !!txt && txt.length <= 20 && PART_HEADING_RE.test(txt);
    };
    const mergeHeadings = (segs) => {
        const out = [];
        for (let i = 0; i < segs.length; i++) {
            if (isPartHeading(segs[i]) && i + 1 < segs.length) { out.push(segs[i] + ' ' + segs[i + 1]); i++; }
            else out.push(segs[i]);
        }
        return out;
    };
    let jaSegs = mergeHeadings(splitRaw(rawJa));
    let ptSegs = mergeHeadings(splitRaw(rawPt));
    if (jaSegs.length !== ptSegs.length) { jaSegs = [rawJa]; ptSegs = [rawPt]; }
    const cells = [];
    for (let pi = 0; pi < Math.max(jaSegs.length, ptSegs.length); pi++) {
        cells.push(jaSegs[pi] ? eng.normalize(jaSegs[pi]) : '');
        cells.push(ptSegs[pi] ? eng.normalize(ptSegs[pi]) : '');
    }
    return cells; // cada célula é um <div> independente no DOM — tier POR célula
}

// ---------- execução ----------
const files = listJsonFiles(CORPUS);
console.log(`Motor OLD: ${OLD.label} | Motor NEW: ${NEW.label}`);
console.log(`Corpus: ${files.length} arquivos em ${CORPUS}`);
const corpusHash = corpusManifestHash(files);
console.log(`Manifest do corpus: ${corpusHash.slice(0, 16)}…`);

const stats = {};
for (const lane of LANES) stats[lane] = { units: 0, t: { 1: 0, 2: 0, 3: 0, 4: 0 }, samples: [] };
// métricas em 2 réguas: `hist` = condições do harness de 11/07/2026 (lane
// nomarked, campos content/content_pt) p/ comparar com 790/5206; `abi` =
// régua real de produção (lane topic: marked + header + content_ptbr).
const metrics = {
    hist: { old: { glued: 0, orphans: 0 }, new: { glued: 0, orphans: 0 } },
    abi: { old: { glued: 0, orphans: 0 }, new: { glued: 0, orphans: 0 } },
};

let done = 0;
for (const f of files) {
    let json;
    try { json = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    const rel = path.relative(CORPUS, f).replace(/\\/g, '/');
    const topicArrays = collectTopicArrays(json);

    for (const topics of topicArrays) {
        // lane topic — pipeline completo (merge + header + marked), PT e JA
        if (stats.topic) {
            const mergedOld = mergeContinuations(structuredClone(topics));
            const mergedNew = mergeContinuations(structuredClone(topics));
            for (let i = 0; i < topics.length; i++) {
                for (const lang of ['pt', 'ja']) {
                    let a, b;
                    try {
                        a = topicInnerHtml(mergedOld[i], lang, engOld.normalize);
                        b = topicInnerHtml(mergedNew[i], lang, engNew.normalize);
                    } catch { continue; }
                    const tier = tierOf(a, b);
                    const st = stats.topic;
                    st.units++; st.t[tier]++;
                    if (tier >= 3 && st.samples.length < N_SAMPLES) {
                        st.samples.push({ file: rel, topic: i, lang, tier, ...firstDiff(a, b) });
                    }
                    // métricas absolutas na régua real (ABI dos grifos)
                    metrics.abi.old.glued += GLUE_RE.test(a) ? 1 : 0;
                    metrics.abi.new.glued += GLUE_RE.test(b) ? 1 : 0;
                    metrics.abi.old.orphans += (a.match(ORPHAN_RE) || []).length;
                    metrics.abi.new.orphans += (b.match(ORPHAN_RE) || []).length;
                }
            }
        }
        // lane nomarked — condições do harness histórico (content/content_pt)
        if (stats.nomarked) {
            for (let i = 0; i < topics.length; i++) {
                for (const field of ['content', 'content_pt']) {
                    const raw = topics[i][field];
                    if (!raw || typeof raw !== 'string') continue;
                    let a, b;
                    try { a = engOldNoMk.normalize(raw); b = engNewNoMk.normalize(raw); } catch { continue; }
                    const tier = tierOf(a, b);
                    const st = stats.nomarked;
                    st.units++; st.t[tier]++;
                    if (tier >= 3 && st.samples.length < N_SAMPLES) {
                        st.samples.push({ file: rel, topic: i, field, tier, ...firstDiff(a, b) });
                    }
                    // métricas históricas (comparáveis com 790/5206 de 11/07/2026)
                    metrics.hist.old.glued += GLUE_RE.test(a) ? 1 : 0;
                    metrics.hist.new.glued += GLUE_RE.test(b) ? 1 : 0;
                    metrics.hist.old.orphans += (a.match(ORPHAN_RE) || []).length;
                    metrics.hist.new.orphans += (b.match(ORPHAN_RE) || []).length;
                }
            }
        }
        // lane cells — modo comparação; tier POR CÉLULA (cada uma é um <div>
        // independente — whitespace na borda de célula não vaza pra vizinha),
        // o tier do tópico é o pior das suas células.
        if (stats.cells) {
            for (let i = 0; i < topics.length; i++) {
                let cellsA, cellsB;
                try { cellsA = comparisonCells(topics[i], engOld); cellsB = comparisonCells(topics[i], engNew); } catch { continue; }
                let tier = 1, worst = -1;
                if (cellsA.length !== cellsB.length) { tier = 4; }
                else for (let c = 0; c < cellsA.length; c++) {
                    const t = tierOf(cellsA[c], cellsB[c]);
                    if (t > tier) { tier = t; worst = c; }
                }
                const st = stats.cells;
                st.units++; st.t[tier]++;
                if (tier >= 3 && st.samples.length < N_SAMPLES) {
                    const d = worst >= 0 ? firstDiff(cellsA[worst], cellsB[worst]) : { old: `${cellsA.length} células`, new: `${cellsB.length} células` };
                    st.samples.push({ file: rel, topic: i, cell: worst, tier, ...d });
                }
            }
        }
    }
    if (++done % 200 === 0) console.log(`  … ${done}/${files.length} arquivos`);
}

// ---------- relatório ----------
console.log('\n================= RESULTADO =================');
let anyT4 = 0;
for (const lane of LANES) {
    const st = stats[lane];
    if (!st) continue;
    anyT4 += st.t[4];
    console.log(`lane ${lane.padEnd(9)} unidades=${String(st.units).padStart(6)}  T1=${st.t[1]}  T2=${st.t[2]}  T3=${st.t[3]}  T4=${st.t[4]}${st.t[4] ? '  ← PROIBIDO' : ''}`);
}
if (stats.nomarked) console.log(`métricas HIST (régua 11/07): grudados ${metrics.hist.old.glued}→${metrics.hist.new.glued} | <p> órfãos ${metrics.hist.old.orphans}→${metrics.hist.new.orphans}`);
if (stats.topic) console.log(`métricas ABI  (régua real):  grudados ${metrics.abi.old.glued}→${metrics.abi.new.glued} | <p> órfãos ${metrics.abi.old.orphans}→${metrics.abi.new.orphans}`);

for (const lane of LANES) {
    const st = stats[lane];
    if (!st || !st.samples.length) continue;
    console.log(`\n--- amostras (${lane}) ---`);
    for (const s of st.samples) {
        console.log(`[T${s.tier}] ${s.file} #${s.topic} ${s.lang || s.field || ''}`);
        console.log(`  old: …${s.old}…`);
        console.log(`  new: …${s.new}…`);
    }
}

// ---------- baseline ----------
const summary = {
    corpusHash,
    corpusFiles: files.length,
    engines: { old: OLD.label, new: NEW.label },
    lanes: Object.fromEntries(LANES.map(l => [l, { units: stats[l].units, tiers: stats[l].t }])),
    metrics,
    generatedAt: new Date().toISOString(),
};
if (flag('write-baseline')) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(summary, null, 2) + '\n');
    console.log(`\nBaseline gravada em ${path.relative(ROOT, BASELINE_PATH)}`);
} else if (fs.existsSync(BASELINE_PATH)) {
    const base = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    if (base.corpusHash !== corpusHash) {
        console.log('\n⚠ AVISO: o corpus mudou desde a baseline (storage:pull/edição?).');
        console.log('  Números absolutos NÃO são comparáveis com a baseline; o A/B desta execução continua válido.');
    } else {
        console.log('\nCorpus idêntico ao da baseline — números comparáveis.');
    }
}
const outJson = opt('json', null);
if (outJson) fs.writeFileSync(path.resolve(outJson), JSON.stringify({ ...summary, samples: Object.fromEntries(LANES.map(l => [l, stats[l].samples])) }, null, 2));

if (anyT4 > 0 && !flag('allow-t4')) {
    console.error(`\n✖ FALHA: ${anyT4} unidade(s) com TEXTO VISÍVEL diferente (T4). Use --allow-t4 só se a mudança de texto for INTENCIONAL e acompanhada de plano de cura de grifos.`);
    process.exit(1);
}
console.log('\n✔ OK: nenhum T4 (texto visível preservado).');
