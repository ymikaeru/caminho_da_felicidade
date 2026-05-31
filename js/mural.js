// ============================================================
// Mural de Descobertas — usuário-side (publicar + badge + poema)
// ============================================================
//   - openPublicarDescoberta(topicIdx): compositor a partir do ensinamento
//     aberto no reader.
//   - openPublicarDescobertaPoem(meta): a partir de um card de poema — meta
//     traz o TEXTO do poema em `excerpt`, pra aparecer inline no feed.
//   - initMuralBadge(): revela o item "Mural" no header/menu (logado) e um
//     ponto de "novidade" quando há descoberta nova desde a última visita.
//
// O FEED em si vive em mural.html / js/mural-page.js. Aqui só publicamos e
// sinalizamos. Pré-moderação: o post entra 'pending' (aprovação do admin).
// Depende de window.supabase (login.js) e buildDescobertaModal (modals.js).
// ============================================================

(function () {
  let _ctx = null; // {vol, file, topic_idx, poem_topic_id, excerpt, title}

  function _supa() {
    return (window.supabaseAuth && window.supabaseAuth.supabase)
        || window._supabaseClient
        || window.supabase
        || null;
  }
  function _lang() { return localStorage.getItem('site_lang') || 'pt'; }
  function _canPost() {
    try {
      return typeof isLoggedIn === 'function' && isLoggedIn()
          && !(typeof isAdminUser === 'function' && isAdminUser());
    } catch (e) { return false; }
  }

  // ── extração do ensinamento aberto (replica reader-recommend.js) ──
  function _currentTopicIdx() {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('topic');
      if (fromUrl !== null) {
        const n = parseInt(fromUrl, 10);
        if (!isNaN(n)) return n;
      }
      const topics = document.querySelectorAll('.topic-content');
      if (topics.length <= 1) return 0;
      const anchor = window.innerHeight / 3;
      let bestIdx = 0, bestDist = Infinity;
      topics.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.height === 0) return;
        const dist = Math.abs(r.top - anchor);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      });
      return bestIdx;
    } catch (e) { return 0; }
  }
  function _currentTeachingMeta(explicitTopicIdx) {
    const params = new URLSearchParams(window.location.search);
    let vol = params.get('vol') || params.get('v') || '';
    let file = params.get('file') || params.get('f') || '';
    if (!vol && !file) {
      const hash = window.location.hash.replace(/^#+/, '');
      const m = hash.match(/^v(\d+)\/(.+)$/i);
      if (m) { vol = `mioshiec${m[1]}`; file = m[2]; }
    }
    if (vol && !vol.startsWith('mioshiec')) vol = `mioshiec${vol}`;
    if (file && !file.endsWith('.html')) file += '.html';
    const topic_idx = (typeof explicitTopicIdx === 'number' && !isNaN(explicitTopicIdx))
      ? explicitTopicIdx : _currentTopicIdx();
    let title = '';
    const lang = _lang();
    const struct = (window._currentTopics || [])[topic_idx];
    if (struct) {
      title = lang === 'ja'
        ? (struct.title_ja || struct.title || '')
        : (struct.title_ptbr || struct.title_pt || struct.title || '');
    }
    if (!title) {
      const topics = document.querySelectorAll('.topic-content');
      const active = topics[topic_idx];
      const fontTitle = active?.querySelector('b > font[size="+2"], font[size="+2"]');
      title = fontTitle?.textContent
            || active?.querySelector('h2, h3, .topic-title')?.textContent
            || document.querySelector('.topic-content h1, .glass-pane h1, h1')?.textContent
            || document.title || '';
    }
    title = String(title)
      .replace(/\s*-\s*Caminho da Felicidade\s*$/i, '')
      .replace(/^Meishu-Sama:\s*/i, '')
      .replace(/^Ensinamento de (Meishu-Sama|Moisés)\s*[:\-]?\s*/i, '')
      .replace(/^Palestra de (Meishu-Sama|Moisés)\s*[:\-]?\s*/i, '')
      .replace(/^Orientação de (Meishu-Sama|Moisés)\s*[:\-]?\s*/i, '')
      .replace(/^["「『＂"](.*)["」』＂"]$/, '$1')
      .trim();
    return { vol, file, topic_idx, title };
  }

  // ── trava de scroll ──
  let _savedScrollY = 0;
  function _lockScroll() {
    _savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = `-${_savedScrollY}px`;
    document.body.style.position = 'fixed';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }
  function _unlockScroll() {
    if (document.body.style.position !== 'fixed') return;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, _savedScrollY);
    html.style.scrollBehavior = prev;
  }

  // ── compositor ──
  function _open(topicIdx, poemMeta, excerptOverride) {
    if (typeof isLoggedIn === 'function' && !isLoggedIn()) return;
    if (typeof buildDescobertaModal === 'function') buildDescobertaModal();
    const overlay = document.getElementById('descobertaModal');
    if (!overlay) return;
    const lang = _lang();
    if (poemMeta && poemMeta.vol) {
      _ctx = {
        vol: poemMeta.vol, file: poemMeta.file, topic_idx: 0,
        poem_topic_id: poemMeta.poem_topic_id || null,
        excerpt: poemMeta.excerpt || null,
        title: poemMeta.title || (lang === 'ja' ? '(詩)' : '(poema)'),
      };
    } else {
      const m = _currentTeachingMeta(topicIdx);
      if (!m.vol || !m.file) {
        alert(lang === 'ja' ? '教えを特定できませんでした。' : 'Não consegui identificar o Ensinamento atual.');
        return;
      }
      _ctx = { vol: m.vol, file: m.file, topic_idx: m.topic_idx, poem_topic_id: null, excerpt: excerptOverride || null, title: m.title };
    }
    const ctxEl = document.getElementById('descobertaContext');
    if (ctxEl) ctxEl.textContent = _ctx.title || (lang === 'ja' ? '(無題)' : '(sem título)');
    // Trecho grifado (quando vem do menu de seleção) — citação no composer.
    const exEl = document.getElementById('descobertaExcerpt');
    if (exEl) {
      if (_ctx.excerpt) { exEl.textContent = _ctx.excerpt; exEl.style.display = 'block'; }
      else { exEl.style.display = 'none'; exEl.textContent = ''; }
    }
    const body = document.getElementById('descobertaBody');
    if (body) body.value = '';
    const msg = document.getElementById('descobertaMsg');
    if (msg) { msg.textContent = ''; msg.style.color = ''; }
    const sb = document.getElementById('descobertaSubmit');
    if (sb) sb.disabled = false;
    if (!overlay.classList.contains('active')) _lockScroll();
    overlay.classList.add('active');
    if (body) setTimeout(() => body.focus(), 60);
  }

  async function _submit() {
    const supa = _supa();
    if (!supa || !_ctx) return;
    const lang = _lang();
    const body = (document.getElementById('descobertaBody')?.value || '').trim();
    const msg = document.getElementById('descobertaMsg');
    const sb = document.getElementById('descobertaSubmit');
    if (!body) {
      if (msg) { msg.style.color = '#c00'; msg.textContent = lang === 'ja' ? '内容をお書きください。' : 'Escreva sua reflexão.'; }
      return;
    }
    if (sb) sb.disabled = true;
    if (msg) { msg.style.color = 'var(--text-muted)'; msg.textContent = lang === 'ja' ? '送信中...' : 'Enviando...'; }
    try {
      const { error } = await supa.rpc('create_study_post', {
        p_vol: _ctx.vol,
        p_file: _ctx.file,
        p_topic_idx: _ctx.topic_idx || 0,
        p_poem_topic_id: _ctx.poem_topic_id || null,
        p_excerpt: _ctx.excerpt || null,
        p_title: _ctx.title || null,
        p_body: body,
      });
      if (error) throw error;
      if (msg) { msg.style.color = '#2c8a3e'; msg.textContent = lang === 'ja' ? '✓ 承認待ちで送信しました。' : '✓ Enviado para aprovação do Reverendo.'; }
      setTimeout(_close, 1300);
    } catch (e) {
      if (msg) { msg.style.color = '#c00'; msg.textContent = 'Erro: ' + (e.message || String(e)); }
      if (sb) sb.disabled = false;
    }
  }

  function _close() {
    const overlay = document.getElementById('descobertaModal');
    if (!overlay) return;
    overlay.classList.remove('active');
    _unlockScroll();
  }

  // ── item de nav "Mural" + ponto de novidade ──
  function _setDot(show) {
    document.querySelectorAll('.mural-dot').forEach(d => { d.style.display = show ? 'block' : 'none'; });
  }
  let _badgeShown = false;
  async function _initBadge(_attempt) {
    const logged = typeof isLoggedIn === 'function' && isLoggedIn();
    const headerBtn = document.getElementById('headerMuralBtn');
    const navBtn = document.getElementById('mobileNavLinkMural');
    if (!logged) {
      if (_badgeShown) return;
      // A sessão (login.js) restaura de forma assíncrona; re-tenta no load.
      // Os listeners de pageshow/visibilidade/foco abaixo cobrem sessões lentas.
      const attempt = _attempt || 0;
      if (attempt < 20) setTimeout(() => _initBadge(attempt + 1), 700);
      return;
    }
    _badgeShown = true;
    if (headerBtn) headerBtn.style.display = 'flex';
    if (navBtn) navBtn.style.display = 'flex';
    const supa = _supa();
    if (!supa) return;
    try {
      const { data, error } = await supa.rpc('get_mural_summary');
      if (error) return;
      const row = Array.isArray(data) ? (data[0] || {}) : (data || {});
      if (!row.newest) { _setDot(false); return; }
      const lastSeen = localStorage.getItem('mural_last_seen') || '';
      const hasNew = !lastSeen || new Date(row.newest) > new Date(lastSeen);
      _setDot(hasNew);
    } catch (e) { /* silent */ }
  }
  // Rede de segurança: se a sessão demorar além do retry do load, revela
  // quando o usuário volta à aba / foca a janela / a página é restaurada.
  ['pageshow', 'visibilitychange', 'focus'].forEach(ev =>
    window.addEventListener(ev, () => _initBadge())
  );

  // ── botão "Descoberta" nos cards de poema (espelha poetry-recommend.js) ──
  const _POEM_COLLECTIONS = {
    'yama-to-mizu': 'Yama to Mizu',
    'warai-no-izumi': 'Warai no Izumi',
    'akimaro-kineishu': 'Akimaro Kin’eishū',
    'gosanka-shoban': 'Gosanka-shū (1ª ed.)',
    'gosanka-kaitei': 'Gosanka-shū (rev.)',
    'gosanka-shikiten': 'Gosanka — Cerimônias',
  };
  function _initPoetryDiscovery() {
    const slug = (location.pathname.split('/').pop() || '').replace(/\.html$/i, '');
    const collName = _POEM_COLLECTIONS[slug];
    if (!collName) return;
    const lang = _lang();
    const label = lang === 'ja' ? '感想' : 'Reflexão';
    const aria = lang === 'ja' ? '感想を共有' : 'Compartilhar uma reflexão';
    const BTN = 'poetry-card__discover';
    const BTN_HTML =
      `<button type="button" class="${BTN}" title="${aria}" aria-label="${aria}"` +
      ` style="display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:3px 9px;` +
      `font-family:var(--font-ui,inherit);font-size:0.72rem;font-weight:600;line-height:1;` +
      `color:var(--accent);background:transparent;border:1px solid var(--accent);` +
      `border-radius:var(--radius-pill,99px);cursor:pointer;">` +
        `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">` +
          `<path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>` +
        `</svg><span>${label}</span>` +
      `</button>`;
    let obs = null;
    const scan = () => {
      if (!_canPost()) return;
      document.querySelectorAll('.poetry-card:not([data-discover-btn])').forEach(card => {
        const head = card.querySelector('.poetry-card__head');
        if (!head) return;
        card.dataset.discoverBtn = '1';
        head.insertAdjacentHTML('beforeend', BTN_HTML);
      });
    };
    obs = new MutationObserver(() => {
      if (!_canPost()) return;
      obs.disconnect();
      try { scan(); } finally { obs.observe(document.body, { childList: true, subtree: true }); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    [200, 700, 1500, 3000].forEach(ms => setTimeout(scan, ms));

    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.' + BTN);
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (!_canPost()) return;
      const card = btn.closest('[data-poem-topic-id]');
      if (!card) return;
      const topicId = card.dataset.poemTopicId || '';
      const n = parseInt(card.dataset.poemIndex, 10);
      const titleEl = card.querySelector('.poetry-card__title');
      const poemTitle = titleEl ? titleEl.textContent.trim() : '';
      const origEl = card.querySelector('.poetry-card__original');
      const transEl = card.querySelector('.poetry-card__translation');
      const original = origEl ? origEl.textContent.trim() : '';
      const translation = transEl ? transEl.textContent.trim() : '';
      const poemText = [original, translation].filter(Boolean).join('\n');
      if (!topicId) {
        alert(lang === 'ja' ? '詩を特定できませんでした。' : 'Não consegui identificar o poema. Recarregue a página.');
        return;
      }
      let composed = collName;
      if (!isNaN(n) && n) composed += ' · № ' + n;
      if (poemTitle) composed += ' — ' + poemTitle;
      _open(null, { vol: 'poetry', file: slug, poem_topic_id: topicId, excerpt: poemText, title: composed });
    });
  }

  // ESC / click-outside fecha o compositor.
  document.addEventListener('click', (e) => {
    const overlay = document.getElementById('descobertaModal');
    if (overlay && overlay.classList.contains('active') && e.target === overlay) _close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlay = document.getElementById('descobertaModal');
    if (overlay && overlay.classList.contains('active')) _close();
  });

  window.openPublicarDescoberta = _open;                          // (topicIdx)
  window.openPublicarDescobertaPoem = (meta) => _open(null, meta);
  window.openReflexaoFromSelection = (excerpt, topicIdx) => _open(topicIdx, null, excerpt);
  window.submitDescoberta = _submit;
  window.closeDescobertaModal = _close;
  window.initMuralBadge = _initBadge;

  _initPoetryDiscovery();
})();
