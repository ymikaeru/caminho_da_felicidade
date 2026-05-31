/**
 * poetry-warai.js — leitor de "Warai no Izumi" (笑の泉).
 *
 * Carrega data/poetry/warai_no_izumi.json. A coleção tem 24 títulos
 * temáticos (空財布, ウツフ, ケチンボウ...) que viram filtros na sidebar.
 * Paginação em batches pra não despejar 1.063 cards de uma vez.
 */
(function () {
  'use strict';

  const DATA_URL = 'data/poetry/warai_no_izumi.json?v=5';
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

  // "阿　呆" (Aho, "o tolo") é o único pseudônimo do próprio Meishu-Sama
  // — os demais pseudônimos são discípulos do Círculo de Kanku que ele coordenava.
  const MEISHU_PENNAME = '阿　呆';

  let _data = null;
  let _poems = [];
  let _byTheme = new Map();    // title -> [poem]
  let _activeTheme = null;     // null = all
  let _query = '';
  let _visible = PAGE_SIZE;
  let _showPreface = true;
  let _meishuOnly = false;     // filtro "só pseudônimo de Meishu-Sama (阿　呆)"
  let _meishuCount = 0;        // qtd de poemas de 阿　呆, calculada no load

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
    _data = await res.json();
    _poems = _data.poems;

    _byTheme = new Map();
    _meishuCount = 0;
    for (const p of _poems) {
      const t = p.title || '(sem título)';
      if (!_byTheme.has(t)) _byTheme.set(t, []);
      _byTheme.get(t).push(p);
      if (p.author_penname === MEISHU_PENNAME) _meishuCount++;
    }
  }

  function _renderPreface() {
    const pf = (_data && _data.preface) || {};
    const ed = (_data && _data.edition) || {};
    const ptBody = (pf.content_pt || []).map(l => `<p>${_esc(l)}</p>`).join('');
    const jpBody = (pf.content_jp || []).map(l => `<p>${_esc(l)}</p>`).join('');

    // Linha de edição: data, contagem, atribuição da coletânea (御歌集) e
    // selecionador (選者) sob pseudônimo — sem forçar identidades.
    const allTranslated = ed.translated_here === ed.total_in_original;
    const countPt = allTranslated
      ? `${ed.total_in_original} versos`
      : `${ed.total_in_original} versos no original · ${ed.translated_here} traduzidos aqui`;
    const countJp = allTranslated
      ? `全${ed.total_in_original}首`
      : `全${ed.total_in_original}首・本サイト訳出${ed.translated_here}首`;
    const attrPt = ed.attribution_pt ? `${_esc(ed.attribution_pt)} · ` : '';
    const attrJp = ed.attribution_jp ? `${_esc(ed.attribution_jp)}・` : '';
    const editionLine = (ed.publication_date_pt && ed.total_in_original)
      ? `
        <div class="poetry-preface__edition">
          <div class="poetry-preface__edition-line">
            <span class="lang-pt">${attrPt}Publicado em ${_esc(ed.publication_date_pt)} · ${countPt}</span>
            <span class="lang-ja" style="display:none">${attrJp}${_esc(ed.publication_date_jp)}発行・${countJp}</span>
          </div>
          <div class="poetry-preface__edition-line">
            <span class="lang-pt">${_esc(ed.compiler_label_pt || 'Selecionador')}: ${_esc(ed.compiler_romaji || '')} (${_esc(ed.compiler_jp || '')})</span>
            <span class="lang-ja" style="display:none">選者 ${_esc(ed.compiler_jp || '')}</span>
          </div>
        </div>`
      : '';

    const subtitleLine = (ed.subtitle_jp || ed.subtitle_pt)
      ? `
        <div class="poetry-preface__pt-title">
          <span class="lang-pt">${_esc(ed.subtitle_pt || ed.subtitle_jp)}</span>
          <span class="lang-ja" style="display:none">${_esc(ed.subtitle_jp || '')}</span>
        </div>`
      : '';

    return `
      <article class="poetry-preface" aria-label="Prefácio">
        <h2 class="poetry-preface__title">${_esc(pf.title_jp || 'はしがき')}</h2>
        <div class="poetry-preface__pt-title">
          <span class="lang-pt">${_esc(pf.title_pt || 'Prefácio')}</span>
          <span class="lang-ja" style="display:none">${_esc(pf.title_jp || 'はしがき')}</span>
        </div>
        ${subtitleLine}
        <div class="poetry-preface__body">
          <div class="lang-pt">${ptBody}</div>
          <div class="lang-ja" style="display:none">${jpBody}</div>
        </div>
        ${editionLine}
      </article>
    `;
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
    if (_meishuOnly) base = base.filter(p => p.author_penname === MEISHU_PENNAME);
    if (_query) base = base.filter(_matchesQuery);
    return base;
  }

  // Filtro de autor "Por Akegarasu Aho" — renderizado abaixo da busca, separado
  // dos temas pra deixar claro que é um filtro (toggle composável) e não um tema
  // (seleção mutualmente exclusiva). Akegarasu Aho (明烏阿呆) é o pseudônimo
  // poético de Meishu-Sama no Círculo de Kanku; "阿　呆" (Aho) é a forma curta
  // usada dentro dos versos.
  function _renderAuthorFilter() {
    const container = $('#waraiAuthorFilter');
    if (!container) return;
    // Mantém o label existente (já está no HTML) e injeta só o toggle.
    const existing = container.querySelector('.poetry-filter-toggle');
    const html = `
      <button type="button"
              class="poetry-filter-toggle ${_meishuOnly ? 'is-active' : ''}"
              id="waraiMeishuToggle"
              role="switch"
              aria-checked="${_meishuOnly ? 'true' : 'false'}"
              title="Akegarasu Aho (明烏阿呆) — pseudônimo poético de Meishu-Sama no Círculo de Kanku; '阿　呆' (Aho) é a forma curta usada nos versos">
        <span class="poetry-filter-toggle__box" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <polyline points="3.5 8.5 6.5 11.5 12.5 5"/>
          </svg>
        </span>
        <span class="poetry-filter-toggle__label">
          <span class="lang-pt">Por Akegarasu Aho</span>
          <span class="lang-ja poetry-filter-btn__jp" style="display:none">明烏阿呆の句</span>
        </span>
        <span class="poetry-filter-toggle__count">${_meishuCount}</span>
      </button>
    `;
    if (existing) {
      existing.outerHTML = html;
    } else {
      container.insertAdjacentHTML('beforeend', html);
    }
    const toggle = $('#waraiMeishuToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        _meishuOnly = !_meishuOnly;
        _visible = PAGE_SIZE;
        _render();
        const sb = $('#waraiSidebar');
        if (sb) sb.classList.remove('is-open');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }

  function _renderSidebar() {
    _renderAuthorFilter();

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

  // Marcamos o pseudônimo de Meishu-Sama com modificador no card para
  // diferenciá-lo sutilmente dos pseudônimos dos discípulos.
  function _renderPoem(p) {
    const num = p.num != null ? String(p.num).padStart(4, '0') : '';
    let penname = '';
    if (p.author_penname) {
      const isMeishu = p.author_penname === MEISHU_PENNAME;
      const cls = isMeishu ? 'poetry-card__tag poetry-card__tag--meishu' : 'poetry-card__tag';
      const tip = isMeishu ? ' title="Forma curta de Akegarasu Aho (明烏阿呆) — pseudônimo poético de Meishu-Sama, selecionador (選者) da coletânea"' : '';
      penname = `<span class="${cls}"${tip}>${_esc(p.author_penname)}</span>`;
    }
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
        ${p.reading ? `<div class="poetry-card__reading lang-pt">${_highlight(p.reading, _query)}</div>` : ''}
        ${p.translation_pt ? `<div class="poetry-card__translation lang-pt">${_highlight(p.translation_pt, _query)}</div>` : ''}
      </article>
    `;
  }

  // Chips de filtros ativos — feedback visual claro de qual tema/filtro está
  // aplicado. Sticky logo abaixo do header no mobile (a sidebar é bottom-sheet
  // e some quando fecha, então o usuário precisa de um indicador persistente).
  // No desktop também aparece, inline acima da lista. Clique no × limpa.
  function _renderActiveFilterChips() {
    const container = $('#waraiActiveFilters');
    if (!container) return;
    const chips = [];
    if (_meishuOnly) {
      chips.push({
        kind: 'meishu',
        labelPt: 'Por Akegarasu Aho',
        labelJp: '明烏阿呆',
        kickerPt: 'Filtro',
        kickerJp: '絞り込み',
        count: _meishuCount
      });
    }
    if (_activeTheme) {
      const g = _gloss(_activeTheme);
      const ptCap = g.pt ? g.pt.charAt(0).toUpperCase() + g.pt.slice(1) : g.romaji;
      chips.push({
        kind: 'theme',
        labelPt: ptCap,
        labelJp: _activeTheme,
        kickerPt: 'Tema',
        kickerJp: '題',
        count: (_byTheme.get(_activeTheme) || []).length
      });
    }

    if (chips.length === 0) {
      container.classList.remove('is-active');
      container.innerHTML = '';
      return;
    }

    container.classList.add('is-active');
    container.innerHTML = chips.map(c => `
      <button type="button" class="poetry-chip" data-clear="${c.kind}"
              aria-label="Remover ${_esc(c.kickerPt)}: ${_esc(c.labelPt)}">
        <span class="poetry-chip__x" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <line x1="4" y1="4" x2="12" y2="12"/>
            <line x1="12" y1="4" x2="4" y2="12"/>
          </svg>
        </span>
        <span class="poetry-chip__kicker">
          <span class="lang-pt">${_esc(c.kickerPt)}</span>
          <span class="lang-ja" style="display:none">${_esc(c.kickerJp)}</span>
        </span>
        <span class="poetry-chip__label">
          <span class="lang-pt">${_esc(c.labelPt)}</span>
          <span class="lang-ja" style="display:none">${_esc(c.labelJp)}</span>
        </span>
        <span class="poetry-chip__count">${c.count}</span>
      </button>
    `).join('');

    container.querySelectorAll('.poetry-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const kind = chip.dataset.clear;
        if (kind === 'meishu') _meishuOnly = false;
        else if (kind === 'theme') _activeTheme = null;
        _visible = PAGE_SIZE;
        _render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  function _render() {
    const main = $('#waraiList');
    if (!main) return;
    _renderSidebar();
    _renderActiveFilterChips();

    const list = _currentList();
    if (list.length === 0) {
      main.innerHTML = `<div class="poetry-empty"><span class="lang-pt">Nenhum verso encontrado.</span><span class="lang-ja" style="display:none">該当する句はありません</span></div>`;
      return;
    }

    const slice = list.slice(0, _visible);
    let html = '';

    // Prefácio: só na visão "todos os temas" e sem busca ativa.
    if (_showPreface && !_activeTheme && !_query && !_meishuOnly) {
      html += _renderPreface();
    }

    // Header "Por Akegarasu Aho" (quando filtro de autor está ativo e sem tema).
    if (_meishuOnly && !_activeTheme) {
      html += `
        <header class="poetry-section-heading">
          <div class="poetry-section-heading__kicker">
            <span class="lang-pt">Por autor</span><span class="lang-ja" style="display:none">作者</span>
          </div>
          <h2 class="poetry-section-heading__title">
            <span class="lang-pt">Akegarasu Aho (明烏阿呆)</span>
            <span class="lang-ja" style="display:none">明烏阿呆（あけがらす あほう）</span>
          </h2>
          <div class="poetry-section-heading__pt">
            <span class="lang-pt">${list.length} versos sob o pseudônimo poético de Meishu-Sama no Círculo de Kanku — assinados nos cards como "阿　呆" (Aho, forma curta)</span>
            <span class="lang-ja" style="display:none">明主様が明烏阿呆の名で詠まれた ${list.length} 句（句中の署名は「阿　呆」）</span>
          </div>
          <div class="poetry-section-heading__rule"></div>
        </header>
      `;
    }

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
    _showPreface = false;
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
          _showPreface = false;
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
