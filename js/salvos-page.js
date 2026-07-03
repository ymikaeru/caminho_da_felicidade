// ============================================================
// Central de Ensinamentos Salvos — salvos.html
// Favoritos organizados em Pastas. Local primeiro (UI instantânea,
// funciona offline); depois faz merge com a nuvem (favorite_folders +
// synced_favorites.folder_id) e re-renderiza.
//
// Modelo local:
//   localStorage.savedFavorites : [{ vol, file, topic, title, topicTitle,
//                                    snippet, totalTopics, time, folderId }]
//   localStorage.favoriteFolders: [{ id, name, color, pos, time }]
// Uma pasta por Ensinamento (folderId null = "Sem pasta").
// ============================================================
(function () {
    'use strict';

    const lang = localStorage.getItem('site_lang') || 'pt';
    const isPt = lang !== 'ja';
    const T = isPt ? {
        allFolders: 'Todos',
        noFolder: 'Sem pasta',
        newFolder: 'Nova pasta',
        empty: 'Nenhum Ensinamento salvo ainda.<br>No leitor, toque em <b>Salvar</b> abaixo do título.',
        emptyFolder: 'Nenhum Ensinamento nesta pasta ainda.<br>Arraste um Ensinamento na lista para cá ou use <b>Mover</b>.',
        savedOn: (d) => d ? `salvo em ${d}` : '',
        move: 'Mover',
        remove: 'Remover',
        removeConfirm: 'Remover este Ensinamento dos salvos?',
        rename: 'Renomear',
        color: 'Cor',
        del: 'Apagar pasta',
        renamePrompt: 'Novo nome da pasta:',
        newFolderPrompt: 'Nome da nova pasta:',
        deleteConfirm: 'Apagar esta pasta? Os Ensinamentos voltam para "Sem pasta" — não são excluídos.',
        maxFolders: 'Limite de pastas atingido.',
        moveTitle: 'Mover para a pasta',
        cancel: 'Cancelar',
        create: 'Criar',
        save: 'Salvar',
        delOk: 'Apagar',
        topicN: (n, tot) => `Tópico ${n}/${tot}`
    } : {
        allFolders: 'すべて',
        noFolder: 'フォルダなし',
        newFolder: '新しいフォルダ',
        empty: 'まだ保存された教えはありません。<br>リーダーでタイトル下の<b>保存</b>をタップしてください。',
        emptyFolder: 'このフォルダには教えがありません。<br>一覧の教えをドラッグするか<b>移動</b>を使ってください。',
        savedOn: (d) => d ? `${d} に保存` : '',
        move: '移動',
        remove: '削除',
        removeConfirm: 'この教えを保存から削除しますか？',
        rename: '名前を変更',
        color: '色',
        del: 'フォルダを削除',
        renamePrompt: 'フォルダの新しい名前:',
        newFolderPrompt: '新しいフォルダの名前:',
        deleteConfirm: 'このフォルダを削除しますか？教えは「フォルダなし」に戻ります（削除されません）。',
        maxFolders: 'フォルダの上限に達しました。',
        moveTitle: 'フォルダへ移動',
        cancel: 'キャンセル',
        create: '作成',
        save: '保存',
        delOk: '削除',
        topicN: (n, tot) => `トピック ${n}/${tot}`
    };

    const FOLDER_COLORS = ['#b8860b', '#c0562f', '#2f7d5b', '#3b6ea5', '#7a5ba5', '#8a8a8a'];
    const MAX_FOLDERS = 50;

    let selected = 'all'; // 'all' | 'none' | <folderId>
    // Chaves alteradas nesta sessão — o merge da nuvem não sobrescreve o que o
    // usuário acabou de mexer (evita reverter antes do cloud refletir).
    const touchedFavs = new Set();
    const touchedFolders = new Set();

    // ---------- storage helpers ----------
    const loadFavs = () => { try { return JSON.parse(localStorage.getItem('savedFavorites') || '[]'); } catch (e) { return []; } };
    const saveFavs = (a) => { try { localStorage.setItem('savedFavorites', JSON.stringify(a)); } catch (e) { } };
    const loadFolders = () => { try { return JSON.parse(localStorage.getItem('favoriteFolders') || '[]'); } catch (e) { return []; } };
    const saveFolders = (a) => { try { localStorage.setItem('favoriteFolders', JSON.stringify(a)); } catch (e) { } };
    const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('f-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    const filt = (arr) => (typeof _filterAccessible === 'function') ? _filterAccessible(arr) : arr;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const favKey = (f) => `${f.vol}:${f.file}:${f.topic || 0}`;
    const folderById = (id) => loadFolders().find(x => x.id === id) || null;

    // ---------- diálogos próprios (sem prompt/confirm/alert nativos, que são
    // bloqueados em PWA/standalone). Reusam os estilos .search-modal do tema. ----------
    function askText(titleText, initial, okLabel) {
        return new Promise((resolve) => {
            const ov = document.createElement('div');
            ov.className = 'search-modal-overlay active mini-dialog';
            ov.innerHTML =
                '<div class="search-modal" style="max-width:380px;">' +
                '<button class="modal-close-btn" data-act="cancel">&times;</button>' +
                '<div class="search-header"><h2 style="font-size:1.1rem;margin:0;color:var(--accent);">' + esc(titleText) + '</h2></div>' +
                '<div class="dlg-body">' +
                '<input type="text" class="dlg-input" maxlength="40" value="' + esc(initial || '') + '" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text-main); font-size:1rem; font-family:inherit;">' +
                '<div class="dlg-actions">' +
                '<button type="button" class="notebook-btn" data-act="cancel">' + esc(T.cancel) + '</button>' +
                '<button type="button" class="notebook-btn" data-act="ok" style="background:var(--accent); color:#fff; border-color:var(--accent);">' + esc(okLabel || T.save) + '</button>' +
                '</div></div></div>';
            document.body.appendChild(ov);
            const input = ov.querySelector('.dlg-input');
            const done = (v) => { ov.remove(); resolve(v); };
            ov.addEventListener('click', (e) => { if (e.target === ov) done(null); });
            ov.querySelectorAll('[data-act="cancel"]').forEach(b => b.addEventListener('click', () => done(null)));
            ov.querySelector('[data-act="ok"]').addEventListener('click', () => done(input.value));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
                else if (e.key === 'Escape') { e.preventDefault(); done(null); }
            });
            setTimeout(() => { input.focus(); input.select(); }, 30);
        });
    }

    function confirmBox(message, opts) {
        opts = opts || {};
        return new Promise((resolve) => {
            const okColor = opts.danger ? '#ff3b30' : 'var(--accent)';
            const ov = document.createElement('div');
            ov.className = 'search-modal-overlay active mini-dialog';
            ov.innerHTML =
                '<div class="search-modal" style="max-width:380px;">' +
                '<div class="dlg-body">' +
                '<div class="dlg-message">' + message + '</div>' +
                '<div class="dlg-actions">' +
                (opts.hideCancel ? '' : '<button type="button" class="notebook-btn" data-act="cancel">' + esc(T.cancel) + '</button>') +
                '<button type="button" class="notebook-btn" data-act="ok" style="background:' + okColor + '; color:#fff; border-color:' + okColor + ';">' + esc(opts.okLabel || T.save) + '</button>' +
                '</div></div></div>';
            document.body.appendChild(ov);
            const done = (v) => { ov.remove(); resolve(v); };
            ov.addEventListener('click', (e) => { if (e.target === ov) done(false); });
            const cancelBtn = ov.querySelector('[data-act="cancel"]');
            if (cancelBtn) cancelBtn.addEventListener('click', () => done(false));
            ov.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
            ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } });
            setTimeout(() => { const b = ov.querySelector('[data-act="ok"]'); if (b) b.focus(); }, 30);
        });
    }

    const notice = (message) => confirmBox(message, { hideCancel: true, okLabel: 'OK' });

    // ---------- cloud (fire-and-forget) ----------
    const cs = () => window._cloudSync;
    function cloudUpsertFolder(fo) { const c = cs(); if (c && c.upsertFolder) Promise.resolve(c.upsertFolder({ id: fo.id, name: fo.name, color: fo.color, pos: fo.pos })).catch(e => console.warn('[salvos] upsertFolder', e)); }
    function cloudDeleteFolder(id) { const c = cs(); if (c && c.deleteFolder) Promise.resolve(c.deleteFolder(id)).catch(e => console.warn('[salvos] deleteFolder', e)); }
    function cloudSetFavFolder(f, folderId) { const c = cs(); if (c && c.setFavoriteFolder) Promise.resolve(c.setFavoriteFolder(f.vol, f.file, f.topic || 0, folderId)).catch(e => console.warn('[salvos] setFavoriteFolder', e)); }
    function cloudRemoveFav(f) { const c = cs(); if (c && c.removeFavorite) Promise.resolve(c.removeFavorite(f.vol, f.file, f.topic || 0)).catch(e => console.warn('[salvos] removeFavorite', e)); }

    // ---------- mutations ----------
    function createFolder(name) {
        name = (name || '').trim().slice(0, 40);
        if (!name) return null;
        const folders = loadFolders();
        if (folders.length >= MAX_FOLDERS) { notice(T.maxFolders); return null; }
        const fo = { id: uuid(), name, color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length], pos: folders.length, time: Date.now() };
        folders.push(fo);
        saveFolders(folders);
        touchedFolders.add(fo.id);
        cloudUpsertFolder(fo);
        return fo;
    }

    async function renameFolder(id) {
        const folders = loadFolders();
        const fo = folders.find(x => x.id === id);
        if (!fo) return;
        const name = await askText(T.renamePrompt, fo.name, T.save);
        if (name == null) return;
        const trimmed = name.trim().slice(0, 40);
        if (!trimmed) return;
        fo.name = trimmed;
        saveFolders(folders);
        touchedFolders.add(id);
        cloudUpsertFolder(fo);
        render();
    }

    function recolorFolder(id, color) {
        const folders = loadFolders();
        const fo = folders.find(x => x.id === id);
        if (!fo) return;
        fo.color = color;
        saveFolders(folders);
        touchedFolders.add(id);
        cloudUpsertFolder(fo);
        render();
    }

    async function deleteFolder(id) {
        if (!(await confirmBox(T.deleteConfirm, { danger: true, okLabel: T.delOk }))) return;
        saveFolders(loadFolders().filter(x => x.id !== id));
        touchedFolders.add(id);
        const favs = loadFavs();
        let touched = false;
        favs.forEach(f => { if (f.folderId === id) { f.folderId = null; touched = true; touchedFavs.add(favKey(f)); } });
        if (touched) saveFavs(favs);
        cloudDeleteFolder(id); // no cloud, ON DELETE SET NULL desarquiva os favoritos
        if (selected === id) selected = 'all';
        render();
    }

    function assignFolder(key, folderId) {
        const favs = loadFavs();
        const f = favs.find(x => favKey(x) === key);
        if (!f) return;
        f.folderId = folderId || null;
        saveFavs(favs);
        touchedFavs.add(key);
        cloudSetFavFolder(f, f.folderId);
        render();
    }

    async function removeFav(key) {
        if (!(await confirmBox(T.removeConfirm, { danger: true, okLabel: T.remove }))) return;
        const favs = loadFavs();
        const f = favs.find(x => favKey(x) === key);
        saveFavs(favs.filter(x => favKey(x) !== key));
        if (f) cloudRemoveFav(f);
        if (typeof window.updateFavIndicators === 'function') window.updateFavIndicators();
        render();
    }

    // ---------- move menu (funciona no desktop e no celular) ----------
    function openMoveMenu(key) {
        closeMoveMenu();
        const fav = loadFavs().find(x => favKey(x) === key);
        const cur = fav ? (fav.folderId || null) : null;
        const folders = loadFolders().slice().sort((a, b) => (a.pos || 0) - (b.pos || 0));
        const row = (fid, label, color, active) =>
            `<button type="button" class="move-opt${active ? ' active' : ''}" data-fid="${esc(fid)}" title="${esc(label)}">
                <span class="folder-dot" style="background:${color ? esc(color) : 'transparent'};${color ? '' : 'border:1px solid var(--border);'}"></span>
                <span class="folder-name">${esc(label)}</span>${active ? '<span class="move-check">✓</span>' : ''}
            </button>`;
        let opts = row('', T.noFolder, null, cur === null);
        for (const fo of folders) opts += row(fo.id, fo.name, fo.color, cur === fo.id);
        opts += `<button type="button" class="move-opt move-new" data-fid="__new__"><span class="folder-dot" style="background:transparent;border:1px dashed var(--accent);"></span><span class="folder-name">＋ ${esc(T.newFolder)}</span></button>`;

        const ov = document.createElement('div');
        ov.className = 'search-modal-overlay active';
        ov.id = 'moveMenuOverlay';
        ov.innerHTML =
            '<div class="search-modal" style="max-width:380px;">' +
            '<button class="modal-close-btn" id="moveMenuClose">&times;</button>' +
            '<div class="search-header"><h2 style="font-size:1.1rem;margin:0;color:var(--accent);">' + esc(T.moveTitle) + '</h2></div>' +
            '<div class="move-list">' + opts + '</div>' +
            '</div>';
        document.body.appendChild(ov);

        ov.addEventListener('click', (e) => { if (e.target === ov) closeMoveMenu(); });
        ov.querySelector('#moveMenuClose').addEventListener('click', closeMoveMenu);
        ov.querySelectorAll('.move-opt').forEach(btn => btn.addEventListener('click', async () => {
            const fid = btn.dataset.fid;
            if (fid === '__new__') {
                closeMoveMenu();
                const fo = createFolder(await askText(T.newFolderPrompt, '', T.create));
                if (fo) assignFolder(key, fo.id);
                return;
            }
            assignFolder(key, fid || null);
            closeMoveMenu();
        }));
    }
    function closeMoveMenu() { const ov = document.getElementById('moveMenuOverlay'); if (ov) ov.remove(); }

    // ---------- render ----------
    function countIn(favs, sel) {
        if (sel === 'all') return favs.length;
        if (sel === 'none') return favs.filter(f => !f.folderId).length;
        return favs.filter(f => f.folderId === sel).length;
    }

    function railBtn(id, label, count, color) {
        const active = selected === id ? ' active' : '';
        const dot = color ? `<span class="folder-dot" style="background:${esc(color)}"></span>` : '';
        return `<button type="button" class="folder-item${active}" data-folder="${esc(id)}" title="${esc(label)}">
            ${dot}<span class="folder-name">${esc(label)}</span><span class="folder-count">${count}</span>
        </button>`;
    }

    function cardHtml(f) {
        const vNum = String(f.vol).replace('mioshiec', '');
        const topicIdx = f.topic || 0;
        const fBase = String(f.file).replace('.html', '');
        const href = topicIdx > 0
            ? `reader.html?vol=${encodeURIComponent(f.vol)}&file=${encodeURIComponent(f.file)}&topic=${topicIdx}`
            : `reader.html#v${vNum}/${fBase}`;
        const date = f.time ? new Date(f.time).toLocaleDateString(isPt ? 'pt-BR' : 'ja-JP') : '';
        const cleanTitle = String(f.topicTitle || f.title || f.file)
            .replace(/^(Ensinamento|Orientação|Palestra) de (Meishu-Sama|Moisés)\s*[-:]?\s*/i, '')
            .replace(/^["'](.*?)["']$/, '$1').trim();
        const topicBadge = (f.totalTopics && f.totalTopics > 1)
            ? `<span class="fav-topic-badge">${esc(T.topicN(topicIdx + 1, f.totalTopics))}</span>` : '';
        const snippet = f.snippet ? `<div class="fav-snippet">${esc(f.snippet)}</div>` : '';
        const fo = f.folderId ? folderById(f.folderId) : null;
        const folderTag = fo ? `<span class="fav-folder-tag" title="${esc(fo.name)}"><span class="folder-dot" style="background:${esc(fo.color || '#b8860b')}"></span><span class="fav-folder-tag-name">${esc(fo.name)}</span></span>` : '';
        const key = favKey(f);
        return `<div class="fav-card" draggable="true" data-key="${esc(key)}">
            <a class="fav-main" href="${href}">
                <div class="fav-title">${esc(cleanTitle)} <span class="fav-vol">(Vol ${esc(vNum)})</span>${topicBadge}</div>
                ${snippet}
            </a>
            <div class="fav-footer">
                <div class="fav-meta">${folderTag}${date ? `<span class="fav-date">${esc(T.savedOn(date))}</span>` : ''}</div>
                <div class="fav-actions">
                    <button type="button" class="notebook-btn fav-move" data-key="${esc(key)}">${esc(T.move)} ▾</button>
                    <button type="button" class="notebook-btn delete fav-remove" data-key="${esc(key)}">${esc(T.remove)}</button>
                </div>
            </div>
        </div>`;
    }

    function toolsHtml() {
        if (selected === 'all' || selected === 'none') return '';
        const fo = folderById(selected);
        if (!fo) return '';
        const swatches = FOLDER_COLORS.map(c =>
            `<button type="button" class="color-swatch${fo.color === c ? ' active' : ''}" data-color="${c}" style="background:${c}" aria-label="cor"></button>`
        ).join('');
        return `<button type="button" class="notebook-btn" id="folderRename">${esc(T.rename)}</button>
            <span class="color-swatches">${swatches}</span>
            <button type="button" class="notebook-btn delete" id="folderDelete">${esc(T.del)}</button>`;
    }

    function render() {
        const railEl = document.getElementById('salvos-folders');
        const listEl = document.getElementById('salvos-list');
        if (!railEl || !listEl) return;

        const favs = filt(loadFavs());
        const folders = loadFolders().slice().sort((a, b) => (a.pos || 0) - (b.pos || 0));

        // Se a pasta selecionada sumiu, volta pra "Todos"
        if (selected !== 'all' && selected !== 'none' && !folders.some(f => f.id === selected)) selected = 'all';

        let rail = railBtn('all', T.allFolders, countIn(favs, 'all'), null);
        rail += railBtn('none', T.noFolder, countIn(favs, 'none'), null);
        for (const fo of folders) rail += railBtn(fo.id, fo.name, countIn(favs, fo.id), fo.color);
        rail += `<button type="button" class="folder-add" id="folderAddBtn">＋ ${esc(T.newFolder)}</button>`;
        railEl.innerHTML = rail;

        let items = favs.slice();
        if (selected === 'none') items = items.filter(f => !f.folderId);
        else if (selected !== 'all') items = items.filter(f => f.folderId === selected);
        items.sort((a, b) => (b.time || 0) - (a.time || 0));

        const curName = selected === 'all' ? T.allFolders : (selected === 'none' ? T.noFolder : (folderById(selected) ? folderById(selected).name : ''));
        const headEl = document.getElementById('salvos-current');
        if (headEl) { headEl.textContent = curName; headEl.title = curName; }
        const toolsEl = document.getElementById('salvos-tools');
        if (toolsEl) toolsEl.innerHTML = toolsHtml();

        listEl.innerHTML = items.length
            ? items.map(cardHtml).join('')
            : `<div class="notebook-empty">${selected === 'all' ? T.empty : T.emptyFolder}</div>`;

        wire();
    }

    function wire() {
        // seleção de pasta
        document.querySelectorAll('#salvos-folders .folder-item').forEach(btn => {
            btn.addEventListener('click', () => { selected = btn.dataset.folder; render(); });
            // drop target (desktop)
            btn.addEventListener('dragover', (e) => { e.preventDefault(); btn.classList.add('drop-hover'); });
            btn.addEventListener('dragleave', () => btn.classList.remove('drop-hover'));
            btn.addEventListener('drop', (e) => {
                e.preventDefault();
                btn.classList.remove('drop-hover');
                const key = e.dataTransfer.getData('text/plain');
                const target = btn.dataset.folder;
                if (!key) return;
                if (target === 'all') return; // "Todos" é uma visão, não uma pasta
                assignFolder(key, target === 'none' ? null : target);
            });
        });

        const addBtn = document.getElementById('folderAddBtn');
        if (addBtn) addBtn.addEventListener('click', async () => {
            const fo = createFolder(await askText(T.newFolderPrompt, '', T.create));
            if (fo) { selected = fo.id; render(); }
        });

        const renameBtn = document.getElementById('folderRename');
        if (renameBtn) renameBtn.addEventListener('click', () => renameFolder(selected));
        const delBtn = document.getElementById('folderDelete');
        if (delBtn) delBtn.addEventListener('click', () => deleteFolder(selected));
        document.querySelectorAll('#salvos-tools .color-swatch').forEach(sw =>
            sw.addEventListener('click', () => recolorFolder(selected, sw.dataset.color)));

        // cards
        document.querySelectorAll('#salvos-list .fav-move').forEach(btn =>
            btn.addEventListener('click', () => openMoveMenu(btn.dataset.key)));
        document.querySelectorAll('#salvos-list .fav-remove').forEach(btn =>
            btn.addEventListener('click', () => removeFav(btn.dataset.key)));
        document.querySelectorAll('#salvos-list .fav-card').forEach(card => {
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', card.dataset.key);
                e.dataTransfer.effectAllowed = 'move';
                card.classList.add('dragging');
            });
            card.addEventListener('dragend', () => card.classList.remove('dragging'));
        });
    }

    // ---------- cloud merge ----------
    async function mergeCloud() {
        const c = cs();
        if (!c) return;
        try {
            let changed = false;

            if (c.loadFolders) {
                const cloud = await c.loadFolders();
                const local = loadFolders();
                const byId = new Map(local.map(f => [f.id, f]));
                for (const r of cloud) {
                    if (touchedFolders.has(r.id)) continue;
                    const ex = byId.get(r.id);
                    if (!ex) {
                        local.push({ id: r.id, name: r.name, color: r.color, pos: r.pos, time: new Date(r.created_at).getTime() });
                        changed = true;
                    } else if (ex.name !== r.name || ex.color !== r.color || (ex.pos || 0) !== (r.pos || 0)) {
                        ex.name = r.name; ex.color = r.color; ex.pos = r.pos; changed = true;
                    }
                }
                if (changed) saveFolders(local);
            }

            if (c.loadFavorites) {
                const cloud = await c.loadFavorites();
                const favs = loadFavs();
                const byKey = new Map(favs.map(f => [favKey(f), f]));
                let favChanged = false;
                for (const r of cloud) {
                    const key = `${r.volume}:${r.file}:${r.topic_index}`;
                    const ex = byKey.get(key);
                    if (!ex) {
                        favs.push({ title: r.topic_title || '', vol: r.volume, file: r.file, time: new Date(r.created_at).getTime(), topic: r.topic_index, topicTitle: r.topic_title, snippet: r.snippet, totalTopics: r.total_topics, folderId: r.folder_id || null });
                        favChanged = true;
                    } else if (!touchedFavs.has(key) && (ex.folderId || null) !== (r.folder_id || null)) {
                        ex.folderId = r.folder_id || null;
                        favChanged = true;
                    }
                }
                if (favChanged) { saveFavs(favs); changed = true; }
            }

            if (changed) render();
        } catch (e) {
            console.warn('[salvos] mergeCloud failed:', e);
        }
    }

    function init() {
        render();
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMoveMenu(); });
        // _cloudSync é module script (chega depois) e o pull do login roda
        // async — tenta a união em duas janelas, padrão das outras centrais.
        setTimeout(mergeCloud, 1200);
        setTimeout(mergeCloud, 3500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
