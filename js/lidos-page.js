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
        empty: 'Nenhuma leitura registrada ainda.<br>No leitor, toque no botão <b>✓ Registrar leitura</b> no fim do Ensinamento.',
        readOn: (d) => `última em ${d}`,
        times: (n) => n === 1 ? '1 leitura' : `${n} leituras`,
        reread: 'Reler',
        unmark: 'Tirar uma leitura',
        // Só pergunta quando é a última: aí o Ensinamento sai da lista.
        unmarkConfirm: 'Esta é a única leitura registrada. Tirar este Ensinamento do registro?',
        count: (n) => n === 1 ? '1 Ensinamento lido' : `${n} Ensinamentos lidos`,
        topicN: (n) => `tópico ${n}`,
        mostRead: 'Os que você mais releu',
        mostReadSub: '“Convém ler repetidas e repetidas vezes, até que o Ensinamento penetre no íntimo.”'
    } : {
        empty: 'まだ拝読の記録はありません。<br>リーダーで御教えの最後にある<b>✓ 拝読を記録</b>をタップしてください。',
        readOn: (d) => `最終 ${d}`,
        times: (n) => `${n}回拝読`,
        reread: 'もう一度読む',
        unmark: '拝読を1回減らす',
        unmarkConfirm: '記録は1回だけです。この御教えを記録から外しますか？',
        count: (n) => `読了 ${n} 件`,
        topicN: (n) => `トピック ${n}`,
        mostRead: '繰り返し拝読した御教え',
        mostReadSub: '「繰り返し繰り返し肚にはいるまで読むのがよい」'
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

    // Normaliza numeração de parte herdada do JP (espaço fullwidth 　 + dígitos
    // ０-９) → normal, na exibição dos títulos. Ex.: "Germes　２" → "Germes 2".
    const normNums = (s) => String(s == null ? '' : s)
        .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/　+(?=\d)/g, ' ');

    function itemTitle(mark, idxEntry) {
        if (mark.topicTitle) return normNums(mark.topicTitle);
        if (idxEntry) {
            const base = isPt ? (idxEntry.pt || idxEntry.ja) : (idxEntry.ja || idxEntry.pt);
            return normNums((mark.topic || 0) > 0 ? `${base} · ${T.topicN((mark.topic || 0) + 1)}` : base);
        }
        return mark.file;
    }

    // "Os que você mais releu" — só aparece quando existe algo relido (2+).
    // NÃO é placar: sem posições, sem medalha, sem total somado. É a lista
    // dos Ensinamentos aos quais a pessoa voltou, que é o que o próprio
    // ensinamento pede ("convém ler repetidas e repetidas vezes…").
    function renderMostRead(marks, idx) {
        const top = marks
            .map(m => ({ m, n: Math.max(1, m.count || 1) }))
            .filter(x => x.n >= 2)
            .sort((a, b) => (b.n - a.n) || ((b.m.time || 0) - (a.m.time || 0)))
            .slice(0, 8);
        if (!top.length) return '';

        const rows = top.map(({ m, n }) => {
            const entry = idx[`${m.vol}/${m.file}`];
            const href = `reader.html?vol=${encodeURIComponent(m.vol)}&file=${encodeURIComponent(m.file)}&topic=${m.topic || 0}`;
            return `
            <div class="read-item">
                <span class="read-most-count">${esc(T.times(n))}</span>
                <a class="read-item-title" href="${href}">${esc(itemTitle(m, entry))}</a>
                <span class="read-item-meta"><span class="read-item-date">${esc(volLabel(m.vol))}</span></span>
            </div>`;
        }).join('');

        return `
        <div class="notebook-group read-most-group">
            <div class="notebook-group-header">
                <span>${esc(T.mostRead)}</span>
            </div>
            <div class="read-most-quote">${esc(T.mostReadSub)}</div>
            ${rows}
        </div>`;
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
        let html = renderMostRead(marks, idx);
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
                // Entradas antigas não têm `count` — valem 1 (foram lidas uma
                // vez); nenhuma migração de localStorage é necessária.
                const times = Math.max(1, m.count || 1);
                rows += `
                <div class="read-item">
                    <svg class="read-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg>
                    <a class="read-item-title" href="${href}">${esc(itemTitle(m, entry))}</a>
                    <span class="read-item-meta">
                        ${times > 1 ? `<span class="read-item-times">${T.times(times)}</span>` : ''}
                        ${dateStr ? `<span class="read-item-date">${T.readOn(dateStr)}</span>` : ''}
                        <a class="notebook-btn" href="${href}">${T.reread}</a>
                        <button type="button" class="notebook-btn minus" title="${esc(T.unmark)}" aria-label="${esc(T.unmark)}" data-vol="${esc(m.vol)}" data-file="${esc(m.file)}" data-topic="${m.topic || 0}">−</button>
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

        // "−" tira UMA leitura, não o Ensinamento inteiro: agora que a
        // contagem existe, apagar tudo de uma vez seria perder o registro de
        // quem releu várias vezes por causa de um toque errado. Só some da
        // lista quando cai a zero — e aí pergunta antes.
        container.querySelectorAll('.notebook-btn.minus').forEach(btn => {
            btn.addEventListener('click', () => {
                const { vol, file } = btn.dataset;
                const topic = parseInt(btn.dataset.topic, 10) || 0;
                const marks2 = loadLocal();
                const at = marks2.findIndex(m => m.vol === vol && m.file === file && (m.topic || 0) === topic);
                if (at < 0) return;

                const left = Math.max(1, marks2[at].count || 1) - 1;
                if (left <= 0) {
                    if (!confirm(T.unmarkConfirm)) return;
                    marks2.splice(at, 1);
                } else {
                    marks2[at].count = left;
                }
                try { localStorage.setItem('readMarks', JSON.stringify(marks2)); } catch (e) { }

                // undoReading (RPC) decrementa e apaga a linha sozinho ao
                // chegar em zero — mesmo caminho do "− Tirar uma leitura" do
                // leitor, então os dois lugares nunca divergem.
                if (window._cloudSync && window._cloudSync.undoReading) {
                    Promise.resolve(window._cloudSync.undoReading(vol, file, topic))
                        .catch(e => console.warn('[lidos] cloud undo failed:', e));
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
            const byKey = new Map(local.map(m => [`${m.vol}:${m.file}:${m.topic || 0}`, m]));
            let added = 0;
            for (const c of cloud) {
                const key = `${c.volume}:${c.file}:${c.topic_index}`;
                const cloudCount = Math.max(1, c.times_read || 1);
                const cloudTime = new Date(c.last_read_at || c.created_at).getTime();
                const existing = byKey.get(key);
                if (!existing) {
                    local.push({
                        vol: c.volume, file: c.file, topic: c.topic_index,
                        topicTitle: c.topic_title || '',
                        count: cloudCount,
                        time: cloudTime
                    });
                    added++;
                } else if (cloudCount > Math.max(1, existing.count || 1)) {
                    // A nuvem é a soma de todos os aparelhos: quando ela está
                    // à frente, o cache local estava desatualizado.
                    existing.count = cloudCount;
                    if (cloudTime > (existing.time || 0)) existing.time = cloudTime;
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
