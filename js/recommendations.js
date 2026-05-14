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
      return (data || []).filter(r => !_hiddenByAccess(r));
    } catch (e) {
      return [];
    }
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
      const title = (lang === 'ja' && r.title_ja) ? r.title_ja : (r.title_pt || '(sem título)');
      const idx = r.topic_idx != null ? r.topic_idx : 0;
      let href = `${basePath}reader.html?vol=${encodeURIComponent(r.vol)}&file=${encodeURIComponent(r.file)}`;
      if (idx > 0) href += `&topic=${idx}`;
      if (lang === 'ja') href += '&lang=ja';
      const noteHtml = r.note
        ? `<div style="font-size:0.78rem; color:var(--text-muted); margin-top:6px; font-style:italic; line-height:1.4;">"${_esc(r.note)}"</div>`
        : '';
      const dateStr = r.created_at
        ? new Date(r.created_at).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR')
        : '';
      const archiveLabel = lang === 'ja' ? 'アーカイブ' : 'Arquivar';
      return `
        <li style="position:relative;">
          <a href="${href}" style="display:block; padding:14px 100px 14px 16px; text-decoration:none; color:inherit; border-bottom:1px solid var(--border);">
            <div style="font-size:0.95rem; font-weight:500; color:var(--text-main);">${_esc(title)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); margin-top:3px;">${_esc(dateStr)}</div>
            ${noteHtml}
          </a>
          <button type="button" data-rec-id="${_esc(r.id)}" aria-label="${archiveLabel}" title="${archiveLabel}" class="rec-archive-btn" style="position:absolute; top:12px; right:10px; background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 10px; border-radius:4px; cursor:pointer; font-size:0.72rem; line-height:1; display:inline-flex; align-items:center; gap:5px; font-family:inherit;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            ${archiveLabel}
          </button>
        </li>
      `;
    }).join('');

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

  window.openRecommendations = _open;
  window.closeRecommendations = _close;
  window.initRecommendations = init;
})();
