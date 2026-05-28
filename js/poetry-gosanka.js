/**
 * poetry-gosanka.js — leitor compartilhado das 3 coletâneas de 御讃歌:
 *   shoban    = 御讃歌集（初版）       — 309 poemas (1948)
 *   kaitei    = 御讃歌集（改訂版）     — 462 poemas (1951-1954)
 *   shikiten  = 各式典における御讃歌  — 564 poemas (1936-1954)
 *
 * Espera `window.POETRY_KEY` definido na HTML shell antes deste script.
 * Mesma lógica e CSS do poetry-akimaro.js, parametrizado por coleção.
 */
(function () {
  'use strict';

  // ─── Registry das 3 coleções ─────────────────────────────────
  const COLLECTIONS = {
    shoban: {
      key: 'shoban',
      file: 'gosanka-shoban',
      storagePath: 'poetry/gosanka-shoban.json',
      dataPath: 'data/poetry/gosanka_shoban.json',
      kicker_pt: 'Tanka · 309 poemas',
      kicker_jp: '短歌・309首',
      title_jp: '御讃歌集（初版）',
      subtitle_pt: 'Gosanka-shū (Primeira Edição)',
      subtitle_jp: 'ごさんかしゅう しょはん',
    },
    kaitei: {
      key: 'kaitei',
      file: 'gosanka-kaitei',
      storagePath: 'poetry/gosanka-kaitei.json',
      dataPath: 'data/poetry/gosanka_kaitei.json',
      kicker_pt: 'Tanka · 462 poemas',
      kicker_jp: '短歌・462首',
      title_jp: '御讃歌集（改訂版）',
      subtitle_pt: 'Gosanka-shū (Edição Revisada)',
      subtitle_jp: 'ごさんかしゅう かいていばん',
    },
    shikiten: {
      key: 'shikiten',
      file: 'gosanka-shikiten',
      storagePath: 'poetry/gosanka-shikiten.json',
      dataPath: 'data/poetry/gosanka_shikiten.json',
      kicker_pt: 'Tanka · 564 poemas',
      kicker_jp: '短歌・564首',
      title_jp: '各式典における御讃歌',
      subtitle_pt: 'Cantos Sagrados para Cada Cerimônia',
      subtitle_jp: 'かくしきてんにおけるごさんか',
    },
  };

  const KEY = window.POETRY_KEY;
  const CFG = COLLECTIONS[KEY];
  if (!CFG) {
    console.error('[poetry-gosanka] window.POETRY_KEY inválido ou ausente:', KEY);
    return;
  }

  const PAGE_SIZE = 100;
  let _data = null;
  let _sections = [];
  let _activeSectionIdx = null;
  let _query = '';
  let _showPreface = true;
  let _visibleAll = PAGE_SIZE;

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
    const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return t.replace(new RegExp(safeQ, 'gi'), (m) => `<mark>${m}</mark>`);
  }

  // ─── Shell injection ─────────────────────────────────────────
  // Injeta a estrutura .poetry-page (sidebar + main) no #poetry-root.
  // Roda síncrono no início do init(), antes do _load assíncrono, pra
  // que revealPage() já encontre o loading spinner em vez de div vazia.
  function _injectShell() {
    const root = $('#poetry-root');
    if (!root) {
      console.error('[poetry-gosanka] #poetry-root não encontrado');
      return false;
    }
    root.innerHTML = `
      <div class="poetry-page">
        <aside class="poetry-sidebar" id="poetrySidebar" aria-label="Navegação por seção">
          <a href="poesia.html" class="poetry-sidebar__back">
            <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            <span class="lang-pt">Obras poéticas</span>
            <span class="lang-ja" style="display:none">詩集一覧</span>
          </a>
          <div class="poetry-sidebar__header">
            <span class="poetry-sidebar__kicker">
              <span class="lang-pt">${_esc(CFG.kicker_pt)}</span>
              <span class="lang-ja" style="display:none">${_esc(CFG.kicker_jp)}</span>
            </span>
            <h2 class="poetry-sidebar__title">${_esc(CFG.title_jp)}</h2>
            <div class="poetry-sidebar__subtitle">
              <span class="lang-pt">${_esc(CFG.subtitle_pt)}</span>
              <span class="lang-ja" style="display:none">${_esc(CFG.subtitle_jp)}</span>
            </div>
          </div>

          <div class="poetry-sidebar__action">
            <button class="btn-poetry-random" id="poetryRandom" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="16 3 21 3 21 8"/>
                <line x1="4" y1="20" x2="21" y2="3"/>
                <polyline points="21 16 21 21 16 21"/>
                <line x1="15" y1="15" x2="21" y2="21"/>
              </svg>
              <span class="lang-pt">Poema aleatório</span>
              <span class="lang-ja" style="display:none">おみくじ</span>
            </button>
          </div>

          <div class="poetry-sidebar__search">
            <div class="poetry-searchbox">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="search" id="poetrySearch" placeholder="Buscar poema..." aria-label="Buscar poemas">
            </div>
          </div>

          <div class="poetry-sidebar__section">
            <div class="poetry-sidebar__label">
              <span class="lang-pt">Seções</span><span class="lang-ja" style="display:none">題 目</span>
            </div>
            <div class="poetry-filter-list" id="poetrySectionList"></div>
          </div>

          <div class="poetry-sidebar__stats" id="poetryStats">—</div>
        </aside>

        <section class="poetry-main">
          <button class="poetry-sidebar-toggle" id="poetrySidebarToggle" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
            <span class="lang-pt">Seções</span>
            <span class="lang-ja" style="display:none">題 目</span>
          </button>

          <div class="poetry-active-filters" id="poetryActiveFilters" aria-live="polite"></div>

          <div id="poetryList">
            <div class="poetry-loading">
              <div class="poetry-loading__spinner"></div>
              <span class="lang-pt">Carregando…</span>
              <span class="lang-ja" style="display:none">読み込み中…</span>
            </div>
          </div>
        </section>
      </div>
    `;
    return true;
  }

  // ─── Storage load (com fallback local) ───────────────────────
  async function _waitForStorage(timeoutMs) {
    const start = Date.now();
    while (!window.supabaseStorageFetch) {
      if (Date.now() - start > timeoutMs) return null;
      await new Promise((r) => setTimeout(r, 50));
    }
    return window.supabaseStorageFetch;
  }

  async function _load() {
    const fetcher = await _waitForStorage(3000);
    if (fetcher) {
      try {
        _data = await fetcher(CFG.storagePath);
        _sections = _data.sections || [];
        return;
      } catch (err) {
        console.warn('[poetry-gosanka] Storage falhou, fallback local:', err.message);
      }
    }
    const res = await fetch(CFG.dataPath);
    if (!res.ok) throw new Error('Falha ao carregar poesia: ' + res.status);
    _data = await res.json();
    _sections = _data.sections || [];
  }

  // ─── Filtro de busca ────────────────────────────────────────
  function _matchesQuery(p) {
    if (!_query) return true;
    const q = _query.toLowerCase().trim();
    if (/^\d+$/.test(q)) return p.number === parseInt(q, 10);
    return (
      (p.original || '').toLowerCase().includes(q) ||
      (p.reading || '').toLowerCase().includes(q) ||
      (p.reading_hira || '').toLowerCase().includes(q) ||
      (p.translation || '').toLowerCase().includes(q) ||
      (p.title || '').toLowerCase().includes(q)
    );
  }

  // ─── Sidebar (lista de seções + stats) ──────────────────────
  function _renderSidebar() {
    const list = $('#poetrySectionList');
    if (!list) return;
    const allBtn = `
      <button class="poetry-filter-btn ${_activeSectionIdx === null ? 'is-active' : ''}" data-idx="-1">
        <span class="lang-pt">Todas as seções</span>
        <span class="lang-ja" style="display:none">全題目</span>
        <span class="poetry-filter-btn__count">${_sections.length}</span>
      </button>
    `;
    const items = _sections
      .map((s, i) => {
        const ptLabel = s.title_pt || s.title_jp;
        const jpLabel = s.title_jp;
        return `
      <button class="poetry-filter-btn ${_activeSectionIdx === i ? 'is-active' : ''}" data-idx="${i}" title="${_esc(s.title_jp)} — ${_esc(s.title_pt || s.title_jp)}">
        <span class="poetry-filter-btn__main">
          <span class="lang-pt">${_esc(ptLabel)}</span>
          <span class="lang-ja poetry-filter-btn__jp" style="display:none">${_esc(jpLabel)}</span>
        </span>
        <span class="poetry-filter-btn__count">${s.poems.length}</span>
      </button>
    `;
      })
      .join('');
    list.innerHTML = allBtn + items;
    list.querySelectorAll('.poetry-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        _activeSectionIdx = idx < 0 ? null : idx;
        _visibleAll = PAGE_SIZE;
        _render();
        const sb = $('#poetrySidebar');
        if (sb) sb.classList.remove('is-open');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    const total = _sections.reduce((acc, s) => acc + s.poems.length, 0);
    const translated = _sections.reduce(
      (acc, s) => acc + s.poems.filter((p) => !p.translation_pending && p.translation).length,
      0,
    );
    const statsEl = $('#poetryStats');
    if (statsEl) {
      statsEl.innerHTML = `
        <strong>${total.toLocaleString('pt-BR')}</strong>
        <span class="lang-pt"> tanka · ${translated} traduzidos · ${_sections.length} seções</span>
        <span class="lang-ja" style="display:none"> 首・訳済${translated}首・${_sections.length} 題目</span>
      `;
    }
  }

  // ─── Preface ────────────────────────────────────────────────
  function _renderPreface() {
    const pf = _data.preface || {};
    const ed = _data.edition || {};
    const ptBody = (pf.content_pt || []).map((l) => `<p>${_esc(l)}</p>`).join('');
    const jpBody = (pf.content_jp || []).map((l) => `<p>${_esc(l)}</p>`).join('');
    const allTranslated = ed.translated_here === ed.total_in_original;
    const countPt = allTranslated
      ? `${ed.total_in_original} poemas`
      : `${ed.total_in_original} poemas no original · ${ed.translated_here} traduzidos aqui`;
    const countJp = allTranslated
      ? `全${ed.total_in_original}首`
      : `全${ed.total_in_original}首・本サイト訳出${ed.translated_here}首`;
    const editionLine =
      ed.publication_date_pt && ed.total_in_original
        ? `
        <div class="poetry-preface__edition">
          <div class="poetry-preface__edition-line">
            <span class="lang-pt">Publicado em ${_esc(ed.publication_date_pt)} · ${countPt}</span>
            <span class="lang-ja" style="display:none">${_esc(ed.publication_date_jp || '')}発行・${countJp}</span>
          </div>
          ${
            ed.author_romaji
              ? `
          <div class="poetry-preface__edition-line">
            <span class="lang-pt">Autor: ${_esc(ed.author_romaji)} (${_esc(ed.author_jp || '')})</span>
            <span class="lang-ja" style="display:none">著者 ${_esc(ed.author_jp || '')}</span>
          </div>`
              : ''
          }
        </div>`
        : '';
    // Se preface não tiver conteúdo, não renderiza
    if (!ptBody && !jpBody && !editionLine) return '';
    return `
      <article class="poetry-preface" aria-label="Prefácio">
        <h2 class="poetry-preface__title">${_esc(pf.title_jp || '序　文')}</h2>
        <div class="poetry-preface__pt-title">
          <span class="lang-pt">${_esc(pf.title_pt || 'Prefácio')}</span>
          <span class="lang-ja" style="display:none">${_esc(pf.title_jp || '序　文')}</span>
        </div>
        <div class="poetry-preface__body">
          <div class="lang-pt">${ptBody}</div>
          <div class="lang-ja" style="display:none">${jpBody}</div>
        </div>
        ${editionLine}
      </article>
    `;
  }

  // ─── Date formatters (mantidos do akimaro pra compatibilidade) ──
  function _formatDate(s) {
    if (!s) return '';
    const m = s.match(/^S(\d+)\.\s*(\d+)\.\s*(\d+|\*+)$/);
    if (!m) return s;
    const year = 1925 + parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = m[3];
    const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const mo = months[month - 1] || '';
    if (/^\d+$/.test(day)) return `${parseInt(day, 10)} ${mo} ${year}`;
    return `${mo} ${year}`;
  }
  function _formatDateCompact(s) {
    if (!s) return '';
    const m = s.match(/^S(\d+)\.\s*(\d+)\.\s*(\d+|\*+)$/);
    if (!m) return s;
    const yy = String((1925 + parseInt(m[1], 10)) % 100).padStart(2, '0');
    const mm = String(parseInt(m[2], 10)).padStart(2, '0');
    const day = m[3];
    if (/^\d+$/.test(day)) {
      const dd = String(parseInt(day, 10)).padStart(2, '0');
      return `${dd}/${mm}/${yy}`;
    }
    return `${mm}/${yy}`;
  }

  // ─── Poem card ──────────────────────────────────────────────
  function _renderPoem(p) {
    const num = p.number != null ? String(p.number).padStart(3, '0') : '';
    const pending = !!p.translation_pending;
    const title = p.title
      ? `<span class="poetry-card__title">${_highlight(p.title, _query)}</span>`
      : '';
    const reading = p.reading
      ? `<div class="poetry-card__reading">${_highlight(p.reading, _query)}</div>`
      : '';
    const dateStr = _formatDate(p.date);
    const dateStrCompact = _formatDateCompact(p.date);
    const dateTag = dateStr
      ? `<span class="poetry-card__tag" title="${_esc(p.date)}"><span class="poetry-card__tag-full">${_esc(dateStr)}</span><span class="poetry-card__tag-compact">${_esc(dateStrCompact)}</span></span>`
      : '';
    // Marker chip (kaitei): * = modificação da 1ª ed, ** = re-publicação
    const markerTag = p.marker
      ? `<span class="poetry-card__tag" title="${p.marker === '**' ? 'Re-publicação da 1ª edição' : 'Modificação da 1ª edição'}"><span class="poetry-card__tag-full">${p.marker === '**' ? '** repub.' : '* mod.'}</span><span class="poetry-card__tag-compact">${_esc(p.marker)}</span></span>`
      : '';
    const pendingTag = pending
      ? `<span class="poetry-card__tag poetry-card__tag--pending" title="Aguardando tradução"><span class="lang-pt">tradução pendente</span><span class="lang-ja" style="display:none">未訳</span></span>`
      : '';
    const topicId = `${CFG.key}_n${p.number}`;
    const hlBtn = (window._poetryHighlights && !pending) ? window._poetryHighlights.renderCardButton() : '';
    const transBlock = p.translation
      ? `<div class="poetry-card__translation">${_highlight(p.translation, _query)}</div>`
      : '';
    return `
      <article class="poetry-card${pending ? ' poetry-card--pending' : ''}" data-poem-topic-id="${_esc(topicId)}" data-poem-index="${p.number}">
        <div class="poetry-card__head">
          <span class="poetry-card__num">№ ${_esc(num)}</span>
          ${title}
          ${dateTag}
          ${markerTag}
          ${pendingTag}
          ${hlBtn}
        </div>
        <div class="poetry-card__original">${_highlight(p.original, _query)}</div>
        ${reading}
        ${transBlock}
      </article>
    `;
  }

  // ─── Section heading ────────────────────────────────────────
  // Para shikiten, exibe data + fonte como sub-linha (year_iso vira ano gregoriano)
  function _renderSectionHeading(sec) {
    const subtitle = sec.subtitle_jp ? `<div class="poetry-section-heading__sub">${_esc(sec.subtitle_jp)}</div>` : '';
    const dateLine = (sec.date_jp || sec.source_jp)
      ? `<div class="poetry-section-heading__date">
          ${sec.date_jp ? `<span>${_esc(sec.date_jp)}${sec.year_iso ? ` <span style="opacity:.6">(${sec.year_iso})</span>` : ''}</span>` : ''}
          ${sec.source_jp ? `<span class="poetry-section-heading__source">— ${_esc(sec.source_jp)}</span>` : ''}
        </div>`
      : '';
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
          <span class="lang-ja" style="display:none">${_esc(sec.title_pt || sec.title_jp)}</span>
        </div>
        ${subtitle}
        ${dateLine}
        <div class="poetry-section-heading__rule"></div>
      </header>
    `;
  }

  function _renderSection(sec) {
    const filtered = sec.poems.filter(_matchesQuery);
    if (filtered.length === 0) return '';
    return (
      _renderSectionHeading(sec) +
      `<div class="poetry-list">${filtered.map((p) => _renderPoem(p)).join('')}</div>`
    );
  }

  function _renderAllPaginated() {
    let count = 0;
    let html = '';
    let exhausted = true;
    let totalMatched = 0;
    for (const sec of _sections) {
      const filtered = sec.poems.filter(_matchesQuery);
      if (filtered.length === 0) continue;
      let headerEmitted = false;
      for (const p of filtered) {
        totalMatched++;
        if (count >= _visibleAll) {
          exhausted = false;
          continue;
        }
        if (!headerEmitted) {
          html += _renderSectionHeading(sec);
          headerEmitted = true;
        }
        html += _renderPoem(p);
        count++;
      }
    }
    if (!exhausted) {
      const remaining = totalMatched - count;
      html += `
        <div class="poetry-loadmore">
          <button class="btn-poetry-loadmore" id="poetryLoadMore" type="button">
            <span class="lang-pt">Mostrar mais (${remaining})</span>
            <span class="lang-ja" style="display:none">もっと見る（${remaining}）</span>
          </button>
        </div>
      `;
    }
    return { html, anyMatch: totalMatched > 0 };
  }

  function _renderActiveFilterChips() {
    const container = $('#poetryActiveFilters');
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
      _visibleAll = PAGE_SIZE;
      _render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function _render() {
    const main = $('#poetryList');
    if (!main) return;
    _renderSidebar();
    _renderActiveFilterChips();

    let html = '';
    if (_activeSectionIdx === null) {
      if (_showPreface && !_query) html += _renderPreface();
      const { html: allHtml, anyMatch } = _renderAllPaginated();
      if (anyMatch) {
        html += allHtml;
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

    const loadMore = $('#poetryLoadMore');
    if (loadMore) {
      loadMore.addEventListener('click', () => {
        _visibleAll += PAGE_SIZE;
        _render();
      });
    }

    const lang = localStorage.getItem('site_lang') || 'pt';
    if (typeof setLanguage === 'function') setLanguage(lang, false);

    if (window._poetryHighlights) {
      window._poetryHighlights.applyToCards(CFG.file, '#poetryList .poetry-card');
    }
  }

  function _onSearch(value) {
    _query = (value || '').trim();
    _visibleAll = PAGE_SIZE;
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
    setTimeout(() => {
      const cards = document.querySelectorAll('#poetryList .poetry-card');
      const target = cards[pick.poemIdx];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.style.transition = 'background 0.5s';
        target.style.background = 'var(--accent-mid)';
        setTimeout(() => {
          target.style.background = '';
        }, 1500);
      }
    }, 80);
  }

  function _toggleSidebar() {
    const sb = $('#poetrySidebar');
    if (sb) sb.classList.toggle('is-open');
  }

  function _findPoemLocation(topicId) {
    const re = new RegExp(`^${CFG.key}_n(\\d+)$`);
    const m = String(topicId || '').match(re);
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
    const card = document.querySelector(`#poetryList .poetry-card[data-poem-topic-id="${topicId}"]`);
    if (!card) return false;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (flash) {
      card.style.transition = 'background 0.5s';
      card.style.background = 'var(--accent-mid)';
      setTimeout(() => {
        card.style.background = '';
      }, 1800);
    }
    return true;
  }

  function _wire() {
    const search = $('#poetrySearch');
    if (search) search.addEventListener('input', (e) => _onSearch(e.target.value));
    const rand = $('#poetryRandom');
    if (rand) rand.addEventListener('click', _randomPoem);
    const toggle = $('#poetrySidebarToggle');
    if (toggle) toggle.addEventListener('click', _toggleSidebar);

    if (window._poetryHighlights) {
      const list = $('#poetryList');
      if (list) {
        window._poetryHighlights.wireCardButtons({
          container: list,
          file: CFG.file,
          getMeta: (topicId, cardEl) => {
            const loc = _findPoemLocation(topicId);
            if (!loc) return null;
            const sectionTitle = loc.section.title_pt || loc.section.title_jp || '';
            const num = String(loc.poem.number).padStart(3, '0');
            return {
              topicIndex: loc.poem.number,
              topicTitle: `${sectionTitle} · № ${num}`,
              text: (loc.poem.original || '') + (loc.poem.translation ? '\n' + loc.poem.translation : ''),
            };
          },
          onChange: () => {
            window._poetryHighlights.applyToCards(CFG.file, '#poetryList .poetry-card');
          },
        });
      }
    }
  }

  async function init() {
    try {
      if (!_injectShell()) return;
      await _load();
      _wire();
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
          window._poetryHighlights?.applyToCards(CFG.file, '#poetryList .poetry-card');
          _scrollToPoemCard(poemParam, params.get('hl_scroll') === '1');
        }, 200);
      }
      setTimeout(() => {
        window._poetryHighlights?.applyToCards(CFG.file, '#poetryList .poetry-card');
      }, 1200);
    } catch (err) {
      console.error('[poetry-gosanka]', err);
      const main = $('#poetryList');
      if (main) main.innerHTML = `<div class="poetry-empty">Falha ao carregar a coletânea. <br>${_esc(err.message)}</div>`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
