// ============================================================
// Fixtures das patologias CONHECIDAS do normalizador do leitor.
// Cada fixture documenta um comportamento que já quebrou (ou quase) em
// produção. O motor é o ARQUIVO REAL js/reader-content.js via vm (com o
// marked real) — igual ao leitor. Rode: npm test
//
// Regra de ouro: se um teste daqui falhar após uma mudança de regra, NÃO
// "conserte o teste" — rode antes `npm run test:render` (harness A/B sobre
// os 23.673 tópicos) e entenda o raio de explosão da mudança.
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, makeEngine, htmlToText, mergeContinuations, topicInnerHtml } from '../scripts/_glued_fix_lib.mjs';

const SRC = fs.readFileSync(path.join(ROOT, 'js', 'reader-content.js'), 'utf8');
const eng = makeEngine(SRC);
const engNoMk = makeEngine(SRC, { withMarked: false });

// ---------- helpers ----------
const collapse = (s) => s.replace(/[\s　 ]+/g, ' ').trim();
const vis = (html) => collapse(htmlToText(html));
// textos dos <p> top-level (com ou sem atributos)
const pTexts = (html) => [...html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((m) => collapse(htmlToText(m[1])));
const pStart = (html, prefix) => pTexts(html).some((t) => t.startsWith(prefix));
const inSameP = (html, a, b) => pTexts(html).some((t) => t.includes(a) && t.includes(b));
const notInSameP = (html, a, b) => !inSameP(html, a, b);
const boldTexts = (html) => [...html.matchAll(/<b(?:\s[^>]*)?>([\s\S]*?)<\/b>/gi)]
    .map((m) => collapse(htmlToText(m[1])));
const noEmptyP = (html) => pTexts(html).every((t) => t.length > 0);

// ============================================================
// 1) Rótulos de fala grudados (bug corrigido em 11/07/2026)
// ============================================================
test('rótulo PT "Resposta de Meishu-Sama" com <i> após citação + <br> simples → parágrafo próprio', () => {
    const out = eng.normalize('"O que devo fazer?" <br/><b><font color="#0000ff" size="+1">Resposta de <i>Meishu-Sama</i></font></b><br/>"Não force; ministre quando ela dormir."');
    assert.ok(pStart(out, 'Resposta de Meishu-Sama'), 'rótulo deve abrir parágrafo');
    assert.ok(notInSameP(out, 'O que devo fazer?', 'Resposta de'), 'não pode grudar na pergunta');
    assert.ok(boldTexts(out).some((t) => t.startsWith('Resposta de Meishu-Sama')), 'rótulo continua em negrito');
    assert.ok(noEmptyP(out), 'sem parágrafo vazio (casca de tags órfãs)');
});

test('rótulo JA 明主様御垂示 após 」 + <br> simples → parágrafo próprio', () => {
    const out = eng.normalize('「いかにしたらよいでしょうか。」 <br/><b><font color="#0000ff" size="+1">明主様御垂示</font></b><br/>「気長にやる。」');
    assert.ok(pStart(out, '明主様御垂示'));
    assert.ok(notInSameP(out, 'いかにしたら', '明主様御垂示'));
});

test('variantes JA do léxico: 御講話 / 信者の発言 também quebram', () => {
    const a = eng.normalize('「…でしょうか。」 <br/><b><font color="#0000ff">明主様御講話</font></b><br/>「講話の内容。」');
    assert.ok(pStart(a, '明主様御講話'));
    const b = eng.normalize('「前の発言。」 <br/><font color="#990000" size="+1"><b>信者の発言</b></font><br/>「発言の内容。」');
    assert.ok(pStart(b, '信者の発言'));
});

test('rótulo de dialogante 氏/博士 (curto, colorido) quebra; nome citado em frase longa não', () => {
    const a = eng.normalize('「文の終わり。」 <br/><b><font color="#990000" size="+1">真山氏</font></b>　いろいろな問題がありますが。');
    assert.ok(pStart(a, '真山氏'));
    const b = eng.normalize('「文の終わり。」 <br/><font color="#0000ff"><b>ブ博士の発言</b></font>「内容。」');
    assert.ok(pStart(b, 'ブ博士の発言'));
});

test('bloco 参考 明主様御垂示 (referência/apêndice, markup real do corpus) abre parágrafo próprio', () => {
    // No corpus o cabeçalho 参考 é <font size="+2"> SEM color (hyourei4 etc.) —
    // a regra 3b nem se aplica; o <br> vira parágrafo pela regra 4.
    const out = eng.normalize('「前の御垂示の終わり。」 <br/><b><font size="+2">参考　明主様御垂示　「線香の要否」</font></b>　（昭和25年2月23日） <br/><font color="#990000" size="+1"><b>信者の質問</b></font><br/>「質問。」');
    assert.ok(pStart(out, '参考'));
    assert.ok(notInSameP(out, '前の御垂示の終わり', '参考'));
});

// invariante estrutural: TODO rótulo do léxico FULL é coberto pela guarda
// da regra 3b (lookahead ⊇ léxico) — se alguém adicionar um rótulo em
// _PT_SPEAKER_FULL sem cobertura em _PT_SPEAKER_PREFIXES, isto falha.
test('cobertura: cada rótulo PT do léxico quebra parágrafo mesmo colado por <br> simples', () => {
    const labels = [
        'Pergunta do fiel', 'Pergunta de um fiel', 'Explicação do fiel',
        'Orientação de Meishu-Sama', 'Comentário do fiel', 'Resposta de Meishu-Sama',
        'Ensinamento de Meishu-Sama', 'Palavras de Meishu-Sama',
        'Fala do Dr. Braden', 'Fala de Meishu-Sama',
    ];
    for (const label of labels) {
        const out = eng.normalize(`"fim da fala anterior." <br/><font color="#990000"><b>${label}</b></font><br/>"conteúdo da fala."`);
        assert.ok(notInSameP(out, 'fim da fala anterior', label.slice(0, 12)),
            `"${label}" grudou na fala anterior`);
    }
});

// ============================================================
// 2) Ênfase colorida INLINE — NÃO pode virar parágrafo (regra 3b)
// ============================================================
test('ênfase colorida no meio da frase (<br> de leiaute) vira espaço, não parágrafo', () => {
    const out = eng.normalize('Estamos quase<br/><font color="#990000">chegando ao final</font> do caminho.');
    assert.ok(inSameP(out, 'quase', 'chegando ao final'), 'frase não pode ser cortada ao meio');
});

test('fragmento com vírgula final entre <br> continua a mesma frase (regra 2+3)', () => {
    const out = eng.normalize('<font color="#990000">já estão destinadas à extinção,</font><br/><font color="#990000">por mais que</font> lutem.');
    assert.ok(inSameP(out, 'extinção,', 'por mais que'));
});

// ============================================================
// 3) Regra 9 — rótulo dentro de parêntese é inline (não quebra)
// ============================================================
test('rótulo em nota entre parênteses não quebra ("(" não fica órfão)', () => {
    const out = eng.normalize('O texto seguiu normalmente (Palavras de Meishu-Sama: após advertir sobre o incidente) e continuou.');
    assert.ok(inSameP(out, '(Palavras de Meishu-Sama', 'e continuou'), 'nota parentética deve permanecer inline');
});

// ============================================================
// 4) Regra 8 — auto-dois-pontos
// ============================================================
test('rótulo ganha ":" automático; não duplica se já tem', () => {
    const a = eng.normalize('<b><font color="#990000">Pergunta do fiel</font></b><br/>"Como devo proceder?"');
    assert.ok(vis(a).includes('Pergunta do fiel:'));
    const b = eng.normalize('<b><font color="#990000">Pergunta do fiel:</font></b><br/>"Como devo proceder?"');
    assert.ok(!vis(b).includes('Pergunta do fiel::'), 'não pode duplicar ":"');
});

// ============================================================
// 5) Estrutura de cabeçalho e quebras básicas
// ============================================================
test('data entre parênteses no início força parágrafo (regra 5)', () => {
    const out = eng.normalize('（昭和24年6月28日）　「本文の始まり。」');
    assert.ok(notInSameP(out, '昭和24年6月28日', '本文の始まり'));
});

test('caso Jkage completo: título + Pergunta + Resposta em 3 parágrafos, sem <p> vazio', () => {
    const out = eng.normalize('<b><font size="+2">Ensinamento de <i>Meishu-Sama</i>: "Pacientes que enlouquecem"</font></b> (28 de junho de 1949) <br/><b><font color="#990000" size="+1">Pergunta do fiel</font></b><br/>"Na casa dos meus pais, houve problema." <br/><b><font color="#0000ff" size="+1">Resposta de <i>Meishu-Sama</i></font></b><br/>"Faça com paciência."');
    assert.ok(pStart(out, 'Pergunta do fiel:'));
    assert.ok(pStart(out, 'Resposta de Meishu-Sama'));
    assert.ok(noEmptyP(out));
    assert.ok(boldTexts(out).some((t) => t.startsWith('Pergunta do fiel')), 'rótulo separado das tags de abertura deve continuar negrito');
});

test('<br> simples após tag de fechamento + texto = quebra de linha na MESMA <p> (regra 1)', () => {
    const out = eng.normalize('<b>Rótulo</b><br/>texto seguinte da mesma fala');
    assert.ok(inSameP(out, 'Rótulo', 'texto seguinte'));
});

test('vírgula no fim de bloco + <br> = continuação da frase (rejoin)', () => {
    const out = eng.normalize('a frase termina com vírgula,<br/>e continua aqui.');
    assert.ok(inSameP(out, 'vírgula,', 'e continua aqui'));
});

// ============================================================
// 6) Artefatos herdados e limpeza
// ============================================================
test('soft-breaks do editor: 4×<br data-soft> colapsam para 2 (linha em branco, NÃO parágrafo)', () => {
    // Design: <br data-soft> (Shift+Enter do editor) é quebra de LINHA dentro
    // do parágrafo — a regra 4 (br→parágrafo) deliberadamente não o casa.
    // _cleanSoftBreakArtifacts só limpa o excesso (3+ → 2).
    const out = eng.normalize('linha um<br data-soft="1"><br data-soft="1"><br data-soft="1"><br data-soft="1">linha dois');
    assert.equal((out.match(/<br data-soft/g) || []).length, 2, 'excesso de soft-breaks deve colapsar para 2');
    assert.ok(inSameP(out, 'linha um', 'linha dois'), 'soft-break não cria parágrafo novo');
});

test('zero-width chars (guardiões antigos do editor) são removidos', () => {
    const out = eng.normalize('texto​ com﻿ guardiões');
    assert.ok(!/[​﻿]/.test(out));
});

test('sujeira de fim de arquivo (</blockquote></body>) não vira texto visível', () => {
    const out = eng.normalize('「本文。」 <p align="center"><br></p>\n</blockquote>\n</blockquote>\n</body>');
    assert.equal(vis(out), '「本文。」');
});

test('espaços ideográficos U+3000 são limitados a 4', () => {
    const out = eng.normalize('語　　　　　　語二');
    assert.ok(!/ {5}/.test(htmlToText(out)));
});

test('src relativo de imagem é reescrito para assets/images/', () => {
    const out = eng.normalize('veja a figura <img src="foto.png"> acima');
    assert.ok(out.includes('src="assets/images/foto.png"'));
});

test('*asterisco* vira ênfase (marked→<em>; fallback→<i>)', () => {
    const a = eng.normalize('texto *enfatizado* fim');
    assert.ok(/<(i|em)>enfatizado<\/(i|em)>/.test(a), 'com marked');
    assert.ok(!vis(a).includes('*'), 'asteriscos não vazam pro texto');
    const b = engNoMk.normalize('texto *enfatizado* fim');
    assert.ok(/<(i|em)>enfatizado<\/(i|em)>/.test(b), 'sem marked');
});

// ============================================================
// 7) Poda de negrito (regra bCount)
// ============================================================
test('1º negrito (título) e rótulos-keyword são mantidos; negrito aleatório do corpo é removido', () => {
    const out = eng.normalize('<b>Título do Ensinamento</b> corpo do texto <b>trecho qualquer</b> mais texto <b>Pergunta do fiel</b><br/>"pergunta"');
    const bolds = boldTexts(out);
    assert.ok(bolds.some((t) => t.includes('Título do Ensinamento')));
    assert.ok(!bolds.some((t) => t === 'trecho qualquer'), 'negrito aleatório deve ser desembrulhado');
    assert.ok(vis(out).includes('trecho qualquer'), 'mas o TEXTO permanece');
    assert.ok(bolds.some((t) => t.startsWith('Pergunta do fiel')));
});

// ============================================================
// 8) Caminho sem marked (_fallbackFormat)
// ============================================================
test('sem marked: <br/><br/> vira dois parágrafos', () => {
    const out = engNoMk.normalize('Primeiro bloco.<br/><br/>Segundo bloco.');
    assert.deepEqual(pTexts(out), ['Primeiro bloco.', 'Segundo bloco.']);
});

test('sem marked: rótulo grudado também quebra (paridade com marked)', () => {
    const out = engNoMk.normalize('"fim?" <br/><b><font color="#0000ff">Resposta de <i>Meishu-Sama</i></font></b><br/>"resposta."');
    assert.ok(notInSameP(out, 'fim?', 'Resposta de'));
});

// ============================================================
// 9) Pipeline de tópico (merge de continuação + header)
// ============================================================
test('continues_previous: fragmento é fundido na raiz e vira âncora vazia', () => {
    const topics = [
        { content: '「本文の一。」', content_ptbr: '"Corpo um."', title: 't' },
        { continues_previous: true, content: '「本文の二。」', content_ptbr: ' "Corpo dois."', title: 't2' },
    ];
    const merged = mergeContinuations(structuredClone(topics));
    assert.equal(merged[1]._mergedAway, true);
    assert.ok(merged[0].content.includes('本文の二'));
    assert.equal(topicInnerHtml(merged[1], 'pt', eng.normalize), '', 'fragmento fundido rende âncora vazia');
    const rootHtml = topicInnerHtml(merged[0], 'pt', eng.normalize);
    assert.ok(htmlToText(rootHtml).includes('Corpo dois'));
});

test('_stripHeader: remove título+data do início; corpo fica', () => {
    const out = eng.stripHeader('<b>Titulo do artigo</b> (1949) <br/><br/>corpo do texto');
    assert.ok(out.startsWith('corpo do texto'));
});
