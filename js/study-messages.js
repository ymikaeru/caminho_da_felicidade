// ============================================================
// Canal com o Reverendo — usuário-side (mensagens privadas)
// ============================================================
// O inverso de recommendations.js. Aqui o usuário ENVIA ao Reverendo:
//   - openShareWithReverendo(topicIdx): compositor a partir do ensinamento
//     aberto no reader (extrai vol/file/título como reader-recommend.js).
//   - openShareWithReverendoPoem(meta): idem, a partir de um card de poema
//     (meta = {vol:'poetry', file, poem_topic_id, title}).
//   - openMyConversations(): modal com as mensagens enviadas + respostas;
//     marca respostas como vistas (esvazia o badge).
//   - initStudyMessages(): on load, busca o sumário e revela o botão de
//     conversas (header + sandwich) com badge de respostas não-vistas.
//
// Canal 1:1 e privado: nada de anonimato — o Reverendo vê quem enviou.
// Depende de window.supabase (login.js) e dos modais de modals.js
// (buildShareModal / buildMyConversationsModal).
// ============================================================

(function () {
  let _msgState = { total: 0, unreadReplies: 0, list: null };
  let _shareCtx = null; // {vol, file, topic_idx, poem_topic_id, title}

  function _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _supa() {
    return (window.supabaseAuth && window.supabaseAuth.supabase)
      || window._supabaseClient
      || window.supabase
      || null;
  }

  function _lang() { return localStorage.getItem('site_lang') || 'pt'; }
  function _basePathForReader() {
    return window.location.pathname.includes('/mioshiec') ? '../' : '';
  }

  // Walter Fujii aparece como "Reverendo Walter" pro usuário (igual em
  // recommendations.js); outros admins pelo próprio nome.
  function _displayReplier(rawName) {
    const name = String(rawName || '').trim();
    if (name === 'Walter Fujii') return 'Reverendo Walter';
    return name || (_lang() === 'ja' ? 'ご住職' : 'o Reverendo');
  }

  // ── extração do ensinamento aberto (replica reader-recommend.js:
  //    _currentTeachingMeta, pra study-messages ser autocontido) ──────
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
    return { vol, file, topic_idx, poem_topic_id: null, title };
  }

  // ── badge / reveal (espelha recommendations.js) ───────────────────
  function _updateBadge(btn) {
    const badge = btn?.querySelector('.conv-badge');
    if (!badge) return;
    if (_msgState.unreadReplies > 0) {
      badge.textContent = String(_msgState.unreadReplies);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  function _reveal() {
    const headerBtn = document.getElementById('headerConversationsBtn');
    if (headerBtn) {
      headerBtn.style.display = _msgState.total > 0 ? 'flex' : 'none';
      _updateBadge(headerBtn);
    }
    const navBtn = document.getElementById('mobileNavLinkConversations');
    if (navBtn) {
      navBtn.style.display = _msgState.total > 0 ? 'flex' : 'none';
      _updateBadge(navBtn);
    }
  }

  async function _fetchSummary() {
    const supa = _supa();
    if (!supa) return { total: 0, unreadReplies: 0 };
    try {
      const { data, error } = await supa.rpc('get_my_messages_summary');
      if (error) return { total: 0, unreadReplies: 0 };
      const row = Array.isArray(data) ? (data[0] || {}) : (data || {});
      return {
        total: Number(row.total || 0),
        unreadReplies: Number(row.unread_replies || 0),
      };
    } catch (e) {
      return { total: 0, unreadReplies: 0 };
    }
  }

  async function _fetchList() {
    const supa = _supa();
    if (!supa) return [];
    try {
      const { data, error } = await supa.rpc('get_my_messages');
      if (error) return [];
      return data || [];
    } catch (e) { return []; }
  }

  async function _markRepliesSeen() {
    const supa = _supa();
    if (!supa) return;
    try {
      await supa.rpc('mark_my_replies_seen');
      _msgState.unreadReplies = 0;
      _reveal();
    } catch (e) { /* silent */ }
  }

  // ── trava de scroll (igual recommendations.js) ────────────────────
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

  // ============================================================
  // Compositor — "Compartilhar com o Reverendo"
  // ============================================================
  function _open(topicIdx, poemMeta) {
    if (typeof isLoggedIn === 'function' && !isLoggedIn()) return;
    if (typeof buildShareModal === 'function') buildShareModal();
    const overlay = document.getElementById('shareModal');
    if (!overlay) return;

    const lang = _lang();
    if (poemMeta && poemMeta.vol) {
      _shareCtx = {
        vol: poemMeta.vol, file: poemMeta.file,
        topic_idx: 0, poem_topic_id: poemMeta.poem_topic_id || null,
        title: poemMeta.title || (lang === 'ja' ? '(詩)' : '(poema)'),
      };
    } else {
      const meta = _currentTeachingMeta(topicIdx);
      if (!meta.vol || !meta.file) {
        alert(lang === 'ja' ? '教えを特定できませんでした。' : 'Não consegui identificar o Ensinamento atual.');
        return;
      }
      _shareCtx = meta;
    }

    const titleEl = document.getElementById('shareTeachingTitle');
    if (titleEl) titleEl.textContent = _shareCtx.title || (lang === 'ja' ? '(無題)' : '(sem título)');
    const body = document.getElementById('shareBody');
    if (body) body.value = '';
    const msg = document.getElementById('shareMsg');
    if (msg) { msg.textContent = ''; msg.style.color = ''; }
    const submit = document.getElementById('shareSubmit');
    if (submit) submit.disabled = false;

    if (!overlay.classList.contains('active')) _lockScroll();
    overlay.classList.add('active');
    if (body) setTimeout(() => body.focus(), 60);
  }

  async function _submit() {
    const supa = _supa();
    if (!supa || !_shareCtx) return;
    const lang = _lang();
    const bodyEl = document.getElementById('shareBody');
    const text = (bodyEl?.value || '').trim();
    const msg = document.getElementById('shareMsg');
    const submit = document.getElementById('shareSubmit');
    if (!text) {
      if (msg) { msg.style.color = '#c00'; msg.textContent = lang === 'ja' ? 'メッセージを書いてください。' : 'Escreva uma mensagem.'; }
      return;
    }
    if (submit) submit.disabled = true;
    if (msg) { msg.style.color = 'var(--text-muted)'; msg.textContent = lang === 'ja' ? '送信中...' : 'Enviando...'; }
    try {
      const { error } = await supa.rpc('send_study_message', {
        p_vol: _shareCtx.vol,
        p_file: _shareCtx.file,
        p_topic_idx: _shareCtx.topic_idx || 0,
        p_poem_topic_id: _shareCtx.poem_topic_id || null,
        p_title: _shareCtx.title || null,
        p_body: text,
      });
      if (error) throw error;
      if (msg) { msg.style.color = '#2c8a3e'; msg.textContent = lang === 'ja' ? '✓ 送信しました。' : '✓ Enviado ao Reverendo.'; }
      // Atualiza o estado (agora há ≥1 mensagem → revela o botão de conversas).
      const s = await _fetchSummary();
      _msgState.total = s.total;
      _msgState.unreadReplies = s.unreadReplies;
      _reveal();
      setTimeout(_closeShare, 1100);
    } catch (e) {
      if (msg) { msg.style.color = '#c00'; msg.textContent = 'Erro: ' + (e.message || String(e)); }
      if (submit) submit.disabled = false;
    }
  }

  function _closeShare() {
    const overlay = document.getElementById('shareModal');
    if (!overlay) return;
    overlay.classList.remove('active');
    _unlockScroll();
  }

  // ============================================================
  // Minhas conversas com o Reverendo
  // ============================================================
  function _renderConversations(list) {
    const ul = document.getElementById('myConversationsResults');
    if (!ul) return;
    const lang = _lang();
    if (!list || list.length === 0) {
      const empty = lang === 'ja' ? 'まだメッセージはありません。' : 'Você ainda não enviou nenhuma mensagem.';
      ul.innerHTML = `<li class="search-empty" style="padding:20px; text-align:center; color:var(--text-muted);">${empty}</li>`;
      return;
    }
    const basePath = _basePathForReader();
    const relDate = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      const diff = Math.floor((Date.now() - d) / 86400000);
      if (diff === 0) return lang === 'ja' ? '今日' : 'hoje';
      if (diff === 1) return lang === 'ja' ? '昨日' : 'ontem';
      if (diff < 7) return `${diff}d`;
      return d.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR', { day: 'numeric', month: 'short' });
    };

    ul.innerHTML = list.map(m => {
      const isPoem = m.vol === 'poetry';
      const title = (lang === 'ja' && m.title_ja) ? m.title_ja
        : (m.title_pt || m.title_snapshot || (isPoem ? (lang === 'ja' ? '(詩)' : '(poema)') : (lang === 'ja' ? '(無題)' : '(sem título)')));
      let href;
      if (isPoem) {
        href = `${basePath}${m.file}?poem=${encodeURIComponent(m.poem_topic_id || '')}&hl_scroll=1`;
        if (!m.file.endsWith('.html')) href = `${basePath}${m.file}.html?poem=${encodeURIComponent(m.poem_topic_id || '')}&hl_scroll=1`;
      } else {
        href = `${basePath}reader.html?vol=${encodeURIComponent(m.vol)}&file=${encodeURIComponent(m.file)}`;
        if (m.topic_idx > 0) href += `&topic=${m.topic_idx}`;
      }
      if (lang === 'ja') href += '&lang=ja';

      const youLabel = lang === 'ja' ? 'あなた' : 'Você';
      const yourMsg = `<div style="font-family:'Crimson Pro',Georgia,serif;font-size:0.96rem;color:var(--text-main);font-style:italic;line-height:1.55;">"${_esc(m.body)}"</div>`;

      let replyHtml;
      if (m.admin_reply) {
        const who = _displayReplier(m.replied_by_name);
        replyHtml = `
          <div style="margin-top:12px;padding:12px 14px;background:var(--accent-soft, rgba(184,134,11,0.10));border-radius:6px;border-left:3px solid var(--accent);">
            <div style="font-size:0.68rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-bottom:5px;">${_esc(who)}</div>
            <div style="font-family:'Crimson Pro',Georgia,serif;font-size:0.98rem;color:var(--text-main);line-height:1.55;">${_esc(m.admin_reply)}</div>
          </div>`;
      } else {
        const waiting = lang === 'ja' ? '返信待ち' : 'Aguardando resposta';
        replyHtml = `<div style="margin-top:10px;font-size:0.74rem;color:var(--text-muted);font-style:italic;">⏳ ${waiting}</div>`;
      }

      return `
        <li style="padding:14px 24px 22px;border-bottom:1px solid var(--border);">
          <div style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font-ui);margin-bottom:6px;letter-spacing:.02em;">${_esc(youLabel)} · ${relDate(m.created_at)}</div>
          <a href="${href}" style="display:block;font-family:'Crimson Pro',Georgia,serif;font-size:1.06rem;font-weight:600;line-height:1.3;color:var(--text-main);text-decoration:none;margin-bottom:8px;">${_esc(title)}</a>
          ${yourMsg}
          ${replyHtml}
        </li>`;
    }).join('');
  }

  async function _openConversations() {
    if (typeof buildMyConversationsModal === 'function') buildMyConversationsModal();
    const overlay = document.getElementById('myConversationsModal');
    if (!overlay) return;
    if (!overlay.classList.contains('active')) _lockScroll();
    overlay.classList.add('active');
    const ul = document.getElementById('myConversationsResults');
    if (ul) ul.innerHTML = '<li class="search-empty" style="padding:20px; text-align:center; color:var(--text-muted);">Carregando...</li>';
    const list = await _fetchList();
    _msgState.list = list;
    _renderConversations(list);
    // Marca respostas como vistas em background.
    _markRepliesSeen();
  }

  function _closeConversations() {
    const overlay = document.getElementById('myConversationsModal');
    if (!overlay) return;
    overlay.classList.remove('active');
    _unlockScroll();
  }

  async function init() {
    const summary = await _fetchSummary();
    _msgState.total = summary.total;
    _msgState.unreadReplies = summary.unreadReplies;
    _reveal();
  }

  // Click-outside e ESC pra fechar os dois modais.
  document.addEventListener('click', (e) => {
    ['shareModal', 'myConversationsModal'].forEach(id => {
      const overlay = document.getElementById(id);
      if (overlay && overlay.classList.contains('active') && e.target === overlay) {
        overlay.classList.remove('active');
        _unlockScroll();
      }
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    ['shareModal', 'myConversationsModal'].forEach(id => {
      const overlay = document.getElementById(id);
      if (overlay && overlay.classList.contains('active')) {
        overlay.classList.remove('active');
        _unlockScroll();
      }
    });
  });

  // ============================================================
  // Botão "Compartilhar com o Reverendo" nos cards de poema
  // ============================================================
  // Espelha poetry-recommend.js (admin), mas pro usuário logado não-admin.
  // Injeta em .poetry-card__head e re-injeta a cada re-render do leitor de
  // poesia (que reescreve o innerHTML). Só roda nas páginas de coletânea.
  const _POEM_COLLECTIONS = {
    'yama-to-mizu': 'Yama to Mizu',
    'warai-no-izumi': 'Warai no Izumi',
    'akimaro-kineishu': 'Akemaro Kin’eishū',
    'gosanka-shoban': 'Gosanka-shū (1ª ed.)',
    'gosanka-kaitei': 'Gosanka-shū (rev.)',
    'gosanka-shikiten': 'Gosanka — Cerimônias',
  };
  function _canSharePoem() {
    try {
      return typeof isLoggedIn === 'function' && isLoggedIn()
        && !(typeof isAdminUser === 'function' && isAdminUser());
    } catch (e) { return false; }
  }
  function _initPoetryShare() {
    const slug = (location.pathname.split('/').pop() || '').replace(/\.html$/i, '');
    const collName = _POEM_COLLECTIONS[slug];
    if (!collName) return;
    const lang = _lang();
    const label = lang === 'ja' ? '共有' : 'Compartilhar';
    const aria = lang === 'ja' ? 'ご住職に共有' : 'Compartilhar com o Reverendo';
    const BTN = 'poetry-card__share';
    const BTN_HTML =
      `<button type="button" class="${BTN}" title="${aria}" aria-label="${aria}"` +
      ` style="display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:3px 9px;` +
      `font-family:var(--font-ui,inherit);font-size:0.72rem;font-weight:600;line-height:1;` +
      `color:var(--accent);background:transparent;border:1px solid var(--accent);` +
      `border-radius:var(--radius-pill,99px);cursor:pointer;">` +
      `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>` +
      `</svg><span>${label}</span>` +
      `</button>`;
    let obs = null;
    const scan = () => {
      if (!_canSharePoem()) return;
      document.querySelectorAll('.poetry-card:not([data-share-btn])').forEach(card => {
        const head = card.querySelector('.poetry-card__head');
        if (!head) return;
        card.dataset.shareBtn = '1';
        head.insertAdjacentHTML('beforeend', BTN_HTML);
      });
    };
    obs = new MutationObserver(() => {
      if (!_canSharePoem()) return;
      obs.disconnect();
      try { scan(); } finally { obs.observe(document.body, { childList: true, subtree: true }); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // isLoggedIn (localStorage) resolve cedo, mas os cards do leitor são
    // assíncronos; sem mutação o observer não dispara → tentamos algumas vezes.
    [200, 700, 1500, 3000].forEach(ms => setTimeout(scan, ms));

    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.' + BTN);
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (!_canSharePoem()) return;
      const card = btn.closest('[data-poem-topic-id]');
      if (!card) return;
      const topicId = card.dataset.poemTopicId || '';
      const n = parseInt(card.dataset.poemIndex, 10);
      const titleEl = card.querySelector('.poetry-card__title');
      const poemTitle = titleEl ? titleEl.textContent.trim() : '';
      if (!topicId) {
        alert(lang === 'ja' ? '詩を特定できませんでした。' : 'Não consegui identificar o poema. Recarregue a página.');
        return;
      }
      let composed = collName;
      if (!isNaN(n) && n) composed += ' · № ' + n;
      if (poemTitle) composed += ' — ' + poemTitle;
      _open(null, { vol: 'poetry', file: slug, poem_topic_id: topicId, title: composed });
    });
  }

  window.openShareWithReverendo = _open;                        // (topicIdx)
  window.openShareWithReverendoPoem = (meta) => _open(null, meta);
  window.submitShareWithReverendo = _submit;
  window.closeShareModal = _closeShare;
  window.openMyConversations = _openConversations;
  window.closeMyConversations = _closeConversations;
  window.initStudyMessages = init;

  _initPoetryShare();
})();
