// ============================================================
// disease-map.js — Explorador "Análise Espiritual das Doenças"
// Exploração guiada por dois eixos (condição × causa espiritual).
// Lê window.DISEASE_MAP (gerado por scripts/build_disease_map.mjs).
// ============================================================
(function () {
  'use strict';

  const DATA = window.DISEASE_MAP;
  const VOL = (DATA && DATA.vol) || 'mioshiec2';

  // Estado: eixo atual + grupo aberto
  let currentAxis = 'condicao'; // 'condicao' | 'causa'
  let openGroupId = null;

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const groupById = (id) => DATA.groups.find((g) => g.id === id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Aplica a tradução atual (PT/JA) ao conteúdo recém-renderizado.
  function applyLang() {
    const lang = localStorage.getItem('site_lang') || 'pt';
    if (typeof window.setLanguage === 'function') window.setLanguage(lang);
  }

  // Bilíngue: <span class="lang-pt">..</span><span class="lang-ja">..</span>
  function bi(pt, ja) {
    return `<span class="lang-pt">${esc(pt)}</span>` +
      `<span class="lang-ja" style="display:none">${esc(ja)}</span>`;
  }

  const tags = () => DATA.tags || [];
  const tagById = (id) => tags().find((t) => t.id === id);

  function articlesForGroup(groupId) {
    return DATA.articles.filter((a) => a.g.includes(groupId));
  }
  function articlesForTag(tagId) {
    return DATA.articles.filter((a) => (a.tg || []).includes(tagId));
  }

  // Etiquetas de referência cruzada: os grupos do artigo no OUTRO eixo.
  function crossRefs(article, axisOfCurrentGroup) {
    return article.g
      .map(groupById)
      .filter((g) => g && g.axis !== axisOfCurrentGroup);
  }

  function renderArticle(article, axisOfGroup) {
    const url = `reader.html?vol=${VOL}&file=${article.f}`;
    const xrefBtns = crossRefs(article, axisOfGroup)
      .map((g) => `<button type="button" class="dm-xref" data-goto="${g.id}" ` +
        `title="Estude também por esta causa/condição">` +
        `${bi(g.pt, g.ja)}</button>`)
      .join('');
    const xrefs = xrefBtns ? `<span class="dm-article__xrefs">${xrefBtns}</span>` : '';
    return `<div class="dm-article">` +
      `<a class="dm-article__title" href="${url}">${bi(article.pt, article.ja)}</a>` +
      xrefs +
      `</div>`;
  }

  function renderGroup(g) {
    const arts = articlesForGroup(g.id);
    const isOpen = g.id === openGroupId;
    const chevron =
      `<svg class="dm-group__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<polyline points="6 9 12 15 18 9"></polyline></svg>`;
    return `<div class="dm-group${isOpen ? ' is-open' : ''}" data-group="${g.id}">` +
      `<button type="button" class="dm-group__head" aria-expanded="${isOpen}">` +
      `<span class="dm-group__body">` +
      `<span class="dm-group__pergunta">` +
      `<span class="lang-pt">${esc(g.pergunta)}</span>` +
      `<span class="lang-ja" style="display:none">${esc(g.ja)}</span>` +
      `</span>` +
      `<span class="dm-group__label"><span class="lang-pt">${esc(g.pt)}</span></span>` +
      `<span class="dm-group__count">${arts.length} ${bi('ensinamentos', '篇')}</span>` +
      `</span>` +
      chevron +
      `</button>` +
      `<div class="dm-articles">${arts.map((a) => renderArticle(a, g.axis)).join('')}</div>` +
      `</div>`;
  }

  // Tema transversal: igual ao grupo, mas o título do tema é o cabeçalho e os
  // artigos mostram TODOS os seus grupos (ambos os eixos) como referências.
  function renderTag(t) {
    const arts = articlesForTag(t.id);
    const isOpen = t.id === openGroupId;
    const chevron =
      `<svg class="dm-group__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<polyline points="6 9 12 15 18 9"></polyline></svg>`;
    return `<div class="dm-group dm-group--tema${isOpen ? ' is-open' : ''}" data-group="${t.id}">` +
      `<button type="button" class="dm-group__head" aria-expanded="${isOpen}">` +
      `<span class="dm-group__body">` +
      `<span class="dm-group__pergunta">${bi(t.pt, t.ja)}</span>` +
      `<span class="dm-group__count">${arts.length} ${bi('ensinamentos', '篇')}</span>` +
      `</span>` +
      chevron +
      `</button>` +
      `<div class="dm-articles">${arts.map((a) => renderArticle(a, 'tema')).join('')}</div>` +
      `</div>`;
  }

  function render() {
    const grid = $('#dm-groups');
    if (!grid) return;
    if (currentAxis === 'tema') {
      const ts = tags();
      grid.innerHTML = ts.length
        ? ts.map(renderTag).join('')
        : `<div class="dm-empty">Nenhum tema.</div>`;
    } else {
      const groups = DATA.groups.filter((g) => g.axis === currentAxis);
      grid.innerHTML = groups.length
        ? groups.map(renderGroup).join('')
        : `<div class="dm-empty">Nenhum grupo neste eixo.</div>`;
    }

    // Botões do alternador
    document.querySelectorAll('.dm-axis-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.axis === currentAxis);
    });
    applyLang();
  }

  function openGroup(groupId) {
    openGroupId = (openGroupId === groupId) ? null : groupId;
    render();
    if (openGroupId) {
      const el = document.querySelector(`.dm-group[data-group="${openGroupId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // Navega para um grupo (eventualmente trocando de eixo) — usado pelas xrefs.
  function gotoGroup(groupId) {
    const g = groupById(groupId);
    if (!g) return;
    currentAxis = g.axis;
    openGroupId = groupId;
    render();
    const el = document.querySelector(`.dm-group[data-group="${groupId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function init() {
    if (!DATA || !Array.isArray(DATA.groups)) {
      const grid = $('#dm-groups');
      if (grid) grid.innerHTML = `<div class="dm-empty">Dados não carregados.</div>`;
      return;
    }

    // Alternador de eixo
    document.querySelectorAll('.dm-axis-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.axis === currentAxis) return;
        currentAxis = btn.dataset.axis;
        openGroupId = null;
        render();
      });
    });

    // Delegação de cliques na grade (cabeçalho do grupo + xrefs)
    const grid = $('#dm-groups');
    grid.addEventListener('click', (e) => {
      const xref = e.target.closest('.dm-xref');
      if (xref) { e.preventDefault(); gotoGroup(xref.dataset.goto); return; }
      const head = e.target.closest('.dm-group__head');
      if (head) {
        const wrap = head.closest('.dm-group');
        if (wrap) openGroup(wrap.dataset.group);
      }
    });

    // Permite chegar direto num grupo (#B1, #A3, …) ou tema (#morte) via hash
    const hash = location.hash.replace('#', '');
    if (hash && groupById(hash)) {
      gotoGroup(hash);
    } else if (hash && tagById(hash)) {
      currentAxis = 'tema';
      openGroupId = hash;
      render();
      const el = document.querySelector(`.dm-group[data-group="${hash}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      render();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
