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
  let _recState = { total: 0, unseen: 0, list: null };

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
    return window.supabase || null;
  }

  function _reveal(count) {
    // Botão na home (visível só em index.html). Sandwich menu item:
    // sempre injetado, mas escondido se total === 0.
    const homeBtn = document.getElementById('btnRecommendationsHero');
    if (homeBtn) {
      homeBtn.style.display = count > 0 ? 'inline-flex' : 'none';
      const badge = homeBtn.querySelector('.rec-badge');
      if (badge) {
        if (_recState.unseen > 0) {
          badge.textContent = String(_recState.unseen);
          badge.style.display = 'inline-flex';
        } else {
          badge.style.display = 'none';
        }
      }
    }

    const navBtn = document.getElementById('mobileNavLinkRecommendations');
    if (navBtn) {
      navBtn.style.display = count > 0 ? 'flex' : 'none';
      const badge = navBtn.querySelector('.rec-badge');
      if (badge) {
        if (_recState.unseen > 0) {
          badge.textContent = String(_recState.unseen);
          badge.style.display = 'inline-flex';
        } else {
          badge.style.display = 'none';
        }
      }
    }
  }

  async function _fetchSummary() {
    const supa = _supa();
    if (!supa) return { total: 0, unseen: 0 };
    try {
      const { data, error } = await supa.rpc('get_my_recommendations_summary');
      if (error) return { total: 0, unseen: 0 };
      const row = Array.isArray(data) ? (data[0] || {}) : (data || {});
      return { total: Number(row.total || 0), unseen: Number(row.unseen || 0) };
    } catch (e) {
      return { total: 0, unseen: 0 };
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
      const fromAdmin = r.created_by_name
        ? `<span style="font-size:0.7rem; color:var(--text-muted);">· ${_esc(r.created_by_name)}</span>`
        : '';
      const dateStr = r.created_at
        ? new Date(r.created_at).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR')
        : '';
      return `
        <li>
          <a href="${href}" style="display:block; padding:14px 16px; text-decoration:none; color:inherit; border-bottom:1px solid var(--border);">
            <div style="font-size:0.95rem; font-weight:500; color:var(--text-main);">${_esc(title)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); margin-top:3px;">${_esc(dateStr)} ${fromAdmin}</div>
            ${noteHtml}
          </a>
        </li>
      `;
    }).join('');
  }

  async function _open() {
    const overlay = document.getElementById('recommendationsModal');
    if (!overlay) return;
    overlay.classList.add('open');
    overlay.style.display = 'flex';
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
    overlay.classList.remove('open');
    overlay.style.display = '';
    document.body.style.overflow = '';
  }

  async function init() {
    // Requer autenticação (Supabase). Em páginas sem login, supabase
    // não existe e o gate cai pra "0 recs" → botões ficam ocultos.
    const summary = await _fetchSummary();
    _recState.total = summary.total;
    _recState.unseen = summary.unseen;
    _reveal(summary.total);
  }

  // Click-outside e ESC pra fechar.
  document.addEventListener('click', (e) => {
    const overlay = document.getElementById('recommendationsModal');
    if (!overlay || !overlay.classList.contains('open')) return;
    // Só fecha se clicou no overlay (não no modal interno).
    if (e.target === overlay) _close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlay = document.getElementById('recommendationsModal');
    if (overlay && overlay.classList.contains('open')) _close();
  });

  window.openRecommendations = _open;
  window.closeRecommendations = _close;
  window.initRecommendations = init;
})();
