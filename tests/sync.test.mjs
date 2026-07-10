// ============================================================
// Sync-tests — vigiam as CÓPIAS da lógica de normalização espalhadas pelo
// projeto (a causa raiz nº1 de drift, per auditoria de 11/07/2026):
//   1. js/reader-content.js  — fonte da verdade (léxico _PT_SPEAKER_FULL etc.)
//   2. js/align-engine.js    — SPEAKER_LABELS + _stripHeader/splitRaw verbatim
//   3. js/reader-render.js   — split do modo comparação + extração de header
//   4. scripts/_glued_fix_lib.mjs — porte verbatim do render p/ node
//   5. supabase/functions/_shared/topic_normalize.mjs — cópia no webhook FTS
// + o pin de versão: alignment.js busca /js/reader-content.js?v=N por fetch —
//   se divergir do ?v= do reader.html, o admin renderiza com motor CACHEADO.
//
// Quando um teste daqui falhar após você editar um dos arquivos vigiados:
//   1. Revise as cópias listadas na mensagem do teste;
//   2. Rode `npm run test:render` (harness A/B) p/ medir o raio da mudança;
//   3. Re-abençoe: `node tests/update_sync_registry.mjs`.
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { ROOT } from '../scripts/_glued_fix_lib.mjs';

const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// expõe as consts top-level do reader-content.js
const rcCtx = vm.createContext({ console });
vm.runInContext(read('js/reader-content.js'), rcCtx, { filename: 'reader-content.js' });
const PT_FULL = vm.runInContext('_PT_SPEAKER_FULL', rcCtx);
const AHEAD = vm.runInContext('_SPEAKER_LABEL_AHEAD', rcCtx);

// Amostras literais dos rótulos PT. COMPLETUDE é verificada: cada fragmento
// do léxico precisa de ≥1 amostra — adicionar rótulo novo ao léxico sem
// adicionar amostra aqui FALHA (e força pensar nas 5 cópias).
const SAMPLES = [
    'Pergunta do fiel', 'Pergunta do um fiel',
    'Explicação do fiel',
    'Orientação de Meishu-Sama',
    'Comentário do fiel', 'Comentário do Fiel',
    'Resposta de Meishu-Sama',
    'Ensinamento de Meishu-Sama',
    'Palavras de Meishu-Sama',
    'Fala do Dr. Braden',
    'Fala de Meishu-Sama',
];

test('léxico PT: toda amostra casa com _PT_SPEAKER_FULL e todo fragmento tem amostra', () => {
    const fullRe = new RegExp('^(?:' + PT_FULL.join('|') + ')$', 'i');
    for (const s of SAMPLES) {
        assert.ok(fullRe.test(s), `amostra "${s}" não casa com o léxico _PT_SPEAKER_FULL`);
    }
    for (const frag of PT_FULL) {
        const re = new RegExp('^(?:' + frag + ')$', 'i');
        assert.ok(SAMPLES.some((s) => re.test(s)),
            `fragmento "${frag}" do léxico não tem amostra em tests/sync.test.mjs — adicione uma (e revise as 5 cópias)`);
    }
});

test('guarda da regra 3b (_SPEAKER_LABEL_AHEAD) cobre TODO rótulo do léxico FULL', () => {
    const aheadRe = new RegExp('^(?:' + AHEAD + ')', 'i');
    for (const s of SAMPLES.concat(['Pergunta de um fiel'])) {
        assert.ok(aheadRe.test(s), `lookahead 3b não cobre "${s}" — rótulo pode grudar de novo`);
    }
});

test('align-engine SPEAKER_LABELS (cópia verbatim) reconhece as mesmas amostras', () => {
    const src = read('js/align-engine.js');
    const m = src.match(/const SPEAKER_LABELS = \/(.+)\/gi;/);
    assert.ok(m, 'SPEAKER_LABELS não encontrado em js/align-engine.js — a cópia foi movida/removida?');
    for (const s of SAMPLES) {
        const re = new RegExp(m[1], 'gi');
        assert.ok(re.test(s), `align-engine.js SPEAKER_LABELS não reconhece "${s}" — dessincronizado do léxico do leitor (renderedParasProxy vai divergir)`);
    }
});

test('_stripHeader: align-engine e reader-content são FUNCIONALMENTE idênticos', () => {
    const AlignEngine = require(path.join(ROOT, 'js', 'align-engine.js'));
    const rcStrip = (s) => vm.runInContext('_stripHeader', rcCtx)(s);
    const battery = [
        '<b>Titulo do artigo</b> (1949) <br/><br/>corpo do texto',
        '<b><font size="+2">明主様御垂示　「善言讃詞」</font></b>　（昭和24年6月28日） <br/>「本文。」',
        '<b>Título sem data</b>  corpo direto',
        'texto puro sem header nenhum',
        '（昭和24年6月28日）só data no início',
        '<b>Um título. Com ponto e espaço</b> (1950) não deve strippar pelo 1º ramo',
    ];
    for (const raw of battery) {
        assert.equal(AlignEngine._stripHeader(raw), rcStrip(raw),
            `_stripHeader divergiu para: ${raw.slice(0, 50)}… — as cópias dessincronizaram`);
    }
});

test('pin de versão: alignment.js busca o MESMO ?v= de reader-content.js que o reader.html usa', () => {
    const readerHtml = read('reader.html');
    const alignmentJs = read('js/admin/tabs/alignment.js');
    const vReader = readerHtml.match(/js\/reader-content\.js\?v=(\w+)/);
    const vAlign = alignmentJs.match(/\/js\/reader-content\.js\?v=(\w+)/);
    assert.ok(vReader && vAlign, 'não achei os pins de ?v=');
    assert.equal(vAlign[1], vReader[1],
        `alignment.js pinna ?v=${vAlign[1]} mas reader.html usa ?v=${vReader[1]} — o admin vai renderizar com motor CACHEADO divergente. Bump os dois JUNTOS.`);
});

// ---------- registro de hashes dos arquivos vigiados ----------
test('arquivos com cópias de normalização não mudaram sem re-bênção do registro', () => {
    const regPath = path.join(ROOT, 'tests', 'sync.hashes.json');
    assert.ok(fs.existsSync(regPath), 'tests/sync.hashes.json não existe — rode: node tests/update_sync_registry.mjs');
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    for (const [rel, expected] of Object.entries(reg.files)) {
        const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
        assert.equal(actual, expected,
            `${rel} mudou desde a última bênção.\n` +
            `  Este arquivo carrega cópias da lógica de normalização (ver cabeçalho de tests/sync.test.mjs).\n` +
            `  1) Revise se as cópias precisam acompanhar a mudança;\n` +
            `  2) Rode npm run test:render (harness A/B, T4 tem que ser 0);\n` +
            `  3) Re-abençoe: node tests/update_sync_registry.mjs`);
    }
});
