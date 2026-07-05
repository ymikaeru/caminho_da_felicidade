// ============================================================
// Playlists (bandejas de ensinamentos do admin)
// ============================================================
// Admin monta playlists/bandejas temáticas adicionando ensinamentos
// enquanto navega pelo site. Cada playlist pode ser recomendada em
// lote a usuários (com cherry-pick) ou impressa como apostila.
//
// Expõe dois pontos de entrada (ambos admin-only, gate em isAdminUser):
//   - openPlaylistAddPicker()  → modal compacto pra adicionar o
//                                ensinamento atual a playlist(s).
//                                Injetado no header do reader.
//   - openPlaylistManager()    → modal grande pra gerenciar todas
//                                as playlists (lista + detalhe,
//                                reordenar, recomendar, apagar).
//                                Injetado no menu/header.
//
// Backend em supabase/migrations/collections.sql.
// Ref: docs/design/001-colecoes-ensinamentos-salvos.md
// ============================================================

(function () {
  let _myCollections = null;   // cache de list_my_collections
  let _allUsers = null;        // cache pra picker de recomendação

  // ---- helpers ----

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

  function _isAdmin() {
    return typeof isAdminUser === 'function' && isAdminUser();
  }

  // Mesma lógica de _currentTeachingMeta em reader-recommend.js.
  // Lê vol/file da query string (?vol=&file=) ou do hash (#v3/sol-e-lua).
  // topic_idx vem de ?topic= ou do .topic-content mais próximo do anchor.
  function _currentTeachingMeta() {
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
    let topic_idx = 0;
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('topic');
      if (fromUrl !== null) {
        const n = parseInt(fromUrl, 10);
        if (!isNaN(n)) topic_idx = n;
      } else {
        const topics = document.querySelectorAll('.topic-content');
        if (topics.length > 1) {
          const anchor = window.innerHeight / 3;
          let bestIdx = 0, bestDist = Infinity;
          topics.forEach((el, i) => {
            const r = el.getBoundingClientRect();
            if (r.height === 0) return;
            const dist = Math.abs(r.top - anchor);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
          });
          topic_idx = bestIdx;
        }
      }
    } catch (e) {}
    const topics = document.querySelectorAll('.topic-content');
    const active = topics[topic_idx];
    let title = (active && active.querySelector('h2, h3, .topic-title') && active.querySelector('h2, h3, .topic-title').textContent)
             || (document.querySelector('.topic-content h1, .glass-pane h1, h1') && document.querySelector('.topic-content h1, .glass-pane h1, h1').textContent)
             || document.title || '';
    title = String(title)
      .replace(/\s*-\s*Caminho da Felicidade\s*$/i, '')
      .replace(/^Meishu-Sama:\s*/i, '')
      .replace(/^Ensinamento de Meishu-Sama:\s*/i, '')
      .replace(/^Palestra de Meishu-Sama:\s*/i, '')
      .trim();
    return { vol, file, topic_idx, title };
  }

  async function _loadCollections(force) {
    if (_myCollections && !force) return _myCollections;
    const supa = _supa();
    if (!supa) return [];
    const { data, error } = await supa.rpc('list_my_collections');
    if (error) { console.warn('[playlists] list_my_collections:', error); return []; }
    _myCollections = data || [];
    return _myCollections;
  }

  // Quais playlists do admin contêm este ensinamento? Query direta
  // em collection_items (RLS gateia por collection.user_id = admin).
  async function _whichCollectionsContain(vol, file, topic_idx) {
    const supa = _supa();
    if (!supa || !vol || !file) return new Set();
    const { data, error } = await supa
      .from('collection_items')
      .select('collection_id')
      .eq('vol', vol).eq('file', file).eq('topic_idx', topic_idx);
    if (error) { console.warn('[playlists] membership:', error); return new Set(); }
    return new Set((data || []).map(r => r.collection_id));
  }

  // ============================================================
  // PICKER MODAL — "Adicionar este ensinamento a uma playlist"
  // ============================================================
  let _pkModal = null;
  let _pkMeta = null;
  let _pkMembership = new Set();
  let _pkBusy = false;

  function _buildPicker() {
    if (_pkModal) return;
    _pkModal = document.createElement('div');
    _pkModal.id = 'playlistAddPickerModal';
    _pkModal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:none; align-items:center; justify-content:center; z-index:10000;';
    _pkModal.innerHTML = `
      <div style="background:var(--surface, #fff); color:var(--text-main, #000); width:min(520px, 94vw); max-height:88vh; border-radius:10px; padding:22px; box-shadow:0 12px 40px rgba(0,0,0,0.25); display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:.08em; font-weight:600;">Adicionar a uma coletânea</div>
            <div id="pkTeachingTitle" style="font-size:1.05rem; font-weight:600; margin-top:3px; line-height:1.3; color:var(--text-main); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;"></div>
            <div id="pkTeaching" style="font-size:0.72rem; color:var(--text-muted); margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></div>
          </div>
          <button id="pkClose" aria-label="Fechar" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-muted); line-height:1; padding:0 4px;">&times;</button>
        </div>
        <div id="pkList" style="flex:1; min-height:80px; overflow-y:auto; border:1px solid var(--border); border-radius:6px;"></div>
        <div style="display:flex; gap:6px; align-items:stretch;">
          <input id="pkNewName" type="text" placeholder="Nome da nova coletânea…" style="flex:1; padding:8px 12px; font-size:0.88rem; border:1px solid var(--border); border-radius:6px; background:var(--bg, #fff); color:inherit; box-sizing:border-box;">
          <button id="pkCreate" style="padding:7px 14px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">+ Criar</button>
        </div>
        <div id="pkMsg" style="font-size:0.8rem; min-height:1.1em; color:var(--text-muted);"></div>
      </div>
    `;
    document.body.appendChild(_pkModal);

    document.getElementById('pkClose').onclick = _closePicker;
    _pkModal.addEventListener('click', e => { if (e.target === _pkModal) _closePicker(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _pkModal && _pkModal.style.display !== 'none') _closePicker();
    });
    document.getElementById('pkCreate').onclick = _pkCreate;
    document.getElementById('pkNewName').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _pkCreate(); }
    });
  }

  function _pkRender() {
    const list = document.getElementById('pkList');
    if (!list) return;
    if (!_myCollections || _myCollections.length === 0) {
      list.innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:0.85rem; text-align:center;">Você ainda não tem coletâneas. Crie a primeira abaixo.</div>';
      return;
    }
    list.innerHTML = _myCollections.map(c => {
      const inIt = _pkMembership.has(c.id);
      const check = inIt
        ? '<span style="display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:5px; background:var(--accent); color:#fff; font-size:0.8rem; flex-shrink:0;">✓</span>'
        : '<span style="display:inline-block; width:20px; height:20px; border-radius:5px; border:1.5px solid var(--border); flex-shrink:0;"></span>';
      const bg = inIt ? 'background:var(--accent-soft, rgba(184,134,11,0.10));' : '';
      return `
        <div data-coll="${_esc(c.id)}" class="pk-item" style="padding:10px 12px; cursor:pointer; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:11px; ${bg}">
          ${check}
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.92rem; font-weight:500;">${_esc(c.name)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted);">${c.item_count} ${c.item_count === 1 ? 'item' : 'itens'}</div>
          </div>
        </div>
      `;
    }).join('');
    list.querySelectorAll('.pk-item').forEach(el => {
      el.onclick = () => _pkToggle(el.dataset.coll);
    });
  }

  async function _pkToggle(collId) {
    if (_pkBusy) return;
    _pkBusy = true;
    const supa = _supa();
    if (!supa || !_pkMeta) { _pkBusy = false; return; }
    const wasIn = _pkMembership.has(collId);
    // Otimista: atualiza UI imediatamente.
    if (wasIn) _pkMembership.delete(collId); else _pkMembership.add(collId);
    _pkRender();
    const rpc = wasIn ? 'remove_from_collection' : 'add_to_collection';
    const { error } = await supa.rpc(rpc, {
      p_collection_id: collId,
      p_vol: _pkMeta.vol,
      p_file: _pkMeta.file,
      p_topic_idx: _pkMeta.topic_idx,
    });
    if (error) {
      // Reverte estado otimista em caso de falha.
      if (wasIn) _pkMembership.add(collId); else _pkMembership.delete(collId);
      const msg = document.getElementById('pkMsg');
      if (msg) { msg.style.color = '#c00'; msg.textContent = 'Erro: ' + error.message; }
      _pkRender();
    } else {
      // Atualiza item_count local.
      const c = _myCollections.find(x => x.id === collId);
      if (c) c.item_count = (c.item_count || 0) + (wasIn ? -1 : 1);
      _pkRender();
      const msg = document.getElementById('pkMsg');
      if (msg) {
        msg.style.color = '#0a7';
        msg.textContent = wasIn ? '✓ Removido' : '✓ Adicionado';
        setTimeout(() => { if (msg) msg.textContent = ''; }, 1500);
      }
    }
    _pkBusy = false;
  }

  async function _pkCreate() {
    if (_pkBusy) return;
    const input = document.getElementById('pkNewName');
    const name = (input?.value || '').trim();
    if (!name) { input?.focus(); return; }
    _pkBusy = true;
    const btn = document.getElementById('pkCreate');
    btn.disabled = true;
    const supa = _supa();
    if (!supa) { _pkBusy = false; btn.disabled = false; return; }
    const { data, error } = await supa.rpc('create_collection', { p_name: name });
    if (error) {
      const msg = document.getElementById('pkMsg');
      if (msg) { msg.style.color = '#c00'; msg.textContent = 'Erro: ' + error.message; }
      btn.disabled = false; _pkBusy = false; return;
    }
    const newId = data;
    // Recarrega lista + adiciona o ensinamento atual à playlist nova.
    await _loadCollections(true);
    if (_pkMeta && _pkMeta.vol && _pkMeta.file) {
      await supa.rpc('add_to_collection', {
        p_collection_id: newId,
        p_vol: _pkMeta.vol,
        p_file: _pkMeta.file,
        p_topic_idx: _pkMeta.topic_idx,
      });
      _pkMembership.add(newId);
      const c = _myCollections.find(x => x.id === newId);
      if (c) c.item_count = 1;
    }
    input.value = '';
    btn.disabled = false;
    _pkRender();
    const msg = document.getElementById('pkMsg');
    if (msg) {
      msg.style.color = '#0a7';
      msg.textContent = '✓ Coletânea criada e ensinamento adicionado';
      setTimeout(() => { if (msg) msg.textContent = ''; }, 1800);
    }
    _pkBusy = false;
  }

  // Aceita:
  //  - número → topic_idx explícito (ex.: botão sob um título no reader),
  //    sobrepõe a detecção por scroll;
  //  - objeto {vol,file,topic_idx,title} → meta pronta (ex.: Central de
  //    Destaques, que NÃO tem vol/file na URL) — mesmo padrão de
  //    openRecommendPicker(arg);
  //  - nada → detecta pelo contexto da página.
  async function _openPicker(arg) {
    if (!_isAdmin()) return;
    _buildPicker();
    if (arg && typeof arg === 'object') {
      _pkMeta = {
        vol: arg.vol,
        file: arg.file,
        topic_idx: Number.isInteger(arg.topic_idx) ? arg.topic_idx : 0,
        title: arg.title || ''
      };
    } else {
      _pkMeta = _currentTeachingMeta();
      if (typeof arg === 'number' && !isNaN(arg)) _pkMeta.topic_idx = arg;
    }
    if (!_pkMeta.vol || !_pkMeta.file) {
      alert('Não consegui identificar o ensinamento atual. Esta página tem vol e file na URL?');
      return;
    }
    document.getElementById('pkTeachingTitle').textContent = _pkMeta.title || '(sem título)';
    document.getElementById('pkTeaching').textContent = `${_pkMeta.vol} · ${_pkMeta.file}`;
    document.getElementById('pkList').innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:0.85rem; text-align:center;">Carregando...</div>';
    document.getElementById('pkMsg').textContent = '';
    document.getElementById('pkNewName').value = '';
    _pkModal.style.display = 'flex';
    const [cols, membership] = await Promise.all([
      _loadCollections(true),
      _whichCollectionsContain(_pkMeta.vol, _pkMeta.file, _pkMeta.topic_idx),
    ]);
    _myCollections = cols;
    _pkMembership = membership;
    _pkRender();
    document.getElementById('pkNewName').focus();
  }

  function _closePicker() {
    if (_pkModal) _pkModal.style.display = 'none';
  }

  // ============================================================
  // MANAGER MODAL — "Central de Coletâneas"
  // ============================================================
  let _mgrModal = null;
  let _mgrCurrentColl = null;   // { id, name } quando em detalhe; null = list view
  let _mgrCurrentItems = [];    // itens do detalhe atual
  let _mgrBusy = false;

  function _buildManager() {
    if (_mgrModal) return;
    _mgrModal = document.createElement('div');
    _mgrModal.id = 'playlistManagerModal';
    _mgrModal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:none; align-items:center; justify-content:center; z-index:9999;';
    _mgrModal.innerHTML = `
      <div style="background:var(--surface, #fff); color:var(--text-main, #000); width:min(820px, 96vw); height:min(820px, 92vh); border-radius:10px; padding:22px; box-shadow:0 12px 40px rgba(0,0,0,0.25); display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <button id="mgrBack" style="background:none; border:none; font-size:1.1rem; cursor:pointer; color:var(--accent); padding:0; display:none;">← Voltar</button>
          <svg id="mgrIcon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <div style="flex:1;">
            <div id="mgrTitle" style="font-size:1.05rem; font-weight:600;">Central de Coletâneas</div>
            <div id="mgrSubtitle" style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;"></div>
          </div>
          <button id="mgrClose" aria-label="Fechar" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-muted); line-height:1; padding:0 4px;">&times;</button>
        </div>
        <div id="mgrBody" style="flex:1; overflow-y:auto; border:1px solid var(--border); border-radius:6px;"></div>
        <div id="mgrFooter" style="display:flex; gap:8px; flex-wrap:wrap; align-items:stretch;"></div>
        <div id="mgrMsg" style="font-size:0.8rem; min-height:1.1em; color:var(--text-muted);"></div>
      </div>
    `;
    document.body.appendChild(_mgrModal);

    document.getElementById('mgrClose').onclick = _closeManager;
    document.getElementById('mgrBack').onclick = () => _mgrShowList();
    _mgrModal.addEventListener('click', e => { if (e.target === _mgrModal) _closeManager(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _mgrModal && _mgrModal.style.display !== 'none') {
        if (_mgrCurrentColl) _mgrShowList(); else _closeManager();
      }
    });
  }

  async function _openManager() {
    if (!_isAdmin()) return;
    _buildManager();
    _mgrModal.style.display = 'flex';
    await _mgrShowList();
  }

  function _closeManager() {
    if (_mgrModal) _mgrModal.style.display = 'none';
  }

  async function _mgrShowList() {
    _mgrCurrentColl = null;
    _mgrCurrentItems = [];
    document.getElementById('mgrBack').style.display = 'none';
    document.getElementById('mgrTitle').textContent = 'Central de Coletâneas';
    document.getElementById('mgrSubtitle').textContent = '';
    document.getElementById('mgrMsg').textContent = '';
    const body = document.getElementById('mgrBody');
    body.innerHTML = '<div style="padding:18px; color:var(--text-muted); font-size:0.88rem; text-align:center;">Carregando...</div>';
    const footer = document.getElementById('mgrFooter');
    footer.innerHTML = `
      <input id="mgrNewName" type="text" placeholder="Nome da nova coletânea…" style="flex:1; min-width:180px; padding:8px 12px; font-size:0.88rem; border:1px solid var(--border); border-radius:6px; background:var(--bg, #fff); color:inherit; box-sizing:border-box;">
      <button id="mgrCreate" style="padding:7px 14px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">+ Criar coletânea</button>
      <button id="mgrImport" title="Colar códigos do NotebookLM e gerar uma coletânea" style="flex-basis:100%; padding:8px 14px; font-size:0.85rem; background:none; color:inherit; border:1px dashed var(--border); border-radius:6px; cursor:pointer; font-weight:600;">⇩ Importar do NotebookLM</button>
    `;
    document.getElementById('mgrCreate').onclick = _mgrCreate;
    document.getElementById('mgrImport').onclick = _mgrShowImport;
    document.getElementById('mgrNewName').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _mgrCreate(); }
    });
    const cols = await _loadCollections(true);
    if (cols.length === 0) {
      body.innerHTML = '<div style="padding:30px 18px; color:var(--text-muted); font-size:0.92rem; text-align:center;">Você ainda não tem coletâneas.<br><span style="font-size:0.82rem;">Crie a primeira no campo abaixo ou adicione ensinamentos pela tela de leitura.</span></div>';
      return;
    }
    body.innerHTML = cols.map(c => `
      <div data-coll="${_esc(c.id)}" data-name="${_esc(c.name)}" class="mgr-row" style="padding:13px 16px; cursor:pointer; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:14px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:0.96rem; font-weight:600;">📂 ${_esc(c.name)}</div>
          <div style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">${c.item_count} ${c.item_count === 1 ? 'ensinamento' : 'ensinamentos'}</div>
        </div>
        <span style="font-size:0.8rem; color:var(--accent); white-space:nowrap;">Abrir →</span>
      </div>
    `).join('');
    body.querySelectorAll('.mgr-row').forEach(el => {
      el.onclick = () => _mgrOpenDetail(el.dataset.coll, el.dataset.name);
    });
  }

  async function _mgrCreate() {
    if (_mgrBusy) return;
    const input = document.getElementById('mgrNewName');
    const name = (input?.value || '').trim();
    if (!name) { input?.focus(); return; }
    _mgrBusy = true;
    const supa = _supa();
    if (!supa) { _mgrBusy = false; return; }
    const { data, error } = await supa.rpc('create_collection', { p_name: name });
    _mgrBusy = false;
    if (error) { _mgrMsg('Erro: ' + error.message, true); return; }
    input.value = '';
    await _mgrShowList();
    _mgrMsg('✓ Coletânea criada');
  }

  // ── Importar do NotebookLM ──────────────────────────────────
  // O NotebookLM acerta volume+arquivo mas erra o NÚMERO do tópico (último
  // dígito) — troca ou inventa. Por isso validamos cada código contra o
  // titles_index (índice de título por-tópico, alinhado ao leitor) e, quando
  // o usuário cola "código — título", consertamos o tópico pelo título.

  function _plNorm(s) {
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[“”"'`´·:：—–\-_.,!?()\[\]「」『』]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // Cache por volume: vol -> { files: Map(f -> [{i,t,tn}]) }  |  null se falhou.
  const _plTitlesCache = {};
  async function _loadTitlesForVols(vols) {
    const base = window.location.pathname.includes('/mioshiec') ? '../' : './';
    await Promise.all([...new Set(vols)].map(async vol => {
      if (Object.prototype.hasOwnProperty.call(_plTitlesCache, vol)) return;
      try {
        const r = await fetch(`${base}site_data/titles_index_${vol}.json?v=1`);
        if (!r.ok) { _plTitlesCache[vol] = null; return; }
        const rows = await r.json();
        const files = new Map();
        for (const e of rows) {
          const arr = files.get(e.f) || [];
          arr.push({ i: e.i, t: e.t || '', tn: _plNorm(e.t || '') });
          files.set(e.f, arr);
        }
        _plTitlesCache[vol] = { files };
      } catch (_) { _plTitlesCache[vol] = null; }
    }));
  }

  function _repairInVol(cache, normT) {
    if (!normT) return null;
    for (const [f, arr] of cache.files) {
      for (const x of arr) if (x.tn === normT) return { f, i: x.i, t: x.t };
    }
    return null;
  }

  // Resolve uma entrada {vol,file,topic_idx,title} -> {status, vol,file,topic_idx, ...}
  // status: 'ok' | 'repaired' | 'invalid' | 'unverified'
  function _resolveEntry(e) {
    const cache = _plTitlesCache[e.vol];
    const f = e.file.replace(/\.html$/i, '');
    const normT = e.title ? _plNorm(e.title) : '';
    const out = (file, topic, status, extra) =>
      Object.assign({ status, vol: e.vol, file, topic_idx: topic, title: e.title }, extra || {});
    if (!cache) return out(e.file, e.topic_idx, 'unverified');   // índice não carregou: confia no código
    const list = cache.files.get(f);
    if (!list) {
      const hit = _repairInVol(cache, normT);
      if (hit) return out(hit.f + '.html', hit.i, 'repaired', { from: `${e.file}#${e.topic_idx}`, resolvedTitle: hit.t });
      return out(e.file, e.topic_idx, 'invalid', { reason: 'arquivo fora do índice' });
    }
    const here = list.find(x => x.i === e.topic_idx);
    if (here) {
      if (!normT || here.tn === normT) return out(e.file, e.topic_idx, 'ok', { resolvedTitle: here.t });
      const better = list.find(x => x.tn === normT);
      if (better) return out(e.file, better.i, 'repaired', { from: `${e.file}#${e.topic_idx}`, resolvedTitle: better.t });
      return out(e.file, e.topic_idx, 'ok', { resolvedTitle: here.t }); // tópico existe; título pode ser paráfrase
    }
    // tópico fora de faixa / inexistente
    if (normT) {
      const better = list.find(x => x.tn === normT)
        || list.find(x => x.tn && (x.tn.includes(normT) || normT.includes(x.tn)));
      if (better) return out(e.file, better.i, 'repaired', { from: `${e.file}#${e.topic_idx}`, resolvedTitle: better.t });
      const hit = _repairInVol(cache, normT);
      if (hit) return out(hit.f + '.html', hit.i, 'repaired', { from: `${e.file}#${e.topic_idx}`, resolvedTitle: hit.t });
    }
    return out(e.file, e.topic_idx, 'invalid', { reason: `tópico ${e.topic_idx} inexistente` });
  }

  // Extrai códigos [[CdF:vol/file/topic]] E URLs reader.html, capturando o
  // TÍTULO que vier logo após o código (até a próxima quebra de linha ou
  // próximo código). Dedupa por código preservando ordem; herda título.
  function _parseCdfEntries(text) {
    if (!text) return [];
    const matches = [];
    const reCode = /\[\[\s*CdF\s*:\s*([a-zA-Z0-9]+)\s*\/\s*([^/\]\s]+)\s*\/\s*(\d+)\s*\]\]/gi;
    let m;
    while ((m = reCode.exec(text)) !== null)
      matches.push({ start: m.index, end: reCode.lastIndex, vol: m[1], file: m[2], topic: m[3] });
    const reUrl = /reader\.html\?[^\s)"'<>]+/gi;
    let u;
    while ((u = reUrl.exec(text)) !== null) {
      const q = u[0];
      const vol = (q.match(/[?&]vol=([^&]+)/) || [])[1];
      const file = (q.match(/[?&]file=([^&]+)/) || [])[1];
      const topic = (q.match(/[?&]topic=(\d+)/) || [])[1] || '0';
      if (vol && file) matches.push({ start: u.index, end: reUrl.lastIndex, vol, file, topic });
    }
    if (!matches.length) return [];
    matches.sort((a, b) => a.start - b.start);
    const out = [], byKey = new Map();
    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      let bound = (i + 1 < matches.length) ? matches[i + 1].start : text.length;
      const nl = text.indexOf('\n', cur.end);
      if (nl !== -1 && nl < bound) bound = nl;
      let title = text.slice(cur.end, bound)
        .replace(/^[\s\-—–:·•|>\d.)\]]+/, '').replace(/\s+/g, ' ').trim();
      if (title.length < 3) title = '';
      let vol = cur.vol.toLowerCase();
      if (!vol.startsWith('mioshiec')) { const mm = vol.match(/(\d+)/); if (mm) vol = 'mioshiec' + mm[1]; else continue; }
      let file;
      try { file = decodeURIComponent(cur.file.trim()); } catch (_) { file = cur.file.trim(); }
      if (!/\.html$/i.test(file)) file += '.html';
      const ti = parseInt(cur.topic, 10);
      const topic_idx = Number.isFinite(ti) ? ti : 0;
      const key = vol + '|' + file + '|' + topic_idx;
      if (byKey.has(key)) { const prev = byKey.get(key); if (!prev.title && title) prev.title = title; continue; }
      const ent = { vol, file, topic_idx, title };
      byKey.set(key, ent); out.push(ent);
    }
    return out;
  }

  function _mgrShowImport() {
    _mgrCurrentColl = null;
    _mgrCurrentItems = [];
    document.getElementById('mgrBack').style.display = 'inline-block';
    document.getElementById('mgrTitle').textContent = 'Importar do NotebookLM';
    document.getElementById('mgrSubtitle').textContent = 'Cole os códigos [[CdF:…]] (ou os links do leitor) que o NotebookLM citou';
    document.getElementById('mgrMsg').textContent = '';
    const body = document.getElementById('mgrBody');
    body.innerHTML = `
      <div style="padding:14px 16px; display:flex; flex-direction:column; gap:10px;">
        <div style="font-size:0.8rem; color:var(--text-muted); line-height:1.55;">
          No NotebookLM, peça: <em>"Para cada ensinamento citado, escreva numa linha o código [[CdF:…]] seguido do título exato"</em>. Cole abaixo e clique em <strong>Analisar</strong> — o título permite corrigir o nº do tópico quando o NotebookLM erra. Também aceito os links <code>reader.html?vol=…</code>.
        </div>
        <textarea id="mgrImportText" placeholder="[[CdF:mioshiec1/zyobun.html/0]]&#10;[[CdF:mioshiec2/…/3]]&#10;…" style="width:100%; min-height:150px; padding:10px 12px; font-size:0.85rem; font-family:ui-monospace,Menlo,Consolas,monospace; border:1px solid var(--border); border-radius:6px; background:var(--bg,#fff); color:inherit; box-sizing:border-box; resize:vertical;"></textarea>
        <div id="mgrImportPreview"></div>
      </div>
    `;
    const footer = document.getElementById('mgrFooter');
    footer.innerHTML = `
      <input id="mgrImportName" type="text" placeholder="Nome da coletânea…" value="Pesquisa NotebookLM" style="flex:1; min-width:140px; padding:8px 12px; font-size:0.88rem; border:1px solid var(--border); border-radius:6px; background:var(--bg,#fff); color:inherit; box-sizing:border-box;">
      <button id="mgrImportAnalyze" style="padding:7px 14px; font-size:0.85rem; background:none; color:inherit; border:1px solid var(--border); border-radius:6px; cursor:pointer; font-weight:600;">Analisar</button>
      <button id="mgrImportCreate" disabled style="padding:7px 16px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600; opacity:0.5;">Criar coletânea (0)</button>
    `;
    let resolved = [];
    const previewEl = () => document.getElementById('mgrImportPreview');
    const createBtn = () => document.getElementById('mgrImportCreate');
    async function analyze() {
      const text = document.getElementById('mgrImportText').value;
      const entries = _parseCdfEntries(text);
      const pv = previewEl(), btn = createBtn();
      btn.disabled = true; btn.style.opacity = '0.5'; btn.textContent = 'Criar coletânea (0)';
      if (!entries.length) {
        pv.innerHTML = text.trim()
          ? '<div style="padding:8px 2px; font-size:0.82rem; color:#c00;">Nenhum código reconhecido. Cole os códigos [[CdF:…]] ou os links reader.html.</div>'
          : '';
        resolved = [];
        return;
      }
      pv.innerHTML = '<div style="padding:10px 2px; font-size:0.82rem; color:var(--text-muted);">Analisando…</div>';
      await _loadTitlesForVols(entries.map(e => e.vol));
      resolved = entries.map(_resolveEntry);
      const addable = resolved.filter(r => r.status !== 'invalid').length;
      const repaired = resolved.filter(r => r.status === 'repaired').length;
      const invalid = resolved.filter(r => r.status === 'invalid').length;
      const STY = {
        ok:         { c: '#0a7', ic: '✓' },
        repaired:   { c: 'var(--accent)', ic: '⚠' },
        unverified: { c: '#999', ic: '•' },
        invalid:    { c: '#c00', ic: '✗' },
      };
      let summary = `${addable} ${addable === 1 ? 'será adicionado' : 'serão adicionados'}`;
      if (repaired) summary += ` · ${repaired} corrigido${repaired === 1 ? '' : 's'}`;
      if (invalid) summary += ` · ${invalid} descartado${invalid === 1 ? '' : 's'}`;
      pv.innerHTML =
        `<div style="padding:8px 2px 6px; font-size:0.82rem; color:var(--text-muted);">${summary}:</div>` +
        '<div style="border:1px solid var(--border); border-radius:6px; max-height:230px; overflow-y:auto;">' +
        resolved.map(r => {
          const s = STY[r.status] || STY.ok;
          const vshort = r.vol.replace('mioshiec', 'V');
          const title = r.resolvedTitle || r.title || r.file;
          let note = '';
          if (r.status === 'repaired') note = `<span style="color:var(--accent); font-size:0.72rem;"> ↻ corrigido de ${_esc(r.from)}</span>`;
          else if (r.status === 'invalid') note = `<span style="color:#c00; font-size:0.72rem;"> — ${_esc(r.reason || 'inválido')} (descartado)</span>`;
          else if (r.status === 'unverified') note = `<span style="color:#999; font-size:0.72rem;"> — não verificado</span>`;
          return `<div style="padding:7px 12px; border-bottom:1px solid var(--border); font-size:0.84rem; border-left:3px solid ${s.c}; ${r.status === 'invalid' ? 'opacity:0.6;' : ''}">
            <span style="color:${s.c}; min-width:18px; display:inline-block;">${s.ic}</span>
            <span style="color:var(--accent);">${_esc(title)}</span>
            <span style="color:var(--text-muted); font-size:0.72rem;"> — ${vshort} · ${_esc(r.file)}#${r.topic_idx}</span>${note}
          </div>`;
        }).join('') +
        '</div>';
      btn.disabled = addable === 0; btn.style.opacity = addable ? '1' : '0.5';
      btn.textContent = `Criar coletânea (${addable})`;
    }
    document.getElementById('mgrImportAnalyze').onclick = analyze;
    createBtn().onclick = () => _mgrRunImport(resolved, document.getElementById('mgrImportName').value);
  }

  async function _mgrRunImport(resolved, name) {
    if (_mgrBusy) return;
    // só entram os resolvíveis (ok/repaired/unverified); dedup após o conserto.
    const toAdd = [], seen = new Set();
    for (const r of (resolved || [])) {
      if (r.status === 'invalid') continue;
      const key = r.vol + '|' + r.file + '|' + r.topic_idx;
      if (seen.has(key)) continue;
      seen.add(key); toAdd.push(r);
    }
    if (!toAdd.length) { _mgrMsg('Nada válido para adicionar.', true); return; }
    name = (name || '').trim() || 'Pesquisa NotebookLM';
    const supa = _supa();
    if (!supa) { _mgrMsg('Sem conexão.', true); return; }
    _mgrBusy = true;
    const btn = document.getElementById('mgrImportCreate');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    _mgrMsg('Criando coletânea…');
    const { data: newId, error } = await supa.rpc('create_collection', { p_name: name });
    if (error || !newId) { _mgrBusy = false; _mgrMsg('Erro ao criar: ' + (error ? error.message : 'sem id'), true); return; }
    let ok = 0, fail = 0;
    for (let i = 0; i < toAdd.length; i++) {
      const p = toAdd[i];
      _mgrMsg(`Adicionando ${i + 1}/${toAdd.length}…`);
      const { error: e2 } = await supa.rpc('add_to_collection', {
        p_collection_id: newId, p_vol: p.vol, p_file: p.file, p_topic_idx: p.topic_idx,
      });
      if (e2) fail++; else ok++;
    }
    _mgrBusy = false;
    await _loadCollections(true);
    await _mgrOpenDetail(newId, name);
    _mgrMsg(fail ? `✓ ${ok} adicionados · ${fail} falharam` : `✓ ${ok} ensinamentos adicionados`);
  }

  async function _mgrOpenDetail(collId, collName) {
    _mgrCurrentColl = { id: collId, name: collName };
    document.getElementById('mgrBack').style.display = 'inline-block';
    document.getElementById('mgrTitle').textContent = collName;
    document.getElementById('mgrSubtitle').textContent = 'Carregando itens...';
    document.getElementById('mgrMsg').textContent = '';
    const body = document.getElementById('mgrBody');
    body.innerHTML = '<div style="padding:18px; color:var(--text-muted); font-size:0.88rem; text-align:center;">Carregando...</div>';
    const footer = document.getElementById('mgrFooter');
    footer.innerHTML = `
      <button id="mgrRecommend" style="padding:8px 14px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">📤 Recomendar esta coletânea</button>
      <button id="mgrPrint" style="padding:8px 14px; font-size:0.85rem; background:none; color:inherit; border:1px solid var(--border); border-radius:6px; cursor:pointer;">🖨️ Imprimir apostila</button>
      <button id="mgrWord" style="padding:8px 14px; font-size:0.85rem; background:none; color:inherit; border:1px solid var(--border); border-radius:6px; cursor:pointer;">📄 Exportar Word</button>
      <button id="mgrRename" style="padding:8px 14px; font-size:0.85rem; background:none; color:inherit; border:1px solid var(--border); border-radius:6px; cursor:pointer;">Renomear</button>
      <button id="mgrDelete" style="padding:8px 14px; font-size:0.85rem; background:none; color:#c00; border:1px solid var(--border); border-radius:6px; cursor:pointer;">Apagar</button>
    `;
    document.getElementById('mgrRecommend').onclick = () => _openRecommend();
    document.getElementById('mgrPrint').onclick = _mgrPrintApostila;
    document.getElementById('mgrWord').onclick = _mgrExportWord;
    document.getElementById('mgrRename').onclick = _mgrRename;
    document.getElementById('mgrDelete').onclick = _mgrDelete;
    const supa = _supa();
    if (!supa) return;
    const { data, error } = await supa.rpc('get_collection_with_items', { p_id: collId });
    if (error) { _mgrMsg('Erro: ' + error.message, true); return; }
    _mgrCurrentItems = data || [];
    document.getElementById('mgrSubtitle').textContent =
      `${_mgrCurrentItems.length} ${_mgrCurrentItems.length === 1 ? 'ensinamento' : 'ensinamentos'}`;
    _mgrRenderItems();
  }

  function _mgrRenderItems() {
    const body = document.getElementById('mgrBody');
    if (!_mgrCurrentItems || _mgrCurrentItems.length === 0) {
      body.innerHTML = '<div style="padding:30px 18px; color:var(--text-muted); font-size:0.9rem; text-align:center;">Coletânea vazia.<br><span style="font-size:0.8rem;">Abra um ensinamento e use "+ Adicionar à coletânea" no header.</span></div>';
      return;
    }
    body.innerHTML = _mgrCurrentItems.map((it, i) => {
      const title = it.title_pt || (it.file ? it.file.replace(/\.html$/, '') : '(sem título)');
      const volShort = it.vol ? it.vol.replace('mioshiec', 'V') : '';
      return `
        <div style="padding:11px 14px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px;">
          <div style="display:flex; flex-direction:column; gap:2px;">
            <button data-idx="${i}" class="mgr-up" title="Mover pra cima" ${i === 0 ? 'disabled' : ''} style="background:none; border:1px solid var(--border); border-radius:4px; padding:2px 7px; font-size:0.7rem; cursor:${i === 0 ? 'not-allowed' : 'pointer'}; color:inherit; opacity:${i === 0 ? '0.3' : '1'};">▲</button>
            <button data-idx="${i}" class="mgr-down" title="Mover pra baixo" ${i === _mgrCurrentItems.length - 1 ? 'disabled' : ''} style="background:none; border:1px solid var(--border); border-radius:4px; padding:2px 7px; font-size:0.7rem; cursor:${i === _mgrCurrentItems.length - 1 ? 'not-allowed' : 'pointer'}; color:inherit; opacity:${i === _mgrCurrentItems.length - 1 ? '0.3' : '1'};">▼</button>
          </div>
          <div style="font-size:0.78rem; color:var(--text-muted); min-width:24px;">${i + 1}.</div>
          <div class="mgr-item-clickable" data-idx="${i}" style="flex:1; min-width:0; cursor:pointer; padding:4px; margin:-4px; border-radius:4px; transition:background 0.15s;" title="Clique pra ler o ensinamento">
            <div style="font-size:0.92rem; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--accent);">${_esc(title)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted);">${_esc(volShort)} · ${_esc(it.file)}${it.topic_idx ? '#' + it.topic_idx : ''}</div>
          </div>
          <button data-idx="${i}" class="mgr-remove" title="Remover da coletânea" style="background:none; border:none; color:#c00; cursor:pointer; padding:4px 8px; font-size:1rem;">×</button>
        </div>
      `;
    }).join('');
    body.querySelectorAll('.mgr-up').forEach(b => { b.onclick = () => _mgrMove(parseInt(b.dataset.idx, 10), -1); });
    body.querySelectorAll('.mgr-down').forEach(b => { b.onclick = () => _mgrMove(parseInt(b.dataset.idx, 10), +1); });
    body.querySelectorAll('.mgr-remove').forEach(b => { b.onclick = () => _mgrRemoveItem(parseInt(b.dataset.idx, 10)); });
    body.querySelectorAll('.mgr-item-clickable').forEach(el => {
      el.onmouseenter = () => { el.style.background = 'rgba(184, 134, 11, 0.08)'; };
      el.onmouseleave = () => { el.style.background = ''; };
      el.onclick = () => _mgrOpenReader(parseInt(el.dataset.idx, 10));
    });
  }

  // Modal de leitura — clique num item da playlist mostra o ensinamento
  // sem sair do manager. Útil pro admin curar a playlist e verificar
  // conteúdo na mesma tela.
  let _readerModal = null;

  // Reusa o visual da Prévia da Busca (.search-preview-overlay/-panel).
  // O CSS de css/modules/_search-preview.css já está bundlado e gerencia
  // backdrop, layout, animação, scroll, fade etc. Aqui só montamos a
  // estrutura HTML com os mesmos class names.
  function _buildReaderModal() {
    if (_readerModal) return;
    _readerModal = document.createElement('div');
    _readerModal.className = 'search-preview-overlay';
    _readerModal.id = 'playlistPreviewOverlay';
    _readerModal.innerHTML = `
      <style id="plPreviewStyles">
        /* Tipografia serif do reader pra dar continuidade visual */
        #plPreviewContent {
          font-family: 'Crimson Pro', Georgia, 'Times New Roman', serif;
          font-size: 1.12rem;
          line-height: 1.8;
          color: var(--text-main);
        }
        #plPreviewContent > p {
          margin: 0 0 16px;
        }
        #plPreviewContent > p:last-child {
          margin-bottom: 0;
        }
        #plPreviewContent b { font-weight: 600; }
        #plPreviewContent i { font-style: italic; }
        /* Esconde o título-legacy duplicado no início (modal header
           já mostra o título). Mantém "(Publicado em...)" inline. */
        #plPreviewContent > p:first-child > b:first-child:has(> font[size="+2"]) {
          display: none;
        }
        #plPreviewContent font { color: inherit !important; }
        #plPreviewContent font[size="+2"] {
          font-size: 1.25rem;
          font-weight: 700;
        }
        /* Labels com size="+1" (Pergunta do fiel, Resposta de Meishu-Sama,
           títulos de seção interna) viram BLOCO pra não ficar colados na
           data/texto anterior — o <br> circundante no source garante que
           o conteúdo que vem depois também fique numa linha própria. */
        #plPreviewContent b:has(> font[size="+1"]) {
          display: block;
          margin: 18px 0 4px;
        }
        #plPreviewContent font[size="+1"] {
          font-weight: 600;
          font-style: italic;
          color: var(--accent) !important;
          font-size: 1rem;
          letter-spacing: 0.01em;
        }
        /* Esconde o <br> trailing — já temos respiro pelo display:block */
        #plPreviewContent b:has(> font[size="+1"]) + br { display: none; }
        #plPreviewContent hr {
          border: none;
          border-top: 1px solid var(--border);
          margin: 22px 0;
        }
        /* Título do modal (search-preview-title) em serif pra combinar */
        #plPreviewPanel .search-preview-title {
          font-family: 'Crimson Pro', Georgia, serif;
        }
      </style>
      <div class="search-preview-panel" id="plPreviewPanel">
        <div class="search-preview-header">
          <button class="search-preview-back" id="plPreviewPrev" title="Anterior" aria-label="Anterior na coletânea">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            <span id="plPreviewPrevLabel">Anterior</span>
          </button>
          <span class="search-preview-badge" id="plPreviewBadge">Prévia da coletânea</span>
          <div style="justify-self:end; display:flex; align-items:center; gap:4px;">
            <button class="search-preview-back search-preview-fwd" id="plPreviewNext" type="button" title="Próximo" aria-label="Próximo na coletânea">
              <span id="plPreviewNextLabel">Próximo</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <button class="modal-close-btn search-preview-close" id="plPreviewClose" aria-label="Fechar" style="position:static;">&times;</button>
          </div>
        </div>
        <div class="search-preview-context">
          <div class="search-preview-breadcrumb" id="plPreviewRef"></div>
          <div class="search-preview-title" id="plPreviewTitle"></div>
        </div>
        <div class="search-preview-body">
          <div class="search-preview-card" id="plPreviewCard">
            <div class="search-preview-card-content" id="plPreviewContent"></div>
            <div class="search-preview-card-fade" aria-hidden="true"></div>
          </div>
        </div>
        <div class="search-preview-footer">
          <button class="search-preview-cta" id="plPreviewOpenReader" title="Abrir página do ensinamento">
            <span>Abrir página do ensinamento</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(_readerModal);
    document.getElementById('plPreviewClose').onclick = _mgrCloseReader;
    document.getElementById('plPreviewPrev').onclick = () => _mgrReaderNav(-1);
    document.getElementById('plPreviewNext').onclick = () => _mgrReaderNav(+1);
    document.getElementById('plPreviewOpenReader').onclick = _mgrOpenInReader;
    _readerModal.addEventListener('click', e => { if (e.target === _readerModal) _mgrCloseReader(); });
    document.addEventListener('keydown', e => {
      if (!_readerModal || !_readerModal.classList.contains('active')) return;
      if (e.key === 'Escape') _mgrCloseReader();
      else if (e.key === 'ArrowLeft') _mgrReaderNav(-1);
      else if (e.key === 'ArrowRight') _mgrReaderNav(+1);
    });
  }

  function _mgrCloseReader() {
    if (_readerModal) _readerModal.classList.remove('active');
  }

  let _mgrReaderIdx = 0;

  async function _mgrOpenReader(itemIdx) {
    if (!_mgrCurrentItems || !_mgrCurrentItems[itemIdx]) return;
    _buildReaderModal();
    _mgrReaderIdx = itemIdx;
    _readerModal.classList.add('active');
    await _mgrRenderReaderItem();
  }

  async function _mgrReaderNav(delta) {
    const next = _mgrReaderIdx + delta;
    if (next < 0 || next >= _mgrCurrentItems.length) return;
    _mgrReaderIdx = next;
    await _mgrRenderReaderItem();
  }

  // CTA do footer: abre a página completa do ensinamento em nova aba.
  function _mgrOpenInReader() {
    const it = _mgrCurrentItems[_mgrReaderIdx];
    if (!it) return;
    const basePath = window.location.pathname.includes('/mioshiec') ? '../' : './';
    const lang = localStorage.getItem('site_lang') || 'pt';
    const url = `${basePath}reader.html?vol=${encodeURIComponent(it.vol)}&file=${encodeURIComponent(it.file)}&topic=${it.topic_idx || 0}&lang=${lang}`;
    window.open(url, '_blank', 'noopener');
  }

  // Render igual ao search preview: fetch JSON do storage, achata topics,
  // pega só o tópico focado, strip HTML → paragráfos. Sem iframe.
  async function _mgrRenderReaderItem() {
    const it = _mgrCurrentItems[_mgrReaderIdx];
    if (!it) return;
    const refEl = document.getElementById('plPreviewRef');
    const titleEl = document.getElementById('plPreviewTitle');
    const contentEl = document.getElementById('plPreviewContent');
    const cardEl = document.getElementById('plPreviewCard');
    const prevBtn = document.getElementById('plPreviewPrev');
    const nextBtn = document.getElementById('plPreviewNext');
    const prevLabel = document.getElementById('plPreviewPrevLabel');
    const nextLabel = document.getElementById('plPreviewNextLabel');

    const lang0 = localStorage.getItem('site_lang') || 'pt';
    const sm = (window.SECTION_MAP && window.SECTION_MAP[it.vol]) || null;
    const entry = sm && sm[it.file] ? sm[it.file] : null;
    const pubName = entry
      ? (lang0 === 'ja' ? (entry.ja || entry.pt) : (entry.pt || entry.ja))
      : `${it.vol} · ${it.file.replace(/\.html$/, '')}`;
    refEl.textContent = `${pubName}   ·   ${_mgrReaderIdx + 1}/${_mgrCurrentItems.length}`;
    titleEl.textContent = it.title_pt || it.file;
    contentEl.innerHTML = '<p style="padding:2rem;text-align:center;color:var(--text-muted);">Carregando…</p>';

    prevBtn.disabled = _mgrReaderIdx === 0;
    nextBtn.disabled = _mgrReaderIdx === _mgrCurrentItems.length - 1;
    if (prevLabel) prevLabel.textContent = _mgrReaderIdx === 0 ? 'Início' : 'Anterior';
    if (nextLabel) nextLabel.textContent = _mgrReaderIdx === _mgrCurrentItems.length - 1 ? 'Fim' : 'Próximo';

    const supa = _supa();
    if (!supa) {
      contentEl.innerHTML = '<p style="padding:2rem;text-align:center;color:#c00;">Cliente Supabase indisponível.</p>';
      return;
    }
    try {
      const fileWithJson = it.file.endsWith('.json') ? it.file : `${it.file}.json`;
      const { data, error } = await supa.storage.from('teachings').download(`${it.vol}/${fileWithJson}`);
      if (error) throw error;
      const json = JSON.parse(await data.text());
      const topics = _flattenTopics(json);
      const topic = topics[it.topic_idx || 0];
      if (!topic) throw new Error('Tópico não encontrado');
      const lang = localStorage.getItem('site_lang') || 'pt';
      const rawContent = lang === 'ja'
        ? (topic.content_ja || topic.content || '')
        : (topic.content_ptbr || topic.content_pt || topic.content || '');
      // Preserva formatação inline (b/i/font) e converte só <br><br>
      // em paragráfo. <br> simples preservado (separa título/data, label
      // /conteúdo). CSS escopado dá hierarquia (font[size="+1/+2"]).
      const formatted = String(rawContent)
        .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '</p><p>');
      contentEl.innerHTML = `<p>${formatted}</p>`;

      // Detecta overflow pra mostrar fade gradient (mesma lógica search preview).
      requestAnimationFrame(() => {
        if (cardEl && contentEl) {
          const s = getComputedStyle(cardEl);
          const padTop = parseFloat(s.paddingTop) || 0;
          const padBottom = parseFloat(s.paddingBottom) || 0;
          const available = cardEl.clientHeight - padTop - padBottom;
          const overflow = contentEl.scrollHeight > available + 8;
          cardEl.classList.toggle('has-overflow', overflow);
        }
        if (contentEl) contentEl.scrollTop = 0;
      });
    } catch (e) {
      contentEl.innerHTML = `<p style="padding:2rem;text-align:center;color:#c00;">Erro: ${_esc(e.message || String(e))}</p>`;
    }
  }

  // Schema dos JSONs em /teachings: { volume_title, themes: [{ topics: [...] }] }.
  // Antiga API (json.topics) ainda suportada como fallback.
  function _flattenTopics(json) {
    const out = [];
    if (Array.isArray(json?.themes)) {
      for (const th of json.themes) {
        if (Array.isArray(th?.topics)) for (const t of th.topics) out.push(t);
      }
    } else if (Array.isArray(json?.topics)) {
      for (const t of json.topics) out.push(t);
    }
    return out;
  }

  async function _mgrMove(idx, delta) {
    if (_mgrBusy) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= _mgrCurrentItems.length) return;
    _mgrBusy = true;
    // Swap local + envia nova ordem inteira.
    const tmp = _mgrCurrentItems[idx];
    _mgrCurrentItems[idx] = _mgrCurrentItems[newIdx];
    _mgrCurrentItems[newIdx] = tmp;
    _mgrRenderItems();
    const supa = _supa();
    if (!supa) { _mgrBusy = false; return; }
    const keys = _mgrCurrentItems.map(it => ({
      vol: it.vol, file: it.file, topic_idx: it.topic_idx,
    }));
    const { error } = await supa.rpc('reorder_collection_items', {
      p_collection_id: _mgrCurrentColl.id,
      p_ordered_keys: keys,
    });
    _mgrBusy = false;
    if (error) { _mgrMsg('Erro ao reordenar: ' + error.message, true); }
  }

  async function _mgrRemoveItem(idx) {
    if (_mgrBusy) return;
    const it = _mgrCurrentItems[idx];
    if (!it) return;
    if (!confirm(`Remover "${it.title_pt || it.file}" desta coletânea?`)) return;
    _mgrBusy = true;
    const supa = _supa();
    if (!supa) { _mgrBusy = false; return; }
    const { error } = await supa.rpc('remove_from_collection', {
      p_collection_id: _mgrCurrentColl.id,
      p_vol: it.vol, p_file: it.file, p_topic_idx: it.topic_idx,
    });
    _mgrBusy = false;
    if (error) { _mgrMsg('Erro: ' + error.message, true); return; }
    _mgrCurrentItems.splice(idx, 1);
    document.getElementById('mgrSubtitle').textContent =
      `${_mgrCurrentItems.length} ${_mgrCurrentItems.length === 1 ? 'ensinamento' : 'ensinamentos'}`;
    _mgrRenderItems();
    _mgrMsg('✓ Removido');
    // Invalida cache da lista pra refletir item_count atualizado.
    _myCollections = null;
  }

  async function _mgrRename() {
    if (!_mgrCurrentColl) return;
    const newName = prompt('Novo nome:', _mgrCurrentColl.name);
    if (!newName || newName.trim() === '' || newName.trim() === _mgrCurrentColl.name) return;
    const supa = _supa();
    if (!supa) return;
    const { error } = await supa.rpc('rename_collection', {
      p_id: _mgrCurrentColl.id, p_new_name: newName.trim(),
    });
    if (error) { _mgrMsg('Erro: ' + error.message, true); return; }
    _mgrCurrentColl.name = newName.trim();
    document.getElementById('mgrTitle').textContent = _mgrCurrentColl.name;
    _myCollections = null;
    _mgrMsg('✓ Renomeada');
  }

  // Baixa o conteúdo de todos os itens da playlist (cache por arquivo) e
  // devolve [{title, content}] na ordem da playlist. Compartilhado por
  // "Imprimir apostila" e "Exportar Word". Retorna null em erro de client
  // (mensagem já exibida); itens com arquivo/tópico inválido são pulados.
  async function _mgrCollectEntries() {
    const supa = _supa();
    if (!supa) {
      _mgrMsg('Erro: cliente Supabase indisponível.', true);
      return null;
    }
    const fileCache = new Map();
    const entries = [];
    for (const it of _mgrCurrentItems) {
      const key = `${it.vol}/${it.file}`;
      if (!fileCache.has(key)) {
        try {
          const fileWithJson = it.file.endsWith('.json') ? it.file : `${it.file}.json`;
          const { data, error } = await supa.storage.from('teachings').download(`${it.vol}/${fileWithJson}`);
          if (error) throw error;
          fileCache.set(key, JSON.parse(await data.text()));
        } catch (e) {
          console.warn('[playlists export] skip', key, e);
          fileCache.set(key, null);
        }
      }
      const full = fileCache.get(key);
      if (!full) continue;
      const topics = _flattenTopics(full);
      const topic = topics[it.topic_idx || 0];
      if (!topic) continue;
      const content = topic.content_ptbr || topic.content_pt || topic.content || topic.content_ja || '';
      const title = it.title_pt || (topics[it.topic_idx || 0]?.title_ptbr) || it.file;
      entries.push({ title, content });
    }
    return entries;
  }

  // Imprime apostila usando window.print() em nova aba — mesma abordagem
  // do printCurrentTeaching do header (content-protection.js). Browser
  // renderiza o HTML nativamente e oferece o diálogo de impressão (que
  // permite "salvar como PDF" se o usuário quiser).
  async function _mgrPrintApostila() {
    if (!_mgrCurrentColl || !_mgrCurrentItems || _mgrCurrentItems.length === 0) {
      _mgrMsg('Coletânea vazia — adicione ensinamentos antes de imprimir.', true);
      return;
    }
    const btn = document.getElementById('mgrPrint');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparando…'; }
    _mgrMsg('Carregando ensinamentos…');

    const entries = await _mgrCollectEntries();
    if (!entries) {
      if (btn) { btn.disabled = false; btn.textContent = '🖨️ Imprimir apostila'; }
      return;
    }

    if (entries.length === 0) {
      _mgrMsg('Nenhum ensinamento válido pra imprimir.', true);
      if (btn) { btn.disabled = false; btn.textContent = '🖨️ Imprimir apostila'; }
      return;
    }

    const safeTitle = String(_mgrCurrentColl.name).replace(/[<>&"']/g, '');
    const date = new Date().toLocaleDateString('pt-BR');
    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<title>${_esc(safeTitle)} — Apostila</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font-family: 'Crimson Pro', Georgia, 'Times New Roman', serif; line-height: 1.75; color: #000; margin: 0; padding: 0; }
  .actions { position: fixed; top: 12px; right: 12px; background: #fff; padding: 10px 14px; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); display: flex; gap: 8px; z-index: 9999; }
  .actions button { padding: 8px 14px; cursor: pointer; font-size: 14px; border: 1px solid #999; background: #fafafa; border-radius: 6px; }
  .actions button.primary { background: #b8860b; color: #fff; border-color: #b8860b; font-weight: 600; }
  .cover { page-break-after: always; padding: 60mm 18mm 0; text-align: center; }
  .cover h1 { font-size: 28pt; margin: 0 0 24pt; line-height: 1.2; }
  .cover .meta { font-size: 11pt; color: #555; }
  .teaching { page-break-before: always; padding: 4mm 18mm 0; }
  .teaching:first-of-type { page-break-before: auto; }
  /* Anula cores customizadas dos <font color="..."> legados — print preto. */
  font, font[color] { color: #000 !important; }
  /* Título do ensinamento — bloco no topo. */
  font[size="+2"] { display: block; font-size: 16pt; line-height: 1.3; margin: 0 0 8pt; font-weight: 700; }
  /* Labels com size="+1" são ambíguos:
     - Label de seção ("Pergunta do fiel", "Resposta de Meishu-Sama"):
       seguidos por <br>, devem ser bloco com espaço acima.
     - Ênfase inline ("o riso é a flor do Paraíso?"): NO <br> depois,
       devem fluir no meio do texto.
     Distinção: presença de <br> imediatamente após o <b> wrapper. */
  font[size="+1"] { font-weight: 600; font-style: italic; }
  b:has(> font[size="+1"]):has(+ br) {
    display: block;
    margin: 14pt 0 2pt;
  }
  /* Esconde o <br> trailing — já temos respiro pelo display:block */
  b:has(> font[size="+1"]) + br { display: none; }
  br { line-height: 1.55; }
  hr { border: none; border-top: 1px solid #999; margin: 14pt 0; }
  p { margin: 0 0 8pt; }
  b { font-weight: 600; }
  i { font-style: italic; }
  @media print {
    .actions { display: none !important; }
    body { padding: 0; }
  }
</style>
</head><body>
<div class="actions">
  <button class="primary" onclick="window.print()">🖨️ Imprimir</button>
  <button onclick="window.close()">Fechar</button>
</div>
<div class="cover">
  <h1>${_esc(safeTitle)}</h1>
  <div class="meta">${entries.length} ensinamento${entries.length === 1 ? '' : 's'} · gerado em ${date}</div>
</div>
${entries.map(e => `<section class="teaching">${e.content}</section>`).join('\n')}
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      _mgrMsg('Popup bloqueado. Permita popups deste site pra gerar a apostila.', true);
      if (btn) { btn.disabled = false; btn.textContent = '🖨️ Imprimir apostila'; }
      return;
    }
    w.document.write(html);
    w.document.close();
    // Dispara impressão automaticamente após carregar.
    w.onload = () => { try { w.focus(); w.print(); } catch (e) {} };
    // Fallback se onload não disparar (page já está pronta após write).
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 600);

    _mgrMsg('✓ Janela de impressão aberta');
    if (btn) { btn.disabled = false; btn.textContent = '🖨️ Imprimir apostila'; }
  }

  // Converte o HTML legado do conteúdo pra algo que o WORD formata bem ao
  // abrir: o Word ignora seletores CSS de atributo (font[size="+2"]) e :has(),
  // então os títulos e labels viram tags com estilo inline. Cores legadas de
  // <font color> caem fora (documento preto, como no print).
  function _wordifyContent(html) {
    let s = String(html || '');
    // Título do ensinamento (<b><font size="+2">…</font></b> ou sem o <b>)
    s = s.replace(/<b>\s*<font[^>]*size="\+2"[^>]*>([\s\S]*?)<\/font>\s*<\/b>/gi,
      '<h2 style="font-size:16pt; line-height:1.3; margin:18pt 0 10pt; font-weight:bold;">$1</h2>');
    s = s.replace(/<font[^>]*size="\+2"[^>]*>([\s\S]*?)<\/font>/gi,
      '<h2 style="font-size:16pt; line-height:1.3; margin:18pt 0 10pt; font-weight:bold;">$1</h2>');
    // Labels de seção / ênfase (+1) → negrito itálico
    s = s.replace(/<font[^>]*size="\+1"[^>]*>([\s\S]*?)<\/font>/gi, '<b><i>$1</i></b>');
    // Demais <font> (cores/tamanhos legados) viram span neutro
    s = s.replace(/<font[^>]*>/gi, '<span>').replace(/<\/font>/gi, '</span>');
    return s;
  }

  // Exporta a playlist como .doc (HTML-de-Word): o Word abre nativamente,
  // já formatado — capa + um ensinamento por página. Sem bibliotecas.
  async function _mgrExportWord() {
    if (!_mgrCurrentColl || !_mgrCurrentItems || _mgrCurrentItems.length === 0) {
      _mgrMsg('Coletânea vazia — adicione ensinamentos antes de exportar.', true);
      return;
    }
    const btn = document.getElementById('mgrWord');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparando…'; }
    _mgrMsg('Carregando ensinamentos…');

    const entries = await _mgrCollectEntries();
    if (!entries || entries.length === 0) {
      if (entries) _mgrMsg('Nenhum ensinamento válido pra exportar.', true);
      if (btn) { btn.disabled = false; btn.textContent = '📄 Exportar Word'; }
      return;
    }

    const safeTitle = String(_mgrCurrentColl.name).replace(/[<>&"']/g, '');
    const date = new Date().toLocaleDateString('pt-BR');
    // Quebra de página clássica do Word-HTML (CSS page-break-* em div também
    // funciona, mas este marcador é o mais confiável entre versões do Word).
    const pageBreak = '<br clear="all" style="mso-special-character:line-break; page-break-before:always;">';
    const docHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${_esc(safeTitle)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.6; color: #000; }
  p { margin: 0 0 8pt; }
  hr { border: none; border-top: 1px solid #999; margin: 14pt 0; }
  b { font-weight: bold; }
  i { font-style: italic; }
</style></head><body>
<div style="text-align:center; margin-top:140pt;">
  <h1 style="font-size:26pt; line-height:1.2; margin:0 0 18pt;">${_esc(safeTitle)}</h1>
  <p style="color:#555555; font-size:11pt;">${entries.length} ensinamento${entries.length === 1 ? '' : 's'} · gerado em ${date}</p>
</div>
${entries.map(e => pageBreak + '\n<div>' + _wordifyContent(e.content) + '</div>').join('\n')}
</body></html>`;

    // BOM na frente: sem ele o Word abre os acentos quebrados.
    const blob = new Blob(['\ufeff', docHtml], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(safeTitle || 'apostila').replace(/[\\/:*?"<>|]/g, '_')}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    _mgrMsg('✓ Documento Word baixado');
    if (btn) { btn.disabled = false; btn.textContent = '📄 Exportar Word'; }
  }

  async function _mgrDelete() {
    if (!_mgrCurrentColl) return;
    if (!confirm(`Apagar a coletânea "${_mgrCurrentColl.name}"?\n\nOs ensinamentos em si não são apagados — só esta organização.\nRecomendações já enviadas continuam intactas (com o nome preservado).`)) return;
    const supa = _supa();
    if (!supa) return;
    const { error } = await supa.rpc('delete_collection', { p_id: _mgrCurrentColl.id });
    if (error) { _mgrMsg('Erro: ' + error.message, true); return; }
    _myCollections = null;
    await _mgrShowList();
    _mgrMsg('✓ Coletânea apagada');
  }

  function _mgrMsg(text, isErr) {
    const el = document.getElementById('mgrMsg');
    if (!el) return;
    el.style.color = isErr ? '#c00' : '#0a7';
    el.textContent = text;
    if (!isErr) setTimeout(() => { if (el) el.textContent = ''; }, 1800);
  }

  // ============================================================
  // RECOMMEND SUB-MODAL — "Recomendar esta coletânea"
  // ============================================================
  // Reusa estilo do reader-recommend.js. Diferença: lista de itens da
  // playlist com checkboxes (cherry-pick) + chama
  // send_playlist_recommendations.
  let _recModal = null;
  let _recSelectedUsers = new Set();
  let _recSelectedItems = new Set();   // chaves "vol|file|topic_idx" marcadas
  let _recCols = 2;
  const REC_THREE_COL_THRESHOLD = 36;

  function _itemKey(it) { return `${it.vol}|${it.file}|${it.topic_idx}`; }

  function _buildRecommend() {
    if (_recModal) return;
    _recModal = document.createElement('div');
    _recModal.id = 'playlistRecommendModal';
    _recModal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.55); display:none; align-items:center; justify-content:center; z-index:10001;';
    _recModal.innerHTML = `
      <div style="background:var(--surface, #fff); color:var(--text-main, #000); width:min(1080px, 96vw); height:min(1080px, 95vh); border-radius:10px; padding:22px; box-shadow:0 12px 40px rgba(0,0,0,0.3); display:flex; flex-direction:column; gap:12px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          <div style="flex:1;">
            <div style="font-size:1.05rem; font-weight:600;">Recomendar coletânea</div>
            <div id="recPlName" style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;"></div>
          </div>
          <button id="recPlClose" aria-label="Fechar" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-muted); line-height:1; padding:0 4px;">&times;</button>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:14px; flex:1; min-height:0;">
          <div style="display:flex; flex-direction:column; gap:8px; min-height:0;">
            <div style="font-size:0.78rem; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:.08em;">Itens a enviar</div>
            <div style="display:flex; gap:8px;">
              <button id="recPlSelAllItems" style="padding:4px 10px; font-size:0.75rem; background:none; border:1px solid var(--border); border-radius:5px; cursor:pointer; color:inherit;">Marcar tudo</button>
              <button id="recPlUnselAllItems" style="padding:4px 10px; font-size:0.75rem; background:none; border:1px solid var(--border); border-radius:5px; cursor:pointer; color:inherit;">Desmarcar tudo</button>
              <span id="recPlItemCount" style="margin-left:auto; font-size:0.75rem; color:var(--text-muted); align-self:center;"></span>
            </div>
            <div id="recPlItemList" style="flex:1; min-height:160px; overflow-y:auto; border:1px solid var(--border); border-radius:6px;"></div>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; min-height:0;">
            <div style="font-size:0.78rem; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:.08em;">Destinatários</div>
            <input type="text" id="recPlUserSearch" placeholder="Buscar usuário..." style="padding:8px 12px; font-size:0.88rem; border:1px solid var(--border); border-radius:5px; background:var(--bg, #fff); color:inherit; box-sizing:border-box;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span id="recPlUserCount" style="font-size:0.75rem; color:var(--text-muted);">Nenhum selecionado</span>
              <button id="recPlSelAllUsers" type="button" style="margin-left:auto; padding:4px 10px; font-size:0.75rem; background:none; border:1px solid var(--accent); color:var(--accent); border-radius:5px; cursor:pointer;">Selecionar todos</button>
              <button id="recPlClearUsers" type="button" style="padding:4px 10px; font-size:0.75rem; background:none; border:1px solid var(--border); color:inherit; border-radius:5px; cursor:pointer;" hidden>Limpar</button>
            </div>
            <div id="recPlUserList" style="flex:1; min-height:160px; overflow-y:auto; border:1px solid var(--border); border-radius:5px; display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); align-content:start;"></div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <label style="font-size:0.78rem; color:var(--text-muted); white-space:nowrap;">Auto-arquivar:</label>
          <select id="recPlExpires" style="padding:6px 10px; font-size:0.82rem; border:1px solid var(--border); border-radius:5px; background:var(--bg, #fff); color:inherit;">
            <option value="">Sem prazo</option>
            <option value="7">Em 7 dias</option>
            <option value="15">Em 15 dias</option>
            <option value="30">Em 30 dias</option>
            <option value="90">Em 90 dias</option>
          </select>
          <input id="recPlNote" type="text" placeholder="Nota opcional (mesma pra todos os itens)" style="flex:1; min-width:200px; padding:6px 12px; font-size:0.85rem; border:1px solid var(--border); border-radius:5px; background:var(--bg, #fff); color:inherit;">
        </div>
        <div id="recPlMsg" style="font-size:0.82rem; min-height:1.1em;"></div>
        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button id="recPlCancel" style="padding:7px 16px; font-size:0.85rem; background:none; border:1px solid var(--border); border-radius:6px; cursor:pointer; color:inherit;">Cancelar</button>
          <button id="recPlSubmit" style="padding:7px 20px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;" disabled>Enviar</button>
        </div>
      </div>
    `;
    document.body.appendChild(_recModal);
    document.getElementById('recPlClose').onclick = _closeRecommend;
    document.getElementById('recPlCancel').onclick = _closeRecommend;
    document.getElementById('recPlSubmit').onclick = _submitRecommend;
    document.getElementById('recPlSelAllItems').onclick = () => {
      _mgrCurrentItems.forEach(it => _recSelectedItems.add(_itemKey(it)));
      _recRenderItems(); _recUpdate();
    };
    document.getElementById('recPlUnselAllItems').onclick = () => {
      _recSelectedItems.clear(); _recRenderItems(); _recUpdate();
    };
    document.getElementById('recPlSelAllUsers').onclick = _recToggleAllVisibleUsers;
    document.getElementById('recPlClearUsers').onclick = () => {
      _recSelectedUsers.clear(); _recRenderUsers(); _recUpdate();
    };
    document.getElementById('recPlUserSearch').oninput = () => { _recRenderUsers(); _recUpdate(); };
    _recModal.addEventListener('click', e => { if (e.target === _recModal) _closeRecommend(); });
  }

  async function _openRecommend() {
    if (!_mgrCurrentColl || _mgrCurrentItems.length === 0) {
      _mgrMsg('Coletânea vazia — adicione ensinamentos antes de recomendar.', true);
      return;
    }
    _buildRecommend();
    _recSelectedUsers.clear();
    _recSelectedItems = new Set(_mgrCurrentItems.map(_itemKey));   // default todos marcados
    document.getElementById('recPlName').textContent =
      `📂 ${_mgrCurrentColl.name} — ${_mgrCurrentItems.length} ${_mgrCurrentItems.length === 1 ? 'item' : 'itens'}`;
    document.getElementById('recPlUserSearch').value = '';
    document.getElementById('recPlNote').value = '';
    document.getElementById('recPlExpires').value = '';
    document.getElementById('recPlMsg').textContent = '';
    _recRenderItems();
    document.getElementById('recPlUserList').innerHTML = '<div style="grid-column:1/-1; padding:14px; color:var(--text-muted); font-size:0.85rem;">Carregando usuários...</div>';
    _recModal.style.display = 'flex';
    await _recLoadUsers();
    _recApplyLayout();
    _recRenderUsers();
    _recUpdate();
  }

  function _closeRecommend() {
    if (_recModal) _recModal.style.display = 'none';
  }

  function _recRenderItems() {
    const list = document.getElementById('recPlItemList');
    if (!list) return;
    list.innerHTML = _mgrCurrentItems.map((it, i) => {
      const k = _itemKey(it);
      const isOn = _recSelectedItems.has(k);
      const check = isOn
        ? '<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:4px; background:var(--accent); color:#fff; font-size:0.75rem; flex-shrink:0;">✓</span>'
        : '<span style="display:inline-block; width:18px; height:18px; border-radius:4px; border:1.5px solid var(--border); flex-shrink:0;"></span>';
      const bg = isOn ? 'background:var(--accent-soft, rgba(184,134,11,0.10));' : '';
      const title = it.title_pt || (it.file ? it.file.replace(/\.html$/, '') : '(sem título)');
      return `
        <div data-k="${_esc(k)}" class="rec-item" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px; ${bg}">
          ${check}
          <div style="font-size:0.78rem; color:var(--text-muted); min-width:20px;">${i + 1}.</div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.85rem; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_esc(title)}</div>
          </div>
        </div>
      `;
    }).join('');
    list.querySelectorAll('.rec-item').forEach(el => {
      el.onclick = () => {
        const k = el.dataset.k;
        if (_recSelectedItems.has(k)) _recSelectedItems.delete(k); else _recSelectedItems.add(k);
        _recRenderItems(); _recUpdate();
      };
    });
  }

  async function _recLoadUsers() {
    if (_allUsers) return;
    const supa = _supa();
    if (!supa) return;
    const { data, error } = await supa.rpc('admin_get_users');
    if (error) { console.warn('[playlists] admin_get_users:', error); return; }
    _allUsers = data || [];
  }

  function _recFilteredUsers() {
    const q = (document.getElementById('recPlUserSearch')?.value || '').toLowerCase();
    if (!q) return (_allUsers || []).slice();
    return (_allUsers || []).filter(u =>
      (u.display_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  }

  function _recApplyLayout() {
    _recCols = (_allUsers || []).length > REC_THREE_COL_THRESHOLD ? 3 : 2;
    const sheet = _recModal && _recModal.firstElementChild;
    const list = document.getElementById('recPlUserList');
    if (list) list.style.gridTemplateColumns = `repeat(${_recCols}, minmax(0, 1fr))`;
    // (Modal já é largo; sem reagir aqui pra simplificar.)
  }

  function _recRenderUsers() {
    const list = document.getElementById('recPlUserList');
    if (!list) return;
    const filtered = _recFilteredUsers();
    if (filtered.length === 0) {
      list.innerHTML = '<div style="grid-column:1/-1; padding:14px; color:var(--text-muted); font-size:0.85rem; text-align:center;">Nenhum usuário.</div>';
      return;
    }
    const prevScroll = list.scrollTop;
    list.innerHTML = filtered.slice(0, 400).map((u, i) => {
      const isSel = _recSelectedUsers.has(u.id);
      const bg = isSel ? 'background:var(--accent-soft, rgba(184,134,11,0.15)); border-left:3px solid var(--accent);' : 'border-left:3px solid transparent;';
      const isLastCol = (i % _recCols) === (_recCols - 1);
      const borderRight = isLastCol ? '' : 'border-right:1px solid var(--border);';
      const check = isSel
        ? '<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:4px; background:var(--accent); color:#fff; font-size:0.75rem; flex-shrink:0;">✓</span>'
        : '<span style="display:inline-block; width:18px; height:18px; border-radius:4px; border:1.5px solid var(--border); flex-shrink:0;"></span>';
      return `
        <div data-uid="${_esc(u.id)}" class="rec-user" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border); ${borderRight} display:flex; align-items:center; gap:10px; min-width:0; ${bg}">
          ${check}
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.85rem; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_esc(u.display_name || 'Sem nome')}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_esc(u.email || '—')}</div>
          </div>
        </div>
      `;
    }).join('');
    list.scrollTop = prevScroll;
    list.querySelectorAll('.rec-user').forEach(el => {
      el.onclick = () => {
        const uid = el.dataset.uid;
        if (_recSelectedUsers.has(uid)) _recSelectedUsers.delete(uid); else _recSelectedUsers.add(uid);
        _recRenderUsers(); _recUpdate();
      };
    });
  }

  function _recToggleAllVisibleUsers() {
    const visible = _recFilteredUsers();
    if (visible.length === 0) return;
    const allSel = visible.every(u => _recSelectedUsers.has(u.id));
    if (allSel) visible.forEach(u => _recSelectedUsers.delete(u.id));
    else visible.forEach(u => _recSelectedUsers.add(u.id));
    _recRenderUsers(); _recUpdate();
  }

  function _recUpdate() {
    const nU = _recSelectedUsers.size;
    const nI = _recSelectedItems.size;
    document.getElementById('recPlUserCount').textContent =
      nU === 0 ? 'Nenhum selecionado' : (nU === 1 ? '1 usuário' : `${nU} usuários`);
    document.getElementById('recPlClearUsers').hidden = nU === 0;
    document.getElementById('recPlItemCount').textContent =
      `${nI} de ${_mgrCurrentItems.length} ${nI === 1 ? 'item' : 'itens'} marcados`;
    const visible = _recFilteredUsers();
    const allVisibleSelected = visible.length > 0 && visible.every(u => _recSelectedUsers.has(u.id));
    document.getElementById('recPlSelAllUsers').textContent =
      allVisibleSelected ? 'Desmarcar todos' : 'Selecionar todos';
    const submit = document.getElementById('recPlSubmit');
    submit.disabled = (nU === 0 || nI === 0);
    submit.textContent =
      nU > 0 && nI > 0
        ? `Enviar (${nI} × ${nU} = ${nI * nU})`
        : 'Enviar';
  }

  function _recExpiresIso() {
    const days = parseInt(document.getElementById('recPlExpires')?.value || '0', 10);
    if (!days || days <= 0) return null;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  async function _submitRecommend() {
    const nU = _recSelectedUsers.size;
    const nI = _recSelectedItems.size;
    if (nU === 0 || nI === 0) return;
    const total = nU * nI;
    if (total >= 30 && !confirm(`Enviar ${nI} ensinamento(s) pra ${nU} usuário(s)? Total: ${total} recomendações.\nNão dá pra desfazer em massa.`)) return;
    const supa = _supa();
    if (!supa) return;
    const btn = document.getElementById('recPlSubmit');
    const msg = document.getElementById('recPlMsg');
    btn.disabled = true;
    msg.style.color = 'var(--text-muted)';
    msg.textContent = `Enviando ${total} recomendaç${total === 1 ? 'ão' : 'ões'}...`;
    const itemKeys = _mgrCurrentItems
      .filter(it => _recSelectedItems.has(_itemKey(it)))
      .map(it => ({ vol: it.vol, file: it.file, topic_idx: it.topic_idx }));
    const note = (document.getElementById('recPlNote').value || '').trim();
    const { data, error } = await supa.rpc('send_playlist_recommendations', {
      p_collection_id: _mgrCurrentColl.id,
      p_recipient_ids: Array.from(_recSelectedUsers),
      p_item_keys: itemKeys,
      p_note: note || null,
      p_expires_at: _recExpiresIso(),
    });
    if (error) {
      msg.style.color = '#c00';
      msg.textContent = 'Erro: ' + error.message;
      btn.disabled = false;
      return;
    }
    const created = typeof data === 'number' ? data : total;
    const skipped = total - created;
    const suffix = skipped > 0 ? ` (${skipped} já existiam ativas e foram ignoradas)` : '';
    msg.style.color = '#0a7';
    msg.textContent = `✓ ${created} recomendaç${created === 1 ? 'ão criada' : 'ões criadas'}${suffix}.`;
    setTimeout(_closeRecommend, 1500);
  }

  // ============================================================
  // SEARCH MULTI-SELECT — admin-only modo seleção múltipla na busca
  // ============================================================
  // Botão "📂 Selecionar" injetado na barra de Avançada do search modal.
  // Quando ativo, click num resultado vira toggle de seleção (em vez de
  // navegar). Barra fixa no rodapé mostra contagem + "Adicionar à coletânea".
  let _msSelected = new Map();   // key "vol|file|topic" → {vol, file, topic_idx, title}
  let _msActive = false;
  let _msFooter = null;
  let _msToggleBtn = null;
  let _msAddModal = null;

  function _msKey(vol, file, topic) { return `${vol}|${file}|${topic}`; }

  // Injeta estilos uma vez. Visual: borda colorida + ✓ verde quando marcado;
  // cursor pointer; bloqueia o efeito de hover do <a> em select-mode.
  function _msInjectStyles() {
    if (document.getElementById('msStyles')) return;
    const s = document.createElement('style');
    s.id = 'msStyles';
    s.textContent = `
      #searchResults.ms-active .search-nav-item {
        position: relative;
        padding-left: 38px !important;
      }
      #searchResults.ms-active .search-nav-item::before {
        content: "";
        position: absolute;
        left: 12px; top: 50%; transform: translateY(-50%);
        width: 18px; height: 18px;
        border: 1.5px solid var(--border);
        border-radius: 4px;
        background: transparent;
      }
      #searchResults.ms-active .search-nav-item.ms-checked::before {
        content: "✓";
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
        font-size: 0.78rem;
        text-align: center;
        line-height: 18px;
      }
      #searchResults.ms-active .search-nav-item.ms-checked {
        background: rgba(184, 134, 11, 0.07);
      }
      #msToggle.is-active {
        background: var(--accent) !important;
        color: #fff !important;
      }
    `;
    document.head.appendChild(s);
  }

  function _msInject() {
    if (!_isAdmin()) return;
    const modal = document.getElementById('searchModal');
    if (!modal) return;
    const advRow = modal.querySelector('.search-advanced-row');
    if (!advRow || advRow.querySelector('#msToggle')) return;
    _msInjectStyles();
    _msToggleBtn = document.createElement('button');
    _msToggleBtn.type = 'button';
    _msToggleBtn.id = 'msToggle';
    _msToggleBtn.className = 'search-advanced-btn';
    _msToggleBtn.style.marginLeft = '8px';
    _msToggleBtn.setAttribute('aria-pressed', 'false');
    _msToggleBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        <polyline points="9 14 11 16 15 12"/>
      </svg>
      <span>Selecionar</span>
    `;
    _msToggleBtn.onclick = _msToggleMode;
    advRow.appendChild(_msToggleBtn);

    // Event delegation: capture click on the search results UL.
    const list = document.getElementById('searchResults');
    if (list) {
      list.addEventListener('click', _msHandleClick, true);
      // Quando os resultados re-renderizam, reaplica ms-checked.
      const obs = new MutationObserver(() => { if (_msActive) _msReapplyCheckmarks(); });
      obs.observe(list, { childList: true });
    }
  }

  function _msToggleMode() {
    _msActive = !_msActive;
    const list = document.getElementById('searchResults');
    if (list) list.classList.toggle('ms-active', _msActive);
    _msToggleBtn.setAttribute('aria-pressed', String(_msActive));
    _msToggleBtn.classList.toggle('is-active', _msActive);
    if (_msActive) {
      _msShowFooter();
      _msReapplyCheckmarks();
    } else {
      _msSelected.clear();
      _msHideFooter();
      _msReapplyCheckmarks();
    }
  }

  function _msHandleClick(e) {
    if (!_msActive) return;
    // .search-nav-item = âncoras do layout agrupado (cabeçalho da
    // publicação + trechos); era .search-result-item no layout antigo.
    const item = e.target.closest('.search-nav-item');
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    const vol = item.dataset.vol;
    const file = item.dataset.file;
    const topic = parseInt(item.dataset.topic || '0', 10);
    if (!vol || !file) return;
    const k = _msKey(vol, file, topic);
    if (_msSelected.has(k)) {
      _msSelected.delete(k);
      item.classList.remove('ms-checked');
    } else {
      _msSelected.set(k, { vol, file, topic_idx: topic, title: item.dataset.title || '' });
      item.classList.add('ms-checked');
    }
    _msUpdateFooter();
  }

  function _msReapplyCheckmarks() {
    document.querySelectorAll('#searchResults .search-nav-item').forEach(it => {
      const k = _msKey(it.dataset.vol, it.dataset.file, parseInt(it.dataset.topic || '0', 10));
      it.classList.toggle('ms-checked', _msSelected.has(k));
    });
  }

  function _msShowFooter() {
    if (!_msFooter) {
      _msFooter = document.createElement('div');
      _msFooter.id = 'msFooter';
      _msFooter.style.cssText = 'position:fixed; bottom:0; left:0; right:0; background:var(--surface, #fff); color:var(--text-main); border-top:1px solid var(--border); padding:12px 20px; display:flex; align-items:center; gap:12px; z-index:100000; box-shadow:0 -4px 18px rgba(0,0,0,0.10);';
      _msFooter.innerHTML = `
        <span id="msFooterCount" style="font-size:0.88rem; margin-right:auto;">Nenhum selecionado</span>
        <button id="msFooterClear" type="button" style="padding:6px 12px; font-size:0.82rem; background:none; border:1px solid var(--border); color:inherit; border-radius:6px; cursor:pointer;" hidden>Limpar</button>
        <button id="msFooterAdd" type="button" style="padding:7px 16px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;" disabled>📂 Adicionar à coletânea</button>
      `;
      document.body.appendChild(_msFooter);
      document.getElementById('msFooterClear').onclick = () => {
        _msSelected.clear(); _msReapplyCheckmarks(); _msUpdateFooter();
      };
      document.getElementById('msFooterAdd').onclick = _msOpenAddToPicker;
    }
    _msFooter.style.display = 'flex';
    _msUpdateFooter();
  }

  function _msHideFooter() {
    if (_msFooter) _msFooter.style.display = 'none';
  }

  function _msUpdateFooter() {
    if (!_msFooter) return;
    const n = _msSelected.size;
    document.getElementById('msFooterCount').textContent =
      n === 0 ? 'Nenhum selecionado'
              : n === 1 ? '✓ 1 ensinamento selecionado'
                        : `✓ ${n} ensinamentos selecionados`;
    document.getElementById('msFooterClear').hidden = n === 0;
    document.getElementById('msFooterAdd').disabled = n === 0;
  }

  // ---- Modal compacto pra adicionar TODOS os selecionados a UMA playlist
  function _msBuildAddModal() {
    if (_msAddModal) return;
    _msAddModal = document.createElement('div');
    _msAddModal.id = 'msAddModal';
    _msAddModal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.55); display:none; align-items:center; justify-content:center; z-index:100001;';
    _msAddModal.innerHTML = `
      <div style="background:var(--surface, #fff); color:var(--text-main, #000); width:min(520px, 94vw); max-height:88vh; border-radius:10px; padding:22px; box-shadow:0 12px 40px rgba(0,0,0,0.3); display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/>
            <line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
          <div style="flex:1;">
            <div style="font-size:1.05rem; font-weight:600;">Adicionar a uma coletânea</div>
            <div id="msAddCount" style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;"></div>
          </div>
          <button id="msAddClose" aria-label="Fechar" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-muted); line-height:1; padding:0 4px;">&times;</button>
        </div>
        <div id="msAddList" style="flex:1; min-height:120px; max-height:50vh; overflow-y:auto; border:1px solid var(--border); border-radius:6px;"></div>
        <div style="display:flex; gap:6px; align-items:stretch;">
          <input id="msAddNewName" type="text" placeholder="Nome da nova coletânea…" style="flex:1; padding:8px 12px; font-size:0.88rem; border:1px solid var(--border); border-radius:6px; background:var(--bg, #fff); color:inherit; box-sizing:border-box;">
          <button id="msAddCreate" style="padding:7px 14px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">+ Criar e adicionar</button>
        </div>
        <div id="msAddMsg" style="font-size:0.8rem; min-height:1.1em; color:var(--text-muted);"></div>
      </div>
    `;
    document.body.appendChild(_msAddModal);
    document.getElementById('msAddClose').onclick = _msCloseAddModal;
    _msAddModal.addEventListener('click', e => { if (e.target === _msAddModal) _msCloseAddModal(); });
    document.getElementById('msAddCreate').onclick = _msAddCreateAndAdd;
    document.getElementById('msAddNewName').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _msAddCreateAndAdd(); }
    });
  }

  async function _msOpenAddToPicker() {
    if (_msSelected.size === 0) return;
    _msBuildAddModal();
    document.getElementById('msAddCount').textContent =
      `${_msSelected.size} ${_msSelected.size === 1 ? 'ensinamento' : 'ensinamentos'} selecionado${_msSelected.size === 1 ? '' : 's'}`;
    document.getElementById('msAddMsg').textContent = '';
    document.getElementById('msAddNewName').value = '';
    document.getElementById('msAddList').innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:0.85rem; text-align:center;">Carregando...</div>';
    _msAddModal.style.display = 'flex';
    const cols = await _loadCollections(true);
    _msAddRenderList(cols);
    document.getElementById('msAddNewName').focus();
  }

  function _msCloseAddModal() {
    if (_msAddModal) _msAddModal.style.display = 'none';
  }

  function _msAddRenderList(cols) {
    const list = document.getElementById('msAddList');
    if (!cols || cols.length === 0) {
      list.innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:0.85rem; text-align:center;">Nenhuma coletânea ainda. Crie uma abaixo.</div>';
      return;
    }
    list.innerHTML = cols.map(c => `
      <div data-coll="${_esc(c.id)}" class="ms-add-row" style="padding:10px 14px; cursor:pointer; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:11px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:0.92rem; font-weight:500;">📂 ${_esc(c.name)}</div>
          <div style="font-size:0.72rem; color:var(--text-muted);">${c.item_count} ${c.item_count === 1 ? 'item' : 'itens'}</div>
        </div>
        <span style="font-size:0.8rem; color:var(--accent); white-space:nowrap;">+ Adicionar</span>
      </div>
    `).join('');
    list.querySelectorAll('.ms-add-row').forEach(el => {
      el.onclick = () => _msAddToCollection(el.dataset.coll);
    });
  }

  async function _msAddToCollection(collId) {
    const supa = _supa();
    if (!supa) return;
    const items = Array.from(_msSelected.values());
    const msg = document.getElementById('msAddMsg');
    msg.style.color = 'var(--text-muted)';
    msg.textContent = `Adicionando ${items.length}...`;
    let added = 0;
    let failed = 0;
    for (const it of items) {
      const { error } = await supa.rpc('add_to_collection', {
        p_collection_id: collId,
        p_vol: it.vol, p_file: it.file, p_topic_idx: it.topic_idx,
      });
      if (error) { failed++; console.warn('[playlists] add multi:', error); }
      else added++;
    }
    _myCollections = null;   // invalida cache
    if (failed > 0) {
      msg.style.color = '#c00';
      msg.textContent = `${added} adicionados, ${failed} falharam.`;
    } else {
      msg.style.color = '#0a7';
      msg.textContent = `✓ ${added} adicionado${added === 1 ? '' : 's'}`;
    }
    setTimeout(() => {
      _msCloseAddModal();
      // Sai do modo seleção e limpa.
      _msSelected.clear();
      if (_msActive) _msToggleMode();
    }, 1100);
  }

  async function _msAddCreateAndAdd() {
    const input = document.getElementById('msAddNewName');
    const name = (input?.value || '').trim();
    if (!name) { input?.focus(); return; }
    const supa = _supa();
    if (!supa) return;
    const btn = document.getElementById('msAddCreate');
    btn.disabled = true;
    const { data, error } = await supa.rpc('create_collection', { p_name: name });
    btn.disabled = false;
    if (error) {
      const msg = document.getElementById('msAddMsg');
      msg.style.color = '#c00'; msg.textContent = 'Erro: ' + error.message;
      return;
    }
    _myCollections = null;
    await _msAddToCollection(data);
  }

  // ============================================================
  // Inicialização — injeta multi-select quando search modal estiver pronto.
  // ============================================================
  function _initWhenReady() {
    if (document.getElementById('searchModal')) {
      _msInject();
      return;
    }
    // Polling curto (search modal é injetado em DOMContentLoaded em todas
    // as páginas relevantes). Para após 5s pra não vazar.
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (document.getElementById('searchModal')) {
        clearInterval(iv);
        _msInject();
      } else if (tries > 50) {
        clearInterval(iv);
      }
    }, 100);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initWhenReady);
  } else {
    _initWhenReady();
  }

  // ============================================================
  // Exports
  // ============================================================
  window.openPlaylistAddPicker = _openPicker;
  window.openPlaylistManager = _openManager;
})();
