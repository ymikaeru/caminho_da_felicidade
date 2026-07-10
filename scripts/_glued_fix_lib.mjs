// ============================================================
// Lib do fix "cabeçalho de papel colado" (信者の質問/明主様御垂示 sem <br>
// antes). Simula o texto renderizado de #topic-N EXATAMENTE como o leitor
// (reader-render.js + reader-content.js + marked) pra:
//   1) validar fidelidade contra user_highlights.text;
//   2) calcular o remapeamento de offsets quando os dados mudarem.
// _normalizeContent/_fallbackFormat/_cleanSoftBreakArtifacts e o marked são
// os ARQUIVOS REAIS avaliados em vm — não cópias.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- contexto vm com o pipeline real ----------
// makeEngine: constrói um motor isolado a partir de um FONTE de
// reader-content.js (string) — usado pelo harness de regressão para comparar
// duas versões do motor (git ref × worktree). withMarked=false simula o
// caminho _fallbackFormat (marked ausente).
export function makeEngine(readerContentSrc, { withMarked = true } = {}) {
    const ectx = vm.createContext({ console, window: undefined });
    ectx.window = ectx; // marked UMD usa this/window
    ectx.globalThis = ectx;
    if (withMarked) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'marked.min.js'), 'utf8'), ectx, { filename: 'marked.min.js' });
    }
    vm.runInContext(readerContentSrc, ectx, { filename: 'reader-content.js' });
    return {
        normalize: (s) => vm.runInContext('_normalizeContent', ectx)(s),
        stripHeader: (s) => vm.runInContext('_stripHeader', ectx)(s),
    };
}

const _defaultEngine = makeEngine(fs.readFileSync(path.join(ROOT, 'js', 'reader-content.js'), 'utf8'));
const _normalizeContent = _defaultEngine.normalize;

// ---------- cópias verbatim de reader-render.js (l.12-53) e reader.js (l.65) ----------
function _formatQuotedTitle(rawTitle) {
    let t = rawTitle;
    const quoteMatch = t.match(/[""]([^""]+)[""]/);
    if (!quoteMatch) {
        return t.replace(/\s+-\s+/, ': ').replace(/\s+:/, ':');
    }
    const quotePos = t.indexOf(quoteMatch[0]);
    const colonPos = t.indexOf(':');
    const dashPos = t.indexOf(' - ');
    const sepIdx = Math.min(
        colonPos >= 0 ? colonPos : Infinity,
        dashPos >= 0 ? dashPos : Infinity,
        quotePos
    );
    let prefix = (sepIdx === Infinity ? '' : t.slice(0, sepIdx))
        .replace(/\*/g, '').replace(/[:\-]+$/, '').trim();
    return (prefix && prefix.toLowerCase() !== quoteMatch[1].toLowerCase())
        ? `${prefix}: ${quoteMatch[1]}`
        : quoteMatch[1];
}
const _MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function _formatShowaDatePt(jp) {
    if (!jp) return jp;
    const m = jp.trim().match(/^昭和\s*(\d+)\s*年(?:\s*(\d+)\s*月)?(?:\s*(\d+)\s*日)?$/);
    if (!m) return jp;
    const year = 1925 + parseInt(m[1], 10);
    const month = m[2] ? parseInt(m[2], 10) : null;
    const day = m[3] ? parseInt(m[3], 10) : null;
    if (day && month) return `${day} de ${_MESES_PT[month - 1]} de ${year}`;
    if (month) return `${_MESES_PT[month - 1]} de ${year}`;
    return String(year);
}
const genericRegex = /O Método do Johrei|Princípio do Johrei|Sobre a Verdade|Verdade \d|Ensinamento \d|Parte \d|JH\d|JH \d|Publicação \d|Agricultura Natural|Instrução Divina|Purificação Equilibrada|Coletânea de fragmentos/i;

// ---------- textContent de um trecho de HTML ----------
// Equivale a concatenar os nós de texto na ordem do documento (TreeWalker):
// remove tags e decodifica entidades; whitespace entre tags É preservado.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function htmlToText(html) {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENT[e])
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// ---------- merge continues_previous (reader-render.js l.343-358) ----------
// MUTA os topics — chamar sobre uma cópia. Devolve o array mutado.
export function mergeContinuations(topics) {
    let rootIdx = -1;
    for (let _i = 0; _i < topics.length; _i++) {
        const _t = topics[_i];
        if (_t.continues_previous && rootIdx >= 0) {
            const _root = topics[rootIdx];
            const _fragPt = _t.content_ptbr || _t.content_pt || _t.content || '';
            const _rootPt = _root.content_ptbr || _root.content_pt || _root.content || '';
            _root.content_ptbr = _rootPt + _fragPt;
            _root.content = (_root.content || '') + (_t.content || '');
            _t._mergedAway = true;
        } else {
            rootIdx = _i;
        }
    }
    return topics;
}

// ---------- transform por tópico (porte verbatim de reader-render.js l.378-471) ----------
// `normalize` opcional: injeta outro motor (harness A/B); default = worktree.
export function topicInnerHtml(topicData, lang, normalize = _normalizeContent) {
    const isPt = lang !== 'ja';
    if (topicData._mergedAway) return ''; // âncora vazia (l.372)
    let rawContent = isPt ? (topicData.content_ptbr || topicData.content_pt || topicData.content || '') : (topicData.content || '');
    const activeTitle = isPt ? (topicData.title_ptbr || topicData.title_pt || topicData.publication_title_pt || '') : (topicData.title_ja || topicData.title || '');

    let headerHTML = '';
    if (!topicData.continues_previous) {
    const headerMatch = rawContent.match(/^([\s\S]{0,350}?)\(([^)]*\d+[^)]*)\)/);
    if (headerMatch) {
        let preText = headerMatch[1];
        let dateText = headerMatch[2];
        let pureTitle = preText.replace(/<[^>]+>/g, '').trim();

        const _openB = (preText.match(/<b[\s>]/gi) || []).length;
        const _closeB = (preText.match(/<\/b>/gi) || []).length;
        const _openF = (preText.match(/<font[\s>]/gi) || []).length;
        const _closeF = (preText.match(/<\/font>/gi) || []).length;
        const _insideTag = _openB > _closeB || _openF > _closeF;

        if (!_insideTag && pureTitle.length > 3 && pureTitle.length < 250 && !pureTitle.includes('。') && !pureTitle.includes('. ')) {
            pureTitle = _formatQuotedTitle(pureTitle);
            const pt0 = pureTitle.replace(/^\*\*|\*\*$/g, '');
            const dateDisp = isPt ? _formatShowaDatePt(dateText) : dateText;
            headerHTML = `<b><font size="+2">${pt0.charAt(0).toUpperCase() + pt0.slice(1)}</font></b><br/>(${dateDisp})<br/><br/>`;
            rawContent = rawContent.substring(headerMatch[0].length).replace(/^([\s\n]*<br\s*\/?>[\s\n]*)+/gi, '');
        }
    }

    if (!headerHTML) {
        const contentAlreadyHasTitle = /^\s*<b[\s>]/i.test(rawContent.trim()) || /^\s*<font[\s>]/i.test(rawContent.trim());
        if (contentAlreadyHasTitle) {
            const strictFontB = rawContent.match(/^(\s*<font[^>]*><b[^>]*>([^<]*)<\/b><\/font>)/i);
            const strictB = rawContent.match(/^(\s*<b[^>]*>(?:<font[^>]*>)?([^<]*)(?:<\/font>)?<\/b>)/i);
            let block = null, titleSrc = '', needGuard = false;
            if (strictFontB && strictFontB[2].trim()) { block = strictFontB; titleSrc = strictFontB[2]; }
            else if (strictB && strictB[2].trim()) { block = strictB; titleSrc = strictB[2]; }
            else {
                const lazy = rawContent.match(/^(\s*<b[^>]*>(?:<font[^>]*>)?[\s\S]*?(?:<\/font>)?<\/b>(?:<\/font>)?)/i)
                    || rawContent.match(/^(\s*<font[^>]*><b[^>]*>[\s\S]*?<\/b><\/font>)/i)
                    || rawContent.match(/^(\s*<font[^>]*>[\s\S]*?<\/font>)/i);
                if (lazy) { block = lazy; titleSrc = lazy[1].replace(/<[^>]+>/g, ''); needGuard = true; }
            }
            if (block) {
                const tt = titleSrc.replace(/\s+/g, ' ').trim();
                const okGuard = !needGuard || (tt.length > 3 && tt.length < 250 && !tt.includes('。') && !/\.\s/.test(tt));
                if (tt && okGuard) {
                    const pt2 = _formatQuotedTitle(tt).replace(/^\*\*|\*\*$/g, '');
                    let newBody = rawContent.substring(block[1].length).replace(/^([\s\n]*(?:<br\s*\/?>|<\/font>|<\/b>)[\s\n]*)+/gi, '');
                    const bodyHasDate = /^\s*[（(][^）)]*\d{4}[^）)]*[）)]/.test(newBody);
                    const _dt = (isPt && topicData.date && topicData.date !== 'Unknown' && !bodyHasDate)
                        ? _formatShowaDatePt(topicData.date) : null;
                    const displayDate = _dt ? `<br/>(${_dt})` : '';
                    headerHTML = `<b><font size="+2">${pt2.charAt(0).toUpperCase() + pt2.slice(1)}</font></b>${displayDate}<br/><br/>`;
                    rawContent = newBody;
                }
            }
        }
        if (activeTitle && rawContent.trim() && !genericRegex.test(activeTitle) && !contentAlreadyHasTitle) {
            const cTitle = activeTitle.replace(/<[^>]+>/g, '').replace(/[　\s\d\W]/g, '').toLowerCase();
            const cStart = rawContent.substring(0, 500).replace(/<[^>]+>/g, '').replace(/[　\s\d\W]/g, '').toLowerCase();
            if (cTitle.length > 5 && !cStart.includes(cTitle)) {
                let pureTitle = _formatQuotedTitle(activeTitle);
                const _dt = isPt ? _formatShowaDatePt(topicData.date) : topicData.date;
                const displayDate = topicData.date && topicData.date !== 'Unknown' ? `<br/>\n(${_dt})` : '';
                const pt1 = pureTitle.replace(/^\*\*|\*\*$/g, '');
                headerHTML = `<b><font size="+2">${pt1.charAt(0).toUpperCase() + pt1.slice(1)}</font></b>${displayDate}<br/><br/>`;
                if (displayDate) {
                    rawContent = rawContent.replace(/^\s*(?:<[^>]+>\s*)*[（(][^）)]*\d{4}[^）)]*[）)][　\s]*/, '');
                }
            }
        }
    }
    } // /if (!continues_previous)

    let formatted = normalize(rawContent);
    // (anotação data-p-idx omitida — só atributos, zero nós de texto)

    const isCont = !!topicData.continues_previous;
    // l.492+547: topHeader = `${headerHTML}\n${saveBar}\n${cta}`; inner =
    // `\n${topHeader}\n${formatted}\n`. O CTA é zero-texto por contrato
    // (1 linha, data-label/content:attr), mas a save bar contribui UM nó de
    // texto: o rótulo do botão salvar (span.topic-save-label, l.177).
    // Verificado no browser: "…(data)\nSalvar esta publicação\n\n"corpo…".
    const saveLabel = isPt ? 'Salvar esta publicação' : 'この教えを保存';
    const topHeader = isCont ? '' : `${headerHTML}\n${saveLabel}\n`;
    return `\n${topHeader}\n${formatted}\n`;
}

// Texto renderizado (textContent) do #topic-{index}.
export function simulateTopicText(topics, index, lang, normalize = _normalizeContent) {
    return htmlToText(topicInnerHtml(topics[index], lang, normalize));
}

// ---------- detecção/correção do cabeçalho colado ----------
// Âncora ESTRUTURAL (vale igual pros dois idiomas): bloco <b>+<font> com
// color de cabeçalho de papel. Em JA o texto é 信者の質問/明主様御垂示
// (consistente — a âncora semântica); em PT a tradução varia, por isso a
// cor é o critério, não o texto.
const HDR_COLORS = '(?:0000ff|990000|660000)';
const HDR_RE = new RegExp(
    `(?:<b[^>]*>\\s*<font[^>]*color="?#${HDR_COLORS}"?[^>]*>|<font[^>]*color="?#${HDR_COLORS}"?[^>]*>\\s*<b[^>]*>)`,
    'gi'
);

// Devolve os índices (no HTML cru) onde um cabeçalho começa SEM <br> antes
// (ignorando whitespace e ignorando o início do conteúdo).
export function gluedHeaderPositions(html) {
    if (!html) return [];
    const out = [];
    HDR_RE.lastIndex = 0;
    let m;
    while ((m = HDR_RE.exec(html)) !== null) {
        const tail = html.slice(0, m.index).replace(/[\s　]+$/, '');
        // já está em linha própria se vier após <br> (INCLUSIVE com atributos,
        // ex.: <br data-soft="1"> do editor do admin), <hr> ou fim de bloco
        if (tail !== '' && !/<(?:br|hr)[^>]*\/?>$|<\/(?:p|div|h\d)>$/i.test(tail)) out.push(m.index);
    }
    return out;
}

// Insere <br/> antes de cada cabeçalho colado. Só ACRESCENTA markup — nunca
// remove/altera um caractere de texto (pré-requisito do remapeamento).
export function insertBreaks(html) {
    const pos = gluedHeaderPositions(html);
    if (!pos.length) return html;
    let out = '', prev = 0;
    for (const p of pos) { out += html.slice(prev, p) + '<br/>'; prev = p; }
    return out + html.slice(prev);
}

// ---------- remapeamento de offsets ----------
// oldText/newText: textos renderizados antes/depois. Como a mudança nos
// dados é só-markup, o texto renderizado só pode diferir em WHITESPACE
// (ex.: _fallbackFormat troca "?\" <b>" por parágrafo: ' ' vira '\n';
// inserções de \n da quebra). O diff aceito é: runs de whitespace de um
// lado substituídos por runs de whitespace do outro (incl. vazio→run).
// Qualquer divergência não-whitespace → null (tópico fica de fora).
const _isWs = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === ' ' || c === '　';
export function buildOffsetMap(oldText, newText) {
    const edits = []; // {oldStart,oldEnd,newStart,newEnd}
    let i = 0, j = 0;
    while (i < oldText.length || j < newText.length) {
        if (i < oldText.length && j < newText.length && oldText[i] === newText[j]) { i++; j++; continue; }
        const si = i, sj = j;
        while (i < oldText.length && _isWs(oldText[i])) i++;
        while (j < newText.length && _isWs(newText[j])) j++;
        if (i === si && j === sj) return null; // divergência não-whitespace
        edits.push({ oldStart: si, oldEnd: i, newStart: sj, newEnd: j });
        // após consumir os runs, os próximos chars têm que casar de novo
        if (i < oldText.length && j < newText.length && oldText[i] !== newText[j]) return null;
        if ((i >= oldText.length) !== (j >= newText.length)) return null;
    }
    return (pos) => {
        let delta = 0;
        for (const e of edits) {
            if (e.oldEnd <= pos) { delta += (e.newEnd - e.newStart) - (e.oldEnd - e.oldStart); continue; }
            if (e.oldStart < pos) { // dentro de um run substituído: clampa
                return e.newStart + Math.min(pos - e.oldStart, e.newEnd - e.newStart);
            }
            break;
        }
        return pos + delta;
    };
}

// igualdade ignorando diferenças de whitespace (pra verificação de grifos
// que atravessam um run substituído)
export const wsNorm = (s) => s.replace(/[\s　]+/g, ' ');

// ---------- carregamento de arquivo do espelho ----------
export function loadTopics(vol, fileBase) {
    const p = path.join(ROOT, '.local-edits', 'teachings', vol, fileBase + '.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    // deep-copy: mergeContinuations muta
    const topics = (j.themes || []).flatMap(t => t.topics || []).map(t => ({ ...t }));
    return mergeContinuations(topics);
}
