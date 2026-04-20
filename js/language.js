// ============================================================
// LANGUAGE — setLanguage / toggleLanguage
// Depends on: MENU_TEXTS, _updateMobileNavTopics (toggle.js / nav.js)
// ============================================================

function setLanguage(lang, triggerRender = true) {
  try { localStorage.setItem('site_lang', lang); } catch (e) { }

  document.documentElement.lang = lang === 'ja' ? 'ja' : 'pt-BR';

  const url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  window.history.replaceState({}, '', url);

  const toggleBtn = document.getElementById('lang-toggle');
  if (toggleBtn) {
    if (lang === 'pt') {
      toggleBtn.innerText = '日本語';
      toggleBtn.title = 'Mudar para Japonês';
    } else {
      toggleBtn.innerText = 'Português';
      toggleBtn.title = 'Mudar para Português';
    }
  }

  const headerLogo = document.querySelector('.header__logo');
  if (headerLogo) {
    const ptTitle = 'Mioshie College';
    const jaTitle = '御教えカレッジ';
    const logoCircle = headerLogo.querySelector('.logo-circle');
    headerLogo.innerHTML = '';
    if (logoCircle) headerLogo.appendChild(logoCircle);
    headerLogo.appendChild(document.createTextNode(lang === 'ja' ? jaTitle : ptTitle));
  }

  const mobileNav = document.getElementById('mobileNavOverlay');
  if (mobileNav) {
    const t = MENU_TEXTS[lang] || MENU_TEXTS.pt;

    const updateLabel = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    const updateLink = (id, text) => {
      const el = document.getElementById(id);
      if (el) {
        const textSpan = el.querySelector('.link-text');
        if (textSpan) textSpan.textContent = text;
      }
    };

    updateLabel('mobileMenuTitle', t.title);
    updateLabel('mobileNavLabelNav', t.navigation);
    updateLabel('mobileNavLabelActions', t.actions);
    updateLabel('mobileNavLabelFont', t.fontSize);
    updateLink('mobileNavLinkHistory', t.history);
    updateLink('mobileNavLinkFavorites', t.saved);
    updateLink('mobileNavLinkLang', t.lang);
    updateLink('mobileNavLinkTheme', t.theme);

    const closeBtn = document.getElementById('mobileNavClose');
    if (closeBtn) closeBtn.setAttribute('aria-label', t.close);

    const mobileLinksContainer = document.getElementById('mobileNavLinks');
    if (mobileLinksContainer) {
      const desktopNav = document.querySelector('.header__nav');
      const navLinks = desktopNav ? Array.from(desktopNav.querySelectorAll('a')) : [];
      const linksHtml = navLinks.map(a => {
        let text = a.textContent.trim();
        if (lang === 'ja') {
          if (text.includes('Início') || text.includes('⌂')) text = 'トップ';
          else if (text.includes('Vol 1') || a.href.includes('mioshiec1')) text = '巻 1';
          else if (text.includes('Vol 2') || a.href.includes('mioshiec2')) text = '巻 2';
          else if (text.includes('Vol 3') || a.href.includes('mioshiec3')) text = '巻 3';
          else if (text.includes('Vol 4') || a.href.includes('mioshiec4')) text = '巻 4';
        }
        const icon = a.href.includes('index.html') && a.textContent.trim().startsWith('⌂')
          ? `<svg class="nav-icon" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
          : `<svg class="nav-icon" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
        return `<a href="${a.href}" class="mobile-nav-link">${icon}${text}</a>`;
      }).join('');
      mobileLinksContainer.innerHTML = linksHtml;
    }
  }

  document.querySelectorAll('.lang-pt').forEach(el => el.style.display = (lang === 'pt' ? '' : 'none'));
  document.querySelectorAll('.lang-ja').forEach(el => el.style.display = (lang === 'ja' ? '' : 'none'));

  document.querySelectorAll('option[data-pt]').forEach(opt => {
    opt.textContent = lang === 'ja' ? (opt.getAttribute('data-ja') || opt.getAttribute('data-pt')) : opt.getAttribute('data-pt');
  });

  const desktopNav = document.querySelector('.header__nav');
  const headerNavSelect = desktopNav ? desktopNav.querySelector('select') : null;
  if (headerNavSelect && headerNavSelect.id !== 'readerTopicSelect') {
    const sectionLabel = (MENU_TEXTS[lang] || MENU_TEXTS.pt).volumeTopics;
    const opts = Array.from(headerNavSelect.options).filter(o => o.value).map(o => {
      const text = lang === 'ja' ? (o.getAttribute('data-ja') || o.textContent) : (o.getAttribute('data-pt') || o.textContent);
      return { value: o.value, text };
    });
    if (opts.length > 0) {
      window._updateMobileNavTopics(sectionLabel, opts);
    }
  }

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.placeholder = lang === 'ja' ? '御教えから探す...' : 'Buscar nos ensinamentos...';
  }
  const filterLabels = document.querySelectorAll('.search-filters .filter-label');
  if (filterLabels.length >= 3) {
    const labels = lang === 'ja' ? ['すべて', 'タイトルのみ', '本文のみ'] : ['Tudo', 'Só Título', 'Só Conteúdo'];
    Array.from(filterLabels).slice(0, 3).forEach((label, idx) => {
      const input = label.querySelector('input');
      label.innerHTML = '';
      if (input) label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + labels[idx]));
    });
  }

  const searchClearText = document.getElementById('searchClearText');
  if (searchClearText) {
    searchClearText.textContent = lang === 'ja' ? '削除' : 'Apagar';
  }

  const exactLabel = document.getElementById('searchExactLabel');
  if (exactLabel) {
    exactLabel.textContent = lang === 'ja' ? '完全一致' : 'Palavra exata';
    const parentLabel = exactLabel.closest('label');
    if (parentLabel) {
      parentLabel.title = lang === 'ja'
        ? '完全一致のみ検索。例：「光」で「光明」は除外されます'
        : "Busca somente palavras inteiras. Ex: 'luz' não encontrará 'reluz'";
    }
  }

  if (triggerRender && typeof window.renderContent === 'function') {
    window.renderContent(lang);
  }
}

window.toggleLanguage = function () {
  const current = localStorage.getItem('site_lang') || 'pt';
  const next = current === 'pt' ? 'ja' : 'pt';
  setLanguage(next);
};
