// ============================================================
// READER CONTENT — pure content processing utilities
// No DOM or state dependencies — safe to call from anywhere.
// ============================================================

// Limpa artefatos da versão antiga do soft-break no admin editor:
// - U+200B/200C/200D/FEFF (zero-width spaces que eram usadas como
//   "guardião" de trailing <br>)
// - sequências de 3+ <br data-soft> colapsam para no máximo 2.
//   Isso preserva a intenção do usuário de criar uma linha em branco
//   com Shift+Enter duplo (2 brs = 1 blank line), mas limpa as 3-4
//   brs acidentais herdadas do código bugado antigo.
function _cleanSoftBreakArtifacts(html) {
    if (!html) return html;
    return html
        .replace(/[​-‍﻿]/g, '')
        .replace(/(<br[^>]*data-soft[^>]*>\s*<br[^>]*data-soft[^>]*>)(?:\s*<br[^>]*data-soft[^>]*>)+/gi, '$1');
}

// <br> entre fechamento e reabertura de <b>/<font color> — usado por
// _normalizeContent pra distinguir RÓTULO isolado (信者の質問/Pergunta do
// Fiel/明主様御垂示/Fala do Sr. Hioki — vira quebra de parágrafo) de ênfase
// colorida continuando a mesma frase (nossa religião<br>odeia ao máximo... —
// vira espaço). Ver comentário na regra 2+3 dentro de _normalizeContent.
const _LABEL_BREAK_RE = /((?:<\/(?:b|strong|font)>\s*)+)<br\s*\/?>\s*((?:<(?:b|font)[^>]*>\s*){1,2}([^<]{1,80}?)(?:(<br\s*\/?>)\s*)?(?:<\/(?:b|font)>\s*){1,2}(<br\s*\/?>)?)/gi;

function _labelBreakReplacer(DBLBR) {
    return function (m, closers, span, label, innerBr, trailingBr) {
        const isLabel = (innerBr || trailingBr) && !/,\s*$/.test(label) && !/^[a-zà-ú]/.test(label.trim());
        return closers + (isLabel ? DBLBR : ' ') + span;
    };
}

// ============================================================
// LÉXICO ÚNICO de rótulos de fala — fonte da verdade para as 3 regras que
// reconhecem rótulos neste arquivo (R8 auto-dois-pontos, R9 quebra-antes,
// guarda da regra 3b). Adicionar um rótulo novo = mexer SÓ aqui.
// CÓPIAS EXTERNAS vigiadas por tests/sync.test.mjs (conferidas, não confiadas):
//   - js/align-engine.js SPEAKER_LABELS (cópia verbatim da lista FULL)
//   - supabase/functions/_shared/topic_normalize.mjs (5ª cópia da normalização)
// ============================================================

// Formas COMPLETAS (fragmentos de regex) — usadas por R8 (ganham ':') e por
// R9 (quebra de parágrafo antes). Ordem preservada da R8 histórica.
const _PT_SPEAKER_FULL = [
    'Pergunta do? (?:um )?fiel',
    'Explicação do fiel',
    'Orientação de Meishu-Sama',
    'Comentário do [Ff]iel',
    'Resposta de Meishu-Sama',
    'Ensinamento de Meishu-Sama',
    'Palavras de Meishu-Sama',
    'Fala do Dr\\. Braden',
    'Fala de Meishu-Sama',
];
const _PT_SPEAKER_ALT = _PT_SPEAKER_FULL.join('|');
// Regexes hoisted (o replace com /g reseta lastIndex — seguro como const).
const _R8_LABEL_COLON_RE = new RegExp('(' + _PT_SPEAKER_ALT + ')(?!\\s*[:：])', 'gi');
const _R9_LABEL_BREAK_RE = new RegExp('([（(]?)(\\*{0,2})(' + _PT_SPEAKER_ALT + ')', 'gi');

// PREFIXOS (deliberadamente MAIS AMPLOS que _PT_SPEAKER_FULL: cobrem também
// Relato/Declaração/Pronunciamento/Artigo etc., que aparecem coloridos no
// corpus mas não ganham ':' nem quebra automática da R9). O invariante
// "todo rótulo FULL é coberto por algum prefixo" é garantido por teste.
const _PT_SPEAKER_PREFIXES =
    'Pergunta d|Resposta |Ensinamento d|Orientaç[ãõ]|Palavras d|Fala d|Relato d|' +
    'Coment[áa]rio d|Explicaç[ãa]o d|Declaraç[ãa]o d|Pronunciamento d|Artigo de';
const _JA_SPEAKER_PREFIXES =
    '明主様|信者[のはがを]|記者の発言|新聞記事|お詫び|' +
    '[一-龯ぁ-ヶーA-Za-z]{1,6}氏(?=\\s*(?:の発言)?\\s*<)|[一-龯ぁ-ヶーA-Za-z]{1,4}博士(?=\\s*(?:の発言)?\\s*<)';

// Rótulos de FALA (turnos de diálogo) que, mesmo colados por um <br> SIMPLES a
// uma citação anterior (「…」 / "…"), são quebra de parágrafo — não espaço.
// Sem esta guarda, a regra 3b (adiante) funde "明主様御垂示" / "Resposta de
// Meishu-Sama" no fim da fala anterior (bug: rótulo de resposta grudado). Casa
// tanto o rótulo puro quanto seus prefixos de variante: 明主様御垂示/御発言/
// 御講話/御言葉…, 信者の質問/発言/説明, nome+氏(の発言), 記者の発言, 新聞記事.
// O「氏/博士」exige um「<」logo após (rótulo curto) pra não casar frase longa
// que só cite um nome.
const _SPEAKER_LABEL_AHEAD =
    "(?:<(?:b|i|font[^>]*)>\\s*){0,3}(?:<i>\\s*)?" +
    '(?:' + _JA_SPEAKER_PREFIXES + '|' + _PT_SPEAKER_PREFIXES + ')';

function _normalizeContent(rawContent) {
    const DBLBR = '\x01DBLBR\x01';
    const SGLBR = '\x03SGLBR\x03';
    let norm = _cleanSoftBreakArtifacts(rawContent)
        // 2+3) <br> entre fechamento e abertura de <b>/<font color>: SÓ é
        //     quebra de parágrafo de verdade quando o trecho reaberto é um
        //     RÓTULO isolado — curto (≤80 chars), sem vírgula final, sem
        //     iniciar com minúscula latina, e com outro <br> colado (antes OU
        //     depois do fechamento) marcando linha própria no editor de
        //     origem (ex.: "信者の質問"/"Pergunta do Fiel"/"明主様御垂示"/
        //     "Fala do Sr. Hioki"). Sem essas 3 condições juntas é ênfase
        //     colorida continuando a MESMA frase (ex.: "nossa religião" <br>
        //     "odeia ao máximo..." → viraria parágrafo fantasma bem no meio
        //     da frase) ou um fragmento de oração que só por acaso também
        //     tem <br> dos dois lados (ex.: "...já estão destinadas à
        //     extinção,<br>por mais que..." — vírgula final entrega que
        //     continua). Aplicada 2× (mesma regra, 2 chamadas seguidas):
        //     quando um rótulo-citação (ex.: a pergunta em JA/PT) "rouba" o
        //     <br> que precederia o RÓTULO seguinte (ex.: 信者の質問 ...
        //     resposta_citada <br> 明主様御垂示), sobra um <br> literal que só
        //     fica visível pro regex na 2ª passada. PRECISA rodar ANTES da
        //     regra 1 (abaixo): a regra 1 consome qualquer <br> seguido de
        //     texto puro (inclusive 「 de abertura de citação JA) — se rodasse
        //     primeiro, comeria o <br> logo depois de um rótulo (o sinal que
        //     esta regra usa pra reconhecê-lo) antes desta regra ver o rótulo.
        .replace(_LABEL_BREAK_RE, _labelBreakReplacer(DBLBR))
        .replace(_LABEL_BREAK_RE, _labelBreakReplacer(DBLBR))
        // 1) After closing </b>/<font> tags (any combo), <br> followed by non-tag text → single break
        .replace(/((?:<\/(?:b|strong|font)>\s*)+)<br\s*\/?>\s*(?=[^<])/gi, '$1' + SGLBR)
        // 3b) <br> logo ANTES de um trecho colorido/negrito em destaque (não
        //     precedido por tag de fechamento, senão cairia na regra 2/3) →
        //     vira espaço, não parágrafo. Alguns textos (ex.: ensaios com
        //     frases-chave coloridas inline) usam <br> só pra colocar a frase
        //     de ênfase em linha própria no editor de origem — não é uma
        //     quebra real, e sem isto a extração corta o texto NO MEIO DA
        //     FRASE (ex.: "...quase<br><font color>chegando..." virava
        //     "quase" / "chegando..." como parágrafos separados).
        .replace(new RegExp("<br\\s*\\/?>\\s*(?=<b>\\s*<font\\s+color|<font\\s+color)(?!" + _SPEAKER_LABEL_AHEAD + ")", "gi"), ' ')
        // 4) All remaining <br> → paragraph break (double)
        .replace(/<br\s*\/?>/gi, DBLBR)
        // 5) Date in parentheses followed by text → paragraph break
        .replace(/^(\s*(?:<[^>]+>)*\s*[（(][^）)]*\d+[^）)]*[）)])(?:\s|&nbsp;)+([^（(\s<])/i, '$1' + DBLBR + '$2')
        // 6) After closing bold/font tag, opening paren → single break
        .replace(/^(\s*(?:<\/b>|<\/strong>|\*\*|<\/font>))(?:\s|&nbsp;)*([（(])/i, '$1' + SGLBR + '$2')
        // 7) After closing bold/font tag, regular text → paragraph break (at start only)
        .replace(/^(\s*(?:<\/b>|<\/strong>|\*\*|<\/font>))(?:\s|&nbsp;)+([^（(\s<])/i, '$1' + DBLBR + '$2')
        // 8) Auto-colon on speaker labels
        .replace(_R8_LABEL_COLON_RE, '$1:')
        // 9) Speaker labels → paragraph break before them. EXCETO quando o
        //    rótulo está dentro de uma nota editorial entre parênteses (ex.:
        //    "(Palavras de Meishu-Sama: após advertir sobre um incidente…)"):
        //    aí ele é inline, não uma fala nova, e quebrar antes deixava o "("
        //    órfão numa linha sozinha (e o usuário não conseguia juntar editando
        //    o dado — a quebra era reinserida a cada render). Captura um "("
        //    (ASCII ou fullwidth) opcional imediatamente antes; se houver,
        //    devolve o trecho intacto, sem DBLBR.
        .replace(_R9_LABEL_BREAK_RE, (m, paren, stars, label) => paren ? m : DBLBR + stars + label)
        // 10) Clean up: collapse newlines, normalize spaces
        .replace(/\n/g, ' ')
        .replace(/,\s+/g, ', ')
        // 11) Convert markers to final output
        .replace(/\x01DBLBR\x01/g, '\n\n\x02DBLBR\x02\n\n')
        .replace(/\x03SGLBR\x03/g, '<br/>\n')
        .replace(/[ \t]{2,}/g, ' ').trim();

    let formatted;
    if (typeof marked !== 'undefined' && /(\*\*|__|###|# |\[|\*|_)/.test(norm)) {
        if (typeof marked.parse === 'function') {
            formatted = marked.parse(norm);
        } else {
            formatted = _fallbackFormat(norm);
        }
    } else {
        formatted = _fallbackFormat(norm);
    }
    formatted = formatted.replace(/<p>\s*\x02DBLBR\x02\s*<\/p>/g, '<br>').replace(/\x02DBLBR\x02/g, '<br>');
    formatted = formatted.replace(/,\s*<\/p>\s*\n?\s*<p>/g, ', ');
    formatted = formatted.replace(/,\s*<\/p>\s*\n?<br>\s*\n?<p>/g, ', ');
    // Remove orphan <br> tags between paragraphs — they create unwanted extra space
    formatted = formatted.replace(/<\/p>\s*(<br\s*\/?>\s*)+<p>/gi, '</p>\n<p>');
    // Remove empty <p> tags and stray <b>/<font> wrappers
    formatted = formatted.replace(/<p>\s*(<br\s*\/?>\s*)*<\/p>/gi, '');
    formatted = formatted.replace(/<font>\s*<b>\s*<\/b>\s*<\/font>/gi, '');
    formatted = formatted.replace(/<b>\s*(<br\s*\/?>\s*)*<\/b>/gi, '');
    formatted = formatted.replace(/\s(color|bgcolor|size)=["'][^"']*["']/gi, '').replace(/<font[^>]*>(.*?)<\/font>/gi, '$1');
    formatted = formatted.replace(/<(b|strong|em|i|p)>\s*(<br\s*\/?>|\s|\n)*<\/\1>/gi, '').replace(/<(b|strong|em|i|p)>\s*<\/\1>/gi, '');

    let bCount = 0;
    formatted = formatted.replace(/<(b|strong)>(.*?)<\/\1>/gi, (match, tag, content) => {
        bCount++;
        const plain = content.replace(/<[^>]+>/g, '').trim();
        if (bCount === 1 || /Ensinamento|Orientação|Palestra|Palavras|Pergunta|Resposta|Salmo/i.test(plain)) return match;
        return content;
    });

    formatted = formatted.replace(/style=["']([^"']+)["']/gi, (m, s) => {
        const c = s.replace(/color\s*:\s*[^;]+;?/gi, '').trim();
        return c ? `style="${c}"` : '';
    }).replace(/\sstyle=["']\s*["']/gi, '');
    formatted = formatted.replace(/\u3000+/g, (m) => ' '.repeat(Math.min(m.length, 4)));
    formatted = formatted.replace(/\*([^\*\s][^\*]*?)\*/g, '<i>$1</i>');
    formatted = formatted.replace(/src=["']([^"']+)["']/g, (m, s) => {
        if (s.startsWith('http') || s.startsWith('data:') || s.startsWith('assets/')) return m;
        return `src="assets/images/${s}"`;
    });

    // Quando a quebra de parágrafo cai ENTRE as tags de abertura (<b><font>) e
    // o texto do rótulo (efeito da regra 9 + guarda de rótulo na 3b), as tags de
    // abertura ficam sozinhas num <p> e o fechamento órfão no <p> seguinte
    // (<p><b><font></p><p>Pergunta do fiel:</font></b>). Reúne as tags de abertura
    // no parágrafo do rótulo — assim o rótulo continua em negrito e sem <p> vazio.
    formatted = formatted.replace(/<p>\s*((?:<(?:b|strong|font|i)[^>]*>\s*)+)<\/p>\s*<p>/gi, '<p>$1');

    // Limpa cascas inline vazias (<b><font></font></b>, <font><b></b></font>,
    // qualquer ordem/aninhamento de b/strong/font/i em volta de só espaço) que
    // sobram quando um rótulo de fala é separado das suas tags de abertura, e
    // os <p> que ficam vazios por causa disso — senão viram linha em branco.
    let _prev;
    do {
        _prev = formatted;
        formatted = formatted.replace(/<(b|strong|font|i)>\s*<\/\1>/gi, '');
    } while (formatted !== _prev);
    formatted = formatted.replace(/<p>\s*<\/p>/gi, '');

    return formatted;
}

function _fallbackFormat(norm) {
    return norm.split(/\n\n+/).filter(p => p.trim()).map(p => {
        const t = p.trim();
        return t === '\x02DBLBR\x02' ? '<br>' : `<p>${t}</p>`;
    }).join('\n');
}

function _splitParagraphs(html) {
    const parts = [];
    const regex = /<p>([\s\S]*?)<\/p>/gi;
    let match;
    let lastIndex = 0;
    while ((match = regex.exec(html)) !== null) {
        const between = html.substring(lastIndex, match.index).trim();
        if (between && parts.length > 0) {
            parts[parts.length - 1] += between;
        } else if (between && parts.length === 0) {
            parts.push(between);
        }
        parts.push(match[0]);
        lastIndex = regex.lastIndex;
    }
    const trailing = html.substring(lastIndex).trim();
    if (trailing && parts.length > 0) {
        parts[parts.length - 1] += trailing;
    } else if (trailing) {
        parts.push(trailing);
    }
    if (parts.length === 0 && html.trim()) parts.push(html.trim());
    return parts;
}

function _stripHeader(raw) {
    const m = raw.match(/^([\s\S]{0,350}?)\(([^)]*\d+[^)]*)\)/);
    if (m) {
        const pre = m[1].replace(/<[^>]+>/g, '').trim();
        if (pre.length > 3 && pre.length < 250 && !pre.includes('。') && !pre.includes('. ')) {
            return raw.substring(m[0].length).replace(/^([\s\n]*<br\s*\/?>[\s\n]*)+/gi, '');
        }
    }
    const titleMatch = raw.match(/^\s*(?:<b[^>]*>(?:<font[^>]*>)?[^<]*(?:<\/font>)?<\/b>)\s*/);
    if (titleMatch) {
        return raw.substring(titleMatch[0].length).replace(/^([\s\n]*<br\s*\/?>[\s\n]*)+/gi, '');
    }
    return raw;
}
