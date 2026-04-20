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

function buildSearchModal() {
  const lang = localStorage.getItem('site_lang') || 'pt';
  const placeholder = lang === 'ja' ? '教えを検索...' : 'Buscar nos ensinamentos...';
  const clearLabel = lang === 'ja' ? 'クリア' : 'Limpar busca';
  const clearText = lang === 'ja' ? '消す' : 'Apagar';
  const allLabel = lang === 'ja' ? 'すべて' : 'Tudo';
  const titleLabel = lang === 'ja' ? 'タイトルのみ' : 'Só Título';
  const contentLabel = lang === 'ja' ? '内容のみ' : 'Só Conteúdo';
  const exactLabel = lang === 'ja' ? '完全一致' : 'Palavra exata';
  const exactTitle = lang === 'ja' ? '単語全体のみを検索' : 'Busca somente palavras inteiras. Ex: \'luz\' não encontrará \'reluz\'';

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
        '<div class="search-filters">' +
          '<label class="filter-label"><input type="radio" name="searchFilter" value="all" checked> ' + allLabel + '</label>' +
          '<label class="filter-label"><input type="radio" name="searchFilter" value="title"> ' + titleLabel + '</label>' +
          '<label class="filter-label"><input type="radio" name="searchFilter" value="content"> ' + contentLabel + '</label>' +
          '<label class="filter-label" style="margin-left:auto; gap:8px;" title="' + exactTitle + '">' +
            '<input type="checkbox" id="searchExactToggle" style="accent-color:var(--accent); cursor:pointer;">' +
            '<span id="searchExactLabel">' + exactLabel + '</span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<div id="searchCount" class="search-count"></div>' +
      '<ul class="search-results" id="searchResults" aria-live="polite"></ul>' +
    '</div>';
  document.body.appendChild(el);
}

function buildHistoryModal() {
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

function buildHighlightsModal() {
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
