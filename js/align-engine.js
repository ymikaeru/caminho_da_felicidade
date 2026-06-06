// ============================================================
// align-engine.js — motor de alinhamento JA↔PT (função PURA, sem deps).
// Roda em node (varredura/testes) e no browser (preview no admin).
//
// MODELO (corrigido): o alinhamento do modo comparação é por <br>. O JA é a
// FONTE — seus blocos <br> (≈4–11 por artigo) definem onde ficam as quebras.
// O PT deve receber <br> NOS MESMOS TRECHOS, ficando com o MESMO nº de blocos
// do JA. Não é frase a frase; é sincronização de <br>.
//
//   JA: NÃO é tocado (fonte). Seus <br> ficam como estão.
//   PT: recebe <br> nos pontos correspondentes aos blocos do JA.
//        - determinístico quando os parágrafos naturais do PT (\n\n / <br>) já
//          dão o mesmo nº de blocos do JA → vira só converter em <br>.
//        - senão precisa de IA (agrupar/selecionar quais quebras do PT
//          correspondem aos blocos do JA). O motor só sinaliza; a IA roda fora.
//
// Invariante (o chamador DEVE validar): o PT só pode GANHAR <br> — remover os
// <br> da proposta tem que devolver exatamente as palavras do PT original.
// ============================================================

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.AlignEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BR_RE = /<br\s*\/?>/gi;

  // ── Portados VERBATIM do leitor (reader-content.js / reader-render.js) ──
  // Mantidos em sincronia para que node (varredura), browser (admin) e o
  // leitor concordem no MESMO pareamento. Se o leitor mudar, atualizar aqui.
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
  function splitRaw(raw) {
    return _stripHeader(raw || '').split(/<br\s*\/?>[\s\n]*/gi).filter(s => s.trim());
  }
  const PART_HEADING_RE = /^(?:第\s*[一二三四五六七八九十百千\d]+|Parte\s+(?:[IVXLCDM]+|\d+))$/i;
  function isPartHeading(seg) {
    const txt = seg.replace(/<[^>]+>/g, '').replace(/[\s　]+/g, ' ').trim();
    return !!txt && txt.length <= 20 && PART_HEADING_RE.test(txt);
  }
  function mergeHeadings(segs) {
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      if (isPartHeading(segs[i]) && i + 1 < segs.length) { out.push(segs[i] + ' ' + segs[i + 1]); i++; }
      else out.push(segs[i]);
    }
    return out;
  }
  // Segmentos EXATAMENTE como o leitor pareia no modo comparação (por <br>).
  function readerSegs(raw) { return mergeHeadings(splitRaw(raw)); }

  // Texto-só (sem tags/br, espaços normalizados) p/ comparar palavras.
  function wordsOnly(s) {
    return (s || '').replace(BR_RE, ' ').replace(/<[^>]+>/g, ' ').replace(/[\s　]+/g, ' ').trim();
  }
  const stripTags = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  // Parágrafos naturais do PT (como o tradutor marcou): \n\n+ E <br>.
  function splitPtParas(pt) {
    return (pt || '')
      .split(/\s*(?:<br\s*\/?>\s*)+|\n{2,}/g)
      .map(x => x.replace(/^\s+|\s+$/g, ''))
      .filter(Boolean);
  }

  // ── PAREDÃO (problema real: monólogos cujos parágrafos não renderizam) ──
  // Conserto: os parágrafos pretendidos (\n\n e <br>) viram <br/> reais, que o
  // leitor renderiza. Preserva as palavras (só troca separador). Determinístico.
  function wallFix(ptRaw) { return splitPtParas(ptRaw).join('<br/>'); }

  // Rótulos de fala que o reader-content.js (regra 9) já quebra em parágrafo —
  // por isso Q&A renderizam em turnos SEM <br>. Mantido em sincronia com o leitor.
  const SPEAKER_LABELS = /(Pergunta do? (?:um )?fiel|Explicação do fiel|Orientação de Meishu-Sama|Ensinamento de Meishu-Sama|Resposta de Meishu-Sama|Coment[aá]rio do [Ff]iel|Palavras de Meishu-Sama|Fala do Dr\. Braden|Fala de Meishu-Sama)/gi;
  // Quantos parágrafos o leitor REALMENTE mostra hoje (aprox., sem _normalizeContent):
  // 1 + <br> + rótulos de fala (regra 9). É o que estava faltando na detecção.
  function renderedParasProxy(pt) {
    return 1 + (((pt || '').match(BR_RE) || []).length) + (((pt || '').match(SPEAKER_LABELS) || []).length);
  }
  // Paredão = o tradutor pretendeu MUITO mais parágrafos do que renderizam.
  function isWall(pt, threshold = 4) {
    return splitPtParas(pt).length - renderedParasProxy(pt) >= threshold;
  }

  // Valida uma proposta de PT segmentado: só pode ter GANHADO <br> (palavras
  // idênticas ao original) e devolve quantos blocos o leitor enxergaria.
  function validatePtSegmentation(ptOriginal, ptCandidate) {
    return {
      wordsOk: wordsOnly(ptCandidate) === wordsOnly(ptOriginal),
      blocks: readerSegs(ptCandidate).length,
    };
  }

  // Divide o PT em FRASES (pontos onde um <br> pode entrar — "após o ponto
  // final" / linha em branco). Tira <br> antigos (re-sincroniza do zero).
  // LOSSLESS: concatenar as peças devolve o PT (sem <br>) char-a-char, então
  // remontar inserindo <br/> preserva o texto. Os "gaps" entre peças i e i+1
  // são os candidatos a quebra.
  const PT_CLOSER = /["'”’»)\]】」』]/;
  function splitPtSentences(ptRaw) {
    const pt = (ptRaw || '').replace(BR_RE, '');
    const out = [];
    let buf = '';
    for (let i = 0; i < pt.length; i++) {
      const ch = pt[i];
      buf += ch;
      if (ch === '.' || ch === '!' || ch === '?' || ch === '。' || ch === '！' || ch === '？') {
        while (i + 1 < pt.length && PT_CLOSER.test(pt[i + 1])) buf += pt[++i];
        out.push(buf); buf = '';
      } else if (ch === '\n' && pt[i + 1] === '\n') {
        out.push(buf); buf = '';
      }
    }
    if (buf) out.push(buf);
    // peças só-espaço grudam na anterior (mantém lossless)
    const merged = [];
    for (const p of out) { if (!p.trim() && merged.length) merged[merged.length - 1] += p; else merged.push(p); }
    return merged;
  }

  // Remonta o PT inserindo <br/> após as frases cujos índices estão em breakSet
  // (Set de inteiros = índice da frase APÓS a qual entra a quebra). Texto intacto.
  function assemblePt(sentences, breakSet) {
    let out = '';
    for (let i = 0; i < sentences.length; i++) {
      out += sentences[i];
      if (i < sentences.length - 1 && breakSet.has(i)) out = out.replace(/\s+$/, '') + '<br/>';
    }
    return out;
  }

  // Insere <br/> no PT NAS POSIÇÕES das frases-âncora (início de cada bloco
  // do JA, a partir do 2º). Acha cada âncora no texto (tolerante a pontuação/
  // espaços/maiúsculas), em ordem (monotônico). Só INSERE <br/> — texto intacto.
  // Devolve { ptNew, blocks, missing[] }.
  function insertBreaksByAnchors(ptRaw, anchors) {
    const pt = (ptRaw || '').replace(BR_RE, '');     // tira <br> antigos (re-sincroniza)
    const SEP = '[^\\p{L}\\p{N}]+';
    const positions = [];
    const missing = [];
    let cursor = 0;
    for (const a of (anchors || [])) {
      const words = String(a).trim().split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))   // tira **, aspas, etc.
        .filter(Boolean).slice(0, 8);
      if (!words.length) { missing.push(a); continue; }
      let re;
      try { re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(SEP), 'iu'); }
      catch { missing.push(a); continue; }
      const m = pt.slice(cursor).match(re);
      if (!m) { missing.push(a); continue; }
      const pos = cursor + m.index;
      positions.push(pos);
      cursor = pos + m[0].length;
    }
    let ptNew = '';
    let last = 0;
    for (const pos of positions) {
      ptNew += pt.slice(last, pos).replace(/\s+$/, '') + '<br/>';
      last = pos;
    }
    ptNew += pt.slice(last);
    return { ptNew, blocks: readerSegs(ptNew).length, missing };
  }

  // ── Núcleo ────────────────────────────────────────────────────────────
  // Recebe { ja, pt } crus. Não toca no JA. Para o PT: tenta o atalho
  // determinístico; se não der, sinaliza needsAI (a IA roda no chamador).
  function buildAlignment(jaRaw, ptRaw) {
    const ja = jaRaw || '';
    const pt = ptRaw || '';

    const jaBlocks = readerSegs(ja);          // FONTE: blocos do JA (por <br>)
    const ptBlocks = readerSegs(pt);          // blocos atuais do PT
    const N_ja = jaBlocks.length;
    const N_pt = ptBlocks.length;

    const jaHasStructure = N_ja > 1;          // sem isso não há o que sincronizar
    const needsFix = jaHasStructure && N_ja !== N_pt;

    // Classifica o conserto:
    //   aligned       — já bate, nada a fazer
    //   untranslated  — PT vazio (sem tradução p/ alinhar)
    //   deterministic — parágrafos naturais do PT já dão N_ja blocos → converte
    //   ai            — agrupável: PT tem >= N_ja parágrafos → IA escolhe os pontos
    //   split         — PT tem < N_ja parágrafos → precisaria quebra DENTRO de
    //                   um parágrafo (não suportado por agrupamento)
    const ptParas = splitPtParas(pt);
    let ptNew = null;
    let method = 'aligned';
    if (needsFix) {
      if (N_pt === 0) {
        method = 'untranslated';
      } else {
        const candidate = ptParas.join('<br/>');
        if (readerSegs(candidate).length === N_ja && wordsOnly(candidate) === wordsOnly(pt)) {
          ptNew = candidate;
          method = 'deterministic';
        } else {
          // âncoras inserem <br> em qualquer ponto (até no meio de parágrafo),
          // então tanto agrupar quanto dividir caem no mesmo fluxo de IA.
          method = 'ai';
        }
      }
    }

    const ptWordsOk = ptNew == null ? true : wordsOnly(ptNew) === wordsOnly(pt);

    return {
      ja, pt,
      jaBlocks,                                // p/ exibir (lado JA) e referência da IA
      jaBlocksClean: jaBlocks.map(stripTags),
      N_ja, N_pt,
      ptParas,
      jaHasStructure,
      needsFix,
      method,                                  // aligned|untranslated|deterministic|ai|split
      ptParaCount: ptParas.length,
      ptNew,                                   // proposta determinística (ou null → IA)
      ptPreview: ptNew ? readerSegs(ptNew) : null,
      invariants: { ptWordsOk },
    };
  }

  return {
    buildAlignment,
    validatePtSegmentation,
    insertBreaksByAnchors,
    splitPtSentences,
    assemblePt,
    splitPtParas,
    wallFix,
    isWall,
    renderedParasProxy,
    readerSegs,
    splitRaw,
    _stripHeader,
    wordsOnly,
    stripTags,
  };
});
