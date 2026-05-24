/**
 * poetry-akimaro.js — leitor de "Akimaro Kin'eishū" (明麿近詠集).
 *
 * Carrega data/poetry/akimaro_kineishu.json. 99 tanka publicados em 1949,
 * agrupados em 6 seções temáticas (Estações, Caminho/Reflexão, Kannon/Luz,
 * Era do Dia, Tamagawa/Arte, Ise/Hakone). Estrutura JSON espelha yama_to_mizu.
 */
(function () {
  'use strict';

  const STORAGE_PATH = 'poetry/akimaro-kineishu.json';
  const DATA_URL_FALLBACK = 'data/poetry/akimaro_kineishu.json';
  // 486 poemas no total — paginamos quando o filtro é "todas as seções"
  // pra não despejar tudo de uma vez. Selecionar uma seção continua
  // renderizando ela inteira (são <50 poemas em todas).
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
        console.warn('[poetry-akimaro] Storage failed, falling back to local JSON:', err.message);
      }
    }
    const res = await fetch(DATA_URL_FALLBACK);
    if (!res.ok) throw new Error('Falha ao carregar poesia: ' + res.status);
    _data = await res.json();
    _sections = _data.sections || [];
  }

  function _matchesQuery(p) {
    if (!_query) return true;
    const q = _query.toLowerCase().trim();
    // Query só-dígitos (ex: "1", "001", "486") → match exato por número,
    // ignorando leading zeros. "1" acha №001 sem puxar 10, 100, 110...
    if (/^\d+$/.test(q)) return p.number === parseInt(q, 10);
    return (
      (p.original || '').toLowerCase().includes(q) ||
      (p.reading || '').toLowerCase().includes(q) ||
      (p.translation || '').toLowerCase().includes(q) ||
      (p.title || '').toLowerCase().includes(q)
    );
  }

  function _renderSidebar() {
    const list = $('#akimaroSectionList');
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
        _visibleAll = PAGE_SIZE;
        _render();
        const sb = $('#akimaroSidebar');
        if (sb) sb.classList.remove('is-open');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    const total = _sections.reduce((acc, s) => acc + s.poems.length, 0);
    const translated = _sections.reduce(
      (acc, s) => acc + s.poems.filter(p => !p.translation_pending).length, 0);
    const statsEl = $('#akimaroStats');
    if (statsEl) {
      statsEl.innerHTML = `
        <strong>${total.toLocaleString('pt-BR')}</strong>
        <span class="lang-pt"> tanka · ${translated} traduzidos · ${_sections.length} seções</span>
        <span class="lang-ja" style="display:none"> 首・訳済${translated}首・${_sections.length} 題目</span>
      `;
    }
  }

  function _renderPreface() {
    const pf = _data.preface || {};
    const ed = _data.edition || {};
    const ptBody = (pf.content_pt || []).map(l => `<p>${_esc(l)}</p>`).join('');
    const jpBody = (pf.content_jp || []).map(l => `<p>${_esc(l)}</p>`).join('');
    const allTranslated = ed.translated_here === ed.total_in_original;
    const countPt = allTranslated
      ? `${ed.total_in_original} poemas`
      : `${ed.total_in_original} poemas no original · ${ed.translated_here} traduzidos aqui`;
    const countJp = allTranslated
      ? `全${ed.total_in_original}首`
      : `全${ed.total_in_original}首・本サイト訳出${ed.translated_here}首`;
    const editionLine = (ed.publication_date_pt && ed.total_in_original)
      ? `
        <div class="poetry-preface__edition">
          <div class="poetry-preface__edition-line">
            <span class="lang-pt">Publicado em ${_esc(ed.publication_date_pt)} · ${countPt}</span>
            <span class="lang-ja" style="display:none">${_esc(ed.publication_date_jp)}発行・${countJp}</span>
          </div>
          <div class="poetry-preface__edition-line">
            <span class="lang-pt">Pseudônimo poético de Meishu-Sama: ${_esc(ed.author_romaji)} (${_esc(ed.author_jp)})</span>
            <span class="lang-ja" style="display:none">明主様の雅号 ${_esc(ed.author_jp)}</span>
          </div>
        </div>`
      : '';
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

  // "S11. 1. 1" → "1 jan 1936"; "S15. 5.**" → "maio 1940"
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
    const dateTag = dateStr ? `<span class="poetry-card__tag" title="${_esc(p.date)}">${_esc(dateStr)}</span>` : '';
    const pendingTag = pending
      ? `<span class="poetry-card__tag poetry-card__tag--pending" title="Aguardando tradução"><span class="lang-pt">tradução pendente</span><span class="lang-ja" style="display:none">未訳</span></span>`
      : '';
    const topicId = `akimaro_n${p.number}`;
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
          ${pendingTag}
          ${hlBtn}
        </div>
        <div class="poetry-card__original">${_highlight(p.original, _query)}</div>
        ${reading}
        ${transBlock}
      </article>
    `;
  }

  function _renderSectionHeading(sec) {
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
    `;
  }

  function _renderSection(sec) {
    const filtered = sec.poems.filter(_matchesQuery);
    if (filtered.length === 0) return '';
    return _renderSectionHeading(sec) + `
      <div class="poetry-list">
        ${filtered.map(p => _renderPoem(p)).join('')}
      </div>
    `;
  }

  // Renderiza "todas as seções" com paginação por poema, atravessando
  // as seções na ordem (insere o heading da seção quando atinge o
  // primeiro poema dela dentro da janela visível).
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
        if (count >= _visibleAll) { exhausted = false; continue; }
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
          <button class="btn-poetry-loadmore" id="akimaroLoadMore" type="button">
            <span class="lang-pt">Mostrar mais (${remaining})</span>
            <span class="lang-ja" style="display:none">もっと見る（${remaining}）</span>
          </button>
        </div>
      `;
    }
    return { html, anyMatch: totalMatched > 0 };
  }

  function _render() {
    const main = $('#akimaroList');
    if (!main) return;
    _renderSidebar();

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

    const loadMore = $('#akimaroLoadMore');
    if (loadMore) {
      loadMore.addEventListener('click', () => {
        _visibleAll += PAGE_SIZE;
        _render();
      });
    }

    const lang = localStorage.getItem('site_lang') || 'pt';
    if (typeof setLanguage === 'function') setLanguage(lang, false);

    if (window._poetryHighlights) {
      window._poetryHighlights.applyToCards('akimaro-kineishu', '#akimaroList .poetry-card');
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
      const cards = document.querySelectorAll('#akimaroList .poetry-card');
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
    const sb = $('#akimaroSidebar');
    if (sb) sb.classList.toggle('is-open');
  }

  function _findPoemLocation(topicId) {
    const m = String(topicId || '').match(/^akimaro_n(\d+)$/);
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
    const card = document.querySelector(`#akimaroList .poetry-card[data-poem-topic-id="${topicId}"]`);
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
    const search = $('#akimaroSearch');
    if (search) search.addEventListener('input', e => _onSearch(e.target.value));
    const rand = $('#akimaroRandom');
    if (rand) rand.addEventListener('click', _randomPoem);
    const toggle = $('#akimaroSidebarToggle');
    if (toggle) toggle.addEventListener('click', _toggleSidebar);

    if (window._poetryHighlights) {
      const list = $('#akimaroList');
      if (list) {
        window._poetryHighlights.wireCardButtons({
          container: list,
          file: 'akimaro-kineishu',
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
            window._poetryHighlights.applyToCards('akimaro-kineishu', '#akimaroList .poetry-card');
          }
        });
      }
    }
  }

  async function init() {
    try {
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
          window._poetryHighlights?.applyToCards('akimaro-kineishu', '#akimaroList .poetry-card');
          _scrollToPoemCard(poemParam, params.get('hl_scroll') === '1');
        }, 200);
      }
      setTimeout(() => {
        window._poetryHighlights?.applyToCards('akimaro-kineishu', '#akimaroList .poetry-card');
      }, 1200);
    } catch (err) {
      console.error('[poetry-akimaro]', err);
      const main = $('#akimaroList');
      if (main) main.innerHTML = `<div class="poetry-empty">Falha ao carregar a coletânea. <br>${_esc(err.message)}</div>`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
