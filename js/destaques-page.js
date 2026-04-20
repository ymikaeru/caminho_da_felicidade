// ============================================================
// Destaques Page — Mioshie College
// Handles the rendering and exportation of the Notebook Page
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
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

function renderNotebook() {
    const container = document.getElementById('notebook-container');
    const lang = localStorage.getItem('site_lang') || 'pt';
    const noHighlights = lang === 'ja' ? 'ハイライトやメモはまだありません。' : 'Nenhum destaque ou anotação salvos ainda.';
    
    let dataList = [];
    if (typeof window._HighlightsApi !== 'undefined') {
        dataList = window._HighlightsApi.getAll();
    } else {
        const hStorage = localStorage.getItem('userHighlights');
        dataList = hStorage ? JSON.parse(hStorage) : [];
    }

    if (!dataList || dataList.length === 0) {
        container.innerHTML = `<div class="notebook-empty">${noHighlights}</div>`;
        return;
    }

    const grouped = new Map();
    dataList.forEach(h => {
        const key = `${h.vol}_${h.file}`;
        if (!grouped.has(key)) {
            grouped.set(key, { 
                title: h.topicTitle || (lang === 'ja' ? 'その他' : 'Outros'), 
                volInfo: h.vol ? h.vol.toUpperCase() : '',
                items: [] 
            });
        }
        grouped.get(key).items.push(h);
    });

    let html = '';
    for (const [key, group] of grouped.entries()) {
        html += `
        <div class="notebook-group">
            <div class="notebook-group-header">
                <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                ${_esc(group.title)}
            </div>
            <div class="notebook-grid">
        `;
        
        group.items.forEach(h => {
            const date = new Date(h.createdAt).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR');
            const colorMap = {
                yellow: '#fff3a1', green: '#a8e6cf', blue: '#a0c4ff',
                pink: '#ffb3c6', purple: '#d4a5f5', orange: '#ffd6a5'
            };
            const bgColor = colorMap[h.color] || '#fff3a1';
            
            let articleUrl = '#';
            if (h.vol && h.file) {
                articleUrl = `reader.html?vol=${encodeURIComponent(h.vol)}&file=${encodeURIComponent(h.file)}`;
                if (h.topicIndex !== undefined && h.topicIndex !== '') articleUrl += `&topic=${h.topicIndex}`;
            }

            const shortTitle = _esc(_truncate(h.topicTitle || (lang === 'ja' ? 'その他' : 'Outros'), 40));
            const shortText = _esc(_truncate(h.text, 120));
            const commentPreview = h.comment ? `<div class="notebook-comment-preview">📝 ${_esc(_truncate(h.comment, 60))}</div>` : '';

            html += `
            <div class="notebook-card" data-id="${h.id}" onclick="openHighlightDetail('${h.id}')">
                <div class="notebook-card-accent" style="background: ${bgColor};"></div>
                <div class="notebook-card-title">${shortTitle}</div>
                <div class="notebook-text">${shortText}</div>
                ${commentPreview}
                <div class="notebook-meta">
                    <span>${date}</span>
                    <div class="notebook-actions">
                        <a href="${articleUrl}" class="notebook-btn link" style="text-decoration:none;" onclick="event.stopPropagation();">${lang === 'ja' ? '読む' : 'Abrir'}</a>
                        <button class="notebook-btn delete" onclick="event.stopPropagation(); deleteNotebookHighlight('${h.id}')">${lang === 'ja' ? '削除' : 'Apagar'}</button>
                    </div>
                </div>
            </div>`;
        });
        
        html += `</div></div>`;
    }

    container.innerHTML = html;
}

function openHighlightDetail(id) {
    let dataList = typeof window._HighlightsApi !== 'undefined' ? window._HighlightsApi.getAll() : [];
    const h = dataList.find(x => x.id === id);
    if (!h) return;

    const lang = localStorage.getItem('site_lang') || 'pt';
    const date = new Date(h.createdAt).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR');
    const colorMap = {
        yellow: '#fff3a1', green: '#a8e6cf', blue: '#a0c4ff',
        pink: '#ffb3c6', purple: '#d4a5f5', orange: '#ffd6a5'
    };
    const bgColor = colorMap[h.color] || '#fff3a1';

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
            if (typeof window._HighlightsApi !== 'undefined') window._HighlightsApi.edit(id);
        });
        document.getElementById('detailDeleteBtn').addEventListener('click', () => {
            const msg = lang === 'ja' ? 'このハイライトを削除してもよろしいですか？' : 'Tem certeza que deseja apagar este destaque?';
            if (confirm(msg)) {
                if (typeof window._HighlightsApi !== 'undefined') {
                    window._HighlightsApi.delete(id);
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
    const lang = localStorage.getItem('site_lang') || 'pt';
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
    let dataList = typeof window._HighlightsApi !== 'undefined' ? window._HighlightsApi.getAll() : [];
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
