// ============================================================
// MODALS — shared modal HTML generation for index.html and reader.html
// ============================================================

function _escModal(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Guarda contra chamadas duplicadas. Algumas páginas (akimaro-kineishu,
// warai-no-izumi, yama-to-mizu) chamam buildSearchModal duas vezes via
// DOMContentLoaded inline em <head> + outro inline em <body> — sem essa
// guarda, ficavam 2 <div id="searchModal"> no DOM, o que em iOS Safari
// quebra focus trap e accessibility tree. Idempotente = safe pra
// chamar quantas vezes quiser.
function _modalExists(id) {
  return !!document.getElementById(id);
}

function buildSearchModal() {
  if (_modalExists('searchModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const placeholder = lang === 'ja' ? '教えを検索...' : 'Buscar nos ensinamentos...';
  const clearLabel = lang === 'ja' ? 'クリア' : 'Limpar busca';
  const clearText = lang === 'ja' ? '消す' : 'Apagar';
  const allLabel = lang === 'ja' ? 'すべて' : 'Tudo';
  const titleLabel = lang === 'ja' ? 'タイトルのみ' : 'Só Título';
  const contentLabel = lang === 'ja' ? '内容のみ' : 'Só Conteúdo';
  const exactLabel = lang === 'ja' ? '完全一致' : 'Palavra exata';
  const exactTitle = lang === 'ja' ? '単語全体のみを検索' : 'Busca somente palavras inteiras. Ex: \'luz\' não encontrará \'reluz\'';
  const literalLabel = lang === 'ja' ? 'リテラル検索' : 'Texto literal';
  const literalTitle = lang === 'ja' ? '部分一致のみで検索（FTS・意味検索を無効化）' : 'Busca apenas por substring exata (sem FTS nem busca semântica). Útil para termos em japonês ou trechos exatos.';
  const advancedLabel = lang === 'ja' ? '詳細検索' : 'Avançada';
  const suggestionsLabel = lang === 'ja' ? 'おすすめ' : 'Sugestões';

  const advancedOpen = localStorage.getItem('search_advanced_open') === 'true';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'searchModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', lang === 'ja' ? '教えを検索' : 'Buscar nos ensinamentos');
  el.innerHTML =
    '<div class="search-modal">' +
      '<button class="modal-close-btn" onclick="closeSearch()">&times;</button>' +
      '<div class="search-header">' +
        '<div class="search-input-row">' +
          '<input type="text" class="search-input" id="searchInput" placeholder="' + placeholder + '" autocomplete="off" inputmode="search" enterkeyhint="search">' +
          '<button id="searchClear" onclick="clearSearch()" style="display: none;" title="' + clearLabel + '">' +
            '<span id="searchClearText">' + clearText + '</span>' +
          '</button>' +
        '</div>' +
        '<div class="search-advanced-row">' +
          '<button type="button" id="searchAdvancedToggle" class="search-advanced-btn" aria-expanded="' + (advancedOpen ? 'true' : 'false') + '" aria-controls="searchAdvancedPanel">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>' +
            '</svg>' +
            '<span>' + advancedLabel + '</span>' +
            '<svg class="search-advanced-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<polyline points="6 9 12 15 18 9"></polyline>' +
            '</svg>' +
          '</button>' +
        '</div>' +
        '<div id="searchAdvancedPanel" class="search-filters search-advanced-panel' + (advancedOpen ? ' is-open' : '') + '">' +
          '<label class="filter-label"><input type="radio" name="searchFilter" value="all" checked> ' + allLabel + '</label>' +
          '<label class="filter-label"><input type="radio" name="searchFilter" value="title"> ' + titleLabel + '</label>' +
          '<label class="filter-label"><input type="radio" name="searchFilter" value="content"> ' + contentLabel + '</label>' +
          '<label class="filter-label filter-label--toggle" title="' + exactTitle + '">' +
            '<input type="checkbox" id="searchExactToggle">' +
            '<span id="searchExactLabel">' + exactLabel + '</span>' +
          '</label>' +
          '<label class="filter-label filter-label--toggle" title="' + literalTitle + '">' +
            '<input type="checkbox" id="searchLiteralToggle">' +
            '<span id="searchLiteralLabel">' + literalLabel + '</span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<div id="searchSuggestions" class="search-suggestions" style="display:none;">' +
        '<div class="search-suggestions-label">' + suggestionsLabel + '</div>' +
        '<div id="searchSuggestionsChips" class="search-suggestions-chips"></div>' +
      '</div>' +
      '<div id="searchCount" class="search-count"></div>' +
      '<ul class="search-results" id="searchResults" aria-live="polite"></ul>' +
    '</div>';
  document.body.appendChild(el);
}

function buildHistoryModal() {
  if (_modalExists('historyModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? '閲覧履歴' : 'Histórico de Navegação';
  const clearLabel = lang === 'ja' ? 'すべて削除' : 'Limpar Tudo';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'historyModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'historyModalTitle');
  el.innerHTML =
    '<div class="search-modal">' +
      '<button class="modal-close-btn" onclick="closeHistory()">&times;</button>' +
      '<div class="search-header">' +
        '<div style="display: flex; justify-content: space-between; align-items: center;">' +
          '<h2 id="historyModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
          '<button class="btn-zen" id="historyClearAll" onclick="clearAllHistory()" style="padding: 4px 12px; font-size: 0.85rem; display: none;">' + clearLabel + '</button>' +
        '</div>' +
      '</div>' +
      '<ul class="search-results" id="historyResults" aria-live="polite"></ul>' +
    '</div>';
  document.body.appendChild(el);
}

function buildFavoritesModal() {
  if (_modalExists('favoritesModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? '保存した教え' : 'Ensinamentos Salvos';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'favoritesModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'favoritesModalTitle');
  el.innerHTML =
    '<div class="search-modal">' +
      '<button class="modal-close-btn" onclick="closeFavorites()">&times;</button>' +
      '<div class="search-header">' +
        '<h2 id="favoritesModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
      '</div>' +
      '<ul class="search-results" id="favoritesResults" aria-live="polite"></ul>' +
    '</div>';
  document.body.appendChild(el);
}

function buildRecommendationsModal() {
  if (_modalExists('recommendationsModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? '学習のおすすめ' : 'Recomendações para Estudo';
  const manageLabel = lang === 'ja' ? 'すべて管理 →' : 'Gerenciar todas →';
  // Caminho relativo pra recomendacoes.html — sob /mioshiec*/ precisa ../
  const basePath = window.location.pathname.includes('/mioshiec') ? '../' : '';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'recommendationsModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'recommendationsModalTitle');
  el.innerHTML =
    '<div class="search-modal">' +
      '<button class="modal-close-btn" onclick="closeRecommendations()">&times;</button>' +
      '<div class="search-header">' +
        '<h2 id="recommendationsModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
      '</div>' +
      '<ul class="search-results" id="recommendationsResults" aria-live="polite"></ul>' +
      '<div style="padding: 14px 18px; border-top: 1px solid var(--border); text-align: right;">' +
        '<a href="' + basePath + 'recomendacoes.html" style="font-size: 0.85rem; color: var(--accent); text-decoration: none; font-weight: 500;">' + manageLabel + '</a>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
}

function buildHighlightsModal() {
  if (_modalExists('highlightsModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? 'ハイライト一覧' : 'Meus Destaques';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'highlightsModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'highlightsModalTitle');
  el.innerHTML =
    '<div class="search-modal">' +
      '<button class="modal-close-btn" onclick="closeHighlights()">&times;</button>' +
      '<div class="search-header">' +
        '<h2 id="highlightsModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
      '</div>' +
      '<ul class="search-results highlights-modal-list" id="highlightsResults" aria-live="polite"></ul>' +
    '</div>';
  document.body.appendChild(el);
}

window.buildSearchModal = buildSearchModal;
window.buildHistoryModal = buildHistoryModal;
window.buildFavoritesModal = buildFavoritesModal;
window.buildHighlightsModal = buildHighlightsModal;
window.buildRecommendationsModal = buildRecommendationsModal;
