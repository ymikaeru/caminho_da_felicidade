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

function _normalizeContent(rawContent) {
    const DBLBR = '\x01DBLBR\x01';
    const SGLBR = '\x03SGLBR\x03';
    let norm = _cleanSoftBreakArtifacts(rawContent)
        // 1) After closing </b>/<font> tags (any combo), <br> followed by non-tag text → single break
        .replace(/((?:<\/(?:b|strong|font)>\s*)+)<br\s*\/?>\s*(?=[^<])/gi, '$1' + SGLBR)
        // 2) <br> between closing tags and opening <b> or <font> → paragraph break (new section)
        .replace(/((?:<\/(?:b|strong|font)>\s*)+)<br\s*\/?>\s*(?=<b)/gi, '$1' + DBLBR)
        // 3) <br> between closing tags and opening <font color=...> → paragraph break
        .replace(/((?:<\/(?:b|strong|font)>\s*)+)<br\s*\/?>\s*(?=<font\s+color)/gi, '$1' + DBLBR)
        // 3b) <br> logo ANTES de um trecho colorido/negrito em destaque (não
        //     precedido por tag de fechamento, senão cairia na regra 2/3) →
        //     vira espaço, não parágrafo. Alguns textos (ex.: ensaios com
        //     frases-chave coloridas inline) usam <br> só pra colocar a frase
        //     de ênfase em linha própria no editor de origem — não é uma
        //     quebra real, e sem isto a extração corta o texto NO MEIO DA
        //     FRASE (ex.: "...quase<br><font color>chegando..." virava
        //     "quase" / "chegando..." como parágrafos separados).
        .replace(/<br\s*\/?>\s*(?=<b>\s*<font\s+color|<font\s+color)/gi, ' ')
        // 4) All remaining <br> → paragraph break (double)
        .replace(/<br\s*\/?>/gi, DBLBR)
        // 5) Date in parentheses followed by text → paragraph break
        .replace(/^(\s*(?:<[^>]+>)*\s*[（(][^）)]*\d+[^）)]*[）)])(?:\s|&nbsp;)+([^（(\s<])/i, '$1' + DBLBR + '$2')
        // 6) After closing bold/font tag, opening paren → single break
        .replace(/^(\s*(?:<\/b>|<\/strong>|\*\*|<\/font>))(?:\s|&nbsp;)*([（(])/i, '$1' + SGLBR + '$2')
        // 7) After closing bold/font tag, regular text → paragraph break (at start only)
        .replace(/^(\s*(?:<\/b>|<\/strong>|\*\*|<\/font>))(?:\s|&nbsp;)+([^（(\s<])/i, '$1' + DBLBR + '$2')
        // 8) Auto-colon on speaker labels
        .replace(/(Pergunta do? (?:um )?fiel|Explicação do fiel|Orientação de Meishu-Sama|Comentário do [Ff]iel|Resposta de Meishu-Sama|Ensinamento de Meishu-Sama|Palavras de Meishu-Sama|Fala do Dr\. Braden|Fala de Meishu-Sama)(?!\s*[:：])/gi, '$1:')
        // 9) Speaker labels → paragraph break before them. EXCETO quando o
        //    rótulo está dentro de uma nota editorial entre parênteses (ex.:
        //    "(Palavras de Meishu-Sama: após advertir sobre um incidente…)"):
        //    aí ele é inline, não uma fala nova, e quebrar antes deixava o "("
        //    órfão numa linha sozinha (e o usuário não conseguia juntar editando
        //    o dado — a quebra era reinserida a cada render). Captura um "("
        //    (ASCII ou fullwidth) opcional imediatamente antes; se houver,
        //    devolve o trecho intacto, sem DBLBR.
        .replace(/([（(]?)(\*{0,2})(Pergunta do? (?:um )?fiel|Explicação do fiel|Orientação de Meishu-Sama|Ensinamento de Meishu-Sama|Resposta de Meishu-Sama|Comentário do [Ff]iel|Palavras de Meishu-Sama|Fala do Dr\. Braden|Fala de Meishu-Sama)/gi, (m, paren, stars, label) => paren ? m : DBLBR + stars + label)
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
