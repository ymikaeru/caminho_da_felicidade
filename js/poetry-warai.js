/**
 * poetry-warai.js — leitor de "Warai no Izumi" (笑いの泉).
 *
 * Carrega data/poetry/warai_no_izumi.json. A coleção tem 24 títulos
 * temáticos (空財布, ウツフ, ケチンボウ...) que viram filtros na sidebar.
 * Paginação em batches pra não despejar 1.063 cards de uma vez.
 */
(function () {
  'use strict';

  const DATA_URL = 'data/poetry/warai_no_izumi.json';
  const PAGE_SIZE = 60;

  let _poems = [];
  let _byTheme = new Map();    // title -> [poem]
  let _activeTheme = null;     // null = all
  let _query = '';
  let _visible = PAGE_SIZE;

  const $ = (sel) => document.querySelector(sel);

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _highlight(text, q) {
    if (!q) return _esc(text);
    const t = _esc(text);
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return t.replace(new RegExp(safe, 'gi'), m => `<mark>${m}</mark>`);
  }

  async function _load() {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error('Falha ao carregar: ' + res.status);
    _poems = await res.json();

    _byTheme = new Map();
    for (const p of _poems) {
      const t = p.title || '(sem título)';
      if (!_byTheme.has(t)) _byTheme.set(t, []);
      _byTheme.get(t).push(p);
    }
  }

  function _matchesQuery(p) {
    if (!_query) return true;
    const q = _query.toLowerCase();
    return (
      (p.original || '').toLowerCase().includes(q) ||
      (p.translation_pt || '').toLowerCase().includes(q) ||
      (p.author_penname || '').toLowerCase().includes(q) ||
      (p.title || '').toLowerCase().includes(q)
    );
  }

  function _currentList() {
    let base = _poems;
    if (_activeTheme) base = _byTheme.get(_activeTheme) || [];
    if (_query) base = base.filter(_matchesQuery);
    return base;
  }

  function _renderSidebar() {
    const list = $('#waraiThemeList');
    if (!list) return;
    const themes = Array.from(_byTheme.entries())
      .sort((a, b) => b[1].length - a[1].length);

    const allBtn = `
      <button class="poetry-filter-btn ${_activeTheme === null ? 'is-active' : ''}" data-theme="">
        <span class="lang-pt">Todos os temas</span>
        <span class="lang-ja" style="display:none">全題</span>
        <span class="poetry-filter-btn__count">${_poems.length}</span>
      </button>
    `;
    const items = themes.map(([t, arr]) => `
      <button class="poetry-filter-btn ${_activeTheme === t ? 'is-active' : ''}" data-theme="${_esc(t)}">
        <span class="poetry-filter-btn__jp">${_esc(t)}</span>
        <span class="poetry-filter-btn__count">${arr.length}</span>
      </button>
    `).join('');
    list.innerHTML = allBtn + items;
    list.querySelectorAll('.poetry-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.theme || '';
        _activeTheme = t || null;
        _visible = PAGE_SIZE;
        _render();
        const sb = $('#waraiSidebar');
        if (sb) sb.classList.remove('is-open');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    const stats = $('#waraiStats');
    if (stats) {
      stats.innerHTML = `
        <strong>${_poems.length.toLocaleString('pt-BR')}</strong>
        <span class="lang-pt"> versos em ${_byTheme.size} temas</span>
        <span class="lang-ja" style="display:none"> 句・${_byTheme.size} 題</span>
      `;
    }
  }

  function _renderPoem(p) {
    const num = p.num != null ? String(p.num).padStart(4, '0') : '';
    const penname = p.author_penname
      ? `<span class="poetry-card__tag">${_esc(p.author_penname)}</span>`
      : '';
    return `
      <article class="poetry-card">
        <div class="poetry-card__head">
          <span class="poetry-card__num">№ ${_esc(num)}</span>
          ${p.title ? `<span class="poetry-card__title">${_highlight(p.title, _query)}</span>` : ''}
          ${penname}
        </div>
        <div class="poetry-card__original">${_highlight(p.original, _query)}</div>
        ${p.translation_pt ? `<div class="poetry-card__translation">${_highlight(p.translation_pt, _query)}</div>` : ''}
      </article>
    `;
  }

  function _render() {
    const main = $('#waraiList');
    if (!main) return;
    _renderSidebar();

    const list = _currentList();
    if (list.length === 0) {
      main.innerHTML = `<div class="poetry-empty"><span class="lang-pt">Nenhum verso encontrado.</span><span class="lang-ja" style="display:none">該当する句はありません</span></div>`;
      return;
    }

    const slice = list.slice(0, _visible);
    let html = '';

    // Header com o tema atual (se filtrado)
    if (_activeTheme) {
      html += `
        <header class="poetry-section-heading">
          <div class="poetry-section-heading__kicker">
            <span class="lang-pt">Tema</span><span class="lang-ja" style="display:none">題</span>
          </div>
          <h2 class="poetry-section-heading__title">${_esc(_activeTheme)}</h2>
          <div class="poetry-section-heading__pt">${list.length} <span class="lang-pt">versos sobre este tema</span><span class="lang-ja" style="display:none">句</span></div>
          <div class="poetry-section-heading__rule"></div>
        </header>
      `;
    }

    html += `<div class="poetry-list">${slice.map(_renderPoem).join('')}</div>`;

    // Load more
    if (slice.length < list.length) {
      html += `
        <div class="poetry-load-more">
          <button class="btn-poetry-load-more" id="waraiLoadMore" type="button">
            <span class="lang-pt">Carregar mais (${list.length - slice.length} restantes)</span>
            <span class="lang-ja" style="display:none">もっと見る (${list.length - slice.length})</span>
          </button>
        </div>
      `;
    }

    main.innerHTML = html;
    const moreBtn = document.getElementById('waraiLoadMore');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        _visible += PAGE_SIZE;
        _render();
      });
    }

    const lang = localStorage.getItem('site_lang') || 'pt';
    if (typeof setLanguage === 'function') setLanguage(lang, false);
  }

  function _onSearch(value) {
    _query = (value || '').trim();
    _visible = PAGE_SIZE;
    _render();
  }

  function _randomPoem() {
    const list = _currentList();
    if (!list.length) return;
    const pick = list[Math.floor(Math.random() * list.length)];
    // Garante que o poema fique visível
    const idx = list.indexOf(pick);
    if (idx >= _visible) _visible = Math.ceil((idx + 1) / PAGE_SIZE) * PAGE_SIZE;
    _render();
    setTimeout(() => {
      const cards = document.querySelectorAll('#waraiList .poetry-card');
      const target = cards[idx];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.style.transition = 'background 0.5s';
        target.style.background = 'var(--accent-mid)';
        setTimeout(() => { target.style.background = ''; }, 1500);
      }
    }, 80);
  }

  function _toggleSidebar() {
    const sb = $('#waraiSidebar');
    if (sb) sb.classList.toggle('is-open');
  }

  function _wire() {
    const search = $('#waraiSearch');
    if (search) search.addEventListener('input', e => _onSearch(e.target.value));
    const rand = $('#waraiRandom');
    if (rand) rand.addEventListener('click', _randomPoem);
    const toggle = $('#waraiSidebarToggle');
    if (toggle) toggle.addEventListener('click', _toggleSidebar);
  }

  async function init() {
    try {
      await _load();
      _wire();
      _render();
    } catch (err) {
      console.error('[poetry-warai]', err);
      const main = $('#waraiList');
      if (main) main.innerHTML = `<div class="poetry-empty">Falha ao carregar.<br>${_esc(err.message)}</div>`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
