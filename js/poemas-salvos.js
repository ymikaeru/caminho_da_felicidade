// ============================================================
// Poemas Salvos — Central separada dos destaques
// Lê os mesmos user_highlights com vol='poetry', agrupa por
// coletânea, e gera link de volta pra yama-to-mizu / warai-no-izumi
// com scroll e flash no card.
// ============================================================

const COLLECTIONS = {
  'akimaro-kineishu': {
    titlePt: "Akemaro Kin'eishū",
    titleJa: '明麿近詠集',
    subtitlePt: 'Poemas recentes',
    subtitleJa: '近詠',
    page: 'akimaro-kineishu.html',
  },
  'yama-to-mizu': {
    titlePt: 'Yama to Mizu',
    titleJa: '山と水',
    subtitlePt: 'Tanka clássicos',
    subtitleJa: '短歌',
    page: 'yama-to-mizu.html',
  },
  'warai-no-izumi': {
    titlePt: 'Warai no Izumi',
    titleJa: '笑の泉',
    subtitlePt: 'Versos humorísticos',
    subtitleJa: '寒句',
    page: 'warai-no-izumi.html',
  },
};

function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function _truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function _loadPoetryHighlights() {
  let raw = [];
  if (typeof window._HighlightsApi !== 'undefined') {
    raw = window._HighlightsApi.getAll();
  } else {
    try { raw = JSON.parse(localStorage.getItem('userHighlights') || '[]'); } catch (e) { }
  }
  return raw.filter(h => h.vol === 'poetry');
}

function _lang() {
  return localStorage.getItem('site_lang') || 'pt';
}

function _articleUrl(h, lang) {
  const coll = COLLECTIONS[h.file];
  if (!coll) return '#';
  let url = `${coll.page}?poem=${encodeURIComponent(h.topicId || '')}&hl_scroll=1`;
  if (lang === 'ja') url += '&lang=ja';
  return url;
}

function renderPoemasSalvos() {
  const container = document.getElementById('poems-container');
  const lang = _lang();
  const dataList = _loadPoetryHighlights();

  const emptyMsg = lang === 'ja'
    ? '保存した詩はまだありません。詩集のページで栞のアイコンをクリックして保存します。'
    : 'Nenhum poema salvo ainda. Nas páginas das coletâneas, clique no ícone de marcador (bookmark) para guardar um poema aqui.';

  if (!dataList.length) {
    container.innerHTML = `<div class="poems-empty">${emptyMsg}</div>`;
    return;
  }

  // Agrupa por coletânea, ordena dentro do grupo por topicIndex (número do poema).
  const grouped = new Map();
  dataList.forEach(h => {
    if (!grouped.has(h.file)) grouped.set(h.file, []);
    grouped.get(h.file).push(h);
  });
  grouped.forEach(arr => arr.sort((a, b) => (a.topicIndex || 0) - (b.topicIndex || 0)));

  // Ordena os grupos: yama primeiro, warai depois, outros no fim.
  const order = ['yama-to-mizu', 'warai-no-izumi'];
  const groupKeys = Array.from(grouped.keys()).sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  let html = '';
  for (const file of groupKeys) {
    const coll = COLLECTIONS[file] || { titlePt: file, titleJa: file, subtitlePt: '', subtitleJa: '' };
    const items = grouped.get(file);
    html += `
      <section class="poems-group">
        <header class="poems-group__head">
          <div class="poems-group__title-wrap">
            <h2 class="poems-group__title">
              <span class="lang-pt">${_esc(coll.titlePt)}</span>
              <span class="lang-ja" style="display:none">${_esc(coll.titleJa)}</span>
            </h2>
            <div class="poems-group__subtitle">
              <span class="lang-pt">${_esc(coll.subtitlePt)} · ${items.length} salvos</span>
              <span class="lang-ja" style="display:none">${_esc(coll.subtitleJa)} · ${items.length} 首</span>
            </div>
          </div>
          ${coll.page ? `<a href="${coll.page}" class="poems-group__open">
            <span class="lang-pt">Abrir coletânea</span>
            <span class="lang-ja" style="display:none">全集を見る</span>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2"/><polyline points="12 5 19 12 12 19" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          </a>` : ''}
        </header>
        <div class="poems-list">
          ${items.map(h => _renderItem(h, lang)).join('')}
        </div>
      </section>
    `;
  }

  container.innerHTML = html;

  container.querySelectorAll('.poems-item__remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const confirmMsg = lang === 'ja'
        ? 'この詩を保存リストから削除しますか？'
        : 'Remover este poema da lista de salvos?';
      if (!confirm(confirmMsg)) return;
      const h = _loadPoetryHighlights().find(x => x.id === id);
      if (!h) return;
      try {
        // Reaproveita o cloud remove do mesmo schema user_highlights.
        if (window._cloudSync) {
          await window._cloudSync.removeHighlight(h.vol, h.file, h.topicId, h.startChar || 0, h.endChar || 0);
        }
        // Atualiza localStorage diretamente (não usamos a API de destaques
        // pra evitar acoplamento com a UI de ensinamento).
        let all = [];
        try { all = JSON.parse(localStorage.getItem('userHighlights') || '[]'); } catch (e) { }
        const filtered = all.filter(x => x.id !== id);
        localStorage.setItem('userHighlights', JSON.stringify(filtered));
        // Tombstone (mesmo padrão de poetry-highlights.js _addTombstone)
        try {
          const t = JSON.parse(localStorage.getItem('highlightDeletedKeys') || '[]');
          t.push(`${h.vol}:${h.file}:${h.topicId}:${h.startChar || 0}:${h.endChar || 0}`);
          if (t.length > 2000) t.splice(0, t.length - 2000);
          localStorage.setItem('highlightDeletedKeys', JSON.stringify(t));
        } catch (e) { }
        renderPoemasSalvos();
      } catch (err) {
        console.warn('[poemas-salvos] remove failed:', err);
        alert(lang === 'ja' ? '削除に失敗しました。' : 'Falha ao remover.');
      }
    });
  });
}

function _renderItem(h, lang) {
  const url = _articleUrl(h, lang);
  const text = h.text || '';
  // O texto vem salvo como "original\ntranslation". Mostramos ambos com
  // tipografia distinta.
  const parts = text.split(/\n+/);
  const original = parts[0] || '';
  const translation = parts.slice(1).join(' ').trim();
  const date = new Date(h.createdAt || h.updatedAt || Date.now()).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR');
  const num = h.topicIndex != null
    ? `№ ${String(h.topicIndex).padStart(h.file === 'warai-no-izumi' ? 4 : 3, '0')}`
    : '';
  const titlePieces = [num, h.topicTitle].filter(Boolean);
  const removeLabel = lang === 'ja' ? '削除' : 'Remover';
  const openLabel = lang === 'ja' ? '開く' : 'Abrir';

  return `
    <article class="poems-item">
      <div class="poems-item__head">
        <span class="poems-item__num">${_esc(titlePieces.join(' · ') || '—')}</span>
        <span class="poems-item__date">${_esc(date)}</span>
      </div>
      ${original ? `<div class="poems-item__original">${_esc(original)}</div>` : ''}
      ${translation ? `<div class="poems-item__translation">${_esc(translation)}</div>` : ''}
      <div class="poems-item__actions">
        <a href="${url}" class="poems-item__open">${openLabel} →</a>
        <button type="button" class="poems-item__remove" data-id="${_esc(h.id)}">${removeLabel}</button>
      </div>
    </article>
  `;
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1ª pintura sai do cache local; em paralelo reconcilia com a NUVEM
  // (fonte da verdade — mesmo padrão cloud-first da Central) e
  // re-renderiza. O antigo setTimeout de 1,2s era um chute pra esperar o
  // pull do login; a hidratação explícita não depende de sorte.
  renderPoemasSalvos();
  if (window._HighlightsApi && window._HighlightsApi.hydrateAllFromCloud) {
    try {
      await window._HighlightsApi.hydrateAllFromCloud();
      renderPoemasSalvos();
    } catch (e) { /* offline → fica o cache */ }
  } else {
    setTimeout(renderPoemasSalvos, 1200);
  }
});
