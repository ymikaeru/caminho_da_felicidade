// ============================================================
// MOBILE NAV — hamburger menu injected dynamically
// Depends on: MENU_TEXTS (toggle.js)
// ============================================================

function _initMobileNav() {
  const header = document.querySelector('.header');
  if (!header) return;

  const headerActions = document.createElement('div');
  headerActions.className = 'header__actions';

  const hamburgerBtn = document.createElement('button');
  hamburgerBtn.className = 'mobile-menu-btn';
  hamburgerBtn.setAttribute('aria-label', 'Menu de navegação');
  hamburgerBtn.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>`;

  headerActions.appendChild(hamburgerBtn);
  header.appendChild(headerActions);

  const desktopNav = header.querySelector('.header__nav');
  const navLinks = desktopNav ? Array.from(desktopNav.querySelectorAll('a')) : [];
  const topicSelect = desktopNav ? desktopNav.querySelector('select') : null;
  const topicOptions = topicSelect
    ? Array.from(topicSelect.options).filter(o => o.value)
    : [];

  const currentLang = localStorage.getItem('site_lang') || 'pt';
  const t = MENU_TEXTS[currentLang] || MENU_TEXTS.pt;

  let linksHtml = navLinks.map(a => {
    const icon = a.href.includes('index.html') && a.textContent.trim().startsWith('⌂')
      ? `<svg class="nav-icon" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
      : `<svg class="nav-icon" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
    return `<a href="${a.href}" class="mobile-nav-link">${icon}${a.textContent.trim()}</a>`;
  }).join('');

  let topicsHtml = '';
  if (topicOptions.length > 0) {
    topicsHtml = `
      <div class="mobile-nav-divider"></div>
      <div class="mobile-nav-section-label">${t.volumeTopics}</div>
      ${topicOptions.map(o => `<a href="${o.value}" class="mobile-nav-link">
        <svg class="nav-icon" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        ${o.text}
      </a>`).join('')}`;
  }

  const mobileNavOverlay = document.createElement('div');
  mobileNavOverlay.className = 'mobile-nav-overlay';
  mobileNavOverlay.id = 'mobileNavOverlay';
  mobileNavOverlay.innerHTML = `
    <div class="mobile-nav-backdrop" id="mobileNavBackdrop"></div>
    <div class="mobile-nav-panel">
      <div class="mobile-nav-header">
        <span id="mobileMenuTitle">${t.title}</span>
      </div>
      <div class="mobile-nav-body">

        <div class="mobile-nav-section-label" id="mobileNavLabelActions">${t.actions}</div>

        <button class="mobile-nav-link" onclick="openHistory(); closeMobileNav();" id="mobileNavLinkHistory">
          <svg class="nav-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span class="link-text">${t.history}</span>
        </button>

        <button class="mobile-nav-link" onclick="openFavorites(); closeMobileNav();" id="mobileNavLinkFavorites">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <span class="link-text">${t.saved}</span>
        </button>

        <button class="mobile-nav-link" onclick="window.location.href=(window.location.pathname.includes('/mioshiec') ? '../' : '') + 'destaques.html';" id="mobileNavLinkHighlights">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span class="link-text">${t.highlights || 'Central de Destaques'}</span>
        </button>

        <button class="mobile-nav-link" onclick="toggleLanguage(); closeMobileNav();" id="mobileNavLinkLang">
          <svg class="nav-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span class="link-text">${t.lang}</span>
        </button>

        <button class="mobile-nav-link" onclick="toggleTheme(); closeMobileNav();" id="mobileNavLinkTheme">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <span class="link-text">${t.theme}</span>
        </button>

        ${window.location.pathname.includes('reader.html') ? `
        <button class="mobile-nav-link" onclick="toggleComparison(); closeMobileNav();" id="mobileNavLinkComparison">
          <svg class="nav-icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
          <span class="link-text">${t.comparison}</span>
        </button>
        <button class="mobile-nav-link" onclick="closeMobileNav(); printCurrentTeaching();" id="mobileNavLinkPrint">
          <svg class="nav-icon" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          <span class="link-text">${t.print || 'Imprimir'}</span>
        </button>` : ''}

        <div class="mobile-nav-divider"></div>
        <div class="mobile-nav-section-label" id="mobileNavLabelFont">${t.fontSize}</div>
        <div class="mobile-font-row">
          <button class="mobile-font-btn" id="mobileFontDown" onclick="changeFontSize(-1)">A-</button>
          <button class="mobile-font-btn" id="mobileFontUp" onclick="changeFontSize(1)">A+</button>
        </div>

        <div class="mobile-nav-divider"></div>
        <div class="mobile-nav-section-label" id="mobileNavLabelNav">${t.navigation}</div>
        <div id="mobileNavLinks">
          ${linksHtml}
        </div>

        <div id="mobileDynamicTopics"></div>

      </div>
    </div>`;

  document.body.appendChild(mobileNavOverlay);

  hamburgerBtn.addEventListener('click', () => {
    const titleEl = document.getElementById('mobileMenuTitle');
    if (titleEl) {
      const lang = localStorage.getItem('site_lang') || 'pt';
      const fallback = (MENU_TEXTS[lang] || MENU_TEXTS.pt).title;
      const docTitle = document.title;
      const match = docTitle.match(/^Meishu-Sama:\s*(.+?)\s*-\s*Caminho da Felicidade$/);
      titleEl.textContent = match ? match[1] : fallback;
    }
    openMobileNav();
  });
  document.getElementById('mobileNavBackdrop').addEventListener('click', closeMobileNav);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileNav();
  });

  const searchBtn = document.createElement('button');
  searchBtn.className = 'mobile-search-btn';
  searchBtn.setAttribute('aria-label', 'Buscar');
  searchBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>`;
  searchBtn.addEventListener('click', () => openSearch());
  headerActions.insertBefore(searchBtn, hamburgerBtn);

  const favBtn = document.createElement('button');
  favBtn.className = 'mobile-fav-btn';
  favBtn.id = 'mobileFavoriteBtn';
  favBtn.setAttribute('aria-label', 'Favoritar');
  favBtn.style.display = window.location.pathname.includes('reader.html') ? 'flex' : 'none';
  favBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
  </svg>`;
  favBtn.addEventListener('click', () => {
    if (typeof toggleFavorite === 'function') toggleFavorite();
  });
  headerActions.insertBefore(favBtn, searchBtn);

  const highlightBtn = document.createElement('button');
  highlightBtn.className = 'mobile-fav-btn';
  highlightBtn.id = 'mobileHighlightBtn';
  highlightBtn.setAttribute('aria-label', 'Destaques');
  const isReaderPage = window.location.pathname.includes('reader.html');
  const isComparisonMode = localStorage.getItem('reader_comparison') === 'true';
  highlightBtn.style.display = (isReaderPage && !isComparisonMode) ? 'flex' : 'none';
  highlightBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </svg>`;
  highlightBtn.addEventListener('click', () => {
    if (typeof openHighlights === 'function') openHighlights();
  });
  headerActions.insertBefore(highlightBtn, favBtn);

  const headerNavSelect = topicSelect;
  if (headerNavSelect && headerNavSelect.id !== 'readerTopicSelect') {
    const sectionLabel = (MENU_TEXTS[currentLang] || MENU_TEXTS.pt).volumeTopics;
    const opts = Array.from(headerNavSelect.options).filter(o => o.value).map(o => ({
      value: o.value,
      text: o.getAttribute('data-ja') && currentLang === 'ja' ? o.getAttribute('data-ja') : (o.getAttribute('data-pt') || o.textContent)
    }));
    if (opts.length > 0) {
      window._updateMobileNavTopics(sectionLabel, opts);
    }
  }
}

window.openMobileNav = function () {
  const overlay = document.getElementById('mobileNavOverlay');
  if (overlay) overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.closeMobileNav = function () {
  const overlay = document.getElementById('mobileNavOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
};

window._updateMobileNavTopics = function (label, optionsList) {
  const container = document.getElementById('mobileDynamicTopics');
  if (!container) return;
  if (!optionsList || optionsList.length === 0) {
    container.innerHTML = '';
    return;
  }

  const currentLang = localStorage.getItem('site_lang') || 'pt';
  let label_to_use = label;
  if (!label_to_use) {
    label_to_use = currentLang === 'ja' ? '巻のテーマ' : 'Temas do Volume';
  } else {
    if (label === 'Temas do Volume' || label === '巻のテーマ') {
      label_to_use = currentLang === 'ja' ? '巻のテーマ' : 'Temas do Volume';
    } else if (label === 'Publicações deste ensinamento' || label === '刊行物：テーマ') {
      label_to_use = currentLang === 'ja' ? '刊行物：テーマ' : 'Publicações deste ensinamento';
    }
  }

  let html = `
    <div class="mobile-nav-divider"></div>
    <div class="mobile-nav-section-label">${label_to_use}</div>
  `;
  optionsList.forEach(o => {
    html += `<a href="${o.value}" class="mobile-nav-link" onclick="closeMobileNav()">
      <svg class="nav-icon" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      ${o.text}
    </a>`;
  });
  container.innerHTML = html;
};

window._mobileSwitchLang = function (lang) {
  if (typeof setLanguage === 'function') setLanguage(lang);
  const ptBtn = document.getElementById('mobileLangPt');
  const jaBtn = document.getElementById('mobileLangJa');
  if (ptBtn) ptBtn.classList.toggle('active', lang === 'pt');
  if (jaBtn) jaBtn.classList.toggle('active', lang === 'ja');
};
