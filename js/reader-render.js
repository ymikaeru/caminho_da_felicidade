// ============================================================
// READER RENDER — renderReader() standalone function
// Depends on: _normalizeContent, _stripHeader (reader-content.js)
//             window._readerContainer, window._genericRegex (set by reader.js)
// ============================================================

function renderReader(volId, filename, json, allFiles, searchQuery, searchTopicTitle, hlScroll) {
    const container = window._readerContainer;
    const genericRegex = window._genericRegex;
    const lang = localStorage.getItem('site_lang') || 'pt';
    const isPt = lang === 'pt';
    window._usedNavTitles = new Set();

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

    window._swipeNav = { vol: volId, prev: prevFile, next: nextFile };

    // Title resolution — prioritize SECTION_MAP (correct section names)
    // over GLOBAL_INDEX_TITLES (which may store per-file topic titles)
    let indexTitle = '';
    let sectionName = '';
    try {
        const sectionMap = window.SECTION_MAP || {};
        const volSections = sectionMap[volId] || {};
        const sectObj = volSections[filename];
        if (sectObj) {
            indexTitle = isPt ? sectObj.pt : (sectObj.ja || sectObj.pt);
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
                const quoteMatch = pureTitle.match(/[""]([^""]+)[""]/);
                if (quoteMatch) {
                    const prefixMatch = pureTitle.match(/^([^:]+)/);
                    let prefix = prefixMatch ? prefixMatch[1].trim() : '';
                    if (!pureTitle.includes(':') && pureTitle.includes(' - ')) prefix = pureTitle.split(' - ')[0].trim();
                    prefix = prefix.replace(/\*/g, '');
                    pureTitle = (prefix && prefix.toLowerCase() !== quoteMatch[1].toLowerCase()) ? `${prefix}: ${quoteMatch[1]}` : quoteMatch[1];
                } else {
                    pureTitle = pureTitle.replace(/\s+-\s+/, ': ').replace(/\s+:/, ':');
                }
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
                    let pureTitle = activeTitle;
                    const quoteMatch = pureTitle.match(/[""]([^""]+)[""]/);
                    if (quoteMatch) {
                        const prefixMatch = pureTitle.match(/^([^:]+)/);
                        let prefix = prefixMatch ? prefixMatch[1].trim() : '';
                        if (!pureTitle.includes(':') && pureTitle.includes(' - ')) prefix = pureTitle.split(' - ')[0].trim();
                        prefix = prefix.replace(/\*/g, '');
                        pureTitle = (prefix && prefix.toLowerCase() !== quoteMatch[1].toLowerCase()) ? `${prefix}: ${quoteMatch[1]}` : quoteMatch[1];
                    } else {
                        pureTitle = pureTitle.replace(/\s+-\s+/, ': ').replace(/\s+:/, ':');
                    }
                    const displayDate = topicData.date && topicData.date !== 'Unknown' ? `<br/>\n(${topicData.date})` : '';
                    const pt1 = pureTitle.replace(/^\*\*|\*\*$/g, '');
                    headerHTML = `<b><font size="+2">${pt1.charAt(0).toUpperCase() + pt1.slice(1)}</font></b>${displayDate}<br/><br/>`;
                }
            }
        }

        let formatted = _normalizeContent(rawContent);

        // Anota cada <p> top-level com data-p-idx pra permitir
        // posição de leitura granular por parágrafo. Saving lê o
        // <p> mais central no viewport; resume scrolla até ele.
        {
            let _pIdx = 0;
            formatted = formatted.replace(/<p(\s|>)/gi, (_, end) => `<p data-p-idx="${_pIdx++}"${end}`);
        }

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
            contentHtml += `<div id="${topicId}" class="topic-content comparison-mode" style="margin-top: ${index > 0 ? '40px' : '0'};">
                ${headerHTML}
                <div class="comparison-labels"><span>日本語</span><span>Português</span></div>
                <div class="comparison-grid">${gridHtml}</div>
                <div class="comparison-interleaved">${interleavedHtml}</div>
            </div>`;
        } else {
            contentHtml += `<div id="${topicId}" class="topic-content" style="margin-top: ${index > 0 ? '40px' : '0'};">\n${headerHTML}\n${formatted}\n</div>`;
        }
    });

    const bl = { pt: { home: 'Início', volume: 'Volume' }, ja: { home: 'トップ', volume: '巻' } }[lang] || { home: 'Início', volume: 'Volume' };

    const isMobile = window.innerWidth <= 767;
    const urlParamsForRender = new URLSearchParams(window.location.search);
    const topicParamForRender = urlParamsForRender.get('topic');
    const hasSearchQuery = searchQuery && searchQuery.trim();
    const openPubLabel = lang === 'ja' ? '関連する教え' : 'Ensinamentos Relacionados';
    const openPubHtml = (isMobile && hasSearchQuery && topicParamForRender)
        ? `<div class="related-teachings-bar"><button class="btn-zen btn-open-pub" onclick="window.openFullPublication()">📖 ${openPubLabel}</button></div>`
        : '';

    // Mobile search mode: add class to simplify header
    if (isMobile && hasSearchQuery && topicParamForRender) {
        document.body.classList.add('reader-search-mode');
    }

    const specificTitle = isPt ? ptSpecificTitle : jaSpecificTitle;

    const cleanIndexTitle = indexTitle ? indexTitle.replace(/<br\s*\/?>/gi, ' ') : '';
    const cleanSpecificTitle = specificTitle ? specificTitle.replace(/<br\s*\/?>/gi, ' ') : '';
    const cleanSectionName = sectionName ? sectionName.replace(/<br\s*\/?>/gi, ' ') : '';
    const cleanThemeSection = themeSectionName ? themeSectionName.replace(/<br\s*\/?>/gi, ' ') : '';
    const effectiveSection = cleanSectionName || cleanThemeSection;

    let bcParts = [];
    bcParts.push(`<a href="index.html">${bl.home}</a>`);
    bcParts.push(`<a href="${volId}/index.html">${bl.volume} ${volId.slice(-1)}</a>`);
    if (effectiveSection) {
        bcParts.push(`<a href="${volId}/index.html">${effectiveSection}</a>`);
    }

    if (cleanIndexTitle) {
        bcParts.push(`<span style="color:var(--text-main)">${cleanIndexTitle}</span>`);
    }

    const breadcrumbsHtml = bcParts.join(' <span>/</span> ');

    container.style.opacity = '0';
    container.innerHTML = `
        <nav class="breadcrumbs">
            ${breadcrumbsHtml}
        </nav>
        ${openPubHtml}
        <div class="reader-container">
            ${contentHtml}
            ${navFooter}
        </div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        container.style.transition = 'opacity 0.3s ease';
        container.style.opacity = '1';
    }));

    // Mobile: hide all topics except the searched one
    if (isMobile && topicParamForRender) {
        const targetIdx = parseInt(topicParamForRender, 10);
        if (targetIdx > 0) {
            container.querySelectorAll('.topic-content').forEach((el, i) => {
                if (i !== targetIdx) el.style.display = 'none';
            });
        }
    }

    container.classList.toggle('comparison-active', localStorage.getItem('reader_comparison') === 'true');

    // Fav indicators
    window.updateFavIndicators = function () {
        let favs = [];
        try { favs = JSON.parse(localStorage.getItem('savedFavorites') || '[]'); } catch (e) { }
        const pageFavs = favs.filter(f => f.vol === volId && f.file === filename);
        const count = pageFavs.length;
        const hasFavs = count > 0;
        const favLang = { pt: { saved: 'Salvo', save: 'Salvar' }, ja: { saved: '保存済み', save: '保存' } }[lang] || { saved: 'Salvo', save: 'Salvar' };
        [document.getElementById('favoriteBtn'), document.getElementById('mobileFavoriteBtn')].forEach(btn => {
            if (!btn) return;
            btn.title = hasFavs ? favLang.saved : favLang.save;
            btn.classList.toggle('active', hasFavs);
            const svg = btn.querySelector('svg');
            if (svg) svg.setAttribute('fill', hasFavs ? 'currentColor' : 'none');
            let badge = btn.querySelector('.fav-badge');
            if (!badge) { badge = document.createElement('span'); badge.className = 'fav-badge'; btn.appendChild(badge); }
            badge.textContent = count > 0 ? count : '';
            badge.classList.toggle('visible', count > 0);
        });
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
            });
            window._updateMobileNavTopics(lang === 'ja' ? '刊行物：テーマ' : 'Publicações deste ensinamento', opts);
        } else {
            window._updateMobileNavTopics('', []);
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

    if (topicIdx !== null && topicIdx > 0) {
        _scrollToTopicAndReveal(document.getElementById(`topic-${topicIdx}`));
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
