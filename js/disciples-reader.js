// ============================================================
// DISCIPLES READER — Publicações de Discípulos (Keigyou + Ashita no Ijitsu)
// Portado de new_mioshie_zenshu com adaptações para o CdF:
//  - container: #readerContainer (não #readerContent)
//  - sidebar: #readerSidebar (adicionado via reader.html)
//  - fetch: window.supabaseStorageFetch (fallback via js/storage.js)
//  - markdown: window.marked.parse (carregado via js/marked.min.js)
// ============================================================

(function () {
  'use strict';

  // ── Flag global para o reader.js tradicional detectar e se afastar ──
  const urlParams = new URLSearchParams(window.location.search);
  const isDisciplesMode = urlParams.get('pub') === 'disciples';
  window._disciplesMode = isDisciplesMode;
  if (!isDisciplesMode) return;
  // Mark body so CSS can apply disciples-mode layout (sidebar, padding)
  // Default: desktop abre a sidebar (TOC do livro), mobile inicia fechada
  // pra dar foco no texto. Preferência do usuário (toggle manual) persiste.
  const _initialCollapsed = (() => {
    try {
      const saved = localStorage.getItem('disciples_sidebar_collapsed');
      if (saved === '1') return true;
      if (saved === '0') return false;
      // Sem preferência salva: mobile = collapsed, desktop = aberto
      return window.matchMedia('(max-width: 900px)').matches;
    } catch (_) { return false; }
  })();
  const _markBody = () => {
    document.body.classList.add('disciples-active');
    if (_initialCollapsed) document.body.classList.add('disciples-sidebar-collapsed');
  };
  if (document.body) _markBody();
  else document.addEventListener('DOMContentLoaded', _markBody);

  // ── State ──
  let _disciplesIndex = null;
  let _currentDisciplesBook = null;
  let _flatChapters = [];
  let _currentChapterIndex = 0;
  let _discScrollLock = false;
  let _discRestoring = false;

  // ── Utilities ──
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function setBackButton(target) {
    const lang = localStorage.getItem('site_lang') || 'pt';
    const isPt = lang !== 'ja';
    const href = target === 'books' ? 'reader.html?pub=disciples' : 'index.html';
    const labelPt = target === 'books' ? 'Obras' : 'Início';
    const labelJa = target === 'books' ? '作品一覧' : 'ホーム';

    const btn = document.getElementById('backToIndexBtn');
    if (btn) {
      btn.href = href;
      const pt = btn.querySelector('.lang-pt');
      const ja = btn.querySelector('.lang-ja');
      if (pt) pt.textContent = target === 'books' ? 'Obras' : 'Início';
      if (ja) ja.textContent = target === 'books' ? '作品一覧' : 'ホーム';
      btn.style.display = 'flex';
    }
  }

  // Marca o body com `disciples-overview-mode` quando estamos na lista
  // de obras (sem capítulo carregado). CSS em _disciples.css usa essa
  // classe pra esconder controles do reader (A-/A+/Aa/Índice/Destaques)
  // que só fazem sentido lendo capítulo. Funciona mesmo quando os botões
  // são injetados depois (initMobileSidebarToggle usa rAF), porque é
  // aplicado via CSS na hora do paint.
  function _setOverviewMode(isOverview) {
    document.body.classList.toggle('disciples-overview-mode', !!isOverview);
  }

  function renderMd(md) {
    if (!md) return '';
    if (typeof marked !== 'undefined' && marked.parse) return marked.parse(md);
    return String(md).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                     .replace(/\*([^*]+)\*/g, '<em>$1</em>')
                     .replace(/\n\n/g, '</p><p>');
  }

  // ── Ensinamento estruturado (apostila Shin Dendō) ──
  // Notas: marcadores [^n] no texto viram chips com o texto da nota no hover.
  function discRenderNotas(text, notas) {
    const m = {}; (notas || []).forEach(x => { m[x.n] = x.texto; });
    return esc(text || '')
      .replace(/\[\^(\d+)\]/g, (_, n) =>
        `<sup class="ens-fn" tabindex="0" title="${esc(m[n] || '')}">${n}</sup>`)
      .replace(/\n{2,}/g, '<br><br>')   // gaps de parágrafo (texto preserva \n\n; HTML colapsaria)
      .replace(/\n/g, '<br>');
  }
  function discBlock(cls, summary, html) {
    return `<details class="${cls}" open><summary>${summary}</summary><div class="ens-db">${html}</div></details>`;
  }
  function discExpBlock(html, notas) {
    return discBlock('ens-exp', '解説 · Comentário do editor — Explicação', discRenderNotas(html, notas));
  }
  function renderEnsinamento(e) {
    if (!e) return '';
    const verso = e.tipo === 'salmo' ? ' ens-verso' : '';
    let h = '';
    if (e.fonte) h += `<div class="ens-fonte">📜 ${esc(e.fonte)}</div>`;
    if (e.preambulo) h += discBlock('ens-pre', '▸ Contexto anterior — Trecho do Preâmbulo', discRenderNotas(e.preambulo, e.notas));
    if (e.texto) h += `<div class="ens-texto${verso}">${discRenderNotas(e.texto, e.notas)}</div>`;
    if (e.data) h += `<div class="ens-data">— ${esc(e.data)}</div>`;
    if (e.posfacio) h += discBlock('ens-pre', '▸ Trecho do Posfácio', discRenderNotas(e.posfacio, e.notas));
    if (e.resumo) h += discBlock('ens-resumo', 'Resumo', discRenderNotas(e.resumo, e.notas));
    if (Array.isArray(e.referencias) && e.referencias.length) {
      h += `<div class="ens-refs">` + e.referencias.map((r, i) =>
        (i === 0 && /:\s*$/.test(r)) ? `<div class="ens-refs-h">${esc(r)}</div>` : `<div class="ens-ref">${esc(r)}</div>`
      ).join('') + `</div>`;
    }
    if (e.explicacao) h += discExpBlock(e.explicacao, e.notas);
    if (Array.isArray(e.anexo) && e.anexo.length) {
      h += e.anexo.map(a => discBlock('ens-anexo', '➕ ' + esc(a.titulo || 'Anexo'),
        discRenderNotas(a.texto, e.notas).replace(/\n/g, '<br>'))).join('');
    }
    if (e.tipo === 'jp-pendente') h += `<div class="ens-jp-flag">⚠ trecho em japonês — tradução pendente</div>`;
    return h;
  }

  // ── Fetch helpers ──
  async function fetchBookJson(filename) {
    // DEV: em localhost lê direto de data/books/ (sem auth/Supabase) — revisar
    // rascunhos local, logado ou não, sempre a versão mais recente. Produção: Storage.
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '') {
      try {
        const r = await fetch(`data/books/${filename}`, { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch (_) { /* cai pro fluxo normal abaixo */ }
    }
    if (!window.supabaseStorageFetch) throw new Error('Authentication required');
    return window.supabaseStorageFetch(`books/${filename}`);
  }

  // ── Chapter flattening & persistence ──
  // Pagina por "parent-of-leaves" com 3 casos:
  // (a) Nó tem filhos diretos com content → vira página agrupando os
  //     filhos. Ex: "3. Servindo ao Grande Mestre" mostra os 11
  //     tópicos seguidos numa página.
  // (b) Nó tem content próprio MAS nenhum descendente com content
  //     → folha pura, vira página individual. Ex: "Prefácio".
  // (c) Nó tem content próprio E descendentes mais fundos com content
  //     → emite página só com a intro do nó (children zerados), depois
  //     desce nos filhos pra cada um virar sua própria página. Evita
  //     que a intro do Cap 2 absorva 7 subcapítulos numa página única.
  function flattenDiscChapters(sections) {
    const hasContentDeep = (nodes) => {
      for (const n of nodes) {
        if (n.content && String(n.content).trim()) return true;
        if (n.children && n.children.length && hasContentDeep(n.children)) return true;
      }
      return false;
    };
    const pages = [];
    const walk = (node, ancestors) => {
      const children = node.children || [];
      const hasOwn = !!(node.content && String(node.content).trim());
      const hasContentChild = children.some(c => c.content && String(c.content).trim());

      if (hasContentChild) {
        // (a) Agrupa filhos junto.
        pages.push(Object.assign({}, node, { _ancestors: ancestors.slice() }));
        return;
      }
      if (hasOwn) {
        const deeperContent = children.length && hasContentDeep(children);
        if (!deeperContent) {
          // (b) Folha pura.
          pages.push(Object.assign({}, node, { _ancestors: ancestors.slice() }));
          return;
        }
        // (c) Intro própria + desce.
        pages.push(Object.assign({}, node, { _ancestors: ancestors.slice(), children: [] }));
        for (const c of children) walk(c, ancestors.concat([node]));
        return;
      }
      // Wrapper puro — desce.
      for (const c of children) walk(c, ancestors.concat([node]));
    };
    for (const s of sections) walk(s, []);
    if (pages.length === 0) return sections.slice();
    return pages;
  }

  // Apostila Shin Dendō: paginação por ITEM (cada Item = uma página rolável com
  // toda a sua subárvore de Ensinamentos), + a intro do Capítulo (explicação)
  // como página própria. A árvore lateral navega pra qualquer Ensinamento dentro.
  function flattenApostila(sections) {
    const pages = [];
    for (const cap of sections) {
      if (cap.ensinamento || cap.explicacao || cap.subtitulo) {
        pages.push(Object.assign({}, cap, { children: [], _ancestors: [] }));
      }
      for (const item of (cap.children || [])) {
        pages.push(Object.assign({}, item, { _ancestors: [cap] }));
      }
    }
    return pages.length ? pages : sections.slice();
  }

  function flattenForBook(bookId, sections) {
    return bookId === 'shin-dendo-tebiki'
      ? flattenApostila(sections)
      : flattenDiscChapters(sections);
  }

  function saveDiscChapterPos(bookId, idx) {
    const existing = (() => {
      try { return JSON.parse(localStorage.getItem(`book_pos_${bookId}`) || '{}'); } catch { return {}; }
    })();
    const update = { chapter: idx, ts: Date.now() };
    if (existing.chapter === idx) {
      if (existing.section) update.section = existing.section;
      if (existing.sectionTitle) update.sectionTitle = existing.sectionTitle;
      if (typeof existing.scrollY === 'number') update.scrollY = existing.scrollY;
    }
    localStorage.setItem(`book_pos_${bookId}`, JSON.stringify(update));
  }

  function loadDiscChapterPos(bookId) {
    try {
      const saved = localStorage.getItem(`book_pos_${bookId}`);
      if (!saved) return 0;
      const pos = JSON.parse(saved);
      return typeof pos.chapter === 'number' ? pos.chapter : 0;
    } catch { return 0; }
  }

  function navigateToChapter(index) {
    if (!_currentDisciplesBook || !_flatChapters.length) return;
    if (index < 0 || index >= _flatChapters.length) return;
    _currentChapterIndex = index;
    saveDiscChapterPos(_currentDisciplesBook.id, index);
    syncDiscReadingPosition();
    renderCurrentDiscChapter();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateDiscSidebarActiveState();
  }

  // Push current chapter index → reading_positions (admin progress view)
  function syncDiscReadingPosition() {
    if (!_currentDisciplesBook || !_flatChapters.length) return;
    const fn = window._cloudSync?.saveReadingPosition;
    if (typeof fn !== 'function') return;
    try {
      fn('disciples', _currentDisciplesBook.id, _currentChapterIndex, _flatChapters.length)
        ?.catch?.(() => {});
    } catch (_) {}
  }

  function goToChapter(sectionId) {
    const idx = _flatChapters.findIndex(ch => ch.id === sectionId.replace('sec-', ''));
    if (idx !== -1) navigateToChapter(idx);
  }

  // ── Person biography collapsing ──
  function addPersonNameIds(renderedHtml, originalMd) {
    const namePattern = /\*\*([^*]+?)\*\*\s*\(/g;
    let m, html = renderedHtml;
    const seen = new Set();
    while ((m = namePattern.exec(originalMd)) !== null) {
      const name = m[1].trim().split(/\s*\(/)[0].trim();
      if (name && name.length > 2 && !seen.has(name)) {
        seen.add(name);
        const personId = `person-${name.toLowerCase().replace(/[^a-zA-ZÀ-ÿ\s-]/g, '').replace(/\s+/g, '-').slice(0, 50)}`;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const strongPattern = new RegExp(`<strong>${escaped}<\\/strong>`, 'g');
        if (strongPattern.test(html)) {
          html = html.replace(strongPattern, `<strong id="${personId}">${name}</strong>`);
        }
      }
    }
    return html;
  }

  function makePersonParagraphsCollapsible(html) {
    const personPattern = /<p>(?:<em>)?<strong id="person-([^"]+)">([^<]+)<\/strong>\s*\(/gi;
    let result = html;
    let m;
    const replacements = [];
    while ((m = personPattern.exec(html)) !== null) {
      const personId = m[1];
      const name = m[2];
      const fullMatch = m[0];
      const startIdx = m.index;
      const endPIdx = result.indexOf('</p>', startIdx + fullMatch.length);
      if (endPIdx === -1) continue;
      const fullP = result.substring(startIdx, endPIdx + 4);
      const after = fullP.substring(fullMatch.length);
      replacements.push({
        start: startIdx,
        end: endPIdx + 4,
        html: `<details class="person-card" id="person-card-${personId}"><summary class="person-card-summary"><strong id="${personId}">${name}</strong><span class="person-card-toggle" aria-label="Expandir">+</span></summary><div class="person-card-content">${after}</div></details>`
      });
    }
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i];
      result = result.substring(0, r.start) + r.html + result.substring(r.end);
    }
    return result;
  }

  // ── Sidebar tree ──
  function renderDiscSidebarTree(section) {
    if (section.title.includes('[Anexo')) return '';
    const hasChildren = section.children?.length;
    const childCount = hasChildren ? section.children.length : 0;
    const lvl = section.level;
    const cleanTitle = section.title.replace(/\*\*\*/g, '').replace(/\*\*/g, '').replace(/\\\./g, '');

    if (lvl === 1) {
      let body = '';
      if (hasChildren) {
        body = '<div class="disciples-sb-cat-body">';
        for (const c of section.children) body += renderDiscSidebarTree(c);
        body += '</div>';
      }
      return `<details class="disciples-sb-cat" open><summary class="disciples-sb-cat-header" data-scroll="sec-${section.id}"><span class="disciples-sb-cat-title">${esc(cleanTitle)}</span>${childCount > 0 ? `<span class="disciples-sb-sub-count">${childCount}</span>` : ''}</summary>${body}</details>`;
    }
    if (lvl === 2) {
      if (!hasChildren) return `<a class="disciples-sb-leaf disciples-sb-leaf--lvl-2" href="#sec-${section.id}" data-scroll="sec-${section.id}">${esc(cleanTitle)}</a>`;
      let body = '';
      for (const c of section.children) body += renderDiscSidebarTree(c);
      return `<details class="disciples-sb-sub"><summary class="disciples-sb-sub-header" data-scroll="sec-${section.id}"><span class="disciples-sb-sub-label">${esc(cleanTitle)}</span><span class="disciples-sb-sub-count">${childCount}</span></summary>${body}</details>`;
    }
    if (hasChildren) {
      let body = '';
      for (const c of section.children) body += renderDiscSidebarTree(c);
      return `<details class="disciples-sb-sub disciples-sb-sub--lvl-${Math.min(lvl, 7)}"><summary class="disciples-sb-sub-header" data-scroll="sec-${section.id}"><span class="disciples-sb-sub-label">${esc(cleanTitle)}</span><span class="disciples-sb-sub-count">${childCount}</span></summary>${body}</details>`;
    }
    return `<a class="disciples-sb-leaf disciples-sb-leaf--lvl-${Math.min(lvl, 7)}" href="#sec-${section.id}" data-scroll="sec-${section.id}">${esc(cleanTitle)}</a>`;
  }

  // ── Overview (list of books) ──
  function renderDisciplesOverview() {
    const container = document.getElementById('readerContainer');
    if (!container || !_disciplesIndex) return;
    const lang = localStorage.getItem('site_lang') || 'pt';
    const isPt = lang !== 'ja';

    let continueBannerHtml = '';
    try {
      let lastRead = null;
      for (const book of _disciplesIndex.books) {
        const saved = localStorage.getItem(`book_pos_${book.id}`);
        if (!saved) continue;
        const pos = JSON.parse(saved);
        if (!pos.ts) continue;
        if (!lastRead || pos.ts > lastRead.ts) {
          lastRead = { bookId: book.id, bookTitle: book.title, sectionTitle: pos.sectionTitle || '', ts: pos.ts };
        }
      }
      if (lastRead) {
        let dismissed = null;
        try { dismissed = JSON.parse(localStorage.getItem('disciples_banner_dismissed') || 'null'); } catch {}
        if (!dismissed || dismissed.bookId !== lastRead.bookId || dismissed.ts !== lastRead.ts) {
          const diff = Date.now() - lastRead.ts;
          const mins = Math.floor(diff / 60000);
          const hrs = Math.floor(mins / 60);
          const days = Math.floor(hrs / 24);
          const timeAgo = days > 0 ? `há ${days} dia${days !== 1 ? 's' : ''}` : hrs > 0 ? `há ${hrs}h` : mins > 0 ? `há ${mins} min` : 'agora mesmo';
          const metaText = lastRead.sectionTitle ? `${lastRead.sectionTitle} · ${timeAgo}` : timeAgo;
          const url = `reader.html?pub=disciples&book=${encodeURIComponent(lastRead.bookId)}`;
          const safeId = lastRead.bookId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          continueBannerHtml = `<div class="continue-banner" id="disciplesContinueBanner"><div class="continue-banner__label">Continue lendo</div><a class="continue-banner__item" href="${url}"><div class="continue-banner__title">${esc(lastRead.bookTitle)}</div><div class="continue-banner__meta">${esc(metaText)}</div></a><button class="continue-banner__dismiss" title="Dispensar" onclick="try{localStorage.setItem('disciples_banner_dismissed',JSON.stringify({bookId:'${safeId}',ts:${lastRead.ts}}));}catch(e){}document.getElementById('disciplesContinueBanner')?.remove();">×</button></div>`;
        }
      }
    } catch {}

    // Render inicial sem contagem de capítulos (placeholder), depois
    // popula com os números reais quando os fetches terminam. Evita
    // bloquear a renderização da overview esperando os 2 livros completos.
    const buildCard = (book, stats) => {
      const url = `reader.html?pub=disciples&book=${encodeURIComponent(book.id)}`;
      const chaptersLabel = isPt ? (stats && stats.chapters === 1 ? 'capítulo' : 'capítulos') : '章';
      const sectionsLabel = isPt ? (stats && stats.sections === 1 ? 'seção' : 'seções') : '節';
      const ctaLabel = isPt ? 'Ler' : '読む';
      const statsHtml = stats
        ? `<span class="disciples-card-stat"><strong>${stats.chapters}</strong> ${chaptersLabel}</span>
           ${stats.sections > stats.chapters ? `<span class="disciples-card-stat-sep">·</span><span class="disciples-card-stat"><strong>${stats.sections}</strong> ${sectionsLabel}</span>` : ''}`
        : `<span class="disciples-card-stat disciples-card-stat--placeholder">···</span>`;
      const kickerText = book.kickerLabel || book.author;
      return `<a href="${url}" class="disciples-book-card" data-book-id="${esc(book.id)}">
        ${kickerText ? `<div class="disciples-book-kicker">${esc(kickerText)}</div>` : ''}
        ${book.titleJa ? `<div class="disciples-book-title-ja">${esc(book.titleJa)}</div>` : ''}
        <h2 class="disciples-book-title">${esc(book.title)}</h2>
        <p class="disciples-book-desc">${esc(book.description || '')}</p>
        <div class="disciples-book-foot">
          <div class="disciples-book-stats" data-stats="${esc(book.id)}">${statsHtml}</div>
          <span class="disciples-book-cta">
            ${ctaLabel}
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </span>
        </div>
      </a>`;
    };

    const cachedCounts = (() => {
      try { return JSON.parse(localStorage.getItem('disciples_book_counts') || '{}'); } catch { return {}; }
    })();
    const cardsHtml = _disciplesIndex.books.filter(b => !b.draft).map(b => buildCard(b, cachedCounts[b.id])).join('');

    container.innerHTML = `<div class="reader-content disciples-overview"><div class="disciples-overview-header"><span class="disciples-overview-kicker">${isPt ? 'Acervo Complementar' : '補足の蔵書'}</span><h1>${isPt ? 'Publicações de Discípulos' : '弟子の著作'}</h1><p class="disciples-overview-desc">${isPt ? 'Livros e coletâneas dos discípulos de Meishu-Sama' : 'メイシュ様の弟子たちの著作'}</p></div>${continueBannerHtml}<div class="disciples-book-grid">${cardsHtml}</div></div>`;

    // Pré-fetch em paralelo dos livros completos só pra obter contagem
    // de capítulos/partes. Cacheia em localStorage pra próximos loads
    // terem render instantâneo. Não bloqueia a primeira pintura.
    (async () => {
      const fresh = {};
      const countAllSections = (nodes) => {
        let n = 0;
        for (const node of nodes) {
          n++;
          if (node.children && node.children.length) n += countAllSections(node.children);
        }
        return n;
      };
      await Promise.all(_disciplesIndex.books.filter(b => !b.draft).map(async (b) => {
        try {
          const full = await fetchBookJson(b.file);
          const sections = full.sections || [];
          const flat = flattenForBook(b.id, sections);
          fresh[b.id] = { chapters: flat.length, sections: countAllSections(sections) };
        } catch (_) {}
      }));
      try { localStorage.setItem('disciples_book_counts', JSON.stringify(fresh)); } catch (_) {}
      // Re-render apenas o footer dos cards (sem refazer o grid)
      for (const id in fresh) {
        const slot = document.querySelector(`.disciples-book-stats[data-stats="${CSS.escape(id)}"]`);
        if (!slot) continue;
        const s = fresh[id];
        const chaptersLabel = isPt ? (s.chapters === 1 ? 'capítulo' : 'capítulos') : '章';
        const sectionsLabel = isPt ? (s.sections === 1 ? 'seção' : 'seções') : '節';
        slot.innerHTML = `<span class="disciples-card-stat"><strong>${s.chapters}</strong> ${chaptersLabel}</span>
                          ${s.sections > s.chapters ? `<span class="disciples-card-stat-sep">·</span><span class="disciples-card-stat"><strong>${s.sections}</strong> ${sectionsLabel}</span>` : ''}`;
      }
    })();

    document.title = (isPt ? 'Publicações de Discípulos' : '弟子の著作') + ' | Caminho da Felicidade';
    setBackButton('home');
    renderDisciplesSidebar(null);

    // Leaving any specific book — stop the read-time heartbeat
    _currentDisciplesBook = null;
    window._disciplesActiveBook = null;
    try { window._readTimeTracker?.stop?.(); } catch (_) {}
    _setOverviewMode(true);
  }

  // ── Render specific book ──
  function renderDisciplesBook(book) {
    _currentDisciplesBook = book;
    // Expõe pro highlights.js poder mostrar "Destaques em <livro>"
    // e contexto de seção em cada item.
    window._disciplesActiveBook = {
      id: book.id,
      title: book.title,
      titleJa: book.titleJa,
      author: book.author,
    };
    _flatChapters = flattenForBook(book.id, book.sections || []);
    _currentChapterIndex = loadDiscChapterPos(book.id);
    if (_currentChapterIndex >= _flatChapters.length) _currentChapterIndex = 0;
    saveDiscChapterPos(book.id, _currentChapterIndex);
    document.title = `${book.title} | Caminho da Felicidade`;
    setBackButton('books');
    renderCurrentDiscChapter();
    renderDisciplesSidebar(book.id);
    _setOverviewMode(false);

    // Log book open + start read-time tracking + sync chapter progress (admin analytics)
    try { window.supabaseAuth?.logAccess?.('disciples', book.id, 'view')?.catch?.(() => {}); } catch (_) {}
    try { window._readTimeTracker?.start?.('disciples', book.id); } catch (_) {}
    syncDiscReadingPosition();
  }

  function renderCurrentDiscChapter() {
    const container = document.getElementById('readerContainer');
    if (!container || !_currentDisciplesBook || !_flatChapters.length) return;
    const lang = localStorage.getItem('site_lang') || 'pt';
    const isPt = lang !== 'ja';
    const book = _currentDisciplesBook;
    const chapter = _flatChapters[_currentChapterIndex];
    const total = _flatChapters.length;
    const hasPrev = _currentChapterIndex > 0;
    const hasNext = _currentChapterIndex < total - 1;

    function headingTag(level) { return 'h' + Math.min(level + 1, 6); }
    function sectionClass(level) {
      if (level === 1) return 'disciples-part-divider';
      if (level === 2) return 'disciples-section';
      if (level === 3) return 'disciples-section disciples-section--child';
      return `disciples-section disciples-section--deep disciples-section--depth-${level}`;
    }
    // Renderiza o nó da página E seus descendentes recursivamente —
    // os subtópicos (level 3) aparecem juntos dentro do subcapítulo
    // (level 2), separados por seus próprios títulos.
    function renderSection(section) {
      const tag = headingTag(section.level);
      const cls = sectionClass(section.level);
      const title = (section.title || '').replace(/\*{1,3}/g, '').replace(/\\\./g, '');
      let contentHtml = section.content ? renderMd(section.content) : '';
      if (section.content) contentHtml = addPersonNameIds(contentHtml, section.content);
      contentHtml = makePersonParagraphsCollapsible(contentHtml);
      // Apostila Shin Dendō: subtítulo + ensinamento estruturado + explicação de nó-pai
      let ensHtml = '';
      if (section.subtitulo) ensHtml += `<div class="ens-subtitulo">―― ${esc(section.subtitulo)} ――</div>`;
      if (section.ensinamento) ensHtml += renderEnsinamento(section.ensinamento);
      else if (section.explicacao) ensHtml += discExpBlock(section.explicacao, null);
      let childrenHtml = '';
      if (section.children?.length) {
        for (const c of section.children) childrenHtml += renderSection(c);
      }
      const body = ensHtml + (contentHtml ? `<div class="disciples-section-content">${contentHtml}</div>` : '');
      if (section.level === 1) {
        return `<div class="${cls}" id="sec-${section.id}"><${tag}>${esc(title)}</${tag}>${body}${childrenHtml}</div>`;
      }
      return `<section class="${cls}" id="sec-${section.id}"><${tag} class="disciples-section-title">${esc(title)}</${tag}>${body}${childrenHtml}</section>`;
    }

    // Breadcrumb: capítulo > subcapítulo > [trecho atual]. Mostra apenas
    // os ancestrais — o próprio título do nó vem dentro de renderSection.
    const ancestors = chapter._ancestors || [];
    const breadcrumbHtml = ancestors.length
      ? `<nav class="disciples-breadcrumb" aria-label="${isPt ? 'Localização' : '現在地'}">${ancestors.map((a, i) => {
          const t = (a.title || '').replace(/\*{1,3}/g, '').replace(/\\\./g, '');
          const sep = i < ancestors.length - 1 ? '<span class="disciples-breadcrumb__sep" aria-hidden="true">›</span>' : '';
          return `<span class="disciples-breadcrumb__crumb">${esc(t)}</span>${sep}`;
        }).join('')}</nav>`
      : '';

    const chapterNavHtml = `<div class="disciples-chapter-nav"><button class="disciples-chapter-nav-btn" onclick="_disciplesNav(${_currentChapterIndex - 1})" ${!hasPrev ? 'disabled' : ''} title="${isPt ? 'Trecho anterior' : '前のチャプター'}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg><span>${isPt ? 'Anterior' : '前へ'}</span></button><div class="disciples-chapter-nav-info"><span class="disciples-chapter-nav-current">${_currentChapterIndex + 1}</span> / ${total}</div><button class="disciples-chapter-nav-btn" onclick="_disciplesNav(${_currentChapterIndex + 1})" ${!hasNext ? 'disabled' : ''} title="${isPt ? 'Próximo trecho' : '次のチャプター'}"><span>${isPt ? 'Próximo' : '次へ'}</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button></div>`;

    container.innerHTML = `<div class="reader-content disciples-book-content"><div class="disciples-book-header"><h1>${esc(book.title)}</h1>${book.author ? `<div class="disciples-book-author-header">${esc(book.author)}</div>` : ''}<a class="disciples-back-link" href="reader.html?pub=disciples"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>${isPt ? 'Publicações dos Discípulos' : '弟子たちの著作一覧'}</a></div>${breadcrumbHtml}${chapterNavHtml}<div class="disciples-book-body">${renderSection(chapter)}</div>${chapterNavHtml}</div>`;

    updateDiscSidebarActiveState();
    // Re-observa os sections recém-renderizados pro scroll spy
    // continuar atualizando a sidebar conforme o usuário rola.
    setupScrollSpy();

    // Re-apply user highlights to the freshly rendered chapter
    try { window.applyHighlightsOnPage?.(); } catch (_) {}
  }

  // ── Sidebar rendering ──
  function _collapseToggleHtml(isPt) {
    const label = isPt ? 'Recolher índice' : '目次を折りたたむ';
    return `<button type="button" class="disciples-sb-collapse-toggle" onclick="_disciplesToggleCollapse()" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>`;
  }

  function _railHtmlForBookList(isPt) {
    if (!_disciplesIndex) return '';
    const books = _disciplesIndex.books.filter(b => !b.draft);
    let html = '';
    for (let i = 0; i < books.length; i++) {
      const b = books[i];
      const url = `reader.html?pub=disciples&book=${encodeURIComponent(b.id)}`;
      html += `<a class="disciples-sb-rail-item" href="${url}" title="${esc(b.title)}" aria-label="${esc(b.title)}"><span>${i + 1}</span></a>`;
    }
    return html;
  }

  function _railHtmlForChapters() {
    if (!_flatChapters.length) return '';
    let html = '';
    for (let i = 0; i < _flatChapters.length; i++) {
      const ch = _flatChapters[i];
      const title = (ch.title || `#${i + 1}`).replace(/\s+/g, ' ').trim();
      html += `<button type="button" class="disciples-sb-rail-item" data-chapter-idx="${i}" title="${esc(title)}" aria-label="${esc(title)}"><span>${i + 1}</span></button>`;
    }
    return html;
  }

  function renderDisciplesSidebar(bookId) {
    const sidebar = document.getElementById('readerSidebar');
    if (!sidebar) return;
    const lang = localStorage.getItem('site_lang') || 'pt';
    const isPt = lang !== 'ja';

    // Make sidebar visible
    sidebar.style.display = '';

    if (!bookId) {
      if (!_disciplesIndex) {
        sidebar.innerHTML = '<div class="disciples-sidebar"><p style="padding:1rem">Carregando…</p></div>';
        return;
      }
      let navHtml = '';
      const listed = _disciplesIndex.books.filter(b => !b.draft);
      for (const book of listed) {
        const url = `reader.html?pub=disciples&book=${encodeURIComponent(book.id)}`;
        navHtml += `<a class="disciples-sb-book-link" href="${url}"><span class="disciples-sb-book-title">${esc(book.title)}</span></a>`;
      }
      sidebar.innerHTML = `<div class="disciples-sidebar"><div class="disciples-sb-fixed-header"><div class="disciples-sb-header-row"><div class="disciples-sb-header-titles"><div style="font-size:0.78rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--accent)">${isPt ? 'Publicações de Discípulos' : '弟子の著作'}</div><div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">${listed.length} ${isPt ? 'obras' : '作品'}</div></div>${_collapseToggleHtml(isPt)}</div></div><div class="disciples-sb-scrollable">${navHtml}</div><div class="disciples-sb-rail">${_railHtmlForBookList(isPt)}</div></div>`;
      requestAnimationFrame(() => attachSidebarBehaviors(sidebar));
      return;
    }

    // Book-specific sidebar
    let sectionsHtml = '';
    if (_currentDisciplesBook) {
      const book = _currentDisciplesBook;
      let totalSections = 0, totalTopics = 0;
      const countAll = (sections) => {
        for (const s of sections) {
          totalSections++;
          if (s.children?.length) totalTopics += s.children.length;
          if (s.children?.length) countAll(s.children);
        }
      };
      countAll(book.sections);
      const aboutHtml = `<details class="disciples-sb-about"><summary class="disciples-sb-about-summary">${isPt ? 'Sobre esta obra' : 'この作品について'}</summary><div class="disciples-sb-about-body">${book.author ? `<div class="disciples-sb-meta-row"><span class="disciples-sb-meta-label">${isPt ? 'Autor' : '著者'}</span><span>${esc(book.author)}</span></div>` : ''}<div class="disciples-sb-meta-row"><span class="disciples-sb-meta-label">${isPt ? 'Seções' : 'セクション'}</span><span>${totalSections}</span></div>${book.description ? `<p class="disciples-sb-about-desc">${esc(book.description)}</p>` : ''}</div></details>`;
      let treeHtml = '';
      for (const section of book.sections) treeHtml += renderDiscSidebarTree(section);
      sectionsHtml = aboutHtml + `<div class="disciples-sb-tree">${treeHtml}</div>`;
    }

    sidebar.innerHTML = `<div class="disciples-sidebar"><div class="disciples-sb-fixed-header"><div class="disciples-sb-header-row"><div class="disciples-sb-header-titles"><div style="font-size:0.95rem;font-weight:600;color:var(--text-main);line-height:1.25">${_currentDisciplesBook ? esc(_currentDisciplesBook.title) : (isPt ? 'Livros' : '書籍')}</div>${_currentDisciplesBook?.titleJa ? `<div style="font-family:'Noto Serif JP',serif;font-size:0.78rem;color:var(--text-muted);margin-top:2px">${esc(_currentDisciplesBook.titleJa)}</div>` : ''}</div>${_collapseToggleHtml(isPt)}</div><a href="reader.html?pub=disciples" class="disciples-back-link disciples-sb-back-link"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>${isPt ? 'Todas as obras' : '作品一覧'}</a></div><div class="disciples-sb-scrollable">${sectionsHtml}</div><div class="disciples-sb-rail">${_railHtmlForChapters()}</div></div>`;

    requestAnimationFrame(() => attachSidebarBehaviors(sidebar));
  }

  function attachSidebarBehaviors(sidebar) {
    const scrollTarget = (id) => {
      const target = document.getElementById(id);
      if (target) {
        if (_discScrollLock) return;
        const headerH = document.querySelector('.header')?.offsetHeight || 56;
        const top = target.getBoundingClientRect().top + window.scrollY - headerH - 16;
        _discScrollLock = true;
        window.scrollTo({ top, behavior: 'smooth' });
        setTimeout(() => { _discScrollLock = false; }, 800);
        return;
      }
      const sectionId = id.replace('sec-', '');
      for (let i = 0; i < _flatChapters.length; i++) {
        const ch = _flatChapters[i];
        const findIn = (s, tid) => s.id === tid || (s.children?.some(c => findIn(c, tid)) || false);
        if (ch.id === sectionId || ch.children?.some(c => findIn(c, sectionId))) {
          navigateToChapter(i);
          setTimeout(() => {
            const el = document.getElementById(id);
            if (el) {
              const headerH = document.querySelector('.header')?.offsetHeight || 56;
              window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - headerH - 16, behavior: 'smooth' });
            }
          }, 300);
          return;
        }
      }
    };

    sidebar.querySelectorAll('[data-scroll]').forEach(link => {
      link.addEventListener('click', (e) => { e.preventDefault(); scrollTarget(link.getAttribute('data-scroll')); });
    });
    sidebar.querySelectorAll('.disciples-sb-leaf[href]').forEach(link => {
      link.addEventListener('click', (e) => { e.preventDefault(); const id = (link.getAttribute('href') || '').replace('#', ''); if (id) scrollTarget(id); });
    });

    // Rail navigation (collapsed mode)
    sidebar.querySelectorAll('.disciples-sb-rail-item[data-chapter-idx]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = parseInt(btn.dataset.chapterIdx, 10);
        if (Number.isFinite(idx)) navigateToChapter(idx);
      });
    });

    // Scroll spy: extraído pra setupScrollSpy() pra ser refeito a cada
    // troca de página (renderCurrentDiscChapter substitui o conteúdo,
    // então o observer antigo perde a referência dos sections).
    setupScrollSpy();

    // Scroll position persistence
    let scrollTick = false;
    const bookId = _currentDisciplesBook?.id || '';
    window.addEventListener('scroll', () => {
      if (!scrollTick && bookId && !_discRestoring) {
        scrollTick = true;
        requestAnimationFrame(() => {
          const activeLink = sidebar.querySelector('.disciples-sb-leaf.active, [data-scroll].active');
          const chapterIdx = loadDiscChapterPos(bookId);
          if (activeLink) {
            const sId = activeLink.getAttribute('data-scroll') || (activeLink.getAttribute('href') || '').replace('#', '');
            const title = activeLink.textContent?.trim().slice(0, 80) || '';
            if (sId) {
              localStorage.setItem(`book_pos_${bookId}`, JSON.stringify({ chapter: chapterIdx, section: sId, sectionTitle: title, scrollY: window.scrollY, ts: Date.now() }));
            }
          } else {
            const existing = (() => { try { return JSON.parse(localStorage.getItem(`book_pos_${bookId}`) || '{}'); } catch { return {}; } })();
            localStorage.setItem(`book_pos_${bookId}`, JSON.stringify({ ...existing, chapter: chapterIdx, scrollY: window.scrollY, ts: Date.now() }));
          }
          scrollTick = false;
        });
      }
    }, { passive: true });

    restoreDiscReadingPosition(bookId);
  }

  // ── Scroll spy: destaca o link da sidebar conforme rola o conteúdo
  // Re-setup necessário a cada navegação de capítulo, porque renderCurrentDiscChapter
  // substitui innerHTML e os <section id> antigos somem do DOM.
  let _scrollSpyObserver = null;
  function setupScrollSpy() {
    const sidebar = document.getElementById('readerSidebar');
    if (!sidebar) return;
    if (_scrollSpyObserver) {
      try { _scrollSpyObserver.disconnect(); } catch (_) {}
      _scrollSpyObserver = null;
    }
    const allLinks = Array.from(sidebar.querySelectorAll('.disciples-sb-leaf, [data-scroll]'));
    const contentSections = Array.from(document.querySelectorAll('.disciples-section[id], .disciples-part-divider[id]'));
    if (!allLinks.length || !contentSections.length) return;
    let ticking = false;
    const setActive = (id) => {
      allLinks.forEach(link => {
        const href = (link.getAttribute('href') || '').replace('#', '');
        const ds = link.getAttribute('data-scroll') || '';
        const linkId = href || ds;
        const was = link.classList.contains('active');
        const is = linkId === id;
        if (was !== is) {
          link.classList.toggle('active', is);
          if (is) {
            let parent = link.closest('details');
            while (parent) { parent.open = true; parent = parent.parentElement?.closest('details'); }
            if (!ticking) {
              ticking = true;
              requestAnimationFrame(() => {
                try { link.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
                catch (_) {}
                ticking = false;
              });
            }
          }
        }
      });
    };
    if (contentSections[0]?.id) setActive(contentSections[0].id);
    _scrollSpyObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting);
      if (visible.length) setActive(visible[0].target.id);
    }, { rootMargin: '-12% 0px -55% 0px', threshold: 0 });
    contentSections.forEach(s => _scrollSpyObserver.observe(s));
  }

  function updateDiscSidebarActiveState() {
    if (!_flatChapters.length || !_currentDisciplesBook) return;
    const sidebar = document.getElementById('readerSidebar');
    if (!sidebar) return;
    const currentId = `sec-${_flatChapters[_currentChapterIndex].id}`;
    sidebar.querySelectorAll('.disciples-sb-leaf.active, [data-scroll].active').forEach(el => el.classList.remove('active'));
    const activeLink = sidebar.querySelector(`[data-scroll="${currentId}"], .disciples-sb-leaf[href="#${currentId}"]`);
    if (activeLink) {
      activeLink.classList.add('active');
      let parent = activeLink.closest('details');
      while (parent) { parent.open = true; parent = parent.parentElement?.closest('details'); }
      try { activeLink.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    }

    // Rail (collapsed mode)
    sidebar.querySelectorAll('.disciples-sb-rail-item.active').forEach(el => el.classList.remove('active'));
    const railItem = sidebar.querySelector(`.disciples-sb-rail-item[data-chapter-idx="${_currentChapterIndex}"]`);
    if (railItem) {
      railItem.classList.add('active');
      try { railItem.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    }
  }

  function restoreDiscReadingPosition(bookId) {
    if (!bookId) return;
    const saved = localStorage.getItem(`book_pos_${bookId}`);
    if (!saved) return;
    try {
      const pos = JSON.parse(saved);
      if (!pos.ts || Date.now() - pos.ts > 30 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(`book_pos_${bookId}`);
        return;
      }
      const needsChapterNav = typeof pos.chapter === 'number' && pos.chapter !== _currentChapterIndex;
      if (needsChapterNav) {
        _discRestoring = true;
        const savedSection = pos.section;
        const savedTitle = pos.sectionTitle;
        const savedScrollY = pos.scrollY;
        navigateToChapter(pos.chapter);
        if (savedSection || typeof savedScrollY === 'number') {
          const cur = (() => { try { return JSON.parse(localStorage.getItem(`book_pos_${bookId}`) || '{}'); } catch { return {}; } })();
          localStorage.setItem(`book_pos_${bookId}`, JSON.stringify({
            ...cur,
            ...(savedSection ? { section: savedSection } : {}),
            ...(savedTitle ? { sectionTitle: savedTitle } : {}),
            ...(typeof savedScrollY === 'number' ? { scrollY: savedScrollY } : {}),
          }));
        }
      }
      if (pos.section || typeof pos.scrollY === 'number') {
        const doRestore = () => {
          const headerH = document.querySelector('.header')?.offsetHeight || 56;
          const target = pos.section ? document.getElementById(pos.section) : null;
          if (target) {
            window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - headerH - 16, behavior: 'instant' });
          } else if (typeof pos.scrollY === 'number') {
            window.scrollTo({ top: pos.scrollY, behavior: 'instant' });
          }
          _discRestoring = false;
        };
        if (needsChapterNav) setTimeout(doRestore, 450);
        else requestAnimationFrame(doRestore);
      } else {
        _discRestoring = false;
      }
    } catch (e) { console.warn('[disciples] restore failed', e); }
  }

  // ── Desktop sidebar collapse toggle ──
  // Salva '1' (fechado) ou '0' (aberto) explicitamente pra respeitar a
  // preferência sobre o default (desktop=aberto, mobile=fechado).
  window._disciplesToggleCollapse = function () {
    const isCollapsed = document.body.classList.toggle('disciples-sidebar-collapsed');
    try { localStorage.setItem('disciples_sidebar_collapsed', isCollapsed ? '1' : '0'); } catch (_) {}
  };

  // ── Sidebar toggle: drawer on mobile, slide-in/out on desktop ──
  window._disciplesToggleSidebar = function () {
    const body = document.body;
    const btn = document.getElementById('discSidebarToggle');
    const isDesktop = window.matchMedia('(min-width: 901px)').matches;
    if (isDesktop) {
      const willCollapse = !body.classList.contains('disciples-sidebar-collapsed');
      body.classList.toggle('disciples-sidebar-collapsed', willCollapse);
      try { localStorage.setItem('disciples_sidebar_collapsed', willCollapse ? '1' : '0'); } catch (_) {}
      if (btn) btn.setAttribute('aria-expanded', willCollapse ? 'false' : 'true');
      return;
    }
    if (body.classList.contains('disciples-sidebar-open')) {
      body.classList.remove('disciples-sidebar-open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    } else {
      body.classList.add('disciples-sidebar-open');
      if (btn) btn.setAttribute('aria-expanded', 'true');
    }
  };

  window._disciplesCloseSidebar = function () {
    document.body.classList.remove('disciples-sidebar-open');
    const btn = document.getElementById('discSidebarToggle');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  };

  function initMobileSidebarToggle() {
    if (document.getElementById('discSidebarToggle')) return;

    // Aguardar header__actions (injetado por nav.js no DOMContentLoaded)
    const headerActions = document.querySelector('.header__actions');
    if (!headerActions) {
      requestAnimationFrame(initMobileSidebarToggle);
      return;
    }

    const lang = localStorage.getItem('site_lang') || 'pt';
    const isPt = lang !== 'ja';

    // Botões A− / A+ (tamanho de fonte direto) e Aa (abre themeModal)
    if (!document.getElementById('discFontDecBtn')) {
      const fontDec = document.createElement('button');
      fontDec.id = 'discFontDecBtn';
      fontDec.className = 'disciples-font-btn';
      fontDec.setAttribute('aria-label', isPt ? 'Diminuir fonte' : 'フォント縮小');
      fontDec.setAttribute('title', isPt ? 'Diminuir fonte' : 'フォント縮小');
      fontDec.textContent = 'A−';
      fontDec.addEventListener('click', () => {
        if (typeof window.changeFontSize === 'function') window.changeFontSize(-1);
      });
      headerActions.appendChild(fontDec);

      const fontInc = document.createElement('button');
      fontInc.id = 'discFontIncBtn';
      fontInc.className = 'disciples-font-btn disciples-font-btn--inc';
      fontInc.setAttribute('aria-label', isPt ? 'Aumentar fonte' : 'フォント拡大');
      fontInc.setAttribute('title', isPt ? 'Aumentar fonte' : 'フォント拡大');
      fontInc.textContent = 'A+';
      fontInc.addEventListener('click', () => {
        if (typeof window.changeFontSize === 'function') window.changeFontSize(1);
      });
      headerActions.appendChild(fontInc);
    }

    if (!document.getElementById('discThemeToggle')) {
      const themeBtn = document.createElement('button');
      themeBtn.id = 'discThemeToggle';
      themeBtn.className = 'disciples-theme-toggle';
      themeBtn.setAttribute('aria-label', isPt ? 'Tema e ajustes' : 'テーマと設定');
      themeBtn.setAttribute('title', isPt ? 'Tema e ajustes de leitura' : 'テーマと読書設定');
      themeBtn.textContent = 'Aa';
      themeBtn.addEventListener('click', () => {
        if (typeof window.toggleTheme === 'function') window.toggleTheme();
        else if (typeof window.openThemeModal === 'function') window.openThemeModal();
      });
      headerActions.appendChild(themeBtn);
    }

    // Botão Índice no header (substitui hamburger — drawer entra pela direita)
    const btn = document.createElement('button');
    btn.id = 'discSidebarToggle';
    btn.className = 'disciples-sidebar-toggle';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'readerSidebar');
    btn.setAttribute('onclick', '_disciplesToggleSidebar()');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>${isPt ? 'Índice' : '目次'}`;
    headerActions.appendChild(btn);

    // Backdrop
    const backdrop = document.getElementById('disciplesBackdrop');
    if (backdrop && !backdrop._discListener) {
      backdrop._discListener = true;
      backdrop.setAttribute('onclick', '_disciplesCloseSidebar()');
    }

    if (!window._discEscListener) {
      window._discEscListener = true;
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window._disciplesCloseSidebar(); });
    }

    // Fechar ao selecionar item do índice
    const sidebar = document.getElementById('readerSidebar');
    if (sidebar && !sidebar._discCloseListener) {
      sidebar._discCloseListener = true;
      sidebar.addEventListener('click', (e) => {
        if (e.target.closest('.disciples-sb-leaf, .disciples-sb-book-link')) {
          setTimeout(() => window._disciplesCloseSidebar(), 220);
        }
      });
    }
  }

  // ── Entry point ──
  async function initDisciples() {
    const bookId = urlParams.get('book');
    const container = document.getElementById('readerContainer');
    if (!container) return;

    try {
      if (!_disciplesIndex) {
        _disciplesIndex = await fetchBookJson('disciples_index.json');
      }
      if (!bookId) {
        renderDisciplesOverview();
        initMobileSidebarToggle();
        return;
      }
      const entry = _disciplesIndex.books.find(b => b.id === bookId);
      if (!entry) {
        container.innerHTML = '<div class="error" style="padding:2rem;text-align:center">Livro não encontrado.</div>';
        setBackButton('books');
        return;
      }
      const book = await fetchBookJson(entry.file);
      book.id = bookId;
      book.title = book.title || entry.title;
      book.author = book.author || entry.author;
      book.titleJa = book.titleJa || entry.titleJa;
      book.description = book.description || entry.description;
      renderDisciplesBook(book);
      initMobileSidebarToggle();
    } catch (err) {
      console.error('[disciples] init failed:', err);
      container.innerHTML = `<div class="error" style="padding:2rem;text-align:center">Erro ao carregar Publicações de Discípulos.${err?.message ? `<br><small style="opacity:0.6">${esc(err.message)}</small>` : ''}</div>`;
      setBackButton('home');
      initMobileSidebarToggle();
    }
  }

  // Expose navigation for inline onclick handlers
  window._disciplesNav = navigateToChapter;
  window.printDisciplesBook = function () {
    if (!_currentDisciplesBook) return;
    const book = _currentDisciplesBook;
    const lang = localStorage.getItem('site_lang') || 'pt';
    const isPt = lang !== 'ja';
    function printTag(level) { return { 1: 'h2', 2: 'h3', 3: 'h4', 4: 'h5' }[level] || 'h6'; }
    function printClass(level) {
      if (level === 1) return 'disciples-print-part';
      if (level === 2) return 'disciples-print-chapter';
      return 'disciples-print-section';
    }
    function renderSec(section) {
      const tag = printTag(section.level);
      const cls = printClass(section.level);
      let html = `<div class="${cls}" id="sec-${section.id}"><${tag}>${esc(section.title.replace(/\\\./g, ''))}</${tag}>`;
      if (section.content) html += `<div class="disciples-print-body">${renderMd(section.content)}</div>`;
      if (section.children?.length) for (const c of section.children) html += renderSec(c);
      html += '</div>';
      return html;
    }
    let sectionsHtml = '';
    for (const s of book.sections) sectionsHtml += renderSec(s);
    const printHtml = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><title>${esc(book.title)}</title>
<style>*{box-sizing:border-box}body{font-family:'EB Garamond',Georgia,serif;font-size:11pt;line-height:1.7;color:#1a1a1a;margin:0;padding:0}
.print-cover{height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;page-break-after:always;padding:60px 80px;border-top:6px solid #B8860B;border-bottom:6px solid #B8860B}
.print-cover h1{font-size:32pt;font-weight:600;margin:0 0 12px}.print-cover .sub{font-size:16pt;color:#555;margin:0 0 40px}
.print-content{padding:0 60px}
.disciples-print-part{margin-top:40px;page-break-before:always}.disciples-print-part:first-child{page-break-before:auto}
.disciples-print-part>h2{font-size:20pt;color:#B8860B;border-bottom:3px solid #B8860B;padding-bottom:10px;margin:0 0 24px}
.disciples-print-chapter>h3{font-size:15pt;border-bottom:1px solid #ddd;padding-bottom:6px;margin:0 0 16px}
.disciples-print-section{margin-top:24px;padding-left:16px;border-left:3px solid #e0d8c8}
.disciples-print-body>p{margin:0 0 10px}
@page{size:A4;margin:20mm 18mm 20mm 22mm}</style></head><body>
<div class="print-cover"><h1>${esc(book.title)}</h1>${book.titleJa ? `<div class="sub">${esc(book.titleJa)}</div>` : ''}</div>
<div class="print-content">${sectionsHtml}</div></body></html>`;
    const win = window.open('', '_blank');
    if (!win) { alert(isPt ? 'Pop-up bloqueado. Permita pop-ups para imprimir.' : 'ポップアップがブロックされました。'); return; }
    win.document.write(printHtml);
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
  };

  // Run on DOM ready (after other scripts load so supabaseStorageFetch is available)
  function boot() {
    if (window.supabaseStorageFetch) {
      initDisciples();
    } else {
      // Wait briefly for storage.js module to expose the fetch
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        if (window.supabaseStorageFetch || tries > 100) {
          clearInterval(iv);
          initDisciples();
        }
      }, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
