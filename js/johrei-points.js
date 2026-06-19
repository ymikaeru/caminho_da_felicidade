// ============================================================
// johrei-points.js — Explorador "Pontos Vitais do Johrei"
// Guia de consulta para ministrantes, por três eixos
// (região do corpo × condição × fundamento) + descobertas.
// Lê window.JOHREI_POINTS (gerado por scripts/build_johrei_points.mjs).
// Clone do renderizador genérico de js/disease-map.js.
// ============================================================
(function () {
  'use strict';

  const DATA = window.JOHREI_POINTS;
  const VOL = (DATA && DATA.vol) || 'mioshiec2';

  // Estado: eixo atual + grupo aberto
  let currentAxis = 'perguntas'; // 'perguntas' | 'regiao' | 'sintoma' | 'fundamento' — abre pelas Descobertas
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
  const perguntas = () => DATA.perguntas || [];
  const perguntaById = (id) => perguntas().find((q) => q.id === id);
  const articleByF = (f) => DATA.articles.find((a) => a.f === f);

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
        `title="Estude também por esta região/condição/fundamento">` +
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
  // (Este guia não usa temas — mantido por paridade com o renderizador genérico.)
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

  // Descoberta provocativa: o cabeçalho é a pergunta + uma provocação curta + um
  // selo de status. Ao abrir: as lições que iluminam (iluminada) OU um convite
  // ao estudo (em aberto). A resposta vive no Ensinamento, não numa nota nossa.
  function renderPergunta(q) {
    const isOpen = q.id === openGroupId;
    const aberta = q.status === 'aberta';
    const chevron =
      `<svg class="dm-group__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<polyline points="6 9 12 15 18 9"></polyline></svg>`;
    // Só as descobertas EM ABERTO exibem selo. Nas demais, esconder que há resposta
    // preserva o convite — a pessoa precisa abrir para descobrir.
    const status = aberta
      ? `<span class="dm-status dm-status--aberta">${bi('Em aberto', '未解明')}</span>`
      : '';
    const teaser = q.teaser
      ? `<span class="dm-group__label"><span class="lang-pt">${esc(q.teaser)}</span></span>` : '';

    let body;
    if (aberta) {
      const convite = q.convite
        ? `<p class="dm-convite lang-pt">${esc(q.convite)}</p>` : '';
      body = `<div class="dm-articles dm-articles--aberta">${convite}</div>`;
    } else {
      const arts = (q.licoes || []).map(articleByF).filter(Boolean);
      body = `<div class="dm-articles">${arts.map((a) => renderArticle(a, 'tema')).join('')}</div>`;
    }

    return `<div class="dm-group dm-group--pergunta${aberta ? ' is-aberta' : ''}${isOpen ? ' is-open' : ''}" data-group="${q.id}">` +
      `<button type="button" class="dm-group__head" aria-expanded="${isOpen}">` +
      `<span class="dm-group__body">` +
      `<span class="dm-group__pergunta">${bi(q.pt, q.ja)}</span>` +
      teaser +
      status +
      `</span>` +
      chevron +
      `</button>` +
      body +
      `</div>`;
  }

  function render() {
    const grid = $('#dm-groups');
    if (!grid) return;
    if (currentAxis === 'perguntas') {
      const qs = perguntas();
      grid.innerHTML = qs.length
        ? qs.map(renderPergunta).join('')
        : `<div class="dm-empty">Nenhuma descoberta.</div>`;
    } else if (currentAxis === 'tema') {
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

    // Deep-link via hash: grupo (#R1,#S2,#F3), tema (#id) ou descoberta (#q-ordem)
    const hash = location.hash.replace('#', '');
    const openViaHash = (axis, id) => {
      currentAxis = axis;
      openGroupId = id;
      render();
      const el = document.querySelector(`.dm-group[data-group="${id}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (hash && groupById(hash)) gotoGroup(hash);
    else if (hash && tagById(hash)) openViaHash('tema', hash);
    else if (hash.startsWith('q-') && perguntaById(hash.slice(2))) openViaHash('perguntas', hash.slice(2));
    else render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
