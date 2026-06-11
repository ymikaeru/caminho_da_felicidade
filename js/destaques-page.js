// ============================================================
// Destaques Page — Mioshie College
// Central de Destaques: agrupada por Volume → publicação, com
// busca, filtro por cor e filtro de grifos de título (12/06 —
// muitos usuários grifavam o TÍTULO como marca de "já li", o que
// afogava os destaques de conteúdo).
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        _initToolbar();
        renderNotebook();
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
const _dqState = {
    q: '',
    color: null,
    hideTitles: localStorage.getItem('dqHideTitles') === '1'
};

function _dqLang() { return localStorage.getItem('site_lang') || 'pt'; }

function _volLabel(vol, lang) {
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
    const g = _pubEntry(h);
    if (g) return lang === 'ja' ? (g.ja || g.pt) : (g.pt || g.ja);
    return h.topicTitle || h.file || (lang === 'ja' ? 'その他' : 'Outros');
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
        `<button type="button" class="dq-chip" data-color="${c}" title="${c}" aria-pressed="false" style="--chip:${_DQ_COLOR_HEX[c]}"></button>`
    ).join('');

    host.innerHTML = `
        <div class="dq-toolbar">
            <div class="dq-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="search" id="dqSearch" placeholder="${t.search}" aria-label="${t.search}">
            </div>
            <div class="dq-colors" role="group" aria-label="Filtrar por cor">
                <button type="button" class="dq-chip dq-chip--all is-active" data-color="" aria-pressed="true">${t.all}</button>
                ${chips}
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
    if (!all.length) {
        const countEl0 = document.getElementById('dqCount');
        if (countEl0) countEl0.textContent = '';
        container.innerHTML = `<div class="notebook-empty">${noHighlights}</div>`;
        return;
    }

    const q = _dqState.q.toLowerCase().trim();
    const titleHidden = [];
    const list = all.filter(h => {
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
        container.innerHTML = `<div class="notebook-empty">${noResults}</div>`;
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

    let html = '';
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
            items.sort((a, b) => ((a.topicIndex ?? 0) - (b.topicIndex ?? 0)) || ((a.startChar ?? 0) - (b.startChar ?? 0)));
            const pubUrl = `reader.html?vol=${encodeURIComponent(vol)}&file=${encodeURIComponent(file)}`;
            const pubTitle = _pubTitle(items[0], lang);

            html += `
            <div class="notebook-group">
                <div class="notebook-group-header">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                    <a class="notebook-group-link" href="${pubUrl}">${_esc(pubTitle)}</a>
                    <span class="notebook-group-count">${items.length}</span>
                </div>
                <div class="notebook-grid">
                    ${items.map(h => _renderCard(h, lang)).join('')}
                </div>
            </div>`;
        }

        html += `</div>`;
    }

    container.innerHTML = html;
}

function _renderCard(h, lang) {
    const date = new Date(h.createdAt).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR');
    const bgColor = _DQ_COLOR_HEX[h.color] || '#fff3a1';

    let articleUrl = '#';
    if (h.vol && h.file) {
        articleUrl = `reader.html?vol=${encodeURIComponent(h.vol)}&file=${encodeURIComponent(h.file)}`;
        if (h.topicIndex !== undefined && h.topicIndex !== '') articleUrl += `&topic=${h.topicIndex}`;
        if (h.id) articleUrl += `&highlight=${encodeURIComponent(h.id)}&hl_scroll=1`;
    }

    const isTitle = _isTitleHighlight(h);
    const titleBadge = isTitle
        ? `<span class="notebook-tag-title">${lang === 'ja' ? 'タイトル' : 'título'}</span>`
        : '';
    const shortTitle = _esc(_truncate(h.topicTitle || (lang === 'ja' ? 'その他' : 'Outros'), 40));
    const shortText = _esc(_truncate(h.text, 120));
    const commentPreview = h.comment ? `<div class="notebook-comment-preview">📝 ${_esc(_truncate(h.comment, 60))}</div>` : '';
    // Admin: recomendar o trecho deste destaque aos usuários (abre o picker
    // do reader-recommend.js com o intervalo do grifo embutido).
    const recBtn = (typeof isAdminUser === 'function' && isAdminUser() && typeof window.openRecommendPicker === 'function')
        ? `<button class="notebook-btn" onclick="event.stopPropagation(); recommendExcerpt('${h.id}')">${lang === 'ja' ? '推薦' : 'Recomendar'}</button>`
        : '';

    return `
    <div class="notebook-card" data-id="${h.id}" onclick="openHighlightDetail('${h.id}')">
        <div class="notebook-card-accent" style="background: ${bgColor};"></div>
        <div class="notebook-card-title">${titleBadge}${shortTitle}</div>
        <div class="notebook-text">${shortText}</div>
        ${commentPreview}
        <div class="notebook-meta">
            <span>${date}</span>
            <div class="notebook-actions">
                <a href="${articleUrl}" class="notebook-btn link" style="text-decoration:none;" onclick="event.stopPropagation();">${lang === 'ja' ? '読む' : 'Abrir'}</a>
                ${recBtn}
                <button class="notebook-btn delete" onclick="event.stopPropagation(); deleteNotebookHighlight('${h.id}')">${lang === 'ja' ? '削除' : 'Apagar'}</button>
            </div>
        </div>
    </div>`;
}

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
                    <button class="notebook-btn" id="detailEditBtn">${lang === 'ja' ? '編集' : 'Editar'}</button>
                    <button class="notebook-btn delete" id="detailDeleteBtn">${lang === 'ja' ? '削除' : 'Apagar'}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeHighlightDetail();
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

    let articleUrl = '#';
    if (h.vol && h.file) {
        articleUrl = `reader.html?vol=${encodeURIComponent(h.vol)}&file=${encodeURIComponent(h.file)}`;
        if (h.topicIndex !== undefined && h.topicIndex !== '') articleUrl += `&topic=${h.topicIndex}`;
        if (h.id) articleUrl += `&highlight=${encodeURIComponent(h.id)}&hl_scroll=1`;
    }
    document.getElementById('detailOpenBtn').href = articleUrl;
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
    let dataList = _dqGetAll();
    if (dataList.length === 0) return;

    // Grouping
    const grouped = new Map();
    dataList.forEach(h => {
        const key = `${h.vol}_${h.file}`;
        if (!grouped.has(key)) {
            grouped.set(key, { title: h.topicTitle || 'Outros', items: [] });
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
