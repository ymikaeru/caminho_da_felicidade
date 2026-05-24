// ============================================================
// Poetry Versions — Comparador A/B/C/D de traduções
// (aba "Versões A/B" do admin)
//
// Para os 99 poemas humanos de Akimaro Kin'eishū, oferece 4 versões
// lado a lado (Web/v1/v2/v3) para curadoria caso-a-caso. Salva
// escolhas em localStorage; exporta JSON com as escolhas para
// aplicação via script Python.
// ============================================================
import { _escHtml } from '../shared/helpers.js';

const JSON_URL = '/data/poetry/akimaro_kineishu.json';
const LS_KEY = 'akimaro_versions_choices_v1';
const VERSION_LABELS = {
  WEB: { label: 'Web (Gemini Studio)', color: '#7a9b6e', short: 'WEB' },
  v1:  { label: 'API v1 (temp 0.65)',  color: '#9c8a4e', short: 'v1' },
  v2:  { label: 'API v2 (ousado, temp 0.95)', color: '#a86e6e', short: 'v2' },
  v3:  { label: 'API v3 (economia poética, temp 0.80)', color: '#5e7ea8', short: 'v3' },
};

let _allPoems = [];           // lista completa carregada do JSON
let _comparablePoems = [];    // só os que têm ao menos uma versão alternativa
let _choices = {};            // {poemNumber: 'WEB' | 'v1' | 'v2' | 'v3'}
let _filter = 'all';          // 'all' | 'undecided' | 'WEB' | 'v1' | 'v2' | 'v3'

function _loadChoices() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _choices = JSON.parse(raw) || {};
  } catch (e) {
    console.warn('[poetry-versions] failed to load localStorage', e);
    _choices = {};
  }
}

function _saveChoices() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(_choices));
  } catch (e) {
    console.warn('[poetry-versions] failed to save localStorage', e);
  }
}

function _gatherVersions(poem) {
  // Versão "WEB" = title/translation atuais (que vieram do AI Studio / parser)
  // Outras = title_gemini / title_gemini_v2 / title_gemini_v3
  const out = [];
  if (poem.title && poem.translation) {
    out.push({ key: 'WEB', title: poem.title, translation: poem.translation });
  }
  if (poem.title_gemini && poem.translation_gemini) {
    out.push({ key: 'v1', title: poem.title_gemini, translation: poem.translation_gemini });
  }
  if (poem.title_gemini_v2 && poem.translation_gemini_v2) {
    out.push({ key: 'v2', title: poem.title_gemini_v2, translation: poem.translation_gemini_v2 });
  }
  if (poem.title_gemini_v3 && poem.translation_gemini_v3) {
    out.push({ key: 'v3', title: poem.title_gemini_v3, translation: poem.translation_gemini_v3 });
  }
  return out;
}

async function loadPoetryVersions() {
  const container = document.getElementById('pv-container');
  if (!container) return;
  container.innerHTML = '<div class="loading">Carregando poemas…</div>';

  _loadChoices();

  try {
    const res = await fetch(JSON_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _allPoems = [];
    for (const sec of data.sections || []) {
      for (const p of sec.poems || []) {
        _allPoems.push({ ...p, section_pt: sec.title_pt, section_jp: sec.title_jp });
      }
    }
    _comparablePoems = _allPoems.filter(p => {
      const versions = _gatherVersions(p);
      return versions.length >= 2;
    });
    _renderUI();
  } catch (e) {
    container.innerHTML = `<div class="msg err">Erro ao carregar: ${_escHtml(e.message)}</div>`;
  }
}

function _renderUI() {
  const container = document.getElementById('pv-container');
  if (!container) return;

  const total = _comparablePoems.length;
  const decided = Object.keys(_choices).filter(k => _comparablePoems.find(p => String(p.number) === k)).length;
  const undecided = total - decided;

  // Contadores por versão
  const counts = { WEB: 0, v1: 0, v2: 0, v3: 0 };
  for (const k in _choices) {
    if (counts.hasOwnProperty(_choices[k])) counts[_choices[k]]++;
  }

  // Filtra
  let list = _comparablePoems;
  if (_filter === 'undecided') {
    list = list.filter(p => !_choices[p.number]);
  } else if (['WEB','v1','v2','v3'].includes(_filter)) {
    list = list.filter(p => _choices[p.number] === _filter);
  }

  container.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="margin:0 0 4px; font-size:1rem; font-weight:600; color:var(--accent); letter-spacing:1px; text-transform:uppercase;">Versões A/B — Akimaro Kin'eishū</h2>
      <p style="font-size:0.85rem; color:var(--text-muted); margin:0;">Para cada poema, escolha entre Web (Gemini Studio) e as três versões da API. As escolhas ficam salvas no seu navegador (localStorage). Quando terminar, exporte o JSON e aplique via script Python.</p>
    </div>

    <div class="pv-stats" style="display:flex; gap:16px; flex-wrap:wrap; padding:16px; background:var(--bg-quiet); border-radius:8px; margin-bottom:20px;">
      <div><strong style="font-size:1.4rem;">${decided}/${total}</strong> <span style="color:var(--text-muted); font-size:0.85rem;">decididos</span></div>
      ${Object.entries(counts).map(([k, n]) =>
        n > 0 ? `<div style="font-size:0.85rem;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${VERSION_LABELS[k].color};margin-right:6px;vertical-align:middle;"></span><strong>${n}</strong> <span style="color:var(--text-muted)">${VERSION_LABELS[k].short}</span></div>` : ''
      ).filter(Boolean).join('')}
      <div style="margin-left:auto; display:flex; gap:8px;">
        <button class="btn-sm" id="pv-export-btn">⬇ Exportar JSON</button>
        <button class="btn-sm" id="pv-import-btn">⬆ Importar JSON</button>
        <input type="file" id="pv-import-file" accept=".json" style="display:none;">
        <button class="btn-sm" id="pv-reset-btn" style="color:var(--text-muted);">⟲ Resetar escolhas</button>
      </div>
    </div>

    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:20px;">
      <button class="pv-filter ${_filter === 'all' ? 'is-active' : ''}" data-filter="all">Todos (${total})</button>
      <button class="pv-filter ${_filter === 'undecided' ? 'is-active' : ''}" data-filter="undecided">Indecisos (${undecided})</button>
      ${['WEB','v1','v2','v3'].map(k => counts[k] > 0
        ? `<button class="pv-filter ${_filter === k ? 'is-active' : ''}" data-filter="${k}">${VERSION_LABELS[k].short} (${counts[k]})</button>`
        : ''
      ).join('')}
    </div>

    <div id="pv-list">
      ${list.length === 0
        ? '<div class="loading">Nenhum poema neste filtro.</div>'
        : list.map(_renderPoemCard).join('')}
    </div>
  `;

  _wireEvents();
}

function _renderPoemCard(poem) {
  const versions = _gatherVersions(poem);
  const chosen = _choices[poem.number];
  return `
    <div class="pv-card" data-poem-number="${poem.number}" style="background:var(--bg-quiet); border:1px solid var(--border); border-radius:10px; padding:18px; margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;">
        <div>
          <span style="font-weight:600; color:var(--text-muted); font-size:0.8rem;">№ ${String(poem.number).padStart(3,'0')}</span>
          <span style="margin-left:10px; font-size:0.75rem; color:var(--text-muted);">${_escHtml(poem.section_pt || '')} · ${_escHtml(poem.section_jp || '')}</span>
          ${poem.date ? `<span style="margin-left:10px; font-size:0.7rem; color:var(--text-muted); font-style:italic;">${_escHtml(poem.date)}</span>` : ''}
        </div>
        ${chosen
          ? `<span style="font-size:0.7rem; padding:3px 8px; border-radius:10px; background:${VERSION_LABELS[chosen].color}33; color:${VERSION_LABELS[chosen].color}; font-weight:600; text-transform:uppercase;">${VERSION_LABELS[chosen].short} escolhido</span>`
          : '<span style="font-size:0.7rem; color:var(--text-muted); font-style:italic;">indeciso</span>'}
      </div>

      <div style="font-family:'Noto Serif JP', serif; font-size:1.1rem; font-weight:600; padding:10px 0; border-bottom:1px solid var(--border); margin-bottom:12px;">
        ${_escHtml(poem.original)}
      </div>
      <div style="font-family:'Crimson Pro', serif; font-style:italic; color:var(--text-muted); font-size:0.9rem; margin-bottom:14px;">
        ${_escHtml(poem.reading || '')}
      </div>

      <div class="pv-versions" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:10px;">
        ${versions.map(v => {
          const isChosen = chosen === v.key;
          const meta = VERSION_LABELS[v.key];
          return `
            <label class="pv-version ${isChosen ? 'is-chosen' : ''}" style="
              display:block;
              border:2px solid ${isChosen ? meta.color : 'var(--border)'};
              border-radius:8px;
              padding:12px;
              cursor:pointer;
              background:${isChosen ? meta.color + '11' : 'transparent'};
              transition:border-color 0.15s, background 0.15s;
            ">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-size:0.7rem; font-weight:600; text-transform:uppercase; color:${meta.color}; letter-spacing:0.5px;">${meta.short}</span>
                <input type="radio" name="pv-${poem.number}" value="${v.key}" ${isChosen ? 'checked' : ''} class="pv-radio" data-poem="${poem.number}">
              </div>
              <div style="font-weight:600; font-size:0.9rem; margin-bottom:6px;">${_escHtml(v.title)}</div>
              <div style="font-size:0.85rem; line-height:1.5; color:var(--text-main);">${_escHtml(v.translation)}</div>
            </label>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function _wireEvents() {
  document.querySelectorAll('.pv-radio').forEach(r => {
    r.addEventListener('change', e => {
      const n = parseInt(e.target.dataset.poem, 10);
      const k = e.target.value;
      _choices[n] = k;
      _saveChoices();
      _renderUI();
    });
  });

  document.querySelectorAll('.pv-filter').forEach(b => {
    b.addEventListener('click', () => {
      _filter = b.dataset.filter;
      _renderUI();
    });
  });

  const exportBtn = document.getElementById('pv-export-btn');
  if (exportBtn) exportBtn.addEventListener('click', _exportChoices);

  const importBtn = document.getElementById('pv-import-btn');
  const importFile = document.getElementById('pv-import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', _importChoices);
  }

  const resetBtn = document.getElementById('pv-reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (confirm('Apagar TODAS as escolhas? Esta ação é local — exporte antes se quiser preservar.')) {
      _choices = {};
      _saveChoices();
      _renderUI();
    }
  });
}

function _exportChoices() {
  const out = {
    exported_at: new Date().toISOString(),
    total_choices: Object.keys(_choices).length,
    choices: {}
  };
  // Inclui detalhes do conteúdo de cada escolha para aplicação clara
  for (const [num, key] of Object.entries(_choices)) {
    const poem = _allPoems.find(p => p.number === parseInt(num, 10));
    if (!poem) continue;
    const versions = _gatherVersions(poem);
    const chosen = versions.find(v => v.key === key);
    if (!chosen) continue;
    out.choices[num] = {
      version: key,
      title: chosen.title,
      translation: chosen.translation,
    };
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `akimaro_choices_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function _importChoices(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.choices) {
        alert('Formato inválido: esperava objeto com campo `choices`.');
        return;
      }
      if (!confirm(`Importar ${Object.keys(parsed.choices).length} escolhas? As escolhas atuais serão substituídas.`)) return;
      _choices = {};
      for (const [num, v] of Object.entries(parsed.choices)) {
        _choices[num] = v.version || v;
      }
      _saveChoices();
      _renderUI();
    } catch (err) {
      alert('Erro ao ler JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = ''; // permite re-importar mesmo arquivo
}

// Expor para admin.js / switchTab
window.loadPoetryVersions = loadPoetryVersions;
