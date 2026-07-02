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
  if (headerLogo && !headerLogo.querySelector('svg')) {
    const ptTitle = 'Caminho da Felicidade';
    const jaTitle = '幸福の道';
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
    // mobileNavLabelNav agora abriga toda a obra de Meishu-Sama
    // (volumes + poesia). mobileNavLabelComplementary virou "Discípulos".
    updateLabel('mobileNavLabelNav', t.meishuSama || 'Meishu-Sama');
    updateLabel('mobileNavLabelActions', t.actions);
    updateLabel('mobileNavLabelFont', t.fontSize);
    updateLabel('mobileNavLabelComplementary', t.discipulos || 'Discípulos');
    updateLink('mobileNavLinkHistory', t.history);
    updateLink('mobileNavLinkSavedPoems', t.savedPoems || 'Poemas Salvos');
    updateLink('mobileNavLinkFavorites', t.saved);
    updateLink('mobileNavLinkHighlights', t.highlights || 'Central de Destaques');
    updateLink('mobileNavLinkReadCentral', t.readCentral || 'Ensinamentos Lidos');
    // Recomendações/Conversas têm um badge <span> IRMÃO de .link-text
    // (não filho) — updateLink só toca .link-text, o número do badge
    // fica intacto.
    updateLink('mobileNavLinkRecommendations', t.recommendations || 'Central de Recomendações');
    updateLink('mobileNavLinkConversations', t.conversations || 'Minhas conversas');
    updateLink('mobileNavLinkLang', t.lang);
    updateLink('mobileNavLinkTheme', t.theme);
    updateLink('mobileNavLinkPoetry', t.poetry || 'Obras Poéticas');
    updateLink('mobileNavLinkDisciples', t.disciples || 'Publicações de Discípulos');

    const closeBtn = document.getElementById('mobileNavClose');
    if (closeBtn) closeBtn.setAttribute('aria-label', t.close);

    const mobileLinksContainer = document.getElementById('mobileNavLinks');
    if (mobileLinksContainer) {
      const desktopNav = document.querySelector('.header__nav');
      // Filtro: o link "Poesia" do desktop nav duplica a seção "Obras
      // Poéticas" do mobile menu — esconder pra não aparecer em NAVEGAÇÃO.
      const navLinks = desktopNav
        ? Array.from(desktopNav.querySelectorAll('a')).filter(a => !/\bpoesia\.html(?:[?#]|$)/.test(a.getAttribute('href') || ''))
        : [];
      const linksHtml = navLinks.map(a => {
        // Bug: a.textContent inclui o conteúdo do <span class="lang-ja"
        // style="display:none"> também — display:none não afeta textContent.
        // Em PT, o JA passa direto. Pega o span específico quando existir.
        const ptSpan = a.querySelector('.lang-pt');
        const jaSpan = a.querySelector('.lang-ja');
        const rawText = a.textContent.trim();
        const volMatch = (a.getAttribute('href') || '').match(/mioshiec(\d+)/);
        let text;
        if (lang === 'ja') {
          if (jaSpan) text = jaSpan.textContent.trim();
          else if (volMatch) text = '巻 ' + volMatch[1];
          else if (rawText.includes('Início') || rawText.includes('⌂')) text = 'トップ';
          else text = rawText;
        } else {
          if (ptSpan) {
            const prefix = rawText.startsWith('⌂') ? '⌂ ' : '';
            text = (prefix + ptSpan.textContent.trim()).trim();
          } else {
            text = rawText;
          }
        }
        const icon = a.href.includes('index.html') && rawText.startsWith('⌂')
          ? `<svg class="nav-icon" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
          : `<svg class="nav-icon" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
        const SUBT = (window.VOL_SUBTITLES && window.VOL_SUBTITLES[lang]) || (window.VOL_SUBTITLES && window.VOL_SUBTITLES.pt) || {};
        const subtitle = volMatch ? SUBT[volMatch[1]] : null;
        const labelHtml = subtitle
          ? `<span class="mobile-nav-link__title"><span>${text}</span><span class="mobile-nav-link__subtitle">${subtitle}</span></span>`
          : text;
        return `<a href="${a.href}" class="mobile-nav-link">${icon}${labelHtml}</a>`;
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

  // Empty state/chips do modal de busca seguem o idioma na hora, sem
  // reabrir o modal (hook definido pelo search.js).
  if (typeof window._searchOnLanguageChange === 'function') window._searchOnLanguageChange();

  if (triggerRender && typeof window.renderContent === 'function') {
    window.renderContent(lang);
  }
}

// Persiste a escolha de idioma na conta (preferred_lang) para virar a fonte da
// verdade em qualquer aparelho/login. Fire-and-forget, igual ao heartbeat de
// last_seen_at — não bloqueia o toggle e não quebra em página sem login. A RLS
// de user_profiles permite o próprio usuário atualizar a própria linha; o
// trigger de segurança só barra role/admin_pin_hash, então esta coluna passa.
function _persistLangPreference(lang) {
  try {
    const supa = (window.supabaseAuth && window.supabaseAuth.supabase)
      || window._supabaseClient || null;
    const uid = localStorage.getItem('mioshie_user_id');
    if (!supa || !uid) return; // anônimo → só localStorage
    supa.from('user_profiles').update({ preferred_lang: lang }).eq('id', uid)
      .then(({ error }) => {
        if (error) console.warn('[lang-pref] Falha ao salvar preferência de idioma:', error.message);
      }, () => { /* rede caiu — sem problema, localStorage já guardou */ });
  } catch (e) { /* nunca bloquear o toggle */ }
}

window.toggleLanguage = function () {
  const current = localStorage.getItem('site_lang') || 'pt';
  const next = current === 'pt' ? 'ja' : 'pt';
  setLanguage(next);
  _persistLangPreference(next);
};
