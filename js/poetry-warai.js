/**
 * poetry-warai.js — leitor de "Warai no Izumi" (笑いの泉).
 *
 * Carrega data/poetry/warai_no_izumi.json. A coleção tem 24 títulos
 * temáticos (空財布, ウツフ, ケチンボウ...) que viram filtros na sidebar.
 * Paginação em batches pra não despejar 1.063 cards de uma vez.
 */
(function () {
  'use strict';

  const DATA_URL = 'data/poetry/warai_no_izumi.json?v=4';
  const PAGE_SIZE = 60;

  // Romanização + glosa em PT-BR para os 24 títulos temáticos.
  // Mantemos o nome japonês em romaji (sem traduzir nomes próprios/onomatopeias)
  // e oferecemos uma glosa curta como apoio de leitura.
  const THEME_GLOSS = {
    '空財布':            { romaji: 'Kara-saifu',         pt: 'carteira vazia' },
    'ウツフ':            { romaji: 'Utsufu',             pt: 'risadinha' },
    'なさけない':        { romaji: 'Nasakenai',          pt: 'lamentável' },
    '無精者':            { romaji: 'Bushōmono',          pt: 'preguiçoso' },
    'アンボンタン':      { romaji: 'Anpontan',           pt: 'tonto' },
    '泡くつて':          { romaji: 'Awakutte',           pt: 'em pânico' },
    '笑わせやがらア':    { romaji: 'Warawase-yagara',    pt: 'me faz rir, ora!' },
    'ケチンボウ':        { romaji: 'Kechinbō',           pt: 'pão-duro' },
    'ケツの穴':          { romaji: 'Ketsu-no-ana',       pt: 'fiofó' },
    'びくびくと':        { romaji: 'Bikubiku-to',        pt: 'tremendo de medo' },
    'ワシヤツライ':      { romaji: 'Washi ya tsurai',    pt: 'pra mim é duro' },
    '此野郎':            { romaji: 'Kono-yarō',          pt: 'seu desgraçado' },
    '変な奴':            { romaji: 'Henna-yatsu',        pt: 'sujeito estranho' },
    'ずるい奴':          { romaji: 'Zurui-yatsu',        pt: 'sujeito malandro' },
    'そそつかしい':      { romaji: 'Sosokkashii',        pt: 'atrapalhado' },
    '朴念人':            { romaji: 'Bokunenjin',         pt: 'cabeça-dura' },
    'コソコソと':        { romaji: 'Kosokoso-to',        pt: 'às escondidas' },
    'チヱツ':            { romaji: 'Chetsu',             pt: 'tch!' },
    '助けてくれー':      { romaji: 'Tasukete-kurē',      pt: 'socorro!' },
    'ペツチヤンコ':      { romaji: 'Pecchanko',          pt: 'esmagado' },
    'お豪〔偉〕う厶（ござ）いますよ': { romaji: 'O-erau gozaimasu yo', pt: 'que magnífico!' },
    'テツヘツヘツヽヽ':  { romaji: 'Tetsu-hetsu-hetsu',  pt: 'he he he' },
    'コン畜生':          { romaji: 'Kono-chikushō',      pt: 'maldito!' },
    'ダー':              { romaji: 'Dā',                 pt: 'ah!' },
  };
  const _gloss = (jp) => THEME_GLOSS[jp] || { romaji: jp, pt: '' };

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
    const items = themes.map(([t, arr]) => {
      const g = _gloss(t);
      const ptCap = g.pt ? g.pt.charAt(0).toUpperCase() + g.pt.slice(1) : g.romaji;
      return `
      <button class="poetry-filter-btn ${_activeTheme === t ? 'is-active' : ''}" data-theme="${_esc(t)}" title="${_esc(t)} — ${_esc(g.romaji)}">
        <span class="poetry-filter-btn__main">
          <span class="lang-pt">${_esc(ptCap)}</span>
          <span class="lang-ja poetry-filter-btn__jp" style="display:none">${_esc(t)}</span>
        </span>
        <span class="poetry-filter-btn__count">${arr.length}</span>
      </button>
    `;}).join('');
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
    let titleHtml = '';
    if (p.title) {
      const g = _gloss(p.title);
      const ptCap = g.pt ? g.pt.charAt(0).toUpperCase() + g.pt.slice(1) : g.romaji;
      titleHtml = `<span class="poetry-card__title" title="${_esc(p.title)} — ${_esc(g.romaji)}">
        <span class="lang-pt">${_highlight(ptCap, _query)}</span>
        <span class="lang-ja" style="display:none">${_highlight(p.title, _query)}</span>
      </span>`;
    }
    const topicId = p.id || `waraino_${num}`;
    const hlBtn = window._poetryHighlights ? window._poetryHighlights.renderCardButton() : '';
    return `
      <article class="poetry-card" data-poem-topic-id="${_esc(topicId)}" data-poem-index="${p.num}">
        <div class="poetry-card__head">
          <span class="poetry-card__num">№ ${_esc(num)}</span>
          ${titleHtml}
          ${penname}
          ${hlBtn}
        </div>
        <div class="poetry-card__original">${_highlight(p.original, _query)}</div>
        ${p.reading ? `<div class="poetry-card__reading">${_highlight(p.reading, _query)}</div>` : ''}
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
      const g = _gloss(_activeTheme);
      const ptCap = g.pt ? g.pt.charAt(0).toUpperCase() + g.pt.slice(1) : g.romaji;
      html += `
        <header class="poetry-section-heading">
          <div class="poetry-section-heading__kicker">
            <span class="lang-pt">Tema</span><span class="lang-ja" style="display:none">題</span>
          </div>
          <h2 class="poetry-section-heading__title">
            <span class="lang-pt">${_esc(ptCap)}</span>
            <span class="lang-ja" style="display:none">${_esc(_activeTheme)}</span>
          </h2>
          <div class="poetry-section-heading__pt">
            <span class="lang-pt">${_esc(g.romaji)} · ${list.length} versos sobre este tema</span>
            <span class="lang-ja" style="display:none">${_esc(_activeTheme)} · ${list.length} 句</span>
          </div>
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

    // Reaplica destaques de poemas (borda + comentário) após cada render
    if (window._poetryHighlights) {
      window._poetryHighlights.applyToCards('warai-no-izumi', '#waraiList .poetry-card');
    }
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

  function _findPoem(topicId) {
    return _poems.find(p => (p.id || `waraino_${String(p.num).padStart(4, '0')}`) === topicId) || null;
  }

  function _scrollToPoemCard(topicId, flash) {
    const card = document.querySelector(`#waraiList .poetry-card[data-poem-topic-id="${topicId}"]`);
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
    const search = $('#waraiSearch');
    if (search) search.addEventListener('input', e => _onSearch(e.target.value));
    const rand = $('#waraiRandom');
    if (rand) rand.addEventListener('click', _randomPoem);
    const toggle = $('#waraiSidebarToggle');
    if (toggle) toggle.addEventListener('click', _toggleSidebar);

    if (window._poetryHighlights) {
      const list = $('#waraiList');
      if (list) {
        window._poetryHighlights.wireCardButtons({
          container: list,
          file: 'warai-no-izumi',
          getMeta: (topicId) => {
            const p = _findPoem(topicId);
            if (!p) return null;
            const g = _gloss(p.title || '');
            const ptCap = g.pt ? g.pt.charAt(0).toUpperCase() + g.pt.slice(1) : g.romaji;
            const num = String(p.num).padStart(4, '0');
            const tema = ptCap || p.title || '';
            return {
              topicIndex: p.num,
              topicTitle: tema ? `${tema} · № ${num}` : `№ ${num}`,
              text: (p.original || '') + (p.translation_pt ? '\n' + p.translation_pt : '')
            };
          },
          onChange: () => {
            window._poetryHighlights.applyToCards('warai-no-izumi', '#waraiList .poetry-card');
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
        const p = _findPoem(poemParam);
        if (p) {
          _activeTheme = p.title || null;
          const list = _currentList();
          const idx = list.indexOf(p);
          if (idx >= 0 && idx >= _visible) {
            _visible = Math.ceil((idx + 1) / PAGE_SIZE) * PAGE_SIZE;
          }
        }
      }
      _render();
      if (poemParam) {
        setTimeout(() => {
          window._poetryHighlights?.applyToCards('warai-no-izumi', '#waraiList .poetry-card');
          _scrollToPoemCard(poemParam, params.get('hl_scroll') === '1');
        }, 200);
      }
      setTimeout(() => {
        window._poetryHighlights?.applyToCards('warai-no-izumi', '#waraiList .poetry-card');
      }, 1200);
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
