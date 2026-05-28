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
let _filterStatus = 'all';     // all | mapped | unmapped
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

// Parse "reader.html?vol=X&file=Y&topic=N" (com ou sem origem absoluta)
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
  if (_filterStatus === 'mapped') arr = arr.filter((i) => _effectiveLink(_key(i)));
  if (_filterStatus === 'unmapped') arr = arr.filter((i) => !_effectiveLink(_key(i)));
  if (_filterText) {
    const q = _filterText.toLowerCase();
    arr = arr.filter((i) => {
      const hay = `${i.title_jp || ''} ${i.title_pt || ''} ${i.date || ''} ${i.file || ''} ${i.content_preview || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }
  return arr;
}

function _renderShell() {
  const cnt = document.getElementById('pc-container');
  if (!cnt) return;
  const mappedCount = _unmatched.filter((i) => _effectiveLink(_key(i))).length;
  const pendingCount = Object.keys(_pendingEdits).length;

  cnt.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:18px;">
      <div>
        <h3 style="margin:0 0 4px;">Citações Parciais — mapeamento manual</h3>
        <div style="font-size:0.84rem; color:var(--text-muted);">
          ${_unmatched.length} citações sem match automático ·
          <strong style="color:var(--accent-strong);">${mappedCount} mapeadas</strong> ·
          ${pendingCount > 0 ? `<span style="color:#d97706;">${pendingCount} pendentes</span>` : 'tudo sincronizado'}
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
      <select id="pc-status" style="padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-soft); color:var(--text-main); font-size:0.9rem;">
        <option value="all" ${_filterStatus === 'all' ? 'selected' : ''}>Todos</option>
        <option value="unmapped" ${_filterStatus === 'unmapped' ? 'selected' : ''}>Sem mapeamento</option>
        <option value="mapped" ${_filterStatus === 'mapped' ? 'selected' : ''}>Já mapeados</option>
      </select>
    </div>

    <div id="pc-list"></div>
    <div id="pc-pagination" style="display:flex; justify-content:center; gap:8px; margin-top:18px;"></div>
  `;

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
  document.getElementById('pc-status').addEventListener('change', (e) => {
    _filterStatus = e.target.value;
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

    function updatePreview() {
      const parsed = _parseReaderUrl(urlInput.value);
      if (parsed) {
        previewEl.innerHTML = `<span style="color:var(--accent-strong);">✓ ${_escHtml(parsed.vol)} / ${_escHtml(parsed.file)} #${parsed.topic_idx}</span>`;
        saveBtn.disabled = false;
        saveBtn.style.opacity = 1;
      } else if (urlInput.value.trim()) {
        previewEl.innerHTML = `<span style="color:#d97706;">⚠ Não foi possível parsear. Formato esperado: reader.html?vol=X&amp;file=Y&amp;topic=N</span>`;
        saveBtn.disabled = true;
        saveBtn.style.opacity = 0.5;
      } else {
        previewEl.innerHTML = '';
        saveBtn.disabled = true;
        saveBtn.style.opacity = 0.5;
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

  return `
    <div style="border:1px solid var(--border); border-radius:8px; padding:14px 18px; margin-bottom:10px; background:var(--bg-card);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
        <div style="flex:1; min-width:0;">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            ${statusBadge}
            <a href="${sourceUrl}" target="_blank" rel="noopener" style="font-size:0.78rem; color:var(--text-muted); text-decoration:underline;">
              ${_escHtml(it.vol)}/${_escHtml(it.file)} #${it.topic_idx}
            </a>
            <span style="font-size:0.78rem; color:var(--text-muted);">·</span>
            <span style="font-size:0.78rem; color:var(--text-muted);">${_escHtml(it.date || '—')}</span>
          </div>
          <div style="font-family:'Noto Serif JP',serif; font-size:1.02rem; margin-top:6px; line-height:1.4;">
            ${_escHtml(it.title_jp || '(sem título JP)')}
          </div>
          ${it.title_pt ? `<div style="font-size:0.86rem; color:var(--text-muted); margin-top:2px;">${_escHtml(it.title_pt)}</div>` : ''}
          ${it.content_preview ? `<div style="font-size:0.82rem; color:var(--text-muted); margin-top:8px; font-style:italic; line-height:1.5;">${_escHtml(it.content_preview)}${it.content_preview.length >= 240 ? '…' : ''}</div>` : ''}
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
          <button id="pc-save-${safeId}" class="btn-zen" disabled style="opacity:.5; font-size:0.84rem;">Salvar</button>
          ${link ? `<button id="pc-clear-${safeId}" class="btn-zen" style="font-size:0.84rem; color:#991b1b;">Remover</button>` : ''}
        </div>
        <div id="pc-preview-${safeId}" style="font-size:0.78rem; margin-top:6px; min-height:18px;"></div>
        <div style="font-size:0.74rem; color:var(--text-muted); margin-top:4px;">
          Dica: abra <a href="${sourceUrl}" target="_blank" rel="noopener" style="text-decoration:underline;">a citação parcial</a>, navegue até o ensinamento original em outra aba e cole a URL do reader aqui.
        </div>
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
