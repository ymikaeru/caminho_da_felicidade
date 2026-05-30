// ============================================================
// Poetry Recommend — admin recomenda um poema da coletânea aberta
// ============================================================
// Injeta um botão "Recomendar" (SÓ admin) em cada card de poema. Ao
// clicar, abre um modal com multi-seleção de usuários + nota (cartinha)
// + prazo e chama admin_create_poetry_recommendations_bulk.
//
// A recomendação reaproveita study_recommendations com vol='poetry',
// file=<slug da coletânea>, topic_idx=<número do poema> + duas colunas
// próprias: poem_topic_id (âncora EXATA do deep-link, lida do card —
// nunca reconstruída, porque warai pode ter id custom) e poem_title
// (rótulo exibido). Quem clicar na recomendação abre
// <coletânea>.html?poem=<poem_topic_id>&hl_scroll=1 → autoscroll + flash.
//
// Espelha o picker de js/reader-recommend.js (ensinamentos), trocando
// a meta do tópico pela meta do poema e a RPC pela versão de poesia.
//
// Depende de: access.js (isAdminUser) + login.js (window.supabaseAuth).
// Carregado nas 6 páginas de coletânea (yama/warai/akimaro/3× gosanka).
// ============================================================

(function () {
  'use strict';

  // slug da coletânea → { page, name }. O slug é o basename do arquivo
  // (= file slug usado em user_highlights e no analytics de cada página).
  const COLLECTIONS = {
    'yama-to-mizu':     { page: 'yama-to-mizu.html',     name: 'Yama to Mizu' },
    'warai-no-izumi':   { page: 'warai-no-izumi.html',   name: 'Warai no Izumi' },
    'akimaro-kineishu': { page: 'akimaro-kineishu.html', name: 'Akimaro Kin’eishū' },
    'gosanka-shoban':   { page: 'gosanka-shoban.html',   name: 'Gosanka-shū (1ª ed.)' },
    'gosanka-kaitei':   { page: 'gosanka-kaitei.html',   name: 'Gosanka-shū (rev.)' },
    'gosanka-shikiten': { page: 'gosanka-shikiten.html', name: 'Gosanka — Cerimônias' },
  };

  const SLUG = (location.pathname.split('/').pop() || '').replace(/\.html$/i, '');
  const COLL = COLLECTIONS[SLUG] ? SLUG : null;
  if (!COLL) return; // não é uma página de coletânea conhecida

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _supa() {
    return (window.supabaseAuth && window.supabaseAuth.supabase)
        || window._supabaseClient
        || window.supabase
        || null;
  }
  function _isAdmin() {
    try { return typeof isAdminUser === 'function' && isAdminUser(); }
    catch (e) { return false; }
  }

  // ============================================================
  // Botão por card — injetado e re-injetado a cada re-render do leitor
  // ============================================================
  const BTN = 'poetry-card__recommend';
  const BTN_HTML =
    `<button type="button" class="${BTN}" title="Recomendar este poema" aria-label="Recomendar este poema"` +
    ` style="display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:3px 9px;` +
    `font-family:var(--font-ui,inherit);font-size:0.72rem;font-weight:600;line-height:1;` +
    `color:var(--accent);background:transparent;border:1px solid var(--accent);` +
    `border-radius:var(--radius-pill,99px);cursor:pointer;">` +
      `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>` +
      `</svg><span>Recomendar</span>` +
    `</button>`;

  function _scan() {
    if (!_isAdmin()) return;
    document.querySelectorAll('.poetry-card:not([data-rec-btn])').forEach((card) => {
      const head = card.querySelector('.poetry-card__head');
      if (!head) return;
      card.dataset.recBtn = '1';
      head.insertAdjacentHTML('beforeend', BTN_HTML);
    });
  }

  let _obs = null;
  function _start() {
    // O leitor reescreve innerHTML a cada busca / troca de seção /
    // "mostrar mais", apagando os botões injetados. O observer re-injeta.
    // Desconecta durante a varredura pra não disparar em loop com a
    // própria inserção.
    _obs = new MutationObserver(() => {
      if (!_isAdmin()) return;
      _obs.disconnect();
      try { _scan(); } finally { _obs.observe(document.body, { childList: true, subtree: true }); }
    });
    _obs.observe(document.body, { childList: true, subtree: true });
    // Varreduras iniciais — isAdminUser() (access.js) resolve async; sem
    // novas mutações o observer não dispara, então tentamos algumas vezes.
    [200, 700, 1500, 3000].forEach((ms) => setTimeout(_scan, ms));
  }

  // Clique delegado no document — sobrevive aos re-renders.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.' + BTN);
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (!_isAdmin()) return;
    const card = btn.closest('[data-poem-topic-id]');
    if (!card) return;
    const topicId = card.dataset.poemTopicId || '';
    const n = parseInt(card.dataset.poemIndex, 10);
    const titleEl = card.querySelector('.poetry-card__title');
    const poemTitle = titleEl ? titleEl.textContent.trim() : '';
    if (!topicId) {
      alert('Não consegui identificar o poema (sem âncora). Recarregue a página.');
      return;
    }
    _open({ topicId: topicId, number: isNaN(n) ? 0 : n, poemTitle: poemTitle });
  });

  // Rótulo guardado em poem_title — auto-explicativo na lista do usuário.
  function _composeTitle(number, poemTitle) {
    let t = COLLECTIONS[COLL].name;
    if (number) t += ' · № ' + number;
    if (poemTitle) t += ' — ' + poemTitle;
    return t;
  }

  // ============================================================
  // Modal de seleção de usuários (espelha js/reader-recommend.js)
  // ============================================================
  const THREE_COL_THRESHOLD = 36;
  let _modal = null;
  let _users = [];
  let _selectedUserIds = new Set();
  let _cols = 2;
  let _ctx = null; // { topicId, number, poemTitle }

  function _build() {
    if (_modal) return;
    _modal = document.createElement('div');
    _modal.id = 'poemRecommendModal';
    _modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:none; align-items:center; justify-content:center; z-index:10000;';
    _modal.innerHTML = `
      <div style="background:var(--surface, #fff); color:var(--text-main, #000); width:min(900px, 94vw); height:min(1080px, 96vh); border-radius:10px; padding:24px; box-shadow:0 12px 40px rgba(0,0,0,0.25); display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:.08em; font-weight:600;">Recomendar este poema</div>
            <div id="poemRecTitle" style="font-size:1.05rem; font-weight:600; margin-top:3px; line-height:1.3; color:var(--text-main); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;"></div>
            <div id="poemRecRef" style="font-size:0.72rem; color:var(--text-muted); margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></div>
          </div>
          <button id="poemRecClose" aria-label="Fechar" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-muted); line-height:1; padding:0 4px;">&times;</button>
        </div>
        <input type="text" id="poemRecUserSearch" placeholder="Buscar usuário por nome ou email..." style="padding:8px 12px; font-size:0.88rem; border:1px solid var(--border); border-radius:5px; background:var(--bg, #fff); color:inherit; box-sizing:border-box;">
        <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.75rem; color:var(--text-muted);">
          <span id="poemRecSelCount">Nenhum selecionado</span>
          <button id="poemRecClearSel" type="button" style="background:none; border:none; color:var(--accent); font-size:0.75rem; cursor:pointer; padding:0; text-decoration:underline;" hidden>Limpar seleção</button>
        </div>
        <div id="poemRecUserList" style="flex:1; min-height:200px; overflow-y:auto; border:1px solid var(--border); border-radius:5px; display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); align-content:start;"></div>
        <textarea id="poemRecNote" rows="2" placeholder="Nota opcional (ex.: 'um poema pra esta semana')" style="padding:8px 12px; font-size:0.85rem; border:1px solid var(--border); border-radius:5px; resize:vertical; font-family:inherit; background:var(--bg, #fff); color:inherit; box-sizing:border-box;"></textarea>
        <div style="display:flex; align-items:center; gap:10px;">
          <label style="font-size:0.78rem; color:var(--text-muted); white-space:nowrap;">Auto-arquivar:</label>
          <select id="poemRecExpires" style="flex:1; padding:6px 10px; font-size:0.82rem; border:1px solid var(--border); border-radius:5px; background:var(--bg, #fff); color:inherit; box-sizing:border-box;">
            <option value="">Sem prazo</option>
            <option value="7">Em 7 dias</option>
            <option value="15">Em 15 dias</option>
            <option value="30">Em 30 dias</option>
            <option value="90">Em 90 dias</option>
          </select>
        </div>
        <div id="poemRecMsg" style="font-size:0.82rem; min-height:1.2em;"></div>
        <div style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
          <button id="poemRecCancel" style="padding:7px 16px; font-size:0.85rem; background:none; border:1px solid var(--border); border-radius:5px; cursor:pointer; color:inherit;">Cancelar</button>
          <button id="poemRecSelectAll" type="button" style="padding:7px 16px; font-size:0.85rem; background:none; border:1px solid var(--accent); color:var(--accent); border-radius:5px; cursor:pointer; font-weight:600;" title="Marca todos os usuários da lista (respeita o filtro de busca)">Selecionar todos</button>
          <button id="poemRecSubmit" style="padding:7px 18px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:5px; cursor:pointer; font-weight:600;" disabled>Recomendar</button>
        </div>
      </div>
    `;
    document.body.appendChild(_modal);

    document.getElementById('poemRecClose').onclick = _close;
    document.getElementById('poemRecCancel').onclick = _close;
    document.getElementById('poemRecSubmit').onclick = _submit;
    document.getElementById('poemRecSelectAll').onclick = _selectAllVisible;
    document.getElementById('poemRecUserSearch').oninput = _refresh;
    document.getElementById('poemRecClearSel').onclick = () => { _selectedUserIds.clear(); _refresh(); };
    _modal.addEventListener('click', (e) => { if (e.target === _modal) _close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _modal && _modal.style.display !== 'none') _close();
    });
  }

  async function _loadUsers() {
    if (_users.length > 0) return;
    const supa = _supa();
    if (!supa) return;
    const { data, error } = await supa.rpc('admin_get_users');
    if (error) {
      document.getElementById('poemRecMsg').innerHTML = `<span style="color:#c00;">Erro: ${_esc(error.message)}</span>`;
      return;
    }
    _users = data || [];
  }

  function _filteredUsers() {
    const q = (document.getElementById('poemRecUserSearch')?.value || '').toLowerCase();
    if (!q) return _users.slice();
    return _users.filter(u =>
      (u.display_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q));
  }

  function _refresh() {
    const filtered = _filteredUsers();
    _renderUserList(filtered);
    _updateSelectionUi(filtered);
  }

  function _renderUserList(filtered) {
    const container = document.getElementById('poemRecUserList');
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
        <div onclick="poemRecToggleUser('${_esc(u.id)}')" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border); ${borderRight} display:flex; align-items:center; gap:10px; min-width:0; ${bg}">
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

  function _selectAllVisible() {
    const visible = _filteredUsers();
    if (visible.length === 0) return;
    const allSelected = visible.every(u => _selectedUserIds.has(u.id));
    if (allSelected) visible.forEach(u => _selectedUserIds.delete(u.id));
    else visible.forEach(u => _selectedUserIds.add(u.id));
    _renderUserList(visible);
    _updateSelectionUi(visible);
  }

  function _updateSelectionUi(filtered) {
    const n = _selectedUserIds.size;
    const count = document.getElementById('poemRecSelCount');
    const clear = document.getElementById('poemRecClearSel');
    const submit = document.getElementById('poemRecSubmit');
    const selAll = document.getElementById('poemRecSelectAll');
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

  function _applyLayout() {
    _cols = _users.length > THREE_COL_THRESHOLD ? 3 : 2;
    const sheet = _modal && _modal.firstElementChild;
    const list = document.getElementById('poemRecUserList');
    if (sheet) sheet.style.width = _cols === 3 ? 'min(1180px, 96vw)' : 'min(900px, 94vw)';
    if (list) list.style.gridTemplateColumns = `repeat(${_cols}, minmax(0, 1fr))`;
  }

  async function _open(ctx) {
    if (!_isAdmin()) return;
    _ctx = ctx;
    _build();
    _selectedUserIds.clear();
    const composed = _composeTitle(ctx.number, ctx.poemTitle);
    document.getElementById('poemRecTitle').textContent = composed;
    document.getElementById('poemRecRef').textContent =
      `${COLLECTIONS[COLL].name} · ${ctx.topicId}`;
    document.getElementById('poemRecUserSearch').value = '';
    document.getElementById('poemRecNote').value = '';
    document.getElementById('poemRecExpires').value = '';
    document.getElementById('poemRecMsg').textContent = '';
    _updateSelectionUi();
    _modal.style.display = 'flex';
    document.getElementById('poemRecUserList').innerHTML = '<div style="grid-column:1/-1; padding:14px; color:var(--text-muted); font-size:0.85rem;">Carregando usuários...</div>';
    await _loadUsers();
    _applyLayout();
    _refresh();
    document.getElementById('poemRecUserSearch').focus();
  }

  function _close() {
    if (_modal) _modal.style.display = 'none';
  }

  function _expiresIso() {
    const days = parseInt(document.getElementById('poemRecExpires')?.value || '0', 10);
    if (!days || days <= 0) return null;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  async function _submit() {
    if (_selectedUserIds.size === 0 || !_ctx) return;
    const supa = _supa();
    if (!supa) return;
    const ids = Array.from(_selectedUserIds);
    if (ids.length >= 10 && !confirm(`Recomendar este poema pra ${ids.length} usuários? Cada um recebe uma cópia e não dá pra desfazer em massa.`)) return;
    const btn = document.getElementById('poemRecSubmit');
    const selAllBtn = document.getElementById('poemRecSelectAll');
    const msg = document.getElementById('poemRecMsg');
    btn.disabled = true;
    selAllBtn.disabled = true;
    msg.style.color = 'var(--text-muted)';
    msg.textContent = `Enviando pra ${ids.length} usuário${ids.length === 1 ? '' : 's'}...`;
    const note = document.getElementById('poemRecNote').value.trim();
    const { data, error } = await supa.rpc('admin_create_poetry_recommendations_bulk', {
      p_user_ids: ids,
      p_collection: COLL,
      p_poem_number: _ctx.number || 0,
      p_poem_topic_id: _ctx.topicId,
      p_poem_title: _composeTitle(_ctx.number, _ctx.poemTitle),
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

  window.poemRecToggleUser = function (uid) {
    if (_selectedUserIds.has(uid)) _selectedUserIds.delete(uid);
    else _selectedUserIds.add(uid);
    _refresh();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _start);
  } else {
    _start();
  }
})();
