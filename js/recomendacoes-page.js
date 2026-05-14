// ============================================================
// Página "Central de Recomendações" (recomendacoes.html)
// ============================================================
// Mostra ativas e arquivadas em abas. Usuário pode arquivar
// ativas e desarquivar arquivadas. Apagar permanente é só do
// admin (na aba Recomendações do admin-supabase.html).
//
// Depende de window.supabaseAuth.supabase (login.js).
// ============================================================

(function () {
  let _active = [];
  let _archived = [];
  let _currentTab = 'active';

  function _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _supa() {
    return (window.supabaseAuth && window.supabaseAuth.supabase)
        || window._supabaseClient
        || window.supabase
        || null;
  }

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
    } catch (e) { return false; }
  }

  async function _fetchAll() {
    const supa = _supa();
    if (!supa) return { active: [], archived: [] };
    const [a, b] = await Promise.all([
      supa.rpc('get_my_recommendations'),
      supa.rpc('get_my_recommendations_archived'),
    ]);
    return {
      active: (a.data || []).filter(r => !_hiddenByAccess(r)),
      archived: (b.data || []).filter(r => !_hiddenByAccess(r)),
    };
  }

  function _basePathForReader() {
    return window.location.pathname.includes('/mioshiec') ? '../' : '';
  }

  function _formatDate(iso, lang) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR');
  }

  function _renderCards(list, archived) {
    const lang = localStorage.getItem('site_lang') || 'pt';
    if (!list || list.length === 0) {
      const empty = archived
        ? { title: lang === 'ja' ? 'アーカイブはまだありません。' : 'Nada arquivado ainda.',
            desc: lang === 'ja' ? 'アーカイブしたおすすめがここに表示されます。' : 'Recomendações que você arquivar aparecem aqui.' }
        : { title: lang === 'ja' ? 'おすすめはありません。' : 'Nenhuma recomendação ativa.',
            desc: lang === 'ja' ? '新しいおすすめが届いたらここに表示されます。' : 'Novas recomendações do administrador aparecem aqui.' };
      return `
        <div class="rec-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          <div class="rec-empty-title">${_esc(empty.title)}</div>
          <div class="rec-empty-desc">${_esc(empty.desc)}</div>
        </div>
      `;
    }
    const base = _basePathForReader();
    return list.map(r => {
      const title = (lang === 'ja' && r.title_ja) ? r.title_ja : (r.title_pt || '(sem título)');
      const idx = r.topic_idx != null ? r.topic_idx : 0;
      let href = `${base}reader.html?vol=${encodeURIComponent(r.vol)}&file=${encodeURIComponent(r.file)}`;
      if (idx > 0) href += `&topic=${idx}`;
      if (lang === 'ja') href += '&lang=ja';

      const createdStr = _formatDate(r.created_at, lang);
      let metaExtra = '';
      if (archived) {
        const archStr = _formatDate(r.archived_at, lang);
        const archLbl = lang === 'ja' ? `アーカイブ: ${archStr}` : `arquivada ${archStr}`;
        metaExtra = `<span class="dot">·</span><span>${_esc(archLbl)}</span>`;
      } else if (r.expires_at) {
        const daysLeft = Math.ceil((new Date(r.expires_at) - new Date()) / 86400000);
        if (daysLeft > 0) {
          const expLbl = daysLeft === 1
            ? (lang === 'ja' ? '明日まで' : 'expira amanhã')
            : (lang === 'ja' ? `あと${daysLeft}日` : `expira em ${daysLeft} dias`);
          const c = daysLeft <= 3 ? 'color:#c80;' : '';
          metaExtra = `<span class="dot">·</span><span style="${c}">⏱ ${_esc(expLbl)}</span>`;
        }
      }

      const noteHtml = r.note
        ? `<div class="rec-card-note">"${_esc(r.note)}"</div>`
        : '';

      // Botão de ação muda conforme estado
      const actionBtn = archived
        ? `<button class="rec-action-btn primary" data-action="unarchive" data-rec-id="${_esc(r.id)}" type="button" title="${_esc(lang === 'ja' ? 'アーカイブから戻す' : 'Trazer de volta para Ativas')}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/><polyline points="14 11 14 17 10 17"/></svg>
            <span>${_esc(lang === 'ja' ? '戻す' : 'Desarquivar')}</span>
          </button>`
        : `<button class="rec-action-btn" data-action="archive" data-rec-id="${_esc(r.id)}" type="button" title="${_esc(lang === 'ja' ? 'アーカイブ' : 'Arquivar')}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            <span>${_esc(lang === 'ja' ? 'アーカイブ' : 'Arquivar')}</span>
          </button>`;

      const cardCls = archived ? 'rec-card archived' : 'rec-card';

      return `
        <article class="${cardCls}">
          <div class="rec-card-body">
            <h2 class="rec-card-title"><a href="${href}">${_esc(title)}</a></h2>
            <div class="rec-card-meta">
              <span>${_esc(createdStr)}</span>
              ${metaExtra}
            </div>
            ${noteHtml}
          </div>
          <div class="rec-card-actions">
            ${actionBtn}
          </div>
        </article>
      `;
    }).join('');
  }

  function _render() {
    document.getElementById('rec-count-active').textContent = String(_active.length);
    document.getElementById('rec-count-archived').textContent = String(_archived.length);
    document.querySelectorAll('.rec-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.recTab === _currentTab);
    });
    const container = document.getElementById('rec-page-container');
    if (!container) return;
    const list = _currentTab === 'archived' ? _archived : _active;
    container.innerHTML = _renderCards(list, _currentTab === 'archived');
  }

  async function _refresh() {
    const { active, archived } = await _fetchAll();
    _active = active;
    _archived = archived;
    _render();
  }

  async function _archive(recId) {
    const supa = _supa();
    if (!supa) return;
    const { error } = await supa.rpc('archive_my_recommendation', { p_id: recId });
    if (error) { alert('Erro: ' + error.message); return; }
    await _refresh();
  }

  async function _unarchive(recId) {
    const supa = _supa();
    if (!supa) return;
    const { error } = await supa.rpc('unarchive_my_recommendation', { p_id: recId });
    if (error) { alert('Erro: ' + error.message); return; }
    await _refresh();
  }

  async function init() {
    const container = document.getElementById('rec-page-container');
    if (!container) return;
    // Tab switching
    document.querySelectorAll('.rec-tab').forEach(t => {
      t.addEventListener('click', () => {
        _currentTab = t.dataset.recTab;
        _render();
      });
    });
    // Action buttons (delegated)
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest?.('.rec-action-btn');
      if (!btn) return;
      e.preventDefault();
      const action = btn.dataset.action;
      const id = btn.dataset.recId;
      if (!action || !id) return;
      btn.disabled = true;
      if (action === 'archive') await _archive(id);
      else if (action === 'unarchive') await _unarchive(id);
    });
    await _refresh();
  }

  window.initRecomendacoesPage = init;
})();
