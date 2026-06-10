// ============================================================
// Central de Ensinamentos Lidos — lidos.html
// Agrupa as marcas de "lido" (readMarks) por volume e seção, com
// data e link pra reler. Sem barra de % por enquanto (decisão
// 11/06/2026): só contagem por volume — o denominador por tópico
// precisaria de um topic_counts gerado.
// Local primeiro; quando o _cloudSync estiver pronto, faz união
// com a tabela read_marks e re-renderiza se chegar algo novo.
// ============================================================
(function () {
    'use strict';

    const lang = localStorage.getItem('site_lang') || 'pt';
    const isPt = lang !== 'ja';
    const T = isPt ? {
        empty: 'Nenhum Ensinamento marcado como lido ainda.<br>No leitor, toque no botão <b>✓ Marcar como lido</b> abaixo do título.',
        readOn: (d) => `lido em ${d}`,
        reread: 'Reler',
        unmark: 'Desmarcar',
        unmarkConfirm: 'Remover a marca de lido deste Ensinamento?',
        count: (n) => n === 1 ? '1 Ensinamento lido' : `${n} Ensinamentos lidos`,
        topicN: (n) => `tópico ${n}`
    } : {
        empty: 'まだ読了の記録はありません。<br>リーダーでタイトル下の<b>✓ 読了として記録</b>をタップしてください。',
        readOn: (d) => `${d} に読了`,
        reread: 'もう一度読む',
        unmark: '解除',
        unmarkConfirm: 'この教えの読了記録を解除しますか？',
        count: (n) => `読了 ${n} 件`,
        topicN: (n) => `トピック ${n}`
    };

    function loadLocal() {
        try { return JSON.parse(localStorage.getItem('readMarks') || '[]'); } catch (e) { return []; }
    }

    function volLabel(vol) {
        const m = String(vol).match(/^mioshiec(\d+)$/);
        if (m) {
            const n = m[1];
            const subs = (window.VOL_SUBTITLES && window.VOL_SUBTITLES[isPt ? 'pt' : 'ja']) || {};
            const sub = subs[n];
            return (isPt ? `Volume ${n}` : `第${n}巻`) + (sub ? ` — ${sub}` : '');
        }
        return String(vol);
    }

    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function itemTitle(mark, idxEntry) {
        if (mark.topicTitle) return mark.topicTitle;
        if (idxEntry) {
            const base = isPt ? (idxEntry.pt || idxEntry.ja) : (idxEntry.ja || idxEntry.pt);
            return (mark.topic || 0) > 0 ? `${base} · ${T.topicN((mark.topic || 0) + 1)}` : base;
        }
        return mark.file;
    }

    function render() {
        const container = document.getElementById('read-central-container');
        if (!container) return;
        const marks = loadLocal();
        if (!marks.length) {
            container.innerHTML = `<div class="notebook-empty">${T.empty}</div>`;
            return;
        }

        const idx = window.GLOBAL_INDEX_TITLES || {};
        const byVol = {};
        marks.forEach(m => { (byVol[m.vol] = byVol[m.vol] || []).push(m); });

        const volOrder = Object.keys(byVol).sort();
        let html = '';
        for (const vol of volOrder) {
            const items = byVol[vol];
            // Ordem do índice da obra (seção + nº da publicação + tópico);
            // sem entrada no índice, cai pro fim em ordem de data desc.
            items.sort((a, b) => {
                const ia = idx[`${a.vol}/${a.file}`];
                const ib = idx[`${b.vol}/${b.file}`];
                if (ia && ib) {
                    if (ia.section !== ib.section) return ia.section < ib.section ? -1 : 1;
                    const na = parseInt(ia.n, 10) || 0, nb = parseInt(ib.n, 10) || 0;
                    if (na !== nb) return na - nb;
                    return (a.topic || 0) - (b.topic || 0);
                }
                if (ia) return -1;
                if (ib) return 1;
                return (b.time || 0) - (a.time || 0);
            });

            let rows = '';
            let lastSection = null;
            for (const m of items) {
                const entry = idx[`${m.vol}/${m.file}`];
                const section = entry ? (isPt ? entry.section : (entry.sectionJa || entry.section)) : '';
                if (section && section !== lastSection) {
                    rows += `<div class="read-section">${esc(section)}</div>`;
                    lastSection = section;
                }
                const dateStr = m.time ? new Date(m.time).toLocaleDateString(isPt ? 'pt-BR' : 'ja-JP') : '';
                const href = `reader.html?vol=${encodeURIComponent(m.vol)}&file=${encodeURIComponent(m.file)}&topic=${m.topic || 0}`;
                rows += `
                <div class="read-item">
                    <svg class="read-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg>
                    <a class="read-item-title" href="${href}">${esc(itemTitle(m, entry))}</a>
                    <span class="read-item-meta">
                        ${dateStr ? `<span class="read-item-date">${T.readOn(dateStr)}</span>` : ''}
                        <a class="notebook-btn" href="${href}">${T.reread}</a>
                        <button type="button" class="notebook-btn delete" data-vol="${esc(m.vol)}" data-file="${esc(m.file)}" data-topic="${m.topic || 0}">${T.unmark}</button>
                    </span>
                </div>`;
            }

            html += `
            <div class="notebook-group">
                <div class="notebook-group-header">
                    <span>${esc(volLabel(vol))}</span>
                    <span class="read-vol-count">${T.count(items.length)}</span>
                </div>
                ${rows}
            </div>`;
        }
        container.innerHTML = html;

        container.querySelectorAll('.notebook-btn.delete').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!confirm(T.unmarkConfirm)) return;
                const { vol, file } = btn.dataset;
                const topic = parseInt(btn.dataset.topic, 10) || 0;
                let marks2 = loadLocal();
                marks2 = marks2.filter(m => !(m.vol === vol && m.file === file && (m.topic || 0) === topic));
                try { localStorage.setItem('readMarks', JSON.stringify(marks2)); } catch (e) { }
                if (window._cloudSync && window._cloudSync.removeReadMark) {
                    Promise.resolve(window._cloudSync.removeReadMark(vol, file, topic))
                        .catch(e => console.warn('[lidos] cloud remove failed:', e));
                }
                render();
            });
        });
    }

    // União nuvem → local (mesma lógica do pullCloudToLocal), depois re-render.
    async function mergeCloud() {
        if (!window._cloudSync || !window._cloudSync.loadReadMarks) return;
        try {
            const cloud = await window._cloudSync.loadReadMarks();
            if (!cloud.length) return;
            const local = loadLocal();
            const keys = new Set(local.map(m => `${m.vol}:${m.file}:${m.topic || 0}`));
            let added = 0;
            for (const c of cloud) {
                const key = `${c.volume}:${c.file}:${c.topic_index}`;
                if (!keys.has(key)) {
                    local.push({ vol: c.volume, file: c.file, topic: c.topic_index, topicTitle: c.topic_title || '', time: new Date(c.created_at).getTime() });
                    added++;
                }
            }
            if (added > 0) {
                local.sort((a, b) => (b.time || 0) - (a.time || 0));
                try { localStorage.setItem('readMarks', JSON.stringify(local)); } catch (e) { }
                render();
            }
        } catch (e) {
            console.warn('[lidos] cloud merge failed:', e);
        }
    }

    function init() {
        render();
        // _cloudSync é module script (chega depois) e o pull do login roda
        // async — tenta a união em duas janelas, padrão das outras páginas.
        setTimeout(mergeCloud, 1200);
        setTimeout(mergeCloud, 3500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
