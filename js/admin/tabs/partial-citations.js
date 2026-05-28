// ============================================================
// Citações Parciais — aba do admin pra mapear manualmente os 222
// tópicos com "(Citação parcial)" / "（一部のみ引用）" que NÃO foram
// auto-mapeados pelo build script (sem match exato por title_jp + date).
//
// Fluxo:
//   1. Carrega lista de unmatched de data/partial_citations_index.json
//      (gerado por scripts/build_partial_citations_index.mjs)
//   2. Carrega mapeamentos manuais existentes de
//      teachings/data/manual_citation_links.json (Supabase Storage)
//   3. Admin escolhe um partial, cola URL do reader (ou vol+file+topic),
//      salva localmente como rascunho.
//   4. "💾 Publicar" sobe o JSON inteiro pro Storage.
//
// Schema do manual_citation_links.json:
//   {
//     "generated_at": "...",
//     "links": {
//       "mioshiec1/Skankei.html#17": {
//         "vol": "mioshiec3", "file": "puraguma.html", "topic_idx": 0,
//         "added_at": "2026-05-29T...", "added_by": "user@cmu.org.br"
//       }
//     }
//   }
// ============================================================
import { _escHtml } from '../shared/helpers.js';
import { supabase } from '../../supabase-config.js';

const BUCKET = 'teachings';
const STORAGE_PATH = 'data/manual_citation_links.json';
const LOCAL_FALLBACK = 'data/manual_citation_links.json';
const INDEX_PATH = 'data/partial_citations_index.json';
const LS_KEY = 'partial_citations_pending_v1';
const PAGE_SIZE = 25;

let _unmatched = [];           // do partial_citations_index.json
let _manualLinks = {};         // do manual_citation_links.json (Storage)
let _pendingEdits = {};        // edits locais não publicadas
let _editPage = 0;
let _filterText = '';
let _filterVol = 'all';
let _filterStatus = 'unmapped'; // 'unmapped' | 'mapped' — sub-aba ativa
let _publishing = false;
let _myEmail = '';

// ─── Helpers ─────────────────────────────────────────────────
function _key(it) {
  return `${it.vol}/${it.file}#${it.topic_idx}`;
}

function _loadPendingEdits() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _pendingEdits = JSON.parse(raw) || {};
  } catch (e) { _pendingEdits = {}; }
}
function _savePendingEdits() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_pendingEdits)); } catch (e) {}
}
function _clearPendingEdits() {
  _pendingEdits = {};
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
}

// Estado efetivo = manual published + pending edits
function _effectiveLink(key) {
  if (_pendingEdits[key] === null) return null; // explicit removal
  if (_pendingEdits[key]) return _pendingEdits[key];
  return _manualLinks[key] || null;
}

function _hasPendingFor(key) {
  return Object.prototype.hasOwnProperty.call(_pendingEdits, key);
}

// Parse "reader.html?vol=X&file=Y&topic=N" (com ou sem origem absoluta).
// topic é 0-based (mesmo do reader).
function _parseReaderUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = trimmed.includes('://') ? new URL(trimmed) : new URL('http://x/' + trimmed.replace(/^\/+/, ''));
    const vol = u.searchParams.get('vol');
    const file = u.searchParams.get('file');
    const topic = u.searchParams.get('topic');
    if (!vol || !file) return null;
    return {
      vol,
      file,
      topic_idx: topic !== null ? parseInt(topic, 10) : 0,
    };
  } catch (_) {
    return null;
  }
}

// Parse atalho: vol + filename + title_idx (1-based como no JSON).
// Devolve no formato {vol, file, topic_idx} (topic_idx convertido pra 0-based).
function _parseQuickInput(vol, file, titleIdx) {
  if (!vol || !file || !titleIdx) return null;
  const fileTrim = String(file).trim().replace(/\.json$/, '');
  const n = parseInt(titleIdx, 10);
  if (!fileTrim || isNaN(n) || n < 1) return null;
  return { vol, file: fileTrim, topic_idx: n - 1 };
}

// ─── Target preview (fetch + cache) ─────────────────────────
const _targetFileCache = new Map(); // vol/file → parsed JSON
const _previewDebounce = new Map(); // safeId → timer

async function _fetchTargetTopic(vol, file) {
  const cacheKey = `${vol}/${file}`;
  if (_targetFileCache.has(cacheKey)) return _targetFileCache.get(cacheKey);
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(`${vol}/${file}.json`);
    if (error) return null;
    const json = JSON.parse(await data.text());
    _targetFileCache.set(cacheKey, json);
    return json;
  } catch (_) {
    return null;
  }
}

function _topicAtIdx(json, topicIdx) {
  if (!json || !json.themes) return null;
  let i = 0;
  for (const theme of json.themes) {
    for (const t of theme.topics || []) {
      if (i === topicIdx) return t;
      i++;
    }
  }
  return null;
}

function _stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function _renderTargetPreview(safeId, parsed) {
  const el = document.getElementById(`pc-tgtpreview-${safeId}`);
  if (!el) return;
  if (!parsed) { el.innerHTML = ''; return; }
  el.innerHTML = `<div style="margin-top:10px; padding:8px 12px; font-size:0.82rem; color:var(--text-muted);">⏳ Carregando preview do tópico alvo…</div>`;
  const json = await _fetchTargetTopic(parsed.vol, parsed.file);
  if (!json) {
    el.innerHTML = `<div style="margin-top:10px; padding:8px 12px; background:#fef2f2; border-left:3px solid #ef4444; border-radius:0 4px 4px 0; font-size:0.82rem; color:#991b1b;">⚠ Arquivo não encontrado no Storage: ${_escHtml(parsed.vol)}/${_escHtml(parsed.file)}</div>`;
    return;
  }
  const totalTopics = (json.themes || []).reduce((acc, th) => acc + (th.topics || []).length, 0);
  const topic = _topicAtIdx(json, parsed.topic_idx);
  if (!topic) {
    el.innerHTML = `<div style="margin-top:10px; padding:8px 12px; background:#fef2f2; border-left:3px solid #ef4444; border-radius:0 4px 4px 0; font-size:0.82rem; color:#991b1b;">⚠ Tópico #${parsed.topic_idx} não existe no arquivo (tem só ${totalTopics} tópicos, range 0..${totalTopics - 1}).</div>`;
    return;
  }
  const titleJa = _stripHtml(topic.title || '');
  const titlePt = _stripHtml(topic.title_ptbr || topic.title_pt || '');
  const date = topic.date || '';
  const contentPt = _stripHtml(topic.content_ptbr || topic.content_pt || '').slice(0, 320);
  const contentJa = _stripHtml(topic.content || '').slice(0, 200);
  // Marca (Citação parcial) / (一部のみ引用) se aparecer
  function highlightCit(s) {
    return _escHtml(s).replace(/(一部のみ引用|Citação parcial)/g, '<mark style="background:#fef3c7; padding:1px 3px; border-radius:3px;">$1</mark>');
  }
  const isPartialTarget = /一部のみ引用|Citação parcial/.test(topic.content + topic.content_ptbr);
  const warnPartial = isPartialTarget
    ? `<div style="margin-top:6px; padding:6px 10px; background:#fef3c7; border-radius:4px; font-size:0.78rem; color:#92400e;">⚠ Atenção: este tópico TAMBÉM é uma citação parcial. Você pode estar mapeando partial → partial em vez de partial → completo.</div>`
    : '';
  el.innerHTML = `
    <div style="margin-top:10px; padding:10px 12px; background:#ecfdf5; border-left:3px solid #10b981; border-radius:0 4px 4px 0; font-size:0.83rem; line-height:1.55;">
      <div style="font-weight:600; margin-bottom:6px; color:#065f46;">📖 Preview do tópico alvo · #${parsed.topic_idx} (de ${totalTopics} tópicos)</div>
      ${titleJa ? `<div style="font-family:'Noto Serif JP',serif; font-size:0.98rem;">${_escHtml(titleJa)}</div>` : ''}
      ${titlePt ? `<div style="color:var(--text-muted); font-size:0.82rem;">${_escHtml(titlePt)}</div>` : ''}
      ${date ? `<div style="color:var(--text-muted); font-size:0.78rem; margin-top:2px;">${_escHtml(date)}</div>` : ''}
      ${contentPt ? `<div style="margin-top:6px; color:var(--text-main);">${highlightCit(contentPt)}${contentPt.length >= 320 ? '…' : ''}</div>` : ''}
      ${!contentPt && contentJa ? `<div style="margin-top:6px; color:var(--text-main); font-family:'Noto Serif JP',serif;">${highlightCit(contentJa)}${contentJa.length >= 200 ? '…' : ''}</div>` : ''}
      ${warnPartial}
    </div>
  `;
}

function _schedulePreview(safeId, parsed) {
  if (_previewDebounce.has(safeId)) clearTimeout(_previewDebounce.get(safeId));
  if (!parsed) { _renderTargetPreview(safeId, null); return; }
  const timer = setTimeout(() => _renderTargetPreview(safeId, parsed), 300);
  _previewDebounce.set(safeId, timer);
}

// ─── Modal de comparação (singleton) ────────────────────────
function _ensureCompareModal() {
  let modal = document.getElementById('pc-compare-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'pc-compare-modal';
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:10000; display:none; align-items:center; justify-content:center; padding:24px;';
  modal.innerHTML = `
    <div style="background:var(--bg-card); border-radius:10px; width:100%; max-width:1500px; height:90vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.4); overflow:hidden;">
      <div style="padding:16px 24px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
        <h3 style="margin:0; font-size:1.05rem;">🔍 Comparar citação parcial vs. ensinamento completo</h3>
        <button id="pc-cmp-close" class="btn-zen" style="font-size:0.85rem;">✕ Fechar</button>
      </div>
      <div id="pc-cmp-body" style="flex:1; overflow:hidden; display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--border);">
        <div id="pc-cmp-src" style="background:var(--bg-card); padding:18px 22px; overflow-y:auto;"></div>
        <div id="pc-cmp-tgt" style="background:var(--bg-card); padding:18px 22px; overflow-y:auto;"></div>
      </div>
      <div style="padding:14px 24px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-shrink:0; gap:12px;">
        <div id="pc-cmp-status" style="font-size:0.82rem; color:var(--text-muted);"></div>
        <div style="display:flex; gap:8px;">
          <button id="pc-cmp-cancel" class="btn-zen" style="font-size:0.85rem;">Cancelar</button>
          <button id="pc-cmp-confirm" class="btn-zen" style="font-size:0.85rem; background:var(--accent-strong); color:white;">✓ Confirmar mapeamento</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) _closeCompareModal(); });
  document.getElementById('pc-cmp-close').addEventListener('click', _closeCompareModal);
  document.getElementById('pc-cmp-cancel').addEventListener('click', _closeCompareModal);
  return modal;
}

let _compareCtx = null; // { sourceKey, sourceItem, targetParsed }

function _closeCompareModal() {
  const modal = document.getElementById('pc-compare-modal');
  if (modal) modal.style.display = 'none';
  _compareCtx = null;
}

function _highlightCit(s) {
  return _escHtml(s).replace(/(一部のみ引用|Citação parcial)/g, '<mark style="background:#fef3c7; padding:1px 3px; border-radius:3px;">$1</mark>');
}

function _renderCompareSide(el, label, color, vol, file, topicIdx, topic, totalTopics) {
  if (!topic) {
    el.innerHTML = `<div style="color:#991b1b;">Tópico não encontrado.</div>`;
    return;
  }
  const titleJa = _stripHtml(topic.title || '');
  const titlePt = _stripHtml(topic.title_ptbr || topic.title_pt || '');
  const date = topic.date || '';
  // Conteúdo completo (não trunca — modal tem scroll)
  const contentPt = _stripHtml(topic.content_ptbr || topic.content_pt || '');
  const contentJa = _stripHtml(topic.content || '');
  el.innerHTML = `
    <div style="font-size:0.78rem; color:${color}; font-weight:600; letter-spacing:0.5px; text-transform:uppercase; margin-bottom:6px;">${label}</div>
    <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:10px; font-family:monospace;">${_escHtml(vol)}/${_escHtml(file)} <span style="background:var(--bg-soft); padding:1px 6px; border-radius:3px;">#${topicIdx}</span> · ${topicIdx + 1} de ${totalTopics}</div>
    ${titleJa ? `<div style="font-family:'Noto Serif JP',serif; font-size:1.08rem; line-height:1.4; margin-bottom:4px;">${_escHtml(titleJa)}</div>` : ''}
    ${titlePt ? `<div style="font-size:0.92rem; color:var(--text-muted); margin-bottom:4px;">${_escHtml(titlePt)}</div>` : ''}
    ${date ? `<div style="font-size:0.82rem; color:var(--text-muted); margin-bottom:14px;">${_escHtml(date)}</div>` : ''}
    ${contentPt ? `<div style="font-size:0.92rem; line-height:1.7; margin-bottom:14px;">${_highlightCit(contentPt)}</div>` : ''}
    ${contentJa ? `<details style="margin-top:10px;"><summary style="cursor:pointer; font-size:0.82rem; color:var(--text-muted);">Ver original em japonês</summary><div style="font-family:'Noto Serif JP',serif; font-size:0.95rem; line-height:1.7; margin-top:8px;">${_highlightCit(contentJa)}</div></details>` : ''}
  `;
}

async function _openCompareModal(sourceItem, targetParsed) {
  const modal = _ensureCompareModal();
  modal.style.display = 'flex';
  const srcEl = document.getElementById('pc-cmp-src');
  const tgtEl = document.getElementById('pc-cmp-tgt');
  const statusEl = document.getElementById('pc-cmp-status');
  const confirmBtn = document.getElementById('pc-cmp-confirm');

  srcEl.innerHTML = '<div style="color:var(--text-muted);">⏳ Carregando…</div>';
  tgtEl.innerHTML = '<div style="color:var(--text-muted);">⏳ Carregando…</div>';
  statusEl.textContent = `Mapeando ${sourceItem.vol}/${sourceItem.file}#${sourceItem.topic_idx} → ${targetParsed.vol}/${targetParsed.file}#${targetParsed.topic_idx}`;
  confirmBtn.disabled = true;
  confirmBtn.style.opacity = 0.5;

  _compareCtx = { sourceItem, targetParsed };

  const [srcJson, tgtJson] = await Promise.all([
    _fetchTargetTopic(sourceItem.vol, sourceItem.file),
    _fetchTargetTopic(targetParsed.vol, targetParsed.file),
  ]);

  const srcTotal = srcJson ? (srcJson.themes || []).reduce((a, th) => a + (th.topics || []).length, 0) : 0;
  const tgtTotal = tgtJson ? (tgtJson.themes || []).reduce((a, th) => a + (th.topics || []).length, 0) : 0;
  const srcTopic = _topicAtIdx(srcJson, sourceItem.topic_idx);
  const tgtTopic = _topicAtIdx(tgtJson, targetParsed.topic_idx);

  _renderCompareSide(srcEl, '📌 Citação parcial (origem)', '#92400e', sourceItem.vol, sourceItem.file, sourceItem.topic_idx, srcTopic, srcTotal);
  _renderCompareSide(tgtEl, '📖 Ensinamento completo (alvo)', '#065f46', targetParsed.vol, targetParsed.file, targetParsed.topic_idx, tgtTopic, tgtTotal);

  if (srcTopic && tgtTopic) {
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = 1;
    confirmBtn.onclick = () => {
      const key = _key(sourceItem);
      _pendingEdits[key] = {
        ...targetParsed,
        added_at: new Date().toISOString(),
        added_by: _myEmail || 'unknown',
      };
      _savePendingEdits();
      _closeCompareModal();
      _renderShell();
      _renderList();
    };
  } else {
    statusEl.innerHTML = `<span style="color:#991b1b;">Não foi possível carregar ${!srcTopic ? 'origem' : 'alvo'}.</span>`;
  }
}

// ─── Storage I/O ────────────────────────────────────────────
async function _loadIndex() {
  // 1) tenta Storage (deploy ativo)
  const { data, error } = await supabase.storage.from(BUCKET).download(INDEX_PATH);
  if (!error) {
    const txt = await data.text();
    return JSON.parse(txt);
  }
  // 2) fallback local
  const res = await fetch(LOCAL_FALLBACK.replace('manual_citation_links', 'partial_citations_index'));
  if (!res.ok) throw new Error('Não foi possível carregar o índice');
  return await res.json();
}

async function _loadManual() {
  const { data, error } = await supabase.storage.from(BUCKET).download(STORAGE_PATH);
  if (!error) {
    const txt = await data.text();
    return JSON.parse(txt);
  }
  const status = error.statusCode || error.status || error.originalError?.status;
  const msg = error.message || '';
  const isNotFound = status === 404 || String(status) === '404' || /not.?found|object.*not.*exist/i.test(msg);
  if (isNotFound) {
    // Primeiro uso — começa vazio
    return { generated_at: new Date().toISOString(), links: {} };
  }
  // Tenta fallback local
  const res = await fetch(LOCAL_FALLBACK);
  if (res.ok) return await res.json();
  throw new Error(`Storage falhou (${status || 'erro'}): ${msg}`);
}

async function _uploadManual(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const { error } = await supabase.storage.from(BUCKET).upload(STORAGE_PATH, blob, {
    upsert: true,
    contentType: 'application/json',
    cacheControl: '0',
  });
  if (error) throw new Error(`Upload falhou: ${error.message}`);
}

// ─── Renderers ──────────────────────────────────────────────
function _filteredItems() {
  let arr = _unmatched.slice();
  if (_filterVol !== 'all') arr = arr.filter((i) => i.vol === _filterVol);
  // Sub-aba ativa filtra mapeados vs pendentes
  if (_filterStatus === 'mapped') arr = arr.filter((i) => _effectiveLink(_key(i)));
  else arr = arr.filter((i) => !_effectiveLink(_key(i))); // 'unmapped' default
  if (_filterText) {
    const q = _filterText.toLowerCase();
    arr = arr.filter((i) => {
      const hay = `${i.title_jp || ''} ${i.title_pt || ''} ${i.date || ''} ${i.file || ''} ${i.content_preview || ''} ${i.content_preview_ja || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }
  return arr;
}

// Conta itens por status (ignorando filtros de vol/texto)
function _statusCounts() {
  let mapped = 0, unmapped = 0;
  for (const it of _unmatched) {
    if (_effectiveLink(_key(it))) mapped++;
    else unmapped++;
  }
  return { mapped, unmapped };
}

function _renderShell() {
  const cnt = document.getElementById('pc-container');
  if (!cnt) return;
  const { mapped: mappedCount, unmapped: unmappedCount } = _statusCounts();
  const pendingCount = Object.keys(_pendingEdits).length;

  const subTabBtn = (status, label, count, color) => `
    <button class="pc-subtab" data-status="${status}"
            style="
              padding:10px 18px;
              border:none;
              border-bottom:3px solid ${_filterStatus === status ? color : 'transparent'};
              background:none;
              color:${_filterStatus === status ? 'var(--text-main)' : 'var(--text-muted)'};
              font-weight:${_filterStatus === status ? '600' : '400'};
              font-size:0.95rem;
              cursor:pointer;
              margin-bottom:-1px;
              display:flex;
              align-items:center;
              gap:8px;
            ">
      ${label}
      <span style="
        font-size:0.78rem;
        background:${_filterStatus === status ? color : 'var(--bg-soft)'};
        color:${_filterStatus === status ? 'white' : 'var(--text-muted)'};
        padding:2px 8px;
        border-radius:10px;
        font-weight:600;
      ">${count}</span>
    </button>
  `;

  cnt.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:14px;">
      <div>
        <h3 style="margin:0 0 4px;">Citações Parciais — mapeamento manual</h3>
        <div style="font-size:0.84rem; color:var(--text-muted);">
          ${_unmatched.length} citações sem match automático
          ${pendingCount > 0 ? `· <span style="color:#d97706;">${pendingCount} pendente${pendingCount === 1 ? '' : 's'} de publicação</span>` : ''}
        </div>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="pc-discard" class="btn-zen" style="${pendingCount > 0 ? '' : 'opacity:.4; pointer-events:none;'}">
          Descartar edições
        </button>
        <button id="pc-publish" class="btn-zen" style="background:${pendingCount > 0 ? 'var(--accent-strong)' : 'var(--bg-soft)'}; color:${pendingCount > 0 ? 'white' : 'var(--text-muted)'};">
          💾 Publicar ${pendingCount > 0 ? `(${pendingCount})` : ''}
        </button>
      </div>
    </div>

    <!-- Sub-abas: Pendentes vs Mapeados -->
    <div style="display:flex; gap:0; border-bottom:1px solid var(--border); margin-bottom:14px;">
      ${subTabBtn('unmapped', 'Pendentes', unmappedCount, '#d97706')}
      ${subTabBtn('mapped',   'Mapeados',  mappedCount,  '#10b981')}
    </div>

    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; align-items:center;">
      <input id="pc-search" type="text" placeholder="Filtrar por título, data, arquivo..."
             value="${_escHtml(_filterText)}"
             style="flex:1; min-width:240px; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-soft); color:var(--text-main); font-size:0.9rem;">
      <select id="pc-vol" style="padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-soft); color:var(--text-main); font-size:0.9rem;">
        <option value="all" ${_filterVol === 'all' ? 'selected' : ''}>Todos os volumes</option>
        <option value="mioshiec1" ${_filterVol === 'mioshiec1' ? 'selected' : ''}>Vol 1</option>
        <option value="mioshiec2" ${_filterVol === 'mioshiec2' ? 'selected' : ''}>Vol 2</option>
        <option value="mioshiec3" ${_filterVol === 'mioshiec3' ? 'selected' : ''}>Vol 3</option>
        <option value="mioshiec4" ${_filterVol === 'mioshiec4' ? 'selected' : ''}>Vol 4</option>
      </select>
    </div>

    <div id="pc-list"></div>
    <div id="pc-pagination" style="display:flex; justify-content:center; gap:8px; margin-top:18px;"></div>
  `;

  cnt.querySelectorAll('.pc-subtab').forEach((btn) => {
    btn.addEventListener('click', () => {
      _filterStatus = btn.dataset.status;
      _editPage = 0;
      _renderShell();
      _renderList();
    });
  });
  document.getElementById('pc-search').addEventListener('input', (e) => {
    _filterText = e.target.value;
    _editPage = 0;
    _renderList();
  });
  document.getElementById('pc-vol').addEventListener('change', (e) => {
    _filterVol = e.target.value;
    _editPage = 0;
    _renderList();
  });
  document.getElementById('pc-discard').addEventListener('click', () => {
    if (!Object.keys(_pendingEdits).length) return;
    if (!confirm('Descartar TODAS as edições pendentes? Os mapeamentos publicados continuam.')) return;
    _clearPendingEdits();
    _renderShell();
    _renderList();
  });
  document.getElementById('pc-publish').addEventListener('click', _publish);
}

function _renderList() {
  const items = _filteredItems();
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  _editPage = Math.min(_editPage, totalPages - 1);
  const start = _editPage * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  const list = document.getElementById('pc-list');
  if (!list) return;

  if (items.length === 0) {
    list.innerHTML = `<div style="padding:32px; text-align:center; color:var(--text-muted);">Nenhuma citação encontrada com os filtros atuais.</div>`;
    document.getElementById('pc-pagination').innerHTML = '';
    return;
  }

  list.innerHTML = pageItems.map((it) => _renderRow(it)).join('');

  // Wire form actions
  for (const it of pageItems) {
    const key = _key(it);
    const safeId = key.replace(/[^a-zA-Z0-9]/g, '_');
    const form = document.getElementById(`pc-form-${safeId}`);
    if (!form) continue;
    const urlInput = form.querySelector(`#pc-url-${safeId}`);
    const saveBtn = form.querySelector(`#pc-save-${safeId}`);
    const clearBtn = form.querySelector(`#pc-clear-${safeId}`);
    const previewEl = form.querySelector(`#pc-preview-${safeId}`);

    const compareBtn = form.querySelector(`#pc-compare-${safeId}`);

    function updatePreview() {
      const parsed = _parseReaderUrl(urlInput.value);
      const enable = !!parsed;
      saveBtn.disabled = !enable;
      saveBtn.style.opacity = enable ? 1 : 0.5;
      compareBtn.disabled = !enable;
      compareBtn.style.opacity = enable ? 1 : 0.5;
      if (parsed) {
        previewEl.innerHTML = `<span style="color:var(--accent-strong);">✓ ${_escHtml(parsed.vol)} / ${_escHtml(parsed.file)} #${parsed.topic_idx}</span>`;
        _schedulePreview(safeId, parsed);
        compareBtn.onclick = () => _openCompareModal(it, parsed);
      } else if (urlInput.value.trim()) {
        previewEl.innerHTML = `<span style="color:#d97706;">⚠ Não foi possível parsear. Formato esperado: reader.html?vol=X&amp;file=Y&amp;topic=N</span>`;
        _schedulePreview(safeId, null);
      } else {
        previewEl.innerHTML = '';
        _schedulePreview(safeId, null);
      }
    }

    urlInput.addEventListener('input', updatePreview);
    updatePreview();

    saveBtn.addEventListener('click', () => {
      const parsed = _parseReaderUrl(urlInput.value);
      if (!parsed) return;
      _pendingEdits[key] = {
        ...parsed,
        added_at: new Date().toISOString(),
        added_by: _myEmail || 'unknown',
      };
      _savePendingEdits();
      _renderShell();
      _renderList();
    });

    // Atalho: vol + filename + title_idx (1-based)
    const qvolEl = form.querySelector(`#pc-qvol-${safeId}`);
    const qfileEl = form.querySelector(`#pc-qfile-${safeId}`);
    const qidxEl = form.querySelector(`#pc-qidx-${safeId}`);
    const qsaveBtn = form.querySelector(`#pc-qsave-${safeId}`);
    const qpreviewEl = form.querySelector(`#pc-qpreview-${safeId}`);

    const qcompareBtn = form.querySelector(`#pc-qcompare-${safeId}`);

    function updateQuickPreview() {
      const parsed = _parseQuickInput(qvolEl.value, qfileEl.value, qidxEl.value);
      const enable = !!parsed;
      qsaveBtn.disabled = !enable;
      qsaveBtn.style.opacity = enable ? 1 : 0.5;
      qcompareBtn.disabled = !enable;
      qcompareBtn.style.opacity = enable ? 1 : 0.5;
      if (parsed) {
        qpreviewEl.innerHTML = `<span style="color:var(--accent-strong);">✓ ${_escHtml(parsed.vol)} / ${_escHtml(parsed.file)} #${parsed.topic_idx} <span style="opacity:.6;">(title_idx ${qidxEl.value} → topic ${parsed.topic_idx})</span></span>`;
        _schedulePreview(safeId, parsed);
        qcompareBtn.onclick = () => _openCompareModal(it, parsed);
      } else if (qfileEl.value.trim() || qidxEl.value.trim()) {
        qpreviewEl.innerHTML = `<span style="color:#d97706;">⚠ Preencha filename e title_idx (≥1).</span>`;
        _schedulePreview(safeId, null);
      } else {
        qpreviewEl.innerHTML = '';
        _schedulePreview(safeId, null);
      }
    }
    qvolEl.addEventListener('change', updateQuickPreview);
    qfileEl.addEventListener('input', updateQuickPreview);
    qidxEl.addEventListener('input', updateQuickPreview);
    qsaveBtn.addEventListener('click', () => {
      const parsed = _parseQuickInput(qvolEl.value, qfileEl.value, qidxEl.value);
      if (!parsed) return;
      _pendingEdits[key] = {
        ...parsed,
        added_at: new Date().toISOString(),
        added_by: _myEmail || 'unknown',
      };
      _savePendingEdits();
      _renderShell();
      _renderList();
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!confirm('Remover o mapeamento manual desta citação?')) return;
        // Marca como remoção explícita (null no pending)
        if (_manualLinks[key]) {
          _pendingEdits[key] = null;
        } else {
          delete _pendingEdits[key];
        }
        _savePendingEdits();
        _renderShell();
        _renderList();
      });
    }
  }

  // Pagination
  const pag = document.getElementById('pc-pagination');
  if (totalPages > 1) {
    let pagHtml = '';
    const prev = Math.max(0, _editPage - 1);
    const next = Math.min(totalPages - 1, _editPage + 1);
    pagHtml += `<button class="btn-zen" ${_editPage === 0 ? 'disabled style="opacity:.4"' : ''} data-page="${prev}">← Anterior</button>`;
    pagHtml += `<span style="padding:8px 12px; color:var(--text-muted); font-size:0.85rem;">Página ${_editPage + 1} de ${totalPages} (${items.length} resultados)</span>`;
    pagHtml += `<button class="btn-zen" ${_editPage === totalPages - 1 ? 'disabled style="opacity:.4"' : ''} data-page="${next}">Próxima →</button>`;
    pag.innerHTML = pagHtml;
    pag.querySelectorAll('button[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        _editPage = parseInt(btn.dataset.page, 10);
        _renderList();
        document.getElementById('pc-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  } else {
    pag.innerHTML = `<span style="color:var(--text-muted); font-size:0.85rem;">${items.length} resultado${items.length === 1 ? '' : 's'}</span>`;
  }
}

function _renderRow(it) {
  const key = _key(it);
  const safeId = key.replace(/[^a-zA-Z0-9]/g, '_');
  const link = _effectiveLink(key);
  const isPending = _hasPendingFor(key);
  const isCleared = _pendingEdits[key] === null;

  let statusBadge = '';
  if (isCleared) {
    statusBadge = `<span style="font-size:0.72rem; padding:2px 8px; background:#fee2e2; color:#991b1b; border-radius:4px;">REMOVIDO (pendente)</span>`;
  } else if (link && isPending) {
    statusBadge = `<span style="font-size:0.72rem; padding:2px 8px; background:#fef3c7; color:#92400e; border-radius:4px;">PENDENTE</span>`;
  } else if (link) {
    statusBadge = `<span style="font-size:0.72rem; padding:2px 8px; background:#d1fae5; color:#065f46; border-radius:4px;">MAPEADO</span>`;
  } else {
    statusBadge = `<span style="font-size:0.72rem; padding:2px 8px; background:var(--bg-soft); color:var(--text-muted); border-radius:4px;">SEM LINK</span>`;
  }

  const currentLinkHtml = link
    ? `<div style="margin-top:8px; padding:8px 12px; background:var(--accent-soft); border-radius:6px; font-size:0.85rem;">
         <strong>↗ Atual:</strong>
         <a href="reader.html?vol=${_escHtml(link.vol)}&file=${_escHtml(link.file)}&topic=${link.topic_idx}" target="_blank" rel="noopener" style="color:var(--text-main); text-decoration:underline;">
           ${_escHtml(link.vol)}/${_escHtml(link.file)} #${link.topic_idx}
         </a>
         ${link.added_by ? `<span style="color:var(--text-muted); margin-left:8px;">por ${_escHtml(link.added_by)}</span>` : ''}
       </div>`
    : '';

  const sourceUrl = `reader.html?vol=${_escHtml(it.vol)}&file=${_escHtml(it.file)}&topic=${it.topic_idx}`;
  // Realça os marcadores 一部のみ引用 / (Citação parcial) no preview pra
  // o admin enxergar de cara qual trecho está sendo importado.
  function _highlightCitMarker(s) {
    const esc = _escHtml(s);
    return esc.replace(/(一部のみ引用|Citação parcial)/g, '<mark style="background:#fef3c7; padding:1px 3px; border-radius:3px;">$1</mark>');
  }

  return `
    <div style="border:1px solid var(--border); border-radius:8px; padding:14px 18px; margin-bottom:10px; background:var(--bg-card);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
        <div style="flex:1; min-width:0;">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            ${statusBadge}
            <span style="font-size:0.78rem; padding:2px 8px; background:var(--bg-soft); color:var(--text-main); border-radius:4px; font-family:monospace; font-weight:600;">
              #${it.topic_idx}
            </span>
            <a href="${sourceUrl}" target="_blank" rel="noopener" style="font-size:0.78rem; color:var(--text-muted); text-decoration:underline;">
              ${_escHtml(it.vol)}/${_escHtml(it.file)}
            </a>
            <span style="font-size:0.78rem; color:var(--text-muted);">·</span>
            <span style="font-size:0.78rem; color:var(--text-muted);">${_escHtml(it.date || '—')}</span>
            <a href="${sourceUrl}" target="_blank" rel="noopener" style="font-size:0.78rem; color:var(--accent-strong); text-decoration:underline; margin-left:auto; white-space:nowrap;">
              ↗ Abrir no reader
            </a>
          </div>
          <div style="font-family:'Noto Serif JP',serif; font-size:1.02rem; margin-top:6px; line-height:1.4;">
            ${_escHtml(it.title_jp || '(sem título JP)')}
          </div>
          ${it.title_pt ? `<div style="font-size:0.86rem; color:var(--text-muted); margin-top:2px;">${_escHtml(it.title_pt)}</div>` : ''}
          ${it.content_preview_ja || it.content_preview ? `
            <div style="margin-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--border); border-radius:0 4px 4px 0; border-left:3px solid var(--accent); overflow:hidden;">
              ${it.content_preview_ja ? `
                <div style="background:var(--bg-soft); padding:8px 12px;">
                  <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">日本語</div>
                  <div style="font-family:'Noto Serif JP', serif; font-size:0.86rem; line-height:1.55; color:var(--text-main);">${_highlightCitMarker(it.content_preview_ja)}${it.content_preview_ja.length >= 180 ? '…' : ''}</div>
                </div>
              ` : '<div style="background:var(--bg-soft);"></div>'}
              ${it.content_preview ? `
                <div style="background:var(--bg-soft); padding:8px 12px;">
                  <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Português</div>
                  <div style="font-size:0.84rem; line-height:1.55; color:var(--text-main);">${_highlightCitMarker(it.content_preview)}${it.content_preview.length >= 240 ? '…' : ''}</div>
                </div>
              ` : '<div style="background:var(--bg-soft);"></div>'}
            </div>
          ` : ''}
          ${currentLinkHtml}
        </div>
      </div>

      <div id="pc-form-${safeId}" style="margin-top:12px; padding-top:12px; border-top:1px dashed var(--border);">
        <label style="font-size:0.82rem; color:var(--text-muted); display:block; margin-bottom:4px;">
          URL do ensinamento completo no reader:
        </label>
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="text" id="pc-url-${safeId}"
                 placeholder="reader.html?vol=mioshiec3&file=puraguma.html&topic=0"
                 style="flex:1; padding:7px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg-soft); color:var(--text-main); font-size:0.85rem; font-family:monospace;">
          <button id="pc-compare-${safeId}" class="btn-zen" disabled style="opacity:.5; font-size:0.84rem;" title="Abrir modal de comparação side-by-side">🔍 Comparar</button>
          <button id="pc-save-${safeId}" class="btn-zen" disabled style="opacity:.5; font-size:0.84rem;">Salvar</button>
          ${link ? `<button id="pc-clear-${safeId}" class="btn-zen" style="font-size:0.84rem; color:#991b1b;">Remover</button>` : ''}
        </div>
        <div id="pc-preview-${safeId}" style="font-size:0.78rem; margin-top:6px; min-height:18px;"></div>

        <div style="font-size:0.74rem; color:var(--text-muted); margin:10px 0 4px; display:flex; align-items:center; gap:6px;">
          <span style="opacity:.5;">─ ou atalho do JSON ─</span>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <select id="pc-qvol-${safeId}" style="padding:6px 8px; border:1px solid var(--border); border-radius:6px; background:var(--bg-soft); color:var(--text-main); font-size:0.82rem;">
            <option value="mioshiec1" ${it.vol === 'mioshiec1' ? 'selected' : ''}>mioshiec1</option>
            <option value="mioshiec2" ${it.vol === 'mioshiec2' ? 'selected' : ''}>mioshiec2</option>
            <option value="mioshiec3" ${it.vol === 'mioshiec3' ? 'selected' : ''}>mioshiec3</option>
            <option value="mioshiec4" ${it.vol === 'mioshiec4' ? 'selected' : ''}>mioshiec4</option>
          </select>
          <input type="text" id="pc-qfile-${safeId}"
                 placeholder="filename.html"
                 style="flex:1; min-width:160px; padding:6px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg-soft); color:var(--text-main); font-size:0.82rem; font-family:monospace;">
          <label style="font-size:0.78rem; color:var(--text-muted);">title_idx:</label>
          <input type="number" id="pc-qidx-${safeId}" min="1" placeholder="2"
                 style="width:70px; padding:6px 8px; border:1px solid var(--border); border-radius:6px; background:var(--bg-soft); color:var(--text-main); font-size:0.82rem; font-family:monospace;">
          <button id="pc-qcompare-${safeId}" class="btn-zen" disabled style="opacity:.5; font-size:0.82rem;" title="Abrir modal de comparação side-by-side">🔍 Comparar</button>
          <button id="pc-qsave-${safeId}" class="btn-zen" disabled style="opacity:.5; font-size:0.82rem;">Salvar</button>
        </div>
        <div id="pc-qpreview-${safeId}" style="font-size:0.78rem; margin-top:6px; min-height:18px;"></div>
        <div style="font-size:0.74rem; color:var(--text-muted); margin-top:4px;">
          💡 <code>title_idx</code> é o valor do campo no JSON (1-based: o primeiro tópico é 1). Convertido automaticamente. Use o atalho quando estiver olhando o JSON no editor.
        </div>

        <!-- Preview do tópico alvo: carrega do Storage e mostra título+data+conteúdo -->
        <div id="pc-tgtpreview-${safeId}"></div>
      </div>
    </div>
  `;
}

// ─── Publish ────────────────────────────────────────────────
async function _publish() {
  if (_publishing) return;
  if (!Object.keys(_pendingEdits).length) {
    alert('Nada pra publicar.');
    return;
  }
  if (!confirm(`Publicar ${Object.keys(_pendingEdits).length} alteração(ões) no Storage?\n\nIsso atualiza data/manual_citation_links.json e fica visível no reader após próximo reload.`)) {
    return;
  }
  _publishing = true;
  const btn = document.getElementById('pc-publish');
  const origText = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '⏳ Publicando…'; btn.disabled = true; }

  try {
    // Aplica pending nos manualLinks
    const newLinks = { ...(_manualLinks || {}) };
    for (const [k, v] of Object.entries(_pendingEdits)) {
      if (v === null) {
        delete newLinks[k];
      } else {
        newLinks[k] = v;
      }
    }

    const payload = {
      generated_at: new Date().toISOString(),
      note: 'Mapeamentos manuais de citações parciais → ensinamento completo (interno). Editado via admin → aba "Citações Parciais".',
      links: newLinks,
    };

    await _uploadManual(payload);
    _manualLinks = newLinks;
    _clearPendingEdits();
    if (btn) { btn.innerHTML = '✓ Publicado'; setTimeout(() => { _renderShell(); _renderList(); }, 800); }
  } catch (e) {
    alert(`Erro ao publicar: ${e.message}`);
    if (btn) { btn.innerHTML = origText; btn.disabled = false; }
  } finally {
    _publishing = false;
  }
}

// ─── Entry point ───────────────────────────────────────────
async function loadPartialCitations() {
  // Pega email atual pra atribuição
  try {
    const { data: { user } } = await supabase.auth.getUser();
    _myEmail = user?.email || '';
  } catch (_) {}

  _loadPendingEdits();

  const cnt = document.getElementById('pc-container');
  if (cnt) cnt.innerHTML = '<div style="padding:32px; text-align:center; color:var(--text-muted);">Carregando…</div>';

  try {
    const [idx, manual] = await Promise.all([_loadIndex(), _loadManual()]);
    _unmatched = idx?.unmatched || [];
    _manualLinks = manual?.links || {};
  } catch (e) {
    if (cnt) cnt.innerHTML = `<div style="padding:32px; color:#ff3b30;">Falha ao carregar: ${_escHtml(e.message)}</div>`;
    return;
  }

  _renderShell();
  _renderList();
}

window.loadPartialCitations = loadPartialCitations;
