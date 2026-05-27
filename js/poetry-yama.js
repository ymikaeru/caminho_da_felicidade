/**
 * poetry-yama.js — leitor de "Yama to Mizu" (山と水).
 *
 * Carrega data/poetry/yama_to_mizu.json, mostra sidebar com as 256 seções,
 * renderiza poema-a-poema da seção selecionada, ou modo "todos" em scroll.
 * Suporta busca textual nos campos original/reading/translation.
 */
(function () {
  'use strict';

  const STORAGE_PATH       = 'poetry/yama-to-mizu.json';
  const DATA_URL_FALLBACK  = 'data/poetry/yama_to_mizu.json';
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

  // Aguarda window.supabaseStorageFetch ficar disponível (ESM module pode carregar
  // depois deste script defer). Timeout suave de 3s; cai pro fetch local se falhar.
  async function _waitForStorage(timeoutMs) {
    const start = Date.now();
    while (!window.supabaseStorageFetch) {
      if (Date.now() - start > timeoutMs) return null;
      await new Promise(r => setTimeout(r, 50));
    }
    return window.supabaseStorageFetch;
  }

  async function _load() {
    const fetcher = await _waitForStorage(3000);
    if (fetcher) {
      try {
        _data = await fetcher(STORAGE_PATH);
        _sections = _data.sections || [];
        return;
      } catch (err) {
        console.warn('[poetry-yama] Storage failed, falling back to local JSON:', err.message);
      }
    }
    const res = await fetch(DATA_URL_FALLBACK);
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
      <button class="poetry-filter-btn ${_activeSectionIdx === i ? 'is-active' : ''}" data-idx="${i}" title="${_esc(s.title_jp)} — ${_esc(s.title_pt)}">
        <span class="poetry-filter-btn__main">
          <span class="lang-pt">${_esc(s.title_pt || s.title_jp)}</span>
          <span class="lang-ja poetry-filter-btn__jp" style="display:none">${_esc(s.title_jp)}</span>
        </span>
        <span class="poetry-filter-btn__count">${s.poems.length}</span>
      </button>
    `).join('');
    list.innerHTML = allBtn + items;
    list.querySelectorAll('.poetry-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        _activeSectionIdx = idx < 0 ? null : idx;
        _render();
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
    const topicId = `yama_n${p.number}`;
    const hlBtn = window._poetryHighlights ? window._poetryHighlights.renderCardButton() : '';
    return `
      <article class="poetry-card" data-poem-topic-id="${_esc(topicId)}" data-poem-index="${p.number}">
        <div class="poetry-card__head">
          <span class="poetry-card__num">№ ${_esc(num)}</span>
          ${title}
          ${hlBtn}
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
        <h2 class="poetry-section-heading__title">
          <span class="lang-pt">${_esc(sec.title_pt || sec.title_jp)}</span>
          <span class="lang-ja" style="display:none">${_esc(sec.title_jp)}</span>
        </h2>
        <div class="poetry-section-heading__pt">
          <span class="lang-pt">${_esc(sec.title_jp)}</span>
          <span class="lang-ja" style="display:none">${_esc(sec.title_pt)}</span>
        </div>
        <div class="poetry-section-heading__rule"></div>
      </header>
      <div class="poetry-list">
        ${filtered.map(p => _renderPoem(p, sec.title_pt)).join('')}
      </div>
    `;
  }

  // Chips de seção ativa — feedback visual claro de qual seção foi escolhida.
  // No mobile, sticky logo abaixo do header (a sidebar é bottom-sheet e some
  // ao fechar, então o usuário precisa de um indicador persistente). × limpa.
  function _renderActiveFilterChips() {
    const container = $('#yamaActiveFilters');
    if (!container) return;
    if (_activeSectionIdx === null) {
      container.classList.remove('is-active');
      container.innerHTML = '';
      return;
    }
    const sec = _sections[_activeSectionIdx];
    if (!sec) return;
    const labelPt = sec.title_pt || sec.title_jp || '';
    const labelJp = sec.title_jp || '';
    container.classList.add('is-active');
    container.innerHTML = `
      <button type="button" class="poetry-chip" data-clear="section"
              aria-label="Remover seção: ${_esc(labelPt)}">
        <span class="poetry-chip__x" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <line x1="4" y1="4" x2="12" y2="12"/>
            <line x1="12" y1="4" x2="4" y2="12"/>
          </svg>
        </span>
        <span class="poetry-chip__kicker">
          <span class="lang-pt">Seção</span>
          <span class="lang-ja" style="display:none">題目</span>
        </span>
        <span class="poetry-chip__label">
          <span class="lang-pt">${_esc(labelPt)}</span>
          <span class="lang-ja" style="display:none">${_esc(labelJp)}</span>
        </span>
        <span class="poetry-chip__count">${sec.poems.length}</span>
      </button>
    `;
    container.querySelector('.poetry-chip').addEventListener('click', () => {
      _activeSectionIdx = null;
      _render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function _render() {
    const main = $('#yamaList');
    if (!main) return;
    // Re-render sidebar to sync active
    _renderSidebar();
    _renderActiveFilterChips();

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

    // Re-aplica visual dos destaques de poemas (borda + comentário) — o
    // _render() reescreve innerHTML, então precisamos rehidratar a cada vez.
    if (window._poetryHighlights) {
      window._poetryHighlights.applyToCards('yama-to-mizu', '#yamaList .poetry-card');
    }
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

  function _findPoemLocation(topicId) {
    // topicId pattern: yama_n{number}
    const m = String(topicId || '').match(/^yama_n(\d+)$/);
    if (!m) return null;
    const number = parseInt(m[1], 10);
    for (let i = 0; i < _sections.length; i++) {
      const arr = _sections[i].poems;
      for (let j = 0; j < arr.length; j++) {
        if (arr[j].number === number) return { sectionIdx: i, poemIdx: j, poem: arr[j], section: _sections[i] };
      }
    }
    return null;
  }

  function _scrollToPoemCard(topicId, flash) {
    const card = document.querySelector(`#yamaList .poetry-card[data-poem-topic-id="${topicId}"]`);
    if (!card) return false;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (flash) {
      card.style.transition = 'background 0.5s';
      card.style.background = 'var(--accent-mid)';
      setTimeout(() => { card.style.background = ''; }, 1800);
    }
    return true;
  }

  function _wire() {
    const search = $('#yamaSearch');
    if (search) search.addEventListener('input', e => _onSearch(e.target.value));
    const rand = $('#yamaRandom');
    if (rand) rand.addEventListener('click', _randomPoem);
    const toggle = $('#yamaSidebarToggle');
    if (toggle) toggle.addEventListener('click', _toggleSidebar);

    if (window._poetryHighlights) {
      const list = $('#yamaList');
      if (list) {
        window._poetryHighlights.wireCardButtons({
          container: list,
          file: 'yama-to-mizu',
          getMeta: (topicId, cardEl) => {
            const loc = _findPoemLocation(topicId);
            if (!loc) return null;
            const sectionTitle = loc.section.title_pt || loc.section.title_jp || '';
            const num = String(loc.poem.number).padStart(3, '0');
            return {
              topicIndex: loc.poem.number,
              topicTitle: `${sectionTitle} · № ${num}`,
              text: (loc.poem.original || '') + (loc.poem.translation ? '\n' + loc.poem.translation : '')
            };
          },
          onChange: () => {
            window._poetryHighlights.applyToCards('yama-to-mizu', '#yamaList .poetry-card');
          }
        });
      }
    }
  }

  async function init() {
    try {
      await _load();
      _wire();
      // Deep-link: ?poem=yama_n123&hl_scroll=1
      const params = new URLSearchParams(window.location.search);
      const poemParam = params.get('poem');
      if (poemParam) {
        const loc = _findPoemLocation(poemParam);
        if (loc) {
          _activeSectionIdx = loc.sectionIdx;
          _showPreface = false;
        }
      }
      _render();
      if (poemParam) {
        setTimeout(() => {
          window._poetryHighlights?.applyToCards('yama-to-mizu', '#yamaList .poetry-card');
          _scrollToPoemCard(poemParam, params.get('hl_scroll') === '1');
        }, 200);
      }
      // pullCloudToLocal() roda async no login.js — re-aplica depois de 1.2s
      // pra cobrir destaques criados em outro device que chegaram tarde.
      setTimeout(() => {
        window._poetryHighlights?.applyToCards('yama-to-mizu', '#yamaList .poetry-card');
      }, 1200);
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
