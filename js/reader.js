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

  const targets = [];
  if (idx + 1 < navJson.length) targets.push(navJson[idx + 1]);
  if (idx - 1 >= 0) targets.push(navJson[idx - 1]);

  const schedule = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 })
    : (fn) => setTimeout(fn, 400);

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
            const dist = Math.abs(el.getBoundingClientRect().top - viewMid);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        });
        return bestIdx;
    }

    async function initReader(ovrVol, ovrFile, searchTopicTitle) {
        const { volId, filename, searchQuery, topicTitle, topicIdx, highlightId, hlScroll } = getParams(ovrVol, ovrFile);
        const finalTopicTitle = searchTopicTitle || topicTitle;
        if (!volId || !filename) {
            container.innerHTML = `<div class="error">Selecione um ensinamento no índice.</div>`;
            return;
        }

        // Restore reading position from cloud if no explicit topic was requested
        let resolvedTopicIdx = topicIdx;
        if (resolvedTopicIdx === null && window._cloudSync) {
            try {
                const pos = await window._cloudSync.getLastPosition(volId, filename);
                if (pos && pos.topic_index > 0) {
                    resolvedTopicIdx = pos.topic_index;
                }
            } catch (e) { /* fallback to 0 */ }
        }

        // When loading to a specific topic, create a temporary overlay so content
        // can be rendered and scrolled before becoming visible — eliminates the jump.
        if (finalTopicTitle || (resolvedTopicIdx !== null && resolvedTopicIdx > 0) || (highlightId && hlScroll)) {
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
            renderReader(volId, filename, articleJson, navJson, searchQuery, finalTopicTitle, hlScroll);
            _prefetchAdjacent(volId, navJson, filename);

            // Scroll to restored position
            if (resolvedTopicIdx !== null && resolvedTopicIdx > 0 && !highlightId) {
                setTimeout(() => {
                    const el = document.getElementById(`topic-${resolvedTopicIdx}`);
                    if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
                    const gate = document.getElementById('reader-scroll-gate');
                    if (gate) { gate.style.transition = 'opacity 0.3s'; gate.style.opacity = '0'; setTimeout(() => gate.remove(), 300); }
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
            console.error('Reader Error:', err);
            container.innerHTML = `<div class="error">Erro ao carregar o ensinamento.</div>`;
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

    window.toggleFavorite = async function () {
        const { volId, filename } = getParams();
        let favorites = [];
        try { favorites = JSON.parse(localStorage.getItem('savedFavorites') || '[]'); } catch (e) { }
        const topicIndex = getVisibleTopicIndex();
        const title = document.title.replace('Meishu-Sama: ', '').replace(' - Mioshie College', '');
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

        // Sync to cloud
        if (window._cloudSync) {
            if (isSaved) {
                await window._cloudSync.removeFavorite(volId, filename, topicIndex);
            } else {
                await window._cloudSync.saveFavorite(volId, filename, topicIndex, topicTitle, snippet, totalTopics);
            }
        }

        const lang = localStorage.getItem('site_lang') || 'pt';
        if (typeof window.updateFavIndicators === 'function') window.updateFavIndicators();
        if (typeof renderFavorites === 'function') renderFavorites();

        const tooltip = document.getElementById('saveTooltip');
        if (tooltip) {
            const statusText = { pt: { saved: 'salvo', removed: 'removido' }, ja: { saved: '保存済み', removed: '削除済み' } }[lang] || { saved: 'salvo', removed: 'removido' };
            const rawTitle = topicTitle || title;
            const cleanTitle = rawTitle.replace(/^(Ensinamento|Orientação|Palestra) de (Meishu-Sama|Moisés)\s*[-:]\s*/i, '').replace(/^["'](.*?)["']$/, '$1').trim();
            document.getElementById('saveTooltipTitle').textContent = cleanTitle;
            document.getElementById('saveTooltipStatus').textContent = isSaved ? statusText.removed : statusText.saved;
            tooltip.classList.add('show');
            clearTimeout(window._saveTooltipTimer);
            window._saveTooltipTimer = setTimeout(() => tooltip.classList.remove('show'), 1800);
        }
    };

    window.renderContent = () => initReader();

    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn && navigator.share) shareBtn.style.display = '';
    window.shareArticle = async function () {
        try { await navigator.share({ title: document.title, url: window.location.href }); } catch (e) { }
    };

    initReader();
    window.addEventListener('popstate', () => initReader());

    function saveReadingPosition() {
        try {
            const { volId, filename } = getParams();
            if (!volId || !filename) return;
            const topicIndex = getVisibleTopicIndex();
            const totalTopics = window._currentTotalTopics || 1;
            const history = JSON.parse(localStorage.getItem('readHistory') || '[]');
            const existing = history.find(h => h.file === filename && h.vol === volId);
            if (existing) { existing.topic = topicIndex; existing.totalTopics = totalTopics; localStorage.setItem('readHistory', JSON.stringify(history)); }

            // Sync to cloud
            if (window._cloudSync) {
                window._cloudSync.saveReadingPosition(volId, filename, topicIndex, totalTopics);
            }
        } catch (e) { }
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveReadingPosition(); });
    window.addEventListener('beforeunload', saveReadingPosition);

    // Swipe navigation (mobile)
    let _touchStartX = 0, _touchStartY = 0;
    document.addEventListener('touchstart', e => { _touchStartX = e.changedTouches[0].clientX; _touchStartY = e.changedTouches[0].clientY; }, { passive: true });
    document.addEventListener('touchend', e => {
        if (!window._swipeNav) return;
        const dx = e.changedTouches[0].clientX - _touchStartX;
        const dy = e.changedTouches[0].clientY - _touchStartY;
        if (Math.abs(dx) < 80 || Math.abs(dy) > 60) return;
        const { vol, prev, next } = window._swipeNav;
        if (dx > 0 && prev) window.navigateToReader(vol, prev);
        else if (dx < 0 && next) window.navigateToReader(vol, next);
    }, { passive: true });
});
