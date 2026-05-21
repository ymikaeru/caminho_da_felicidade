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
  // Layout: 2 colunas por padrão; vira 3 (e modal alarga) se a lista
  // for grande o suficiente pra encher a coluna no desktop.
  const THREE_COL_THRESHOLD = 36;
  let _modal = null;
  let _users = [];
  let _selectedUserIds = new Set();
  let _cols = 2;

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
    // Reproduz a mesma lógica de reader.js:getParams — favoritos sem topic
    // navegam via hash (#v3/sol-e-lua) em vez de ?vol=&file=, e o picker
    // de recomendação precisa funcionar nos dois formatos.
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
    const topic_idx = _currentTopicIdx();
    // Título: prioridade pelo window._currentTopics (dados estruturados
    // do JSON, vem com title_ptbr/title_pt). Cai pro <b><font size="+2">
    // dentro do tópico (formato legacy do conteúdo) ou h2/h3 como
    // último fallback, e por fim document.title.
    let title = '';
    const lang = localStorage.getItem('site_lang') || 'pt';
    const struct = (window._currentTopics || [])[topic_idx];
    if (struct) {
      title = lang === 'ja'
        ? (struct.title_ja || struct.title || '')
        : (struct.title_ptbr || struct.title_pt || struct.title || '');
    }
    if (!title) {
      const topics = document.querySelectorAll('.topic-content');
      const active = topics[topic_idx];
      // Formato real do conteúdo usa <b><font size="+2">...</font></b>
      const fontTitle = active?.querySelector('b > font[size="+2"], font[size="+2"]');
      title = fontTitle?.textContent
            || active?.querySelector('h2, h3, .topic-title')?.textContent
            || document.querySelector('.topic-content h1, .glass-pane h1, h1')?.textContent
            || document.title || '';
    }
    // Limpa quotes externas e prefixos típicos.
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

  function _build() {
    if (_modal) return;
    _modal = document.createElement('div');
    _modal.id = 'recommendPickerModal';
    _modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:none; align-items:center; justify-content:center; z-index:10000;';
    _modal.innerHTML = `
      <div style="background:var(--surface, #fff); color:var(--text-main, #000); width:min(900px, 94vw); height:min(1080px, 96vh); border-radius:10px; padding:24px; box-shadow:0 12px 40px rgba(0,0,0,0.25); display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:.08em; font-weight:600;">Recomendar este ensinamento</div>
            <div id="recPickerTeachingTitle" style="font-size:1.05rem; font-weight:600; margin-top:3px; line-height:1.3; color:var(--text-main); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;"></div>
            <div id="recPickerTeaching" style="font-size:0.72rem; color:var(--text-muted); margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></div>
          </div>
          <button id="recPickerClose" aria-label="Fechar" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-muted); line-height:1; padding:0 4px;">&times;</button>
        </div>
        <input type="text" id="recPickerUserSearch" placeholder="Buscar usuário por nome ou email..." style="padding:8px 12px; font-size:0.88rem; border:1px solid var(--border); border-radius:5px; background:var(--bg, #fff); color:inherit; box-sizing:border-box;">
        <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.75rem; color:var(--text-muted);">
          <span id="recPickerSelCount">Nenhum selecionado</span>
          <button id="recPickerClearSel" type="button" style="background:none; border:none; color:var(--accent); font-size:0.75rem; cursor:pointer; padding:0; text-decoration:underline;" hidden>Limpar seleção</button>
        </div>
        <div id="recPickerUserList" style="flex:1; min-height:200px; overflow-y:auto; border:1px solid var(--border); border-radius:5px; display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); align-content:start;"></div>
        <textarea id="recPickerNote" rows="2" placeholder="Nota opcional (ex.: 'pra refletir esta semana')" style="padding:8px 12px; font-size:0.85rem; border:1px solid var(--border); border-radius:5px; resize:vertical; font-family:inherit; background:var(--bg, #fff); color:inherit; box-sizing:border-box;"></textarea>
        <div style="display:flex; align-items:center; gap:10px;">
          <label style="font-size:0.78rem; color:var(--text-muted); white-space:nowrap;">Auto-arquivar:</label>
          <select id="recPickerExpires" style="flex:1; padding:6px 10px; font-size:0.82rem; border:1px solid var(--border); border-radius:5px; background:var(--bg, #fff); color:inherit; box-sizing:border-box;">
            <option value="">Sem prazo</option>
            <option value="7">Em 7 dias</option>
            <option value="15">Em 15 dias</option>
            <option value="30">Em 30 dias</option>
            <option value="90">Em 90 dias</option>
          </select>
        </div>
        <div id="recPickerMsg" style="font-size:0.82rem; min-height:1.2em;"></div>
        <div style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
          <button id="recPickerCancel" style="padding:7px 16px; font-size:0.85rem; background:none; border:1px solid var(--border); border-radius:5px; cursor:pointer; color:inherit;">Cancelar</button>
          <button id="recPickerSelectAll" type="button" style="padding:7px 16px; font-size:0.85rem; background:none; border:1px solid var(--accent); color:var(--accent); border-radius:5px; cursor:pointer; font-weight:600;" title="Marca todos os usuários da lista (respeita o filtro de busca)">Selecionar todos</button>
          <button id="recPickerSubmit" style="padding:7px 18px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:5px; cursor:pointer; font-weight:600;" disabled>Recomendar</button>
        </div>
      </div>
    `;
    document.body.appendChild(_modal);

    document.getElementById('recPickerClose').onclick = _close;
    document.getElementById('recPickerCancel').onclick = _close;
    document.getElementById('recPickerSubmit').onclick = _submit;
    document.getElementById('recPickerSelectAll').onclick = _selectAllVisible;
    document.getElementById('recPickerUserSearch').oninput = _refresh;
    document.getElementById('recPickerClearSel').onclick = () => {
      _selectedUserIds.clear();
      _refresh();
    };
    _modal.addEventListener('click', e => { if (e.target === _modal) _close(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _modal && _modal.style.display !== 'none') _close();
    });
  }

  async function _loadUsers() {
    if (_users.length > 0) return; // cache for this session
    const supa = _supaClient();
    if (!supa) return;
    const { data, error } = await supa.rpc('admin_get_users');
    if (error) {
      document.getElementById('recPickerMsg').innerHTML = `<span style="color:#c00;">Erro: ${_esc(error.message)}</span>`;
      return;
    }
    _users = data || [];
  }

  function _filteredUsers() {
    const q = (document.getElementById('recPickerUserSearch')?.value || '').toLowerCase();
    if (!q) return _users.slice();
    return _users.filter(u =>
      (u.display_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  }

  // Re-render lista + atualizar contadores. Compartilha o array filtrado
  // pra não rodar o `filter` 3x quando o usuário clica num checkbox.
  function _refresh() {
    const filtered = _filteredUsers();
    _renderUserList(filtered);
    _updateSelectionUi(filtered);
  }

  function _renderUserList(filtered) {
    const container = document.getElementById('recPickerUserList');
    if (!container) return;
    const prevScroll = container.scrollTop;
    if (!filtered) filtered = _filteredUsers();
    if (filtered.length === 0) {
      container.innerHTML = '<div style="grid-column:1/-1; padding:14px; color:var(--text-muted); font-size:0.85rem; text-align:center;">Nenhum usuário.</div>';
      return;
    }
    const html = filtered.slice(0, 400).map((u, i) => {
      const isSel = _selectedUserIds.has(u.id);
      const bg = isSel ? 'background:var(--accent-soft, rgba(184,134,11,0.15)); border-left:3px solid var(--accent);' : 'border-left:3px solid transparent;';
      const isLastCol = (i % _cols) === (_cols - 1);
      const borderRight = isLastCol ? '' : 'border-right:1px solid var(--border);';
      const check = isSel
        ? '<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:4px; background:var(--accent); color:#fff; font-size:0.75rem; flex-shrink:0;">✓</span>'
        : '<span style="display:inline-block; width:18px; height:18px; border-radius:4px; border:1.5px solid var(--border); flex-shrink:0;"></span>';
      return `
        <div onclick="recPickerToggleUser('${_esc(u.id)}')" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border); ${borderRight} display:flex; align-items:center; gap:10px; min-width:0; ${bg}">
          ${check}
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.86rem; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_esc(u.display_name || 'Sem nome')}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_esc(u.email || '—')}</div>
          </div>
        </div>
      `;
    }).join('');
    container.innerHTML = html;
    container.scrollTop = prevScroll;
  }

  // Marca todos os usuários visíveis (respeita o filtro). Se todos os
  // visíveis já estavam marcados, desmarca esses — vira toggle.
  function _selectAllVisible() {
    const visible = _filteredUsers();
    if (visible.length === 0) return;
    const allSelected = visible.every(u => _selectedUserIds.has(u.id));
    if (allSelected) {
      visible.forEach(u => _selectedUserIds.delete(u.id));
    } else {
      visible.forEach(u => _selectedUserIds.add(u.id));
    }
    _renderUserList(visible);
    _updateSelectionUi(visible);
  }

  function _updateSelectionUi(filtered) {
    const n = _selectedUserIds.size;
    const count = document.getElementById('recPickerSelCount');
    const clear = document.getElementById('recPickerClearSel');
    const submit = document.getElementById('recPickerSubmit');
    const selAll = document.getElementById('recPickerSelectAll');
    if (count) count.textContent = n === 0 ? 'Nenhum selecionado' : (n === 1 ? '1 usuário selecionado' : `${n} usuários selecionados`);
    if (clear) clear.hidden = n === 0;
    if (submit) {
      submit.disabled = n === 0;
      submit.textContent = n > 1 ? `Recomendar (${n})` : 'Recomendar';
    }
    if (selAll) {
      const visible = filtered || _filteredUsers();
      const allVisibleSelected = visible.length > 0 && visible.every(u => _selectedUserIds.has(u.id));
      selAll.textContent = allVisibleSelected ? 'Desmarcar todos' : 'Selecionar todos';
    }
  }

  async function _open(explicitTopicIdx) {
    if (typeof isAdminUser === 'function' && !isAdminUser()) return;
    _build();
    _selectedUserIds.clear();
    const meta = _currentTeachingMeta();
    // Quando passado (ex: botão abaixo de um título específico), sobrepõe
    // a detecção por scroll — desambigua em páginas com múltiplos tópicos.
    if (typeof explicitTopicIdx === 'number' && !isNaN(explicitTopicIdx)) {
      meta.topic_idx = explicitTopicIdx;
    }
    if (!meta.vol || !meta.file) {
      alert('Não consegui identificar o ensinamento atual. Esta página tem vol e file na URL?');
      return;
    }
    _modal.dataset.vol = meta.vol;
    _modal.dataset.file = meta.file;
    _modal.dataset.topicIdx = String(meta.topic_idx);
    document.getElementById('recPickerTeachingTitle').textContent = meta.title || '(sem título)';
    document.getElementById('recPickerTeaching').textContent =
      `${meta.vol} · ${meta.file}#${meta.topic_idx}`;
    document.getElementById('recPickerUserSearch').value = '';
    document.getElementById('recPickerNote').value = '';
    document.getElementById('recPickerExpires').value = '';
    document.getElementById('recPickerMsg').textContent = '';
    _updateSelectionUi();
    _modal.style.display = 'flex';
    document.getElementById('recPickerUserList').innerHTML = '<div style="grid-column:1/-1; padding:14px; color:var(--text-muted); font-size:0.85rem;">Carregando usuários...</div>';
    await _loadUsers();
    _applyLayout();
    _refresh();
    document.getElementById('recPickerUserSearch').focus();
  }

  // Decide 2 vs 3 colunas (e largura do modal) com base no total de
  // usuários. Roda só ao abrir; não muda quando o usuário filtra.
  function _applyLayout() {
    _cols = _users.length > THREE_COL_THRESHOLD ? 3 : 2;
    const sheet = _modal && _modal.firstElementChild;
    const list = document.getElementById('recPickerUserList');
    if (sheet) {
      sheet.style.width = _cols === 3 ? 'min(1180px, 96vw)' : 'min(900px, 94vw)';
    }
    if (list) {
      list.style.gridTemplateColumns = `repeat(${_cols}, minmax(0, 1fr))`;
    }
  }

  function _close() {
    if (_modal) _modal.style.display = 'none';
  }

  // Converte o select "Auto-arquivar" em ISO timestamp ou null.
  function _expiresIso() {
    const days = parseInt(document.getElementById('recPickerExpires')?.value || '0', 10);
    if (!days || days <= 0) return null;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  function _supaClient() {
    return (window.supabaseAuth && window.supabaseAuth.supabase)
        || window._supabaseClient
        || window.supabase
        || null;
  }

  async function _submit() {
    if (_selectedUserIds.size === 0) return;
    const supa = _supaClient();
    if (!supa) return;
    const ids = Array.from(_selectedUserIds);
    if (ids.length >= 10 && !confirm(`Recomendar pra ${ids.length} usuários? Cada um receberá uma cópia e não dá pra desfazer em massa.`)) return;
    const btn = document.getElementById('recPickerSubmit');
    const selAllBtn = document.getElementById('recPickerSelectAll');
    const msg = document.getElementById('recPickerMsg');
    btn.disabled = true;
    selAllBtn.disabled = true;
    msg.style.color = 'var(--text-muted)';
    msg.textContent = `Enviando pra ${ids.length} usuário${ids.length === 1 ? '' : 's'}...`;
    const note = document.getElementById('recPickerNote').value.trim();
    const { data, error } = await supa.rpc('admin_create_recommendations_bulk', {
      p_user_ids: ids,
      p_vol: _modal.dataset.vol,
      p_file: _modal.dataset.file,
      p_topic_idx: parseInt(_modal.dataset.topicIdx, 10) || 0,
      p_note: note || null,
      p_expires_at: _expiresIso(),
    });
    if (error) {
      msg.innerHTML = `<span style="color:#c00;">Erro: ${_esc(error.message)}</span>`;
      btn.disabled = false;
      selAllBtn.disabled = false;
      return;
    }
    const created = typeof data === 'number' ? data : ids.length;
    const skipped = ids.length - created;
    const suffix = skipped > 0 ? ` (${skipped} ignorados — usuário(s) não encontrado(s))` : '';
    msg.innerHTML = `<span style="color:#0a7;">✓ Enviado pra ${created} usuário${created === 1 ? '' : 's'}${suffix}.</span>`;
    setTimeout(_close, 1100);
  }

  window.recPickerToggleUser = function(uid) {
    if (_selectedUserIds.has(uid)) _selectedUserIds.delete(uid);
    else _selectedUserIds.add(uid);
    _refresh();
  };

  window.openRecommendPicker = _open;
})();
