// ============================================================
// Destaques Page — Mioshie College
// Central de Destaques: agrupada por Volume → publicação, com
// busca, filtro por cor e filtro de grifos de título (12/06 —
// muitos usuários grifavam o TÍTULO como marca de "já li", o que
// afogava os destaques de conteúdo).
// ============================================================

// Normaliza numeração de parte herdada do JP (espaço fullwidth 　 + dígitos
// ０-９) → normal na exibição. window.* idempotente pra não colidir com o
// mesmo helper de reader-render/search (todos escopo global) no mesmo HTML.
window.normNums = window.normNums || function (s) {
    return String(s == null ? '' : s)
        .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/　+(?=\d)/g, ' ');
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(async () => {
        _initToolbar();
        // 1ª pintura sai do cache local (instantânea); em paralelo puxa a
        // NUVEM (fonte da verdade — grifos feitos em outro aparelho aparecem
        // sem precisar relogar) e re-renderiza se algo mudou.
        renderNotebook();
        if (window._HighlightsApi && window._HighlightsApi.hydrateAllFromCloud) {
            try {
                await window._HighlightsApi.hydrateAllFromCloud();
                renderNotebook();
            } catch (e) { /* offline → fica o cache */ }
        }
    }, 100);
});

function _esc(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function _truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '…' : str;
}

const _DQ_COLOR_HEX = {
    yellow: '#fff3a1', green: '#a8e6cf', blue: '#a0c4ff',
    pink: '#ffb3c6', purple: '#d4a5f5', orange: '#ffd6a5'
};

// ─── Estado dos filtros (hideTitles persiste entre visitas) ──
// Paginação por grupo (publicação): usuários "sem limite" (1.500+ grifos)
// não podem custar milhares de cards de DOM numa página só.
const DQ_GROUP_PAGE = 6;   // cards iniciais por publicação
const DQ_GROUP_STEP = 12;  // incremento do "Mostrar mais"

const _dqState = {
    q: '',
    color: null,
    hideTitles: localStorage.getItem('dqHideTitles') === '1',
    // Filtro por livro de discípulos (?book=<id>) — atalho vindo do header
    // do leitor. Mostra só os grifos daquele livro + chip pra limpar.
    bookOnly: (new URLSearchParams(location.search).get('book')) || null,
    // Quantos cards cada grupo está mostrando (chave `${vol}/${file}`).
    shown: new Map()
};

window._dqShowMore = function (encKey) {
    const key = decodeURIComponent(encKey);
    const cur = _dqState.shown.get(key) || DQ_GROUP_PAGE;
    _dqState.shown.set(key, cur + DQ_GROUP_STEP);
    renderNotebook();
};

function _dqLang() { return localStorage.getItem('site_lang') || 'pt'; }

function _volLabel(vol, lang) {
    if (vol === 'disciples') return lang === 'ja' ? '弟子たちの著作' : 'Livros de Discípulos';
    const m = String(vol || '').match(/^mioshiec(\d+)$/);
    if (m) {
        const subs = (window.VOL_SUBTITLES && window.VOL_SUBTITLES[lang === 'ja' ? 'ja' : 'pt']) || {};
        const base = lang === 'ja' ? `第${m[1]}巻` : `Volume ${m[1]}`;
        return subs[m[1]] ? `${base} — ${subs[m[1]]}` : base;
    }
    return String(vol || '').toUpperCase();
}

function _pubEntry(h) {
    return (window.GLOBAL_INDEX_TITLES || {})[`${h.vol}/${h.file}`] || null;
}

function _pubTitle(h, lang) {
    if (h.vol === 'disciples') {
        const b = _dqDiscIndex && _dqDiscIndex[h.file];
        if (b) return (lang === 'ja' ? (b.titleJa || b.title) : b.title) || h.file;
        return h.file || (lang === 'ja' ? 'その他' : 'Outros');
    }
    const g = _pubEntry(h);
    if (g) return lang === 'ja' ? (g.ja || g.pt) : (g.pt || g.ja);
    return h.topicTitle || h.file || (lang === 'ja' ? 'その他' : 'Outros');
}

// Títulos dos livros de discípulos (id → entry do disciples_index.json).
// Carregado sob demanda quando existe grifo com vol='disciples'; quando
// chega, re-renderiza pra trocar o id pelo título.
let _dqDiscIndex = null;
function _dqLoadDiscIndex() {
    if (_dqDiscIndex !== null) return;
    _dqDiscIndex = {};   // marca "carregando" — evita refetch a cada render
    fetch('data/books/disciples_index.json')
        .then(r => (r.ok ? r.json() : null))
        .then(j => { ((j && j.books) || []).forEach(b => { _dqDiscIndex[b.id] = b; }); renderNotebook(); })
        .catch(() => {});
}

// URL pra abrir o grifo no leitor — acervo (vol/file/topic/hl_scroll) ou
// livro de discípulos (pub=disciples&book&sec&highlight: o leitor abre o
// capítulo que contém a seção e rola até o mark).
function _dqArticleUrl(h) {
    if (!h.vol || !h.file) return '#';
    if (h.vol === 'disciples') {
        let u = `reader.html?pub=disciples&book=${encodeURIComponent(h.file)}`;
        if (h.topicId) u += `&sec=${encodeURIComponent(h.topicId)}`;
        if (h.id) u += `&highlight=${encodeURIComponent(h.id)}`;
        return u;
    }
    let u = `reader.html?vol=${encodeURIComponent(h.vol)}&file=${encodeURIComponent(h.file)}`;
    if (h.topicIndex !== undefined && h.topicIndex !== '') u += `&topic=${h.topicIndex}`;
    if (h.id) u += `&highlight=${encodeURIComponent(h.id)}&hl_scroll=1`;
    return u;
}

// Grifo de TÍTULO (a marca de "já li" que alguns usuários usavam): começa
// na zona do cabeçalho do tópico (os primeiros caracteres — o corpo nunca
// começa antes de ~80 chars por causa de título+data+rótulos) ou o texto é
// o próprio título. Heurística de exibição, nada é apagado.
function _isTitleHighlight(h) {
    const sc = (typeof h.startChar === 'number') ? h.startChar : null;
    if (sc !== null && sc <= 2) return true;
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const t = norm(h.text);
    const tt = norm(h.topicTitle);
    if (!t || !tt) return false;
    if (t === tt) return true;
    if (sc !== null && sc <= 60 && (tt.includes(t) || t.includes(tt))) return true;
    return false;
}

function _dqGetAll() {
    let dataList = [];
    if (typeof window._HighlightsApi !== 'undefined') {
        dataList = window._HighlightsApi.getAll();
    } else {
        const hStorage = localStorage.getItem('userHighlights');
        dataList = hStorage ? JSON.parse(hStorage) : [];
    }
    // Poemas salvos têm UI dedicada em poemas-salvos.html — não aparecem
    // misturados aqui pra não inflar a lista de quem já tem muitos destaques
    // de ensinamento.
    return (dataList || []).filter(h => h.vol !== 'poetry');
}

// Aplica os MESMOS filtros ativos da tela (busca, cor, ?book=, ocultar
// títulos) — compartilhado com os exports. Antes exportHighlightsTXT/DOC
// chamavam _dqGetAll() cru: o usuário filtrava "só os verdes de tal
// publicação", clicava "Exportar Word" e recebia todos os grifos.
function _dqFilteredList() {
    const lang = _dqLang();
    const q = _dqState.q.toLowerCase().trim();
    return _dqGetAll().filter(h => {
        if (_dqState.bookOnly && !(h.vol === 'disciples' && h.file === _dqState.bookOnly)) return false;
        if (_dqState.hideTitles && _isTitleHighlight(h)) return false;
        if (_dqState.color && (h.color || 'yellow') !== _dqState.color) return false;
        if (q) {
            const hay = `${h.text || ''} ${h.comment || ''} ${h.topicTitle || ''} ${_pubTitle(h, lang)}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

// ─── Rótulos pessoais das cores ──────────────────────────────
// As 6 cores existem e filtram, mas não carregam significado. Aqui o usuário
// pode batizá-las ("amarelo = Fé", "verde = Gratidão"). Per-device (localStorage
// hlColorLabels: cor→rótulo); se pegar, promover a coluna no futuro.
function _dqColorLabels() {
    try { return JSON.parse(localStorage.getItem('hlColorLabels') || '{}') || {}; }
    catch (_) { return {}; }
}
function _dqColorLabel(c) {
    const custom = _dqColorLabels()[c];
    if (custom) return custom;
    const lang = _dqLang();
    const names = lang === 'ja'
        ? { yellow: '黄', green: '緑', blue: '青', pink: 'ピンク', purple: '紫', orange: 'オレンジ' }
        : { yellow: 'Amarelo', green: 'Verde', blue: 'Azul', pink: 'Rosa', purple: 'Roxo', orange: 'Laranja' };
    return names[c] || c;
}
window._dqEditColorLabels = function () {
    const labels = _dqColorLabels();
    const lang = _dqLang();
    let changed = false;
    for (const c of Object.keys(_DQ_COLOR_HEX)) {
        const msg = (lang === 'ja' ? 'この色の名前：' : 'Nome para a cor ') + _dqColorLabel(c);
        const val = window.prompt(msg, labels[c] || '');
        if (val === null) continue;   // cancelou esta cor
        const trimmed = val.trim();
        if (trimmed) labels[c] = trimmed; else delete labels[c];
        changed = true;
    }
    if (changed) {
        try { localStorage.setItem('hlColorLabels', JSON.stringify(labels)); } catch (_) {}
        _initToolbar();       // reconstrói a toolbar (títulos dos chips)
        renderNotebook();
    }
};

// ─── Toolbar (busca + cores + toggle de títulos) ─────────────
// Construída UMA vez (re-render a cada tecla roubaria o foco do input);
// renderNotebook só atualiza o contador.
function _initToolbar() {
    const host = document.getElementById('notebook-toolbar');
    if (!host) return;
    const lang = _dqLang();
    const t = lang === 'ja'
        ? { search: 'ハイライトを検索…', hide: 'タイトルのハイライトを隠す', all: '全色' }
        : { search: 'Buscar nos destaques…', hide: 'Ocultar grifos de título', all: 'Todas' };

    const chips = Object.keys(_DQ_COLOR_HEX).map(c =>
        `<button type="button" class="dq-chip" data-color="${c}" title="${_esc(_dqColorLabel(c))}" aria-label="${_esc(_dqColorLabel(c))}" aria-pressed="false" style="--chip:${_DQ_COLOR_HEX[c]}"></button>`
    ).join('');
    const editColorsLabel = lang === 'ja' ? '色に名前を付ける' : 'Nomear cores';

    host.innerHTML = `
        <div class="dq-toolbar">
            <div class="dq-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="search" id="dqSearch" placeholder="${t.search}" aria-label="${t.search}">
            </div>
            <div class="dq-colors" role="group" aria-label="Filtrar por cor">
                <button type="button" class="dq-chip dq-chip--all is-active" data-color="" aria-pressed="true">${t.all}</button>
                ${chips}
                <button type="button" class="dq-chip-edit" onclick="_dqEditColorLabels()" title="${editColorsLabel}" aria-label="${editColorsLabel}" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.95rem;padding:4px 6px;">✎</button>
            </div>
            <label class="dq-toggle">
                <input type="checkbox" id="dqHideTitles" ${_dqState.hideTitles ? 'checked' : ''}>
                <span>${t.hide}</span>
            </label>
            <span class="dq-count" id="dqCount"></span>
        </div>`;

    const search = document.getElementById('dqSearch');
    let debounce = null;
    search.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            _dqState.q = search.value || '';
            renderNotebook();
        }, 150);
    });

    host.querySelectorAll('.dq-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const c = btn.dataset.color || null;
            _dqState.color = (c === _dqState.color) ? null : c;
            host.querySelectorAll('.dq-chip').forEach(b => {
                const active = (b.dataset.color || null) === _dqState.color;
                b.classList.toggle('is-active', active);
                b.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
            renderNotebook();
        });
    });

    document.getElementById('dqHideTitles').addEventListener('change', (e) => {
        _dqState.hideTitles = !!e.target.checked;
        try { localStorage.setItem('dqHideTitles', _dqState.hideTitles ? '1' : '0'); } catch (_) {}
        renderNotebook();
    });
}

function renderNotebook() {
    const container = document.getElementById('notebook-container');
    const lang = _dqLang();
    const noHighlights = lang === 'ja' ? 'ハイライトやメモはまだありません。' : 'Nenhum destaque ou anotação salvos ainda.';
    const noResults = lang === 'ja' ? '条件に合うハイライトはありません。' : 'Nenhum destaque corresponde aos filtros.';

    const all = _dqGetAll();
    if (all.some(h => h.vol === 'disciples')) _dqLoadDiscIndex();
    if (!all.length) {
        const countEl0 = document.getElementById('dqCount');
        if (countEl0) countEl0.textContent = '';
        container.innerHTML = `<div class="notebook-empty">${noHighlights}</div>`;
        return;
    }

    const q = _dqState.q.toLowerCase().trim();
    const titleHidden = [];
    const list = all.filter(h => {
        if (_dqState.bookOnly && !(h.vol === 'disciples' && h.file === _dqState.bookOnly)) return false;
        if (_dqState.hideTitles && _isTitleHighlight(h)) { titleHidden.push(h); return false; }
        if (_dqState.color && (h.color || 'yellow') !== _dqState.color) return false;
        if (q) {
            const hay = `${h.text || ''} ${h.comment || ''} ${h.topicTitle || ''} ${_pubTitle(h, lang)}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const countEl = document.getElementById('dqCount');
    if (countEl) {
        const base = lang === 'ja' ? `${list.length} / ${all.length} 件` : `${list.length} de ${all.length} destaques`;
        const hid = titleHidden.length
            ? (lang === 'ja' ? `（タイトル ${titleHidden.length} 件非表示）` : ` · ${titleHidden.length} de título ocultos`)
            : '';
        countEl.textContent = base + hid;
    }

    if (!list.length) {
        // Mantém o chip de filtro por livro pra não prender o usuário sem
        // botão de "ver todos" quando o filtro não casa nada.
        let chip = '';
        if (_dqState.bookOnly) {
            const bookTitle = _pubTitle({ vol: 'disciples', file: _dqState.bookOnly }, lang);
            const lbl = lang === 'ja' ? 'フィルター' : 'Filtrando';
            const clr = lang === 'ja' ? 'すべて表示' : 'ver todos';
            chip = `<button type="button" class="dq-bookfilter" onclick="_dqClearBookFilter()"><span>${lbl}: <b>${_esc(bookTitle)}</b></span><span class="dq-bookfilter-x">${_esc(clr)} ✕</span></button>`;
        }
        container.innerHTML = chip + `<div class="notebook-empty">${noResults}</div>`;
        return;
    }

    // ─── Agrupa Volume → publicação ──────────────────────────
    const byVol = new Map();
    list.forEach(h => {
        const vol = h.vol || '?';
        if (!byVol.has(vol)) byVol.set(vol, new Map());
        const files = byVol.get(vol);
        if (!files.has(h.file)) files.set(h.file, []);
        files.get(h.file).push(h);
    });

    // mioshiec1..4 primeiro (ordem numérica), demais volumes depois.
    const volKeys = [...byVol.keys()].sort((a, b) => {
        const ma = /^mioshiec(\d+)$/.exec(a), mb = /^mioshiec(\d+)$/.exec(b);
        if (ma && mb) return (+ma[1]) - (+mb[1]);
        if (ma) return -1;
        if (mb) return 1;
        return a < b ? -1 : 1;
    });

    // Chip de filtro ativo por livro (?book=) — clicável pra limpar.
    let html = '';
    if (_dqState.bookOnly) {
        const bookTitle = _pubTitle({ vol: 'disciples', file: _dqState.bookOnly }, lang);
        const lbl = lang === 'ja' ? 'フィルター' : 'Filtrando';
        const clr = lang === 'ja' ? 'すべて表示' : 'ver todos';
        html += `<button type="button" class="dq-bookfilter" onclick="_dqClearBookFilter()">
            <span>${lbl}: <b>${_esc(bookTitle)}</b></span>
            <span class="dq-bookfilter-x">${_esc(clr)} ✕</span>
        </button>`;
    }
    for (const vol of volKeys) {
        const files = byVol.get(vol);
        let volCount = 0;
        files.forEach(items => { volCount += items.length; });

        // Publicações na ordem do índice da obra (seção + nº); sem entrada
        // no índice vão pro fim, em ordem alfabética de título.
        const fileKeys = [...files.keys()].sort((fa, fb) => {
            const ga = (window.GLOBAL_INDEX_TITLES || {})[`${vol}/${fa}`];
            const gb = (window.GLOBAL_INDEX_TITLES || {})[`${vol}/${fb}`];
            if (ga && gb) {
                if (ga.section !== gb.section) return ga.section < gb.section ? -1 : 1;
                return (parseInt(ga.n, 10) || 0) - (parseInt(gb.n, 10) || 0);
            }
            if (ga) return -1;
            if (gb) return 1;
            return fa < fb ? -1 : 1;
        });

        html += `
        <div class="notebook-volume">
            <div class="notebook-volume-header">
                <span>${_esc(_volLabel(vol, lang))}</span>
                <span class="notebook-volume-count">${volCount}</span>
            </div>`;

        for (const file of fileKeys) {
            const items = files.get(file);
            // Ordem de leitura dentro da publicação (tópico, depois posição).
            items.sort((a, b) => ((a.topicIndex ?? 0) - (b.topicIndex ?? 0))
                || String(a.topicId || '').localeCompare(String(b.topicId || ''))   // discípulos: topicIndex=-1 — agrupa por seção
                || ((a.startChar ?? 0) - (b.startChar ?? 0)));
            const pubUrl = vol === 'disciples'
                ? `reader.html?pub=disciples&book=${encodeURIComponent(file)}`
                : `reader.html?vol=${encodeURIComponent(vol)}&file=${encodeURIComponent(file)}`;
            const pubTitle = _pubTitle(items[0], lang);

            // Paginação por grupo: 6 iniciais + "Mostrar mais". Grupos até
            // 8 mostram tudo (botão pra 1-2 cards seria pior que os cards).
            const gKey = `${vol}/${file}`;
            const shownN = _dqState.shown.get(gKey) || DQ_GROUP_PAGE;
            const visible = (items.length <= DQ_GROUP_PAGE + 2) ? items : items.slice(0, shownN);
            const remaining = items.length - visible.length;
            const nextN = Math.min(remaining, DQ_GROUP_STEP);
            const moreBtn = remaining > 0
                ? `<button type="button" class="notebook-more-btn" onclick="_dqShowMore('${encodeURIComponent(gKey)}')">${
                    lang === 'ja' ? `さらに${nextN}件を表示（残り${remaining}件）` : `Mostrar mais ${nextN} (${remaining} restantes)`
                  }</button>`
                : '';

            html += `
            <div class="notebook-group">
                <div class="notebook-group-header">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                    <a class="notebook-group-link" href="${pubUrl}">${_esc(pubTitle)}</a>
                    <span class="notebook-group-count">${items.length}</span>
                </div>
                <div class="notebook-grid">
                    ${visible.map(h => _renderCard(h, lang)).join('')}
                </div>
                ${moreBtn}
            </div>`;
        }

        html += `</div>`;
    }

    container.innerHTML = html;
}

function _renderCard(h, lang) {
    const date = new Date(h.createdAt).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR');
    const bgColor = _DQ_COLOR_HEX[h.color] || '#fff3a1';

    const articleUrl = _dqArticleUrl(h);

    const isTitle = _isTitleHighlight(h);
    const titleBadge = isTitle
        ? `<span class="notebook-tag-title">${lang === 'ja' ? 'タイトル' : 'título'}</span>`
        : '';
    // Grifo órfão: a cura de offsets (highlights.js) não achou mais o
    // snapshot no conteúdo atual — o texto salvo continua aqui, mas o
    // leitor não pinta mais. Avisa em vez de sumir em silêncio.
    const orphanBadge = h.orphaned
        ? `<span class="notebook-tag-title notebook-tag-orphan" title="${lang === 'ja' ? '本文が変更され、位置を特定できません' : 'O texto deste trecho mudou no Ensinamento — o grifo não aparece mais no leitor'}">${lang === 'ja' ? '本文が変わりました' : 'texto mudou'}</span>`
        : '';
    const shortTitle = _esc(_truncate(window.normNums(h.topicTitle || (lang === 'ja' ? 'その他' : 'Outros')), 40));
    const shortText = _esc(_truncate(h.text, 120));
    const commentPreview = h.comment ? `<div class="notebook-comment-preview">📝 ${_esc(_truncate(h.comment, 60))}</div>` : '';
    // Admin: recomendar o trecho deste destaque aos usuários (abre o picker
    // do reader-recommend.js com o intervalo do grifo embutido).
    const recBtn = (h.vol !== 'disciples'   // recomendações cobrem só o acervo (RPC exige vol/file do índice)
        && typeof isAdminUser === 'function' && isAdminUser() && typeof window.openRecommendPicker === 'function')
        ? `<button class="notebook-btn" onclick="event.stopPropagation(); recommendExcerpt('${h.id}')">${lang === 'ja' ? '推薦' : 'Recomendar'}</button>`
        : '';
    // Admin: transformar o grifo em item de playlist (mesmo gate do Recomendar —
    // playlists são admin-only e resolvem títulos via índice do acervo).
    const plBtn = (h.vol !== 'disciples'
        && typeof isAdminUser === 'function' && isAdminUser() && typeof window.openPlaylistAddPicker === 'function')
        ? `<button class="notebook-btn" onclick="event.stopPropagation(); addHighlightToPlaylist('${h.id}')">${lang === 'ja' ? 'プレイリスト' : 'Coletânea'}</button>`
        : '';

    return `
    <div class="notebook-card" data-id="${h.id}" onclick="openHighlightDetail('${h.id}')">
        <div class="notebook-card-accent" style="background: ${bgColor};"></div>
        <div class="notebook-card-title">${titleBadge}${orphanBadge}${shortTitle}</div>
        <div class="notebook-text">${shortText}</div>
        ${commentPreview}
        <div class="notebook-meta">
            <span>${date}</span>
            <div class="notebook-actions">
                <a href="${articleUrl}" class="notebook-btn link" style="text-decoration:none;" onclick="event.stopPropagation();">${lang === 'ja' ? '読む' : 'Abrir'}</a>
                ${recBtn}
                ${plBtn}
                <button class="notebook-btn delete" onclick="event.stopPropagation(); deleteNotebookHighlight('${h.id}')">${lang === 'ja' ? '削除' : 'Apagar'}</button>
            </div>
        </div>
    </div>`;
}

// Limpa o filtro por livro (chip) — some o ?book= da URL e re-renderiza.
window._dqClearBookFilter = function () {
    _dqState.bookOnly = null;
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    renderNotebook();
};

// Admin: abre o picker de recomendação com o TRECHO do destaque embutido
// (excerpt_* — quem receber abre o ensinamento direto no trecho grifado).
window.recommendExcerpt = function (id) {
    if (typeof window.openRecommendPicker !== 'function') return;
    const h = _dqGetAll().find(x => x.id === id);
    if (!h) return;
    const lang = _dqLang();
    window.openRecommendPicker({
        vol: h.vol,
        file: h.file,
        topic_idx: Number.isInteger(h.topicIndex) ? h.topicIndex : 0,
        title: h.topicTitle || _pubTitle(h, lang),
        excerptRanges: (typeof h.startChar === 'number' && typeof h.endChar === 'number')
            ? [[h.startChar, h.endChar]]
            : null,
        excerptText: h.text || ''
    });
};

// Admin: adicionar o ensinamento deste grifo a uma playlist (a lacuna que o
// dono já conhecia — grifar e depois transformar em playlist). Reusa o picker
// do reader passando meta pronta (a Central não tem vol/file na URL).
window.addHighlightToPlaylist = function (id) {
    if (typeof window.openPlaylistAddPicker !== 'function') return;
    const h = _dqGetAll().find(x => x.id === id);
    if (!h) return;
    const lang = _dqLang();
    window.openPlaylistAddPicker({
        vol: h.vol,
        file: h.file,
        topic_idx: Number.isInteger(h.topicIndex) ? h.topicIndex : 0,
        title: h.topicTitle || _pubTitle(h, lang)
    });
};

// id do destaque atualmente aberto no modal de detalhe. Os listeners dos
// botões são criados UMA vez (na criação do overlay) — antes eles prendiam
// no closure o id da PRIMEIRA abertura e Editar/Apagar agiam sempre no
// primeiro destaque visto. Agora leem daqui.
let _detailCurrentId = null;

function openHighlightDetail(id) {
    let dataList = typeof window._HighlightsApi !== 'undefined' ? window._HighlightsApi.getAll() : [];
    const h = dataList.find(x => x.id === id);
    if (!h) return;
    _detailCurrentId = id;

    const lang = _dqLang();
    const date = new Date(h.createdAt).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR');
    const bgColor = _DQ_COLOR_HEX[h.color] || '#fff3a1';

    let overlay = document.getElementById('highlightDetailOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'highlightDetailOverlay';
        overlay.className = 'highlight-detail-overlay';
        overlay.innerHTML = `
            <div class="highlight-detail-modal">
                <button class="highlight-detail-close" onclick="closeHighlightDetail()">&times;</button>
                <div class="highlight-detail-accent" id="detailAccent"></div>
                <div class="highlight-detail-source" id="detailSource"></div>
                <div class="highlight-detail-text" id="detailText"></div>
                <div class="highlight-detail-comment" id="detailComment" style="display:none"></div>
                <div class="highlight-detail-date" id="detailDate"></div>
                <div class="highlight-detail-actions">
                    <a href="#" class="notebook-btn" id="detailOpenBtn" target="_blank">${lang === 'ja' ? '記事を開く' : 'Abrir Artigo'}</a>
                    <button class="notebook-btn" id="detailPlaylistBtn" style="display:none">${lang === 'ja' ? 'プレイリスト' : 'Coletânea'}</button>
                    <button class="notebook-btn" id="detailEditBtn">${lang === 'ja' ? '編集' : 'Editar'}</button>
                    <button class="notebook-btn delete" id="detailDeleteBtn">${lang === 'ja' ? '削除' : 'Apagar'}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeHighlightDetail();
        });
        document.getElementById('detailPlaylistBtn').addEventListener('click', () => {
            closeHighlightDetail();
            if (_detailCurrentId) window.addHighlightToPlaylist(_detailCurrentId);
        });
        document.getElementById('detailEditBtn').addEventListener('click', () => {
            closeHighlightDetail();
            if (typeof window._HighlightsApi !== 'undefined' && _detailCurrentId) window._HighlightsApi.edit(_detailCurrentId);
        });
        document.getElementById('detailDeleteBtn').addEventListener('click', () => {
            const lg = _dqLang();
            const msg = lg === 'ja' ? 'このハイライトを削除してもよろしいですか？' : 'Tem certeza que deseja apagar este destaque?';
            if (confirm(msg)) {
                if (typeof window._HighlightsApi !== 'undefined' && _detailCurrentId) {
                    window._HighlightsApi.delete(_detailCurrentId);
                    closeHighlightDetail();
                    renderNotebook();
                }
            }
        });
    }

    document.getElementById('detailOpenBtn').href = _dqArticleUrl(h);
    // Playlist só pra admin + acervo (mesmo gate do card).
    const _detailPlBtn = document.getElementById('detailPlaylistBtn');
    if (_detailPlBtn) {
        const canPl = h.vol !== 'disciples' && typeof isAdminUser === 'function' && isAdminUser() && typeof window.openPlaylistAddPicker === 'function';
        _detailPlBtn.style.display = canPl ? '' : 'none';
    }
    document.getElementById('detailAccent').style.background = bgColor;
    document.getElementById('detailSource').textContent = h.topicTitle || '';
    document.getElementById('detailText').textContent = h.text;
    const commentEl = document.getElementById('detailComment');
    if (h.comment) {
        commentEl.style.display = 'block';
        commentEl.innerHTML = `<strong>Nota:</strong> ${_esc(h.comment)}`;
    } else {
        commentEl.style.display = 'none';
    }
    document.getElementById('detailDate').textContent = `Criado em ${date}`;

    overlay.classList.add('active');
}

function closeHighlightDetail() {
    const overlay = document.getElementById('highlightDetailOverlay');
    if (overlay) overlay.classList.remove('active');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHighlightDetail();
});

window.deleteNotebookHighlight = function(id) {
    const lang = _dqLang();
    const msg = lang === 'ja' ? 'このハイライトを削除してもよろしいですか？' : 'Tem certeza que deseja apagar este destaque?';
    if(confirm(msg)) {
        if(typeof window._HighlightsApi !== 'undefined') {
            window._HighlightsApi.delete(id);
            renderNotebook();
        }
    }
}

window.openNotebookEdit = function(id) {
    if(typeof window._HighlightsApi !== 'undefined') {
        window._HighlightsApi.edit(id);

        // Watch for changes (hacky but works since edit dialog is async DOM manipulation)
        const observer = new MutationObserver(() => {
            if(!document.getElementById('highlightEditOverlay')) {
                observer.disconnect();
                renderNotebook(); // refresh notebook when modal closes
            }
        });
        setTimeout(() => {
           const overlay = document.getElementById('highlightEditOverlay');
           if(overlay) observer.observe(document.body, { childList: true, subtree: true });
        }, 100);
    }
}

window.exportHighlightsTXT = function() {
    const lang = _dqLang();
    let dataList = _dqFilteredList();
    if (dataList.length === 0) return;

    // Grouping — cabeçalho pela PUBLICAÇÃO (antes usava o topicTitle do 1º
    // item, que rotulava o grupo errado; o DOC já usava _pubTitle).
    const grouped = new Map();
    dataList.forEach(h => {
        const key = `${h.vol}_${h.file}`;
        if (!grouped.has(key)) {
            grouped.set(key, { title: _pubTitle(h, lang) || h.topicTitle || 'Outros', items: [] });
        }
        grouped.get(key).items.push(h);
    });

    let txtContent = "=========================================\n";
    txtContent += "   CADERNO DE ESTUDOS - MIOSHIE COLLEGE  \n";
    txtContent += "=========================================\n\n";

    for (const [key, group] of grouped.entries()) {
        txtContent += `[ ENSINAMENTO: ${group.title} ]\n`;
        txtContent += `-----------------------------------------\n`;

        group.items.forEach((h, idx) => {
            const date = new Date(h.createdAt).toLocaleDateString('pt-BR');
            txtContent += `${idx + 1}. "${h.text}"\n`;
            if (h.comment) {
                txtContent += `   NOTA: ${h.comment}\n`;
            }
            txtContent += `   (Adicionado em: ${date})\n\n`;
        });
        txtContent += `\n`;
    }

    // Create a blob and download
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meus_estudos_mioshie_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Exporta pro Word (.doc = Word-HTML, sem libs — mesmo truque do export de
// playlists: BOM obrigatório no começo, estilos INLINE simples porque o Word
// ignora a maior parte do CSS). Agrupa por publicação (nome real via
// _pubTitle), preserva a cor do grifo como fundo do trecho, inclui a NOTA
// e a data.
window.exportHighlightsDOC = function() {
    const lang = localStorage.getItem('site_lang') || 'pt';
    const dataList = _dqFilteredList();
    if (dataList.length === 0) return;

    const grouped = new Map();
    dataList.forEach(h => {
        const key = `${h.vol}_${h.file}`;
        if (!grouped.has(key)) grouped.set(key, { pub: _pubTitle(h, lang) || h.topicTitle || 'Outros', items: [] });
        grouped.get(key).items.push(h);
    });

    const title = lang === 'ja' ? 'ハイライト集 — 幸福への道' : 'Meus Destaques — Caminho da Felicidade';
    const noteLabel = lang === 'ja' ? 'メモ' : 'Nota';
    let body = `<h1 style="font-family:Georgia,serif;font-size:20pt;color:#8a6d1a;margin:0 0 4pt 0;">${_esc(title)}</h1>` +
        `<p style="font-family:Georgia,serif;font-size:10pt;color:#888;margin:0 0 18pt 0;">${new Date().toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR')}</p>`;

    for (const [, group] of grouped.entries()) {
        body += `<h2 style="font-family:Georgia,serif;font-size:14pt;color:#8a6d1a;border-bottom:1pt solid #d8c98f;padding-bottom:2pt;margin:16pt 0 8pt 0;">${_esc(group.pub)}</h2>`;
        group.items.forEach(h => {
            const hex = _DQ_COLOR_HEX[h.color] || '#fff3a1';
            const date = new Date(h.createdAt).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR');
            body += `<div style="margin:0 0 12pt 0;">` +
                `<p style="font-family:Georgia,serif;font-size:12pt;line-height:1.5;margin:0;"><span style="background:${hex};">${_esc(h.text || '')}</span></p>` +
                (h.comment ? `<p style="font-family:Georgia,serif;font-size:10pt;color:#555;font-style:italic;margin:2pt 0 0 0;">${noteLabel}: ${_esc(h.comment)}</p>` : '') +
                `<p style="font-family:Georgia,serif;font-size:9pt;color:#999;margin:2pt 0 0 0;">${_esc(h.topicTitle || '')} · ${date}</p>` +
                `</div>`;
        });
    }

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">` +
        `<head><meta charset="utf-8"><title>${_esc(title)}</title></head><body>${body}</body></html>`;
    // BOM (\ufeff) na frente é OBRIGATÓRIO — sem ele o Word abre com
    // acentuação quebrada (lição do export de playlists).
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meus_destaques_${new Date().toISOString().split('T')[0]}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
