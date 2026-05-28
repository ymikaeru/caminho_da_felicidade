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
let _filterStatus = 'unmapped'; // 'unmapped' | 'mapped' | 'no_full_text' — sub-aba ativa
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

// Tipo do entry: 'internal' (link pra ensinamento no corpus) ou
// 'no_full_text' (citação parcial sem texto completo disponível).
// Default 'internal' pra retrocompat com entries antigos sem type.
function _entryType(entry) {
  if (!entry) return null;
  return entry.type === 'no_full_text' ? 'no_full_text' : 'internal';
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

// Pega title_jp/title_pt/date do tópico alvo no Storage e enriquece
// o objeto que vai ser salvo no manual_citation_links.json.
// Reader usa esses campos pra mostrar "— Título" no CTA.
async function _enrichWithTargetTitle(parsed) {
  try {
    const json = await _fetchTargetTopic(parsed.vol, parsed.file);
    const topic = _topicAtIdx(json, parsed.topic_idx);
    if (!topic) return parsed;
    return {
      ...parsed,
      title_jp: (topic.title || '').trim(),
      title_pt: (topic.title_ptbr || topic.title_pt || '').trim(),
      date: (topic.date || '').trim(),
    };
  } catch (_) {
    return parsed;
  }
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
    <div style="background:var(--surface); border-radius:10px; width:100%; max-width:1500px; height:90vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.4); overflow:hidden;">
      <div style="padding:16px 24px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
        <h3 style="margin:0; font-size:1.05rem;">🔍 Comparar citação parcial vs. ensinamento completo</h3>
        <button id="pc-cmp-close" class="btn-zen" style="font-size:0.85rem;">✕ Fechar</button>
      </div>
      <div id="pc-cmp-body" style="flex:1; overflow:hidden; display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--border);">
        <div id="pc-cmp-src" style="background:var(--surface); padding:18px 22px; overflow-y:auto;"></div>
        <div id="pc-cmp-tgt" style="background:var(--surface); padding:18px 22px; overflow-y:auto;"></div>
      </div>
      <div style="padding:14px 24px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-shrink:0; gap:12px;">
        <div id="pc-cmp-status" style="font-size:0.82rem; color:var(--text-muted);"></div>
        <div style="display:flex; gap:8px;">
          <button id="pc-cmp-cancel" class="btn-zen" style="font-size:0.85rem;">Cancelar</button>
          <button id="pc-cmp-confirm" class="btn-zen" style="font-size:0.85rem; background:var(--accent); color:white;">✓ Confirmar mapeamento</button>
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

// Extrai TODO o trecho que vem após "（一部のみ引用）" no conteúdo da
// citação parcial — usado pra destacar o trecho completo no conteúdo
// do alvo. Como as citações parciais são extratos verbatim, o texto
// após o marcador deve aparecer literalmente no ensinamento completo.
function _extractCitationExcerpt(contentJa) {
  if (!contentJa) return null;
  const m = contentJa.match(/[（(]\s*一部のみ引用\s*[）)]\s*([\s\S]+)$/);
  if (!m) return null;
  // Remove fechamento de aspas final ("」, ", etc.) que possa fazer
  // parte do invólucro de citação, mas não do trecho citado em si.
  return m[1].trim().replace(/[」"”]+$/, '').trim();
}

// Localiza um trecho (ignorando espaços/quebras) dentro de um texto
// maior. Devolve { start, end } no texto original ou null. Usa busca
// "espaços-insensitivo" porque o JSON pode ter formatting diferente
// entre cópias do mesmo texto.
function _findFuzzy(haystack, needle) {
  if (!haystack || !needle || needle.length < 8) return null;
  // Normaliza ambos retirando whitespace, mas mantém um índice mapeando
  // posição no normalizado → posição no original
  const map = [];
  let normalized = '';
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i];
    if (/\s/.test(ch)) continue;
    map.push(i);
    normalized += ch;
  }
  const needleNorm = needle.replace(/\s+/g, '');
  const idx = normalized.indexOf(needleNorm);
  if (idx === -1) return null;
  return { start: map[idx], end: map[idx + needleNorm.length - 1] + 1, normStart: idx };
}

function _highlightExcerpt(contentJa, excerpt) {
  if (!excerpt) return _highlightCit(contentJa);
  // Usa os primeiros ~60 chars não-ws como anchor pra achar o início.
  // Trechos muito longos podem ter pequenas variações de formatação no
  // meio (que quebram um match exato), mas o INÍCIO é sempre verbatim.
  const excerptNoWs = excerpt.replace(/\s+/g, '');
  const anchor = excerptNoWs.slice(0, Math.min(60, excerptNoWs.length));
  const range = _findFuzzy(contentJa, anchor);
  if (!range) return _highlightCit(contentJa);

  // A partir do start do anchor, estende o highlight contando
  // excerptNoWs.length chars não-whitespace no contentJa original.
  // Assim cobre o trecho inteiro mesmo que tenha whitespace/quebras
  // diferentes entre source e target.
  const totalNonWs = excerptNoWs.length;
  let nonWsCount = 0;
  let endPos = range.start;
  for (let i = range.start; i < contentJa.length; i++) {
    if (!/\s/.test(contentJa[i])) nonWsCount++;
    endPos = i + 1;
    if (nonWsCount >= totalNonWs) break;
  }

  const before = contentJa.slice(0, range.start);
  const middle = contentJa.slice(range.start, endPos);
  const after = contentJa.slice(endPos);
  return _highlightCit(before)
    + `<mark style="background:#bbf7d0; padding:1px 3px; border-radius:3px; box-shadow:0 0 0 2px #86efac;" id="pc-excerpt-anchor">${_escHtml(middle)}</mark>`
    + _highlightCit(after);
}

function _renderCompareSide(el, label, color, vol, file, topicIdx, topic, totalTopics, excerpt) {
  if (!topic) {
    el.innerHTML = `<div style="color:#991b1b;">Tópico não encontrado.</div>`;
    return;
  }
  const titleJa = _stripHtml(topic.title || '');
  const date = topic.date || '';
  const contentJa = _stripHtml(topic.content || '');
  const isSource = label.includes('parcial'); // source mostra "(一部のみ引用)" destacado normal
  const renderedContent = isSource
    ? _highlightCit(contentJa)
    : _highlightExcerpt(contentJa, excerpt);
  el.innerHTML = `
    <div style="font-size:0.78rem; color:${color}; font-weight:600; letter-spacing:0.5px; text-transform:uppercase; margin-bottom:6px;">${label}</div>
    <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:10px; font-family:monospace;">${_escHtml(vol)}/${_escHtml(file)} <span style="background:var(--bg-color); padding:1px 6px; border-radius:3px;">#${topicIdx}</span> · ${topicIdx + 1} de ${totalTopics}</div>
    ${titleJa ? `<div style="font-family:'Noto Serif JP',serif; font-size:1.08rem; line-height:1.4; margin-bottom:4px;">${_escHtml(titleJa)}</div>` : ''}
    ${date ? `<div style="font-size:0.82rem; color:var(--text-muted); margin-bottom:14px;">${_escHtml(date)}</div>` : ''}
    ${contentJa ? `<div style="font-family:'Noto Serif JP',serif; font-size:1rem; line-height:1.85; color:var(--text-main);">${renderedContent}</div>` : '<div style="color:#991b1b;">Sem conteúdo japonês.</div>'}
  `;
}

// ─── Modal de busca JP (singleton) ──────────────────────────
// Permite o admin colar um trecho japonês e encontrar em qual
// arquivo/tópico ele está, sem precisar abrir editor externo.
// Carrega data/jp_search/mioshiecN.json (Storage) lazily por vol.

const _jpIndexCache = new Map(); // vol → array de { v, f, i, t, d, c }
let _jpSearchCtx = null;          // { sourceItem, qvolEl, qfileEl, qidxEl, callback }

async function _loadJpIndex(vol) {
  if (_jpIndexCache.has(vol)) return _jpIndexCache.get(vol);
  const promise = (async () => {
    try {
      const data = await window.supabaseStorageFetch
        ? await window.supabaseStorageFetch(`data/jp_search/${vol}.json`)
        : await fetch(`data/jp_search/${vol}.json`).then((r) => r.json());
      return Array.isArray(data) ? data : (data?.entries || data || []);
    } catch (e) {
      console.error('[jp-search] falhou', vol, e.message);
      return [];
    }
  })();
  _jpIndexCache.set(vol, promise);
  return promise;
}

function _ensureJpSearchModal() {
  let modal = document.getElementById('pc-jpsearch-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'pc-jpsearch-modal';
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:10001; display:none; align-items:center; justify-content:center; padding:24px;';
  modal.innerHTML = `
    <div style="background:var(--surface); border-radius:10px; width:100%; max-width:1100px; height:85vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.4); overflow:hidden;">
      <div style="padding:16px 24px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
        <h3 style="margin:0; font-size:1.05rem;">🔎 Buscar trecho japonês nos ensinamentos completos</h3>
        <button id="pc-jp-close" class="btn-zen" style="font-size:0.85rem;">✕ Fechar</button>
      </div>
      <div style="padding:14px 24px; border-bottom:1px solid var(--border); display:flex; gap:10px; flex-shrink:0; align-items:center; flex-wrap:wrap;">
        <input id="pc-jp-q" type="text" placeholder="Cole trecho japonês (ex: 本守護神は絶対善性であり…)"
               style="flex:1; min-width:300px; padding:9px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-color); color:var(--text-main); font-size:0.95rem; font-family:'Noto Serif JP',serif;">
        <select id="pc-jp-vol" style="padding:9px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-color); color:var(--text-main); font-size:0.9rem;">
          <option value="all">Todos os volumes</option>
          <option value="mioshiec1">Vol 1</option>
          <option value="mioshiec2">Vol 2</option>
          <option value="mioshiec3">Vol 3</option>
          <option value="mioshiec4">Vol 4</option>
        </select>
        <label style="display:flex; align-items:center; gap:6px; font-size:0.84rem; color:var(--text-muted); cursor:pointer;" title="Esconder topics que contêm '一部のみ引用' — eles são outras citações parciais, não o texto completo.">
          <input id="pc-jp-excludepartial" type="checkbox" checked>
          Só completos
        </label>
      </div>
      <div id="pc-jp-status" style="padding:6px 24px; font-size:0.78rem; color:var(--text-muted); border-bottom:1px solid var(--border); flex-shrink:0;"></div>
      <div id="pc-jp-results" style="flex:1; overflow-y:auto; padding:8px 24px;"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) _closeJpSearchModal(); });
  document.getElementById('pc-jp-close').addEventListener('click', _closeJpSearchModal);

  const qEl = document.getElementById('pc-jp-q');
  const volEl = document.getElementById('pc-jp-vol');
  const excludeEl = document.getElementById('pc-jp-excludepartial');
  let timer = null;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(_runJpSearch, 200);
  };
  qEl.addEventListener('input', trigger);
  volEl.addEventListener('change', trigger);
  excludeEl.addEventListener('change', trigger);

  return modal;
}

function _closeJpSearchModal() {
  const modal = document.getElementById('pc-jpsearch-modal');
  if (modal) modal.style.display = 'none';
  _jpSearchCtx = null;
}

async function _runJpSearch() {
  const qEl = document.getElementById('pc-jp-q');
  const volEl = document.getElementById('pc-jp-vol');
  const resultsEl = document.getElementById('pc-jp-results');
  const statusEl = document.getElementById('pc-jp-status');
  const rawQuery = (qEl.value || '').trim();
  const query = rawQuery.replace(/\s+/g, ''); // normaliza whitespace
  if (query.length < 4) {
    resultsEl.innerHTML = `<div style="padding:32px; text-align:center; color:var(--text-muted); font-size:0.9rem;">Digite ao menos 4 caracteres japoneses pra começar a busca.</div>`;
    statusEl.textContent = '';
    return;
  }
  const vol = volEl.value;
  const volsToSearch = vol === 'all' ? ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'] : [vol];
  statusEl.textContent = `⏳ Carregando índices (${volsToSearch.length} vol${volsToSearch.length === 1 ? '' : 's'})…`;
  resultsEl.innerHTML = `<div style="padding:32px; text-align:center; color:var(--text-muted);">⏳ Buscando…</div>`;

  const indices = await Promise.all(volsToSearch.map((v) => _loadJpIndex(v)));
  const allEntries = indices.flat();
  statusEl.textContent = `Procurando "${rawQuery.slice(0, 40)}${rawQuery.length > 40 ? '…' : ''}" em ${allEntries.length} tópicos.`;

  const excludePartial = document.getElementById('pc-jp-excludepartial')?.checked ?? true;
  // Regex que detecta citação parcial — usada pra filtrar e pra
  // mostrar contagem de relacionados ignorados.
  const PARTIAL_RE = /[（(]\s*一部のみ引用\s*[）)]/;

  const allHits = [];
  for (const e of allEntries) {
    const idx = (e.c || '').indexOf(query);
    if (idx >= 0) allHits.push({ entry: e, position: idx });
  }

  // Separa em "completos" (sem marcador) e "outras citações parciais".
  const fullHits = [];
  const partialHits = [];
  for (const h of allHits) {
    if (PARTIAL_RE.test(h.entry.c || '')) partialHits.push(h);
    else fullHits.push(h);
  }

  const visible = (excludePartial ? fullHits : allHits)
    .sort((a, b) => a.position - b.position)
    .slice(0, 30);

  if (visible.length === 0) {
    let msg = `<div style="padding:32px; text-align:center; color:var(--text-muted); font-size:0.9rem;">Nenhuma ocorrência encontrada.<br><span style="font-size:.82rem;">Tente um trecho menor ou diferente. Lembre que o índice cobre só os primeiros 800 chars de cada tópico.</span>`;
    if (excludePartial && partialHits.length > 0) {
      msg += `<br><br><span style="color:var(--accent);">⚠ Encontrei ${partialHits.length} ocorrência${partialHits.length === 1 ? '' : 's'} em outras citações parciais — desmarque "Só completos" pra ver.</span>`;
    }
    msg += '</div>';
    resultsEl.innerHTML = msg;
    statusEl.textContent = `0 resultados em ${allEntries.length} tópicos${excludePartial ? ` (ignorando ${partialHits.length} cit. parciais)` : ''}.`;
    return;
  }
  let suffix = `${visible.length} resultado${visible.length === 1 ? '' : 's'} (mostrando até 30)`;
  if (excludePartial && partialHits.length > 0) {
    suffix += ` · ${partialHits.length} cit. parciais ignoradas`;
  }
  statusEl.textContent = suffix + '.';
  const hits = visible;

  resultsEl.innerHTML = hits.map((h, hi) => {
    const e = h.entry;
    const content = e.c || '';
    const before = content.slice(Math.max(0, h.position - 40), h.position);
    const match = content.slice(h.position, h.position + query.length);
    const after = content.slice(h.position + query.length, h.position + query.length + 120);
    // title_idx no JSON é 1-based, topic_idx (i no índice) é 0-based
    const titleIdx = e.i + 1;
    return `
      <div class="pc-jp-result" data-hi="${hi}" style="padding:14px 16px; margin-bottom:10px; border:1px solid var(--border); border-radius:8px; background:var(--bg-color); cursor:pointer; transition:background .15s;">
        <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-bottom:4px;">
          <div style="font-family:'Noto Serif JP',serif; font-size:0.95rem; line-height:1.3;">${_escHtml(e.t || '(sem título)')}</div>
          <div style="font-family:monospace; font-size:0.78rem; color:var(--text-muted); white-space:nowrap;">
            ${_escHtml(e.v)}/${_escHtml(e.f)}
            <span style="background:var(--surface); padding:1px 6px; border-radius:3px; margin-left:4px;">title_idx ${titleIdx}</span>
          </div>
        </div>
        ${e.d ? `<div style="font-size:0.74rem; color:var(--text-muted); margin-bottom:6px;">${_escHtml(e.d)}</div>` : ''}
        <div style="font-family:'Noto Serif JP',serif; font-size:0.88rem; line-height:1.7; color:var(--text-main);">
          …${_escHtml(before)}<mark style="background:#bbf7d0; padding:1px 2px; border-radius:2px;">${_escHtml(match)}</mark>${_escHtml(after)}…
        </div>
      </div>
    `;
  }).join('');

  resultsEl.querySelectorAll('.pc-jp-result').forEach((row) => {
    row.addEventListener('mouseenter', () => row.style.background = 'var(--accent-soft)');
    row.addEventListener('mouseleave', () => row.style.background = 'var(--bg-color)');
    row.addEventListener('click', () => {
      const hi = parseInt(row.dataset.hi, 10);
      const e = hits[hi].entry;
      const sourceItem = _jpSearchCtx?.sourceItem;
      const parsed = { vol: e.v, file: e.f, topic_idx: e.i };

      // Pré-preenche o atalho da linha (pra user editar depois se quiser)
      if (_jpSearchCtx) {
        if (_jpSearchCtx.qvolEl) _jpSearchCtx.qvolEl.value = e.v;
        if (_jpSearchCtx.qfileEl) _jpSearchCtx.qfileEl.value = e.f;
        if (_jpSearchCtx.qidxEl)  _jpSearchCtx.qidxEl.value  = String(e.i + 1);
        if (_jpSearchCtx.onPick) _jpSearchCtx.onPick();
      }

      // Procura outras citações parciais com o mesmo trecho — viram
      // candidatas a bulk-apply dentro do modal de comparação.
      const related = sourceItem ? _findRelatedPartials(query, _key(sourceItem)) : [];

      _closeJpSearchModal();
      if (sourceItem) {
        _openCompareModal(sourceItem, parsed, related);
      }
    });
  });
}

// Procura outras citações parciais (em _unmatched) cujo content_preview_ja
// contenha o mesmo trecho da busca atual. Usado pra oferecer bulk-apply
// quando o user encontra o ensinamento completo de uma e outras citações
// têm o mesmo excerpt.
function _findRelatedPartials(query, excludeKey) {
  if (!query || query.length < 8) return [];
  const queryNorm = query.replace(/\s+/g, '');
  const matches = [];
  for (const u of _unmatched) {
    const key = _key(u);
    if (key === excludeKey) continue;
    // Pula os que já têm link efetivo (mapped ou no_full_text)
    if (_effectiveLink(key)) continue;
    const haystack = (u.content_preview_ja || '').replace(/\s+/g, '');
    if (haystack.includes(queryNorm)) matches.push(u);
  }
  return matches;
}

async function _openJpSearchModal(ctx) {
  _jpSearchCtx = ctx;
  const modal = _ensureJpSearchModal();
  modal.style.display = 'flex';
  const qEl = document.getElementById('pc-jp-q');
  const resultsEl = document.getElementById('pc-jp-results');
  const statusEl = document.getElementById('pc-jp-status');
  qEl.value = '';
  resultsEl.innerHTML = '';
  statusEl.textContent = '';

  // Tenta extrair automaticamente o trecho após "(一部のみ引用)" da
  // citação parcial pra economizar copia-cola do user. Usa primeiro o
  // content_preview_ja do índice; se não rolar, busca o JSON completo
  // no Storage pra ter o conteúdo integral.
  let autoQuery = '';
  if (ctx?.sourceItem) {
    const previewJa = ctx.sourceItem.content_preview_ja || '';
    let excerpt = _extractCitationExcerpt(previewJa);
    if (!excerpt || excerpt.length < 10) {
      // Preview não cobriu — pega do JSON completo
      statusEl.textContent = '⏳ Carregando trecho da citação…';
      try {
        const srcJson = await _fetchTargetTopic(ctx.sourceItem.vol, ctx.sourceItem.file);
        const srcTopic = _topicAtIdx(srcJson, ctx.sourceItem.topic_idx);
        if (srcTopic) {
          const fullContent = _stripHtml(srcTopic.content || '');
          excerpt = _extractCitationExcerpt(fullContent);
        }
      } catch (_) {}
    }
    if (excerpt && excerpt.length >= 6) {
      // Primeiros ~40 chars sem espaços = anchor único o suficiente
      // pra reduzir resultados sem perder hits válidos.
      autoQuery = excerpt.replace(/\s+/g, '').slice(0, 40);
    }
  }

  if (autoQuery) {
    qEl.value = autoQuery;
    statusEl.innerHTML = `<span style="color:var(--accent);">✨ Auto-preenchido com trecho da citação. Editando o campo refaz a busca.</span>`;
    setTimeout(() => { _runJpSearch(); qEl.select(); }, 50);
  } else {
    resultsEl.innerHTML = `<div style="padding:32px; text-align:center; color:var(--text-muted); font-size:0.9rem;">Digite um trecho japonês pra começar.<br><span style="font-size:.82rem; opacity:.7;">Resultado clicado preenche os campos do atalho automaticamente.</span></div>`;
    setTimeout(() => qEl.focus(), 50);
  }
}

async function _openCompareModal(sourceItem, targetParsed, related = []) {
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

  // Extrai trecho que sucede "（一部のみ引用）" no source pra destacar no target
  const srcContentJa = _stripHtml(srcTopic?.content || '');
  const excerpt = _extractCitationExcerpt(srcContentJa);

  _renderCompareSide(srcEl, '📌 Citação parcial (origem)', '#92400e', sourceItem.vol, sourceItem.file, sourceItem.topic_idx, srcTopic, srcTotal, null);
  _renderCompareSide(tgtEl, '📖 Ensinamento completo (alvo)', '#065f46', targetParsed.vol, targetParsed.file, targetParsed.topic_idx, tgtTopic, tgtTotal, excerpt);

  // Scroll automático até o excerpt destacado no target (se achou)
  if (excerpt) {
    setTimeout(() => {
      const anchor = tgtEl.querySelector('#pc-excerpt-anchor');
      if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    statusEl.innerHTML = `<span style="color:#065f46;">✓ Trecho destacado em verde no alvo.</span>`;
  } else {
    statusEl.innerHTML = `<span style="color:var(--text-muted);">Não foi possível identificar trecho — compare manualmente.</span>`;
  }
  if (related && related.length > 0) {
    statusEl.innerHTML += ` <span style="color:var(--accent); margin-left:8px;">· ${related.length} outra${related.length === 1 ? '' : 's'} cit${related.length === 1 ? '.' : 's.'} parcia${related.length === 1 ? 'l' : 'is'} com mesmo trecho serão mapeadas junto.</span>`;
  }

  if (srcTopic && tgtTopic) {
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = 1;
    // Se vier com `related` (pré-detectadas pela busca JP), oferece
    // bulk-apply direto no footer do modal de comparação.
    if (related && related.length > 0) {
      confirmBtn.innerHTML = `✓ Mapear esta + ${related.length} outra${related.length === 1 ? '' : 's'} com mesmo trecho`;
      confirmBtn.title = related.slice(0, 5).map((r) => `${r.vol}/${r.file}#${r.topic_idx}`).join('\n') +
        (related.length > 5 ? `\n…e mais ${related.length - 5}` : '');
    } else {
      confirmBtn.innerHTML = '✓ Confirmar mapeamento';
      confirmBtn.title = '';
    }
    confirmBtn.onclick = async () => {
      const key = _key(sourceItem);
      const value = {
        ...targetParsed,
        title_jp: (tgtTopic.title || '').trim(),
        title_pt: (tgtTopic.title_ptbr || tgtTopic.title_pt || '').trim(),
        date: (tgtTopic.date || '').trim(),
        added_at: new Date().toISOString(),
        added_by: _myEmail || 'unknown',
      };
      if (related && related.length > 0) {
        // Bulk: upload único com todos os entries
        confirmBtn.innerHTML = '⏳ Salvando…';
        confirmBtn.disabled = true;
        try {
          const newLinks = { ...(_manualLinks || {}) };
          newLinks[key] = value;
          for (const r of related) newLinks[_key(r)] = value;
          const payload = {
            generated_at: new Date().toISOString(),
            note: 'Mapeamentos manuais de citações parciais → ensinamento completo (interno). Editado via admin → aba "Citações Parciais".',
            links: newLinks,
          };
          await _uploadManual(payload);
          _manualLinks = newLinks;
          delete _pendingEdits[key];
          for (const r of related) delete _pendingEdits[_key(r)];
          _savePendingEdits();
          _closeCompareModal();
          _renderShell();
          _renderList();
        } catch (err) {
          alert(`Erro ao salvar: ${err.message}`);
          confirmBtn.innerHTML = `✓ Mapear esta + ${related.length} outra${related.length === 1 ? '' : 's'}`;
          confirmBtn.disabled = false;
        }
      } else {
        await _publishSingle(key, value, confirmBtn);
        _closeCompareModal();
      }
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
  // Sub-aba ativa filtra por status:
  // - mapped: tem link interno
  // - no_full_text: marcado como "sem texto completo no corpus"
  // - unmapped: sem link de nenhum tipo
  arr = arr.filter((i) => {
    const link = _effectiveLink(_key(i));
    const type = _entryType(link);
    if (_filterStatus === 'mapped') return link && type === 'internal';
    if (_filterStatus === 'no_full_text') return link && type === 'no_full_text';
    return !link; // unmapped
  });
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
  let mapped = 0, unmapped = 0, noFullText = 0;
  for (const it of _unmatched) {
    const link = _effectiveLink(_key(it));
    if (!link) unmapped++;
    else if (_entryType(link) === 'no_full_text') noFullText++;
    else mapped++;
  }
  return { mapped, unmapped, noFullText };
}

function _renderShell() {
  const cnt = document.getElementById('pc-container');
  if (!cnt) return;
  const { mapped: mappedCount, unmapped: unmappedCount, noFullText: noFullCount } = _statusCounts();
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
        background:${_filterStatus === status ? color : 'var(--bg-color)'};
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
        <button id="pc-publish" class="btn-zen" style="background:${pendingCount > 0 ? 'var(--accent)' : 'var(--bg-color)'}; color:${pendingCount > 0 ? 'white' : 'var(--text-muted)'};">
          💾 Publicar ${pendingCount > 0 ? `(${pendingCount})` : ''}
        </button>
      </div>
    </div>

    <!-- Sub-abas: Pendentes / Mapeados / Sem Conteúdo Inteiro -->
    <div style="display:flex; gap:0; border-bottom:1px solid var(--border); margin-bottom:14px;">
      ${subTabBtn('unmapped',     'Pendentes',           unmappedCount, '#d97706')}
      ${subTabBtn('mapped',       'Mapeados',            mappedCount,   '#10b981')}
      ${subTabBtn('no_full_text', 'Sem Conteúdo Inteiro', noFullCount,   '#6366f1')}
    </div>

    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; align-items:center;">
      <input id="pc-search" type="text" placeholder="Filtrar por título, data, arquivo..."
             value="${_escHtml(_filterText)}"
             style="flex:1; min-width:240px; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-color); color:var(--text-main); font-size:0.9rem;">
      <select id="pc-vol" style="padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-color); color:var(--text-main); font-size:0.9rem;">
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

  // Banner explicativo na sub-aba "Mapeados" quando houver pendências.
  // Esclarece: link visível aqui ≠ link ativo no reader (precisa publicar).
  let banner = '';
  if (_filterStatus === 'mapped') {
    const pendingInMapped = items.filter((it) => _hasPendingFor(_key(it)) && _pendingEdits[_key(it)] !== null).length;
    if (pendingInMapped > 0) {
      banner = `
        <div style="margin-bottom:14px; padding:10px 14px; background:#fef3c7; border-left:3px solid #f59e0b; border-radius:0 4px 4px 0; font-size:0.84rem; color:#78350f; line-height:1.5;">
          🕒 <strong>${pendingInMapped} mapeamento${pendingInMapped === 1 ? '' : 's'} aguarda${pendingInMapped === 1 ? '' : 'm'} publicação.</strong>
          Os links foram salvos localmente mas <strong>ainda não aparecem no reader</strong>.
          Clique <strong>"💾 Publicar"</strong> no topo da página pra subir tudo pro Storage.
        </div>`;
    }
  }

  list.innerHTML = banner + pageItems.map((it) => _renderRow(it)).join('');

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
        previewEl.innerHTML = `<span style="color:var(--accent);">✓ ${_escHtml(parsed.vol)} / ${_escHtml(parsed.file)} #${parsed.topic_idx}</span>`;
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

    saveBtn.addEventListener('click', async () => {
      const parsed = _parseReaderUrl(urlInput.value);
      if (!parsed) return;
      const enriched = await _enrichWithTargetTitle(parsed);
      const value = {
        ...enriched,
        added_at: new Date().toISOString(),
        added_by: _myEmail || 'unknown',
      };
      await _publishSingle(key, value, saveBtn);
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
        qpreviewEl.innerHTML = `<span style="color:var(--accent);">✓ ${_escHtml(parsed.vol)} / ${_escHtml(parsed.file)} #${parsed.topic_idx} <span style="opacity:.6;">(title_idx ${qidxEl.value} → topic ${parsed.topic_idx})</span></span>`;
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

    // Botão "Buscar trecho JP" — abre modal compartilhado e seleciona resultado
    const jpSearchBtn = form.querySelector(`#pc-jpsearch-${safeId}`);
    if (jpSearchBtn) {
      jpSearchBtn.addEventListener('click', () => {
        _openJpSearchModal({
          sourceItem: it,
          qvolEl, qfileEl, qidxEl,
          onPick: () => updateQuickPreview(),
        });
      });
    }

    // Botão "📌 Marcar Sem Conteúdo Inteiro" / "↺ Desmarcar"
    const markBtn = form.querySelector(`#pc-marknofull-${safeId}`);
    if (markBtn) {
      markBtn.addEventListener('click', async () => {
        const value = {
          type: 'no_full_text',
          added_at: new Date().toISOString(),
          added_by: _myEmail || 'unknown',
        };
        await _publishSingle(key, value, markBtn);
      });
    }
    const unmarkBtn = form.querySelector(`#pc-unmark-${safeId}`);
    if (unmarkBtn) {
      unmarkBtn.addEventListener('click', async () => {
        if (!confirm('Desmarcar e voltar pra sub-aba "Pendentes"?')) return;
        await _publishSingle(key, null, unmarkBtn);
      });
    }
    qsaveBtn.addEventListener('click', async () => {
      const parsed = _parseQuickInput(qvolEl.value, qfileEl.value, qidxEl.value);
      if (!parsed) return;
      const enriched = await _enrichWithTargetTitle(parsed);
      const value = {
        ...enriched,
        added_at: new Date().toISOString(),
        added_by: _myEmail || 'unknown',
      };
      await _publishSingle(key, value, qsaveBtn);
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!confirm('Remover o mapeamento manual desta citação?\n\nIsso vai publicar a remoção no Storage imediatamente.')) return;
        if (_manualLinks[key]) {
          // Já existia no Storage → publica a remoção
          await _publishSingle(key, null, clearBtn);
        } else {
          // Era só pending local → só remove
          delete _pendingEdits[key];
          _savePendingEdits();
          _renderShell();
          _renderList();
        }
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

  const linkType = _entryType(link);
  let statusBadge = '';
  if (isCleared) {
    statusBadge = `<span title="Remoção do link aguardando publicação" style="font-size:0.72rem; padding:2px 8px; background:#fee2e2; color:#991b1b; border-radius:4px;">🕒 REMOÇÃO PENDENTE</span>`;
  } else if (link && linkType === 'no_full_text') {
    statusBadge = `<span title="Marcado como sem texto completo no corpus — precisa de fonte externa" style="font-size:0.72rem; padding:2px 8px; background:#e0e7ff; color:#3730a3; border-radius:4px;">📌 SEM CONTEÚDO INTEIRO</span>`;
  } else if (link && isPending) {
    statusBadge = `<span title="Link adicionado/alterado, aguardando publicação no Storage. Clique 'Publicar' pra ativar no reader." style="font-size:0.72rem; padding:2px 8px; background:#fef3c7; color:#92400e; border-radius:4px;">🕒 AGUARDA PUBLICAÇÃO</span>`;
  } else if (link) {
    statusBadge = `<span title="Link publicado e ativo no reader" style="font-size:0.72rem; padding:2px 8px; background:#d1fae5; color:#065f46; border-radius:4px;">✓ PUBLICADO</span>`;
  } else {
    statusBadge = `<span style="font-size:0.72rem; padding:2px 8px; background:var(--bg-color); color:var(--text-muted); border-radius:4px;">SEM LINK</span>`;
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
    <div style="border:1px solid var(--border); border-radius:8px; padding:14px 18px; margin-bottom:10px; background:var(--surface);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
        <div style="flex:1; min-width:0;">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            ${statusBadge}
            <span style="font-size:0.78rem; padding:2px 8px; background:var(--bg-color); color:var(--text-main); border-radius:4px; font-family:monospace; font-weight:600;">
              #${it.topic_idx}
            </span>
            <a href="${sourceUrl}" target="_blank" rel="noopener" style="font-size:0.78rem; color:var(--text-muted); text-decoration:underline;">
              ${_escHtml(it.vol)}/${_escHtml(it.file)}
            </a>
            <span style="font-size:0.78rem; color:var(--text-muted);">·</span>
            <span style="font-size:0.78rem; color:var(--text-muted);">${_escHtml(it.date || '—')}</span>
            <a href="${sourceUrl}" target="_blank" rel="noopener" style="font-size:0.78rem; color:var(--accent); text-decoration:underline; margin-left:auto; white-space:nowrap;">
              ↗ Abrir no reader
            </a>
          </div>
          <div style="font-family:'Noto Serif JP',serif; font-size:1.02rem; margin-top:6px; line-height:1.4;">
            ${_escHtml(it.title_jp || '(sem título JP)')}
          </div>
          ${it.title_pt ? `<div style="font-size:0.86rem; color:var(--text-muted); margin-top:2px;">${_escHtml(it.title_pt)}</div>` : ''}
          ${it.content_preview_ja ? `
            <div style="margin-top:10px; padding:10px 12px; background:var(--bg-color); border-left:3px solid var(--accent); border-radius:0 4px 4px 0; font-family:'Noto Serif JP', serif; font-size:0.92rem; line-height:1.6; color:var(--text-main);">
              ${_highlightCitMarker(it.content_preview_ja)}${it.content_preview_ja.length >= 180 ? '…' : ''}
            </div>
          ` : (it.content_preview ? `
            <div style="margin-top:10px; padding:10px 12px; background:var(--bg-color); border-left:3px solid var(--accent); border-radius:0 4px 4px 0; font-size:0.84rem; line-height:1.55; color:var(--text-main);">
              ${_highlightCitMarker(it.content_preview)}${it.content_preview.length >= 240 ? '…' : ''}
            </div>
          ` : '')}
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
                 style="flex:1; padding:7px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg-color); color:var(--text-main); font-size:0.85rem; font-family:monospace;">
          <button id="pc-compare-${safeId}" class="btn-zen" disabled style="opacity:.5; font-size:0.84rem;" title="Abrir modal de comparação side-by-side">🔍 Comparar</button>
          <button id="pc-save-${safeId}" class="btn-zen" disabled style="opacity:.5; font-size:0.84rem;">Salvar</button>
          ${link ? `<button id="pc-clear-${safeId}" class="btn-zen" style="font-size:0.84rem; color:#991b1b;">Remover</button>` : ''}
        </div>
        <div id="pc-preview-${safeId}" style="font-size:0.78rem; margin-top:6px; min-height:18px;"></div>

        <div style="font-size:0.74rem; color:var(--text-muted); margin:10px 0 4px; display:flex; align-items:center; gap:8px;">
          <span style="opacity:.5;">─ ou atalho do JSON ─</span>
          <button id="pc-jpsearch-${safeId}" class="btn-zen" style="font-size:0.76rem; padding:3px 10px;" title="Buscar trecho japonês entre os ~17.000 ensinamentos">
            🔎 Buscar trecho JP
          </button>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <select id="pc-qvol-${safeId}" style="padding:6px 8px; border:1px solid var(--border); border-radius:6px; background:var(--bg-color); color:var(--text-main); font-size:0.82rem;">
            <option value="mioshiec1" ${it.vol === 'mioshiec1' ? 'selected' : ''}>mioshiec1</option>
            <option value="mioshiec2" ${it.vol === 'mioshiec2' ? 'selected' : ''}>mioshiec2</option>
            <option value="mioshiec3" ${it.vol === 'mioshiec3' ? 'selected' : ''}>mioshiec3</option>
            <option value="mioshiec4" ${it.vol === 'mioshiec4' ? 'selected' : ''}>mioshiec4</option>
          </select>
          <input type="text" id="pc-qfile-${safeId}"
                 placeholder="filename.html"
                 style="flex:1; min-width:160px; padding:6px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg-color); color:var(--text-main); font-size:0.82rem; font-family:monospace;">
          <label style="font-size:0.78rem; color:var(--text-muted);">title_idx:</label>
          <input type="number" id="pc-qidx-${safeId}" min="1" placeholder="2"
                 style="width:70px; padding:6px 8px; border:1px solid var(--border); border-radius:6px; background:var(--bg-color); color:var(--text-main); font-size:0.82rem; font-family:monospace;">
          <button id="pc-qcompare-${safeId}" class="btn-zen" disabled style="opacity:.5; font-size:0.82rem;" title="Abrir modal de comparação side-by-side">🔍 Comparar</button>
          <button id="pc-qsave-${safeId}" class="btn-zen" disabled style="opacity:.5; font-size:0.82rem;">Salvar</button>
        </div>
        <div id="pc-qpreview-${safeId}" style="font-size:0.78rem; margin-top:6px; min-height:18px;"></div>
        <div style="font-size:0.74rem; color:var(--text-muted); margin-top:4px;">
          💡 <code>title_idx</code> é o valor do campo no JSON (1-based: o primeiro tópico é 1). Convertido automaticamente. Use o atalho quando estiver olhando o JSON no editor.
        </div>

        <!-- Preview do tópico alvo: carrega do Storage e mostra título+data+conteúdo -->
        <div id="pc-tgtpreview-${safeId}"></div>

        <!-- Marcador "Sem Conteúdo Inteiro": pra citações que não têm
             ensinamento completo no corpus (precisa de fonte externa). -->
        <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border); display:flex; gap:8px; align-items:center; font-size:0.78rem; color:var(--text-muted); flex-wrap:wrap;">
          <span>Sem texto completo no corpus?</span>
          ${linkType === 'no_full_text'
            ? `<button id="pc-unmark-${safeId}" class="btn-zen" style="font-size:0.78rem; padding:4px 10px;">↺ Desmarcar e voltar pra Pendentes</button>`
            : `<button id="pc-marknofull-${safeId}" class="btn-zen" style="font-size:0.78rem; padding:4px 10px; background:#e0e7ff; color:#3730a3;">📌 Marcar "Sem Conteúdo Inteiro"</button>`
          }
          <span style="opacity:.7; flex-basis:100%; margin-top:4px;">Move pra sub-aba "Sem Conteúdo Inteiro" — fica como TODO pra buscar fonte externa depois.</span>
        </div>
      </div>
    </div>
  `;
}

// Save + publish atômico: adiciona um único link em pending, sobe pro
// Storage, atualiza estado. Usado pelos botões "Salvar" pra evitar o
// passo separado de "Publicar". Devolve true em caso de sucesso.
async function _publishSingle(key, value, btnEl) {
  const origText = btnEl ? btnEl.innerHTML : '';
  if (btnEl) { btnEl.innerHTML = '⏳ Salvando…'; btnEl.disabled = true; }
  try {
    const newLinks = { ...(_manualLinks || {}) };
    if (value === null) delete newLinks[key];
    else newLinks[key] = value;
    const payload = {
      generated_at: new Date().toISOString(),
      note: 'Mapeamentos manuais de citações parciais → ensinamento completo (interno). Editado via admin → aba "Citações Parciais".',
      links: newLinks,
    };
    await _uploadManual(payload);
    _manualLinks = newLinks;
    // Limpa só ESTE key do pending (preserva edições paralelas se houver)
    delete _pendingEdits[key];
    _savePendingEdits();
    if (btnEl) { btnEl.innerHTML = '✓ Salvo!'; setTimeout(() => { _renderShell(); _renderList(); }, 600); }
    else { _renderShell(); _renderList(); }
    return true;
  } catch (e) {
    alert(`Erro ao salvar: ${e.message}\n\nO link foi mantido como pendente — você pode tentar de novo ou clicar "💾 Publicar".`);
    if (value === null) _pendingEdits[key] = null;
    else _pendingEdits[key] = value;
    _savePendingEdits();
    if (btnEl) { btnEl.innerHTML = origText; btnEl.disabled = false; }
    _renderShell();
    _renderList();
    return false;
  }
}

// ─── Publish em lote (fallback quando há pending acumulado) ─
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
