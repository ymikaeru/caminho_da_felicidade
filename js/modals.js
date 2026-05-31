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
      '<div id="rec-audio-footer" style="display:none;"></div>' +
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

// Compositor "Compartilhar com o Reverendo" — usado por study-messages.js.
// Lazy-built no primeiro openShareWithReverendo(). O título do ensinamento
// (#shareTeachingTitle) é preenchido via textContent pelo JS.
function buildShareModal() {
  if (_modalExists('shareModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? 'ご住職に共有' : 'Compartilhar com o Reverendo';
  const aboutLabel = lang === 'ja' ? 'この御教えについて' : 'Sobre este Ensinamento';
  const placeholder = lang === 'ja'
    ? 'ご住職へのご感想やご質問をお書きください...'
    : 'Escreva sua reflexão ou pergunta ao Reverendo...';
  const guideline = lang === 'ja'
    ? 'メッセージは非公開です（ご住職のみが見ます）。敬意と向上の心で書いてください。'
    : 'Sua mensagem é privada — só o Reverendo vê. Escreva com respeito e espírito de edificação.';
  const cancelLabel = lang === 'ja' ? 'キャンセル' : 'Cancelar';
  const sendLabel = lang === 'ja' ? '送信' : 'Enviar';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'shareModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'shareModalTitle');
  el.innerHTML =
    '<div class="search-modal" style="max-width:560px;">' +
      '<button class="modal-close-btn" onclick="closeShareModal()">&times;</button>' +
      '<div class="search-header">' +
        '<h2 id="shareModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
      '</div>' +
      '<div style="padding: 4px 24px 24px;">' +
        '<div style="font-size:0.66rem; text-transform:uppercase; letter-spacing:.1em; color:var(--text-muted); font-weight:600; margin-bottom:6px; font-family:var(--font-ui);">' + aboutLabel + '</div>' +
        '<div id="shareTeachingTitle" style="font-family:\'Crimson Pro\',Georgia,serif; font-size:1.1rem; font-weight:600; color:var(--text-main); line-height:1.3; margin-bottom:16px;"></div>' +
        '<textarea id="shareBody" rows="5" placeholder="' + placeholder + '" style="width:100%; padding:12px 14px; font-size:0.95rem; border:1px solid var(--border); border-radius:6px; resize:vertical; font-family:inherit; background:var(--bg,#fff); color:inherit; box-sizing:border-box;"></textarea>' +
        '<div style="font-size:0.72rem; color:var(--text-muted); margin-top:8px; line-height:1.5;">' + guideline + '</div>' +
        '<div id="shareMsg" style="font-size:0.82rem; min-height:1.2em; margin-top:8px;"></div>' +
        '<div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px;">' +
          '<button onclick="closeShareModal()" style="padding:8px 16px; font-size:0.85rem; background:none; border:1px solid var(--border); border-radius:6px; cursor:pointer; color:inherit;">' + cancelLabel + '</button>' +
          '<button id="shareSubmit" onclick="submitShareWithReverendo()" style="padding:8px 20px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">' + sendLabel + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
}

// "Minhas conversas com o Reverendo" — lista enviadas + respostas.
// Lazy-built no primeiro openMyConversations(); preenchido por study-messages.js.
function buildMyConversationsModal() {
  if (_modalExists('myConversationsModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? 'ご住職との会話' : 'Minhas conversas com o Reverendo';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'myConversationsModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'myConversationsModalTitle');
  el.innerHTML =
    '<div class="search-modal">' +
      '<button class="modal-close-btn" onclick="closeMyConversations()">&times;</button>' +
      '<div class="search-header">' +
        '<h2 id="myConversationsModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
      '</div>' +
      '<ul class="search-results" id="myConversationsResults" aria-live="polite"></ul>' +
    '</div>';
  document.body.appendChild(el);
}

// Compositor "Publicar uma descoberta" — usado por mural.js. Lazy-built no
// primeiro openPublicarDescoberta(). #descobertaContext é preenchido via JS.
function buildDescobertaModal() {
  if (_modalExists('descobertaModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? '感想を共有' : 'Compartilhar uma reflexão';
  const aboutLabel = lang === 'ja' ? 'この御教えについて' : 'Sobre este Ensinamento';
  const placeholder = lang === 'ja'
    ? 'この御教えについてのご感想をお書きください...'
    : 'Compartilhe sua reflexão sobre este Ensinamento...';
  const guideline = lang === 'ja'
    ? '承認後、匿名で掲示板に共有されます。'
    : 'Será compartilhada anonimamente no mural, após aprovação.';
  const cancelLabel = lang === 'ja' ? 'キャンセル' : 'Cancelar';
  const publishLabel = lang === 'ja' ? '共有' : 'Compartilhar';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'descobertaModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'descobertaModalTitle');
  el.innerHTML =
    '<div class="search-modal" style="max-width:560px;">' +
      '<button class="modal-close-btn" onclick="closeDescobertaModal()">&times;</button>' +
      '<div class="search-header">' +
        '<h2 id="descobertaModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
      '</div>' +
      '<div style="padding: 4px 24px 24px;">' +
        '<div style="font-size:0.66rem; text-transform:uppercase; letter-spacing:.1em; color:var(--text-muted); font-weight:600; margin-bottom:6px; font-family:var(--font-ui);">' + aboutLabel + '</div>' +
        '<div id="descobertaContext" style="font-family:\'Crimson Pro\',Georgia,serif; font-size:1.1rem; font-weight:600; color:var(--text-main); line-height:1.3; margin-bottom:16px;"></div>' +
        '<div id="descobertaExcerpt" style="display:none; font-family:\'Crimson Pro\',Georgia,serif; font-style:italic; color:var(--text-main); line-height:1.6; border-left:2px solid var(--accent); padding:4px 0 4px 14px; margin-bottom:16px;"></div>' +
        '<textarea id="descobertaBody" rows="5" placeholder="' + placeholder + '" style="width:100%; padding:12px 14px; font-size:0.95rem; border:1px solid var(--border); border-radius:6px; resize:vertical; font-family:inherit; background:var(--bg,#fff); color:inherit; box-sizing:border-box;"></textarea>' +
        '<div style="font-size:0.72rem; color:var(--text-muted); margin-top:8px; line-height:1.5;">' + guideline + '</div>' +
        '<div id="descobertaMsg" style="font-size:0.82rem; min-height:1.2em; margin-top:8px;"></div>' +
        '<div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px;">' +
          '<button onclick="closeDescobertaModal()" style="padding:8px 16px; font-size:0.85rem; background:none; border:1px solid var(--border); border-radius:6px; cursor:pointer; color:inherit;">' + cancelLabel + '</button>' +
          '<button id="descobertaSubmit" onclick="submitDescoberta()" style="padding:8px 20px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">' + publishLabel + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
}

window.buildSearchModal = buildSearchModal;
window.buildHistoryModal = buildHistoryModal;
window.buildFavoritesModal = buildFavoritesModal;
window.buildHighlightsModal = buildHighlightsModal;
window.buildRecommendationsModal = buildRecommendationsModal;
window.buildShareModal = buildShareModal;
window.buildMyConversationsModal = buildMyConversationsModal;
window.buildDescobertaModal = buildDescobertaModal;
