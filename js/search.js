// ============================================================
// SEARCH — bilingual full-text search via Postgres FTS RPC
// ============================================================
// Cliente usa supabase.rpc('search_teachings'). Permissões por
// volume/arquivo são aplicadas server-side via auth.uid() na RPC,
// então o cliente NÃO precisa filtrar por user_permissions.

// ---------------------------------------------------------------
// PROVISIONAL — gating da busca por role
// ---------------------------------------------------------------
// Motivo: usuários estavam pegando o "atalho" da busca e perdendo a
// descoberta orgânica pelo índice. Esconder a busca pra não-admin
// força browsing manual.
//
// Pra religar a busca pra TODOS: mude SEARCH_ADMIN_ONLY para false
// abaixo (uma única linha). Nenhuma outra mudança necessária.
//
// Nota de segurança: a checagem é client-side (localStorage). Um
// usuário determinado pode forjar 'admin' no localStorage, mas isso
// só revela o modal — o RPC search_teachings ainda funciona pra
// qualquer authed user pelas RLS normais. O objetivo aqui é UX
// (nudge), não controle de acesso.
const SEARCH_ADMIN_ONLY = false;

function _searchEnabled() {
  if (!SEARCH_ADMIN_ONLY) return true;
  try { return localStorage.getItem('mioshie_auth') === 'admin'; }
  catch (e) { return false; }
}
window._searchEnabled = _searchEnabled;

let searchTimeout = null;
let _allResults = [];
let _displayedCount = 0;
let _currentQuery = '';
// Sequence ID: cada performSearch incrementa, e o handler de resposta só
// renderiza se o seq ainda for o último — descarta respostas de buscas
// que o usuário já abandonou (typeahead burst).
let _searchSeq = 0;
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

// Carrega os scripts de breadcrumb (section_map.js / global_index_titles.js).
// Usados por _renderResultItem para gerar a trilha "Início / Volume X / Seção".
function _loadSectionMaps() {
  const basePath = getBasePath();
  if (!window.SECTION_MAP && !document.getElementById('sectionMapScript')) {
    const script = document.createElement('script');
    script.id = 'sectionMapScript';
    script.src = `${basePath}site_data/section_map.js?v=1`;
    document.head.appendChild(script);
  }
  if (!window.GLOBAL_INDEX_TITLES && !document.getElementById('globalIndexTitlesScript')) {
    const script = document.createElement('script');
    script.id = 'globalIndexTitlesScript';
    script.src = `${basePath}site_data/global_index_titles.js?v=1`;
    document.head.appendChild(script);
  }
}

function _getSupabase() {
  return window.supabaseAuth?.supabase || null;
}

// ---------- Empty-state suggestions chips ----------
// Mostrados quando o user abre o modal sem ter digitado nada. Apenas
// chips curados (termos doutrinários core). A RPC popular_searches
// ainda é populada pelo log de buscas (analytics), mas não é exibida
// aqui — base de usuários pequena, mostrar buscas alheias era invasivo.
const _CURATED_SUGGESTIONS = {
  pt: ['Johrei', 'Salvação Divina', 'Purificação Equilibrada', 'Daijo', 'Verdade'],
  ja: ['浄霊', '救い', '浄化', '大乗', '真理'],
};

async function _renderSuggestionsPanel() {
  const panel = document.getElementById('searchSuggestions');
  const chipsEl = document.getElementById('searchSuggestionsChips');
  if (!panel || !chipsEl) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const curated = _CURATED_SUGGESTIONS[lang] || _CURATED_SUGGESTIONS.pt;
  if (curated.length === 0) { panel.style.display = 'none'; return; }
  chipsEl.innerHTML = curated.map(term =>
    `<button type="button" class="search-suggest-chip" data-term="${escHtml(term)}">${escHtml(term)}</button>`
  ).join('');
  panel.style.display = '';
}

function _toggleSuggestionsForInput() {
  const input = document.getElementById('searchInput');
  const panel = document.getElementById('searchSuggestions');
  if (!panel) return;
  panel.style.display = (input && input.value.trim()) ? 'none' : '';
}

function _setRandomLoading(btn) {
  if (!btn || btn.disabled) return { restore: () => {} };
  const origHtml = btn.innerHTML;
  const isIconOnly = btn.classList.contains('vol-random-btn');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  if (isIconOnly) {
    btn.innerHTML = `<span class="search-spinner search-spinner--icon" aria-hidden="true"></span>`;
  } else {
    const origWidth = btn.offsetWidth;
    const lang = localStorage.getItem('site_lang') || 'pt';
    const txt = lang === 'ja' ? '読み込み中...' : 'Carregando...';
    btn.style.minWidth = origWidth + 'px';
    btn.innerHTML = `<span class="search-spinner" aria-hidden="true"></span><span>${txt}</span>`;
  }
  return {
    restore: () => {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.style.minWidth = '';
      btn.innerHTML = origHtml;
    }
  };
}

async function _pickRandomViaRpc(onlyVol, loader) {
  const lang = localStorage.getItem('site_lang') || 'pt';
  const supabase = _getSupabase();
  if (!supabase) { loader.restore(); return; }

  const { data, error } = await supabase.rpc('random_teaching', { only_vol: onlyVol });
  if (error) {
    console.warn('random_teaching RPC error:', error);
    loader.restore();
    return;
  }
  if (!data || data.length === 0) { loader.restore(); return; }

  const item = data[0];
  const topicIdx = item.topic_idx != null ? item.topic_idx : 0;
  let href = `${getBasePath()}reader.html?vol=${item.vol}&file=${item.file}`;
  if (topicIdx > 0) href += `&topic=${topicIdx}`;
  if (lang === 'ja') href += `&lang=ja`;
  window.location.href = href;
}

window.openRandomFromVolume = async function(vol, evt) {
  const loader = _setRandomLoading(evt?.currentTarget);
  try {
    await _pickRandomViaRpc(vol, loader);
  } catch (err) {
    console.error('Random volume teaching failed:', err);
    loader.restore();
  }
};

window.openRandomTeaching = async function(evt) {
  const loader = _setRandomLoading(evt?.currentTarget);
  try {
    await _pickRandomViaRpc(null, loader);
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
  _toggleSuggestionsForInput();
}

window.openSearch = function () {
  // Single chokepoint pra todos os entrypoints (botão + Ctrl+K + "/").
  // Se a busca está provisoriamente gated, no-op silencioso.
  if (!_searchEnabled()) return;
  const modal = document.getElementById('searchModal');
  const input = document.getElementById('searchInput');
  if (modal) {
    modal.classList.add('active');
    _trapFocus(modal);
    if (input) {
      input.focus();
      const clearBtn = document.getElementById('searchClear');
      if (clearBtn) clearBtn.style.display = input.value.trim() ? 'flex' : 'none';

      // Restaurando estado após reload: se tem query salva mas nenhum resultado
      // renderizado, re-roda a busca pra gerar items com os data-attrs corretos.
      const resultsEl = document.getElementById('searchResults');
      if (input.value.trim() && resultsEl && !resultsEl.querySelector('.search-result-item')) {
        if (typeof performSearch === 'function') performSearch(input.value);
      }
    }
    _loadSectionMaps();
    // Render suggestions panel (only if input is empty).
    _renderSuggestionsPanel();
    _toggleSuggestionsForInput();
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
  const lang = localStorage.getItem('site_lang') || 'pt';
  const openPubLabel = lang === 'ja' ? '教えを開く' : 'Abrir Ensinamento';
  const quicklookLabel = lang === 'ja' ? '検索プレビュー' : 'Prévia da busca';

  const overlay = document.createElement('div');
  overlay.className = 'search-preview-overlay';
  overlay.id = 'searchPreviewModal';
  overlay.innerHTML =
    '<div class="search-preview-panel" id="searchPreviewPanel">' +
      // Linha 1: controles/estado \u2014 back \u00e0 esquerda, badge centralizado, close \u00e0 direita.
      // Cada item flex-1 pra alinhar sim\u00e9trico mesmo com texto de tamanho vari\u00e1vel.
      '<div class="search-preview-header">' +
        '<button class="search-preview-back" id="searchPreviewBack" onclick="closeSearchPreview()">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
          ' Resultados' +
        '</button>' +
        '<span class="search-preview-badge" id="searchPreviewBadge">' + quicklookLabel + '</span>' +
        '<button class="modal-close-btn search-preview-close" onclick="closeSearchPreview()" aria-label="Fechar preview">\u00d7</button>' +
      '</div>' +
      // Linha 2: contexto/conte\u00fado \u2014 breadcrumb pequeno em cima, t\u00edtulo do t\u00f3pico
      // em destaque embaixo. Centralizado, com truncamento ellipsis se exceder.
      '<div class="search-preview-context">' +
        '<div class="search-preview-breadcrumb" id="searchPreviewBreadcrumb"></div>' +
        '<div class="search-preview-title" id="searchPreviewTitle"></div>' +
      '</div>' +
      '<div class="search-preview-body">' +
        '<div class="search-preview-card" id="searchPreviewCard">' +
          '<div class="search-preview-card-content" id="searchPreviewCardContent"></div>' +
          '<div class="search-preview-card-fade" aria-hidden="true"></div>' +
        '</div>' +
      '</div>' +
      '<div class="search-preview-footer">' +
        '<button class="search-preview-cta" id="spmOpenPub" title="' + openPubLabel + '">' +
          '<span>' + openPubLabel + '</span>' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' +
        '</button>' +
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
      // Abre no MESMO topic_idx que o usuário está previsualizando — o
      // preview vira um quick look coerente (vê o tópico X, abre no X).
      // Antes ficava fixo em topic=0, o que pulava pro início da
      // publicação e confundia.
      const topicIdx = parseInt(card?.dataset.topic ?? '0', 10) || 0;
      const lang = localStorage.getItem('site_lang') || 'pt';
      let href = `${getBasePath()}reader.html?vol=${vol}&file=${file}`;
      if (topicIdx > 0) href += `&topic=${topicIdx}`;
      if (lang === 'ja') href += `&lang=ja`;
      window.location.href = href;
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

  if (card) {
    card.dataset.vol = vol;
    card.dataset.file = file;
    card.dataset.topic = String(topicIdx != null ? topicIdx : 0);
  }

  const renderCardContent = (contentHtml) => {
    if (cardContentEl) cardContentEl.innerHTML = contentHtml;
    // Detecta overflow real medindo conteúdo vs área disponível do card
    // (clientHeight menos paddings vertical). Slack de 8px absorve
    // arredondamentos de line-height. Sem isso o fade aparecia mesmo
    // quando o texto cabia, cobrindo a última linha e parecendo corte.
    if (card && cardContentEl) {
      requestAnimationFrame(() => {
        const s = getComputedStyle(card);
        const padTop = parseFloat(s.paddingTop) || 0;
        const padBottom = parseFloat(s.paddingBottom) || 0;
        const available = card.clientHeight - padTop - padBottom;
        const overflow = cardContentEl.scrollHeight > available + 8;
        card.classList.toggle('has-overflow', overflow);
      });
    }
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
    // O conteúdo canônico vem do JSON em Storage. Quando o download falha,
    // simplesmente avisamos o usuário — não há mais índice em memória pra ler.
    renderCardContent('<p style="padding:2rem;text-align:center;color:var(--text-muted);">Conteúdo indisponível.</p>');
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
    _toggleSuggestionsForInput();

    if (!query.trim()) {
      if (resultsEl) resultsEl.innerHTML = '';
      return;
    }

    const searchingMsg = currentLang === 'ja' ? '検索中...' : 'Buscando...';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-loading"><span class="search-spinner"></span>${searchingMsg}</li>`;

    // Debounce mais generoso: cada keystroke reseta o timer e só dispara
    // quando o user pausa. Antes (200ms longas / 500ms curtas) era apertado
    // demais — digitando "miroku" rápido disparava 4-6 buscas. Como a RPC
    // agora custa ~600ms, mesmo com cancel de stale ainda gera trabalho
    // desnecessário no servidor.
    const delay = query.trim().length <= 3 ? 600 : 350;
    searchTimeout = setTimeout(() => {
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

  // Chips do empty-state: clicar preenche o input + dispara a busca.
  const suggestionsContainer = document.getElementById('searchSuggestionsChips');
  if (suggestionsContainer) {
    suggestionsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.search-suggest-chip');
      if (!chip || !searchInput) return;
      const term = chip.dataset.term || chip.textContent.trim();
      if (!term) return;
      searchInput.value = term;
      searchInput.focus();
      _toggleSuggestionsForInput();
      clearTimeout(searchTimeout);
      performSearch(term);
      const clearBtn = document.getElementById('searchClear');
      if (clearBtn) clearBtn.style.display = 'flex';
    });
  }
});

let _supabaseLogTimer = null;

function logSearch(query, count, latencyMs) {
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
            const row = {
              user_id: session.user.id,
              query: trimmed.substring(0, 200),
              results_count: count
            };
            if (Number.isFinite(latencyMs) && latencyMs >= 0) row.latency_ms = Math.round(latencyMs);
            supabase.from('search_logs').insert(row).then(() => {}).catch(() => {});
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

// Constrói um RegExp pra highlight client-side a partir do que o usuário digitou.
// Usado pelo caminho JA (cujo snippet vem da RPC sem <mark>) e pelo loadMoreResults.
function _buildHighlightRegex(query, activeLang) {
  const parts = (query || '').toLowerCase().split('&').map(p => p.trim()).filter(p => p.length >= 2);
  if (parts.length === 0) return null;
  const escaped = parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Sem word boundary em JA (kanji não tem \b).
  if (activeLang === 'ja') return new RegExp(`(${escaped.join('|')})`, 'gi');
  return new RegExp(`\\b(${escaped.join('|')})`, 'gi');
}

// Traduz o input do usuário para a sintaxe do websearch_to_tsquery.
//   - "a & b"  → "a b"          (AND é o default)
//   - exact on → wrap em aspas  ("a" "b")
function _translateQuery(rawQuery, useExact) {
  const trimmed = (rawQuery || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split('&').map(p => p.trim()).filter(p => p.length >= 2);
  if (parts.length === 0) return trimmed;
  return useExact
    ? parts.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' ')
    : parts.join(' ');
}

// "Você quis dizer...?" — chama suggest_teachings (pg_trgm) e renderiza
// links acima dos resultados (ou da mensagem "Nenhum resultado").
// Falhas silenciosas: se a RPC não existir ou der erro, o usuário só vê
// a mensagem normal.
//
// mode:
//   'replace' (default): zero resultados — substitui o innerHTML por
//                        [suggest + "Nenhum resultado"].
//   'prepend':           tem resultados mas poucos/fracos — insere o
//                        bloco de sugestão ANTES dos resultados.
async function _maybeSuggestDidYouMean(rawQuery, activeLang, resultsEl, mode = 'replace') {
  if (!resultsEl) return;
  if (!rawQuery || rawQuery.trim().length < 3) return;
  const supabase = _getSupabase();
  if (!supabase) return;
  try {
    const { data, error } = await supabase.rpc('suggest_teachings', {
      q: rawQuery.trim(),
      lang: activeLang,
    });
    if (error || !data || data.length === 0) return;
    // Se o user já editou a query e disparou outra busca, abortamos
    // para não sobrescrever resultados novos com sugestão antiga.
    const inputNow = document.getElementById('searchInput')?.value?.trim() || '';
    if (inputNow !== rawQuery.trim()) return;
    const basePath = getBasePath();
    const labelTxt = activeLang === 'ja' ? 'もしかして:' : 'Você quis dizer:';
    const linksHtml = data.map(s => {
      const title = (activeLang === 'ja' && s.title_ja) ? s.title_ja : (s.title_pt || '');
      const topicIdx = s.topic_idx != null ? s.topic_idx : 0;
      let href = `${basePath}reader.html?vol=${s.vol}&file=${s.file}`;
      if (topicIdx > 0) href += `&topic=${topicIdx}`;
      if (activeLang === 'ja') href += `&lang=ja`;
      return `<a href="${href}"
          class="search-suggest-link"
          data-vol="${escHtml(s.vol)}"
          data-file="${escHtml(s.file)}"
          data-topic="${topicIdx}"
          data-title="${escHtml(title)}">${escHtml(title)}</a>`;
    }).join('<span class="search-suggest-sep"> · </span>');
    const suggestLi =
      `<li class="search-suggest"><span class="search-suggest-label">${labelTxt}</span> ${linksHtml}</li>`;
    if (mode === 'prepend') {
      // Evita duplicar se a sugestão já está no topo.
      if (resultsEl.querySelector('.search-suggest')) return;
      resultsEl.insertAdjacentHTML('afterbegin', suggestLi);
    } else {
      const noResultsMsg = activeLang === 'ja' ? '結果が見つかりませんでした。' : 'Nenhum resultado.';
      resultsEl.innerHTML = suggestLi + `<li class="search-empty">${noResultsMsg}</li>`;
    }
  } catch (e) {
    // RPC ausente ou erro de rede — mantém a mensagem normal.
  }
}

// Heurística do "few-results trigger":
//   - sempre se results.length === 0 (já tratado fora desta função)
//   - se results.length < 3
//   - se results.length < 5 E o top rank for fraco (< 0.1 em PT, < 1.0 em JA).
//     Em PT, ts_rank_cd com normalization 33 retorna [0,1); empiricamente
//     matches relevantes ficam acima de 0.1. Em JA, rank=1.0 indica match
//     em título; abaixo disso só matched no corpo (sinal fraco).
function _shouldTriggerDidYouMean(results, activeLang) {
  if (!results || !results.length) return false;
  if (results.length < 3) return true;
  if (results.length < 5) {
    const topRank = Number(results[0]?.rank) || 0;
    const weakThreshold = activeLang === 'ja' ? 1.0 : 0.1;
    if (topRank < weakThreshold) return true;
  }
  return false;
}

async function performSearch(query) {
  const _mySeq = ++_searchSeq;
  const resultsEl = document.getElementById('searchResults');
  const activeLang = localStorage.getItem('site_lang') || 'pt';

  if (!query || query.trim().length < 2) {
    if (!query || query.trim().length === 0) {
      if (resultsEl) resultsEl.innerHTML = '';
    } else {
      const minCharsMsg = activeLang === 'ja' ? '2文字以上入力してください...' : 'Digite pelo menos 2 caracteres...';
      if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${minCharsMsg}</li>`;
    }
    _updateSearchCount(0, 0, activeLang);
    return;
  }

  const q = query.trim();
  const supabase = _getSupabase();
  if (!supabase) {
    const errMsg = activeLang === 'ja' ? 'ログインが必要です。' : 'Login necessário.';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-error">${errMsg}</li>`;
    return;
  }

  const exactToggle = document.getElementById('searchExactToggle');
  const useExactMatch = exactToggle ? exactToggle.checked : false;
  const serverQuery = _translateQuery(q, useExactMatch);

  if (!serverQuery) {
    const invalidMsg = activeLang === 'ja' ? '有効な検索ワードを入力してください...' : 'Digite termos de busca válidos...';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${invalidMsg}</li>`;
    return;
  }

  // Lê o radio "Tudo / Só Título / Só Conteúdo" e passa pra RPC.
  // Antes esse valor era lido só pra ENABLE/disable, mas nunca chegava
  // no servidor — a busca sempre cobria título+conteúdo. Bug histórico.
  const scopeNode = document.querySelector('input[name="searchFilter"]:checked');
  let scope = scopeNode ? scopeNode.value : 'all';

  // Perf clamp para JA curto: ILIKE com <3 chars não consegue usar o GIN
  // trigram e cai em seq scan. Em content_ja (texto longo) isso explode
  // o P95/P99. Title_ja é curto — seq scan ali é barato. Forçamos title-
  // only quando o user não pediu content explicitamente, preservando os
  // termos doutrinários de 2 chars (浄霊, 救い, 真理...) com latência ok.
  if (activeLang === 'ja' && q.length < 3 && scope !== 'content') {
    scope = 'title';
  }

  const _t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  try {
    // Tenta a Edge Function de busca híbrida (FTS + embedding semântico).
    // Se falhar (Voyage down, função não deployada, etc.), cai pro RPC
    // FTS-only — preserva o caminho antigo como rede de segurança.
    let data = null, error = null;
    try {
      const { data: edgeData, error: edgeError } = await supabase.functions.invoke('search-semantic', {
        body: { q: serverQuery, lang: activeLang, max_results: MAX_RESULTS, scope },
      });
      if (edgeError) throw edgeError;
      data = edgeData?.data ?? [];
      // Breakdown de latência: o servidor reporta tempo por fase (embed,
      // RPC híbrido, rerank); o cliente sabe o total ida+volta. Diferença
      // = rede + cold start da edge function.
      if (edgeData?.timings) {
        const t = edgeData.timings;
        const total_client = Math.round((typeof performance !== 'undefined' && performance.now) ? performance.now() - _t0 : Date.now() - _t0);
        const network_overhead = Math.max(0, total_client - (t.total_ms || 0));
        const aliasLine = edgeData.q_expanded ? ` → "${edgeData.q_expanded}" (alias)` : '';
        console.log(
          `[search] "${q}"${aliasLine} → ${data.length} resultados\n` +
          `  total cliente : ${total_client}ms\n` +
          `  total servidor: ${t.total_ms || 0}ms\n` +
          `  aliases       : ${t.aliases_ms ?? 0}ms${edgeData.q_expanded ? ' ✓' : ''}\n` +
          `  embed (Voyage): ${t.embed_ms || 0}ms${t.embed_ms_re ? ` (+${t.embed_ms_re}ms re-embed do canônico)` : ''}\n` +
          `  RPC híbrido   : ${t.rpc_ms || 0}ms\n` +
          `  rerank (Voyage): ${t.rerank_ms ?? '—'}ms${t.rerank_docs ? ` (${t.rerank_docs} docs)` : ''}\n` +
          `  rede + edge   : ~${network_overhead}ms  ${network_overhead > 2000 ? '⚠ provável cold start' : ''}`
        );
      }
    } catch (edgeErr) {
      console.warn('search-semantic indisponível, fallback FTS:', edgeErr?.message || edgeErr);
      const r = await supabase.rpc('search_teachings', {
        q: serverQuery, lang: activeLang, max_results: MAX_RESULTS, scope,
      });
      data = r.data; error = r.error;
    }
    const _latencyMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0;

    // Stale check: se o usuário digitou mais durante o request, outra busca
    // já foi disparada — descarta esta sem tocar no DOM. Sem isso, a resposta
    // antiga sobrescreveria a nova (race condition de typeahead).
    if (_mySeq !== _searchSeq) return;

    if (error) {
      console.error('search RPC error:', error);
      const errMsg = activeLang === 'ja' ? '検索に失敗しました。' : 'Erro ao buscar. Tente novamente.';
      if (resultsEl) resultsEl.innerHTML = `<li class="search-error">${errMsg}</li>`;
      _updateSearchCount(0, 0, activeLang);
      return;
    }

    const results = data || [];

    if (results.length === 0) {
      const noResultsMsg = activeLang === 'ja' ? '結果が見つかりませんでした。' : 'Nenhum resultado.';
      if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${noResultsMsg}</li>`;
      _updateSearchCount(0, 0, activeLang);
      logSearch(q, 0, _latencyMs);
      sessionStorage.removeItem('searchQuery');
      sessionStorage.removeItem('searchResultsHtml');
      _allResults = [];
      _displayedCount = 0;
      _currentQuery = '';
      // "Você quis dizer...?" — chama suggest_teachings com o texto cru
      // (não a tsquery traduzida). Se o user já mudou a query enquanto
      // a busca rodava, _currentQuery foi resetado e descartamos.
      _maybeSuggestDidYouMean(q, activeLang, resultsEl);
      return;
    }

    const highlightRegex = _buildHighlightRegex(q, activeLang);
    const hitLimit = results.length >= MAX_RESULTS;

    _allResults = results;
    _currentQuery = q;
    _displayedCount = Math.min(RESULTS_PER_PAGE, results.length);
    _focusedIndex = -1;

    resultsEl.innerHTML = _renderResultsList(results, _displayedCount, highlightRegex, q, activeLang);
    _updateSearchCount(results.length, _displayedCount, activeLang, hitLimit);
    logSearch(q, results.length, _latencyMs);

    // Few-results case: prepende "Você quis dizer..." sem destruir os
    // resultados. Espera o RPC retornar antes de salvar o snapshot.
    if (_shouldTriggerDidYouMean(results, activeLang)) {
      await _maybeSuggestDidYouMean(q, activeLang, resultsEl, 'prepend');
    }

    sessionStorage.setItem('searchQuery', query);
    sessionStorage.setItem('searchResultsHtml', resultsEl.innerHTML);
  } catch (err) {
    console.error('Search exception:', err);
    const errMsg = activeLang === 'ja' ? 'エラーが発生しました。' : 'Erro inesperado na busca.';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-error">${errMsg}</li>`;
  }
}

window.loadMoreResults = function() {
  if (!_allResults.length) return;
  _displayedCount = Math.min(_displayedCount + RESULTS_PER_PAGE, _allResults.length);
  const resultsEl = document.getElementById('searchResults');
  if (!resultsEl) return;
  const activeLang = localStorage.getItem('site_lang') || 'pt';
  const highlightRegex = _buildHighlightRegex(_currentQuery, activeLang);
  resultsEl.innerHTML = _renderResultsList(_allResults, _displayedCount, highlightRegex, _currentQuery, activeLang);
  _updateSearchCount(_allResults.length, _displayedCount, activeLang);
  _focusedIndex = -1;
  sessionStorage.setItem('searchResultsHtml', resultsEl.innerHTML);
};

// PT: snippet vem da RPC com <mark> (sem class). Escapa todo o resto, preserva
// os marks e injeta a classe pro CSS de highlight pegar.
// JA: snippet vem como substring puro (sem mark). Escapa e aplica regex client-side.
function _styleSnippet(rawSnippet, activeLang, highlightRegex) {
  if (!rawSnippet) return '';
  if (activeLang === 'ja') {
    const escaped = escHtml(rawSnippet);
    return highlightRegex
      ? escaped.replace(highlightRegex, '<mark class="search-highlight">$1</mark>')
      : escaped;
  }
  // PT: split mantendo os tokens <mark>/</mark>; escapa só o texto entre eles.
  return rawSnippet.split(/(<mark>|<\/mark>)/g).map(part => {
    if (part === '<mark>') return '<mark class="search-highlight">';
    if (part === '</mark>') return '</mark>';
    return escHtml(part);
  }).join('');
}

function _renderResultItem(r, basePath, highlightRegex, q, activeLang) {
  // Shape vindo da RPC: { vol, file, topic_idx, title_pt, title_ja,
  //                       nav_title_pt, nav_title_ja, snippet, rank }
  // nav_title_* vem do site_data/section_map.js (rótulo curado do card no
  // index.html) e está populado APENAS em rows topic_idx=0. Quando difere
  // do título doutrinário, exibimos como título principal — é o termo que
  // o usuário reconhece da navegação e provavelmente o que ele buscou.
  const doctrinalTitle = (activeLang === 'ja' && r.title_ja) ? r.title_ja : (r.title_pt || '');
  const navTitle = (activeLang === 'ja' && r.nav_title_ja) ? r.nav_title_ja : (r.nav_title_pt || '');
  const hasDistinctNav = navTitle && _norm(navTitle) !== _norm(doctrinalTitle);
  const displayTitle = hasDistinctNav ? navTitle : doctrinalTitle;
  const subTitle = hasDistinctNav ? doctrinalTitle : '';
  const topicIdx = r.topic_idx != null ? r.topic_idx : 0;
  const vol = r.vol;
  const file = r.file;

  const volMap = window.SECTION_MAP ? window.SECTION_MAP[vol] : null;
  const sectObj = volMap ? volMap[file] : null;
  let sectLabel = sectObj ? (activeLang === 'ja' ? (sectObj.ja || sectObj.pt) : sectObj.pt) : '';
  if (!sectLabel) {
    const pubTitles = window.GLOBAL_INDEX_TITLES ? window.GLOBAL_INDEX_TITLES[vol] : null;
    sectLabel = pubTitles ? (pubTitles[file] || '') : '';
  }
  const volNum = vol.slice(-1);
  const isDifferent = sectLabel && _norm(sectLabel) !== _norm(displayTitle);

  const homeLabel = activeLang === 'ja' ? 'トップ' : 'Início';
  const volLabel = activeLang === 'ja' ? `第${volNum}巻` : `Volume ${volNum}`;
  const sectionHtml = isDifferent
    ? `<div style="font-size:0.8rem; color:var(--text-muted); font-weight:500; margin-bottom: 4px; opacity: 0.85;">${homeLabel} <span>/</span> ${volLabel} <span>/</span> ${escHtml(sectLabel)}</div>`
    : '';
  const breadcrumbLabel = isDifferent ? `${homeLabel} / ${volLabel} / ${sectLabel}` : `${homeLabel} / ${volLabel}`;

  const styledSnippet = _styleSnippet(r.snippet, activeLang, highlightRegex);

  let href = `${basePath}reader.html?vol=${vol}&file=${file}&search=${encodeURIComponent(q)}`;
  if (topicIdx > 0) href += `&topic=${topicIdx}`;
  if (activeLang === 'ja') href += `&lang=ja`;

  const subTitleHtml = subTitle
    ? `<div class="search-result-subtitle" style="font-size:0.85rem;color:var(--text-muted);font-style:italic;margin-bottom:4px;">${escHtml(subTitle)}</div>`
    : '';

  return `<li><a href="${href}"
      class="search-result-item"
      data-vol="${escHtml(vol)}"
      data-file="${escHtml(file)}"
      data-query="${escHtml(q)}"
      data-title="${escHtml(displayTitle)}"
      data-section="${escHtml(breadcrumbLabel)}"
      data-topic="${topicIdx}">
      ${sectionHtml}
      <div class="search-result-title">${escHtml(displayTitle)}</div>
      ${subTitleHtml}
      <div class="search-result-context">${styledSnippet}</div>
    </a></li>`;
}
