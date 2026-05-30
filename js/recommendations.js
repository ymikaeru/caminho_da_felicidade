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
  // Player de áudio (inline) + MINIPLAYER fixo — "editorial dourado".
  // Um único motor de áudio persistente vive numa barra ancorada no
  // rodapé (.zmini), montada no <body> uma vez. Os players inline da
  // cartinha/página (.zaudio) são SUPERFÍCIES DE CONTROLE: clicar play
  // aciona o motor e o inline espelha o estado. Assim o áudio sobrevive
  // a fechar o modal / re-render / rolar a tela (mas não a trocar de
  // página — limitação de site multi-página). Estética alinhada ao site:
  // acento ouro (--accent), serif Crimson Pro no título, Outfit tabular
  // no tempo, sombras premium. Tudo via variáveis → segue todos os temas.
  // Estado de reprodução é dirigido pela classe .is-playing (CSS).
  // Exposto via window._zaudioRender / _zaudioMount.
  // ============================================================
  const _zmini = { audio: null, bar: null, els: null, src: null, title: '' };
  const _zDurCache = {};

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
      .zaudio__icon-play, .zmini__icon-play { display:block; margin-left:2px; }
      .zaudio__icon-pause, .zmini__icon-pause { display:none; }
      .is-playing .zaudio__btn, .is-playing .zmini__btn { background:var(--accent); color:var(--surface,#fff); box-shadow:0 6px 18px -4px var(--accent-mid); }
      .is-playing .zaudio__icon-play, .is-playing .zmini__icon-play { display:none; }
      .is-playing .zaudio__icon-pause, .is-playing .zmini__icon-pause { display:block; }
      /* trilha de progresso — fina, dourada, com handle */
      .zaudio__track { flex:1; min-width:0; height:3px; position:relative; background:var(--border,#e4e4e0); border-radius:var(--radius-pill,99px); cursor:pointer; touch-action:none; transition:height .15s var(--ease); }
      .zaudio__track:hover { height:5px; }
      .zaudio__fill { position:absolute; top:0; left:0; height:100%; width:0%; background:var(--accent); border-radius:inherit; }
      .zaudio__handle { position:absolute; right:0; top:50%; width:11px; height:11px; border-radius:50%; background:var(--accent); transform:translate(50%,-50%) scale(0); transition:transform .15s var(--ease); box-shadow:0 1px 5px rgba(0,0,0,.28); }
      .zaudio__track:hover .zaudio__handle, .is-playing .zaudio__handle { transform:translate(50%,-50%) scale(1); }
      /* tempo — Outfit tabular */
      .zaudio__time { flex-shrink:0; font-family:var(--font-ui); font-size:.72rem; font-weight:500; letter-spacing:.06em; color:var(--text-muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
      /* ---- miniplayer ancorado ---- */
      .zmini { position:fixed; bottom:20px; right:20px; z-index:1000; display:none; align-items:center; gap:15px; width:min(400px, calc(100vw - 40px)); padding:15px 17px; background:var(--surface,#fff); border:1px solid var(--border,#e4e4e0); border-radius:var(--radius,4px); box-shadow:var(--shadow-premium); overflow:hidden; }
      .zmini::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; background:linear-gradient(90deg, var(--accent), transparent); }
      .zmini.active { display:flex; animation:zminiIn .42s var(--ease) both; }
      @keyframes zminiIn { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
      .zmini__body { flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; }
      .zmini__head { display:flex; align-items:center; gap:9px; min-width:0; }
      .zmini__title { flex:1; min-width:0; font-family:var(--font-serif, Georgia, serif); font-size:.98rem; font-weight:600; line-height:1.2; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; letter-spacing:.01em; }
      .zmini__row { display:flex; align-items:center; gap:13px; }
      .zmini__close { flex-shrink:0; align-self:flex-start; width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; background:none; border:none; font-size:1.3rem; line-height:1; color:var(--text-muted); cursor:pointer; padding:0; border-radius:var(--radius-sm,2px); transition:color .15s var(--ease), background .15s var(--ease); }
      .zmini__close:hover { color:var(--text-main); background:var(--accent-soft); }
      /* equalizer dourado — anima só tocando */
      .zeq { display:none; align-items:flex-end; gap:2px; height:13px; flex-shrink:0; }
      .is-playing .zeq { display:inline-flex; }
      .zeq i { display:block; width:2px; height:100%; background:var(--accent); border-radius:1px; transform-origin:bottom; transform:scaleY(.35); animation:zeq 1s var(--ease) infinite; }
      .zeq i:nth-child(2){ animation-delay:.22s; }
      .zeq i:nth-child(3){ animation-delay:.44s; }
      @keyframes zeq { 0%,100%{ transform:scaleY(.35);} 50%{ transform:scaleY(1);} }
      @media (prefers-reduced-motion: reduce) {
        .zaudio__btn, .zaudio__track, .zaudio__handle, .zmini__close { transition:none; }
        .zmini.active { animation:none; }
        .zeq i { animation:none; transform:scaleY(.7); }
      }
    `;
    document.head.appendChild(s);
  }

  function _zfmtTime(s) {
    if (!isFinite(s) || s < 0) return '--:--';
    s = Math.floor(s);
    const m = Math.floor(s / 60), sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // Lê a duração de um src (com cache) sem ser o motor de playback —
  // só pra exibir o tempo total no player inline antes de tocar.
  function _zProbeDuration(src, cb) {
    if (!src) return;
    if (_zDurCache[src] != null) { cb(_zDurCache[src]); return; }
    try {
      const a = new Audio();
      a.preload = 'metadata';
      a.src = src;
      a.addEventListener('loadedmetadata', () => { _zDurCache[src] = a.duration; cb(a.duration); });
      a.addEventListener('error', () => {});
    } catch (e) { /* ignore */ }
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

  // Constrói a barra-miniplayer (motor único) no <body>, uma vez.
  function _zminiEnsure() {
    if (_zmini.bar) return;
    _ensureZaudioStyle();
    const bar = document.createElement('div');
    bar.className = 'zmini';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Player de áudio');
    bar.innerHTML = `
      <button type="button" class="zmini__btn zaudio__btn" aria-label="Tocar">
        <svg class="zmini__icon-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
        <svg class="zmini__icon-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
      </button>
      <div class="zmini__body">
        <div class="zmini__head">
          <span class="zeq" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="zmini__title"></span>
        </div>
        <div class="zmini__row">
          <div class="zmini__track zaudio__track"><div class="zmini__fill zaudio__fill"><span class="zaudio__handle"></span></div></div>
          <div class="zmini__time zaudio__time"><span class="zmini__cur">0:00</span> / <span class="zmini__dur">--:--</span></div>
        </div>
      </div>
      <button type="button" class="zmini__close" aria-label="Fechar player">&times;</button>`;
    document.body.appendChild(bar);

    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    bar.appendChild(audio);

    _zmini.bar = bar;
    _zmini.audio = audio;
    _zmini.els = {
      btn: bar.querySelector('.zmini__btn'),
      track: bar.querySelector('.zmini__track'),
      fill: bar.querySelector('.zmini__fill'),
      cur: bar.querySelector('.zmini__cur'),
      dur: bar.querySelector('.zmini__dur'),
      title: bar.querySelector('.zmini__title'),
      close: bar.querySelector('.zmini__close'),
    };

    _zmini.els.btn.addEventListener('click', () => { if (audio.paused) audio.play(); else audio.pause(); });
    _zmini.els.close.addEventListener('click', () => { audio.pause(); _zmini.bar.classList.remove('active'); });
    _zBindTrack(_zmini.els.track, (ratio) => { if (audio.duration) { audio.currentTime = ratio * audio.duration; _zRenderProgress(); } });

    audio.addEventListener('loadedmetadata', () => { if (_zmini.els.dur) _zmini.els.dur.textContent = _zfmtTime(audio.duration); _zRenderProgress(); });
    audio.addEventListener('timeupdate', _zRenderProgress);
    audio.addEventListener('play', () => { _zSetPlayingUI(true); _zmini.bar.classList.add('active'); });
    audio.addEventListener('pause', () => { _zSetPlayingUI(false); });
    audio.addEventListener('ended', () => { _zSetPlayingUI(false); audio.currentTime = 0; _zRenderProgress(); });
  }

  // Alterna a classe .is-playing na barra E nos inline do src ativo.
  // O CSS cuida de trocar ícone, acender o botão e animar o equalizer.
  function _zSetPlayingUI(playing) {
    if (_zmini.bar) {
      _zmini.bar.classList.toggle('is-playing', playing);
      if (_zmini.els && _zmini.els.btn) _zmini.els.btn.setAttribute('aria-label', playing ? 'Pausar' : 'Tocar');
    }
    document.querySelectorAll('.zaudio[data-mounted]').forEach(p => {
      const on = !!(playing && p.dataset.src && p.dataset.src === _zmini.src);
      p.classList.toggle('is-playing', on);
      const b = p.querySelector('.zaudio__btn');
      if (b) b.setAttribute('aria-label', on ? 'Pausar' : 'Tocar');
    });
  }

  // Atualiza barra de progresso/tempo na barra E nos inline do src ativo.
  function _zRenderProgress() {
    const a = _zmini.audio;
    if (!a) return;
    const d = a.duration || 0;
    const pct = d ? (a.currentTime / d * 100) : 0;
    if (_zmini.els) {
      _zmini.els.fill.style.width = pct + '%';
      _zmini.els.cur.textContent = _zfmtTime(a.currentTime);
    }
    document.querySelectorAll('.zaudio[data-mounted]').forEach(p => {
      if (!p.dataset.src || p.dataset.src !== _zmini.src) return;
      const fill = p.querySelector('.zaudio__fill');
      const cur = p.querySelector('.zaudio__cur');
      const dur = p.querySelector('.zaudio__dur');
      if (fill) fill.style.width = pct + '%';
      if (cur) cur.textContent = _zfmtTime(a.currentTime);
      if (dur && d) dur.textContent = _zfmtTime(d);
    });
  }

  // Aciona/alterna um src no motor único. Mesmo src → play/pause;
  // src diferente → carrega e toca.
  function _zPlaySrc(src, title) {
    if (!src) return;
    _zminiEnsure();
    const a = _zmini.audio;
    if (_zmini.src === src) {
      if (a.paused) a.play(); else a.pause();
      return;
    }
    _zmini.src = src;
    _zmini.title = title || 'Áudio';
    if (_zmini.els.title) _zmini.els.title.textContent = _zmini.title;
    if (_zmini.els.dur) _zmini.els.dur.textContent = _zDurCache[src] != null ? _zfmtTime(_zDurCache[src]) : '--:--';
    if (_zmini.els.cur) _zmini.els.cur.textContent = '0:00';
    if (_zmini.els.fill) _zmini.els.fill.style.width = '0%';
    a.src = src;
    a.play();
    _zmini.bar.classList.add('active');
    _zSetPlayingUI(true);
  }

  // HTML do player inline (superfície de controle; sem <audio> próprio).
  function _zaudioRender(opts) {
    _ensureZaudioStyle();
    const src = (opts && opts.src) ? opts.src : '';
    const title = (opts && opts.title) ? opts.title : '';
    return `
      <div class="zaudio" data-src="${_esc(src)}" data-title="${_esc(title)}">
        <button type="button" class="zaudio__btn" aria-label="Tocar">
          <svg class="zaudio__icon-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          <svg class="zaudio__icon-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
        </button>
        <div class="zaudio__track" aria-hidden="true"><div class="zaudio__fill"><span class="zaudio__handle"></span></div></div>
        <div class="zaudio__time"><span class="zaudio__cur">0:00</span> / <span class="zaudio__dur">--:--</span></div>
      </div>`;
  }

  // Liga os players inline ainda não montados dentro de `root`.
  function _zaudioMount(root) {
    if (!root) return;
    _ensureZaudioStyle();
    _zminiEnsure();
    root.querySelectorAll('.zaudio:not([data-mounted])').forEach(p => {
      p.setAttribute('data-mounted', '1');
      const src = p.dataset.src || '';
      const title = p.dataset.title || '';
      const btn = p.querySelector('.zaudio__btn');
      const track = p.querySelector('.zaudio__track');
      const durEl = p.querySelector('.zaudio__dur');
      // Mostra a duração total mesmo antes de tocar (se não for o ativo).
      if (src) _zProbeDuration(src, (d) => { if (durEl && _zmini.src !== src) durEl.textContent = _zfmtTime(d); });
      if (btn) btn.addEventListener('click', () => _zPlaySrc(src, title));
      if (track) _zBindTrack(track, (ratio) => {
        if (_zmini.src !== src) { _zPlaySrc(src, title); return; }
        if (_zmini.audio && _zmini.audio.duration) { _zmini.audio.currentTime = ratio * _zmini.audio.duration; _zRenderProgress(); }
      });
    });
    // Sincroniza estado inicial (caso o src ativo esteja entre os novos).
    _zRenderProgress();
    _zSetPlayingUI(_zmini.audio ? !_zmini.audio.paused : false);
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
    ul.innerHTML = list.map(r => {
      const noteHtml = r.note
        ? `<div style="font-size:0.78rem; color:var(--text-muted); margin-top:6px; font-style:italic; line-height:1.4;">"${_esc(r.note)}"</div>`
        : '';
      const dateStr = r.created_at
        ? new Date(r.created_at).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR')
        : '';
      const recommender = _displayRecommender(r.created_by_name);
      const expHtml = _expHtml(r, lang);
      const metaPrefix = recommender ? `${_esc(recommender)} <span style="opacity:0.4;">·</span> ` : '';
      const archiveLabel = lang === 'ja' ? 'アーカイブ' : 'Arquivar';
      const archiveBtn = `<button type="button" data-rec-id="${_esc(r.id)}" aria-label="${archiveLabel}" title="${archiveLabel}" class="rec-archive-btn" style="position:absolute; top:12px; right:10px; background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 10px; border-radius:4px; cursor:pointer; font-size:0.72rem; line-height:1; display:inline-flex; align-items:center; gap:5px; font-family:inherit;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            ${archiveLabel}
          </button>`;

      // Recomendação de ÁUDIO — bloco NÃO-âncora: clique/seek no player
      // não pode disparar navegação (o item de ensinamento é um <a>).
      if (r.audio_path) {
        const audioTitle = r.audio_title || (lang === 'ja' ? '音声' : 'Áudio');
        const player = r._audioUrl
          ? _zaudioRender({ src: r._audioUrl, title: audioTitle })
          : `<div style="font-size:0.78rem; color:#c00; margin-top:8px;">${lang === 'ja' ? '音声を読み込めませんでした。' : 'Não foi possível carregar o áudio.'}</div>`;
        return `
        <li style="position:relative;">
          <div style="padding:14px 100px 14px 16px; border-bottom:1px solid var(--border);">
            <div style="font-size:0.95rem; font-weight:500; color:var(--text-main);">🎵 ${_esc(audioTitle)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); margin-top:3px;">${metaPrefix}${_esc(dateStr)}${expHtml}</div>
            ${player}
            ${noteHtml}
          </div>
          ${archiveBtn}
        </li>
      `;
      }

      // Recomendação de ENSINAMENTO (comportamento original)
      const title = (lang === 'ja' && r.title_ja) ? r.title_ja : (r.title_pt || '(sem título)');
      const idx = r.topic_idx != null ? r.topic_idx : 0;
      let href = `${basePath}reader.html?vol=${encodeURIComponent(r.vol)}&file=${encodeURIComponent(r.file)}`;
      if (idx > 0) href += `&topic=${idx}`;
      if (lang === 'ja') href += '&lang=ja';
      return `
        <li style="position:relative;">
          <a href="${href}" style="display:block; padding:14px 100px 14px 16px; text-decoration:none; color:inherit; border-bottom:1px solid var(--border);">
            <div style="font-size:0.95rem; font-weight:500; color:var(--text-main);">${_esc(title)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); margin-top:3px;">${metaPrefix}${_esc(dateStr)}${expHtml}</div>
            ${noteHtml}
          </a>
          ${archiveBtn}
        </li>
      `;
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

  // ============================================================
  // PREVIEW (temporário) — simular o player na cartinha SEM MP3 real.
  // Gera um áudio de exemplo (tom suave criado no próprio navegador) e
  // abre a cartinha com recomendações de áudio fake, só pra alinhar
  // layout e funcionamento. Dispare com ?previewAudio=1 na URL OU
  // chamando previewAudioRecommendation() no console. Não escreve nada
  // no banco. Remover quando o layout estiver fechado.
  // ============================================================
  function _makeSampleAudioUrl(seconds) {
    const sec = seconds || 12;
    const sr = 8000, n = sr * sec, total = 44 + n * 2;
    const buf = new ArrayBuffer(total), dv = new DataView(buf);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); dv.setUint32(4, total - 8, true); wr(8, 'WAVE');
    wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    wr(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t, sec - t);            // fade in/out evita clique
      dv.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 220 * t) * 0.18 * env * 32767, true);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function previewAudioRecommendation() {
    if (typeof window.buildRecommendationsModal === 'function') window.buildRecommendationsModal();
    const overlay = document.getElementById('recommendationsModal');
    if (!overlay) {
      alert('Abra uma página com a cartinha (index.html, reader.html ou recomendacoes.html) para pré-visualizar.');
      return;
    }
    const sampleUrl = _makeSampleAudioUrl(12);
    const nowIso = new Date().toISOString();
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString();
    const fake = [
      {
        id: 'preview-1', audio_path: 'preview', _audioUrl: sampleUrl,
        audio_title: 'Mensagem do Reverendo Walter',
        note: 'Áudio de exemplo — ouça com calma esta semana.',
        created_at: nowIso, created_by_name: 'Walter Fujii',
      },
      {
        id: 'preview-2', audio_path: 'preview', _audioUrl: sampleUrl,
        audio_title: 'Oração da manhã (exemplo)',
        note: null, created_at: nowIso, created_by_name: 'Michael Yamada',
        expires_at: in7,
      },
    ];
    _renderList(fake);
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function _maybeAutoPreview() {
    try {
      if (!/[?&]previewAudio=1\b/.test(window.location.search)) return;
      setTimeout(previewAudioRecommendation, 300);
    } catch (e) { /* ignore */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _maybeAutoPreview);
  } else {
    _maybeAutoPreview();
  }
  window.previewAudioRecommendation = previewAudioRecommendation;

  window._zaudioRender = _zaudioRender;
  window._zaudioMount = _zaudioMount;

  window.openRecommendations = _open;
  window.closeRecommendations = _close;
  window.initRecommendations = init;
})();
