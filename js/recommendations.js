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

      // ── Analytics de escuta (Recomendar Áudio) ──────────────────────
      // Loga o % MÁXIMO alcançado (high-water mark) pelo CAMINHO estável do
      // áudio (data-audio-path) — NUNCA a signed URL, senão o join no admin
      // dá zero. Flush no pause/ended e a cada 15s tocando (cobre fechar a
      // aba sem pausar). Só envia se subiu; fire-and-forget; logado só.
      const audioPath = p.dataset.audioPath || '';
      let maxPct = 0, flushedPct = -1, flushedDone = false, flushTimer = null;
      const _logFlush = (done) => {
        if (!audioPath) return;
        const pct = Math.max(0, Math.min(100, Math.round(maxPct)));
        if (pct <= flushedPct && (!done || flushedDone)) return;
        flushedPct = pct; if (done) flushedDone = true;
        const supa = _supa();
        if (!supa) return;
        // IMPORTANTE: a query do supabase-js é lazy — o request HTTP só sai
        // com .then()/await. Um `supa.rpc(...)` solto NUNCA executa (foi esse o
        // bug: o player montava a chamada e descartava sem enviar). O .then
        // dispara o envio e ainda expõe erro (antes sumia em silêncio).
        supa.rpc('log_audio_progress', { p_audio_path: audioPath, p_percent: pct, p_completed: !!done })
          .then(({ error }) => { if (error) console.warn('[audio log] falhou:', error.message); })
          .catch((e) => { console.warn('[audio log] erro de rede:', e && e.message); });
      };
      const _logStart = () => { if (!flushTimer) flushTimer = setInterval(() => _logFlush(false), 15000); };
      const _logStop = () => { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } };

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
        if (d > 0) { const pct = audio.currentTime / d * 100; if (pct > maxPct) maxPct = pct; }
        if (Math.abs(audio.currentTime - lastSaved) >= 5) { lastSaved = audio.currentTime; _zSavePos(src, audio.currentTime); }
      });
      audio.addEventListener('play', () => {
        document.querySelectorAll('.zaudio audio').forEach(a => { if (a !== audio && !a.paused) a.pause(); });
        p.classList.add('is-playing');
        btn.setAttribute('aria-label', 'Pausar');
        _logStart();
      });
      audio.addEventListener('pause', () => { p.classList.remove('is-playing'); btn.setAttribute('aria-label', 'Tocar'); _zSavePos(src, audio.currentTime); _logStop(); _logFlush(false); });
      audio.addEventListener('ended', () => { p.classList.remove('is-playing'); if (fill) fill.style.width = '0%'; _zClearPos(src); _logStop(); _logFlush(true); });

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

  // Dica de scroll: quando a lista tem mais do que cabe, aplica um fade
  // (máscara) no topo/fim da área rolável indicando que dá pra rolar. O fade
  // de baixo some ao chegar no fim; o de cima aparece depois de rolar.
  function _ensureScrollHintStyle() {
    if (document.getElementById('recScrollHintStyle')) return;
    const s = document.createElement('style');
    s.id = 'recScrollHintStyle';
    s.textContent = `
      #recommendationsResults.rec-more-below:not(.rec-more-above) {
        -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 40px), transparent);
                mask-image: linear-gradient(to bottom, #000 calc(100% - 40px), transparent);
      }
      #recommendationsResults.rec-more-above:not(.rec-more-below) {
        -webkit-mask-image: linear-gradient(to bottom, transparent, #000 32px);
                mask-image: linear-gradient(to bottom, transparent, #000 32px);
      }
      #recommendationsResults.rec-more-above.rec-more-below {
        -webkit-mask-image: linear-gradient(to bottom, transparent, #000 32px, #000 calc(100% - 40px), transparent);
                mask-image: linear-gradient(to bottom, transparent, #000 32px, #000 calc(100% - 40px), transparent);
      }
      .rec-scroll-cue {
        position: absolute; left: 50%; transform: translateX(-50%);
        width: 34px; height: 34px; border-radius: 50%;
        background: var(--surface); border: 1px solid var(--border);
        box-shadow: 0 4px 14px rgba(0,0,0,0.14);
        color: var(--accent); display: flex; align-items: center; justify-content: center;
        opacity: 0; pointer-events: none; transition: opacity .25s ease; z-index: 5;
      }
      .rec-scroll-cue.is-visible { opacity: 1; animation: recCueBounce 1.5s ease-in-out infinite; }
      @keyframes recCueBounce {
        0%, 100% { transform: translateX(-50%) translateY(0); }
        50%      { transform: translateX(-50%) translateY(4px); }
      }
      @media (prefers-reduced-motion: reduce) { .rec-scroll-cue.is-visible { animation: none; } }
    `;
    document.head.appendChild(s);
  }

  function _wireScrollHint(ul) {
    if (!ul) return;
    _ensureScrollHintStyle();
    const modal = ul.closest('.search-modal');
    // Setinha explícita (vive no .search-modal, fora da máscara da lista).
    let cue = modal ? modal.querySelector('.rec-scroll-cue') : null;
    if (modal && !cue) {
      cue = document.createElement('div');
      cue.className = 'rec-scroll-cue';
      cue.setAttribute('aria-hidden', 'true');
      cue.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      modal.appendChild(cue);
    }
    const update = () => {
      const moreBelow = (ul.scrollHeight - ul.scrollTop - ul.clientHeight) > 8;
      const moreAbove = ul.scrollTop > 8;
      ul.classList.toggle('rec-more-below', moreBelow);
      ul.classList.toggle('rec-more-above', moreAbove);
      if (cue && modal) {
        if (moreBelow) {
          // logo acima do que vem depois da lista (áudio/rodapé).
          const belowH = modal.clientHeight - (ul.offsetTop + ul.clientHeight);
          cue.style.bottom = (belowH + 10) + 'px';
          cue.classList.add('is-visible');
        } else {
          cue.classList.remove('is-visible');
        }
      }
    };
    if (!ul.dataset.scrollHintWired) {
      ul.dataset.scrollHintWired = '1';
      ul.addEventListener('scroll', update, { passive: true });
    }
    update();
    // re-checa quando a fonte serifada carrega (muda a altura) e num tick extra
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(update).catch(() => {});
    setTimeout(update, 120);
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
    // Sem ícones (design nórdico): a tipografia carrega a hierarquia.
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
      return `<div style="font-size:0.92rem;color:var(--text-muted);font-family:'Crimson Pro',Georgia,serif;font-style:italic;line-height:1.55;">${_esc(pt.join(' / '))}</div>`;
    };

    // Card nórdico: sem ícone, sem linha separadora. Hierarquia por tipo —
    // eyebrow (coletânea, opcional) → título serifado → meta → nota/trecho.
    // Itens separados por espaço (padding), não por borda.
    const card = ({ kicker, title, titleHref, meta, below, recId }) => {
      const archLabel = lang === 'ja' ? 'アーカイブ' : 'Arquivar';
      const titleHtml = titleHref
        ? `<a href="${titleHref}" style="display:block;font-family:'Crimson Pro',Georgia,serif;font-size:1.12rem;font-weight:600;line-height:1.3;color:var(--text-main);text-decoration:none;">${_esc(title)}</a>`
        : `<span style="display:block;font-family:'Crimson Pro',Georgia,serif;font-size:1.12rem;font-weight:600;line-height:1.3;color:var(--text-main);">${_esc(title)}</span>`;
      const kickerHtml = kicker
        ? `<div style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font-ui);letter-spacing:.03em;margin-bottom:5px;">${_esc(kicker)}</div>`
        : '';
      const archiveBtn = `<button type="button" data-rec-id="${_esc(recId)}" class="rec-archive-btn"
              title="${archLabel}" aria-label="${archLabel}"
              style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:6px;margin:-6px -6px 0 0;opacity:0.55;display:flex;align-items:center;flex-shrink:0;align-self:flex-start;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            </button>`;
      return `
        <li style="padding:6px 24px 22px;">
          <div style="display:flex;align-items:flex-start;gap:18px;">
            <div style="flex:1;min-width:0;">
              ${kickerHtml}
              ${titleHtml}
              ${meta ? `<div style="font-size:0.72rem;color:var(--text-muted);font-family:var(--font-ui);margin-top:7px;letter-spacing:.02em;">${meta}</div>` : ''}
              ${below ? `<div style="margin-top:9px;display:flex;flex-direction:column;gap:8px;">${below}</div>` : ''}
            </div>
            ${archiveBtn}
          </div>
        </li>`;
    };

    // ── separa áudio (footer fixo) do resto (lista scrollável) ──────────
    const audioList = list.filter(r => r.audio_path);
    const otherList = list.filter(r => !r.audio_path);

    // Ordena restante: poemas → ensinamentos
    const _typeOrd = r => r.vol === 'poetry' ? 0 : 1;
    const _groupLabel = [
      lang === 'ja' ? '詩' : 'Poemas',
      lang === 'ja' ? '教え' : 'Ensinamentos',
    ];
    const sorted = [...otherList].sort((a, b) => _typeOrd(a) - _typeOrd(b));
    let _prevGroup = -1;

    // ── lista principal (scroll) ─────────────────────────────────────────
    ul.innerHTML = sorted.map(r => {
      const recommender = _displayRecommender(r.created_by_name);
      const date = relDate(r.created_at);
      const expHtml = _expHtml(r, lang);
      const metaParts = [recommender, date, expHtml].filter(Boolean);
      const meta = metaParts.join(`<span style="margin:0 4px;opacity:0.35;">·</span>`);
      const noteHtml = r.note
        ? `<div style="font-family:'Crimson Pro',Georgia,serif;font-size:0.96rem;color:var(--text-muted);font-style:italic;line-height:1.5;">"${_esc(r.note)}"</div>`
        : '';
      const g = _typeOrd(r);
      // Rótulo de seção quieto. Separação por espaço (sem linha): o primeiro
      // vem mais colado ao cabeçalho, os seguintes com respiro generoso.
      const groupHdr = g !== _prevGroup
        ? `<li style="padding:${_prevGroup === -1 ? '20px' : '32px'} 24px 12px;"><span style="font-size:0.66rem;font-weight:600;letter-spacing:.18em;color:var(--text-muted);text-transform:uppercase;opacity:0.7;font-family:var(--font-ui);">${_groupLabel[g]}</span></li>`
        : '';
      _prevGroup = g;

      if (r.vol === 'poetry') {
        let phref = `${basePath}${r.file}.html?poem=${encodeURIComponent(r.poem_topic_id || '')}&hl_scroll=1`;
        if (lang === 'ja') phref += '&lang=ja';
        // poem_title = "<Coletânea> · № N — <Título>" (ver _composeTitle, poetry-recommend.js).
        // Separa no 1º " — ": antes = coletânea (eyebrow discreto), depois = título (manchete).
        const raw = r.poem_title || '(poema)';
        const dash = raw.indexOf(' — ');
        const kicker = dash >= 0 ? raw.slice(0, dash).trim() : '';
        const ptitle = dash >= 0 ? raw.slice(dash + 3).trim() : raw;
        const below = ptExcerpt(r.poem_text) + noteHtml;
        return groupHdr + card({ kicker, title: ptitle, titleHref: phref, meta, below: below || '', recId: r.id });
      }

      const title = (lang === 'ja' && r.title_ja) ? r.title_ja : (r.title_pt || '(sem título)');
      const idx = r.topic_idx != null ? r.topic_idx : 0;
      let href = `${basePath}reader.html?vol=${encodeURIComponent(r.vol)}&file=${encodeURIComponent(r.file)}`;
      if (idx > 0) href += `&topic=${idx}`;
      // Trechos recomendados (v15): excerpt_ranges = [[start,end],...] — o
      // leitor pinta os intervalos e scrolla até o primeiro.
      const ranges = (Array.isArray(r.excerpt_ranges) && r.excerpt_ranges.length) ? r.excerpt_ranges : null;
      if (ranges) href += `&excerpt=${ranges.map(p => `${p[0]}:${p[1]}`).join(',')}`;
      if (lang === 'ja') href += '&lang=ja';
      let excerptHtml = '';
      if (ranges && r.excerpt_text) {
        excerptHtml = `<div style="font-size:0.92rem;color:var(--text-muted);font-family:'Crimson Pro',Georgia,serif;font-style:italic;line-height:1.55;border-left:2px solid var(--accent);padding-left:10px;">${_esc(r.excerpt_text.length > 260 ? r.excerpt_text.slice(0, 260) + '…' : r.excerpt_text)}</div>`;
      } else if (ranges) {
        const nLbl = lang === 'ja'
          ? `${ranges.length} 箇所のハイライト付き`
          : (ranges.length === 1 ? 'com 1 trecho destacado' : `com ${ranges.length} trechos destacados`);
        excerptHtml = `<div style="font-size:0.78rem;color:var(--accent);font-family:var(--font-ui);letter-spacing:.02em;">✦ ${nLbl}</div>`;
      }
      return groupHdr + card({ title, titleHref: href, meta, below: excerptHtml + noteHtml, recId: r.id });
    }).join('');

    // ── footer de áudio (fixo, compacto, acima de "Gerenciar todas") ────
    const audioFooter = document.getElementById('rec-audio-footer');
    if (audioFooter) {
      if (audioList.length === 0) {
        audioFooter.style.display = 'none';
        audioFooter.innerHTML = '';
      } else {
        audioFooter.style.display = 'block';
        // Áudio nórdico: hairline + rótulo "ÁUDIO" + player calmo. Sem faixa
        // dourada/sombra — o botão play (círculo contornado) é o único acento.
        // Classes zaudio mantidas pro _zaudioMount achar btn/track/fill/cur/dur.
        const audioLbl = lang === 'ja' ? '音声' : 'Áudio';
        const players = audioList.map((r, i) => {
          const audioTitle = r.audio_title || (lang === 'ja' ? '音声' : 'Áudio');
          const src = r._audioUrl || '';
          const aNote = r.note ? `<div style="font-family:'Crimson Pro',Georgia,serif;font-size:0.96rem;color:var(--text-muted);font-style:italic;line-height:1.45;">"${_esc(r.note)}"</div>` : '';
          const mt = i > 0 ? 'margin-top:22px;' : '';
          return src ? `
            <div class="zaudio" data-src="${_esc(src)}" data-audio-path="${_esc(r.audio_path)}"
              style="${mt}padding:0;border:none;box-shadow:none;background:transparent;border-radius:0;gap:18px;align-items:flex-start;">
              <audio preload="metadata" src="${_esc(src)}"></audio>
              <button type="button" class="zaudio__btn" aria-label="Tocar"
                style="width:42px;height:42px;flex-shrink:0;border-radius:50%;align-self:flex-start;margin-top:1px;">
                <svg class="zaudio__icon-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width:14px;height:14px;margin-left:2px;"><path d="M8 5v14l11-7z"/></svg>
                <svg class="zaudio__icon-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width:14px;height:14px;"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
              </button>
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:9px;">
                <div style="font-family:'Crimson Pro',Georgia,serif;font-size:1.08rem;font-weight:600;color:var(--text-main);line-height:1.3;">${_esc(audioTitle)}</div>
                ${aNote}
                <div style="display:flex;align-items:center;gap:12px;margin-top:2px;">
                  <div class="zaudio__track" aria-hidden="true" style="flex:1;"><div class="zaudio__fill"><span class="zaudio__handle"></span></div></div>
                  <div class="zaudio__time" style="font-size:0.68rem;white-space:nowrap;flex-shrink:0;letter-spacing:.04em;"><span class="zaudio__cur">0:00</span> / <span class="zaudio__dur">--:--</span></div>
                </div>
              </div>
            </div>`
          : `<div style="${mt}font-family:'Crimson Pro',Georgia,serif;font-size:1.05rem;font-weight:600;">${_esc(audioTitle)}</div>`;
        }).join('');
        audioFooter.innerHTML = `<div style="border-top:1px solid var(--border);padding:24px 24px 20px;"><div style="font-size:0.66rem;font-weight:600;letter-spacing:.18em;color:var(--text-muted);text-transform:uppercase;opacity:0.7;font-family:var(--font-ui);margin-bottom:16px;">${audioLbl}</div>${players}</div>`;
        _zaudioMount(audioFooter);
      }
    }

    // ── archive wiring (UL + footer, delegado no modal) ─────────────────
    const _archiveHandler = async (e) => {
      const btn = e.target.closest?.('.rec-archive-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.recId;
      if (!id) return;
      const supa = _supa();
      if (!supa) return;
      btn.disabled = true;
      btn.style.opacity = '0.3';
      const { error } = await supa.rpc('archive_my_recommendation', { p_id: id });
      if (error) {
        alert('Erro ao arquivar: ' + error.message);
        btn.disabled = false;
        btn.style.opacity = '';
        return;
      }
      const summary = await _fetchSummary();
      _recState.total = summary.total;
      _recState.unseen = summary.unseen;
      _reveal(summary.total);
      const fresh = await _fetchList();
      _recState.list = fresh;
      _renderList(fresh);
      if (fresh.length === 0) setTimeout(_close, 400);
    };

    const modal = document.getElementById('recommendationsModal');
    if (modal && !modal.dataset.archiveWired) {
      modal.dataset.archiveWired = '1';
      modal.addEventListener('click', _archiveHandler);
    }

    // Lista pronta — liga a dica de scroll (fade no topo/fim se houver overflow).
    _wireScrollHint(ul);
  }

  // Trava o scroll da pagina atras do modal. No mobile (iOS Safari)
  // `body { overflow:hidden }` sozinho nao segura o toque — fixamos o
  // body e guardamos/restauramos a posicao de scroll.
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
    if (document.body.style.position !== 'fixed') return; // nao estava travado
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    // Restaura sem animacao (html usa scroll-behavior: smooth).
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, _savedScrollY);
    html.style.scrollBehavior = prev;
  }

  async function _open() {
    const overlay = document.getElementById('recommendationsModal');
    if (!overlay) return;
    if (!overlay.classList.contains('active')) _lockScroll();
    overlay.classList.add('active');
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
    _unlockScroll();
  }

  // Banner discreto quando há recomendações não-vistas: o badge do
  // envelope passa batido em telas pequenas. 1x por sessão; clicar
  // leva à Central; o × dispensa.
  function _maybeShowBanner() {
    if (_recState.unseen <= 0) return;
    if (/recomendacoes\.html/.test(location.pathname)) return;   // já está na Central
    try { if (sessionStorage.getItem('recBannerShown')) return; } catch (e) { return; }
    try { sessionStorage.setItem('recBannerShown', '1'); } catch (e) {}
    const n = _recState.unseen;
    const el = document.createElement('div');
    el.id = 'recUnseenBanner';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%) translateY(8px);z-index:1200;'
      + 'display:flex;align-items:center;gap:10px;max-width:min(92vw,440px);padding:10px 14px;border-radius:12px;'
      + 'background:var(--card-bg,var(--bg-color,#fff));color:var(--text-main,#222);border:1px solid var(--border,#ccc);'
      + 'box-shadow:0 8px 28px rgba(0,0,0,.18);opacity:0;transition:opacity .25s,transform .25s;cursor:pointer;font-size:.92rem;';
    el.innerHTML = '<span style="flex:none;font-size:1.15rem;">📖</span>'
      + '<span style="flex:1;min-width:0;">' + (n > 1
        ? ('Você tem <b>' + n + ' Ensinamentos recomendados</b> ainda não vistos.')
        : 'Há um <b>novo Ensinamento recomendado</b> pra você.')
      + '</span>'
      + '<button type="button" aria-label="Dispensar" style="flex:none;background:none;border:none;color:var(--text-muted,#777);font-size:1.05rem;cursor:pointer;padding:2px 4px;">✕</button>';
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) { el.remove(); return; }
      const pref = location.pathname.includes('/mioshiec') ? '../' : '';
      location.href = pref + 'recomendacoes.html';
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%)'; });
    setTimeout(() => { if (el.isConnected) { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); } }, 12000);
  }

  async function init() {
    // Requer autenticação (Supabase). Em páginas sem login, supabase
    // não existe e o gate cai pra "0 recs" → botões ficam ocultos.
    const summary = await _fetchSummary();
    _recState.total = summary.total;
    _recState.unseen = summary.unseen;
    _recState.everReceived = summary.everReceived;
    _reveal(summary.total);
    _maybeShowBanner();
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
