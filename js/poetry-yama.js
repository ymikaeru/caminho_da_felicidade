/**
 * poetry-yama.js — leitor de "Yama to Mizu" (山と水).
 *
 * Carrega data/poetry/yama_to_mizu.json, mostra sidebar com as 256 seções,
 * renderiza poema-a-poema da seção selecionada, ou modo "todos" em scroll.
 * Suporta busca textual nos campos original/reading/translation.
 */
(function () {
  'use strict';

  const DATA_URL = 'data/poetry/yama_to_mizu.json';
  let _data = null;
  let _sections = [];
  let _activeSectionIdx = null;   // null = preface + tudo agrupado
  let _query = '';
  let _showPreface = true;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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
    const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return t.replace(new RegExp(safeQ, 'gi'), m => `<mark>${m}</mark>`);
  }

  async function _load() {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error('Falha ao carregar poesia: ' + res.status);
    _data = await res.json();
    _sections = _data.sections || [];
  }

  function _matchesQuery(p) {
    if (!_query) return true;
    const q = _query.toLowerCase();
    return (
      (p.original || '').toLowerCase().includes(q) ||
      (p.reading || '').toLowerCase().includes(q) ||
      (p.translation || '').toLowerCase().includes(q) ||
      (p.title || '').toLowerCase().includes(q)
    );
  }

  function _renderSidebar() {
    const list = $('#yamaSectionList');
    if (!list) return;
    const allBtn = `
      <button class="poetry-filter-btn ${_activeSectionIdx === null ? 'is-active' : ''}" data-idx="-1">
        <span class="lang-pt">Todas as seções</span>
        <span class="lang-ja" style="display:none">全題目</span>
        <span class="poetry-filter-btn__count">${_sections.length}</span>
      </button>
    `;
    const items = _sections.map((s, i) => `
      <button class="poetry-filter-btn ${_activeSectionIdx === i ? 'is-active' : ''}" data-idx="${i}">
        <span class="poetry-filter-btn__jp">${_esc(s.title_jp)}</span>
        <span class="poetry-filter-btn__count">${s.poems.length}</span>
      </button>
    `).join('');
    list.innerHTML = allBtn + items;
    list.querySelectorAll('.poetry-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        _activeSectionIdx = idx < 0 ? null : idx;
        _render();
        // Mobile: fecha sidebar após clicar
        const sb = $('#yamaSidebar');
        if (sb) sb.classList.remove('is-open');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // Stats
    const total = _sections.reduce((acc, s) => acc + s.poems.length, 0);
    const statsEl = $('#yamaStats');
    if (statsEl) {
      statsEl.innerHTML = `
        <strong>${total.toLocaleString('pt-BR')}</strong>
        <span class="lang-pt"> tanka em ${_sections.length} seções</span>
        <span class="lang-ja" style="display:none"> 首・${_sections.length} 題目</span>
      `;
    }
  }

  function _renderPreface() {
    const pf = _data.preface || {};
    const body = (pf.content_pt || []).map(line => `<p>${_esc(line)}</p>`).join('');
    return `
      <article class="poetry-preface" aria-label="Prefácio">
        <h2 class="poetry-preface__title">${_esc(pf.title_jp || 'はしがき')}</h2>
        <div class="poetry-preface__pt-title">${_esc(pf.title_pt || 'Prefácio')}</div>
        <div class="poetry-preface__body">${body}</div>
      </article>
    `;
  }

  function _renderPoem(p, sectionTitle) {
    const num = p.number != null ? String(p.number).padStart(3, '0') : '';
    const title = p.title ? `<span class="poetry-card__title">${_highlight(p.title, _query)}</span>` : '';
    const reading = p.reading ? `<div class="poetry-card__reading">${_highlight(p.reading, _query)}</div>` : '';
    return `
      <article class="poetry-card">
        <div class="poetry-card__head">
          <span class="poetry-card__num">№ ${_esc(num)}</span>
          ${title}
        </div>
        <div class="poetry-card__original">${_highlight(p.original, _query)}</div>
        ${reading}
        ${p.translation ? `<div class="poetry-card__translation">${_highlight(p.translation, _query)}</div>` : ''}
      </article>
    `;
  }

  function _renderSection(sec) {
    const filtered = sec.poems.filter(_matchesQuery);
    if (filtered.length === 0) return '';
    return `
      <header class="poetry-section-heading">
        <div class="poetry-section-heading__kicker">
          <span class="lang-pt">Seção</span><span class="lang-ja" style="display:none">題目</span>
        </div>
        <h2 class="poetry-section-heading__title">${_esc(sec.title_jp)}</h2>
        <div class="poetry-section-heading__pt">${_esc(sec.title_pt)}</div>
        <div class="poetry-section-heading__rule"></div>
      </header>
      <div class="poetry-list">
        ${filtered.map(p => _renderPoem(p, sec.title_pt)).join('')}
      </div>
    `;
  }

  function _render() {
    const main = $('#yamaList');
    if (!main) return;
    // Re-render sidebar to sync active
    _renderSidebar();

    let html = '';
    if (_activeSectionIdx === null) {
      if (_showPreface && !_query) html += _renderPreface();
      const allRendered = _sections.map(s => _renderSection(s)).filter(Boolean).join('');
      if (allRendered) {
        html += allRendered;
      } else if (_query) {
        html += `<div class="poetry-empty"><span class="lang-pt">Nenhum poema encontrado para "${_esc(_query)}"</span><span class="lang-ja" style="display:none">該当する歌はありません</span></div>`;
      }
    } else {
      const sec = _sections[_activeSectionIdx];
      const rendered = _renderSection(sec);
      if (rendered) {
        html += rendered;
      } else {
        html += `<div class="poetry-empty"><span class="lang-pt">Nenhum poema desta seção corresponde à busca.</span><span class="lang-ja" style="display:none">該当する歌はありません</span></div>`;
      }
    }

    main.innerHTML = html;

    // Re-aplica lang após render
    const lang = localStorage.getItem('site_lang') || 'pt';
    if (typeof setLanguage === 'function') setLanguage(lang, false);
  }

  function _onSearch(value) {
    _query = (value || '').trim();
    _render();
  }

  function _randomPoem() {
    const flat = [];
    _sections.forEach((s, i) => s.poems.forEach((p, j) => flat.push({ p, sectionIdx: i, poemIdx: j })));
    if (flat.length === 0) return;
    const pick = flat[Math.floor(Math.random() * flat.length)];
    _activeSectionIdx = pick.sectionIdx;
    _showPreface = false;
    _render();
    // Scroll to that poem
    setTimeout(() => {
      const cards = document.querySelectorAll('#yamaList .poetry-card');
      const target = cards[pick.poemIdx];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.style.transition = 'background 0.5s';
        target.style.background = 'var(--accent-mid)';
        setTimeout(() => { target.style.background = ''; }, 1500);
      }
    }, 80);
  }

  function _toggleSidebar() {
    const sb = $('#yamaSidebar');
    if (sb) sb.classList.toggle('is-open');
  }

  function _wire() {
    const search = $('#yamaSearch');
    if (search) search.addEventListener('input', e => _onSearch(e.target.value));
    const rand = $('#yamaRandom');
    if (rand) rand.addEventListener('click', _randomPoem);
    const toggle = $('#yamaSidebarToggle');
    if (toggle) toggle.addEventListener('click', _toggleSidebar);
  }

  async function init() {
    try {
      await _load();
      _wire();
      _render();
    } catch (err) {
      console.error('[poetry-yama]', err);
      const main = $('#yamaList');
      if (main) main.innerHTML = `<div class="poetry-empty">Falha ao carregar a coletânea. <br>${_esc(err.message)}</div>`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
