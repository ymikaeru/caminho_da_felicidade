// ============================================================
// Comparação (versão anterior) — antiga aba "Alinhamento JA↔PT".
// Os 617 monólogos-paredão do Vol 1 foram retraduzidos e alinhados; o PT
// anterior ficou arquivado em `content_ptbr_prev` em cada tópico no Storage.
// Esta aba lista esses artigos e mostra ANTERIOR × ATUAL renderizado (ao vivo
// do Storage), com copiar-trecho pra garimpar frases boas da versão antiga.
// Manifesto: data/retrad_prev_index.json (gerado do staging da retradução).
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escHtml } from '../shared/helpers.js';
import { VOL_SHORT } from '../shared/constants.js';

let _loaded = false;
let _items = [];           // {vol, file, theme_idx, topic_idx, title, status, flags}
let _filter = 'all';       // all | ok | flagged
let _q = '';
const _fileCache = {};

async function _getFile(vol, file) {
  const k = `${vol}/${file}`;
  if (_fileCache[k]) return _fileCache[k];
  const { data, error } = await supabase.storage.from('teachings').download(k);
  if (error) throw error;
  const json = JSON.parse(await data.text());
  _fileCache[k] = json;
  return json;
}

// Carrega o _normalizeContent real do leitor (+marked) p/ render fiel.
async function _ensureNormalize() {
  if (typeof window._normalizeContent === 'function') return;
  try { (0, eval)(await (await fetch('/js/marked.min.js')).text()); } catch (_) {}
  const src = await (await fetch('/js/reader-content.js?v=8')).text();
  (0, eval)(src
    .replace(/\bfunction _normalizeContent/, 'window._normalizeContent = function')
    .replace(/\bfunction _fallbackFormat/, 'window._fallbackFormat = function')
    .replace(/\bfunction _cleanSoftBreakArtifacts/, 'window._cleanSoftBreakArtifacts = function')
    .replace(/\b_fallbackFormat\(/g, 'window._fallbackFormat(')
    .replace(/\b_cleanSoftBreakArtifacts\(/g, 'window._cleanSoftBreakArtifacts('));
}

async function loadAlignment(force = false) {
  if (_loaded && !force) { _render(); return; }
  const box = document.getElementById('align-container');
  box.innerHTML = '<div class="loading">Carregando comparações…</div>';
  try {
    _items = await (await fetch('data/retrad_prev_index.json?' + Date.now())).json();
    _loaded = true;
    _render();
  } catch (e) {
    box.innerHTML = `<div class="msg err">Manifesto não encontrado (data/retrad_prev_index.json): ${_escHtml(e.message)}</div>`;
  }
}

function _updateBadge() {
  const b = document.getElementById('alignmentTabBadge');
  if (!b) return;
  b.textContent = _items.length || 0;
  b.classList.toggle('empty', !_items.length);
}

function _visible() {
  const ql = _q.toLowerCase();
  return _items.filter((x) =>
    (_filter === 'all' || x.status === _filter) &&
    (!ql || (x.title || '').toLowerCase().includes(ql) || (x.file || '').toLowerCase().includes(ql)));
}

function _render() {
  _updateBadge();
  const box = document.getElementById('align-container');
  const ok = _items.filter((x) => x.status === 'ok').length;
  const fl = _items.filter((x) => x.status === 'flagged').length;
  const chip = (v, label, n) => `<button class="align-chip ${_filter === v ? 'on' : ''}" onclick="alignSetFilter('${v}')">${label} (${n})</button>`;
  const vis = _visible();

  let html = `
    <div class="align-head">
      <div>
        <h2 class="align-title">Comparação — versão anterior</h2>
        <p class="align-sub">Os ${_items.length} artigos retraduzidos (Vol 1). Veja a tradução <b>anterior</b> ao lado da
        <b>atual</b> e copie trechos bons da versão antiga. Lê ao vivo do Storage; o PT atual é o que está publicado.</p>
      </div>
    </div>
    <div class="align-filters">
      <div class="align-filter-row">
        ${chip('all', 'Todos', _items.length)}${chip('ok', 'OK', ok)}${chip('flagged', 'Revisar', fl)}
      </div>
      <input class="align-search" placeholder="Buscar por título ou arquivo…" value="${_escHtml(_q)}" oninput="alignSearch(this.value)">
    </div>`;

  if (!vis.length) { box.innerHTML = html + `<div class="report-empty">Nada neste filtro.</div>`; return; }

  html += '<div class="align-list">';
  for (const it of vis.slice(0, 700)) {
    const i = _items.indexOf(it);
    const badge = it.status === 'flagged'
      ? `<span class="align-tag" title="${_escHtml((it.flags || []).join(', '))}">revisar</span>` : '';
    html += `
      <div class="align-row">
        <span class="align-vol">${VOL_SHORT[it.vol] || it.vol}</span>
        <span class="align-rowtitle" title="${_escHtml(it.file)}">${_escHtml(it.title || it.file)}</span>
        ${badge}
        <button class="align-review-btn" onclick="alignCompare(${i})">Comparar →</button>
      </div>`;
  }
  html += '</div>';
  box.innerHTML = html;
}

window.alignSetFilter = function (v) { _filter = v; _render(); };
window.alignSearch = function (v) { _q = v; _render(); };

window.alignCompare = async function (i) {
  const it = _items[i];
  if (!it) return;
  const box = document.getElementById('align-container');
  box.innerHTML = '<div class="loading">Baixando do Storage…</div>';
  try {
    await _ensureNormalize();
    const json = await _getFile(it.vol, it.file);
    const topic = json.themes?.[it.theme_idx]?.topics?.[it.topic_idx];
    if (!topic) throw new Error('tópico não encontrado (índice mudou?)');
    const prev = (topic.content_ptbr_prev || '').trim();
    const cur = topic.content_ptbr || '';
    const norm = window._normalizeContent || ((s) => s);
    const top = `
      <div class="align-review-top">
        <button class="align-back" onclick="loadAlignment()">← Voltar à lista</button>
        <span class="align-vol">${VOL_SHORT[it.vol] || it.vol}</span>
        <span class="align-rowtitle">${_escHtml(it.title || it.file)}</span>
        <span class="align-file">${_escHtml(it.file)} · t${it.topic_idx}</span>
      </div>`;

    if (!prev) {
      box.innerHTML = top + `<div class="report-empty">Este artigo ainda não tem versão anterior arquivada
        (<code>content_ptbr_prev</code>) no Storage.</div>`;
      return;
    }
    const prevParas = prev.split(/\n\n+|<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
    const prevCol = prevParas.map((p) => `
      <div class="prev-seg-row">
        <button class="prev-copy" title="Copiar este trecho" onclick="alignCopyPrev(this)">⧉</button>
        <div class="prev-seg-text">${_escHtml(p)}</div>
      </div>`).join('');

    box.innerHTML = top + `
      <p class="align-note">Coluna <b>anterior</b>: ${prevParas.length} trecho(s), use ⧉ para copiar. Coluna <b>atual</b>: como está publicado agora.</p>
      <div class="align-pair-head"><span>Anterior (substituída)</span><span>Atual (publicada)</span></div>
      <div class="align-cols">
        <div class="align-col" style="padding:8px 12px">${prevCol}</div>
        <div class="align-col" style="padding:8px 12px;line-height:1.6">${norm(cur)}</div>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div class="msg err">Erro: ${_escHtml(e.message)}</div>
      <button class="align-review-btn" onclick="loadAlignment()">← Voltar</button>`;
  }
};

window.alignCopyPrev = async function (btnEl) {
  const txt = btnEl.parentElement.querySelector('.prev-seg-text')?.innerText || '';
  try {
    await navigator.clipboard.writeText(txt);
    const old = btnEl.textContent; btnEl.textContent = '✓';
    setTimeout(() => { btnEl.textContent = old; }, 900);
  } catch (_) {
    const el = btnEl.parentElement.querySelector('.prev-seg-text');
    const r = document.createRange(); r.selectNodeContents(el);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
};

window.loadAlignment = loadAlignment;
export { loadAlignment };
