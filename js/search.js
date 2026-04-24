// ============================================================
// SEARCH — bilingual full-text search with Japanese (tj/cj) field support
// ============================================================

let searchIndex = null;
let isFetchingIndex = false;
let searchTimeout = null;
let _allResults = [];
let _displayedCount = 0;
let _currentQuery = '';
const RESULTS_PER_PAGE = 10;
const MAX_RESULTS = 50;
let _focusedIndex = -1;

function getBasePath() {
  return window.location.pathname.includes('/mioshiec') ? '../' : './';
}

function _norm(s) {
  return s.toLowerCase().replace(/[\s\u3000\u00A0]+/g, ' ').trim();
}

function _renderResultsList(results, count, highlightRegex, q, activeLang) {
  const visible = results.slice(0, count);
  const resultsHtml = visible.map(r => _renderResultItem(r, getBasePath(), highlightRegex, q, activeLang)).join('');
  const remaining = results.length - count;
  const loadMoreHtml = remaining > 0
    ? `<li class="search-load-more"><button class="btn-load-more" onclick="loadMoreResults()">${activeLang === 'ja' ? `さらに${Math.min(RESULTS_PER_PAGE, remaining)}件を表示` : `Carregar mais ${Math.min(RESULTS_PER_PAGE, remaining)} resultados`}</button><span class="load-more-hint">${activeLang === 'ja' ? `（残り${remaining}件）` : `(${remaining} restantes)`}</span></li>`
    : '';
  return resultsHtml + loadMoreHtml;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function getSearchIndex() {
  if (searchIndex && searchIndex.length > 0 && !isFetchingIndex) return searchIndex;

  if (isFetchingIndex) {
    while (isFetchingIndex) {
      await new Promise(r => setTimeout(r, 200));
    }
    return searchIndex;
  }

  isFetchingIndex = true;
  const resultsEl = document.getElementById('searchResults');
  const currentLang = localStorage.getItem('site_lang') || 'pt';

  const updateLoadingMsg = (msg) => {
    const inp = document.getElementById('searchInput');
    if (resultsEl && inp?.value.trim())
      resultsEl.innerHTML = `<li class="search-loading"><span class="search-spinner"></span>${msg}</li>`;
  };

  const loadingMsg = currentLang === 'ja' ? '検索インデックスを読み込み中...' : 'Carregando índice de pesquisa...';
  updateLoadingMsg(loadingMsg);

  const basePath = getBasePath();

  // Load section map dynamically
  if (!window.SECTION_MAP && !document.getElementById('sectionMapScript')) {
    const script = document.createElement('script');
    script.id = 'sectionMapScript';
    script.src = `${basePath}site_data/section_map.js`;
    document.head.appendChild(script);
  }

  // Load global index titles dynamically
  if (!window.GLOBAL_INDEX_TITLES && !document.getElementById('globalIndexTitlesScript')) {
    const script = document.createElement('script');
    script.id = 'globalIndexTitlesScript';
    script.src = `${basePath}site_data/global_index_titles.js`;
    document.head.appendChild(script);
  }

  // Require authentication for search
  if (!window.supabaseStorageFetch) {
    const errorMsg = currentLang === 'ja' ? 'ログインが必要です。' : 'Login necessário.';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-error">${errorMsg}</li>`;
    isFetchingIndex = false;
    return searchIndex;
  }

  // For limited users, only load volumes they have access to
  const _limitedConfig = (typeof isLimitedUser === 'function' && isLimitedUser())
    ? (typeof getAccessConfig === 'function' ? getAccessConfig() : null)
    : null;
  const allVolumes = _limitedConfig && typeof getEnabledVolumes === 'function'
    ? getEnabledVolumes(_limitedConfig)
    : ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];

  // Detect current volume to load it first
  const pathMatch = window.location.pathname.match(/mioshiec(\d)/);
  const urlParams = new URLSearchParams(window.location.search);
  const volParam = urlParams.get('vol') || urlParams.get('v');
  const currentVol = pathMatch ? `mioshiec${pathMatch[1]}` : (volParam || null);

  const [first, ...rest] = currentVol
    ? [currentVol, ...allVolumes.filter(v => v !== currentVol)]
    : allVolumes;

  try {
    searchIndex = [];

    try {
      if (!window.supabaseStorageFetch) {
        throw new Error('Authentication required');
      }
      const firstData = await window.supabaseStorageFetch(`search_index_${first}.json`);
      searchIndex = firstData;
    } catch (e) {
      console.warn(`Search index ${first} failed:`, e);
    }

    // Release the lock — first vol loaded, search is usable now
    isFetchingIndex = false;

    const progressMsg = currentLang === 'ja'
      ? `インデックス読み込み中 (1/${allVolumes.length})...`
      : `Carregando índice (1/${allVolumes.length})...`;
    updateLoadingMsg(progressMsg);

    // 2. Remaining volumes — all in parallel
    if (rest.length > 0) {
      const settled = await Promise.allSettled(
        rest.map(async (vol) => {
          if (!window.supabaseStorageFetch) throw new Error('Auth required');
          return await window.supabaseStorageFetch(`search_index_${vol}.json`);
        })
      );
      settled.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          searchIndex = searchIndex.concat(result.value);
        } else {
          console.warn(`Search index ${rest[i]} failed:`, result.reason);
        }
      });
    }

    if (searchIndex.length === 0) {
      throw new Error('Nenhum dado de pesquisa encontrado.');
    }

    // Filter entries for limited users with file-level restrictions
    if (_limitedConfig) {
      searchIndex = searchIndex.filter(item => {
        const volConfig = _limitedConfig[item.v];
        if (volConfig === 'all') return true;
        if (Array.isArray(volConfig)) return volConfig.includes(item.f);
        return false;
      });
    }
  } catch (err) {
    console.error('Search index error:', err);
    const errorMsg = currentLang === 'ja' ? 'インデックスの読み込みに失敗しました。' : 'Erro ao carregar o índice. Verifique sua conexão.';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-error">${errorMsg}</li>`;
  } finally {
    isFetchingIndex = false;
  }

  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClear');
  if (searchInput && clearBtn) {
    clearBtn.style.display = searchInput.value.trim() ? 'flex' : 'none';
  }

  return searchIndex;
}

function _resolveAccessibleVolumes() {
  const limitedConfig = (typeof isLimitedUser === 'function' && isLimitedUser())
    ? (typeof getAccessConfig === 'function' ? getAccessConfig() : null)
    : null;
  return limitedConfig && typeof getEnabledVolumes === 'function'
    ? getEnabledVolumes(limitedConfig)
    : ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];
}

function _setRandomLoading(btn) {
  if (!btn || btn.disabled) return { restore: () => {} };
  const origHtml = btn.innerHTML;
  const origWidth = btn.offsetWidth;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const txt = lang === 'ja' ? '読み込み中...' : 'Carregando...';
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.style.minWidth = origWidth + 'px';
  btn.innerHTML = `<span class="search-spinner" aria-hidden="true"></span><span>${txt}</span>`;
  return {
    restore: () => {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.style.minWidth = '';
      btn.innerHTML = origHtml;
    }
  };
}

window.openRandomFromVolume = async function(vol, evt) {
  const loader = _setRandomLoading(evt?.currentTarget);
  try {
    const lang = localStorage.getItem('site_lang') || 'pt';
    let items;
    if (searchIndex && searchIndex.length > 0) {
      items = searchIndex.filter(item => item.v === vol);
    } else if (window.supabaseStorageFetch) {
      try {
        items = await window.supabaseStorageFetch(`search_index_${vol}.json`);
      } catch (e) {
        console.warn(`Volume index ${vol} failed:`, e);
        loader.restore();
        return;
      }
    } else {
      loader.restore();
      return;
    }
    if (!items || items.length === 0) { loader.restore(); return; }
    const item = items[Math.floor(Math.random() * items.length)];
    const topicIdx = item.i != null ? item.i : 0;
    let href = `${getBasePath()}reader.html?vol=${item.v || vol}&file=${item.f}`;
    if (topicIdx > 0) href += `&topic=${topicIdx}`;
    if (lang === 'ja') href += `&lang=ja`;
    window.location.href = href;
  } catch (err) {
    console.error('Random volume teaching failed:', err);
    loader.restore();
  }
};

window.openRandomTeaching = async function(evt) {
  const loader = _setRandomLoading(evt?.currentTarget);
  try {
    const lang = localStorage.getItem('site_lang') || 'pt';
    let items = (searchIndex && searchIndex.length > 0) ? searchIndex : null;

    if (!items) {
      if (!window.supabaseStorageFetch) { loader.restore(); return; }
      const volumes = _resolveAccessibleVolumes();
      if (!volumes || volumes.length === 0) { loader.restore(); return; }
      const randomVol = volumes[Math.floor(Math.random() * volumes.length)];
      try {
        items = await window.supabaseStorageFetch(`search_index_${randomVol}.json`);
        items = (items || []).map(it => ({ ...it, v: it.v || randomVol }));
      } catch (e) {
        console.warn('Fast random load failed, falling back to full index:', e);
        await getSearchIndex();
        items = searchIndex;
      }
    }

    if (!items || items.length === 0) { loader.restore(); return; }
    const item = items[Math.floor(Math.random() * items.length)];
    const topicIdx = item.i != null ? item.i : 0;
    let href = `${getBasePath()}reader.html?vol=${item.v}&file=${item.f}`;
    if (topicIdx > 0) href += `&topic=${topicIdx}`;
    if (lang === 'ja') href += `&lang=ja`;
    window.location.href = href;
  } catch (err) {
    console.error('Random teaching failed:', err);
    loader.restore();
  }
};

window.clearSearch = function () {
  const input = document.getElementById('searchInput');
  const resultsEl = document.getElementById('searchResults');
  const clearBtn = document.getElementById('searchClear');
  if (input) {
    input.value = '';
    input.focus();
  }
  if (resultsEl) resultsEl.innerHTML = '';
  if (clearBtn) clearBtn.style.display = 'none';
  _updateSearchCount(0, 0, localStorage.getItem('site_lang') || 'pt');
  sessionStorage.removeItem('searchQuery');
  sessionStorage.removeItem('searchResultsHtml');
  _allResults = [];
  _displayedCount = 0;
  _currentQuery = '';
  _focusedIndex = -1;
}

window.openSearch = function () {
  const modal = document.getElementById('searchModal');
  const input = document.getElementById('searchInput');
  if (modal) {
    modal.classList.add('active');
    _trapFocus(modal);
    if (input) {
      input.focus();
      const clearBtn = document.getElementById('searchClear');
      if (clearBtn) clearBtn.style.display = input.value.trim() ? 'flex' : 'none';

      // If we have a query but no rendered results (e.g., after page reload),
      // re-trigger the search to generate results with correct data attributes
      const resultsEl = document.getElementById('searchResults');
      if (input.value.trim() && resultsEl && !resultsEl.querySelector('.search-result-item')) {
        getSearchIndex().then(() => {
          if (typeof performSearch === 'function') performSearch(input.value);
        });
        return;
      }
    }
    getSearchIndex();
  }
}

window.closeSearch = function (preserveQuery = false) {
  const modal = document.getElementById('searchModal');
  if (!modal) return;
  modal.classList.remove('active');
  _releaseFocus(modal);
  if (!preserveQuery) {
    sessionStorage.removeItem('searchQuery');
    sessionStorage.removeItem('searchResultsHtml');
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    const clearBtn = document.getElementById('searchClear');
    if (clearBtn) clearBtn.style.display = 'none';
    const resultsEl = document.getElementById('searchResults');
    if (resultsEl) resultsEl.innerHTML = '';
  }
}

// --- Search Preview Modal (iframe) ---

function _iframeCall(fnName, ...args) {
  const iframe = document.getElementById('searchPreviewIframe');
  if (!iframe || !iframe.contentWindow) return;
  try {
    if (typeof iframe.contentWindow[fnName] === 'function') iframe.contentWindow[fnName](...args);
  } catch (e) { }
}

function _syncSpmFavorite() {
  const iframe = document.getElementById('searchPreviewIframe');
  const btn = document.getElementById('spmFavorite');
  if (!btn || !iframe) return;
  try {
    const favs = JSON.parse(localStorage.getItem('savedFavorites') || '[]');
    const isSaved = favs.some(f => f.vol === iframe.dataset.vol && f.file === iframe.dataset.file);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isSaved ? 'currentColor' : 'none');
    btn.classList.toggle('spm-btn--active', isSaved);
  } catch (e) { }
}

function _syncSpmLang() {
  const btn = document.getElementById('spmLang');
  if (!btn) return;
  btn.textContent = (localStorage.getItem('site_lang') || 'pt') === 'ja' ? 'PT' : '日本語';
}

document.addEventListener('DOMContentLoaded', function _initSearchPreviewModal() {
  const isMobile = window.innerWidth <= 767;
  const openPubLabel = (localStorage.getItem('site_lang') || 'pt') === 'ja' ? '関連する教え' : 'Ensinamentos Relacionados';

  const overlay = document.createElement('div');
  overlay.className = 'search-preview-overlay';
  overlay.id = 'searchPreviewModal';
  overlay.innerHTML =
    '<div class="search-preview-panel" id="searchPreviewPanel">' +
      '<div class="search-preview-header">' +
        '<button class="search-preview-back" id="searchPreviewBack" onclick="closeSearchPreview()">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
          ' Resultados' +
        '</button>' +
        '<div class="search-preview-title-group">' +
          '<div class="search-preview-breadcrumb" id="searchPreviewBreadcrumb"></div>' +
          '<div class="search-preview-title" id="searchPreviewTitle"></div>' +
        '</div>' +
        '<button class="btn-zen spm-btn spm-open-pub" id="spmOpenPub" title="' + openPubLabel + '">' + openPubLabel + '</button>' +
        '<button class="modal-close-btn search-preview-close" onclick="closeSearchPreview()" aria-label="Fechar preview">\u00d7</button>' +
      '</div>' +
      '<div class="search-preview-body">' +
        '<div class="search-preview-card" id="searchPreviewCard">' +
          '<div class="search-preview-card-content" id="searchPreviewCardContent"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeSearchPreview();
  });

  const openPubBtn = document.getElementById('spmOpenPub');
  if (openPubBtn) {
    openPubBtn.addEventListener('click', () => {
      const iframe = document.getElementById('searchPreviewIframe');
      const card = document.getElementById('searchPreviewCard');
      const vol = iframe?.dataset.vol || card?.dataset.vol || '';
      const file = iframe?.dataset.file || card?.dataset.file || '';
      const lang = localStorage.getItem('site_lang') || 'pt';
      window.location.href = `${getBasePath()}reader.html?vol=${vol}&file=${file}&topic=0${lang === 'ja' ? '&lang=ja' : ''}`;
    });
  }
});

window.openSearchPreview = function (vol, file, search, displayTitle, topicIdx, sectionLabel) {
  const overlay = document.getElementById('searchPreviewModal');
  const iframe = document.getElementById('searchPreviewIframe');
  const card = document.getElementById('searchPreviewCard');
  const titleEl = document.getElementById('searchPreviewTitle');
  const breadcrumbEl = document.getElementById('searchPreviewBreadcrumb');
  const cardContentEl = document.getElementById('searchPreviewCardContent');
  if (!overlay) return;

  const basePath = getBasePath();
  const lang = localStorage.getItem('site_lang') || 'pt';
  const isMobile = window.innerWidth <= 767;

  if (titleEl) titleEl.textContent = displayTitle || '';
  if (breadcrumbEl) breadcrumbEl.textContent = sectionLabel || '';

  if (card) { card.dataset.vol = vol; card.dataset.file = file; }

  const renderCardContent = (contentHtml) => {
    if (cardContentEl) cardContentEl.innerHTML = contentHtml;
  };

  const _applyHighlight = (text) => {
    if (!search || !search.trim()) return text;
    const queryParts = search.trim().toLowerCase().split('&').map(p => p.trim()).filter(p => p.length >= 2);
    if (queryParts.length === 0) return text;
    const exactToggle = document.getElementById('searchExactToggle');
    const useExactMatch = exactToggle ? exactToggle.checked : false;
    const isJapanese = lang === 'ja';
    const escapedParts = queryParts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const highlightRegex = isJapanese
      ? new RegExp(`(${escapedParts.join('|')})`, 'gi')
      : (useExactMatch
        ? new RegExp(`\\b(${escapedParts.join('|')})\\b`, 'gi')
        : new RegExp(`\\b(${escapedParts.join('|')})`, 'gi'));
    return text.replace(highlightRegex, '<mark class="search-highlight">$1</mark>');
  };

  function _renderFallback() {
    let fallback = '';
    if (typeof searchIndex !== 'undefined' && searchIndex) {
      const items = searchIndex.filter(r => r.v === vol && r.f === file && (r.i == null ? 0 : r.i) === (topicIdx || 0));
      if (items.length > 0) {
        fallback = items.map(item => lang === 'ja' ? (item.cj || item.c || '') : (item.c || '')).join('\n\n');
      }
    }
    if (fallback) {
      let safeContent = String(fallback).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      safeContent = safeContent.split(/\n+/).filter(line => line.trim()).map(line => `<p>${line}</p>`).join('');
      renderCardContent(_applyHighlight(safeContent));
    } else {
      renderCardContent('<p style="padding:2rem;text-align:center;color:var(--text-muted);">Conteúdo indisponível.</p>');
    }
  }

  renderCardContent('<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.95rem;">Carregando o ensinamento completo...</div>');

  if (window.supabaseStorageFetch) {
    const fileNameStr = file.endsWith('.json') ? file : `${file}.json`;
    window.supabaseStorageFetch(`${vol}/${fileNameStr}`).then(json => {
      let topicsFound = [];
      if (json && json.themes) {
          json.themes.forEach(theme => {
              if (theme.topics) theme.topics.forEach(topic => topicsFound.push(topic));
          });
      }
      
      let fullContent = '';
      if (topicsFound.length > 0) {
          const targetTopic = topicsFound[topicIdx || 0] || topicsFound[0];
          if (targetTopic) {
              fullContent = lang === 'ja' 
                  ? (targetTopic.content_ja || targetTopic.content || '') 
                  : (targetTopic.content_ptbr || targetTopic.content_pt || targetTopic.content || '');
          }
      }

      if (fullContent) {
        let safeContent = String(fullContent)
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/gi, ' ');
          
        safeContent = escHtml(safeContent);
        safeContent = safeContent.split(/\n+/).filter(line => line.trim()).map(line => `<p>${line}</p>`).join('');
        renderCardContent(_applyHighlight(safeContent));
      } else {
        _renderFallback();
      }
    }).catch(err => {
       console.warn('Erro ao carregar do Storage para preview:', err);
       _renderFallback();
    });
  } else {
    _renderFallback();
  }

  overlay.classList.add('active');
  _trapFocus(overlay);
};

window.closeSearchPreview = function () {
  const overlay = document.getElementById('searchPreviewModal');
  const iframe = document.getElementById('searchPreviewIframe');
  const card = document.getElementById('searchPreviewCard');
  if (!overlay) return;
  overlay.classList.remove('active');
  _releaseFocus(overlay);
  if (iframe) setTimeout(() => { if (!overlay.classList.contains('active')) iframe.src = ''; }, 300);
  if (card) {
    const contentEl = document.getElementById('searchPreviewCardContent');
    if (contentEl) contentEl.innerHTML = '';
    delete card.dataset.vol;
    delete card.dataset.file;
  }
};

// --- Search DOM listeners ---

document.addEventListener('DOMContentLoaded', () => {
  const searchModal = document.getElementById('searchModal');
  const searchInput = document.getElementById('searchInput');

  if (searchModal) searchModal.addEventListener('click', (e) => {
    if (e.target.id === 'searchModal') closeSearch();
  });

  // Restore search query from sessionStorage (will re-search on open for correct handlers)
  const savedQuery = sessionStorage.getItem('searchQuery');
  if (savedQuery && searchInput) {
    searchInput.value = savedQuery;
    const clearBtn = document.getElementById('searchClear');
    if (clearBtn) clearBtn.style.display = 'flex';
  }

  const triggerSearch = () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value;
    const clearBtn = document.getElementById('searchClear');
    if (clearBtn) clearBtn.style.display = query.trim() ? 'flex' : 'none';

    const resultsEl = document.getElementById('searchResults');
    const currentLang = localStorage.getItem('site_lang') || 'pt';
    _focusedIndex = -1;
    _updateSearchCount(0, 0, currentLang);

    if (!query.trim()) {
      if (resultsEl) resultsEl.innerHTML = '';
      return;
    }

    const searchingMsg = currentLang === 'ja' ? '検索中...' : 'Buscando...';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-loading"><span class="search-spinner"></span>${searchingMsg}</li>`;

    const delay = query.trim().length <= 3 ? 500 : 200;
    searchTimeout = setTimeout(async () => {
      const loaded = await getSearchIndex();
      if (!searchIndex || searchIndex.length === 0) {
        const resultsEl = document.getElementById('searchResults');
        const errMsg = currentLang === 'ja' ? '検索インデックスの読み込みに失敗しました。' : 'Falha ao carregar o índice de busca.';
        if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${errMsg}</li>`;
        return;
      }
      performSearch(query);
    }, delay);
  };

  if (searchInput) searchInput.addEventListener('input', triggerSearch);

  document.querySelectorAll('input[name="searchFilter"]').forEach(node => {
    node.addEventListener('change', () => {
      if (searchInput && searchInput.value.trim().length >= 3) triggerSearch();
    });
  });

  // Exact word matching toggle
  const exactToggle = document.getElementById('searchExactToggle');
  if (exactToggle) {
    exactToggle.checked = localStorage.getItem('search_exact') === 'true';
    exactToggle.addEventListener('change', () => {
      try { localStorage.setItem('search_exact', exactToggle.checked); } catch (e) { }
      if (searchInput && searchInput.value.trim().length >= 2) performSearch(searchInput.value);
    });
  }

  // Fallback close button for volume pages (uses id="searchClose" without onclick)
  const searchCloseBtn = document.getElementById('searchClose');
  if (searchCloseBtn) {
    searchCloseBtn.addEventListener('click', closeSearch);
  }

  // Arrow key navigation within search results
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      const items = document.querySelectorAll('#searchResults .search-result-item');
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _focusedIndex = Math.min(_focusedIndex + 1, items.length - 1);
        _updateFocusedItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _focusedIndex = Math.max(_focusedIndex - 1, -1);
        _updateFocusedItem(items);
      } else if (e.key === 'Enter' && _focusedIndex >= 0) {
        e.preventDefault();
        items[_focusedIndex]?.click();
      }
    });
  }

  // Global keyboard shortcuts: Ctrl+K / Cmd+K / '/' opens search; Escape closes
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
      return;
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !document.activeElement?.isContentEditable) {
        e.preventDefault();
        openSearch();
        return;
      }
    }
    if (e.key === 'Escape') {
      const previewModal = document.getElementById('searchPreviewModal');
      if (previewModal?.classList.contains('active')) { closeSearchPreview(); return; }
      if (searchModal?.classList.contains('active')) { closeSearch(); return; }
    }
  });

  // ── #1: XSS fix — event delegation instead of inline onclick per result ──
  const resultsContainer = document.getElementById('searchResults');
  if (resultsContainer) {
    resultsContainer.addEventListener('click', (e) => {
      const a = e.target.closest('.search-result-item');
      if (!a) return;
      e.preventDefault();
      openSearchPreview(
        a.dataset.vol,
        a.dataset.file,
        a.dataset.query,
        a.dataset.title,
        a.dataset.topic != null ? parseInt(a.dataset.topic, 10) : null,
        a.dataset.section || ''
      );
    });
  }
});

let _supabaseLogTimer = null;

function logSearch(query, count) {
  try {
    const key = 'mioshie_search_log';
    const log = JSON.parse(localStorage.getItem(key) || '[]');
    log.push({ q: query.trim(), n: count, ts: Math.floor(Date.now() / 1000) });
    if (log.length > 200) log.splice(0, log.length - 200);
    localStorage.setItem(key, JSON.stringify(log));
  } catch (e) { }

  // Log to Supabase with debounce — only logs the final settled query
  clearTimeout(_supabaseLogTimer);
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 3) return; // ignore very short partial queries
  _supabaseLogTimer = setTimeout(() => {
    try {
      const supabase = window.supabaseAuth?.supabase;
      if (supabase) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) {
            supabase.from('search_logs').insert({
              user_id: session.user.id,
              query: trimmed.substring(0, 200),
              results_count: count
            }).then(() => {}).catch(() => {});
          }
        });
      }
    } catch (e) { }
  }, 2000);
}

function _updateFocusedItem(items) {
  items.forEach((item, i) => item.classList.toggle('is-focused', i === _focusedIndex));
  if (_focusedIndex >= 0) items[_focusedIndex]?.scrollIntoView({ block: 'nearest' });
}

function _updateSearchCount(total, shown, lang, hitLimit = false) {
  const el = document.getElementById('searchCount');
  if (!el) return;
  if (total === 0) { el.textContent = ''; return; }
  let text = lang === 'ja'
    ? `${total}件中${shown}件を表示`
    : `Exibindo ${shown} de ${total} resultado${total !== 1 ? 's' : ''}`;
  if (hitLimit) {
    text += lang === 'ja' ? ' — 検索を絞り込むとより正確な結果が得られます' : ' — refine a busca para resultados mais precisos';
  }
  el.textContent = text;
}

function performSearch(query) {
  const resultsEl = document.getElementById('searchResults');
  const activeLang = localStorage.getItem('site_lang') || 'pt';
  if (!query || query.trim().length < 2) {
    if (!query || query.trim().length === 0) {
      if (resultsEl) resultsEl.innerHTML = '';
    } else {
      const minCharsMsg = activeLang === 'ja' ? '2文字以上入力してください...' : 'Digite pelo menos 2 caracteres...';
      if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${minCharsMsg}</li>`;
    }
    return;
  }

  if (!searchIndex) return;

  const q = query.trim();
  const qLower = q.toLowerCase();

  // Support for multiple search terms with & (AND logic)
  const queryParts = qLower.split('&').map(p => p.trim()).filter(p => p.length >= 2);
  if (queryParts.length === 0) {
    const invalidQueryMsg = activeLang === 'ja' ? '有効な検索ワードを入力してください...' : 'Digite termos de busca válidos...';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${invalidQueryMsg}</li>`;
    return;
  }

  const filterNodes = document.querySelectorAll('input[name="searchFilter"]');
  let filterMode = 'all';
  for (const node of filterNodes) {
    if (node.checked) { filterMode = node.value; break; }
  }

  const exactToggle = document.getElementById('searchExactToggle');
  const useExactMatch = exactToggle ? exactToggle.checked : false;

  // ── #2: Improvement — compile RegExp ONCE before the search loop ──
  // Previously a new RegExp was created for every (item × part) combination.
  // With 2000+ index entries and 3 query parts, that was 6000+ allocations per search.
  // NOTE: Japanese doesn't use word boundaries, so we skip \b for JA mode.
  const isJapanese = activeLang === 'ja';
  const partRegexes = queryParts.map(part => {
    const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (isJapanese) {
      return useExactMatch
        ? new RegExp(`${escaped}`, 'i')
        : new RegExp(`${escaped}`, 'i');
    }
    return useExactMatch
      ? new RegExp(`\\b${escaped}\\b`, 'i')
      : new RegExp(`\\b${escaped}`, 'i');
  });

  let results = [];
  for (const item of searchIndex) {
    // PT fields (always available)
    const tPt = (item.t || '').toLowerCase();
    const cPt = (item.c || '').toLowerCase();
    // JA fields (optional)
    const tJa = (item.tj || '').toLowerCase();
    const cJa = (item.cj || '').toLowerCase();

    // Choose primary fields based on active language
    const titleSearch   = activeLang === 'ja' ? (tJa || tPt) : tPt;
    const contentSearch = activeLang === 'ja' ? (cJa || cPt) : cPt;
    // Always search both languages for cross-language discoverability
    const titleAlt   = activeLang === 'ja' ? tPt : tJa;
    const contentAlt = activeLang === 'ja' ? cPt : cJa;

    let allMatched = true;
    let score = 0;
    let matchedTitleOnce = false;
    let matchedContentOnce = false;

    for (let pi = 0; pi < queryParts.length; pi++) {
      const rx = partRegexes[pi];

      const matchTitlePart   = rx.test(titleSearch)   || rx.test(titleAlt);
      const matchContentPart = rx.test(contentSearch) || rx.test(contentAlt);

      if (!matchTitlePart && !matchContentPart) {
        allMatched = false;
        break;
      }

      if (matchTitlePart) {
        score += 120;
        // ── #8: Improvement — boost for matches at the start of the title ──
        // A query that appears at the beginning of the title is almost certainly
        // the most relevant result and should rank above mid-title matches.
        if (titleSearch.startsWith(queryParts[pi]) || titleAlt.startsWith(queryParts[pi])) {
          score += 50;
        }
      }
      if (matchContentPart) score += 10;
      if (matchTitlePart)   matchedTitleOnce   = true;
      if (matchContentPart) matchedContentOnce = true;
    }

    if (!allMatched) continue;
    if (filterMode === 'title'   && !matchedTitleOnce)   continue;
    if (filterMode === 'content' && !matchedContentOnce) continue;

    if (matchedContentOnce) {
      const raw = activeLang === 'ja' ? (item.cj || item.c || '') : (item.c || '');
      const rawLower = raw.toLowerCase();

      let bestPart = queryParts[0];
      let bestIdx = -1;
      for (const part of queryParts) {
        const idx = rawLower.indexOf(part);
        if (idx !== -1) { bestPart = part; bestIdx = idx; break; }
      }

      if (bestIdx !== -1) {
        const start = Math.max(0, bestIdx - 60);
        const end = Math.min(raw.length, bestIdx + bestPart.length + 60);
        let snippet = raw.substring(start, end);
        if (start > 0) snippet = '...' + snippet;
        if (end < raw.length) snippet += '...';
        item.snippet = snippet;
      }
    }

    results.push({ ...item, score });
  }

  results.sort((a, b) => b.score - a.score);

  // Deduplicate: keep only the best result per (volume + file + raw title).
  const _seenResultKeys = new Set();
  results = results.filter(r => {
    const key = `${r.v}:${r.f}:${(r.t || '').toLowerCase().trim()}`;
    if (_seenResultKeys.has(key)) return false;
    _seenResultKeys.add(key);
    return true;
  });

  const hitLimit = results.length > MAX_RESULTS;
  results = results.slice(0, MAX_RESULTS);

  if (results.length === 0) {
    const noResultsMsg = activeLang === 'ja' ? '結果が見つかりませんでした。' : 'Nenhum resultado.';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${noResultsMsg}</li>`;
    _updateSearchCount(0, 0, activeLang);
    logSearch(q, 0);
    sessionStorage.removeItem('searchQuery');
    sessionStorage.removeItem('searchResultsHtml');
    _allResults = [];
    _displayedCount = 0;
    _currentQuery = '';
    return;
  }

  const basePath = getBasePath();
  const escapedParts = queryParts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const highlightRegex = isJapanese
    ? new RegExp(`(${escapedParts.join('|')})`, 'gi')
    : (useExactMatch
      ? new RegExp(`\\b(${escapedParts.join('|')})\\b`, 'gi')
      : new RegExp(`\\b(${escapedParts.join('|')})`, 'gi'));

  _allResults = results;
  _currentQuery = q;
  _displayedCount = Math.min(RESULTS_PER_PAGE, results.length);
  _focusedIndex = -1;

  resultsEl.innerHTML = _renderResultsList(results, _displayedCount, highlightRegex, q, activeLang);
  _updateSearchCount(results.length, _displayedCount, activeLang, hitLimit);
  logSearch(q, results.length);

  sessionStorage.setItem('searchQuery', query);
  sessionStorage.setItem('searchResultsHtml', resultsEl.innerHTML);
}

window.loadMoreResults = function() {
  if (!_allResults.length) return;
  _displayedCount = Math.min(_displayedCount + RESULTS_PER_PAGE, _allResults.length);
  const resultsEl = document.getElementById('searchResults');
  if (!resultsEl) return;
  const activeLang = localStorage.getItem('site_lang') || 'pt';
  const isJapanese = activeLang === 'ja';
  const queryParts = _currentQuery.trim().toLowerCase().split('&').map(p => p.trim()).filter(p => p.length >= 2);
  const exactToggle = document.getElementById('searchExactToggle');
  const useExactMatch = exactToggle ? exactToggle.checked : false;
  const escapedParts = queryParts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const highlightRegex = isJapanese
    ? new RegExp(`(${escapedParts.join('|')})`, 'gi')
    : (useExactMatch
      ? new RegExp(`\\b(${escapedParts.join('|')})\\b`, 'gi')
      : new RegExp(`\\b(${escapedParts.join('|')})`, 'gi'));

  resultsEl.innerHTML = _renderResultsList(_allResults, _displayedCount, highlightRegex, _currentQuery, activeLang);
  _updateSearchCount(_allResults.length, _displayedCount, activeLang);
  _focusedIndex = -1;
  sessionStorage.setItem('searchResultsHtml', resultsEl.innerHTML);
};

function _renderResultItem(r, basePath, highlightRegex, q, activeLang) {
  const displayTitle = (activeLang === 'ja' && r.tj) ? r.tj : (r.t || '');
  const topicIdx = r.i != null ? r.i : 0;

  // Prioritize SECTION_MAP (has correct section names like "O Método do Johrei　１")
  // over GLOBAL_INDEX_TITLES (which may store per-file topic titles)
  const volMap = window.SECTION_MAP ? window.SECTION_MAP[r.v] : null;
  const sectObj = volMap ? volMap[r.f] : null;
  let sectLabel = sectObj ? (activeLang === 'ja' ? (sectObj.ja || sectObj.pt) : sectObj.pt) : '';
  if (!sectLabel) {
    const pubTitles = window.GLOBAL_INDEX_TITLES ? window.GLOBAL_INDEX_TITLES[r.v] : null;
    sectLabel = pubTitles ? (pubTitles[r.f] || '') : '';
  }
  const volNum = r.v.slice(-1);
  const isDifferent = sectLabel && _norm(sectLabel) !== _norm(displayTitle);
  
  const homeLabel = activeLang === 'ja' ? 'トップ' : 'Início';
  const volLabel = activeLang === 'ja' ? `第${volNum}巻` : `Volume ${volNum}`;
  const sectionHtml = isDifferent
    ? `<div style="font-size:0.8rem; color:var(--text-muted); font-weight:500; margin-bottom: 4px; opacity: 0.85;">${homeLabel} <span>/</span> ${volLabel} <span>/</span> ${escHtml(sectLabel)}</div>`
    : '';
  const breadcrumbLabel = isDifferent ? `${homeLabel} / ${volLabel} / ${sectLabel}` : `${homeLabel} / ${volLabel}`;

  const highlight = (r.snippet || '')
    .replace(highlightRegex, '<mark class="search-highlight">$1</mark>');

  let href = `${basePath}reader.html?vol=${r.v}&file=${r.f}&search=${encodeURIComponent(q)}`;
  if (topicIdx > 0) href += `&topic=${topicIdx}`;
  if (activeLang === 'ja') href += `&lang=ja`;

  return `<li><a href="${href}"
      class="search-result-item"
      data-vol="${escHtml(r.v)}"
      data-file="${escHtml(r.f)}"
      data-query="${escHtml(q)}"
      data-title="${escHtml(displayTitle)}"
      data-section="${escHtml(breadcrumbLabel)}"
      data-topic="${topicIdx}">
      ${sectionHtml}
      <div class="search-result-title">${escHtml(displayTitle)}</div>
      <div class="search-result-context">${highlight}</div>
    </a></li>`;
}
