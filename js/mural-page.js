// ============================================================
// Mural de Descobertas — o FEED (página mural.html)
// ============================================================
// Busca get_study_feed (anônimo, keyset paginado), renderiza cards e a
// reação 🙏 (toggle_post_reaction, atualiza com o retorno sem refetch).
// Poema vem com o texto inline (excerpt) → aparece aberto; ensinamento
// mostra título + link "abrir" (é longo). Grava last_seen ao carregar
// (esvazia o ponto de novidade no nav).
//
// Publicar descobertas é em js/mural.js (composer). Aqui só lê + reage.
// ============================================================

(function () {
  const PAGE = 20;
  let _feed = [];
  let _exhausted = false;
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
    if (diff === 0) return lang === 'ja' ? '今日' : 'hoje';
    if (diff === 1) return lang === 'ja' ? '昨日' : 'ontem';
    if (diff < 7) return `${diff}d`;
    return d.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR', { day: 'numeric', month: 'short' });
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
    // Poema curto → aparece inline (aberto). Ensinamento → só título + link.
    const inline = (isPoem && p.excerpt) ? `<div class="mural-poem">${_esc(p.excerpt)}</div>` : '';
    const openLbl = lang === 'ja' ? '開く →' : 'abrir →';
    const reacted = p.i_reacted ? ' reacted' : '';

    return `
      <div class="mural-card">
        <div class="mural-ctx">${ctxLabel}</div>
        <div class="mural-ctx-title"><a href="${href}">${_esc(title)}</a></div>
        ${inline}
        <div class="mural-body">${_esc(p.body)}</div>
        <div class="mural-foot">
          <button class="mural-react${reacted}" data-post-id="${_esc(p.id)}" aria-pressed="${p.i_reacted ? 'true' : 'false'}">
            <span class="emoji">🙏</span><span class="mural-react-count">${p.reaction_count || 0}</span>
          </button>
          <a href="${href}" style="font-family:'Outfit',sans-serif; font-size:0.8rem; color:var(--accent); text-decoration:none;">${openLbl}</a>
          <span class="mural-date">${_relDate(p.approved_at)}</span>
        </div>
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

  function _render() {
    const c = document.getElementById('mural-feed');
    if (!c) return;
    if (_feed.length === 0) { c.innerHTML = _emptyHtml(); return; }
    const more = _exhausted ? '' : `<button class="mural-loadmore" id="mural-loadmore">${_lang() === 'ja' ? 'もっと見る' : 'Carregar mais'}</button>`;
    c.innerHTML = _feed.map(_cardHtml).join('') + more;
  }

  async function _fetch(before) {
    const supa = _supa();
    if (!supa) return [];
    try {
      const { data, error } = await supa.rpc('get_study_feed', { p_limit: PAGE, p_before: before || null });
      if (error) return [];
      return data || [];
    } catch (e) { return []; }
  }

  async function _load() {
    if (_loading || _exhausted) return;
    _loading = true;
    const before = _feed.length ? _feed[_feed.length - 1].approved_at : null;
    const batch = await _fetch(before);
    if (batch.length < PAGE) _exhausted = true;
    _feed = _feed.concat(batch);
    _loading = false;
    _render();
    _saveLastSeen();
  }

  // Marca tudo como visto (o topo é o mais novo) e apaga o ponto de novidade.
  function _saveLastSeen() {
    if (_feed.length) {
      try { localStorage.setItem('mural_last_seen', _feed[0].approved_at); } catch (e) {}
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
        const p = _feed.find(x => x.id === id);
        if (p) { p.i_reacted = !!row.reacted; p.reaction_count = row.count || 0; }
      }
    } catch (e) { /* silent */ }
    btn.disabled = false;
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    if (e.target.closest('#mural-loadmore')) { _load(); return; }
    const rb = e.target.closest('.mural-react[data-post-id]');
    if (rb) { _toggle(rb); }
  });

  async function init() {
    const c = document.getElementById('mural-feed');
    if (!c) return;
    _feed = [];
    _exhausted = false;
    await _load();
  }

  window.initMuralPage = init;
})();
