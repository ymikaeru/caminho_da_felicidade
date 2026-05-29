// ============================================================
// READER RENDER — renderReader() standalone function
// Depends on: _normalizeContent, _stripHeader (reader-content.js)
//             window._readerContainer, window._genericRegex (set by reader.js)
// ============================================================

// Formata um título com aspas em "Prefix: Título". Sem aspas, retorna o
// texto como está (com pequenas normalizações). O bug que isso evita:
// antes a lógica usava /^([^:]+)/ pra capturar o prefix, que quando o
// título não tinha ':' capturava a string inteira (inclusive as aspas)
// e o template final ': title' duplicava o título.
function _formatQuotedTitle(rawTitle) {
    let t = rawTitle;
    const quoteMatch = t.match(/[""]([^""]+)[""]/);
    if (!quoteMatch) {
        return t.replace(/\s+-\s+/, ': ').replace(/\s+:/, ':');
    }
    // Acha o primeiro separador (:, -, ou abertura das aspas) e usa
    // tudo antes dele como prefix.
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

// Carrega manual_citation_links.json (Supabase Storage com fallback local)
// em background na primeira chamada. Resultado merge no window._partialCitations.
let _manualCitationsPromise = null;
function _loadManualCitations() {
    if (_manualCitationsPromise) return _manualCitationsPromise;
    _manualCitationsPromise = (async () => {
        try {
            // Tenta Storage primeiro (admin pode ter publicado update)
            if (window.supabaseStorageFetch) {
                try {
                    const data = await window.supabaseStorageFetch('data/manual_citation_links.json');
                    if (data?.links) return data.links;
                } catch (_) { /* fallback local */ }
            }
            const res = await fetch('data/manual_citation_links.json');
            if (res.ok) {
                const data = await res.json();
                return data?.links || {};
            }
        } catch (_) {}
        return {};
    })();
    return _manualCitationsPromise;
}

// Se este tópico for uma citação parcial mapeada (auto OU manual),
// devolve HTML de um link "Ler texto completo" que abre o ensinamento
// completo correspondente em NOVA ABA. Caso contrário, string vazia.
//
// Manual links têm prioridade sobre auto (admin pode corrigir falsos
// positivos). Manual links são carregados async — primeira renderização
// pode mostrar só os auto; após o load, a próxima renderização pega os
// manuais. Para forçar re-render, usar onload listener no fetch.
function _buildPartialCitationCTA(volId, filename, topicIdx, lang) {
    try {
        const key = `${volId}/${filename}#${topicIdx}`;
        const auto = window._partialCitations || {};
        const manual = window._partialCitationsManual || {};
        const target = manual[key] || auto[key];
        if (!target) return '';
        // Entries marcadas como "sem conteúdo inteiro" não geram CTA — só
        // ficam no admin como TODO pra buscar fonte externa depois.
        if (target.type === 'no_full_text') return '';
        const l = lang === 'ja'
            ? { label: '全文を読む', sub: '出典' }
            : { label: 'Ler o ensinamento completo', sub: 'Fonte' };
        const targetTitle = (target.title_pt || target.title_jp || '').replace(/<[^>]+>/g, '').trim();
        const escTitle = targetTitle.replace(/"/g, '&quot;');
        // Preserva ?lang=ja na URL do destino se a página atual estiver em JP.
        const langSuffix = window.location.search.includes('lang=ja') ? '&lang=ja' : '';
        const targetUrl = `reader.html?vol=${encodeURIComponent(target.vol)}&file=${encodeURIComponent(target.file)}&topic=${target.topic_idx}${langSuffix}`;
        // Omite o "— Título" quando o targetTitle vier vazio (manual links
        // antigos só guardavam vol/file/topic_idx, sem title). Evita o
        // travessão solto "— " no fim do CTA.
        const titleSuffix = targetTitle
            ? `<span style="opacity:.5; font-size:.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escTitle}">— ${escTitle}</span>`
            : '';
        return `
            <div class="topic-partial-cta" style="margin: 16px 0 8px; padding: 12px 16px; background: var(--accent-soft); border: 1px solid var(--border); border-radius: 6px; display: flex; align-items: center; gap: 10px; font-size: 0.88rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; opacity:.65" aria-hidden="true">
                    <path d="M7 17l10-10M7 7h10v10"/>
                </svg>
                <span style="opacity:.7;">${l.sub}:</span>
                <a href="${targetUrl}" target="_blank" rel="noopener" style="color: var(--text-main); text-decoration: underline; text-underline-offset: 2px;">
                    ${l.label}
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px; margin-left:2px; opacity:.7;">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                </a>
                ${titleSuffix}
            </div>
        `;
    } catch (_) { return ''; }
}

function _buildTopicSaveBar(topicIdx, lang) {
    const l = { pt: { save: 'Salvar esta publicação', saved: 'Publicação salva' }, ja: { save: 'この教えを保存', saved: '保存済み' } }[lang] || { save: 'Salvar esta publicação', saved: 'Publicação salva' };
    const icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';

    // Botões admin: "Adicionar à playlist" + "Recomendar este ensinamento".
    // Ambos passam topic_idx explícito pros pickers — desambigua qual
    // ensinamento está sendo agido em páginas com múltiplos tópicos.
    let adminBtns = '';
    if (typeof isAdminUser === 'function' && isAdminUser()) {
        const plLabel = lang === 'ja' ? 'プレイリストに追加' : 'Adicionar à playlist';
        const plIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>';
        const recLabel = lang === 'ja' ? 'この教えを推薦' : 'Recomendar este ensinamento';
        const recIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
        adminBtns =
            `<button type="button" class="topic-save-btn topic-playlist-btn" data-topic-idx="${topicIdx}" title="${plLabel}" aria-label="${plLabel}" onclick="if (typeof openPlaylistAddPicker === 'function') openPlaylistAddPicker(${topicIdx});">` +
                plIcon +
            `</button>` +
            `<button type="button" class="topic-save-btn topic-recommend-btn" data-topic-idx="${topicIdx}" title="${recLabel}" aria-label="${recLabel}" onclick="if (typeof openRecommendPicker === 'function') openRecommendPicker(${topicIdx});">` +
                recIcon +
            `</button>`;
    }

    return `<div class="topic-save-bar" data-topic-idx="${topicIdx}">` +
        `<button type="button" class="topic-save-btn" data-topic-idx="${topicIdx}" title="${l.save}" aria-label="${l.save}" onclick="window.toggleFavorite(${topicIdx})">` +
            icon +
            `<span class="topic-save-label" data-save="${l.save}" data-saved="${l.saved}">${l.save}</span>` +
        `</button>` +
        adminBtns +
    `</div>`;
}

function renderReader(volId, filename, json, allFiles, searchQuery, searchTopicTitle, hlScroll) {
    const container = window._readerContainer;
    const genericRegex = window._genericRegex;
    const lang = localStorage.getItem('site_lang') || 'pt';
    const isPt = lang === 'pt';
    window._usedNavTitles = new Set();

    // Carrega manual_citation_links.json (Storage com fallback local) e
    // dispara re-render se novas entradas chegarem após o 1º paint. Mantém
    // CTA do "Ler texto completo" disponível mesmo pra mapeamentos manuais
    // publicados após o build do site_data/partial_citations_index.js.
    if (!window._partialCitationsManual && !window._partialCitationsManualLoading) {
        window._partialCitationsManualLoading = true;
        _loadManualCitations().then((links) => {
            window._partialCitationsManual = links;
            window._partialCitationsManualLoading = false;
            // Re-render se algum tópico da página atual tem manual link
            try {
                const keys = Object.keys(links || {});
                const here = `${volId}/${filename}#`;
                if (keys.some((k) => k.startsWith(here)) && typeof renderReader === 'function') {
                    renderReader(volId, filename, json, allFiles, searchQuery, searchTopicTitle, hlScroll);
                }
            } catch (_) {}
        });
    }

    let topicsFound = [];
    let themeSectionName = '';
    if (json && json.themes) {
        json.themes.forEach(theme => {
            if (theme.topics) {
                const themeTitle = theme.title || '';
                theme.topics.forEach(topic => {
                    topic._themeTitle = themeTitle;
                    topicsFound.push(topic);
                });
                if (themeTitle && !themeSectionName) {
                    themeSectionName = themeTitle;
                }
            }
        });
    }

    if (topicsFound.length === 0) {
        container.innerHTML = `<div class="error">Tópico não encontrado.</div>`;
        return;
    }

    const fnameOnly = filename.split('/').pop();
    const currentIndex = allFiles.indexOf(fnameOnly);
    const prevFile = currentIndex > 0 ? allFiles[currentIndex - 1] : null;
    const nextFile = currentIndex < allFiles.length - 1 ? allFiles[currentIndex + 1] : null;

    // Title resolution — prioritize SECTION_MAP (correct section names)
    // over GLOBAL_INDEX_TITLES (which may store per-file topic titles)
    let indexTitle = '';
    let sectionName = '';
    let cardNumber = '';  // numero do card no indice estatico (topic-card__icon)
    try {
        const sectionMap = window.SECTION_MAP || {};
        const volSections = sectionMap[volId] || {};
        const sectObj = volSections[filename];
        if (sectObj) {
            indexTitle = isPt ? sectObj.pt : (sectObj.ja || sectObj.pt);
            if (sectObj.n) cardNumber = String(sectObj.n);
            // Extract section name from the section key
            for (const [fileKey, secData] of Object.entries(volSections)) {
                if (fileKey === filename && secData.section) {
                    sectionName = isPt ? secData.section : (secData.sectionJa || secData.section);
                    break;
                }
            }
        }
    } catch (e) { }
    if (!indexTitle) {
        let indexTitles = {};
        try { indexTitles = window.GLOBAL_INDEX_TITLES || {}; } catch (e) { }
        const indexTitlesForVol = indexTitles[volId] || {};
        indexTitle = indexTitlesForVol[filename];
        if (!indexTitle && filename) {
            const baseFile = filename.split('/').pop().toLowerCase();
            const matchingKey = Object.keys(indexTitlesForVol).find(k => k.toLowerCase() === baseFile || k.toLowerCase() === filename.toLowerCase());
            if (matchingKey) indexTitle = indexTitlesForVol[matchingKey];
        }
    }
    const jaSpecificTitle = topicsFound[0].title_ja || topicsFound[0].title;
    const ptSpecificTitle = topicsFound[0].title_ptbr || topicsFound[0].title_pt || topicsFound[0].title;
    let mainTitleToDisplay = indexTitle || (isPt ? ptSpecificTitle : jaSpecificTitle);
    if (!isPt && mainTitleToDisplay) {
        const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(mainTitleToDisplay);
        if (!hasJapanese && jaSpecificTitle && jaSpecificTitle !== mainTitleToDisplay) {
            mainTitleToDisplay = jaSpecificTitle;
        }
    }

    window._currentTopics = topicsFound;
    window._currentTotalTopics = topicsFound.length;

    const cleanTitle = mainTitleToDisplay.replace(/<br\s*\/?>/gi, ' ');
    document.title = `Meishu-Sama: ${cleanTitle} - Caminho da Felicidade`;
    try {
        const history = JSON.parse(localStorage.getItem('readHistory') || '[]');
        const existing = history.find(h => h.file === filename && h.vol === volId);
        const filtered = history.filter(h => h.file !== filename || h.vol !== volId);
        // Preserva o topic da entrada existente — se for resetado pra 0
        // toda vez que o artigo é aberto, o "Histórico de Navegação"
        // fica sempre mostrando 0% mesmo quando o usuário tinha avançado.
        // Só reseta se topic estiver fora do range (artigo encurtou).
        const preservedTopic = (existing && existing.topic > 0 && existing.topic < topicsFound.length)
            ? existing.topic
            : 0;
        filtered.unshift({ title: cleanTitle, vol: volId, file: filename, time: Date.now(), topic: preservedTopic, totalTopics: topicsFound.length });
        localStorage.setItem('readHistory', JSON.stringify(filtered.slice(0, 20)));
    } catch (e) { }

    const backBtn = document.getElementById('backToIndexBtn');
    if (backBtn) {
        const volMap = { mioshiec1: 'mioshiec1/index.html', mioshiec2: 'mioshiec2/index.html', mioshiec3: 'mioshiec3/index.html', mioshiec4: 'mioshiec4/index.html' };
        backBtn.href = volMap[volId] || 'index.html';
        backBtn.style.display = 'flex';
    }

    const nl = { pt: { prev: '← Anterior', next: 'Próximo →' }, ja: { prev: '← 前へ', next: '次へ →' } }[lang] || { prev: '← Anterior', next: 'Próximo →' };
    const esc = (s) => s.replace(/'/g, '\\&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const navFooter = `
        <div class="reader-nav-footer" style="display: flex; justify-content: space-between; margin-top: 64px; padding-top: 32px; border-top: 1px solid var(--border);">
            ${prevFile ? `<button type="button" onclick="navigateToReader('${esc(volId)}','${esc(prevFile)}')" class="btn-zen" style="cursor:pointer">${nl.prev}</button>` : '<span></span>'}
            ${nextFile ? `<button type="button" onclick="navigateToReader('${esc(volId)}','${esc(nextFile)}')" class="btn-zen" style="cursor:pointer">${nl.next}</button>` : '<span></span>'}
        </div>`;

    // Build topic HTML
    let contentHtml = '';
    topicsFound.forEach((topicData, index) => {
        const topicId = `topic-${index}`;
        let rawContent = isPt ? (topicData.content_ptbr || topicData.content_pt || topicData.content || '') : (topicData.content || '');
        const activeTitle = isPt ? (topicData.title_ptbr || topicData.title_pt || topicData.publication_title_pt || '') : (topicData.title_ja || topicData.title || '');

        let headerHTML = '';
        // Fragmentos (continues_previous) não têm cabeçalho real — pular toda a
        // extração de cabeçalho. Ela MUTA rawContent (substring) e descartaria o
        // início do trecho citado, que aqui é texto, não título.
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
                headerHTML = `<b><font size="+2">${pt0.charAt(0).toUpperCase() + pt0.slice(1)}</font></b><br/>(${dateText})<br/><br/>`;
                rawContent = rawContent.substring(headerMatch[0].length).replace(/^([\s\n]*<br\s*\/?>[\s\n]*)+/gi, '');
            }
        }

        if (!headerHTML) {
            const contentAlreadyHasTitle = /^\s*<b[\s>]/i.test(rawContent.trim()) || /^\s*<font[\s>]/i.test(rawContent.trim());
            if (contentAlreadyHasTitle) {
                const titleMatch = rawContent.match(/^(\s*<b[^>]*>(?:<font[^>]*>)?([^<]*)(?:<\/font>)?<\/b>)\s*/);
                if (titleMatch && titleMatch[2].trim()) {
                    const t = titleMatch[2].trim();
                    headerHTML = `<b><font size="+2">${t.charAt(0).toUpperCase() + t.slice(1)}</font></b><br/>`;
                    rawContent = rawContent.substring(titleMatch[0].length).replace(/^([\s\n]*<br\s*\/?>[\s\n]*)+/gi, '');
                } else {
                    rawContent = rawContent.replace(/^(\s*<b[^>]*>(?:<font[^>]*>)?[^<]*(?:<\/font>)?<\/b>)\s+/, '$1<br/>');
                }
            }
            if (activeTitle && rawContent.trim() && !genericRegex.test(activeTitle) && !contentAlreadyHasTitle) {
                const cTitle = activeTitle.replace(/<[^>]+>/g, '').replace(/[\u3000\s\d\W]/g, '').toLowerCase();
                const cStart = rawContent.substring(0, 500).replace(/<[^>]+>/g, '').replace(/[\u3000\s\d\W]/g, '').toLowerCase();
                if (cTitle.length > 5 && !cStart.includes(cTitle)) {
                    let pureTitle = _formatQuotedTitle(activeTitle);
                    const displayDate = topicData.date && topicData.date !== 'Unknown' ? `<br/>\n(${topicData.date})` : '';
                    const pt1 = pureTitle.replace(/^\*\*|\*\*$/g, '');
                    headerHTML = `<b><font size="+2">${pt1.charAt(0).toUpperCase() + pt1.slice(1)}</font></b>${displayDate}<br/><br/>`;
                }
            }
        }
        } // /if (!continues_previous) — fim da extração de cabeçalho

        let formatted = _normalizeContent(rawContent);

        // Anota cada <p> top-level com data-p-idx pra permitir
        // posição de leitura granular por parágrafo. Saving lê o
        // <p> mais central no viewport; resume scrolla até ele.
        {
            let _pIdx = 0;
            formatted = formatted.replace(/<p(\s|>)/gi, (_, end) => `<p data-p-idx="${_pIdx++}"${end}`);
        }

        // Fragmento de extração (continues_previous): uma palavra enfatizada
        // (<font size="+2"><b>…) foi lida como título e cortou a frase no meio,
        // criando um tópico falso que começa no meio do texto. Renderiza sem
        // cabeçalho, sem barra de botões e sem o gap de 40px, pra o texto fluir
        // no tópico anterior. IMPORTANTE: o tópico CONTINUA no array (mesmo
        // topic_idx) — só some visualmente; favoritos/posições/grifos não mudam.
        const isCont = !!topicData.continues_previous;
        const topMargin = isCont ? '0' : (index > 0 ? '40px' : '0');
        const topHeader = isCont ? '' : `${headerHTML}\n${_buildTopicSaveBar(index, lang)}\n${_buildPartialCitationCTA(volId, filename, index, lang)}`;
        const contClass = isCont ? ' topic-continuation' : '';

        const comparisonMode = localStorage.getItem('reader_comparison') === 'true';
        if (comparisonMode) {
            const rawJa = _stripHeader(topicData.content || '');
            const rawPt = _stripHeader(topicData.content_ptbr || topicData.content_pt || topicData.content || '');
            const splitRaw = (raw) => raw.split(/<br\s*\/?>[\s\n]*/gi).filter(s => s.trim());
            const jaSegs = splitRaw(rawJa);
            const ptSegs = splitRaw(rawPt);
            const maxLen = Math.max(jaSegs.length, ptSegs.length);
            let gridHtml = '', interleavedHtml = '';
            for (let pi = 0; pi < maxLen; pi++) {
                const jaSeg = jaSegs[pi] ? _normalizeContent(jaSegs[pi]) : '';
                const ptSeg = ptSegs[pi] ? _normalizeContent(ptSegs[pi]) : '';
                gridHtml += `<div class="comparison-row"><div class="comparison-cell ja">${jaSeg}</div><div class="comparison-cell pt">${ptSeg}</div></div>`;
                interleavedHtml += `<div class="comparison-pair"><div class="comparison-cell ja">${jaSeg}</div><div class="comparison-cell pt">${ptSeg}</div></div>`;
            }
            contentHtml += `<div id="${topicId}" class="topic-content comparison-mode${contClass}" style="margin-top: ${topMargin};">
                ${topHeader}
                <div class="comparison-labels"><span>日本語</span><span>Português</span></div>
                <div class="comparison-grid">${gridHtml}</div>
                <div class="comparison-interleaved">${interleavedHtml}</div>
            </div>`;
        } else {
            contentHtml += `<div id="${topicId}" class="topic-content${contClass}" style="margin-top: ${topMargin};">\n${topHeader}\n${formatted}\n</div>`;
        }
    });

    const bl = { pt: { home: 'Início', volume: 'Volume' }, ja: { home: 'トップ', volume: '巻' } }[lang] || { home: 'Início', volume: 'Volume' };

    const specificTitle = isPt ? ptSpecificTitle : jaSpecificTitle;

    const cleanIndexTitle = indexTitle ? indexTitle.replace(/<br\s*\/?>/gi, ' ') : '';
    const cleanSpecificTitle = specificTitle ? specificTitle.replace(/<br\s*\/?>/gi, ' ') : '';
    const cleanSectionName = sectionName ? sectionName.replace(/<br\s*\/?>/gi, ' ') : '';
    const cleanThemeSection = themeSectionName ? themeSectionName.replace(/<br\s*\/?>/gi, ' ') : '';
    const effectiveSection = cleanSectionName || cleanThemeSection;

    // Classes bc-* permitem o CSS mobile esconder o "Início" e a seção
    // (junto com seus separadores adjacentes via :has(+ ...)), preservando
    // só "Volume N / Título #N" — ver _reader.css @media (max-width:767px).
    let bcParts = [];
    bcParts.push(`<a class="bc-home" href="index.html">${bl.home}</a>`);
    bcParts.push(`<a class="bc-volume" href="${volId}/index.html">${bl.volume} ${volId.slice(-1)}</a>`);
    if (effectiveSection) {
        // Link da seção pula direto pro #section-N correspondente no índice
        // estático — assume que section_map.js está em sync com index.html
        // (alimentado por generate_maps.py).
        let sectionAnchor = '';
        try {
            const volMap = (window.SECTION_MAP || {})[volId] || {};
            const seenSecs = [];
            for (const fk of Object.keys(volMap)) {
                const s = volMap[fk]?.section;
                if (s && !seenSecs.includes(s)) seenSecs.push(s);
            }
            const idx = seenSecs.indexOf(effectiveSection);
            if (idx >= 0) sectionAnchor = `#section-${idx}`;
        } catch (e) { }
        bcParts.push(`<a class="bc-section" href="${volId}/index.html${sectionAnchor}">${effectiveSection}</a>`);
    }

    if (cleanIndexTitle) {
        const numSuffix = cardNumber
            ? ` <span class="bc-num" style="color:var(--text-muted); font-weight:400;">#${cardNumber}</span>`
            : '';
        bcParts.push(`<span class="bc-current" style="color:var(--text-main)">${cleanIndexTitle}${numSuffix}</span>`);
    }

    const breadcrumbsHtml = bcParts.join(' <span class="bc-sep">/</span> ');

    container.style.opacity = '0';
    container.innerHTML = `
        <nav class="breadcrumbs">
            ${breadcrumbsHtml}
        </nav>
        <div class="reader-container">
            ${contentHtml}
            ${navFooter}
        </div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        container.style.transition = 'opacity 0.3s ease';
        container.style.opacity = '1';
    }));

    container.classList.toggle('comparison-active', localStorage.getItem('reader_comparison') === 'true');

    // Fav indicators
    window.updateFavIndicators = function () {
        let favs = [];
        try { favs = JSON.parse(localStorage.getItem('savedFavorites') || '[]'); } catch (e) { }
        const pageFavs = favs.filter(f => f.vol === volId && f.file === filename);
        const savedSet = new Set(pageFavs.map(f => f.topic || 0));
        const totalTopics = window._currentTotalTopics || 1;
        for (let i = 0; i < totalTopics; i++) {
            const topicEl = document.getElementById(`topic-${i}`);
            if (!topicEl) continue;
            let dot = topicEl.querySelector('.saved-topic-dot');
            if (!dot) {
                const titleEl = Array.from(topicEl.querySelectorAll('b')).find(b => b.textContent.trim().length > 2);
                if (titleEl) { dot = document.createElement('span'); dot.className = 'saved-topic-dot'; titleEl.appendChild(dot); }
            }
            if (dot) dot.classList.toggle('visible', savedSet.has(i));

            const saveBtn = topicEl.querySelector('.topic-save-btn');
            if (saveBtn) {
                const isSaved = savedSet.has(i);
                saveBtn.classList.toggle('active', isSaved);
                const labelEl = saveBtn.querySelector('.topic-save-label');
                if (labelEl) {
                    labelEl.textContent = isSaved ? labelEl.dataset.saved : labelEl.dataset.save;
                }
            }
        }
    };
    window.updateFavIndicators();

    // Search highlighting
    if (searchQuery) {
        const isCJK = (str) => /[\u3000-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/.test(str);
        const queryParts = searchQuery.trim().split('&').map(p => p.trim()).filter(p => {
            if (isPt) return !isCJK(p) && p.length >= 2;
            return isCJK(p) ? p.length >= 1 : p.length >= 2;
        });
        if (queryParts.length > 0) {
            const regexFlags = queryParts.some(isCJK) ? 'g' : 'gi';
            const highlightRegex = new RegExp(`(${queryParts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, regexFlags);
            container.querySelectorAll('.topic-content').forEach(block => {
                const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null, false);
                let node;
                const textNodes = [];
                while (node = walker.nextNode()) textNodes.push(node);
                textNodes.forEach(textNode => {
                    const val = textNode.nodeValue;
                    if (!val.trim()) return;
                    const textIsCJK = isCJK(val);
                    if (isPt && textIsCJK) return;
                    if (!isPt && !textIsCJK && !queryParts.some(p => !isCJK(p))) return;
                    const matches = queryParts.some(part => isCJK(part) ? val.includes(part) : val.toLowerCase().includes(part.toLowerCase()));
                    if (matches) {
                        const span = document.createElement('span');
                        span.innerHTML = val.replace(highlightRegex, '<mark class="search-highlight">$1</mark>');
                        textNode.parentNode.replaceChild(span, textNode);
                    }
                });
            });
            const first = container.querySelector('mark');
            const topicIdxParam = new URLSearchParams(window.location.search).get('topic');
            const hasTopicScroll = topicIdxParam !== null && parseInt(topicIdxParam, 10) > 0;
            if (first && !searchTopicTitle && !hasTopicScroll) {
                setTimeout(() => first.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
            }
        }
    }

    // Mobile nav topics
    if (typeof window._updateMobileNavTopics === 'function') {
        if (topicsFound.length > 1) {
            const opts = topicsFound.map((t, i) => {
                if (t.continues_previous) return null;  // fragmento de extração — fora do índice/TOC
                const topicEl = document.getElementById(`topic-${i}`);
                let extractedTitle = '';
                if (topicEl) {
                    const boldEl = topicEl.querySelector('b, strong');
                    if (boldEl) {
                        const boldText = boldEl.textContent.trim();
                        const quoteMatch = boldText.match(/[「"＂"](.*?)[」"＂"]/);
                        extractedTitle = quoteMatch ? quoteMatch[1].trim() : boldText.replace(/^(Ensinamento|Orientação|Palestra|Relato de Experiência)\s*(?:de\s+)?(Meishu-Sama|Moisés)?\s*[-:：]?\s*/i, '').trim();
                    }
                    if (!extractedTitle) {
                        const firstText = topicEl.textContent.substring(0, 200).trim();
                        const quoteMatch = firstText.match(/[「"＂"](.*?)[」"＂"]/);
                        if (quoteMatch) extractedTitle = quoteMatch[1].trim();
                    }
                }
                if (!extractedTitle) {
                    const tTitle = isPt ? (t.title_ptbr || t.title_pt || t.publication_title_pt) : t.title_ja;
                    extractedTitle = (tTitle || t.title || `Parte ${i + 1}`)
                        .replace(/^(Ensinamento|Orientação|Palestra) de (Meishu-Sama|Moisés)\s*[-:]?\s*/i, '')
                        .replace(/^"(.*?)"$/, '$1').trim();
                }
                if (extractedTitle.length > 60) extractedTitle = extractedTitle.substring(0, 57) + '…';
                return { value: `#topic-${i}`, text: `"${extractedTitle}"` };
            }).filter(Boolean);
            const tocLabel = lang === 'ja' ? 'このテーマの教え' : 'Ensinamentos deste tema';
            window._updateMobileNavTopics(tocLabel, opts);

            // Espelha no TOC desktop. Calcula o tópico atual a partir
            // de ?topic=N (default 0) pra destacar a linha ativa.
            if (typeof window._updateDesktopToc === 'function') {
                const topicParam = new URLSearchParams(window.location.search).get('topic');
                const currentIdx = topicParam ? parseInt(topicParam, 10) : 0;
                const currentHref = `#topic-${Number.isFinite(currentIdx) ? currentIdx : 0}`;
                window._updateDesktopToc(tocLabel, opts, currentHref);
                // Liga o scroll spy depois do TOC renderizado. A função
                // tear down qualquer observer anterior (re-renderizações
                // ao trocar idioma/arquivo não vazam listener).
                if (typeof window._attachTocScrollSpy === 'function') {
                    requestAnimationFrame(() => window._attachTocScrollSpy());
                }
            }
        } else {
            window._updateMobileNavTopics('', []);
            if (typeof window._updateDesktopToc === 'function') {
                window._updateDesktopToc('', []);
            }
        }
    }


    // --- Shared gate/scroll helpers ---
    const _revealGate = () => {
        const gate = document.getElementById('reader-scroll-gate');
        if (!gate) return;
        gate.style.transition = 'opacity 0.2s';
        gate.style.opacity = '0';
        setTimeout(() => gate.remove(), 220);
    };

    const _scrollToTopicAndReveal = (el) => {
        if (!el) { _revealGate(); return; }
        // Use setTimeout instead of double-rAF: on initial page load, rAF can fire
        // before fonts/CSS are fully applied, resulting in incorrect layout measurements.
        // A short delay ensures the browser has finished layout before scrolling.
        setTimeout(() => {
            const HEADER_H = document.querySelector('.header')?.offsetHeight || 80;
            el.style.scrollMarginTop = `${HEADER_H + 12}px`;
            el.scrollIntoView({ behavior: 'instant', block: 'start' });
            _revealGate();
            el.style.transition = 'background-color 0.4s ease';
            el.style.backgroundColor = 'var(--accent-soft)';
            setTimeout(() => { el.style.backgroundColor = ''; }, 1800);
        }, 80);
    };

    // 1. Direct topic index scroll (search results, history, favorites)
    const _urlParams = new URLSearchParams(window.location.search);
    const topicIdxParam = _urlParams.get('topic');
    const topicIdx = topicIdxParam !== null ? parseInt(topicIdxParam, 10) : null;
    const highlightIdParam = _urlParams.get('highlight');

    // Scroll-to-mark helper: aterrissa em cima da palavra buscada
    // e dispara o pulse via classe CSS (animation pulse de 1.6s).
    const _scrollToMark = (mark) => {
        setTimeout(() => {
            const HEADER_H = document.querySelector('.header')?.offsetHeight || 80;
            mark.style.scrollMarginTop = `${HEADER_H + 40}px`;
            mark.scrollIntoView({ behavior: 'instant', block: 'center' });
            _revealGate();
            mark.classList.add('search-target-pulse');
            setTimeout(() => mark.classList.remove('search-target-pulse'), 1700);
        }, 80);
    };

    if (topicIdx !== null && topicIdx > 0) {
        // Quando vem da busca, prefere scroll direto pra primeira marca
        // dentro do tópico — usuário aterrissa em cima da palavra encontrada
        // ao invés do início do tópico. Sem search, scroll no tópico normal.
        const topicEl = document.getElementById(`topic-${topicIdx}`);
        const firstMark = searchQuery ? topicEl?.querySelector('mark.search-highlight') : null;
        if (firstMark) _scrollToMark(firstMark);
        else _scrollToTopicAndReveal(topicEl);
    }
    // 1b. Sem topic param (ou topic=0) mas com busca — ainda rola pra marca
    //     se houver alguma. Cobre o caso de match literal em topic=0.
    else if (searchQuery && (topicIdx === null || topicIdx === 0)) {
        const firstMark = container.querySelector('mark.search-highlight');
        if (firstMark) {
            _scrollToMark(firstMark);
        } else {
            _revealGate();
        }
    }
    // 2. Legacy topic_title scroll (old saved links — kept for backwards compat)
    else if (searchTopicTitle && topicsFound.length > 1) {
        const normalizedSearchTitle = searchTopicTitle.toLowerCase().trim();
        let bestMatchIndex = -1;
        let bestMatchScore = 0;

        topicsFound.forEach((topicData, index) => {
            const genericTitle = isPt
                ? (topicData.title_ptbr || topicData.title_pt || topicData.title || '').toLowerCase().trim()
                : (topicData.title_ja || topicData.title || '').toLowerCase().trim();
            const content = isPt ? (topicData.content_ptbr || topicData.content_pt || topicData.content || '') : (topicData.content || '');
            const contentTitleMatch = content.replace(/<[^>]+>/g, ' ').match(/[""](.*?)[""]/);
            const extractedTitle = (contentTitleMatch && contentTitleMatch[1].length > 10) ? contentTitleMatch[1].toLowerCase().trim() : '';
            const topicTitle = (extractedTitle && !genericTitle.includes(extractedTitle.substring(0, 20))) ? extractedTitle : genericTitle;

            const checkMatch = (candidate) => {
                if (!candidate) return;
                if (candidate === normalizedSearchTitle) { bestMatchIndex = index; bestMatchScore = 200; return; }
                if (candidate.includes(normalizedSearchTitle) || normalizedSearchTitle.includes(candidate)) {
                    const score = Math.min(normalizedSearchTitle.length, candidate.length) + 100;
                    if (score > bestMatchScore) { bestMatchIndex = index; bestMatchScore = score; }
                }
                const searchWords = normalizedSearchTitle.split(/\s+/).filter(w => w.length > 2);
                if (searchWords.length > 2) {
                    const matchRatio = searchWords.filter(sw => candidate.split(/\s+/).some(tw => tw.includes(sw) || sw.includes(tw))).length / searchWords.length;
                    if (matchRatio > 0.6 && bestMatchScore < 100) { bestMatchIndex = index; bestMatchScore = matchRatio * 100; }
                }
            };

            checkMatch(topicTitle);
            if (topicTitle !== genericTitle && bestMatchScore < 200) checkMatch(genericTitle);
        });

        if (bestMatchIndex >= 0) {
            _scrollToTopicAndReveal(document.getElementById(`topic-${bestMatchIndex}`));
        } else {
            _revealGate();
            const firstMark = container.querySelector('mark.search-highlight');
            if (firstMark) setTimeout(() => firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
        }
    } else {
        // No topic scroll — remove gate if present
        _revealGate();
    }

    // --- Admin preview: scroll to paragraph containing preview text (no persistent highlights) ---
    const _previewSnippet = _urlParams.get('preview');
    if (_previewSnippet) {
        const needle = _previewSnippet.replace(/\s+/g, ' ').trim().toLowerCase();
        if (needle.length > 5) {
            // Find the first <p> (or block element) whose text contains the snippet
            let targetEl = null;
            const allBlocks = container.querySelectorAll('.topic-content p, .topic-content li, .topic-content blockquote');
            for (const el of allBlocks) {
                const elText = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                if (elText.includes(needle)) {
                    targetEl = el;
                    break;
                }
            }
            if (targetEl) {
                setTimeout(() => {
                    const HEADER_H = document.querySelector('.header')?.offsetHeight || 80;
                    targetEl.style.scrollMarginTop = `${HEADER_H + 12}px`;
                    targetEl.scrollIntoView({ behavior: 'instant', block: 'center' });
                    _revealGate();
                    // Brief golden flash — visible but non-intrusive
                    targetEl.style.transition = 'background-color 0.4s ease, outline-color 0.4s ease';
                    targetEl.style.backgroundColor = 'rgba(var(--accent-rgb, 180,130,20), 0.12)';
                    targetEl.style.outline = '2px solid rgba(var(--accent-rgb, 180,130,20), 0.4)';
                    targetEl.style.outlineOffset = '4px';
                    targetEl.style.borderRadius = '4px';
                    setTimeout(() => {
                        targetEl.style.backgroundColor = '';
                        targetEl.style.outline = '';
                        targetEl.style.outlineOffset = '';
                        targetEl.style.borderRadius = '';
                    }, 3000);
                }, 120);
            } else {
                _revealGate();
            }
        }
    }

    // --- Apply user highlights after content is rendered (skip in comparison mode) ---
    const comparisonMode = localStorage.getItem('reader_comparison') === 'true';
    if (typeof window.applyHighlightsOnPage === 'function' && !comparisonMode) {
        const delay = (searchTopicTitle || (topicIdx !== null && topicIdx > 0)) ? 150 : 50;
        setTimeout(() => {
            window.applyHighlightsOnPage();
            // Only scroll to highlight when explicitly requested from the highlights modal (hlScroll=true)
            if (hlScroll && highlightIdParam) {
                setTimeout(() => {
                    const markEl = document.querySelector(`mark.user-highlight[data-highlight-id="${highlightIdParam}"]`);
                    const scrollTarget = markEl || (topicIdx !== null ? document.getElementById(`topic-${topicIdx}`) : null);
                    if (scrollTarget) {
                        scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        scrollTarget.style.transition = 'background-color 0.4s ease';
                        scrollTarget.style.backgroundColor = 'var(--accent-soft)';
                        setTimeout(() => { scrollTarget.style.backgroundColor = ''; }, 1800);
                    }
                    _revealGate();
                }, 80);
            } else if (highlightIdParam) {
                // highlightId present but no autoscroll requested — just reveal the gate
                _revealGate();
            }
        }, delay);
    }
}
