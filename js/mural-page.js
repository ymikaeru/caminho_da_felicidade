// ============================================================
// Mural de Reflexões — o FEED (mosaico de curadoria, página mural.html)
// ============================================================
// Busca get_study_feed (anônimo) UMA vez (até FETCH_CAP) e FILTRA no cliente
// via a barra (Tudo | Ensinamentos | Poemas). Ordem fixa por recência
// (approved_at desc) — com pré-moderação, aprovar é publicar, então o post
// recém-aprovado nasce no TOPO. Reação = coração (toggle_post_reaction).
// Poema vem com o verso inline (excerpt); ensinamento mostra título + "Vol N".
//
// Filtro client-side: o mural é novo (poucos posts) e get_study_feed devolve
// tudo num lote. TODO: ao passar de FETCH_CAP, paginar/filtrar no RPC.
// (Ordenar por "Mais tocados" foi removido a pedido em 01/06; reaction_count
// ainda vem do RPC, então a lente pode voltar facilmente — ver git/memória.)
//
// Publicar reflexões é em js/mural.js (composer, a partir do Ensinamento).
// Aqui só lê + reage.
// ============================================================

(function () {
  const FETCH_CAP = 100;        // carrega tudo de uma vez até aqui (sort/filter client-side)
  const PAGE = 20;              // quantos exibir por vez (paginação client-side)

  let _all = [];                // tudo que veio do servidor (até FETCH_CAP)
  let _filter = 'all';          // 'all' | 'ensino' | 'poema'
  let _shown = PAGE;
  let _loaded = false;
  let _loading = false;

  function _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _supa() {
    return (window.supabaseAuth && window.supabaseAuth.supabase)
        || window._supabaseClient || window.supabase || null;
  }
  function _lang() { return localStorage.getItem('site_lang') || 'pt'; }

  function _relDate(iso) {
    if (!iso) return '';
    const lang = _lang();
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d) / 86400000);
    if (diff <= 0) return lang === 'ja' ? '今日' : 'hoje';
    if (diff === 1) return lang === 'ja' ? '昨日' : 'ontem';
    if (diff < 7) return `${diff}d`;
    return d.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR', { day: 'numeric', month: 'short' });
  }

  // Ícones de linha — mesmo vocabulário feather do nav.js (stroke currentColor).
  const IC_BOOK = '<svg class="ic" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>';
  const IC_FEATHER = '<svg class="ic" viewBox="0 0 24 24"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>';
  const IC_HEART = '<svg class="ic" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>';

  // "mioshiec2" → "Vol 2" (poesia traz a coletânea no próprio título).
  function _volLabel(vol, lang) {
    const m = String(vol || '').match(/mioshiec(\d+)/i);
    if (m) return lang === 'ja' ? ('第' + m[1] + '巻') : ('Vol ' + m[1]);
    return '';
  }

  function _cardHtml(p) {
    const lang = _lang();
    const isPoem = p.vol === 'poetry';
    const title = p.title_snapshot || (isPoem ? (lang === 'ja' ? '(詩)' : '(poema)') : (lang === 'ja' ? '(教え)' : '(ensinamento)'));
    let href;
    if (isPoem) {
      const f = p.file.endsWith('.html') ? p.file : p.file + '.html';
      href = `${f}?poem=${encodeURIComponent(p.poem_topic_id || '')}&hl_scroll=1`;
    } else {
      href = `reader.html?vol=${encodeURIComponent(p.vol)}&file=${encodeURIComponent(p.file)}`;
      if (p.topic_idx > 0) href += `&topic=${p.topic_idx}`;
    }
    if (lang === 'ja') href += '&lang=ja';

    const ctxLabel = isPoem ? (lang === 'ja' ? '詩' : 'Poema') : (lang === 'ja' ? '教え' : 'Ensinamento');
    // Poema traz o verso em excerpt → inline. Ensino mostra só o "Vol N" à direita.
    const volLabel = isPoem ? '' : _volLabel(p.vol, lang);
    const inline = p.excerpt ? `<div class="mural-poem">${_esc(p.excerpt)}</div>` : '';
    const reacted = p.i_reacted ? ' reacted' : '';
    const reactAria = lang === 'ja' ? '共感する' : 'Tocou meu coração';
    const author = lang === 'ja' ? 'ある教師' : 'um ministro';

    return `
      <div class="mural-card">
        <div class="mural-ctx"><span>${ctxLabel}</span>${volLabel ? `<span class="vol">${_esc(volLabel)}</span>` : ''}</div>
        <div class="mural-ctx-title"><a href="${href}">${_esc(title)}</a></div>
        ${inline}
        <div class="mural-reflection"><div class="mural-body">${_esc(p.body)}</div></div>
        <div class="mural-foot">
          <button class="mural-react${reacted}" data-post-id="${_esc(p.id)}" aria-pressed="${p.i_reacted ? 'true' : 'false'}" aria-label="${reactAria}">
            ${IC_HEART}<span class="mural-react-count">${p.reaction_count || 0}</span>
          </button>
          <span class="mural-meta"><span class="mural-by">${author}</span><span class="mural-sep">·</span><span class="mural-date">${_relDate(p.approved_at)}</span></span>
        </div>
      </div>`;
  }

  // Filtro por tipo + ordem fixa por recência, client-side.
  function _view() {
    let arr = _all;
    if (_filter === 'poema') arr = arr.filter(p => p.vol === 'poetry');
    else if (_filter === 'ensino') arr = arr.filter(p => p.vol !== 'poetry');
    arr = arr.slice();
    arr.sort((a, b) => new Date(b.approved_at) - new Date(a.approved_at));
    return arr;
  }

  function _barHtml() {
    const lang = _lang();
    const L = lang === 'ja'
      ? { tudo: 'すべて', ensino: '教え', poema: '詩' }
      : { tudo: 'Tudo', ensino: 'Ensinamentos', poema: 'Poemas' };
    const fOn = v => (_filter === v ? ' active' : '');
    return `
      <div class="mural-filtergroup">
        <button class="mural-filter${fOn('all')}" data-filter="all">${L.tudo}</button>
        <button class="mural-filter${fOn('ensino')}" data-filter="ensino">${IC_BOOK}${L.ensino}</button>
        <button class="mural-filter${fOn('poema')}" data-filter="poema">${IC_FEATHER}${L.poema}</button>
      </div>`;
  }

  function _emptyHtml() {
    const lang = _lang();
    if (lang === 'ja') {
      return `<div class="mural-empty"><div class="mural-empty-emoji">🌱</div>
        <div class="mural-empty-title">広場はまだ始まったばかり</div>
        <div class="mural-empty-desc">最初の感想を共有しましょう。御教えや詩を開いて「感想」をタップしてください。</div></div>`;
    }
    return `<div class="mural-empty"><div class="mural-empty-emoji">🌱</div>
      <div class="mural-empty-title">O mural está só começando</div>
      <div class="mural-empty-desc">Seja o primeiro a compartilhar uma reflexão: abra um Ensinamento ou poema e toque em "Compartilhar uma reflexão".</div></div>`;
  }

  // Vazio por causa do FILTRO (há posts, mas não desse tipo) — não é o vazio global.
  function _filterEmptyHtml() {
    const lang = _lang();
    const msg = _filter === 'poema'
      ? (lang === 'ja' ? 'まだ詩への感想はありません。' : 'Ainda não há reflexões sobre poemas.')
      : (lang === 'ja' ? 'まだ教えへの感想はありません。' : 'Ainda não há reflexões sobre Ensinamentos.');
    return `<div class="mural-empty"><div class="mural-empty-emoji">🌱</div><div class="mural-empty-desc">${msg}</div></div>`;
  }

  function _render() {
    const feed = document.getElementById('mural-feed');
    const barEl = document.getElementById('mural-bar');
    if (!feed) return;
    // Vazio global: sem barra, só o convite.
    if (_all.length === 0) {
      if (barEl) barEl.innerHTML = '';
      feed.innerHTML = _emptyHtml();
      return;
    }
    if (barEl) barEl.innerHTML = _barHtml();
    const view = _view();
    const slice = view.slice(0, _shown);
    if (slice.length === 0) { feed.innerHTML = _filterEmptyHtml(); return; }
    const more = (_shown < view.length)
      ? `<button class="mural-loadmore" id="mural-loadmore">${_lang() === 'ja' ? 'もっと見る' : 'Carregar mais'}</button>`
      : '';
    // Cards no grid; load-more e empty-state ficam FORA do grid (não viram célula).
    feed.innerHTML = '<div class="mural-grid">' + slice.map(_cardHtml).join('') + '</div>' + more;
  }

  async function _load() {
    if (_loaded || _loading) return;
    _loading = true;
    const supa = _supa();
    let batch = [];
    if (supa) {
      try {
        const { data, error } = await supa.rpc('get_study_feed', { p_limit: FETCH_CAP, p_before: null });
        if (!error && data) batch = data;
      } catch (e) { /* silent */ }
    }
    _all = batch;
    _loaded = true;
    _loading = false;
    if (_all.length >= FETCH_CAP) {
      // Sem cap silencioso: avisa que ordenação/filtro só veem os mais recentes.
      console.warn('[mural] feed no teto de ' + FETCH_CAP + ' itens — sort/filter consideram só os ' + FETCH_CAP + ' mais recentes. TODO: mover p/ o RPC.');
    }
    _render();
    _saveLastSeen();
  }

  // last_seen = o approved_at MAIS RECENTE de tudo carregado (não o 1º card —
  // que, ordenado por "Mais tocados", pode não ser o mais novo por data).
  function _saveLastSeen() {
    if (_all.length) {
      let newest = '';
      for (const p of _all) { if (p.approved_at && p.approved_at > newest) newest = p.approved_at; }
      if (newest) { try { localStorage.setItem('mural_last_seen', newest); } catch (e) {} }
    }
    document.querySelectorAll('.mural-dot').forEach(d => { d.style.display = 'none'; });
  }

  async function _toggle(btn) {
    const supa = _supa();
    if (!supa) return;
    const id = btn.dataset.postId;
    if (!id) return;
    btn.disabled = true;
    try {
      const { data, error } = await supa.rpc('toggle_post_reaction', { p_post_id: id });
      if (!error) {
        const row = Array.isArray(data) ? (data[0] || {}) : (data || {});
        btn.classList.toggle('reacted', !!row.reacted);
        btn.setAttribute('aria-pressed', row.reacted ? 'true' : 'false');
        const cnt = btn.querySelector('.mural-react-count');
        if (cnt) cnt.textContent = row.count || 0;
        // Atualiza o dado (sem reordenar agora — o card não deve pular sob o dedo).
        const p = _all.find(x => x.id === id);
        if (p) { p.i_reacted = !!row.reacted; p.reaction_count = row.count || 0; }
      }
    } catch (e) { /* silent */ }
    btn.disabled = false;
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    const fb = e.target.closest('.mural-filter[data-filter]');
    if (fb) { if (_filter !== fb.dataset.filter) { _filter = fb.dataset.filter; _shown = PAGE; _render(); } return; }
    if (e.target.closest('#mural-loadmore')) { _shown += PAGE; _render(); return; }
    const rb = e.target.closest('.mural-react[data-post-id]');
    if (rb) { _toggle(rb); }
  });

  async function init() {
    const c = document.getElementById('mural-feed');
    if (!c) return;
    _all = []; _loaded = false; _loading = false;
    _filter = 'all'; _shown = PAGE;
    await _load();
  }

  window.initMuralPage = init;
})();
