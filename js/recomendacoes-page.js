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
    const active = (a.data || []).filter(r => !_hiddenByAccess(r));
    const archived = (b.data || []).filter(r => !_hiddenByAccess(r));
    await Promise.all([_resolveAudioUrls(supa, active), _resolveAudioUrls(supa, archived)]);
    return { active, archived };
  }

  // Recomendações de áudio guardam só o PATH no bucket privado. Mintamos
  // uma signed URL (validade longa, cobre a sessão de escuta). Só funciona
  // logado — anônimo não consegue gerar a URL.
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

  function _basePathForReader() {
    return window.location.pathname.includes('/mioshiec') ? '../' : '';
  }

  function _formatDate(iso, lang) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR');
  }

  // Walter Fujii prefere ser referido como "Reverendo Walter" nas
  // recomendações exibidas ao usuário. Outros admins (ex: Michael
  // Yamada) aparecem pelo próprio display_name.
  function _displayRecommender(rawName) {
    const name = String(rawName || '').trim();
    if (name === 'Walter Fujii') return 'Reverendo Walter';
    return name;
  }

  // Ícones SVG por tipo
  const _SVG = {
    teaching: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    audio:    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    poetry:   `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/></svg>`,
  };
  const _iconCircle = (t) =>
    `<div style="width:30px;height:30px;border-radius:50%;background:var(--accent-soft,rgba(184,134,11,.13));color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${_SVG[t]}</div>`;

  // Renderiza UM card (sem header de grupo). Retorna HTML string.
  function _renderOneCard(r, archived, lang, base) {
      const recommender = _displayRecommender(r.created_by_name);
      const createdStr = _formatDate(r.created_at, lang);

      // Meta secundária: prazo ou data de arquivamento
      let metaExtra = '';
      if (archived) {
        const archStr = _formatDate(r.archived_at, lang);
        metaExtra = ` <span style="opacity:.35;">·</span> ${_esc(lang === 'ja' ? `アーカイブ: ${archStr}` : `arquivada ${archStr}`)}`;
      } else if (r.expires_at) {
        const daysLeft = Math.ceil((new Date(r.expires_at) - new Date()) / 86400000);
        if (daysLeft > 0) {
          const expLbl = daysLeft === 1
            ? (lang === 'ja' ? '明日に自動アーカイブ' : 'arquivado amanhã')
            : (lang === 'ja' ? `${daysLeft}日後に自動アーカイブ` : `arquivado em ${daysLeft}d`);
          const c = daysLeft <= 3 ? 'color:#c80;' : '';
          metaExtra = ` <span style="opacity:.35;">·</span> <span style="${c}">⏱ ${_esc(expLbl)}</span>`;
        }
      }

      const metaLine = `<div class="rec-card-meta">${recommender ? `<span>${_esc(recommender)}</span><span class="dot">·</span>` : ''}<span>${_esc(createdStr)}</span>${metaExtra}</div>`;
      const noteHtml = r.note ? `<div class="rec-card-note">"${_esc(r.note)}"</div>` : '';

      const actionBtn = archived
        ? `<button class="rec-action-btn primary" data-action="unarchive" data-rec-id="${_esc(r.id)}" type="button">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/><polyline points="14 11 14 17 10 17"/></svg>
            <span>${_esc(lang === 'ja' ? '戻す' : 'Desarquivar')}</span>
          </button>`
        : `<button class="rec-action-btn" data-action="archive" data-rec-id="${_esc(r.id)}" type="button">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            <span>${_esc(lang === 'ja' ? 'アーカイブ' : 'Arquivar')}</span>
          </button>`;

      const cardCls = archived ? 'rec-card archived' : 'rec-card';

      // Helper: monta o corpo interno do card com ícone + título + meta + conteúdo
      const body = (type, titleHtml, content) => `
        <div class="rec-card-body">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            ${_iconCircle(type)}
            <div style="flex:1;min-width:0;">
              ${titleHtml}
              ${metaLine}
            </div>
          </div>
          ${content ? `<div style="padding-left:40px;margin-top:6px;">${content}</div>` : ''}
        </div>`;

      // ── ÁUDIO ─────────────────────────────────────────────────────────
      if (r.audio_path) {
        const audioTitle = r.audio_title || (lang === 'ja' ? '音声' : 'Áudio');
        const player = r._audioUrl
          ? (window._zaudioRender
              ? window._zaudioRender({ src: r._audioUrl, title: audioTitle })
              : `<audio controls preload="none" src="${_esc(r._audioUrl)}" style="width:100%;margin-top:8px;"></audio>`)
          : `<div style="font-size:0.85rem;color:#c00;">${lang === 'ja' ? '音声を読み込めませんでした。' : 'Não foi possível carregar o áudio.'}</div>`;
        const noteAfterPlayer = r.note ? `<div style="margin-top:20px;">${noteHtml}</div>` : '';
        return `
        <article class="${cardCls}">
          ${body('audio', `<h2 class="rec-card-title">${_esc(audioTitle)}</h2>`, player + noteAfterPlayer)}
          <div class="rec-card-actions">${actionBtn}</div>
        </article>`;
      }

      // ── POESIA ────────────────────────────────────────────────────────
      if (r.vol === 'poetry') {
        const ptitle = r.poem_title || '(poema)';
        let phref = `${base}${r.file}.html?poem=${encodeURIComponent(r.poem_topic_id || '')}&hl_scroll=1`;
        if (lang === 'ja') phref += '&lang=ja';
        // Só a tradução em PT — limpo e legível
        let poemExcerpt = '';
        if (r.poem_text) {
          const isJP = s => /[぀-ヿ㐀-鿿]/.test(s);
          const pt = r.poem_text.split('\n').filter(s => s && !isJP(s));
          if (pt.length) poemExcerpt = `<div style="font-size:0.88rem;color:var(--text-muted);font-family:'Crimson Pro',Georgia,serif;font-style:italic;line-height:1.55;">${_esc(pt.join(' / '))}</div>`;
        }
        const titleHtml = `<h2 class="rec-card-title"><a href="${phref}" class="rec-card-link" data-rec-id="${_esc(r.id)}" data-vol="poetry" data-file="${_esc(r.file)}" data-topic="0" data-title-pt="${_esc(ptitle)}" data-title-ja="">${_esc(ptitle)}</a></h2>`;
        return `
        <article class="${cardCls}">
          ${body('poetry', titleHtml, poemExcerpt + noteHtml)}
          <div class="rec-card-actions">${actionBtn}</div>
        </article>`;
      }

      // ── ENSINAMENTO ───────────────────────────────────────────────────
      const title = (lang === 'ja' && r.title_ja) ? r.title_ja : (r.title_pt || '(sem título)');
      const idx = r.topic_idx != null ? r.topic_idx : 0;
      let href = `${base}reader.html?vol=${encodeURIComponent(r.vol)}&file=${encodeURIComponent(r.file)}`;
      if (idx > 0) href += `&topic=${idx}`;
      if (lang === 'ja') href += '&lang=ja';
      const titleHtml = `<h2 class="rec-card-title"><a href="${href}" class="rec-card-link" data-rec-id="${_esc(r.id)}" data-vol="${_esc(r.vol)}" data-file="${_esc(r.file)}" data-topic="${idx}" data-title-pt="${_esc(r.title_pt || '')}" data-title-ja="${_esc(r.title_ja || '')}">${_esc(title)}</a></h2>`;
      return `
        <article class="${cardCls}">
          ${body('teaching', titleHtml, noteHtml)}
          <div class="rec-card-actions">${actionBtn}</div>
        </article>`;
  }

  // Renderiza a lista de cards, agrupando por source_collection_id quando
  // disponível. Recomendações sem playlist origem caem em "Avulsas" (no
  // rodapé) — ou sem cabeçalho de grupo se TODAS forem soltas.
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
    // Particiona: grupos (com source_collection_id) preservando ordem de
    // chegada da playlist; soltas (sem source) vão pra um array separado.
    const groups = new Map();     // id → { name, items[] }
    const loose = [];
    list.forEach(r => {
      const cid = r.source_collection_id;
      if (cid) {
        if (!groups.has(cid)) {
          groups.set(cid, { name: r.source_collection_name || '(sem nome)', items: [] });
        }
        groups.get(cid).items.push(r);
      } else {
        loose.push(r);
      }
    });

    // Caso 1: nada agrupado → renderiza como antes, sem cabeçalhos.
    if (groups.size === 0) {
      return loose.map(r => _renderOneCard(r, archived, lang, base)).join('');
    }

    // Caso 2: tem grupos → renderiza cada um como <details open>, soltas
    // no rodapé sob "📥 Outras" se existirem.
    const groupHtml = Array.from(groups.entries()).map(([cid, g]) => {
      const looseLbl = lang === 'ja' ? '件' : (g.items.length === 1 ? 'ensinamento' : 'ensinamentos');
      const cards = g.items.map(r => _renderOneCard(r, archived, lang, base)).join('');
      return `
        <details class="rec-group" open data-coll="${_esc(cid)}">
          <summary class="rec-group-header">
            <span class="rec-group-icon">📂</span>
            <span class="rec-group-name">${_esc(g.name)}</span>
            <span class="rec-group-count">${g.items.length} ${looseLbl}</span>
            <span class="rec-group-chevron" aria-hidden="true">▾</span>
          </summary>
          <div class="rec-group-body">${cards}</div>
        </details>
      `;
    }).join('');

    let looseHtml = '';
    if (loose.length > 0) {
      const othersLbl = lang === 'ja' ? 'その他' : 'Outras';
      const cards = loose.map(r => _renderOneCard(r, archived, lang, base)).join('');
      looseHtml = `
        <details class="rec-group rec-group-loose" open>
          <summary class="rec-group-header">
            <span class="rec-group-icon">📥</span>
            <span class="rec-group-name">${_esc(othersLbl)}</span>
            <span class="rec-group-count">${loose.length}</span>
            <span class="rec-group-chevron" aria-hidden="true">▾</span>
          </summary>
          <div class="rec-group-body">${cards}</div>
        </details>
      `;
    }
    return groupHtml + looseHtml;
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
    if (window._zaudioMount) window._zaudioMount(container);
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

  // ============================================================
  // PREVIEW MODAL — mesmo padrão do preview da playlist (admin).
  // Click num card abre o tópico aqui em vez de navegar pro reader.
  // Evita o bug de popstate vs ?topic= no reader (Chrome dispara
  // popstate em hash-anchor clicks, fazendo o reader re-renderizar
  // e cancelar a navegação manual do usuário).
  // ============================================================
  let _previewModal = null;
  let _previewIdx = 0;
  let _previewItems = [];   // array de {vol, file, topic_idx, title_pt, title_ja, href}

  function _supaClient() {
    return (window.supabaseAuth && window.supabaseAuth.supabase)
        || window._supabaseClient
        || window.supabase
        || null;
  }

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

  function _buildPreviewModal() {
    if (_previewModal) return;
    _previewModal = document.createElement('div');
    _previewModal.className = 'search-preview-overlay';
    _previewModal.id = 'recPreviewOverlay';
    _previewModal.innerHTML = `
      <style id="recPreviewStyles">
        #recPreviewContent {
          font-family: 'Crimson Pro', Georgia, 'Times New Roman', serif;
          font-size: 1.04rem;
          line-height: 1.75;
          color: var(--text-main);
        }
        #recPreviewContent > p { margin: 0 0 14px; }
        #recPreviewContent > p:last-child { margin-bottom: 0; }
        #recPreviewContent b { font-weight: 600; }
        #recPreviewContent i { font-style: italic; }
        #recPreviewContent font { color: inherit !important; }
        #recPreviewContent font[size="+2"] {
          display: block;
          font-size: 1.2rem;
          line-height: 1.3;
          margin: 0 0 8px;
          font-weight: 700;
        }
        #recPreviewContent font[size="+1"] {
          font-weight: 600;
          font-style: italic;
          color: var(--accent) !important;
        }
        /* <p> só com label (Pergunta/Resposta) vira mini-heading */
        #recPreviewContent p:has(> b > font[size="+1"]):not(:has(> :not(b))) {
          margin: 22px 0 6px;
          font-size: 0.95rem;
        }
        /* Esconde o título-legacy duplicado no início (modal header
           já mostra o título). Mantém o "(Publicado em...)" inline
           que vem depois. */
        #recPreviewContent > p:first-child > b:first-child:has(> font[size="+2"]) {
          display: none;
        }
        #recPreviewContent hr {
          border: none;
          border-top: 1px solid var(--border);
          margin: 22px 0;
        }
        #recPreviewOverlay .search-preview-title {
          font-family: 'Crimson Pro', Georgia, serif;
        }
      </style>
      <div class="search-preview-panel">
        <div class="search-preview-header">
          <button class="search-preview-back" id="recPreviewPrev" title="Anterior" aria-label="Recomendação anterior">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            <span>Anterior</span>
          </button>
          <span class="search-preview-badge">Recomendado para você</span>
          <div style="justify-self:end; display:flex; align-items:center; gap:8px;">
            <button id="recPreviewNext" type="button" title="Próximo" aria-label="Próxima recomendação" style="background:none; border:1px solid var(--border); border-radius:6px; cursor:pointer; padding:4px 10px; color:inherit; font-size:0.82rem; display:inline-flex; align-items:center; gap:4px;">
              <span>Próximo</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <button class="modal-close-btn search-preview-close" id="recPreviewClose" aria-label="Fechar" style="position:static;">&times;</button>
          </div>
        </div>
        <div class="search-preview-context">
          <div class="search-preview-breadcrumb" id="recPreviewRef"></div>
          <div class="search-preview-title" id="recPreviewTitle"></div>
        </div>
        <div class="search-preview-body">
          <div class="search-preview-card" id="recPreviewCard">
            <div class="search-preview-card-content" id="recPreviewContent"></div>
            <div class="search-preview-card-fade" aria-hidden="true"></div>
          </div>
        </div>
        <div class="search-preview-footer">
          <button class="search-preview-cta" id="recPreviewOpen" title="Abrir página completa">
            <span>Abrir página completa do ensinamento</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(_previewModal);
    document.getElementById('recPreviewClose').onclick = _closePreview;
    document.getElementById('recPreviewPrev').onclick = () => _previewNav(-1);
    document.getElementById('recPreviewNext').onclick = () => _previewNav(+1);
    document.getElementById('recPreviewOpen').onclick = _previewOpenFull;
    _previewModal.addEventListener('click', e => { if (e.target === _previewModal) _closePreview(); });
    document.addEventListener('keydown', e => {
      if (!_previewModal || !_previewModal.classList.contains('active')) return;
      if (e.key === 'Escape') _closePreview();
      else if (e.key === 'ArrowLeft') _previewNav(-1);
      else if (e.key === 'ArrowRight') _previewNav(+1);
    });
  }

  function _closePreview() {
    if (_previewModal) _previewModal.classList.remove('active');
  }

  function _previewNav(delta) {
    const next = _previewIdx + delta;
    if (next < 0 || next >= _previewItems.length) return;
    _previewIdx = next;
    _renderPreviewItem();
  }

  function _previewOpenFull() {
    const it = _previewItems[_previewIdx];
    if (!it || !it.href) return;
    window.location.href = it.href;
  }

  async function _openPreview(items, startIdx) {
    _previewItems = items;
    _previewIdx = startIdx || 0;
    _buildPreviewModal();
    _previewModal.classList.add('active');
    await _renderPreviewItem();
  }

  async function _renderPreviewItem() {
    const it = _previewItems[_previewIdx];
    if (!it) return;
    const lang = localStorage.getItem('site_lang') || 'pt';
    const refEl = document.getElementById('recPreviewRef');
    const titleEl = document.getElementById('recPreviewTitle');
    const contentEl = document.getElementById('recPreviewContent');
    const cardEl = document.getElementById('recPreviewCard');
    const prevBtn = document.getElementById('recPreviewPrev');
    const nextBtn = document.getElementById('recPreviewNext');

    const title = (lang === 'ja' && it.title_ja) ? it.title_ja : (it.title_pt || '(sem título)');
    refEl.textContent = `${it.vol} · ${it.file}${typeof it.topic_idx === 'number' ? '#' + it.topic_idx : ''}   ·   ${_previewIdx + 1}/${_previewItems.length}`;
    titleEl.textContent = title;
    contentEl.innerHTML = '<p style="padding:2rem;text-align:center;color:var(--text-muted);">Carregando…</p>';
    prevBtn.disabled = _previewIdx === 0;
    nextBtn.disabled = _previewIdx === _previewItems.length - 1;

    const supa = _supaClient();
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
      const rawContent = lang === 'ja'
        ? (topic.content_ja || topic.content || '')
        : (topic.content_ptbr || topic.content_pt || topic.content || '');
      // Preserva <b>, <i>, <font> (cores e tamanhos). Transforma só
      // <br><br> em quebra de parágrafo; <br> solto vira espaço.
      const formatted = String(rawContent)
        .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '</p><p>')
        .replace(/<br\s*\/?>/gi, ' ');
      contentEl.innerHTML = `<p>${formatted}</p>`;
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
    // Click delegado: action buttons OU card link (abre preview modal)
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest?.('.rec-action-btn');
      if (btn) {
        e.preventDefault();
        const action = btn.dataset.action;
        const id = btn.dataset.recId;
        if (!action || !id) return;
        btn.disabled = true;
        if (action === 'archive') await _archive(id);
        else if (action === 'unarchive') await _unarchive(id);
        return;
      }
      const link = e.target.closest?.('.rec-card-link');
      if (link) {
        e.preventDefault();
        // Constrói lista de itens da aba atual pra navegação prev/next.
        // Exclui áudios — o preview baixa o JSON do ensinamento e áudios
        // não têm vol/file (prev/next pularia pra um item inválido).
        const list = (_currentTab === 'archived' ? _archived : _active).filter(r => !r.audio_path);
        const items = list.map(r => {
          const idx = r.topic_idx != null ? r.topic_idx : 0;
          const lang = localStorage.getItem('site_lang') || 'pt';
          let href = `${_basePathForReader()}reader.html?vol=${encodeURIComponent(r.vol)}&file=${encodeURIComponent(r.file)}`;
          if (idx > 0) href += `&topic=${idx}`;
          if (lang === 'ja') href += '&lang=ja';
          return { vol: r.vol, file: r.file, topic_idx: idx, title_pt: r.title_pt, title_ja: r.title_ja, href };
        });
        const startIdx = items.findIndex(it => it.vol === link.dataset.vol && it.file === link.dataset.file && it.topic_idx === parseInt(link.dataset.topic, 10));
        await _openPreview(items, startIdx >= 0 ? startIdx : 0);
      }
    });
    await _refresh();
  }

  window.initRecomendacoesPage = init;
})();
