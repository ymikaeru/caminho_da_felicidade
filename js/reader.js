// ============================================================
// READER — orchestrator: fetch, navigation, favorites, events
// Load order: reader-content.js → reader-render.js → reader.js
// ============================================================

window.DATA_OUTPUT_DIR = 'site_data';
window._volDataCache = {};

async function fetchJSON(path) {
  if (!window.supabaseStorageFetch) {
    throw new Error('Authentication required');
  }
  return window.supabaseStorageFetch(path);
}

function _getOrFetchArticle(articleKey) {
  if (!window._articleCache) window._articleCache = {};
  if (window._articleCache[articleKey]) {
    const cached = window._articleCache[articleKey];
    return cached.then ? cached : Promise.resolve(cached);
  }
  const p = fetchJSON(articleKey)
    .then(j => { window._articleCache[articleKey] = j; return j; })
    .catch(e => { delete window._articleCache[articleKey]; throw e; });
  window._articleCache[articleKey] = p;
  return p;
}

function _prefetchAdjacent(volId, navJson, currentFilename) {
  const conn = navigator.connection;
  if (conn && (conn.saveData || conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g')) return;
  if (!Array.isArray(navJson)) return;

  const fnameOnly = currentFilename.split('/').pop();
  const idx = navJson.indexOf(fnameOnly);
  if (idx < 0) return;

  // Só o PRÓXIMO. O anterior foi removido pra economizar egress: na leitura
  // sequencial ele já está no cache do navegador (download desnecessário), e
  // pra quem pula via busca era um artigo inteiro (~80KB) baixado à toa. A
  // navegação "voltar" segue funcionando sob demanda (rápida, vem do cache).
  const targets = [];
  if (idx + 1 < navJson.length) targets.push(navJson[idx + 1]);

  const schedule = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 4000 })
    : (fn) => setTimeout(fn, 4000);

  schedule(() => {
    for (const f of targets) {
      const key = `${volId}/${f.endsWith('.json') ? f : f + '.json'}`;
      if (!window._articleCache || !window._articleCache[key]) {
        _getOrFetchArticle(key).catch(() => {});
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
    // Disciples mode (reader.html?pub=disciples) is handled by js/disciples-reader.js —
    // bail out before any volume-oriented init runs so we don't overwrite the container
    // or log volume analytics for book reading.
    if (new URLSearchParams(window.location.search).get('pub') === 'disciples') {
        return;
    }
    const container = document.getElementById('readerContainer');
    window._readerContainer = container;
    window._genericRegex = /O Método do Johrei|Princípio do Johrei|Sobre a Verdade|Verdade \d|Ensinamento \d|Parte \d|JH\d|JH \d|Publicação \d|Agricultura Natural|Instrução Divina|Purificação Equilibrada|Coletânea de fragmentos/i;

    function getParams(ovrVol, ovrFile) {
        const urlParams = new URLSearchParams(window.location.search);
        let volId = ovrVol || urlParams.get('vol') || urlParams.get('v');
        let filename = ovrFile || urlParams.get('file') || urlParams.get('f');

        if (!ovrVol && !ovrFile) {
            const hash = window.location.hash.substring(1).replace(/^#/, '');
            const hashMatch = hash.match(/^v(\d+)\/(.+)$/i);
            if (hashMatch) { volId = `mioshiec${hashMatch[1]}`; filename = hashMatch[2]; }
        }

        if (volId && !volId.startsWith('mioshiec')) volId = `mioshiec${volId}`;
        if (filename && !filename.endsWith('.html')) filename += '.html';

        const topicParam = urlParams.get('topic');
        const topicTitleParam = urlParams.get('topic_title');
        const highlightParam = urlParams.get('highlight');
        const hlScrollParam = urlParams.get('hl_scroll') === '1';
        return { volId, filename, searchQuery: urlParams.get('search') || urlParams.get('s'), topicIdx: topicParam !== null ? parseInt(topicParam, 10) : null, topicTitle: topicTitleParam, highlightId: highlightParam, hlScroll: hlScrollParam };
    }

    function getVisibleTopicIndex() {
        const topics = container.querySelectorAll('.topic-content');
        if (topics.length <= 1) return 0;
        let bestIdx = 0, bestDist = Infinity;
        const viewMid = window.innerHeight / 3;
        topics.forEach((el, i) => {
            const r = el.getBoundingClientRect();
            if (r.height === 0) return; // ignore hidden topics (mobile single-topic mode)
            const dist = Math.abs(r.top - viewMid);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        });
        return bestIdx;
    }

    // Retorna { topicIdx, paragraphIdx }. paragraphIdx = índice do <p>
    // (data-p-idx) mais central na viewport dentro do tópico mais
    // central. null se não houver <p> com data-p-idx (artigos antigos
    // ou conteúdo sem parágrafos).
    function getVisiblePosition() {
        const topicIdx = getVisibleTopicIndex();
        const topicEl = container.querySelectorAll('.topic-content')[topicIdx];
        if (!topicEl) return { topicIdx, paragraphIdx: null };
        const paragraphs = topicEl.querySelectorAll('p[data-p-idx]');
        if (!paragraphs.length) return { topicIdx, paragraphIdx: null };
        const viewMid = window.innerHeight / 3;
        let bestIdx = null, bestDist = Infinity;
        paragraphs.forEach(p => {
            const r = p.getBoundingClientRect();
            if (r.height === 0) return;
            const dist = Math.abs(r.top - viewMid);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = parseInt(p.dataset.pIdx, 10);
            }
        });
        return { topicIdx, paragraphIdx: bestIdx };
    }

    async function initReader(ovrVol, ovrFile, searchTopicTitle) {
        const { volId, filename, searchQuery, topicTitle, topicIdx, highlightId, hlScroll } = getParams(ovrVol, ovrFile);
        window._navlog?.('initReader() vol=' + volId + ' file=' + filename + ' search=' + (searchQuery || '-'));
        const finalTopicTitle = searchTopicTitle || topicTitle;
        if (!volId || !filename) {
            const _lang = localStorage.getItem('site_lang') || 'pt';
            container.innerHTML = `<div class="error">${_lang === 'ja' ? '目次から御教えをお選びください。' : 'Selecione um ensinamento no índice.'}</div>`;
            return;
        }

        // Restore reading position from cloud — resolvido em PARALELO com o
        // fetch do artigo. Antes era `await`ado ANTES do fetch: um round-trip
        // inteiro de tela vazia em toda abertura de ensinamento (o próprio
        // código admitia "não protegido por timeout"), sendo que o resultado
        // só alimenta o botão "Continuar leitura" DEPOIS do render. Timeout de
        // 1,5s pra uma nuvem lenta nunca atrasar nem o botão.
        let resolvedTopicIdx = topicIdx;
        let resolvedParagraphIdx = null;
        let _posPromise = null;
        if (topicIdx === null && window._cloudSync) {
            const timeout = new Promise(res => setTimeout(() => res(null), 1500));
            _posPromise = Promise.race([
                Promise.resolve(window._cloudSync.getLastPosition(volId, filename)).catch(() => null),
                timeout
            ]);
        }

        // When loading to a specific topic, create a temporary overlay so content
        // can be rendered and scrolled before becoming visible — eliminates the jump.
        if (finalTopicTitle || (highlightId && hlScroll)) {
            if (!document.getElementById('reader-scroll-gate')) {
                const g = document.createElement('div');
                g.id = 'reader-scroll-gate';
                g.style.cssText = 'position:fixed;inset:0;z-index:4998;background:var(--bg-color,#f5f3ee)';
                document.body.appendChild(g);
            }
        }
        try {
            if (!window._volNavCache) window._volNavCache = {};

            const fnameOnly = filename.split('/').pop();
            const articlePath = fnameOnly.endsWith('.json') ? fnameOnly : `${fnameOnly}.json`;
            const articleKey = `${volId}/${articlePath}`;

            const progressBar = document.getElementById('loadingProgressBar');
            if (progressBar) progressBar.style.width = '100%';

            const navPromise = window._volNavCache[volId]
                ? Promise.resolve(window._volNavCache[volId])
                : fetchJSON(`${volId}_nav.json`).then(j => { window._volNavCache[volId] = j; return j; });

            const [navJson, articleJson] = await Promise.all([navPromise, _getOrFetchArticle(articleKey)]);
            window._navlog?.('fetch OK key=' + articleKey + ' -> renderReader');
            renderReader(volId, filename, articleJson, navJson, searchQuery, finalTopicTitle, hlScroll);
            window._navlog?.('renderReader RETURNED, container len=' + (container.innerHTML || '').length);
            _prefetchAdjacent(volId, navJson, filename);

            // Log access for analytics (fire-and-forget)
            if (window.supabaseAuth?.logAccess) {
                window.supabaseAuth.logAccess(volId, filename).catch(() => {});
            }

            // Inicia rastreamento de tempo real de leitura (estilo YouTube)
            if (window._readTimeTracker?.start) {
                window._readTimeTracker.start(volId, filename).catch(() => {});
            }

            // Agora sim resolve a posição salva (pedida em paralelo no início) e
            // mostra o botão flutuante "Continuar leitura". paragraph_index é
            // independente do topic_index (artigo de 1 tópico com bookmark dentro).
            if (_posPromise) {
                const pos = await _posPromise;
                window._navlog?.('getLastPosition ' + (pos ? 'OK' : 'null/timeout'));
                if (pos && pos.topic_index > 0) resolvedTopicIdx = pos.topic_index;
                if (pos && Number.isInteger(pos.paragraph_index)) resolvedParagraphIdx = pos.paragraph_index;
            }
            // Show floating "continue reading" button instead of auto-scroll.
            // Mostra mesmo quando topic_index=0 desde que tenha paragraph
            // salvo (artigos longos de 1 tópico precisam do bookmark).
            const _hasResume = (resolvedTopicIdx !== null && resolvedTopicIdx > 0)
                || (resolvedParagraphIdx !== null && resolvedParagraphIdx > 0);
            if (_hasResume && !highlightId) {
                setTimeout(() => {
                    const gate = document.getElementById('reader-scroll-gate');
                    if (gate) { gate.style.transition = 'opacity 0.3s'; gate.style.opacity = '0'; setTimeout(() => gate.remove(), 300); }
                    showResumeReadingButton(resolvedTopicIdx || 0, resolvedParagraphIdx);
                }, 100);
            }

            if (searchQuery) {
                setTimeout(() => {
                    const current = new URLSearchParams(window.location.search);
                    if (current.has('search')) {
                        current.delete('search');
                        current.delete('topic_title');
                        const qs = current.toString();
                        window.history.replaceState({ volId, filename }, '', `reader.html${qs ? '?' + qs : ''}`);
                    }
                }, 600);
            }
        } catch (err) {
            window._navlog?.('initReader CATCH: ' + (err && err.message ? err.message : err));
            console.error('Reader Error:', err);
            const _lang = localStorage.getItem('site_lang') || 'pt';
            container.innerHTML = `<div class="error">${_lang === 'ja' ? '御教えを読み込めませんでした。' : 'Erro ao carregar o ensinamento.'}</div>`;
        }
    }

    window.navigateToReader = async function (volId, filename, searchQuery, searchTopicTitle) {
        let url = `reader.html?vol=${volId}&file=${filename}`;
        if (window.location.search.includes('lang=ja')) url += '&lang=ja';
        if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
        if (searchTopicTitle) url += `&topic_title=${encodeURIComponent(searchTopicTitle)}`;
        const cameFromSearch = new URLSearchParams(window.location.search).has('search');
        window.history[cameFromSearch ? 'replaceState' : 'pushState']({ volId, filename }, '', url);
        await initReader(volId, filename, searchTopicTitle);
        if (!searchTopicTitle) window.scrollTo(0, 0);
    };

    window.toggleFavorite = async function (explicitTopicIndex) {
        const { volId, filename } = getParams();
        let favorites = [];
        try { favorites = JSON.parse(localStorage.getItem('savedFavorites') || '[]'); } catch (e) { }
        const topicIndex = Number.isInteger(explicitTopicIndex) ? explicitTopicIndex : getVisibleTopicIndex();
        const title = document.title.replace('Meishu-Sama: ', '').replace(' - Caminho da Felicidade', '');
        const totalTopics = window._currentTotalTopics || 1;

        let topicTitle = '', snippet = '';
        const topics = window._currentTopics || [];
        if (topics[topicIndex]) {
            const lang = localStorage.getItem('site_lang') || 'pt';
            topicTitle = (lang === 'pt'
                ? (topics[topicIndex].title_ptbr || topics[topicIndex].title_pt || topics[topicIndex].title || '')
                : (topics[topicIndex].title_ja || topics[topicIndex].title || '')
            ).replace(/<[^>]+>/g, '').trim();
            const topicEl = document.getElementById(`topic-${topicIndex}`);
            if (topicEl) {
                const rawText = topicEl.textContent || '';
                const bodyStart = rawText.indexOf(topicTitle) !== -1 ? rawText.indexOf(topicTitle) + topicTitle.length : 0;
                snippet = rawText.substring(bodyStart, bodyStart + 120).replace(/\s+/g, ' ').trim();
                if (snippet.length >= 118) snippet += '…';
            }
        }

        const isSaved = favorites.some(f => f.vol === volId && f.file === filename && (f.topic || 0) === topicIndex);
        if (isSaved) {
            favorites = favorites.filter(f => !(f.vol === volId && f.file === filename && (f.topic || 0) === topicIndex));
        } else {
            favorites.unshift({ title, vol: volId, file: filename, time: Date.now(), topic: topicIndex, topicTitle, snippet, totalTopics });
        }
        try { localStorage.setItem('savedFavorites', JSON.stringify(favorites)); } catch (e) { }

        // Sync to cloud — falhas (rede, sessão expirada, RLS) NÃO podem
        // bloquear o feedback de UI. O usuário precisa ver o tooltip e o
        // botão mudar mesmo se o sync falhar; localStorage já salvou e o
        // syncLocalStorageToCloud reconcilia depois.
        if (window._cloudSync) {
            try {
                if (isSaved) {
                    await window._cloudSync.removeFavorite(volId, filename, topicIndex);
                } else {
                    await window._cloudSync.saveFavorite(volId, filename, topicIndex, topicTitle, snippet, totalTopics);
                }
            } catch (e) {
                console.warn('[favorites] cloud sync failed, salvo apenas local:', e);
            }
        }

        const lang = localStorage.getItem('site_lang') || 'pt';
        if (typeof window.updateFavIndicators === 'function') window.updateFavIndicators();
        if (typeof renderFavorites === 'function') renderFavorites();

        const tooltip = document.getElementById('saveTooltip');
        if (tooltip) {
            const statusText = {
                pt: { saved: '✓ Salvo em Ensinamentos Salvos (no menu)', removed: '✕ Removido de Ensinamentos Salvos' },
                ja: { saved: '✓「保存した教え」に追加しました（メニュー）', removed: '✕「保存した教え」から削除しました' }
            }[lang] || { saved: '✓ Salvo em Ensinamentos Salvos (no menu)', removed: '✕ Removido de Ensinamentos Salvos' };
            const rawTitle = topicTitle || title;
            const cleanTitle = rawTitle.replace(/^(Ensinamento|Orientação|Palestra) de (Meishu-Sama|Moisés)\s*[-:]\s*/i, '').replace(/^["'](.*?)["']$/, '$1').trim();
            document.getElementById('saveTooltipTitle').textContent = cleanTitle;
            document.getElementById('saveTooltipStatus').textContent = isSaved ? statusText.removed : statusText.saved;
            tooltip.classList.add('show');
            clearTimeout(window._saveTooltipTimer);
            window._saveTooltipTimer = setTimeout(() => tooltip.classList.remove('show'), 2800);
        }
    };

    // Copiar/compartilhar o link DESTE tópico. navigator.share no mobile,
    // clipboard + tooltip no desktop. Monta &topic= explícito (rolar até um
    // tópico só sincroniza ?topic= via TOC/hash — quem apenas rola e copia a
    // barra de endereço mandaria um link que abre no tópico errado).
    window.copyTopicLink = async function (topicIdx) {
        const { volId, filename } = getParams();
        if (!volId || !filename) return;
        const lang = localStorage.getItem('site_lang') || 'pt';
        const base = location.pathname.replace(/[^/]*$/, '');
        let url = `${location.origin}${base}reader.html?vol=${encodeURIComponent(volId)}&file=${encodeURIComponent(filename)}`;
        if (Number.isInteger(topicIdx) && topicIdx > 0) url += `&topic=${topicIdx}`;
        if (lang === 'ja') url += '&lang=ja';
        if (navigator.share) {
            try { await navigator.share({ title: document.title || 'Caminho da Felicidade', url }); } catch (e) { /* cancelado */ }
            return;
        }
        try { await navigator.clipboard.writeText(url); }
        catch (e) {
            const ta = document.createElement('textarea');
            ta.value = url; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            document.body.removeChild(ta);
        }
        const tooltip = document.getElementById('saveTooltip');
        if (tooltip) {
            const st = { pt: 'Link copiado', ja: 'リンクをコピーしました' }[lang] || 'Link copiado';
            const tEl = document.getElementById('saveTooltipTitle');
            const sEl = document.getElementById('saveTooltipStatus');
            if (tEl) tEl.textContent = '';
            if (sEl) sEl.textContent = '🔗 ' + st;
            tooltip.classList.add('show');
            clearTimeout(window._saveTooltipTimer);
            window._saveTooltipTimer = setTimeout(() => tooltip.classList.remove('show'), 2800);
        }
    };

    // "Marcar como lido" — espelha o toggleFavorite: localStorage primeiro
    // (UI instantânea, funciona offline), cloud em seguida sem bloquear.
    window.toggleReadMark = async function (explicitTopicIndex) {
        const { volId, filename } = getParams();
        let marks = [];
        try { marks = JSON.parse(localStorage.getItem('readMarks') || '[]'); } catch (e) { }
        const topicIndex = Number.isInteger(explicitTopicIndex) ? explicitTopicIndex : getVisibleTopicIndex();

        let topicTitle = '';
        const topics = window._currentTopics || [];
        if (topics[topicIndex]) {
            const lang0 = localStorage.getItem('site_lang') || 'pt';
            topicTitle = (lang0 === 'pt'
                ? (topics[topicIndex].title_ptbr || topics[topicIndex].title_pt || topics[topicIndex].title || '')
                : (topics[topicIndex].title_ja || topics[topicIndex].title || '')
            ).replace(/<[^>]+>/g, '').trim();
        }

        const wasRead = marks.some(m => m.vol === volId && m.file === filename && (m.topic || 0) === topicIndex);
        if (wasRead) {
            marks = marks.filter(m => !(m.vol === volId && m.file === filename && (m.topic || 0) === topicIndex));
        } else {
            marks.unshift({ vol: volId, file: filename, topic: topicIndex, topicTitle, time: Date.now() });
        }
        try { localStorage.setItem('readMarks', JSON.stringify(marks)); } catch (e) { }

        // UI primeiro (instantânea); nuvem em seguida SEM await — falha de
        // rede/RLS não pode atrasar nem bloquear o feedback.
        const lang = localStorage.getItem('site_lang') || 'pt';
        if (typeof window.updateReadIndicators === 'function') window.updateReadIndicators();

        if (window._cloudSync) {
            const op = wasRead
                ? window._cloudSync.removeReadMark(volId, filename, topicIndex)
                : window._cloudSync.saveReadMark(volId, filename, topicIndex, topicTitle);
            Promise.resolve(op).catch(e => console.warn('[read-marks] cloud sync failed, salvo apenas local:', e));
        }

        const tooltip = document.getElementById('saveTooltip');
        if (tooltip) {
            const statusText = {
                pt: { marked: '✓ Marcado como lido', unmarked: '✕ Marca de lido removida' },
                ja: { marked: '✓ 読了として記録しました', unmarked: '✕ 読了の記録を解除しました' }
            }[lang] || { marked: '✓ Marcado como lido', unmarked: '✕ Marca de lido removida' };
            const title = document.title.replace('Meishu-Sama: ', '').replace(' - Caminho da Felicidade', '');
            const rawTitle = topicTitle || title;
            const cleanTitle = rawTitle.replace(/^(Ensinamento|Orientação|Palestra) de (Meishu-Sama|Moisés)\s*[-:]\s*/i, '').replace(/^["'](.*?)["']$/, '$1').trim();
            document.getElementById('saveTooltipTitle').textContent = cleanTitle;
            document.getElementById('saveTooltipStatus').textContent = wasRead ? statusText.unmarked : statusText.marked;
            tooltip.classList.add('show');
            clearTimeout(window._saveTooltipTimer);
            window._saveTooltipTimer = setTimeout(() => tooltip.classList.remove('show'), 2800);
        }
    };

    window.renderContent = () => initReader();

    initReader();
    // Chrome moderno dispara popstate em clicks de hash-anchor (#topic-N),
    // não só em back/forward real. Sem este guard, cada click no TOC
    // re-chamava initReader → re-renderizava → re-scrollava pro ?topic=
    // antigo (cancelando a navegação do usuário). Só re-inicia quando
    // vol/file de fato mudou — back/forward entre ensinamentos.
    let _lastInitKey = null;
    function _currentInitKey() {
        const p = new URLSearchParams(window.location.search);
        return `${p.get('vol') || ''}|${p.get('file') || ''}`;
    }
    _lastInitKey = _currentInitKey();
    window.addEventListener('popstate', () => {
        const k = _currentInitKey();
        window._navlog?.('popstate k=' + k + ' last=' + _lastInitKey + ' -> ' + (k !== _lastInitKey ? 'initReader' : 'skip'));
        if (k !== _lastInitKey) {
            _lastInitKey = k;
            initReader();
        }
    });

    // Quando o usuário navega entre tópicos via hash (menu sanduíche,
    // TOC desktop, ou link interno tipo #topic-N), sincroniza o ?topic=
    // na URL com o novo tópico. Sem isso, recomendações com ?topic=4
    // deixavam o param "preso" em 4 mesmo após user clicar em outro
    // tópico — refresh/share voltavam ao tópico recomendado, e código
    // que relê ?topic= ficaria desatualizado.
    //
    // CRÍTICO: history.replaceState CANCELA o scroll-to-anchor que o
    // browser dispara nativamente ao mudar de hash. Sem o re-scroll
    // explícito abaixo, a página fica congelada no tópico anterior
    // (URL atualiza mas viewport não se move).
    window.addEventListener('hashchange', () => {
        const m = window.location.hash.match(/^#topic-(\d+)$/);
        if (!m) return;
        const newTopic = m[1];
        const url = new URL(window.location.href);
        if (url.searchParams.get('topic') !== newTopic) {
            url.searchParams.set('topic', newTopic);
            try {
                window.history.replaceState(window.history.state, '', url.toString());
            } catch (e) { /* ignore */ }
            // Refaz o scroll que o browser ia fazer (cancelado pelo replaceState).
            // Defer com requestAnimationFrame pra esperar layouts pendentes
            // (ex: closeMobileNav remove body.overflow=hidden e dispara reflow
            // que pode cancelar smooth scrolls em curso). Usa 'instant' por
            // robustez — smooth aqui é frequentemente interrompido.
            const target = document.getElementById(`topic-${newTopic}`);
            if (target) {
                const HEADER_H = document.querySelector('.header')?.offsetHeight || 80;
                target.style.scrollMarginTop = `${HEADER_H + 12}px`;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        target.scrollIntoView({ behavior: 'instant', block: 'start' });
                    });
                });
            }
        }
    });

    function showResumeReadingButton(topicIdx, paragraphIdx) {
        const existing = document.getElementById('resume-reading-btn');
        if (existing) existing.remove();

        const _lang = localStorage.getItem('site_lang') || 'pt';
        const btn = document.createElement('button');
        btn.id = 'resume-reading-btn';
        btn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>
            <span>${_lang === 'ja' ? '読書を続ける' : 'Continuar leitura'}</span>
            <span id="resume-dismiss" role="button" aria-label="${_lang === 'ja' ? '閉じる' : 'Dispensar'}" title="${_lang === 'ja' ? '閉じる' : 'Dispensar'}" style="margin-left:4px; opacity:0.75; font-size:1.15rem; line-height:1; padding:0 4px; cursor:pointer;">×</span>
        `;
        btn.style.cssText = `
            position: fixed; bottom: 24px; right: 24px; z-index: 5000;
            display: flex; align-items: center; gap: 8px;
            padding: 12px 20px; border-radius: 28px; border: none;
            background: var(--accent, #b8860b); color: #fff;
            font-size: 0.9rem; font-weight: 600; cursor: pointer;
            box-shadow: 0 4px 20px rgba(0,0,0,0.25);
            animation: resumeBtnIn 0.4s ease;
            font-family: inherit;
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes resumeBtnIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes resumeBtnOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(20px); } }
            #resume-reading-btn:hover { filter: brightness(1.1); transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
            #resume-reading-btn:active { transform: scale(0.97); }
            @media (max-width: 600px) { #resume-reading-btn { bottom: 16px; right: 16px; padding: 10px 16px; font-size: 0.85rem; } }
        `;
        document.head.appendChild(style);

        btn.addEventListener('click', (ev) => {
            if (ev.target && ev.target.id === 'resume-dismiss') return;   // × trata no próprio handler
            // Preferimos o parágrafo exato se foi salvo. Fallback pro
            // topic se o p não existir mais (artigo editado).
            const topicEl = document.getElementById(`topic-${topicIdx}`);
            const pEl = (Number.isInteger(paragraphIdx) && topicEl)
                ? topicEl.querySelector(`p[data-p-idx="${paragraphIdx}"]`)
                : null;
            const el = pEl || topicEl;
            if (el) {
                window.removeEventListener('scroll', _onScrollPastTarget);
                btn.style.animation = 'resumeBtnOut 0.3s ease forwards';
                setTimeout(() => btn.remove(), 300);
                const HEADER_H = document.querySelector('.header')?.offsetHeight || 80;
                el.style.scrollMarginTop = `${HEADER_H + 12}px`;
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                el.style.transition = 'background-color 0.4s ease';
                el.style.backgroundColor = 'var(--accent-soft)';
                setTimeout(() => { el.style.backgroundColor = ''; }, 1800);
            }
        });

        document.body.appendChild(btn);

        // × de dispensa explícito (não navega — só some).
        const dismissEl = btn.querySelector('#resume-dismiss');
        if (dismissEl) dismissEl.addEventListener('click', (e) => {
            e.stopPropagation();
            window.removeEventListener('scroll', _onScrollPastTarget);
            btn.style.animation = 'resumeBtnOut 0.3s ease forwards';
            setTimeout(() => btn.remove(), 300);
        });

        // SEM auto-hide por timer: antes o botão sumia após 8s sem interação e
        // NÃO voltava — se o leitor idoso demorasse a notar (ou encostasse na
        // tela e depois pausasse), perdia o único atalho pra posição salva e
        // tinha que rolar procurando. Agora fica até: (a) tocar nele, (b) tocar
        // no ×, ou (c) a rolagem passar do ponto salvo (sinal de que já se achou).
        function _onScrollPastTarget() {
            const topicEl = document.getElementById(`topic-${topicIdx}`);
            const pEl = (Number.isInteger(paragraphIdx) && topicEl)
                ? topicEl.querySelector(`p[data-p-idx="${paragraphIdx}"]`)
                : null;
            const target = pEl || topicEl;
            if (!target) return;
            const HEADER_H = document.querySelector('.header')?.offsetHeight || 80;
            if (target.getBoundingClientRect().top <= HEADER_H + 24) {
                window.removeEventListener('scroll', _onScrollPastTarget);
                if (btn.parentElement) {
                    btn.style.animation = 'resumeBtnOut 0.3s ease forwards';
                    setTimeout(() => btn.remove(), 300);
                }
            }
        }
        window.addEventListener('scroll', _onScrollPastTarget, { passive: true });
    }

    // ──────────────────────────────────────────────────────────────────
    // Interaction guard para saveReadingPosition.
    //
    // Sem isso, abrir um artigo (sem ?topic=) e sair sem rolar salvava
    // topic_index=0 no cloud, sobrescrevendo o progresso anterior. Aí o
    // "Continuar leitura" parava de aparecer porque o cloud sempre
    // tinha 0.
    //
    // Regra: só salvamos posição se o usuário REALMENTE rolou/tocou o
    // artigo nesta sessão. Auto-scrolls iniciais (URL ?topic=N, click
    // do "Continuar leitura") acontecem nos primeiros ~1500ms e não
    // contam — só interações depois desse settle.
    // ──────────────────────────────────────────────────────────────────
    let _userInteracted = false;
    let _interactionEnabled = false;
    setTimeout(() => { _interactionEnabled = true; }, 1500);
    const _markInteraction = () => { if (_interactionEnabled) _userInteracted = true; };
    window.addEventListener('scroll', _markInteraction, { passive: true });
    window.addEventListener('touchstart', _markInteraction, { passive: true });
    window.addEventListener('keydown', _markInteraction);

    // ── Scroll high-water mark (% do conteúdo realmente exposto na maior leitura)
    // Usado pelo admin pra distinguir "ficou 10 min e leu até o fim" de
    // "ficou 10 min mas só viu o início". Persistido via update_max_scroll_pct.
    let _maxScrollKey = null;
    let _maxScrollPct = 0;
    let _scrollFlushTimer = null;

    function _computeScrollPct() {
        // Mede % do reader-content já exposto ao usuário (fundo da viewport).
        // Fallback para o documento se o container não existir.
        const el = document.getElementById('readerContainer') || document.documentElement;
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        const viewportBottom = window.innerHeight;
        let pct;
        if (rect) {
            const total = el.scrollHeight || rect.height;
            if (total <= viewportBottom) return 100; // cabe na tela
            const exposed = Math.min(total, viewportBottom - rect.top);
            pct = (exposed / total) * 100;
        } else {
            const docH = document.documentElement.scrollHeight;
            if (docH <= viewportBottom) return 100;
            pct = ((window.scrollY + viewportBottom) / docH) * 100;
        }
        return Math.max(0, Math.min(100, Math.round(pct)));
    }

    function _trackScroll() {
        try {
            const { volId, filename } = getParams();
            if (!volId || !filename) return;
            const key = `${volId}|${filename}`;
            if (_maxScrollKey !== key) {
                // Mudou de ensinamento — flush antes de zerar
                _flushScrollPct();
                _maxScrollKey = key;
                _maxScrollPct = 0;
            }
            const cur = _computeScrollPct();
            if (cur > _maxScrollPct) _maxScrollPct = cur;
        } catch (_) {}
    }

    function _flushScrollPct() {
        if (!_maxScrollKey || _maxScrollPct <= 0) return;
        const [volId, filename] = _maxScrollKey.split('|');
        if (window._cloudSync?.updateMaxScrollPct) {
            window._cloudSync.updateMaxScrollPct(volId, filename, _maxScrollPct);
        }
    }

    let _posSaveTimer;
    window.addEventListener('scroll', () => {
        _trackScroll();
        clearTimeout(_scrollFlushTimer);
        _scrollFlushTimer = setTimeout(_flushScrollPct, 2000);
        // Salva a posição de leitura periodicamente enquanto rola (debounce 5s):
        // se o SO matar a aba em 2º plano (comum em celulares antigos do
        // público-alvo) antes do pagehide/beforeunload, a posição não se perde.
        clearTimeout(_posSaveTimer);
        _posSaveTimer = setTimeout(saveReadingPosition, 5000);
    }, { passive: true });
    // Captura também o estado inicial (caso o reader caiba inteiro na tela)
    setTimeout(_trackScroll, 1800);

    function saveReadingPosition() {
        if (!_userInteracted) return;
        try {
            const { volId, filename } = getParams();
            if (!volId || !filename) return;
            const { topicIdx, paragraphIdx } = getVisiblePosition();
            const totalTopics = window._currentTotalTopics || 1;
            const history = JSON.parse(localStorage.getItem('readHistory') || '[]');
            const existing = history.find(h => h.file === filename && h.vol === volId);
            if (existing) {
                existing.topic = topicIdx;
                existing.totalTopics = totalTopics;
                if (paragraphIdx !== null) existing.paragraphIdx = paragraphIdx;
                localStorage.setItem('readHistory', JSON.stringify(history));
            }

            // Sync to cloud
            if (window._cloudSync) {
                window._cloudSync.saveReadingPosition(volId, filename, topicIdx, totalTopics, paragraphIdx);
            }
        } catch (e) { }
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            _trackScroll();
            _flushScrollPct();
            saveReadingPosition();
        }
    });
    window.addEventListener('beforeunload', () => {
        _trackScroll();
        _flushScrollPct();
        saveReadingPosition();
    });
    // pagehide: no iOS Safari beforeunload é não-confiável; os módulos irmãos
    // (read-time-tracker, scroll-progress) já escutam pagehide — a posição de
    // leitura, o dado mais visível pro usuário, faltava.
    window.addEventListener('pagehide', () => {
        _trackScroll();
        _flushScrollPct();
        saveReadingPosition();
    });

});
