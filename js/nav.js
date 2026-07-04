// ============================================================
// MOBILE NAV — hamburger menu injected dynamically
// Depends on: MENU_TEXTS (toggle.js)
// ============================================================

// Subtítulos dos volumes na seção "Meishu-Sama" do menu mobile. MESMOS
// nomes oficiais dos cards da home e do dropdown "Ensino aleatório" (antes
// divergiam: este menu usava glosas informais tipo "Método de Saúde"/
// "神性医療法" em vez do título real da seção). Compartilhado entre o
// build inicial (este arquivo) e o rebuild no setLanguage (language.js) —
// exportado em window pra reuso.
const VOL_SUBTITLES = {
  pt: { 1: 'Mundo Espiritual', 2: 'Método Divino de Saúde', 3: 'A Verdadeira Fé', 4: 'Ensinamentos Diversos' },
  ja: { 1: '霊界編', 2: '浄霊・自然農法', 3: '信仰編', 4: '多様な御教え' }
};
window.VOL_SUBTITLES = VOL_SUBTITLES;

// Torna colapsáveis as seções cujo label tem data-collapsible="<key>". Envolve
// SÓ os .mobile-nav-link imediatamente seguintes (para nos divisores/seções e
// não engolir o wrapper de Discípulos), adiciona um chevron e persiste o estado
// aberto/recolhido por seção em localStorage (nav_sec_<key>). Roda a cada build
// (o innerHTML é regenerado do zero → sem risco de duplo-embrulho).
function _setupCollapsibleSections(root) {
  root.querySelectorAll('.mobile-nav-section-label[data-collapsible]').forEach(label => {
    // Guarda contra re-embrulho (se por acaso rodar sobre DOM já processado).
    if (label.nextElementSibling && label.nextElementSibling.classList.contains('mobile-nav-collapse-body')) return;
    const key = label.getAttribute('data-collapsible');
    const items = [];
    let el = label.nextElementSibling;
    while (el && el.classList.contains('mobile-nav-link')) { items.push(el); el = el.nextElementSibling; }
    if (!items.length) return;

    const body = document.createElement('div');
    body.className = 'mobile-nav-collapse-body';
    label.parentNode.insertBefore(body, label.nextSibling);
    items.forEach(it => body.appendChild(it));

    label.classList.add('mobile-nav-collapsible');
    const chev = document.createElement('span');
    chev.className = 'mobile-nav-chevron';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '▾';
    label.appendChild(chev);

    let collapsed = true;   // nascem recolhidas (corta o scan inicial)
    try { const s = localStorage.getItem('nav_sec_' + key); if (s !== null) collapsed = s === '1'; } catch (_) {}
    label.classList.toggle('collapsed', collapsed);
    body.classList.toggle('collapsed', collapsed);
    label.setAttribute('role', 'button');
    label.setAttribute('tabindex', '0');
    label.setAttribute('aria-expanded', String(!collapsed));

    const toggle = () => {
      const nowCollapsed = !body.classList.contains('collapsed');
      body.classList.toggle('collapsed', nowCollapsed);
      label.classList.toggle('collapsed', nowCollapsed);
      label.setAttribute('aria-expanded', String(!nowCollapsed));
      try { localStorage.setItem('nav_sec_' + key, nowCollapsed ? '1' : '0'); } catch (_) {}
    };
    label.addEventListener('click', toggle);
    label.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

// ── Instalar como aplicativo (PWA) ─────────────────────────────────────────
// A lógica vive aqui (nav.js está em toda página que tem menu) em vez de num
// arquivo à parte — evita esquecer o <script> em alguma página. Captura o
// beforeinstallprompt (Android) uma vez; no iOS mostra o passo a passo manual.
let _pwaDeferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _pwaDeferredPrompt = e;
  const el = document.getElementById('mobileNavLinkInstall');
  if (el) el.style.display = '';
});
window.addEventListener('appinstalled', () => {
  _pwaDeferredPrompt = null;
  const el = document.getElementById('mobileNavLinkInstall');
  if (el) el.style.display = 'none';
});

function _pwaIsStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
}
function _pwaIsIOS() {
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}
// Revela o item do menu quando dá pra instalar (Android com prompt, ou iOS
// fora do standalone). Chamado a cada build do menu (o item é recriado).
function _setupPwaInstall(root) {
  const el = root.querySelector('#mobileNavLinkInstall');
  if (!el) return;
  const eligible = !_pwaIsStandalone() && (!!_pwaDeferredPrompt || _pwaIsIOS());
  el.style.display = eligible ? '' : 'none';
}
window._pwaInstall = function () {
  if (_pwaDeferredPrompt) {
    _pwaDeferredPrompt.prompt();
    Promise.resolve(_pwaDeferredPrompt.userChoice).finally(() => {
      _pwaDeferredPrompt = null;
      const el = document.getElementById('mobileNavLinkInstall');
      if (el) el.style.display = 'none';
    });
    return;
  }
  // iOS (ou sem prompt): mini-card com o passo a passo de "Adicionar à Tela".
  if (document.getElementById('pwaInstallCard')) return;
  const lang = localStorage.getItem('site_lang') === 'ja' ? 'ja' : 'pt';
  const card = document.createElement('div');
  card.id = 'pwaInstallCard';
  card.setAttribute('role', 'dialog');
  card.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;max-width:360px;width:calc(100% - 32px);background:var(--surface);color:var(--text-main);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-premium);padding:18px 20px;font-size:0.95rem;line-height:1.55;';
  const steps = lang === 'ja'
    ? 'Safari下部の<strong>共有</strong>アイコンをタップし、<strong>「ホーム画面に追加」</strong>を選ぶと、アプリのように使えます。'
    : 'Toque no ícone de <strong>Compartilhar</strong> (embaixo, no Safari) e escolha <strong>“Adicionar à Tela de Início”</strong> para usar como aplicativo.';
  const okL = lang === 'ja' ? 'わかりました' : 'Entendi';
  const titleL = lang === 'ja' ? 'アプリとして使う' : 'Instalar o aplicativo';
  card.innerHTML = '<div style="font-weight:600;color:var(--accent);margin-bottom:8px;">' + titleL + '</div>'
    + '<div style="margin-bottom:14px;">' + steps + '</div>'
    + '<button type="button" id="pwaInstallOk" class="btn-zen" style="min-height:44px;padding:10px 22px;cursor:pointer;display:block;margin-left:auto;">' + okL + '</button>';
  document.body.appendChild(card);
  document.getElementById('pwaInstallOk').addEventListener('click', () => card.remove());
};

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

  // Move o tocToggle pra DEPOIS do botão "Voltar ao Índice" e transfere
  // o `margin-right: auto` de Voltar pro toggle. Voltar tinha esse auto
  // inline pra empurrar header__actions pra direita; sem mover, o toggle
  // ficava no meio do header (em cima do logo absolute-centrado). Agora:
  //   - Voltar: margin-right 8px (gap fixo até o toggle)
  //   - toggle: margin-right auto (consome o espaço entre ele e actions)
  //   - actions: continua com margin-left auto (canto direito)
  // Idempotente: pode rodar várias vezes sem quebrar.
  const tocToggleBtn = header.querySelector('#tocToggle');
  const backIdxBtn = header.querySelector('#backToIndexBtn');
  if (tocToggleBtn && backIdxBtn) {
    if (backIdxBtn.nextElementSibling !== tocToggleBtn) {
      backIdxBtn.insertAdjacentElement('afterend', tocToggleBtn);
    }
    backIdxBtn.style.marginRight = '8px';
    tocToggleBtn.style.marginRight = 'auto';
  }
  document.documentElement.classList.add('toc-ready');

  const desktopNav = header.querySelector('.header__nav');
  // O menu mobile já tem uma seção dedicada "Obras Poéticas" (Yama / Warai)
  // mais abaixo, então o link "Poesia" do desktop nav (presente só em
  // poemas-salvos.html) é redundante aqui — filtramos pra evitar duplicar.
  const navLinks = desktopNav
    ? Array.from(desktopNav.querySelectorAll('a')).filter(a => !/\bpoesia\.html(?:[?#]|$)/.test(a.getAttribute('href') || ''))
    : [];
  const topicSelect = desktopNav ? desktopNav.querySelector('select') : null;
  const topicOptions = topicSelect
    ? Array.from(topicSelect.options).filter(o => o.value)
    : [];

  const currentLang = localStorage.getItem('site_lang') || 'pt';
  const t = MENU_TEXTS[currentLang] || MENU_TEXTS.pt;

  // Busca no corpo do menu também (o header só tem a lupa sem rótulo — a
  // affordance mais fraca pro público idoso, sendo o recurso mais poderoso do
  // site). Mesmo gate do botão do header (window._searchEnabled).
  const _searchAllowed = typeof window._searchEnabled === 'function' ? window._searchEnabled() : true;
  const _searchLabel = t.search || (currentLang === 'ja' ? '検索' : 'Buscar');

  let linksHtml = navLinks.map(a => {
    // a.textContent inclui spans .lang-ja com display:none (textContent
    // ignora CSS). Em PT, isso vazaria kanji junto do romaji. Extrai
    // o texto do idioma ativo se houver spans lang-*. Fallback pra Vols.
    const ptSpan = a.querySelector('.lang-pt');
    const jaSpan = a.querySelector('.lang-ja');
    const rawText = a.textContent.trim();
    const volMatch = (a.getAttribute('href') || '').match(/mioshiec(\d+)/);
    let text;
    if (currentLang === 'ja' && jaSpan) {
      text = jaSpan.textContent.trim();
    } else if (currentLang === 'ja') {
      // Fallback pra Vol 1-4 (sem lang spans)
      if (volMatch) text = '巻 ' + volMatch[1];
      else if (rawText.includes('Início') || rawText.includes('⌂')) text = 'トップ';
      else text = rawText;
    } else if (ptSpan) {
      const prefix = rawText.startsWith('⌂') ? '⌂ ' : '';
      text = (prefix + ptSpan.textContent.trim()).trim();
    } else {
      text = rawText;
    }
    const icon = a.href.includes('index.html') && rawText.startsWith('⌂')
      ? `<svg class="nav-icon" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
      : `<svg class="nav-icon" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
    const subtitle = volMatch ? (VOL_SUBTITLES[currentLang] || VOL_SUBTITLES.pt)[volMatch[1]] : null;
    const labelHtml = subtitle
      ? `<span class="mobile-nav-link__title"><span>${text}</span><span class="mobile-nav-link__subtitle">${subtitle}</span></span>`
      : text;
    return `<a href="${a.href}" class="mobile-nav-link">${icon}${labelHtml}</a>`;
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

        ${_searchAllowed ? `<button class="mobile-nav-link" onclick="closeMobileNav(); openSearch();" id="mobileNavLinkSearch">
          <svg class="nav-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span class="link-text">${_searchLabel}</span>
        </button>` : ''}

        <button class="mobile-nav-link" onclick="openHistory(); closeMobileNav();" id="mobileNavLinkHistory">
          <svg class="nav-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span class="link-text">${t.history}</span>
        </button>

        <button class="mobile-nav-link" onclick="window.location.href=(window.location.pathname.includes('/mioshiec') ? '../' : '') + 'salvos.html';" id="mobileNavLinkFavorites">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          <span class="link-text">${t.saved}</span>
        </button>

        <button class="mobile-nav-link" onclick="window.location.href=(window.location.pathname.includes('/mioshiec') ? '../' : '') + 'destaques.html';" id="mobileNavLinkHighlights">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span class="link-text">${t.highlights || 'Central de Destaques'}</span>
        </button>

        <button class="mobile-nav-link" onclick="window.location.href=(window.location.pathname.includes('/mioshiec') ? '../' : '') + 'lidos.html';" id="mobileNavLinkReadCentral">
          <svg class="nav-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg>
          <span class="link-text">${t.readCentral || 'Ensinamentos Lidos'}</span>
        </button>

        <button class="mobile-nav-link" onclick="window.location.href=(window.location.pathname.includes('/mioshiec') ? '../' : '') + 'poemas-salvos.html';" id="mobileNavLinkSavedPoems">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <span class="link-text">${t.savedPoems || 'Poemas Salvos'}</span>
        </button>

        <button class="mobile-nav-link" id="mobileNavLinkRecommendations" style="display:none; position:relative;" onclick="closeMobileNav(); window.location.href = (window.location.pathname.includes('/mioshiec') ? '../' : '') + 'recomendacoes.html';">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          <span class="link-text">${t.recommendations || 'Central de Recomendações'}</span>
          <span class="rec-badge" style="display:none; margin-left:auto; min-width:18px; height:18px; padding:0 5px; background:var(--accent); color:#fff; border-radius:9px; font-size:0.7rem; font-weight:700; align-items:center; justify-content:center; line-height:1;">0</span>
        </button>

        <button class="mobile-nav-link" id="mobileNavLinkConversations" style="display:none; position:relative;" onclick="closeMobileNav(); if (typeof openMyConversations === 'function') openMyConversations();">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          <span class="link-text">${t.conversations || 'Minhas conversas'}</span>
          <span class="conv-badge" style="display:none; margin-left:auto; min-width:18px; height:18px; padding:0 5px; background:var(--accent); color:#fff; border-radius:9px; font-size:0.7rem; font-weight:700; align-items:center; justify-content:center; line-height:1;">0</span>
        </button>

        <button class="mobile-nav-link" id="mobileNavLinkPlaylists" style="display:none;" onclick="closeMobileNav(); if (typeof openPlaylistManager === 'function') openPlaylistManager();">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span class="link-text">Minhas playlists</span>
        </button>

        ${window.location.pathname.includes('reader.html') ? `
        <button class="mobile-nav-link" onclick="closeMobileNav(); printCurrentTeaching();" id="mobileNavLinkPrint">
          <svg class="nav-icon" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          <span class="link-text">${t.print || 'Imprimir'}</span>
        </button>` : ''}

        <!-- "Instalar o aplicativo": nasce oculto; js/pwa-install.js revela e liga
             quando instalável (Android beforeinstallprompt) ou no iOS fora do
             modo standalone. É o modelo mental de "app" que o público idoso entende. -->
        <button class="mobile-nav-link" id="mobileNavLinkInstall" style="display:none;" onclick="closeMobileNav(); if (typeof window._pwaInstall === 'function') window._pwaInstall();">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
          <span class="link-text"><span class="lang-pt">Instalar o aplicativo</span><span class="lang-ja" style="display:none">アプリとして使う</span></span>
        </button>

        <div class="mobile-nav-divider"></div>
        <div class="mobile-nav-section-label" id="mobileNavLabelFont">${t.fontSize}</div>

        <button class="mobile-nav-link" onclick="toggleTheme(); closeMobileNav();" id="mobileNavLinkTheme">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <span class="link-text">${t.theme}</span>
        </button>

        <button class="mobile-nav-link" onclick="toggleLanguage(); closeMobileNav();" id="mobileNavLinkLang">
          <svg class="nav-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span class="link-text">${t.lang}</span>
        </button>

        ${window.location.pathname.includes('reader.html') ? `
        <button class="mobile-nav-link" onclick="toggleComparison(); closeMobileNav();" id="mobileNavLinkComparison">
          <svg class="nav-icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
          <span class="link-text">${t.comparison}</span>
        </button>` : ''}

        <!-- A-/A+ ativam o modo "peek": o backdrop (blur + dim) some,
             mas o painel lateral permanece — assim o usuário vê o efeito
             no conteúdo e pode clicar várias vezes pra ajustar.
             Em páginas de poesia, poetry-fontsize.js também escuta esses
             botões e ajusta --poetry-scale (substituiu os botões que
             ficavam na sidebar das obras poéticas). -->
        <div class="mobile-font-row">
          <button class="mobile-font-btn" id="mobileFontDown" onclick="changeFontSize(-1); _peekMobileNav();">A-</button>
          <button class="mobile-font-btn" id="mobileFontUp" onclick="changeFontSize(1); _peekMobileNav();">A+</button>
        </div>

        <div class="mobile-nav-divider"></div>
        <div class="mobile-nav-section-label" id="mobileNavLabelNav">${t.meishuSama || 'Meishu-Sama'}</div>
        <div id="mobileNavLinks">
          ${linksHtml}
        </div>

        <div id="mobileDynamicTopics"></div>

        <!-- Obras poéticas ficam no mesmo guarda-chuva de Meishu-Sama,
             separadas só por um divisor suave (sem label próprio). -->
        <div class="mobile-nav-subdivider"></div>

        <!-- Obras poéticas agrupadas como na home (poesia.html): duas seções
             rotuladas — Poesia Lírica (詩歌) e Salmos Sagrados (御讃歌). -->
        <div class="mobile-nav-section-label" data-collapsible="poesia"><span class="lang-pt">Poesia Lírica</span><span class="lang-ja" style="display:none">詩歌</span></div>

        <a class="mobile-nav-link" href="${window.location.pathname.includes('/mioshiec') ? '../' : ''}akimaro-kineishu.html" id="mobileNavLinkAkimaro">
          <svg class="nav-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="7.05" y2="7.05"/><line x1="16.95" y1="16.95" x2="19.07" y2="19.07"/><line x1="4.93" y1="19.07" x2="7.05" y2="16.95"/><line x1="16.95" y1="7.05" x2="19.07" y2="4.93"/></svg>
          <span class="mobile-nav-link__title">
            <span><span class="lang-pt">Akemaro Kin'eishū</span><span class="lang-ja" style="display:none">明麿近詠集</span></span>
            <span class="mobile-nav-link__subtitle"><span class="lang-pt">Tanka · 486</span><span class="lang-ja" style="display:none">短歌・486首</span></span>
          </span>
        </a>

        <a class="mobile-nav-link" href="${window.location.pathname.includes('/mioshiec') ? '../' : ''}yama-to-mizu.html" id="mobileNavLinkYama">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M3 20l5-9 4 6 3-4 6 7H3z"/><circle cx="17" cy="6" r="2"/></svg>
          <span class="mobile-nav-link__title">
            <span><span class="lang-pt">Yama to Mizu</span><span class="lang-ja" style="display:none">山と水</span></span>
            <span class="mobile-nav-link__subtitle"><span class="lang-pt">Tanka</span><span class="lang-ja" style="display:none">短歌</span></span>
          </span>
        </a>

        <a class="mobile-nav-link" href="${window.location.pathname.includes('/mioshiec') ? '../' : ''}warai-no-izumi.html" id="mobileNavLinkWarai">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          <span class="mobile-nav-link__title">
            <span><span class="lang-pt">Warai no Izumi</span><span class="lang-ja" style="display:none">笑の泉</span></span>
            <span class="mobile-nav-link__subtitle"><span class="lang-pt">Kanku</span><span class="lang-ja" style="display:none">寒句</span></span>
          </span>
        </a>

        <!-- 2ª seção poética: Salmos Sagrados (御讃歌) — Gosanka-shū.
             Itens com título curto + ícone de livro (arcticons:book). -->
        <div class="mobile-nav-subdivider"></div>
        <div class="mobile-nav-section-label" data-collapsible="salmos"><span class="lang-pt">Salmos Sagrados</span><span class="lang-ja" style="display:none">御讃歌</span></div>

        <a class="mobile-nav-link" href="${window.location.pathname.includes('/mioshiec') ? '../' : ''}gosanka-shoban.html" id="mobileNavLinkGosankaShoban">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M7.35 2.25h-1.15c-1.1 0-2 0.9-2 2v15.5c0 1.1 0.9 2 2 2h1.15m0-19.5v19.5h10.45c1.1 0 2-0.9 2-2v-15.5c0-1.1-0.9-2-2-2z"/></svg>
          <span class="mobile-nav-link__title">
            <span><span class="lang-pt">Primeira Edição (1948)</span><span class="lang-ja" style="display:none">初版</span></span>
            <span class="mobile-nav-link__subtitle"><span class="lang-pt">Tanka · 309</span><span class="lang-ja" style="display:none">短歌・309首</span></span>
          </span>
        </a>

        <a class="mobile-nav-link" href="${window.location.pathname.includes('/mioshiec') ? '../' : ''}gosanka-kaitei.html" id="mobileNavLinkGosankaKaitei">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M7.35 2.25h-1.15c-1.1 0-2 0.9-2 2v15.5c0 1.1 0.9 2 2 2h1.15m0-19.5v19.5h10.45c1.1 0 2-0.9 2-2v-15.5c0-1.1-0.9-2-2-2z"/></svg>
          <span class="mobile-nav-link__title">
            <span><span class="lang-pt">Edição Revisada (1951)</span><span class="lang-ja" style="display:none">改訂版</span></span>
            <span class="mobile-nav-link__subtitle"><span class="lang-pt">Tanka · 462</span><span class="lang-ja" style="display:none">短歌・462首</span></span>
          </span>
        </a>

        <a class="mobile-nav-link" href="${window.location.pathname.includes('/mioshiec') ? '../' : ''}gosanka-shikiten.html" id="mobileNavLinkGosankaShikiten">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M7.35 2.25h-1.15c-1.1 0-2 0.9-2 2v15.5c0 1.1 0.9 2 2 2h1.15m0-19.5v19.5h10.45c1.1 0 2-0.9 2-2v-15.5c0-1.1-0.9-2-2-2z"/></svg>
          <span class="mobile-nav-link__title">
            <span><span class="lang-pt">Cerimônia Especial</span><span class="lang-ja" style="display:none">各式典の御讃歌</span></span>
            <span class="mobile-nav-link__subtitle"><span class="lang-pt">Tanka · 564</span><span class="lang-ja" style="display:none">短歌・564首</span></span>
          </span>
        </a>

        <!-- Seção "Discípulos" — só em PT. As obras de discípulos são portes
             traduzidos p/ o público brasileiro; no modo japonês não fazem
             sentido. class="lang-pt" → setLanguage esconde no JA / mostra no PT.
             O display:none inicial cobre o 1º paint quando já se entra em JA. -->
        <div id="mobileNavDisciplesSection" class="lang-pt"${currentLang === 'ja' ? ' style="display:none"' : ''}>
        <div class="mobile-nav-divider"></div>
        <div class="mobile-nav-section-label" id="mobileNavLabelComplementary" data-collapsible="disciples">${t.discipulos || 'Discípulos'}</div>

        <a class="mobile-nav-link" href="${window.location.pathname.includes('/mioshiec') ? '../' : ''}reader.html?pub=disciples&book=keigyou" id="mobileNavLinkKeigyou">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span class="link-text"><span class="lang-pt">Keigyou</span><span class="lang-ja" style="display:none">景 仰</span></span>
        </a>

        <a class="mobile-nav-link" href="${window.location.pathname.includes('/mioshiec') ? '../' : ''}reader.html?pub=disciples&book=ashita-no-ijitsu-wo-ikiru" id="mobileNavLinkAshita">
          <svg class="nav-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span class="link-text"><span class="lang-pt">Ashita no Ijitsu wo Ikiru</span><span class="lang-ja" style="display:none">明日の医術を生きる</span></span>
        </a>
        </div>

        <!-- Seção SÓ-ADMIN: guias ocultos (fora do menu público e do sitemap,
             noindex). O container nasce display:none e é revelado no
             isAdminUser() abaixo — mesmo padrão de "Minhas playlists". -->
        <div id="mobileNavAdminSection" style="display:none;">
          <div class="mobile-nav-divider"></div>
          <div class="mobile-nav-section-label"><span class="lang-pt">Guias (admin)</span><span class="lang-ja" style="display:none">ガイド（管理者）</span></div>

          <a class="mobile-nav-link" id="mobileNavLinkShinDendo" href="${window.location.pathname.includes('/mioshiec') ? '../' : ''}shin-dendo.html">
            <svg class="nav-icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
            <span class="link-text"><span class="lang-pt">Shin Dendō</span><span class="lang-ja" style="display:none">新伝道</span></span>
          </a>

          <a class="mobile-nav-link" id="mobileNavLinkAnaliseEspiritual" href="${window.location.pathname.includes('/mioshiec') ? '../' : ''}analise-espiritual.html">
            <svg class="nav-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            <span class="link-text"><span class="lang-pt">Análise Espiritual das Doenças</span><span class="lang-ja" style="display:none">病気の霊的分析</span></span>
          </a>

          <a class="mobile-nav-link" id="mobileNavLinkPontosVitais" href="${window.location.pathname.includes('/mioshiec') ? '../' : ''}pontos-vitais-johrei.html">
            <svg class="nav-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
            <span class="link-text"><span class="lang-pt">Pontos Vitais do Johrei</span><span class="lang-ja" style="display:none">浄霊の急所</span></span>
          </a>
        </div>

      </div>
    </div>`;

  document.body.appendChild(mobileNavOverlay);

  // Aplica o idioma atual aos spans .lang-pt/.lang-ja recém-injetados. Sem
  // isto, as seções ESTÁTICAS do menu (Obras Poéticas, Salmos Sagrados,
  // Guias, Discípulos…) nascem sempre em PT mesmo no modo japonês: o
  // setLanguage da carga da página roda ANTES deste overlay existir, então o
  // toggle global de visibilidade (.lang-pt/.lang-ja) nunca alcança estes nós
  // e o PT (default, sem display:none) fica visível. Espelha as linhas de
  // toggle do setLanguage (language.js), restritas ao overlay.
  mobileNavOverlay.querySelectorAll('.lang-pt').forEach(el => { el.style.display = currentLang === 'pt' ? '' : 'none'; });
  mobileNavOverlay.querySelectorAll('.lang-ja').forEach(el => { el.style.display = currentLang === 'ja' ? '' : 'none'; });

  // Seções raras (Poesia Lírica, Salmos Sagrados, Discípulos) viram
  // colapsáveis: cortam ~8 linhas do 1º scan do menu sem remover nada. Estado
  // por seção em localStorage; nascem recolhidas. Feito em runtime (envolve só
  // os .mobile-nav-link seguintes) pra não reestruturar o template gigante.
  _setupCollapsibleSections(mobileNavOverlay);
  _setupPwaInstall(mobileNavOverlay);

  // Mostra "Minhas playlists" + a seção de guias ocultos só pra admin.
  if (typeof isAdminUser === 'function' && isAdminUser()) {
    const plLink = document.getElementById('mobileNavLinkPlaylists');
    if (plLink) plLink.style.display = '';
    const adminSection = document.getElementById('mobileNavAdminSection');
    if (adminSection) adminSection.style.display = '';
  }

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

  // Gate provisional: só renderiza o botão se a busca está habilitada
  // pra esse user. Knob central em js/search.js (SEARCH_ADMIN_ONLY).
  // Se search.js ainda não carregou, mostra o botão por padrão — o
  // próprio openSearch() vai bloquear no clique se for o caso.
  const searchAllowed = typeof window._searchEnabled === 'function'
    ? window._searchEnabled()
    : true;
  let searchBtn = null;
  if (searchAllowed) {
    searchBtn = document.createElement('button');
    searchBtn.className = 'mobile-search-btn';
    searchBtn.setAttribute('aria-label', 'Buscar');
    searchBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>`;
    searchBtn.addEventListener('click', () => openSearch());
    headerActions.insertBefore(searchBtn, hamburgerBtn);
  }

  // Botão "Recomendações" — envelope no header, visível em todas as
  // páginas. _reveal() em recommendations.js liga display:flex quando
  // o usuário tem ≥1 rec ativa. Posicionado antes da busca (à esquerda
  // dela), com badge de não-vistas.
  const recHeaderBtn = document.createElement('button');
  recHeaderBtn.className = 'mobile-fav-btn';
  recHeaderBtn.id = 'headerRecommendationsBtn';
  recHeaderBtn.setAttribute('aria-label', 'Recomendações para Estudo');
  recHeaderBtn.setAttribute('title', 'Recomendações para Estudo');
  recHeaderBtn.style.cssText = 'display:none; position:relative;';
  recHeaderBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
  <span class="rec-badge" style="display:none; position:absolute; top:2px; right:2px; min-width:16px; height:16px; padding:0 4px; background:var(--accent); color:#fff; border-radius:8px; font-size:0.62rem; font-weight:700; align-items:center; justify-content:center; line-height:1; box-sizing:border-box;">0</span>`;
  recHeaderBtn.addEventListener('click', () => {
    if (typeof openRecommendations === 'function') openRecommendations();
  });
  if (searchBtn) {
    headerActions.insertBefore(recHeaderBtn, searchBtn);
  } else {
    headerActions.insertBefore(recHeaderBtn, hamburgerBtn);
  }

  // Botão "Minhas conversas" — balão no header. initStudyMessages() em
  // study-messages.js liga display:flex quando o usuário já enviou ≥1
  // mensagem; badge = respostas não-vistas. Ícone distinto do envelope
  // (recomendações) de propósito.
  const convHeaderBtn = document.createElement('button');
  convHeaderBtn.className = 'mobile-fav-btn';
  convHeaderBtn.id = 'headerConversationsBtn';
  convHeaderBtn.setAttribute('aria-label', 'Minhas conversas com o Reverendo');
  convHeaderBtn.setAttribute('title', 'Minhas conversas com o Reverendo');
  convHeaderBtn.style.cssText = 'display:none; position:relative;';
  convHeaderBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>
  <span class="conv-badge" style="display:none; position:absolute; top:2px; right:2px; min-width:16px; height:16px; padding:0 4px; background:var(--accent); color:#fff; border-radius:8px; font-size:0.62rem; font-weight:700; align-items:center; justify-content:center; line-height:1; box-sizing:border-box;">0</span>`;
  convHeaderBtn.addEventListener('click', () => {
    if (typeof openMyConversations === 'function') openMyConversations();
  });
  if (searchBtn) {
    headerActions.insertBefore(convHeaderBtn, searchBtn);
  } else {
    headerActions.insertBefore(convHeaderBtn, hamburgerBtn);
  }

  const highlightBtn = document.createElement('button');
  highlightBtn.className = 'mobile-fav-btn';
  highlightBtn.id = 'mobileHighlightBtn';
  highlightBtn.setAttribute('aria-label', 'Destaques');
  const isReaderPage = window.location.pathname.includes('reader.html');
  // Páginas de índice dos volumes ficam em /mioshiecN/index.html.
  const isIndexPage = window.location.pathname.includes('/mioshiec');
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
  headerActions.insertBefore(highlightBtn, searchBtn);

  // Botão "Recomendar este" foi MOVIDO do header pra abaixo de cada título
  // (em js/reader-render.js _buildTopicSaveBar). Desambigua qual ensinamento
  // está sendo recomendado em páginas com múltiplos tópicos.

  if (isReaderPage) {
    const printBtn = document.createElement('button');
    printBtn.className = 'mobile-fav-btn header-only-desktop';
    printBtn.id = 'headerPrintBtn';
    printBtn.setAttribute('aria-label', t.print || 'Imprimir');
    printBtn.setAttribute('title', t.print || 'Imprimir');
    printBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 6 2 18 2 18 9"/>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
      <rect x="6" y="14" width="12" height="8"/>
    </svg>`;
    printBtn.addEventListener('click', () => {
      if (typeof printCurrentTeaching === 'function') printCurrentTeaching();
    });
    headerActions.insertBefore(printBtn, highlightBtn);
  }

  // Botão "Ensino aleatório" no header — ícone de brilho (estrela, igual
  // aos cards) que abre um dropdown com 5 opções: qualquer volume + os 4
  // volumes pelo TÍTULO (mesmos nomes dos cards da home; o usuário pediu
  // título em vez de "Volume N"). Reusa as funções públicas de sorteio de
  // search.js (window.openRandomTeaching / openRandomFromVolume), que já
  // mostram spinner e navegam pro reader. Foi promovido a TODAS as páginas em
  // 02/07; escopo ajustado 07/2026: só no ÍNDICE dos volumes e no READER
  // (fora da home e das outras centrais). Mobile: só no reader — o
  // _header.css esconde no índice via @media + body:not(.reader-body).
  // search.min.js está carregado nessas páginas, então as funções existem.
  if (isReaderPage || isIndexPage) {
    const randomLabel = currentLang === 'ja' ? 'ランダムな御教え' : 'Ensino aleatório';
    const randomWrap = document.createElement('div');
    randomWrap.className = 'reader-random-wrap';
    randomWrap.id = 'readerRandomWrap';
    randomWrap.innerHTML = `
      <button type="button" class="mobile-fav-btn" id="readerRandomBtn"
        aria-haspopup="true" aria-expanded="false"
        aria-label="${randomLabel}" title="${randomLabel}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"/>
        </svg>
      </button>
      <div class="reader-random-dropdown" id="readerRandomDropdown" role="menu">
        <button type="button" class="reader-random-option" data-vol="" role="menuitem">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span class="lang-pt">Qualquer volume</span><span class="lang-ja" style="display:none">全巻</span>
        </button>
        <div class="reader-random-divider"></div>
        <button type="button" class="reader-random-option" data-vol="mioshiec1" role="menuitem"><span class="lang-pt">Mundo Espiritual</span><span class="lang-ja" style="display:none">霊界編</span></button>
        <button type="button" class="reader-random-option" data-vol="mioshiec2" role="menuitem"><span class="lang-pt">Método Divino de Saúde</span><span class="lang-ja" style="display:none">浄霊・自然農法</span></button>
        <button type="button" class="reader-random-option" data-vol="mioshiec3" role="menuitem"><span class="lang-pt">A Verdadeira Fé</span><span class="lang-ja" style="display:none">信仰編</span></button>
        <button type="button" class="reader-random-option" data-vol="mioshiec4" role="menuitem"><span class="lang-pt">Ensinamentos Diversos</span><span class="lang-ja" style="display:none">多様な御教え</span></button>
      </div>`;
    headerActions.insertBefore(randomWrap, hamburgerBtn);

    // setLanguage() (language.js) já rodou antes deste nav.js deferred, então
    // os .lang-ja recém-injetados nasceriam com display:none (rótulo PT à
    // mostra em modo JA). Aplica o idioma atual agora; o toggle vivo depois é
    // pego pelo pass global querySelectorAll('.lang-*') do setLanguage.
    randomWrap.querySelectorAll('.lang-pt').forEach(el => { el.style.display = (currentLang === 'ja' ? 'none' : ''); });
    randomWrap.querySelectorAll('.lang-ja').forEach(el => { el.style.display = (currentLang === 'ja' ? '' : 'none'); });

    const randomBtn = randomWrap.querySelector('#readerRandomBtn');
    const randomDrop = randomWrap.querySelector('#readerRandomDropdown');
    const closeRandom = () => {
      randomDrop.classList.remove('open');
      randomBtn.setAttribute('aria-expanded', 'false');
    };
    randomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (randomDrop.classList.contains('open')) {
        closeRandom();
      } else {
        randomDrop.classList.add('open');
        randomBtn.setAttribute('aria-expanded', 'true');
      }
    });
    document.addEventListener('click', closeRandom);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRandom(); });

    randomWrap.querySelectorAll('.reader-random-option').forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const vol = opt.getAttribute('data-vol') || null;
        // Não fecha o dropdown: mantém a opção visível com o spinner
        // enquanto o RPC resolve (a navegação troca a página em seguida).
        // Passa a própria opção como currentTarget — _setRandomLoading
        // mostra o spinner nela; openRandom* faz o resto (RPC + navegação).
        const evt = { currentTarget: opt };
        if (vol) {
          if (typeof window.openRandomFromVolume === 'function') window.openRandomFromVolume(vol, evt);
        } else if (typeof window.openRandomTeaching === 'function') {
          window.openRandomTeaching(evt);
        }
      });
    });
  }

  const headerNavSelect = topicSelect;
  if (headerNavSelect && headerNavSelect.id !== 'readerTopicSelect') {
    const sectionLabel = (MENU_TEXTS[currentLang] || MENU_TEXTS.pt).volumeTopics;
    const opts = Array.from(headerNavSelect.options).filter(o => o.value).map(o => ({
      value: o.value,
      text: o.getAttribute('data-ja') && currentLang === 'ja' ? o.getAttribute('data-ja') : (o.getAttribute('data-pt') || o.textContent)
    }));
    if (opts.length > 0) {
      window._updateMobileNavTopics(sectionLabel, opts);
      // Espelha no TOC desktop, mesma estratégia do reader. As páginas
      // de volume não têm o aside/botão no HTML — injeta aqui sob demanda
      // pra não precisar editar mioshiec{1..4}/index.html. Hash atual
      // determina o item ativo (#section-N).
      _injectVolumeToc(header, sectionLabel, opts);
    }
  }
}

// Injeta o aside e o botão de toggle do TOC desktop em páginas de
// volume (mioshiec{N}/index.html). No reader.html esses elementos já
// existem no HTML — aqui só na página de volume.
function _injectVolumeToc(header, sectionLabel, opts) {
  if (typeof window._updateDesktopToc !== 'function') return;

  // Injeta o aside no <main> se ainda não existe.
  let aside = document.getElementById('publicationToc');
  if (!aside) {
    aside = document.createElement('aside');
    aside.id = 'publicationToc';
    aside.className = 'publication-toc';
    aside.setAttribute('aria-label', sectionLabel);
    aside.hidden = true;
    const main = document.querySelector('main') || document.body;
    main.insertBefore(aside, main.firstChild);
  }

  // Injeta o botão de toggle no header se ainda não existe.
  let btn = document.getElementById('tocToggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'tocToggle';
    btn.className = 'toc-toggle';
    btn.setAttribute('aria-label', 'Mostrar/ocultar ' + sectionLabel.toLowerCase());
    // Default colapsado — alinhado com a regra "sempre fechado por
    // carregamento" do boot script em reader.html. reflect() abaixo
    // ajusta este atributo dinamicamente quando o user toggla.
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('title', sectionLabel);
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="8" y1="6" x2="21" y2="6"/>
        <line x1="8" y1="12" x2="21" y2="12"/>
        <line x1="8" y1="18" x2="21" y2="18"/>
        <line x1="3" y1="6" x2="3.01" y2="6"/>
        <line x1="3" y1="12" x2="3.01" y2="12"/>
        <line x1="3" y1="18" x2="3.01" y2="18"/>
      </svg>
    `;
    // Insere logo após o primeiro btn-zen do header (botão "Início"
    // no caso da volume page) — mesma posição lógica que o reader.
    const firstBtnZen = header.querySelector('.btn-zen');
    if (firstBtnZen && firstBtnZen.parentElement === header) {
      firstBtnZen.insertAdjacentElement('afterend', btn);
    } else {
      header.appendChild(btn);
    }
    // NÃO adiciona click handler aqui — o handler global no
    // DOMContentLoaded (linha ~479) cuida disso. _initMobileNav é
    // chamado por toggle.js no MESMO DOMContentLoaded, antes do nav.js
    // anexar seu próprio handler — então quando o handler global roda,
    // o botão já está no DOM. Se duplicasse, cada clique alternaria a
    // classe duas vezes = no-op.
  }

  // Item ativo = ancora do hash atual, ou primeira opção se sem hash.
  const currentHref = window.location.hash || (opts[0] && opts[0].value) || '';
  window._updateDesktopToc(sectionLabel, opts, currentHref);

  // Liga scroll spy nas seções do volume (anchors #section-N).
  if (typeof window._attachTocScrollSpy === 'function') {
    requestAnimationFrame(() => window._attachTocScrollSpy());
  }

  document.documentElement.classList.add('toc-ready');
}

window.openMobileNav = function () {
  const overlay = document.getElementById('mobileNavOverlay');
  if (overlay) overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.closeMobileNav = function () {
  const overlay = document.getElementById('mobileNavOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.classList.remove('peeking');
  }
  document.body.style.overflow = '';
};

// "Peek" — esconde o backdrop (blur + dim) mantendo só o painel lateral
// visível, pro usuário ver o efeito do A-/A+ no conteúdo atrás. Ativado
// no clique do A-/A+ e limpo quando o menu é fechado.
window._peekMobileNav = function () {
  const overlay = document.getElementById('mobileNavOverlay');
  if (overlay) overlay.classList.add('peeking');
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
    label_to_use = currentLang === 'ja' ? 'この巻の章' : 'Capítulos deste Volume';
  } else {
    if (label === 'Capítulos deste Volume' || label === 'この巻の章') {
      label_to_use = currentLang === 'ja' ? 'この巻の章' : 'Capítulos deste Volume';
    } else if (label === 'Ensinamentos deste tema' || label === 'このテーマの教え') {
      label_to_use = currentLang === 'ja' ? 'このテーマの教え' : 'Ensinamentos deste tema';
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

// TOC desktop — espelha os topics do arquivo atual num painel fixo à
// esquerda. Mesmo dataset que alimenta o menu sanduíche em mobile, só
// que aqui sempre visível (em viewports ≥1280px, via CSS). Esconde no
// hidden attr quando não há publicações suficientes.
window._updateDesktopToc = function (label, optionsList, currentHref) {
  const aside = document.getElementById('publicationToc');
  const toggleBtn = document.getElementById('tocToggle');
  if (!aside) return;
  if (!optionsList || optionsList.length === 0) {
    aside.hidden = true;
    aside.innerHTML = '';
    if (toggleBtn) toggleBtn.hidden = true;   // sem TOC (ex: artigo de topico unico) → esconde o botao
    return;
  }
  aside.hidden = false;
  if (toggleBtn) toggleBtn.hidden = false;
  const currentLang = localStorage.getItem('site_lang') || 'pt';
  const heading = label || (currentLang === 'ja' ? 'このテーマの教え' : 'Ensinamentos deste tema');
  const items = optionsList.map((o, i) => {
    const active = currentHref && o.value === currentHref ? ' is-active' : '';
    return `<a href="${o.value}" class="publication-toc__item${active}">
      <span class="publication-toc__number" aria-hidden="true">${i + 1}</span>
      <span class="publication-toc__text">${o.text}</span>
    </a>`;
  }).join('');
  aside.innerHTML = `
    <div class="publication-toc__heading">${heading}</div>
    <nav class="publication-toc__list">${items}</nav>
  `;
};

// Scroll spy do TOC desktop — destaca a publicação visível conforme o
// usuário rola o leitor. Implementado com scroll listener + rAF (em vez
// de IntersectionObserver) porque a regra "tópico ativo = aquele cujo
// topo está mais próximo da linha-âncora, mas ainda acima dela" é mais
// natural de expressar com posições absolutas.
let _tocSpyHandler = null;
let _tocSpyRaf = null;

function _detachTocScrollSpy() {
  if (_tocSpyHandler) {
    window.removeEventListener('scroll', _tocSpyHandler);
    _tocSpyHandler = null;
  }
  if (_tocSpyRaf) {
    cancelAnimationFrame(_tocSpyRaf);
    _tocSpyRaf = null;
  }
}

function _setTocActive(href) {
  const aside = document.getElementById('publicationToc');
  if (!aside) return;
  aside.querySelectorAll('.publication-toc__item').forEach(a => {
    a.classList.toggle('is-active', a.getAttribute('href') === href);
  });
  // Auto-scroll do TOC pra manter o item ativo visível mesmo em
  // publicações com muitos tópicos (lista do TOC pode rolar internamente).
  const activeEl = aside.querySelector('.publication-toc__item.is-active');
  if (activeEl) {
    const list = aside.querySelector('.publication-toc__list');
    if (list) {
      const aRect = activeEl.getBoundingClientRect();
      const lRect = list.getBoundingClientRect();
      if (aRect.top < lRect.top || aRect.bottom > lRect.bottom) {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }
}

window._attachTocScrollSpy = function () {
  _detachTocScrollSpy();
  const aside = document.getElementById('publicationToc');
  if (!aside || aside.hidden) return;

  const targets = Array.from(aside.querySelectorAll('.publication-toc__item'))
    .map(a => {
      const href = a.getAttribute('href') || '';
      const id = href.startsWith('#') ? href.slice(1) : '';
      const el = id ? document.getElementById(id) : null;
      return el ? { el, href } : null;
    })
    .filter(Boolean);

  if (targets.length < 2) return;

  // Linha-âncora a 140px do topo da viewport — abaixo da nav (60px) e do
  // breadcrumb/título do tópico. Tópico ativo = o que tem topo mais
  // próximo desta linha, mas ainda acima dela (estamos lendo ele).
  const ACTIVE_LINE_Y = 140;

  const update = () => {
    _tocSpyRaf = null;
    let activeHref = targets[0].href;
    let bestTop = -Infinity;
    for (const t of targets) {
      const top = t.el.getBoundingClientRect().top;
      if (top <= ACTIVE_LINE_Y && top > bestTop) {
        bestTop = top;
        activeHref = t.href;
      }
    }
    _setTocActive(activeHref);
  };

  _tocSpyHandler = () => {
    if (_tocSpyRaf) return;
    _tocSpyRaf = requestAnimationFrame(update);
  };
  window.addEventListener('scroll', _tocSpyHandler, { passive: true });
  update();
};

// Wire do botão de toggle do TOC desktop. Aplica a classe inicial no
// botão (lê do <html>, que já tem a classe setada inline no <head>),
// e persiste a preferência em localStorage entre sessões.
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('tocToggle');
  if (!btn) return;
  const reflect = () => {
    const collapsed = document.documentElement.classList.contains('toc-collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.classList.toggle('is-collapsed', collapsed);
  };
  const setCollapsed = (next) => {
    document.documentElement.classList.toggle('toc-collapsed', next);
    try { localStorage.setItem('caminho_toc_collapsed', next ? 'true' : 'false'); } catch (e) { }
    reflect();
  };
  reflect();
  btn.addEventListener('click', () => {
    setCollapsed(!document.documentElement.classList.contains('toc-collapsed'));
  });
  // Mobile (<=1024px): o painel flutua sobre o conteudo, entao fecha ao
  // escolher um item ou tocar fora (no desktop e painel lateral persistente).
  document.addEventListener('click', (e) => {
    if (window.innerWidth > 1024) return;
    if (document.documentElement.classList.contains('toc-collapsed')) return;
    const aside = document.getElementById('publicationToc');
    if (!aside || aside.hidden) return;
    if (e.target.closest('.publication-toc__item')) { setCollapsed(true); return; }
    if (!aside.contains(e.target) && !btn.contains(e.target)) setCollapsed(true);
  });
});

window._mobileSwitchLang = function (lang) {
  if (typeof setLanguage === 'function') setLanguage(lang);
  const ptBtn = document.getElementById('mobileLangPt');
  const jaBtn = document.getElementById('mobileLangJa');
  if (ptBtn) ptBtn.classList.toggle('active', lang === 'pt');
  if (jaBtn) jaBtn.classList.toggle('active', lang === 'ja');
};
