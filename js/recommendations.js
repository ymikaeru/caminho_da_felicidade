// ============================================================
// Recomendações para Estudo — usuário-side
// ============================================================
// Admin cria recomendações via admin-supabase.html. Aqui:
//   - initRecommendations(): chamado on page load. Busca o sumário
//     (total + não-vistas) e, se total > 0, revela botão na home +
//     item no sandwich menu com badge de não-vistas.
//   - openRecommendations(): abre o modal, busca lista completa,
//     marca todas como vistas. Esvazia o badge.
//
// Depende de window.supabase (criado em login.js).
// ============================================================

(function () {
  let _recState = { total: 0, unseen: 0, everReceived: 0, list: null };

  function _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Mesma lógica de filtro de acesso de access.js. Recomendações em
  // volumes bloqueados pra esse user limitado ficam ocultas no modal.
  function _hiddenByAccess(rec) {
    try {
      if (localStorage.getItem('mioshie_auth') !== 'limited') return false;
      const config = JSON.parse(localStorage.getItem('mioshie_access_config') || 'null');
      if (!config) return false;
      const vc = config[rec.vol];
      if (vc == null) return false;
      if (vc === 'all') return true;
      if (Array.isArray(vc) && vc.includes(rec.file)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function _supa() {
    // login.js expõe o client em window.supabaseAuth.supabase.
    // reader.html também copia pra window._supabaseClient (módulo).
    return (window.supabaseAuth && window.supabaseAuth.supabase)
        || window._supabaseClient
        || window.supabase
        || null;
  }

  // Garante uma <style> única no head com a animação de entrada.
  // Idempotente: só injeta uma vez por página.
  function _ensureAnimStyle() {
    if (document.getElementById('recAnimStyle')) return;
    const s = document.createElement('style');
    s.id = 'recAnimStyle';
    s.textContent = `
      @keyframes recHeaderEnter {
        0%   { opacity: 0; transform: scale(0.7); }
        100% { opacity: 1; transform: scale(1); }
      }
      @keyframes recBadgePulse {
        0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(184,134,11,0.6); }
        50%      { transform: scale(1.25); box-shadow: 0 0 0 5px rgba(184,134,11,0); }
      }
      .rec-header-enter {
        animation: recHeaderEnter 0.45s cubic-bezier(0.34, 1.4, 0.5, 1) both;
      }
      .rec-badge-pulse {
        animation: recBadgePulse 1.4s ease-in-out 2;
        animation-delay: 0.5s;
      }
      @media (prefers-reduced-motion: reduce) {
        .rec-header-enter, .rec-badge-pulse { animation: none; }
      }
    `;
    document.head.appendChild(s);
  }

  // Aplica/atualiza badge num botão (header ou sandwich menu).
  function _updateBadge(btn) {
    const badge = btn?.querySelector('.rec-badge');
    if (!badge) return;
    if (_recState.unseen > 0) {
      badge.textContent = String(_recState.unseen);
      badge.style.display = 'inline-flex';
      badge.classList.remove('rec-badge-pulse');
      void badge.offsetWidth;
      badge.classList.add('rec-badge-pulse');
    } else {
      badge.style.display = 'none';
      badge.classList.remove('rec-badge-pulse');
    }
  }

  function _reveal(count) {
    _ensureAnimStyle();
    // Botão envelope no header (injetado por nav.js).
    const headerBtn = document.getElementById('headerRecommendationsBtn');
    if (headerBtn) {
      const wasHidden = headerBtn.style.display === 'none' || !headerBtn.style.display;
      headerBtn.style.display = count > 0 ? 'flex' : 'none';
      if (count > 0 && wasHidden) {
        headerBtn.classList.remove('rec-header-enter');
        void headerBtn.offsetWidth;
        headerBtn.classList.add('rec-header-enter');
      }
      _updateBadge(headerBtn);
    }

    // Item do menu sanduíche — só aparece se o usuário já recebeu
    // pelo menos uma recomendação na vida (ativa, arquivada ou
    // expirada). Quem nunca recebeu não vê o item.
    const navBtn = document.getElementById('mobileNavLinkRecommendations');
    if (navBtn) {
      navBtn.style.display = _recState.everReceived > 0 ? 'flex' : 'none';
      _updateBadge(navBtn);
    }
  }

  async function _fetchSummary() {
    const supa = _supa();
    if (!supa) return { total: 0, unseen: 0, everReceived: 0 };
    try {
      const { data, error } = await supa.rpc('get_my_recommendations_summary');
      if (error) return { total: 0, unseen: 0, everReceived: 0 };
      const row = Array.isArray(data) ? (data[0] || {}) : (data || {});
      return {
        total: Number(row.total || 0),
        unseen: Number(row.unseen || 0),
        // ever_received pode não existir se a migração v4 ainda não rodou —
        // fallback pro total nesse caso (mesma lógica do v3).
        everReceived: Number(row.ever_received ?? row.total ?? 0),
      };
    } catch (e) {
      return { total: 0, unseen: 0, everReceived: 0 };
    }
  }

  async function _fetchList() {
    const supa = _supa();
    if (!supa) return [];
    try {
      const { data, error } = await supa.rpc('get_my_recommendations');
      if (error) return [];
      const list = (data || []).filter(r => !_hiddenByAccess(r));
      await _resolveAudioUrls(supa, list);
      return list;
    } catch (e) {
      return [];
    }
  }

  // Recomendações de áudio guardam só o PATH no bucket privado. Aqui
  // mintamos uma signed URL (validade longa pra cobrir a sessão de
  // escuta com seeks). Só funciona logado — anônimo não gera a URL.
  async function _resolveAudioUrls(supa, list) {
    const audios = (list || []).filter(r => r.audio_path);
    if (audios.length === 0) return;
    await Promise.all(audios.map(async (r) => {
      try {
        const { data, error } = await supa.storage
          .from('rec-audio').createSignedUrl(r.audio_path, 43200);
        if (!error && data) r._audioUrl = data.signedUrl;
      } catch (e) { /* sem URL → player mostra fallback */ }
    }));
  }

  // Computa o trecho "será arquivado em N dias" (compartilhado entre
  // o item de ensinamento e o de áudio).
  function _expHtml(r, lang) {
    if (!r.expires_at) return '';
    const daysLeft = Math.ceil((new Date(r.expires_at) - new Date()) / 86400000);
    if (daysLeft <= 0) return '';
    const expLbl = daysLeft === 1
      ? (lang === 'ja' ? '明日に自動アーカイブ' : 'será arquivado amanhã')
      : (lang === 'ja' ? `${daysLeft}日後に自動アーカイブ` : `será arquivado em ${daysLeft} dias`);
    const c = daysLeft <= 3 ? 'color:#c80;' : '';
    return ` <span style="opacity:0.4;">·</span> <span style="${c}">⏱ ${_esc(expLbl)}</span>`;
  }

  // ============================================================
  // Player de áudio inline — "editorial dourado".
  // Cada recomendação de áudio tem seu próprio player auto-contido
  // (botão play circular + barra de progresso + tempo) que toca DENTRO
  // da cartinha / da página. Sem miniplayer ancorado: ao fechar a
  // cartinha o áudio pausa (ver _close). Estética alinhada ao site
  // (acento ouro --accent, Outfit tabular no tempo); tudo via variáveis
  // → segue todos os temas. Reprodução dirigida pela classe .is-playing.
  // Exposto via window._zaudioRender / _zaudioMount.
  // ============================================================
  function _ensureZaudioStyle() {
    if (document.getElementById('zaudioStyle')) return;
    const s = document.createElement('style');
    s.id = 'zaudioStyle';
    s.textContent = `
      .zaudio { display:flex; align-items:center; gap:16px; margin-top:14px; padding:14px 16px; background:var(--surface,#fff); border:1px solid var(--border,#e4e4e0); border-radius:var(--radius,4px); box-shadow:var(--shadow-sm); }
      /* botão play/pause — círculo dourado refinado */
      .zaudio__btn { flex-shrink:0; width:44px; height:44px; padding:0; display:inline-flex; align-items:center; justify-content:center; background:transparent; border:1px solid var(--accent); border-radius:var(--radius-pill,99px); color:var(--accent); cursor:pointer; position:relative; transition:background .25s var(--ease), color .25s var(--ease), transform .2s var(--ease), box-shadow .25s var(--ease); }
      .zaudio__btn:hover { background:var(--accent-soft); transform:scale(1.05); }
      .zaudio__btn:active { transform:scale(.96); }
      .zaudio__btn:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
      .zaudio__btn svg { width:16px; height:16px; }
      .zaudio__icon-play { display:block; margin-left:2px; }
      .zaudio__icon-pause { display:none; }
      .zaudio.is-playing .zaudio__btn { background:var(--accent); color:var(--surface,#fff); box-shadow:0 6px 18px -4px var(--accent-mid); }
      .zaudio.is-playing .zaudio__icon-play { display:none; }
      .zaudio.is-playing .zaudio__icon-pause { display:block; }
      /* trilha de progresso — fina, dourada, com handle */
      .zaudio__track { flex:1; min-width:0; height:3px; position:relative; background:var(--border,#e4e4e0); border-radius:var(--radius-pill,99px); cursor:pointer; touch-action:none; transition:height .15s var(--ease); }
      .zaudio__track:hover { height:5px; }
      .zaudio__fill { position:absolute; top:0; left:0; height:100%; width:0%; background:var(--accent); border-radius:inherit; }
      .zaudio__handle { position:absolute; right:0; top:50%; width:11px; height:11px; border-radius:50%; background:var(--accent); transform:translate(50%,-50%) scale(0); transition:transform .15s var(--ease); box-shadow:0 1px 5px rgba(0,0,0,.28); }
      .zaudio__track:hover .zaudio__handle, .zaudio.is-playing .zaudio__handle { transform:translate(50%,-50%) scale(1); }
      /* tempo — Outfit tabular */
      .zaudio__time { flex-shrink:0; font-family:var(--font-ui); font-size:.72rem; font-weight:500; letter-spacing:.06em; color:var(--text-muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
      @media (prefers-reduced-motion: reduce) { .zaudio__btn, .zaudio__track, .zaudio__handle { transition:none; } }
      @media (max-width: 600px) { .zaudio { gap:12px; padding:13px 14px; } }
    `;
    document.head.appendChild(s);
  }

  function _zfmtTime(s) {
    if (!isFinite(s) || s < 0) return '--:--';
    s = Math.floor(s);
    const m = Math.floor(s / 60), sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // ── Posição de escuta (persistente) ───────────────────────────
  // Chave pelo CAMINHO do áudio (estável; a signed URL muda a cada
  // sessão, mas o pathname não). Permite continuar de onde parou mesmo
  // fechando o site.
  function _zPosKey(src) {
    try { return 'zaudio_pos:' + new URL(src, location.href).pathname; }
    catch (e) { return 'zaudio_pos:' + (src || ''); }
  }
  function _zLoadPos(src) {
    try { const v = parseFloat(localStorage.getItem(_zPosKey(src))); return isFinite(v) ? v : 0; }
    catch (e) { return 0; }
  }
  function _zSavePos(src, t) {
    try { if (isFinite(t) && t > 3) localStorage.setItem(_zPosKey(src), String(Math.floor(t))); } catch (e) {}
  }
  function _zClearPos(src) { try { localStorage.removeItem(_zPosKey(src)); } catch (e) {} }

  // Salva a posição de tudo que estiver tocando ao sair/ocultar a página
  // (fechar aba, navegar) — cobre o caso em que não há evento 'pause'.
  let _zPagehideWired = false;
  function _zWirePagehide() {
    if (_zPagehideWired) return;
    _zPagehideWired = true;
    window.addEventListener('pagehide', () => {
      document.querySelectorAll('.zaudio audio').forEach(a => {
        if (a && a.src && !a.paused) _zSavePos(a.src, a.currentTime);
      });
    });
  }

  // Liga clicar/arrastar numa track a uma função de seek (ratio 0..1).
  function _zBindTrack(track, onSeek) {
    const at = (clientX) => {
      const r = track.getBoundingClientRect();
      if (!r.width) return;
      onSeek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
    };
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      at(e.clientX);
      const move = (ev) => at(ev.clientX);
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  // HTML do player inline AUTO-CONTIDO — tem seu próprio <audio> e toca
  // ali dentro (na cartinha / na página). Sem miniplayer ancorado.
  function _zaudioRender(opts) {
    _ensureZaudioStyle();
    const src = (opts && opts.src) ? opts.src : '';
    return `
      <div class="zaudio" data-src="${_esc(src)}">
        <audio preload="metadata" src="${_esc(src)}"></audio>
        <button type="button" class="zaudio__btn" aria-label="Tocar">
          <svg class="zaudio__icon-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          <svg class="zaudio__icon-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
        </button>
        <div class="zaudio__track" aria-hidden="true"><div class="zaudio__fill"><span class="zaudio__handle"></span></div></div>
        <div class="zaudio__time"><span class="zaudio__cur">0:00</span> / <span class="zaudio__dur">--:--</span></div>
      </div>`;
  }

  // Liga os players inline ainda não montados dentro de `root`. Cada um
  // toca no próprio <audio>. Só um por vez (ao tocar, pausa os outros).
  function _zaudioMount(root) {
    if (!root) return;
    _ensureZaudioStyle();
    _zWirePagehide();
    root.querySelectorAll('.zaudio:not([data-mounted])').forEach(p => {
      p.setAttribute('data-mounted', '1');
      const audio = p.querySelector('audio');
      const btn = p.querySelector('.zaudio__btn');
      const track = p.querySelector('.zaudio__track');
      const fill = p.querySelector('.zaudio__fill');
      const cur = p.querySelector('.zaudio__cur');
      const dur = p.querySelector('.zaudio__dur');
      const src = p.dataset.src || (audio && audio.src) || '';
      if (!audio || !btn || !track) return;
      let lastSaved = -10;

      // Ao ter metadados: mostra duração e RETOMA de onde parou (se houver
      // posição salva). Não dá play sozinho — o navegador bloqueia após
      // navegação; só posiciona, e a pessoa toca pra continuar.
      const onMeta = () => {
        if (dur) dur.textContent = _zfmtTime(audio.duration);
        const saved = _zLoadPos(src);
        if (saved > 3 && audio.duration && saved < audio.duration - 2) {
          try { audio.currentTime = saved; } catch (e) {}
          if (fill) fill.style.width = (saved / audio.duration * 100) + '%';
          if (cur) cur.textContent = _zfmtTime(saved);
        }
      };
      audio.addEventListener('loadedmetadata', onMeta);
      if (audio.readyState >= 1) onMeta();

      audio.addEventListener('timeupdate', () => {
        const d = audio.duration || 0;
        if (fill) fill.style.width = d ? (audio.currentTime / d * 100) + '%' : '0%';
        if (cur) cur.textContent = _zfmtTime(audio.currentTime);
        if (Math.abs(audio.currentTime - lastSaved) >= 5) { lastSaved = audio.currentTime; _zSavePos(src, audio.currentTime); }
      });
      audio.addEventListener('play', () => {
        document.querySelectorAll('.zaudio audio').forEach(a => { if (a !== audio && !a.paused) a.pause(); });
        p.classList.add('is-playing');
        btn.setAttribute('aria-label', 'Pausar');
      });
      audio.addEventListener('pause', () => { p.classList.remove('is-playing'); btn.setAttribute('aria-label', 'Tocar'); _zSavePos(src, audio.currentTime); });
      audio.addEventListener('ended', () => { p.classList.remove('is-playing'); if (fill) fill.style.width = '0%'; _zClearPos(src); });

      btn.addEventListener('click', () => { if (audio.paused) audio.play(); else audio.pause(); });
      _zBindTrack(track, (ratio) => {
        if (audio.duration) { audio.currentTime = ratio * audio.duration; _zSavePos(src, audio.currentTime); }
        if (fill) fill.style.width = (ratio * 100) + '%';
      });
    });
  }

  async function _markSeen() {
    const supa = _supa();
    if (!supa) return;
    try {
      await supa.rpc('mark_recommendations_seen');
      _recState.unseen = 0;
      _reveal(_recState.total);
    } catch (e) { /* silent */ }
  }

  function _basePathForReader() {
    return window.location.pathname.includes('/mioshiec') ? '../' : '';
  }

  // Walter Fujii prefere ser referido como "Reverendo Walter" nas
  // recomendações exibidas ao usuário. Outros admins (ex: Michael
  // Yamada) aparecem pelo próprio display_name.
  function _displayRecommender(rawName) {
    const name = String(rawName || '').trim();
    if (name === 'Walter Fujii') return 'Reverendo Walter';
    return name;
  }

  function _renderList(list) {
    const ul = document.getElementById('recommendationsResults');
    if (!ul) return;
    const lang = localStorage.getItem('site_lang') || 'pt';
    const emptyMsg = lang === 'ja'
      ? '今のところおすすめはありません。'
      : 'Nenhuma recomendação no momento.';
    if (!list || list.length === 0) {
      ul.innerHTML = `<li class="search-empty" style="padding:20px; text-align:center; color:var(--text-muted);">${emptyMsg}</li>`;
      return;
    }
    const basePath = _basePathForReader();

    // ── helpers ────────────────────────────────────────────────────────
    const SVG = {
      teaching: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
      audio:    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
      poetry:   `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/></svg>`,
    };
    const iconCircle = (type) =>
      `<div style="width:30px;height:30px;border-radius:50%;background:var(--accent-soft,rgba(184,134,11,.13));color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${SVG[type]}</div>`;

    const relDate = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      const diff = Math.floor((Date.now() - d) / 86400000);
      if (diff === 0) return lang === 'ja' ? '今日' : 'hoje';
      if (diff === 1) return lang === 'ja' ? '昨日' : 'ontem';
      if (diff < 7) return `${diff}d`;
      return d.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR', { day: 'numeric', month: 'short' });
    };

    const ptExcerpt = (poemText) => {
      if (!poemText) return '';
      const isJP = s => /[぀-ヿ㐀-鿿]/.test(s);
      const pt = poemText.split('\n').filter(s => s && !isJP(s));
      if (!pt.length) return '';
      return `<div style="font-size:0.85rem;color:var(--text-muted);font-family:'Crimson Pro',Georgia,serif;font-style:italic;line-height:1.55;margin-top:6px;">${_esc(pt.join(' / '))}</div>`;
    };

    // Layout: [icon] [title block] [×]
    // Below: indent 40px (icon+gap) for secondary content
    const card = ({ type, title, titleHref, meta, below, recId }) => {
      const archLabel = lang === 'ja' ? 'アーカイブ' : 'Arquivar';
      const titleHtml = titleHref
        ? `<a href="${titleHref}" style="color:inherit;text-decoration:none;font-size:0.95rem;font-weight:600;line-height:1.3;">${_esc(title)}</a>`
        : `<span style="font-size:0.95rem;font-weight:600;line-height:1.3;color:var(--text-main);">${_esc(title)}</span>`;
      const archiveBtn = `<button type="button" data-rec-id="${_esc(recId)}" class="rec-archive-btn"
              title="${archLabel}" aria-label="${archLabel}"
              style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:3px;opacity:0.45;display:flex;align-items:center;flex-shrink:0;align-self:flex-start;margin-top:1px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            </button>`;
      return `
        <li style="padding:5px 12px;">
          <div style="padding:12px;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:flex-start;gap:10px;">
              ${iconCircle(type)}
              <div style="flex:1;min-width:0;">
                ${titleHtml}
                ${meta ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px;">${meta}</div>` : ''}
              </div>
              ${archiveBtn}
            </div>
            ${below ? `<div style="margin-top:8px;padding-left:40px;">${below}</div>` : ''}
          </div>
        </li>`;
    };

    // ── ordenação: áudio → poemas → ensinamentos (independente de data) ──
    const _typeOrd = r => r.audio_path ? 0 : r.vol === 'poetry' ? 1 : 2;
    const _groupLabel = [
      lang === 'ja' ? 'オーディオ' : 'Áudio',
      lang === 'ja' ? '詩' : 'Poemas',
      lang === 'ja' ? '教え' : 'Ensinamentos',
    ];
    const sorted = [...list].sort((a, b) => _typeOrd(a) - _typeOrd(b));
    let _prevGroup = -1;

    // ── per-type ────────────────────────────────────────────────────────
    ul.innerHTML = sorted.map(r => {
      const recommender = _displayRecommender(r.created_by_name);
      const date = relDate(r.created_at);
      const expHtml = _expHtml(r, lang);
      const metaParts = [recommender, date, expHtml].filter(Boolean);
      const meta = metaParts.join(`<span style="margin:0 4px;opacity:0.35;">·</span>`);

      const noteHtml = r.note
        ? `<div style="font-size:0.83rem;color:var(--text-muted);font-style:italic;line-height:1.45;">"${_esc(r.note)}"</div>`
        : '';

      const g = _typeOrd(r);
      const groupHdr = g !== _prevGroup
        ? `<li style="padding:10px 24px 3px;"><span style="font-size:0.62rem;font-weight:700;letter-spacing:.1em;color:var(--text-muted);text-transform:uppercase;">${_groupLabel[g]}</span></li>`
        : '';
      _prevGroup = g;

      if (r.audio_path) {
        const audioTitle = r.audio_title || (lang === 'ja' ? '音声' : 'Áudio');
        const player = r._audioUrl
          ? _zaudioRender({ src: r._audioUrl, title: audioTitle })
          : `<div style="font-size:0.78rem;color:#c00;">${lang === 'ja' ? '音声を読み込めませんでした。' : 'Não foi possível carregar o áudio.'}</div>`;
        const noteAfterPlayer = r.note ? `<div style="margin-top:20px;">${noteHtml}</div>` : '';
        return groupHdr + card({ type: 'audio', title: audioTitle, meta, below: player + noteAfterPlayer, recId: r.id });
      }

      if (r.vol === 'poetry') {
        let phref = `${basePath}${r.file}.html?poem=${encodeURIComponent(r.poem_topic_id || '')}&hl_scroll=1`;
        if (lang === 'ja') phref += '&lang=ja';
        const ptitle = r.poem_title || '(poema)';
        const below = ptExcerpt(r.poem_text) + noteHtml;
        return groupHdr + card({ type: 'poetry', title: ptitle, titleHref: phref, meta, below: below || '', recId: r.id });
      }

      // Ensinamento
      const title = (lang === 'ja' && r.title_ja) ? r.title_ja : (r.title_pt || '(sem título)');
      const idx = r.topic_idx != null ? r.topic_idx : 0;
      let href = `${basePath}reader.html?vol=${encodeURIComponent(r.vol)}&file=${encodeURIComponent(r.file)}`;
      if (idx > 0) href += `&topic=${idx}`;
      if (lang === 'ja') href += '&lang=ja';
      return groupHdr + card({ type: 'teaching', title, titleHref: href, meta, below: noteHtml, recId: r.id });
    }).join('');

    _zaudioMount(ul);

    // Wire dos botões de arquivar — uma vez por render. Evita binding
    // duplicado usando uma flag no UL.
    const ulEl = document.getElementById('recommendationsResults');
    if (ulEl && !ulEl.dataset.archiveWired) {
      ulEl.dataset.archiveWired = '1';
      ulEl.addEventListener('click', async (e) => {
        const btn = e.target.closest?.('.rec-archive-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.recId;
        if (!id) return;
        const supa = _supa();
        if (!supa) return;
        btn.disabled = true;
        btn.style.opacity = '0.5';
        const { error } = await supa.rpc('archive_my_recommendation', { p_id: id });
        if (error) {
          alert('Erro ao arquivar: ' + error.message);
          btn.disabled = false;
          btn.style.opacity = '';
          return;
        }
        // Re-fetch summary e lista pra refletir o arquivamento.
        const summary = await _fetchSummary();
        _recState.total = summary.total;
        _recState.unseen = summary.unseen;
        _reveal(summary.total);
        const fresh = await _fetchList();
        _recState.list = fresh;
        _renderList(fresh);
        // Se zerou, fecha o modal automaticamente após um momento.
        if (fresh.length === 0) {
          setTimeout(_close, 400);
        }
      });
    }
  }

  async function _open() {
    const overlay = document.getElementById('recommendationsModal');
    if (!overlay) return;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    // Render placeholder enquanto busca.
    const ul = document.getElementById('recommendationsResults');
    if (ul) ul.innerHTML = '<li class="search-empty" style="padding:20px; text-align:center; color:var(--text-muted);">Carregando...</li>';
    const list = await _fetchList();
    _recState.list = list;
    _renderList(list);
    // Marca como vistas em background. Não bloqueia a UI.
    _markSeen();
  }

  function _close() {
    const overlay = document.getElementById('recommendationsModal');
    if (!overlay) return;
    // Áudio vive dentro da cartinha: ao fechar, pausa o que estiver tocando.
    overlay.querySelectorAll('audio').forEach(a => { try { a.pause(); } catch (e) {} });
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  async function init() {
    // Requer autenticação (Supabase). Em páginas sem login, supabase
    // não existe e o gate cai pra "0 recs" → botões ficam ocultos.
    const summary = await _fetchSummary();
    _recState.total = summary.total;
    _recState.unseen = summary.unseen;
    _recState.everReceived = summary.everReceived;
    _reveal(summary.total);
  }

  // Click-outside e ESC pra fechar.
  document.addEventListener('click', (e) => {
    const overlay = document.getElementById('recommendationsModal');
    if (!overlay || !overlay.classList.contains('active')) return;
    if (e.target === overlay) _close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlay = document.getElementById('recommendationsModal');
    if (overlay && overlay.classList.contains('active')) _close();
  });

  window._zaudioRender = _zaudioRender;
  window._zaudioMount = _zaudioMount;

  window.openRecommendations = _open;
  window.closeRecommendations = _close;
  window.initRecommendations = init;
})();
