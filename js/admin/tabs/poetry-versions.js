// ============================================================
// Akimaro Kin'eishū — editor unificado (aba "Versões A/B" do admin)
//
// Tela única por poema:
//   1. As 4 variantes (WEB / v1 / v2 / v3) sempre visíveis lado a lado.
//   2. Clicar numa variante preenche Título/Tradução abaixo (= edição pendente).
//   3. Inputs editáveis pra criar uma 5ª versão personalizada.
//   4. "✨ Sugerir IA" abre claude.ai com prompt contextualizado (variantes
//       incluídas) — cola a resposta de volta pra virar pending edit.
//   5. "💾 Publicar" sobe o JSON inteiro pro Supabase Storage. Sem export,
//       sem script Python, sem commit.
//
// Fonte: bucket `teachings`, path `poetry/akimaro-kineishu.json`.
// ============================================================
import { _escHtml, logAdminAction } from '../shared/helpers.js';
import { supabase } from '../../supabase-config.js';

const BUCKET           = 'teachings';
const STORAGE_PATH     = 'poetry/akimaro-kineishu.json';
const LS_PENDING_EDITS = 'akimaro_editor_pending_v1';
const CLAUDE_TAB_NAME  = 'claude-ai-akimaro';
const PAGE_SIZE        = 25;

const VERSION_LABELS = {
  WEB: { label: 'Web (Gemini Studio)',           color: '#7a9b6e', short: 'WEB' },
  v1:  { label: 'API v1 (temp 0.65)',            color: '#9c8a4e', short: 'v1'  },
  v2:  { label: 'API v2 (ousado, temp 0.95)',    color: '#a86e6e', short: 'v2'  },
  v3:  { label: 'API v3 (econ. poética, 0.80)',  color: '#5e7ea8', short: 'v3'  },
};

// Versão enxuta do prompt mestre (docs/akimaro_kineishu_translation_prompt.md)
// — calibrada pra revisão pontual de UM poema, não tradução em lote.
const POETRY_GUIDELINES = `Você é Tradutor Editorial Sênior e Especialista em Espiritualidade Oriental, com autoridade na filosofia de Meishu-Sama (Mokichi Okada) e estética literária japonesa (Waka/Tanka).

REGRAS DE OURO:
- Fluidez nobre: PT culto, rítmico e visual. NUNCA copie a ordem SOV do japonês. Vocabulário elevado ("Gélido" > "frio"; "Crepúsculo" > "fim de tarde").
- Fidelidade espiritual: interprete sob ótica de Verdade/Bem/Belo, Lei da Natureza, transição das Eras.
- Vocabulário japonês:
  • SEMPRE em romaji (doutrinários: Kannon, Johrei, Komyo, Kototama, Yuzuriha, Aware, Yugen, Izunome, Makoto, Mahikari no Mitama, Tariki, Kannongyo, Myochiriki, Misogi, Wakō Dōjin, Daikomyo Nyorai, Koyokai, Nyorai; geográficos: Fuji, Tamagawa, Hakone, Atami, Ise, Moto-Ise, Tsujidō, Hiratsuka, Odawara, Manazuru, Hakkeien, Kanrei, Komagatake, Kamiyama, Yugyōji, Shinsenkyō, Sekirakuen).
  • SEMPRE traduzir: Kirisuto→Cristo, Shaka→Buda, Hotoke/Mihotoke→Buda/Precioso Buda, Magakami→deuses sombrios (plural minúsculo), Ten/Ame→Céu, Tengoku→Paraíso, Mahito→Homem Verdadeiro.
- Volição em 1ª pessoa singular: formas -an/-mu/-n com 吾/われ traduzem como "provarei", NUNCA "provemos". 1ª pessoa plural só com われら explícito.

CONTEXTO:
- Pseudônimo do autor: 東山明麿 (Higashiyama Akimaro) — Meishu-Sama em 1949.
- Coletânea: 486 tanka publicada em 30/11/1949.`;

// Estado
let _rawData = null;
let _allPoems = [];
let _pendingEdits = {};
let _editPage = 0;
let _editQuery = '';
let _editFilterPending = false;
let _publishing = false;
let _loadedAt = null;

// ─── localStorage (rascunho local até Publicar) ──────────────
function _loadPendingEdits() {
  try {
    const raw = localStorage.getItem(LS_PENDING_EDITS);
    if (raw) _pendingEdits = JSON.parse(raw) || {};
  } catch (e) { _pendingEdits = {}; }
}
function _savePendingEdits() {
  try { localStorage.setItem(LS_PENDING_EDITS, JSON.stringify(_pendingEdits)); } catch (e) {}
}
function _clearPendingEdits() {
  _pendingEdits = {};
  try { localStorage.removeItem(LS_PENDING_EDITS); } catch (e) {}
}

// ─── Storage I/O ─────────────────────────────────────────────
async function _loadFromStorage() {
  const { data, error } = await supabase.storage.from(BUCKET).download(STORAGE_PATH);
  if (error) throw new Error(`Download falhou: ${error.message}`);
  const text = await data.text();
  return JSON.parse(text);
}

function _applyPendingEditsToRawData() {
  for (const [numStr, edits] of Object.entries(_pendingEdits)) {
    const n = parseInt(numStr, 10);
    for (const sec of _rawData.sections || []) {
      const poem = (sec.poems || []).find(p => p.number === n);
      if (!poem) continue;
      if (edits.title != null) poem.title = edits.title;
      if (edits.translation != null) {
        poem.translation = edits.translation;
        if (poem.translation_pending && edits.translation.trim()) {
          poem.translation_pending = false;
        }
      }
    }
  }
}

async function _publishToStorage() {
  _applyPendingEditsToRawData();
  const blob = new Blob([JSON.stringify(_rawData, null, 2)], { type: 'application/json' });
  const { error } = await supabase.storage.from(BUCKET).upload(STORAGE_PATH, blob, {
    upsert: true,
    contentType: 'application/json',
    cacheControl: '0'
  });
  if (error) throw new Error(`Upload falhou: ${error.message}`);
}

// ─── Helpers ─────────────────────────────────────────────────
function _gatherVersions(poem) {
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

// Qual variante coincide com o estado atual (pending edits aplicados sobre poema)?
// Retorna a key ('WEB'/'v1'/'v2'/'v3') ou null se for personalizado.
function _detectActiveVariant(poem, pend) {
  const titleNow = pend?.title != null ? pend.title : (poem.title || '');
  const transNow = pend?.translation != null ? pend.translation : (poem.translation || '');
  for (const v of _gatherVersions(poem)) {
    if (v.title === titleNow && v.translation === transNow) return v.key;
  }
  return null;
}

// ─── Entry point ─────────────────────────────────────────────
async function loadPoetryVersions() {
  const container = document.getElementById('pv-container');
  if (!container) return;
  container.innerHTML = '<div class="loading">Carregando poemas do Supabase Storage…</div>';

  _loadPendingEdits();

  try {
    _rawData = await _loadFromStorage();
    _loadedAt = new Date();
    _allPoems = [];
    for (const sec of _rawData.sections || []) {
      for (const p of sec.poems || []) {
        _allPoems.push({ ...p, section_pt: sec.title_pt, section_jp: sec.title_jp });
      }
    }
    _renderUI();
  } catch (e) {
    container.innerHTML = `<div class="msg err">Erro ao carregar: ${_escHtml(e.message)}</div>`;
  }
}

// ─── Shell (header + publish bar + body slot) ────────────────
function _renderUI() {
  const container = document.getElementById('pv-container');
  if (!container) return;

  container.innerHTML = `
    <div style="margin-bottom:18px;">
      <h2 style="margin:0 0 4px; font-size:1rem; font-weight:600; color:var(--accent); letter-spacing:1px; text-transform:uppercase;">Akimaro Kin'eishū — ${_allPoems.length} poemas</h2>
      <p style="font-size:0.78rem; color:var(--text-muted); margin:0;">
        Fonte: <code style="font-size:0.72rem;">${BUCKET}/${STORAGE_PATH}</code> · carregado ${_loadedAt ? _loadedAt.toLocaleTimeString('pt-BR') : '—'}.
        Escolha uma variante ou edite os campos — as mudanças ficam locais até você clicar em <strong>Publicar</strong>.
      </p>
    </div>

    <div class="pv-shell-bar" style="display:flex; gap:8px; align-items:center; margin-bottom:18px; flex-wrap:wrap;">
      <div id="pv-publish-area" style="display:flex; align-items:center; gap:8px; margin-left:auto;">
        ${_renderPublishBar()}
      </div>
    </div>

    <div id="pv-body"></div>
  `;

  _wirePublishArea();
  _renderEditor();
}

function _renderPublishBar() {
  const n = Object.keys(_pendingEdits).length;
  if (n === 0) {
    return `<span style="font-size:0.78rem; color:var(--text-muted);">Sem edições pendentes</span>`;
  }
  return `
    <span style="font-size:0.78rem; color:#ff9500; font-weight:600;">${n} ediç${n === 1 ? 'ão' : 'ões'} não publicada${n === 1 ? '' : 's'}</span>
    <button id="pv-publish-btn" style="padding:8px 16px; background:#34c759; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.85rem; font-weight:600;">💾 Publicar no Storage</button>
    <button id="pv-discard-btn" style="padding:6px 10px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; cursor:pointer; font-size:0.78rem;" title="Descartar ediç${n === 1 ? 'ão' : 'ões'} pendente${n === 1 ? '' : 's'} (local — o publicado não muda)">⟲ Descartar</button>
  `;
}

function _wirePublishArea() {
  const btn = document.getElementById('pv-publish-btn');
  if (btn) btn.addEventListener('click', _onPublish);
  const dis = document.getElementById('pv-discard-btn');
  if (dis) dis.addEventListener('click', _onDiscardEdits);
}

function _refreshPublishArea() {
  const area = document.getElementById('pv-publish-area');
  if (!area) return;
  area.innerHTML = _renderPublishBar();
  _wirePublishArea();
}

async function _onPublish() {
  if (_publishing) return;
  const n = Object.keys(_pendingEdits).length;
  if (n === 0) return;
  if (!confirm(`Publicar ${n} ediç${n === 1 ? 'ão' : 'ões'} no Supabase Storage?\n\nO site público lerá esta versão imediatamente (após próximo carregamento).`)) return;

  const btn = document.getElementById('pv-publish-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Publicando…'; }
  _publishing = true;

  try {
    await _publishToStorage();
    await logAdminAction('akimaro_publish', {
      poems_edited: n,
      numbers: Object.keys(_pendingEdits).map(Number).sort((a,b) => a - b)
    });
    _clearPendingEdits();
    _publishing = false;
    alert('Publicado ✓\n\nO Storage tem a nova versão.');
    await loadPoetryVersions();
  } catch (e) {
    _publishing = false;
    if (btn) { btn.disabled = false; btn.innerHTML = '💾 Publicar no Storage'; }
    alert('Falha ao publicar: ' + e.message);
  }
}

function _onDiscardEdits() {
  const n = Object.keys(_pendingEdits).length;
  if (n === 0) return;
  if (!confirm(`Descartar ${n} ediç${n === 1 ? 'ão' : 'ões'} pendentes?\n\nIsto não afeta o que já foi publicado — só apaga seu rascunho local.`)) return;
  _clearPendingEdits();
  _renderUI();
}

// ─── Editor (única tela) ─────────────────────────────────────
function _filteredList() {
  let list = _allPoems;
  if (_editFilterPending) list = list.filter(p => _pendingEdits[p.number]);
  if (_editQuery) {
    const q = _editQuery.toLowerCase();
    list = list.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.translation || '').toLowerCase().includes(q) ||
      (p.original || '').toLowerCase().includes(q) ||
      (p.reading || '').toLowerCase().includes(q) ||
      String(p.number).includes(q)
    );
  }
  return list;
}

function _renderEditor() {
  const body = document.getElementById('pv-body');
  if (!body) return;

  const list = _filteredList();
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (_editPage >= totalPages) _editPage = 0;
  const start = _editPage * PAGE_SIZE;
  const pageList = list.slice(start, start + PAGE_SIZE);
  const nPending = Object.keys(_pendingEdits).length;

  body.innerHTML = `
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:14px;">
      <input id="pv-search" type="search" value="${_escHtml(_editQuery)}" placeholder="Buscar por nº, título, leitura, original ou tradução…" style="flex:1; min-width:280px; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:0.85rem;">
      <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:var(--text-muted); cursor:pointer;">
        <input id="pv-pending-only" type="checkbox" ${_editFilterPending ? 'checked' : ''} ${nPending === 0 ? 'disabled' : ''}> só com edições pendentes${nPending > 0 ? ` (${nPending})` : ''}
      </label>
    </div>
    <div style="font-size:0.78rem; color:var(--text-muted); margin-bottom:12px;">
      ${total} poema${total === 1 ? '' : 's'} · pág. ${_editPage + 1}/${totalPages} · mostrando ${pageList.length}
    </div>

    <div id="pv-edit-list">
      ${pageList.length === 0
        ? '<div class="loading">Nada por aqui. Limpe o filtro ou tente outra busca.</div>'
        : pageList.map(_renderEditCard).join('')}
    </div>

    <div style="display:flex; justify-content:center; gap:8px; margin-top:24px;">
      <button class="btn-sm pv-page" data-action="first" ${_editPage === 0 ? 'disabled' : ''}>« Primeiro</button>
      <button class="btn-sm pv-page" data-action="prev"  ${_editPage === 0 ? 'disabled' : ''}>‹ Anterior</button>
      <span style="align-self:center; font-size:0.8rem; color:var(--text-muted); padding:0 8px;">${_editPage + 1} / ${totalPages}</span>
      <button class="btn-sm pv-page" data-action="next"  ${_editPage >= totalPages - 1 ? 'disabled' : ''}>Próximo ›</button>
      <button class="btn-sm pv-page" data-action="last"  ${_editPage >= totalPages - 1 ? 'disabled' : ''}>Último »</button>
    </div>
  `;

  _wireEditorEvents();
}

function _renderEditCard(poem) {
  const num = poem.number;
  const versions = _gatherVersions(poem);
  const pend = _pendingEdits[num] || {};
  const titleNow = pend.title != null ? pend.title : (poem.title || '');
  const transNow = pend.translation != null ? pend.translation : (poem.translation || '');
  const dirty = Object.keys(pend).length > 0;
  const pending = poem.translation_pending && !pend.translation;
  const accent = dirty ? '#ff9500' : (pending ? '#888' : 'var(--accent)');
  const activeVariant = _detectActiveVariant(poem, pend);
  const isCustom = dirty && activeVariant === null;

  const variantsBlock = versions.length === 0 ? '' : `
    <div style="font-size:0.72rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin:14px 0 8px;">
      Escolha uma das ${versions.length} variantes (ou edite os campos abaixo pra criar nova)
    </div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px;">
      ${versions.map(v => {
        const meta = VERSION_LABELS[v.key];
        const isActive = activeVariant === v.key;
        return `
          <label class="pv-variant" data-num="${num}" data-key="${v.key}" style="display:block; border:2px solid ${isActive ? meta.color : 'var(--border)'}; background:${isActive ? meta.color + '11' : 'var(--bg)'}; border-radius:8px; padding:10px; cursor:pointer; transition:border-color 0.15s, background 0.15s;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="font-size:0.65rem; font-weight:700; color:${meta.color}; text-transform:uppercase; letter-spacing:0.5px;">${meta.short}</span>
              <input type="radio" name="pv-var-${num}" value="${v.key}" ${isActive ? 'checked' : ''} class="pv-variant-radio" data-num="${num}" data-key="${v.key}">
            </div>
            <div style="font-weight:600; font-size:0.82rem; margin-bottom:4px; color:var(--text);">${_escHtml(v.title)}</div>
            <div style="font-size:0.78rem; line-height:1.5; color:var(--text-muted);">${_escHtml(v.translation)}</div>
          </label>
        `;
      }).join('')}
    </div>
  `;

  return `
    <div class="pv-card" data-num="${num}" style="background:var(--bg-quiet); border:1px solid var(--border); border-left:4px solid ${accent}; border-radius:10px; padding:16px; margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px; gap:10px; flex-wrap:wrap;">
        <div>
          <span style="font-weight:600; color:var(--text-muted); font-size:0.8rem;">№ ${String(num).padStart(3,'0')}</span>
          <span style="margin-left:10px; font-size:0.75rem; color:var(--text-muted);">${_escHtml(poem.section_pt || '')}</span>
          ${poem.date ? `<span style="margin-left:10px; font-size:0.7rem; color:var(--text-muted); font-style:italic;">${_escHtml(poem.date)}</span>` : ''}
          ${pending ? '<span style="margin-left:10px; font-size:0.7rem; padding:2px 6px; background:#88888833; color:#888; border-radius:8px;">não-traduzido</span>' : ''}
          ${dirty ? `<span style="margin-left:10px; font-size:0.7rem; padding:2px 6px; background:#ff950033; color:#ff9500; border-radius:8px; font-weight:600;">${isCustom ? 'PERSONALIZADO' : 'VARIANTE ' + (VERSION_LABELS[activeVariant]?.short || '?')}</span>` : ''}
        </div>
        <div style="display:flex; gap:6px;">
          <button class="pv-ai" data-num="${num}" style="padding:5px 10px; background:rgba(99,102,241,0.12); color:#6366f1; border:1px solid rgba(99,102,241,0.3); border-radius:6px; font-size:0.75rem; font-weight:600; cursor:pointer;">✨ Sugerir IA</button>
          ${dirty ? `<button class="pv-revert" data-num="${num}" style="padding:5px 10px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.75rem; cursor:pointer;" title="Descartar ediç${Object.keys(pend).length === 1 ? 'ão' : 'ões'} deste poema">↶ Reverter</button>` : ''}
        </div>
      </div>

      <div style="font-family:'Noto Serif JP', serif; font-size:1.05rem; padding:8px 0; border-bottom:1px solid var(--border); margin-bottom:10px;">
        ${_escHtml(poem.original || '')}
      </div>
      <div style="font-family:'Crimson Pro', serif; font-style:italic; color:var(--text-muted); font-size:0.85rem;">
        ${_escHtml(poem.reading || '')}
      </div>

      ${variantsBlock}

      <div style="margin-top:14px; padding-top:14px; border-top:1px dashed var(--border);">
        <label style="display:block; font-size:0.7rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Título PT (editável)</label>
        <input class="pv-edit-title" data-num="${num}" type="text" value="${_escHtml(titleNow)}" placeholder="(sem título)" style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:0.95rem; font-weight:600; margin-bottom:10px;">

        <label style="display:block; font-size:0.7rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Tradução PT (editável)</label>
        <textarea class="pv-edit-trans" data-num="${num}" rows="3" placeholder="(sem tradução)" style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:0.9rem; font-family:'Crimson Pro', serif; line-height:1.55; resize:vertical;">${_escHtml(transNow)}</textarea>
      </div>

      <div class="pv-ai-panel" id="pv-ai-panel-${num}" style="display:none; margin-top:12px; padding:12px; background:rgba(99,102,241,0.04); border:1px solid rgba(99,102,241,0.2); border-radius:8px;"></div>
    </div>
  `;
}

function _wireEditorEvents() {
  const search = document.getElementById('pv-search');
  if (search) {
    let timer;
    search.addEventListener('input', e => {
      clearTimeout(timer);
      const v = e.target.value;
      timer = setTimeout(() => { _editQuery = v; _editPage = 0; _renderEditor(); }, 200);
    });
  }
  const pf = document.getElementById('pv-pending-only');
  if (pf) pf.addEventListener('change', e => {
    _editFilterPending = e.target.checked; _editPage = 0; _renderEditor();
  });

  document.querySelectorAll('.pv-page').forEach(b => {
    b.addEventListener('click', () => {
      const list = _filteredList();
      const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      const a = b.dataset.action;
      if (a === 'first') _editPage = 0;
      else if (a === 'prev')  _editPage = Math.max(0, _editPage - 1);
      else if (a === 'next')  _editPage = Math.min(totalPages - 1, _editPage + 1);
      else if (a === 'last')  _editPage = totalPages - 1;
      _renderEditor();
      document.getElementById('pv-edit-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Click em qualquer parte da label da variante → seleciona aquela variante
  document.querySelectorAll('.pv-variant').forEach(label => {
    label.addEventListener('click', e => {
      // Evita double-fire quando o click foi no radio nativo
      if (e.target.tagName === 'INPUT') return;
      const num = parseInt(label.dataset.num, 10);
      const key = label.dataset.key;
      _useVariant(num, key);
    });
  });
  document.querySelectorAll('.pv-variant-radio').forEach(r => {
    r.addEventListener('change', e => {
      const num = parseInt(e.target.dataset.num, 10);
      const key = e.target.dataset.key;
      _useVariant(num, key);
    });
  });

  document.querySelectorAll('.pv-edit-title').forEach(inp => {
    inp.addEventListener('input', e => _onEditField(parseInt(inp.dataset.num,10), 'title', e.target.value));
  });
  document.querySelectorAll('.pv-edit-trans').forEach(inp => {
    inp.addEventListener('input', e => _onEditField(parseInt(inp.dataset.num,10), 'translation', e.target.value));
  });

  document.querySelectorAll('.pv-ai').forEach(b => {
    b.addEventListener('click', () => _suggestAIForPoem(parseInt(b.dataset.num, 10)));
  });
  document.querySelectorAll('.pv-revert').forEach(b => {
    b.addEventListener('click', () => _revertEditsForPoem(parseInt(b.dataset.num, 10)));
  });
}

function _onEditField(num, field, value) {
  const poem = _allPoems.find(p => p.number === num);
  if (!poem) return;
  const original = ((field === 'title' ? poem.title : poem.translation) || '');
  if (value === original) {
    if (_pendingEdits[num]) {
      delete _pendingEdits[num][field];
      if (Object.keys(_pendingEdits[num]).length === 0) delete _pendingEdits[num];
    }
  } else {
    _pendingEdits[num] = _pendingEdits[num] || {};
    _pendingEdits[num][field] = value;
  }
  _savePendingEdits();
  _refreshPublishArea();
  _refreshCardChrome(num);
}

function _revertEditsForPoem(num) {
  if (!_pendingEdits[num]) return;
  delete _pendingEdits[num];
  _savePendingEdits();
  _renderEditor();
  _refreshPublishArea();
}

function _useVariant(num, versionKey) {
  const poem = _allPoems.find(p => p.number === num);
  if (!poem) return;
  const v = _gatherVersions(poem).find(x => x.key === versionKey);
  if (!v) return;
  _pendingEdits[num] = {};
  if (v.title !== (poem.title || '')) _pendingEdits[num].title = v.title;
  if (v.translation !== (poem.translation || '')) _pendingEdits[num].translation = v.translation;
  if (Object.keys(_pendingEdits[num]).length === 0) delete _pendingEdits[num];
  _savePendingEdits();
  _renderEditor();
  _refreshPublishArea();
}

// Atualiza apenas a borda esquerda e o badge "PENDENTE/PERSONALIZADO/VARIANTE"
// do card, sem re-renderizar tudo — preserva o foco do input enquanto o user digita.
function _refreshCardChrome(num) {
  const card = document.querySelector(`.pv-card[data-num="${num}"]`);
  if (!card) return;
  const poem = _allPoems.find(p => p.number === num);
  if (!poem) return;
  const pend = _pendingEdits[num] || {};
  const dirty = Object.keys(pend).length > 0;
  const pending = poem.translation_pending && !pend.translation;
  card.style.borderLeftColor = dirty ? '#ff9500' : (pending ? '#888' : 'var(--accent)');
}

// ─── AI Suggestion (copy-paste claude.ai) ────────────────────
async function _suggestAIForPoem(num) {
  const poem = _allPoems.find(p => p.number === num);
  if (!poem) return;

  const pend = _pendingEdits[num] || {};
  const titleNow = pend.title != null ? pend.title : (poem.title || '');
  const transNow = pend.translation != null ? pend.translation : (poem.translation || '');
  const versions = _gatherVersions(poem);
  const variantsText = versions.length
    ? versions.map(v => `**${VERSION_LABELS[v.key].short}:** "${v.title}" — ${v.translation}`).join('\n')
    : '(sem variantes Gemini)';

  const prompt = `${POETRY_GUIDELINES}

---

## CONTEXTO: REVISÃO DE UM POEMA DA COLETÂNEA AKIMARO KIN'EISHŪ

Estou revisando a tradução do poema nº ${num} (seção "${poem.section_pt || ''}" / ${poem.section_jp || ''}). Quero sua sugestão para um título e tradução PT-BR que honrem o Kototama, o Yugen e a lição espiritual do original, aplicando todas as regras acima.

## POEMA ORIGINAL

**Original (kanji+hiragana):** ${poem.original || ''}
**Leitura (romaji):** ${poem.reading || ''}
**Data:** ${poem.date || '(sem data)'}
${poem.kigo ? `**Kigo (estação):** ${poem.kigo}\n` : ''}${poem.kototama ? `**Kototama:** ${poem.kototama}\n` : ''}${poem.profundidade ? `**Profundidade:** ${poem.profundidade}\n` : ''}
## TRADUÇÃO ATUAL EM USO

**Título atual:** ${titleNow || '(sem título)'}
**Tradução atual:** ${transNow || '(sem tradução)'}

## VARIANTES JÁ GERADAS PELO PIPELINE GEMINI

${variantsText}

---

## TAREFA

Compare o original com a tradução atual e variantes. Sugira UMA versão definitiva aplicando rigorosamente as regras de ouro acima. Se a tradução atual já estiver excelente, diga "manter como está" e justifique.

Responda **exatamente** neste formato:

**🔍 Análise:**
[O que está bom, o que pode melhorar, qual variante (se houver) está mais próxima do ideal e por quê.]

**✅ Título sugerido:**
[título PT-BR — UMA linha curta, evocativa]

**✅ Tradução sugerida:**
[tradução PT-BR — pode ser 1-2 linhas, respeitando o ritmo 5-7-5-7-7 mas não preso a sílabas]

**💡 Justificativa:**
[Por que esta escolha — qual regra do prompt foi aplicada, qual palavra-chave do Kototama foi preservada, qual decisão de Kigo/Profundidade norteou a tradução.]`;

  try { await navigator.clipboard.writeText(prompt); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = prompt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  }
  window.open('https://claude.ai/new', CLAUDE_TAB_NAME);

  const panel = document.getElementById(`pv-ai-panel-${num}`);
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="font-size:0.72rem; font-weight:600; color:#6366f1; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px;">✨ Sugestão da IA</div>
    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px; line-height:1.5;">
      1) Prompt copiado e claude.ai aberto. Cole com Ctrl+V e envie.<br>
      2) Copie a resposta completa do Claude e cole abaixo.
    </div>
    <textarea class="pv-ai-paste" data-num="${num}" placeholder="Cole aqui a resposta completa do Claude (com 🔍 Análise / ✅ Título / ✅ Tradução / 💡 Justificativa)…" style="width:100%; box-sizing:border-box; min-height:120px; padding:8px 10px; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:0.85rem; font-family:inherit; resize:vertical;"></textarea>
    <div style="display:flex; gap:8px; margin-top:8px; align-items:center;">
      <button class="pv-ai-parse" data-num="${num}" style="padding:6px 14px; background:#6366f1; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">Aplicar sugestão</button>
      <button class="pv-ai-discard" data-num="${num}" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">Cancelar</button>
    </div>
  `;
  panel.querySelector('.pv-ai-parse').addEventListener('click', () => _parseAISuggestionForPoem(num));
  panel.querySelector('.pv-ai-discard').addEventListener('click', () => _discardAIPanel(num));
  setTimeout(() => panel.querySelector('.pv-ai-paste')?.focus(), 100);
}

function _parseAISuggestionForPoem(num) {
  const panel = document.getElementById(`pv-ai-panel-${num}`);
  if (!panel) return;
  const paste = panel.querySelector('.pv-ai-paste');
  if (!paste) return;
  const raw = (paste.value || '').trim();
  if (!raw) return;

  const cleanQuotes = (s) => (s || '').replace(/^["']\s*|\s*["']$/g, '').replace(/^\*+\s*|\s*\*+$/g, '').trim();
  const titleMatch  = raw.match(/✅[^\n]*T[íi]tulo[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\s*✅|\n\s*\*?\*?\s*💡|\n\s*\*?\*?\s*🔍|$)/i);
  const transMatch  = raw.match(/✅[^\n]*Tradu[çc][ãa]o[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\s*💡|\n\s*\*?\*?\s*🔍|$)/i);
  const justMatch   = raw.match(/💡[^\n]*\n+([\s\S]*?)$/);
  const analysisMatch = raw.match(/🔍[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\s*✅|$)/);

  const suggestedTitle = cleanQuotes(titleMatch?.[1]);
  const suggestedTrans = cleanQuotes(transMatch?.[1]);
  const justify  = cleanQuotes(justMatch?.[1]);
  const analysis = cleanQuotes(analysisMatch?.[1]);

  if (!suggestedTitle && !suggestedTrans) {
    panel.innerHTML = `
      <div style="font-size:0.72rem; font-weight:600; color:#ff9500; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px;">⚠ Resposta não estruturada</div>
      <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Não encontrei os marcadores ✅ esperados. Resposta crua:</div>
      <div style="padding:8px 10px; background:var(--bg); border:1px solid var(--border); border-radius:6px; font-size:0.82rem; line-height:1.55; white-space:pre-wrap; max-height:300px; overflow-y:auto;">${_escHtml(raw)}</div>
      <div style="margin-top:8px;"><button class="pv-ai-discard" data-num="${num}" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">Fechar</button></div>
    `;
    panel.querySelector('.pv-ai-discard').addEventListener('click', () => _discardAIPanel(num));
    return;
  }

  const poem = _allPoems.find(p => p.number === num);
  const currentTitle = (_pendingEdits[num]?.title) ?? (poem?.title || '');
  const currentTrans = (_pendingEdits[num]?.translation) ?? (poem?.translation || '');

  panel.innerHTML = `
    <div style="font-size:0.72rem; font-weight:600; color:#6366f1; text-transform:uppercase; letter-spacing:.1em; margin-bottom:10px;">✨ Sugestão da IA</div>
    ${analysis ? `<div style="padding:8px 10px; background:var(--bg); border-left:3px solid var(--text-muted); border-radius:4px; font-size:0.8rem; line-height:1.5; color:var(--text-muted); margin-bottom:10px;"><b>🔍 Análise:</b> ${_escHtml(analysis)}</div>` : ''}
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
      <div>
        <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px; font-weight:600;">Atual</div>
        <div style="padding:8px 10px; background:var(--bg); border:1px solid var(--border); border-radius:6px; font-size:0.85rem; line-height:1.55; min-height:60px;">
          <strong>${_escHtml(currentTitle)}</strong><br>
          <span style="color:var(--text-muted);">${_escHtml(currentTrans)}</span>
        </div>
      </div>
      <div>
        <div style="font-size:0.7rem; color:#6366f1; margin-bottom:4px; font-weight:600;">Sugerido</div>
        <div style="padding:8px 10px; background:rgba(99,102,241,0.04); border:1px solid rgba(99,102,241,0.4); border-radius:6px; font-size:0.85rem; line-height:1.55; min-height:60px;">
          <strong>${_escHtml(suggestedTitle || currentTitle)}</strong><br>
          <span>${_escHtml(suggestedTrans || currentTrans)}</span>
        </div>
      </div>
    </div>
    ${justify ? `<div style="margin-bottom:10px; padding:8px 10px; background:var(--bg); border-left:3px solid #6366f1; border-radius:4px; font-size:0.8rem; line-height:1.5; color:var(--text-muted);"><b>💡 Justificativa:</b> ${_escHtml(justify)}</div>` : ''}
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button class="pv-ai-apply" data-num="${num}" data-title="${_escHtml(suggestedTitle || '')}" data-trans="${_escHtml(suggestedTrans || '')}" style="padding:6px 14px; background:#34c759; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">✓ Aplicar (vai pra pendentes)</button>
      <button class="pv-ai-discard" data-num="${num}" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">Descartar sugestão</button>
    </div>
  `;
  panel.querySelector('.pv-ai-apply').addEventListener('click', () => {
    const t = panel.querySelector('.pv-ai-apply').dataset.title || '';
    const tr = panel.querySelector('.pv-ai-apply').dataset.trans || '';
    _applyAISuggestion(num, t, tr);
  });
  panel.querySelector('.pv-ai-discard').addEventListener('click', () => _discardAIPanel(num));
}

function _applyAISuggestion(num, title, translation) {
  const poem = _allPoems.find(p => p.number === num);
  if (!poem) return;
  _pendingEdits[num] = _pendingEdits[num] || {};
  if (title && title !== (poem.title || '')) _pendingEdits[num].title = title;
  if (translation && translation !== (poem.translation || '')) _pendingEdits[num].translation = translation;
  if (Object.keys(_pendingEdits[num]).length === 0) delete _pendingEdits[num];
  _savePendingEdits();
  _renderEditor();
  _refreshPublishArea();
}

function _discardAIPanel(num) {
  const panel = document.getElementById(`pv-ai-panel-${num}`);
  if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
}

window.loadPoetryVersions = loadPoetryVersions;
