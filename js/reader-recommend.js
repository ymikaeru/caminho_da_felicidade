// ============================================================
// Reader Recommend — admin recomenda o ensinamento aberto agora
// ============================================================
// Botão injetado em js/nav.js (#headerRecommendBtn) chama
// openRecommendPicker(). Abre um modal com user picker + nota,
// pega vol/file/topic_idx do reader atual e chama
// admin_create_recommendation. Só admin enxerga (gate em nav.js).
//
// Depende de window.supabase + isAdminUser() (access.js).
// ============================================================

(function () {
  let _modal = null;
  let _users = [];
  let _selectedUserId = null;

  function _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Pega o tópico atualmente em foco. Tenta:
  //   1. ?topic=N na URL
  //   2. tópico cujo bounding-rect.top está mais próximo de window.innerHeight/3
  //   3. 0 como fallback
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

  function _currentTeachingMeta() {
    const params = new URLSearchParams(window.location.search);
    const vol = params.get('vol') || '';
    const file = params.get('file') || '';
    const topic_idx = _currentTopicIdx();
    // Título: tenta o do <h1> da página, ou do tópico ativo.
    const topics = document.querySelectorAll('.topic-content');
    const active = topics[topic_idx];
    const title = (active?.querySelector('.topic-title, h2, h3')?.textContent
                || document.querySelector('.topic-content h1, h1')?.textContent
                || document.title)
                ?.trim();
    return { vol, file, topic_idx, title };
  }

  function _build() {
    if (_modal) return;
    _modal = document.createElement('div');
    _modal.id = 'recommendPickerModal';
    _modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:none; align-items:center; justify-content:center; z-index:10000;';
    _modal.innerHTML = `
      <div style="background:var(--surface, #fff); color:var(--text-main, #000); width:min(520px, 92vw); max-height:88vh; border-radius:10px; padding:22px; box-shadow:0 12px 40px rgba(0,0,0,0.25); display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          <div style="flex:1;">
            <div style="font-size:1.05rem; font-weight:600;">Recomendar este ensinamento</div>
            <div id="recPickerTeaching" style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;"></div>
          </div>
          <button id="recPickerClose" aria-label="Fechar" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-muted); line-height:1; padding:0 4px;">&times;</button>
        </div>
        <input type="text" id="recPickerUserSearch" placeholder="Buscar usuário por nome ou email..." style="padding:8px 12px; font-size:0.88rem; border:1px solid var(--border); border-radius:5px; background:var(--bg, #fff); color:inherit; box-sizing:border-box;">
        <div id="recPickerUserList" style="max-height:240px; overflow-y:auto; border:1px solid var(--border); border-radius:5px;"></div>
        <textarea id="recPickerNote" rows="2" placeholder="Nota opcional (ex.: 'pra refletir esta semana')" style="padding:8px 12px; font-size:0.85rem; border:1px solid var(--border); border-radius:5px; resize:vertical; font-family:inherit; background:var(--bg, #fff); color:inherit; box-sizing:border-box;"></textarea>
        <div id="recPickerMsg" style="font-size:0.82rem; min-height:1.2em;"></div>
        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button id="recPickerCancel" style="padding:7px 16px; font-size:0.85rem; background:none; border:1px solid var(--border); border-radius:5px; cursor:pointer; color:inherit;">Cancelar</button>
          <button id="recPickerSubmit" style="padding:7px 18px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:5px; cursor:pointer; font-weight:600;" disabled>Recomendar</button>
        </div>
      </div>
    `;
    document.body.appendChild(_modal);

    document.getElementById('recPickerClose').onclick = _close;
    document.getElementById('recPickerCancel').onclick = _close;
    document.getElementById('recPickerSubmit').onclick = _submit;
    document.getElementById('recPickerUserSearch').oninput = _renderUserList;
    _modal.addEventListener('click', e => { if (e.target === _modal) _close(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _modal && _modal.style.display !== 'none') _close();
    });
  }

  async function _loadUsers() {
    if (_users.length > 0) return; // cache for this session
    const supa = window.supabase || window._supabaseClient;
    if (!supa) return;
    const { data, error } = await supa.rpc('admin_get_users');
    if (error) {
      document.getElementById('recPickerMsg').innerHTML = `<span style="color:#c00;">Erro: ${_esc(error.message)}</span>`;
      return;
    }
    _users = data || [];
  }

  function _renderUserList() {
    const container = document.getElementById('recPickerUserList');
    if (!container) return;
    const q = (document.getElementById('recPickerUserSearch')?.value || '').toLowerCase();
    const filtered = _users.filter(u =>
      (u.display_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
    if (filtered.length === 0) {
      container.innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:0.85rem; text-align:center;">Nenhum usuário.</div>';
      return;
    }
    container.innerHTML = filtered.slice(0, 50).map(u => {
      const isSel = _selectedUserId === u.id;
      const bg = isSel ? 'background:var(--accent-soft, rgba(184,134,11,0.15)); border-left:3px solid var(--accent);' : '';
      return `
        <div onclick="recPickerSelectUser('${_esc(u.id)}')" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border); ${bg}">
          <div style="font-size:0.86rem; font-weight:500;">${_esc(u.display_name || 'Sem nome')}</div>
          <div style="font-size:0.72rem; color:var(--text-muted);">${_esc(u.email || '—')}</div>
        </div>
      `;
    }).join('');
  }

  async function _open() {
    if (typeof isAdminUser === 'function' && !isAdminUser()) return;
    _build();
    _selectedUserId = null;
    const meta = _currentTeachingMeta();
    if (!meta.vol || !meta.file) {
      alert('Não consegui identificar o ensinamento atual. Esta página tem vol e file na URL?');
      return;
    }
    _modal.dataset.vol = meta.vol;
    _modal.dataset.file = meta.file;
    _modal.dataset.topicIdx = String(meta.topic_idx);
    document.getElementById('recPickerTeaching').textContent =
      `${meta.title ? meta.title + ' · ' : ''}${meta.vol} · ${meta.file}#${meta.topic_idx}`;
    document.getElementById('recPickerUserSearch').value = '';
    document.getElementById('recPickerNote').value = '';
    document.getElementById('recPickerMsg').textContent = '';
    document.getElementById('recPickerSubmit').disabled = true;
    _modal.style.display = 'flex';
    document.getElementById('recPickerUserList').innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:0.85rem;">Carregando usuários...</div>';
    await _loadUsers();
    _renderUserList();
    document.getElementById('recPickerUserSearch').focus();
  }

  function _close() {
    if (_modal) _modal.style.display = 'none';
  }

  async function _submit() {
    if (!_selectedUserId) return;
    const supa = window.supabase || window._supabaseClient;
    if (!supa) return;
    const btn = document.getElementById('recPickerSubmit');
    const msg = document.getElementById('recPickerMsg');
    btn.disabled = true;
    msg.textContent = 'Enviando...';
    msg.style.color = 'var(--text-muted)';
    const note = document.getElementById('recPickerNote').value.trim();
    const { error } = await supa.rpc('admin_create_recommendation', {
      p_user_id: _selectedUserId,
      p_vol: _modal.dataset.vol,
      p_file: _modal.dataset.file,
      p_topic_idx: parseInt(_modal.dataset.topicIdx, 10) || 0,
      p_note: note || null,
    });
    if (error) {
      msg.innerHTML = `<span style="color:#c00;">Erro: ${_esc(error.message)}</span>`;
      btn.disabled = false;
      return;
    }
    msg.innerHTML = '<span style="color:#0a7;">✓ Recomendação enviada.</span>';
    setTimeout(_close, 900);
  }

  window.recPickerSelectUser = function(uid) {
    _selectedUserId = uid;
    _renderUserList();
    document.getElementById('recPickerSubmit').disabled = false;
  };

  window.openRecommendPicker = _open;
})();
