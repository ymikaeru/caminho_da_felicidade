// ============================================================
// TOGGLE — shared constants, focus trap, history, favorites,
//           global listeners, scroll-to-top
// Load order: toggle.js → nav.js → theme.js → language.js
//             → typography.js → search.js → reader.js
// ============================================================

// --- Shared Translation Strings (used by nav.js, theme.js, language.js) ---
const MENU_TEXTS = {
  pt: {
    title: 'Caminho da Felicidade',
    close: 'Fechar menu',
    navigation: 'Navegação',
    actions: 'AÇÕES',
    history: 'Histórico',
    saved: 'Salvos',
    notes: 'Anotações',
    highlights: 'Central de Destaques',
    lang: '日本語',
    theme: 'Themes & Settings',
    fontSize: 'Tamanho da Fonte',
    customize: 'Personalizar',
    accessibility: 'Acessibilidade & Layout',
    lightMode: 'Claro',
    darkMode: 'Noturno',
    lineSpacing: 'ESPAÇAMENTO DE LINHAS',
    charSpacing: 'ESPAÇAMENTO DE CARACTERES',
    wordSpacing: 'ESPAÇAMENTO DE PALAVRAS',
    margins: 'MARGENS',
    justify: 'Justificar Texto',
    boldText: 'Texto em Negrito',
    comparison: 'Comparação 日本語／PT',
    print: 'Imprimir ensinamento',
    volumeTopics: 'Temas do Volume'
  },
  ja: {
    title: '御教えカレッジ',
    close: 'メニューを閉じる',
    navigation: 'ナビゲーション',
    actions: '操作',
    history: '履歴',
    saved: 'お気に入り',
    notes: 'メモ',
    highlights: 'ハイライト',
    lang: 'Português',
    theme: 'テーマ切替',
    fontSize: 'フォントサイズ',
    customize: 'カスタマイズ',
    accessibility: 'アクセシビリティ＆レイアウト',
    lightMode: 'ライト',
    darkMode: 'ダーク',
    lineSpacing: '行間隔',
    charSpacing: '文字間隔',
    wordSpacing: '単語間隔',
    margins: '余白',
    justify: 'テキストを両端揃え',
    boldText: '太字テキスト',
    comparison: '比較モード 日本語／PT',
    print: '教えを印刷',
    volumeTopics: 'このボリュームのテーマ'
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  const urlParams = new URLSearchParams(window.location.search);
  let urlLang = urlParams.get('lang') || (urlParams.get('jp') !== null ? 'ja' : null);
  const savedLang = urlLang || localStorage.getItem('site_lang') || 'pt';
  if (typeof setLanguage === 'function') setLanguage(savedLang, false);

  _initMobileNav();
});

// --- Focus Trap Utility (WCAG 2.1.2) ---
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const _focusTrapMap = new WeakMap();

function _trapFocus(modal) {
  if (_focusTrapMap.has(modal)) return;
  const trigger = document.activeElement;
  if (!modal.contains(document.activeElement)) {
    const initial = Array.from(modal.querySelectorAll(FOCUSABLE));
    if (initial.length) initial[0].focus();
  }

  function handler(e) {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(modal.querySelectorAll(FOCUSABLE));
    const idx = focusable.indexOf(document.activeElement);
    if (e.shiftKey) {
      if (idx <= 0) { e.preventDefault(); focusable[focusable.length - 1].focus(); }
    } else {
      if (idx === focusable.length - 1) { e.preventDefault(); focusable[0].focus(); }
    }
  }

  modal.addEventListener('keydown', handler);
  _focusTrapMap.set(modal, { handler, trigger });
}

function _releaseFocus(modal) {
  const data = _focusTrapMap.get(modal);
  if (!data) return;
  modal.removeEventListener('keydown', data.handler);
  _focusTrapMap.delete(modal);
  if (data.trigger && typeof data.trigger.focus === 'function') data.trigger.focus();
}

// --- History ---
window.openHistory = function () {
  const modal = document.getElementById('historyModal');
  const resultsEl = document.getElementById('historyResults');
  if (modal && resultsEl) {
    modal.classList.add('active');
    renderHistory();
    _trapFocus(modal);
    const clearAllBtn = document.getElementById('historyClearAll');
    const history = JSON.parse(localStorage.getItem('readHistory') || '[]');
    if (clearAllBtn) clearAllBtn.style.display = history.length > 0 ? 'block' : 'none';
  }
};

window.closeHistory = function () {
  const modal = document.getElementById('historyModal');
  if (modal) { modal.classList.remove('active'); _releaseFocus(modal); }
};

function _filterAccessible(items) {
  if (typeof isLimitedUser !== 'function' || !isLimitedUser()) return items;
  const config = typeof getAccessConfig === 'function' ? getAccessConfig() : null;
  if (!config) return items;
  return items.filter(item => {
    const volConfig = config[item.vol];
    if (volConfig === 'all') return true;
    if (Array.isArray(volConfig)) return volConfig.includes(item.file);
    return false;
  });
}

function renderHistory() {
  const resultsEl = document.getElementById('historyResults');
  if (!resultsEl) return;

  const history = _filterAccessible(JSON.parse(localStorage.getItem('readHistory') || '[]'));
  const basePath = window.location.pathname.includes('/mioshiec') ? '../' : './';
  const currentLang = localStorage.getItem('site_lang') || 'pt';

  if (history.length === 0) {
    const emptyMsg = currentLang === 'ja' ? '履歴なし。' : 'Nenhum histórico.';
    resultsEl.innerHTML = `<li class="search-empty">${emptyMsg}</li>`;
    const clearAllBtn = document.getElementById('historyClearAll');
    if (clearAllBtn) clearAllBtn.style.display = 'none';
    return;
  }

  resultsEl.innerHTML = history.map(item => {
    const vNum = item.vol.replace('mioshiec', '');
    const fBase = item.file.replace('.html', '');
    let href = `${basePath}reader.html#v${vNum}/${fBase}`;
    if (item.topic && item.topic > 0) {
      href = `${basePath}reader.html?vol=${item.vol}&file=${item.file}&topic=${item.topic}`;
    }
    const date = new Date(item.time).toLocaleString();

    let progressHtml = '';
    if (item.totalTopics && item.totalTopics > 1) {
      const topicNum = (item.topic || 0) + 1;
      const pct = Math.round((topicNum / item.totalTopics) * 100);
      const progressLabel = currentLang === 'ja'
        ? `トピック ${topicNum}/${item.totalTopics}`
        : `Tópico ${topicNum}/${item.totalTopics}`;
      progressHtml = `<div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
        <div style="flex:1; height:4px; background:var(--border); border-radius:2px; overflow:hidden;">
          <div style="width:${pct}%; height:100%; background:var(--accent); border-radius:2px; transition:width 0.3s;"></div>
        </div>
        <span style="font-size:0.75rem; color:var(--text-muted); white-space:nowrap;">${progressLabel}</span>
      </div>`;
    }

    return `<li><a href="${href}" class="search-result-item" onclick="closeHistory()"><div class="search-result-title">${item.title || item.file} <span style="font-size:0.8rem; color:var(--text-muted);">(Vol ${vNum})</span></div><div class="search-result-context">${date}</div>${progressHtml}</a></li>`;
  }).join('');
}

window.clearAllHistory = function () {
  const currentLang = localStorage.getItem('site_lang') || 'pt';
  const confirmMsg = currentLang === 'ja' ? '履歴をすべて消去しますか？' : 'Tem certeza que deseja limpar todo o histórico?';
  if (confirm(confirmMsg)) {
    localStorage.removeItem('readHistory');
    renderHistory();
  }
};

// --- Favorites ---
window.openFavorites = function () {
  const modal = document.getElementById('favoritesModal');
  const resultsEl = document.getElementById('favoritesResults');
  if (modal && resultsEl) {
    modal.classList.add('active');
    renderFavorites();
    _trapFocus(modal);
  }
};

window.closeFavorites = function () {
  const modal = document.getElementById('favoritesModal');
  if (modal) { modal.classList.remove('active'); _releaseFocus(modal); }
};

function renderFavorites() {
  const resultsEl = document.getElementById('favoritesResults');
  if (!resultsEl) return;

  const favorites = _filterAccessible(JSON.parse(localStorage.getItem('savedFavorites') || '[]'));
  const basePath = window.location.pathname.includes('/mioshiec') ? '../' : './';
  const currentLang = localStorage.getItem('site_lang') || 'pt';

  if (favorites.length === 0) {
    const emptyMsg = currentLang === 'ja' ? '保存された教えはありません。' : 'Nenhum ensinamento salvo.';
    resultsEl.innerHTML = `<li class="search-empty">${emptyMsg}</li>`;
    return;
  }

  favorites.sort((a, b) => b.time - a.time);

  resultsEl.innerHTML = favorites.map(item => {
    const vNum = item.vol.replace('mioshiec', '');
    const fBase = item.file.replace('.html', '');
    const topicIdx = item.topic || 0;
    let href;
    if (topicIdx > 0) {
      href = `${basePath}reader.html?vol=${item.vol}&file=${item.file}&topic=${topicIdx}`;
    } else {
      href = `${basePath}reader.html#v${vNum}/${fBase}`;
    }
    const date = new Date(item.time).toLocaleString();
    const savedLabel = currentLang === 'ja' ? '保存日' : 'Salvo em';

    let topicBadge = '';
    if (item.totalTopics && item.totalTopics > 1) {
      const topicLabel = currentLang === 'ja'
        ? `トピック ${topicIdx + 1}/${item.totalTopics}`
        : `Tópico ${topicIdx + 1}/${item.totalTopics}`;
      topicBadge = `<span style="display:inline-block; font-size:0.7rem; background:var(--accent); color:#fff; padding:1px 7px; border-radius:10px; margin-left:6px; vertical-align:middle;">${topicLabel}</span>`;
    }

    let topicInfo = '';
    if (item.topicTitle && item.totalTopics > 1) {
      const cleanedTitle = item.topicTitle.replace(/^(Ensinamento|Orienta\u00e7\u00e3o|Palestra) de (Meishu-Sama|Mois\u00e9s)\s*[-:]?\s*/i, '').replace(/^["'](.*?)["']$/, '$1').trim();
      topicInfo += `<div style="font-size:0.85rem; color:var(--text-main); margin-top:3px; font-style:italic;">\u201c${cleanedTitle}\u201d</div>`;
    }
    if (item.snippet) {
      topicInfo += `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px; line-height:1.4; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${item.snippet}</div>`;
    }

    return `<li>
      <div style="display: flex; justify-content: space-between; align-items: center; padding-right: 24px; border-bottom: 1px solid var(--border);">
        <a href="${href}" class="search-result-item" onclick="closeFavorites()" style="flex: 1; border-bottom: none;"><div class="search-result-title">${item.title || item.file} <span style="font-size:0.8rem; color:var(--text-muted);">(Vol ${vNum})</span>${topicBadge}</div>${topicInfo}<div class="search-result-context">${savedLabel} ${date}</div></a>
        <button onclick="removeFavoriteFromModal('${item.vol}', '${item.file}', ${topicIdx})" style="background:none; border:none; cursor:pointer; padding:8px; display:flex; align-items:center; justify-content:center; border-radius:8px; color:var(--accent);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
        </button>
      </div>
    </li>`;
  }).join('');
}

window.removeFavoriteFromModal = function (volId, filename, topicIdx) {
  let favorites = JSON.parse(localStorage.getItem('savedFavorites') || '[]');
  if (topicIdx !== undefined && topicIdx !== null) {
    favorites = favorites.filter(f => !(f.vol === volId && f.file === filename && (f.topic || 0) === topicIdx));
  } else {
    favorites = favorites.filter(f => !(f.vol === volId && f.file === filename));
  }
  try { localStorage.setItem('savedFavorites', JSON.stringify(favorites)); } catch (e) { }
  renderFavorites();

  if (window.location.pathname.includes('reader.html')) {
    const params = new URLSearchParams(window.location.search);
    const currentVol = params.get('vol');
    const currentFile = params.get('file');
    if (currentVol === volId && currentFile === filename) {
      const remaining = favorites.filter(f => f.vol === volId && f.file === filename);
      if (remaining.length === 0) {
        const btn = document.getElementById('favoriteBtn');
        if (btn) {
          btn.classList.remove('active');
          const svg = btn.querySelector('svg');
          if (svg) svg.setAttribute('fill', 'none');
        }
      }
    }
  }
};

// --- DOM Initialization and Shared Listeners ---
document.addEventListener('DOMContentLoaded', () => {
  const historyModal = document.getElementById('historyModal');
  if (historyModal) historyModal.addEventListener('click', (e) => {
    if (e.target.id === 'historyModal') closeHistory();
  });

  const favoritesModal = document.getElementById('favoritesModal');
  if (favoritesModal) favoritesModal.addEventListener('click', (e) => {
    if (e.target.id === 'favoritesModal') closeFavorites();
  });

  const highlightsModal = document.getElementById('highlightsModal');
  if (highlightsModal) highlightsModal.addEventListener('click', (e) => {
    if (e.target.id === 'highlightsModal') closeHighlights();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const previewOpen = document.getElementById('searchPreviewModal')?.classList.contains('active');
      if (previewOpen) { closeSearchPreview(); return; }
      closeSearch();
      closeHistory();
      closeFavorites();
      closeHighlights();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
    }
  });
});

// --- Scroll-to-top button ---
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('reader.html')) return;

    const btn = document.createElement('button');
    btn.id = 'scroll-to-top';
    btn.setAttribute('aria-label', 'Voltar ao topo');
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
    document.body.appendChild(btn);

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          btn.classList.toggle('visible', window.scrollY > 400);
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  });
})();

window.saveAllOffline = async function () {
  return; // Service Worker disabled
};
