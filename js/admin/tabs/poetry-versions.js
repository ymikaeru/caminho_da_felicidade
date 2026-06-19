// ============================================================
// Correção de Poemas — editor unificado (aba do admin)
//
// Suporta múltiplas coleções (Akemaro, yama, ...) selecionáveis via
// dropdown ou query param ?collection=. Cada coleção tem seu próprio
// path no Storage, key de localStorage, e contexto de prompt — o resto
// do editor é genérico (depende apenas do schema preface/sections/poems).
//
// Tela única por poema:
//   1. Variantes (WEB / v1 / v2 / v3 quando existem) sempre visíveis.
//   2. Clicar numa variante preenche Título/Tradução abaixo (= edição pendente).
//   3. Inputs editáveis pra criar uma versão personalizada.
//   4. "✨ Sugerir IA" abre claude.ai com prompt contextualizado.
//   5. "💾 Publicar" sobe o JSON inteiro pro Supabase Storage.
// ============================================================
import { _escHtml, logAdminAction } from '../shared/helpers.js';
import { supabase } from '../../supabase-config.js';
import { _myUid, allUsers } from '../shared/state.js';

const BUCKET = 'teachings';
const PAGE_SIZE = 25;

// Registry de coleções. Adicionar uma nova = uma entrada aqui, desde
// que o JSON siga o schema padrão (preface, sections[], poems[] com
// number/title/translation/original/reading). storagePath e localPath
// podem divergir (Storage usa hífen; data files usam underscore).
const COLLECTIONS = {
  'Akemaro-kineishu': {
    title: "Akemaro Kin'eishū",
    storagePath: 'poetry/Akemaro-kineishu.json',
    localPath: 'data/poetry/Akemaro_kineishu.json',
    lsKey: 'Akemaro_editor_pending_v1',
    claudeTab: 'claude-ai-Akemaro',
    promptContext:
      '- Pseudônimo do autor: 東山明麿 (Higashiyama Akemaro) — Meishu-Sama em 1949.\n' +
      '- Coletânea: 486 tanka publicada em 30/11/1949.',
  },
  'yama-to-mizu': {
    title: 'Yama to Mizu (山と水)',
    storagePath: 'poetry/yama-to-mizu.json',
    localPath: 'data/poetry/yama_to_mizu.json',
    lsKey: 'yama_editor_pending_v1',
    claudeTab: 'claude-ai-yama',
    promptContext:
      '- Coletânea "Yama to Mizu" (山と水, "Montanhas e Águas") — tanka de Meishu-Sama centrados em paisagens (montanhas, rios, mar, estações).',
  },
  'gosanka-shoban': {
    title: 'Gosanka-shū — 1ª ed. (御讃歌集 初版)',
    storagePath: 'poetry/gosanka-shoban.json',
    localPath: 'data/poetry/gosanka_shoban.json',
    lsKey: 'gosanka_shoban_editor_pending_v1',
    claudeTab: 'claude-ai-gosanka-shoban',
    promptContext:
      '- Coletânea "御讃歌集（初版）" (Gosanka-shū, Primeira Edição) — 309 tanka publicados em julho de 1948, organizados em 40 seções temáticas (Senju Kannon, Kannon Gesho, Tenchi Kaimei, Era do Dia, etc).',
  },
  'gosanka-kaitei': {
    title: 'Gosanka-shū — revisada (御讃歌集 改訂版)',
    storagePath: 'poetry/gosanka-kaitei.json',
    localPath: 'data/poetry/gosanka_kaitei.json',
    lsKey: 'gosanka_kaitei_editor_pending_v1',
    claudeTab: 'claude-ai-gosanka-kaitei',
    promptContext:
      '- Coletânea "御讃歌集（改訂版）" (Gosanka-shū, Edição Revisada) — 462 tanka publicados entre 1951 e 1954 sob a Sekai Kyūsei-kyō. Inclui marcadores: * = poema modificado da 1ª edição; ** = re-publicação literal da 1ª edição.',
  },
  'gosanka-shikiten': {
    title: 'Gosanka — Cerimônias (各式典における御讃歌)',
    storagePath: 'poetry/gosanka-shikiten.json',
    localPath: 'data/poetry/gosanka_shikiten.json',
    lsKey: 'gosanka_shikiten_editor_pending_v1',
    claudeTab: 'claude-ai-gosanka-shikiten',
    promptContext:
      '- Coletânea "各式典における御讃歌" (Cantos Sagrados para Cada Cerimônia) — 564 tanka recitados em cerimônias entre 1936 e 1954 (Grande Culto de Primavera, Risshun, Aniversário Sagrado, Outono, Nikkoden de Hakone, etc). Cada seção tem data e fonte original anotadas.',
  },
};
const DEFAULT_COLLECTION = 'Akemaro-kineishu';

const VERSION_LABELS = {
  WEB: { label: 'Web (Gemini Studio)', color: '#7a9b6e', short: 'WEB' },
  v1: { label: 'API v1 (temp 0.65)', color: '#9c8a4e', short: 'v1' },
  v2: { label: 'API v2 (ousado, temp 0.95)', color: '#a86e6e', short: 'v2' },
  v3: { label: 'API v3 (econ. poética, 0.80)', color: '#5e7ea8', short: 'v3' },
};

// Regras gerais de tradução — válidas pra todas as coleções de tanka
// do Meishu-Sama. O CONTEXTO específico (autor, data, foco) vai por
// coleção no registry (promptContext).
const POETRY_GUIDELINES_BASE = `Você é Tradutor Editorial Sênior e Especialista em Espiritualidade Oriental, com autoridade na filosofia de Meishu-Sama (Mokichi Okada) e estética literária japonesa (Waka/Tanka).

REGRAS DE OURO:
- Fluidez nobre: PT culto, rítmico e visual. NUNCA copie a ordem SOV do japonês. Vocabulário elevado ("Gélido" > "frio"; "Crepúsculo" > "fim de tarde").
- Fidelidade espiritual: interprete sob ótica de Verdade/Bem/Belo, Lei da Natureza, transição das Eras.
- Vocabulário japonês:
  • SEMPRE em romaji (doutrinários: Kannon, Johrei, Komyo, Kototama, Yuzuriha, Aware, Yugen, Izunome, Makoto, Mahikari no Mitama, Tariki, Kannongyo, Myochiriki, Misogi, Wakō Dōjin, Daikomyo Nyorai, Koyokai, Nyorai; geográficos: Fuji, Tamagawa, Hakone, Atami, Ise, Moto-Ise, Tsujidō, Hiratsuka, Odawara, Manazuru, Hakkeien, Kanrei, Komagatake, Kamiyama, Yugyōji, Shinsenkyō, Sekirakuen).
  • SEMPRE traduzir: Kirisuto→Cristo, Shaka→Buda, Hotoke/Mihotoke→Buda/Precioso Buda, Magakami→deuses sombrios (plural minúsculo), Ten/Ame→Céu, Tengoku→Paraíso, Mahito→Homem Verdadeiro.
- Volição em 1ª pessoa singular: formas -an/-mu/-n com 吾/われ traduzem como "provarei", NUNCA "provemos". 1ª pessoa plural só com われら explícito.
- Pontuação enxuta — proibido em-dash decorativo: NÃO adicione travessão (—, –, --) onde o japonês não tem pausa explícita. O tanka clássico marca pausas com kireji (や, かな, けり, ぞ, ね, よ) ou com o espaço wide-jp (　) entre as cinco estrofes 5-7-5-7-7. Pra essas pausas, prefira vírgula, ponto-final, ou simplesmente quebra de linha. Travessão SÓ é aceitável quando há kireji dramático real (や/ぞ em pivô semântico) — caso contrário, é vício de tradutor.`;

// Estado
let _activeCollection = DEFAULT_COLLECTION;
let _rawData = null;
let _allPoems = [];
let _pendingEdits = {};
let _editPage = 0;
let _editQuery = '';
let _editFilterPending = false;
let _editFilterReported = false;
let _publishing = false;
let _loadedAt = null;

// Reportes de erro de tradução (vol='poetry') trazidos pra dentro desta aba
// — antes caíam na aba de Ensinamentos. _reportsAll guarda TODAS as coletâneas
// de poesia (pra contar o badge e sinalizar reportes em outras coletâneas).
let _reportsAll = [];
let _reportsLoading = false;

function _currentConfig() {
  return COLLECTIONS[_activeCollection];
}

// Inicializa a coleção ativa a partir de ?collection=... na URL.
// Mantém links/bookmarks de coleções específicas; browser back/forward
// trocam a coleção sem reload da página.
function _initCollectionFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('collection');
  if (fromUrl && COLLECTIONS[fromUrl]) _activeCollection = fromUrl;
}

function _updateUrlForCollection(key) {
  const url = new URL(window.location.href);
  url.searchParams.set('collection', key);
  window.history.replaceState({}, '', url);
}

// ─── localStorage (rascunho local até Publicar) ──────────────
function _loadPendingEdits() {
  try {
    const raw = localStorage.getItem(_currentConfig().lsKey);
    if (raw) _pendingEdits = JSON.parse(raw) || {};
  } catch (e) { _pendingEdits = {}; }
}
function _savePendingEdits() {
  try { localStorage.setItem(_currentConfig().lsKey, JSON.stringify(_pendingEdits)); } catch (e) { }
}
function _clearPendingEdits() {
  _pendingEdits = {};
  try { localStorage.removeItem(_currentConfig().lsKey); } catch (e) { }
}

// ─── Storage I/O ─────────────────────────────────────────────
async function _loadFromStorage() {
  const cfg = _currentConfig();
  const { data, error } = await supabase.storage.from(BUCKET).download(cfg.storagePath);
  if (!error) {
    const text = await data.text();
    return JSON.parse(text);
  }
  // Fallback APENAS quando o objeto não existe no Storage (1ª edição
  // de uma coleção nova como yama). Erros transitórios (rede, 5xx,
  // auth) precisam propagar — senão o usuário edita em cima de um
  // snapshot local desatualizado e o Publicar clobbera o Storage.
  const msg = error.message || '';
  const status = error.statusCode || error.status || error.originalError?.status;
  const isNotFound = status === 404 || String(status) === '404'
    || /not.?found|object.*not.*exist/i.test(msg);
  if (!isNotFound) {
    throw new Error(`Download falhou (${status || 'erro'}): ${msg}`);
  }
  console.warn(`[poetry-versions] ${_activeCollection} ainda não está no Storage; carregando data file local (${cfg.localPath})`);
  const res = await fetch(cfg.localPath);
  if (!res.ok) throw new Error(`Storage 404 + fallback local também falhou (${res.status})`);
  return await res.json();
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
  const { error } = await supabase.storage.from(BUCKET).upload(_currentConfig().storagePath, blob, {
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
// Pode ser chamado:
//   - sem argumento: lê coleção da URL (?collection=...) ou usa default
//   - com chave de coleção: troca pra essa coleção e atualiza a URL
async function loadPoetryVersions(collection) {
  if (collection && COLLECTIONS[collection]) {
    _activeCollection = collection;
  } else {
    _initCollectionFromUrl();
  }
  _updateUrlForCollection(_activeCollection);

  const container = document.getElementById('pv-container');
  if (!container) return;
  container.innerHTML = '<div class="loading">Carregando poemas do Supabase Storage…</div>';

  // Reset por coleção (estado de busca/página/pendentes é per-collection)
  _rawData = null;
  _allPoems = [];
  _editPage = 0;
  _editQuery = '';
  _editFilterPending = false;
  _editFilterReported = false;
  _reportsAll = [];
  _loadPendingEdits();

  try {
    _rawData = await _loadFromStorage();
    _loadedAt = new Date();
    for (const sec of _rawData.sections || []) {
      for (const p of sec.poems || []) {
        _allPoems.push({ ...p, section_pt: sec.title_pt, section_jp: sec.title_jp });
      }
    }
    _renderUI();
    _loadReportsAndRender(); // async — UI já aparece; reportes entram depois
  } catch (e) {
    container.innerHTML = `<div class="msg err">Erro ao carregar: ${_escHtml(e.message)}</div>`;
  }
}

// ─── Shell (header + publish bar + body slot) ────────────────
function _renderUI() {
  const container = document.getElementById('pv-container');
  if (!container) return;

  const cfg = _currentConfig();
  const options = Object.entries(COLLECTIONS).map(([key, c]) =>
    `<option value="${key}" ${key === _activeCollection ? 'selected' : ''}>${_escHtml(c.title)}</option>`
  ).join('');

  container.innerHTML = `
    <div style="margin-bottom:18px;">
      <div style="display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:6px;">
        <label for="pv-collection-select" style="font-size:0.72rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.1em;">Coletânea</label>
        <select id="pv-collection-select" style="font-size:0.95rem; font-weight:600; color:var(--accent); letter-spacing:0.5px; background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:6px 28px 6px 10px; cursor:pointer;">
          ${options}
        </select>
        <span style="font-size:0.85rem; color:var(--text-muted);">— ${_allPoems.length} poemas</span>
      </div>
      <p style="font-size:0.78rem; color:var(--text-muted); margin:0;">
        Fonte: <code style="font-size:0.72rem;">${BUCKET}/${_escHtml(cfg.storagePath)}</code> · carregado ${_loadedAt ? _loadedAt.toLocaleTimeString('pt-BR') : '—'}.
        Escolha uma variante ou edite os campos — as mudanças ficam locais até você clicar em <strong>Publicar</strong>.
      </p>
    </div>

    <div class="pv-shell-bar" style="display:flex; gap:8px; align-items:center; margin-bottom:18px; flex-wrap:wrap;">
      <div id="pv-publish-area" style="display:flex; align-items:center; gap:8px; margin-left:auto;">
        ${_renderPublishBar()}
      </div>
    </div>

    <div id="pv-reports" style="margin-bottom:18px;"></div>

    <div id="pv-body"></div>
  `;

  _wireCollectionSelector();
  _wirePublishArea();
  _renderReportsSection();
  _renderEditor();
}

function _wireCollectionSelector() {
  const sel = document.getElementById('pv-collection-select');
  if (!sel) return;
  sel.addEventListener('change', e => {
    const next = e.target.value;
    if (!COLLECTIONS[next] || next === _activeCollection) return;
    // Edições pendentes ficam por coleção (lsKey diferente) — só trocar
    // a coleção ativa e recarregar.
    loadPoetryVersions(next);
  });
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
    await logAdminAction(`${_activeCollection.replace(/-/g, '_')}_publish`, {
      collection: _activeCollection,
      poems_edited: n,
      numbers: Object.keys(_pendingEdits).map(Number).sort((a, b) => a - b)
    });
    _clearPendingEdits();
    _publishing = false;
    alert('Publicado ✓\n\nO Storage tem a nova versão.');
    await loadPoetryVersions(_activeCollection);
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
  if (_editFilterReported) {
    const rep = _reportedNumbersForActive();
    list = list.filter(p => rep.has(p.number));
  }
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
  const nReported = _reportedNumbersForActive().size;

  body.innerHTML = `
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:14px;">
      <input id="pv-search" type="search" value="${_escHtml(_editQuery)}" placeholder="Buscar por nº, título, leitura, original ou tradução…" style="flex:1; min-width:280px; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:0.85rem;">
      <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:${nReported > 0 ? '#ff3b30' : 'var(--text-muted)'}; cursor:pointer; font-weight:${nReported > 0 ? '600' : '400'};">
        <input id="pv-reported-only" type="checkbox" ${_editFilterReported ? 'checked' : ''} ${nReported === 0 ? 'disabled' : ''}> 🚩 só com reportes${nReported > 0 ? ` (${nReported})` : ''}
      </label>
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
  const reps = _reportsForPoem(num);
  const accent = dirty ? '#ff9500' : (reps.length ? '#ff3b30' : (pending ? '#888' : 'var(--accent)'));

  // Caixa do reporte logo no card — o admin lê o que foi sinalizado e age
  // (escolhe variante ou retraduz) sem sair de perto dos campos.
  const reportBlock = reps.length === 0 ? '' : `
    <div style="margin-top:14px; border:1px solid #ff3b3033; border-left:3px solid #ff3b30; border-radius:0 8px 8px 0; background:color-mix(in srgb, #ff3b30 5%, transparent); padding:10px 12px; display:flex; flex-direction:column; gap:10px;">
      ${reps.map(r => {
    const corr = r.status === 'corrected';
    const when = new Date(r.created_at).toLocaleDateString('pt-BR');
    return `
        <div style="font-size:0.78rem; line-height:1.5;">
          <div style="display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; margin-bottom:3px;">
            <span style="font-weight:700; color:#ff3b30;">🚩 Reporte de tradução</span>
            ${corr ? '<span style="font-size:0.66rem; padding:1px 7px; border-radius:8px; background:#ffb80022; color:#cc9200; font-weight:600;">corrigido — falta arquivar</span>' : ''}
            <span style="font-size:0.7rem; color:var(--text-muted);">${_escHtml(_reporterName(r.user_id))} · ${when}</span>
            <span style="margin-left:auto; display:flex; gap:6px;">
              ${!corr ? `<button class="pv-report-correct" data-id="${r.id}" style="padding:3px 9px; background:rgba(52,199,89,0.15); color:#1f8a3f; border:1px solid rgba(52,199,89,0.4); border-radius:6px; font-size:0.7rem; font-weight:600; cursor:pointer;">✓ Corrigido</button>` : ''}
              <button class="pv-report-archive" data-id="${r.id}" style="padding:3px 9px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.7rem; cursor:pointer;">📦 Arquivar</button>
            </span>
          </div>
          ${r.description ? `<div style="color:var(--text); font-style:italic;">“${_escHtml(r.description)}”</div>` : '<div style="color:var(--text-muted);">(sem comentário — o leitor só sinalizou o trecho)</div>'}
        </div>`;
  }).join('<div style="border-top:1px dashed var(--border);"></div>')}
    </div>`;
  const activeVariant = _detectActiveVariant(poem, pend);
  const isCustom = dirty && activeVariant === null;

  const variantsBlock = versions.length === 0 ? '' : `
    <div style="font-size:0.72rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin:14px 0 8px;">
      Variantes geradas (clique pra copiar pros campos editáveis abaixo)
    </div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px;">
      ${versions.map(v => {
    const meta = VERSION_LABELS[v.key];
    const isActive = activeVariant === v.key;
    return `
          <div class="pv-variant" data-num="${num}" data-key="${v.key}" role="button" tabindex="0" style="border:1px solid ${isActive ? meta.color + '88' : 'var(--border)'}; background:${isActive ? meta.color + '0d' : 'var(--bg)'}; border-radius:8px; padding:10px; cursor:pointer; transition:border-color 0.15s, background 0.15s; position:relative;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="font-size:0.65rem; font-weight:700; color:${meta.color}; text-transform:uppercase; letter-spacing:0.5px;">${meta.short}${isActive ? ' · em uso' : ''}</span>
              <span style="font-size:0.65rem; color:${meta.color}; opacity:0.7; font-weight:600;">↑ usar</span>
            </div>
            <div style="font-weight:600; font-size:0.82rem; margin-bottom:4px; color:var(--text);">${_escHtml(v.title)}</div>
            <div style="font-size:0.78rem; line-height:1.5; color:var(--text-muted);">${_escHtml(v.translation)}</div>
          </div>
        `;
  }).join('')}
    </div>
  `;

  // Header informativo dos inputs: deixa explícito que ESTE é o conteúdo
  // que vai ser publicado, e sinaliza a origem (variante ou edição manual).
  const originText = activeVariant
    ? `origem: variante ${VERSION_LABELS[activeVariant].short}`
    : (dirty ? 'edição personalizada' : 'igual ao publicado');
  const originColor = activeVariant
    ? VERSION_LABELS[activeVariant].color
    : (dirty ? '#ff9500' : 'var(--text-muted)');

  return `
    <div class="pv-card" data-num="${num}" style="background:var(--bg-quiet); border:1px solid var(--border); border-left:4px solid ${accent}; border-radius:10px; padding:16px; margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px; gap:10px; flex-wrap:wrap;">
        <div>
          <span style="font-weight:600; color:var(--text-muted); font-size:0.8rem;">№ ${String(num).padStart(3, '0')}</span>
          <span style="margin-left:10px; font-size:0.75rem; color:var(--text-muted);">${_escHtml(poem.section_pt || '')}</span>
          ${poem.date ? `<span style="margin-left:10px; font-size:0.7rem; color:var(--text-muted); font-style:italic;">${_escHtml(poem.date)}</span>` : ''}
          ${pending ? '<span style="margin-left:10px; font-size:0.7rem; padding:2px 6px; background:#88888833; color:#888; border-radius:8px;">não-traduzido</span>' : ''}
          ${dirty ? `<span style="margin-left:10px; font-size:0.7rem; padding:2px 6px; background:#ff950033; color:#ff9500; border-radius:8px; font-weight:600;">${isCustom ? 'PERSONALIZADO' : 'VARIANTE ' + (VERSION_LABELS[activeVariant]?.short || '?')}</span>` : ''}
          ${reps.length ? `<span style="margin-left:10px; font-size:0.7rem; padding:2px 6px; background:#ff3b3022; color:#ff3b30; border-radius:8px; font-weight:600;">🚩 ${reps.length} reporte${reps.length === 1 ? '' : 's'}</span>` : ''}
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

      ${reportBlock}

      ${variantsBlock}

      <div style="margin-top:16px; padding:12px; background:var(--bg); border:2px solid #34c75944; border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
          <div style="font-size:0.78rem; font-weight:700; color:#34c759; letter-spacing:0.3px;">
            ✓ Conteúdo final <span style="color:var(--text-muted); font-weight:500;">— este será publicado</span>
          </div>
          <div style="font-size:0.7rem; padding:2px 8px; border-radius:10px; background:${originColor}22; color:${originColor}; font-weight:600;">${originText}</div>
        </div>
        <label style="display:block; font-size:0.7rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Título PT</label>
        <input class="pv-edit-title" data-num="${num}" type="text" value="${_escHtml(titleNow)}" placeholder="(sem título)" style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg-quiet); color:var(--text); font-size:0.95rem; font-weight:600; margin-bottom:10px;">

        <label style="display:block; font-size:0.7rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Tradução PT</label>
        <textarea class="pv-edit-trans" data-num="${num}" rows="3" placeholder="(sem tradução)" style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg-quiet); color:var(--text); font-size:0.9rem; font-family:'Crimson Pro', serif; line-height:1.55; resize:vertical;">${_escHtml(transNow)}</textarea>
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
  const rf = document.getElementById('pv-reported-only');
  if (rf) rf.addEventListener('change', e => {
    _editFilterReported = e.target.checked; _editPage = 0; _renderEditor();
  });

  document.querySelectorAll('.pv-page').forEach(b => {
    b.addEventListener('click', () => {
      const list = _filteredList();
      const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      const a = b.dataset.action;
      if (a === 'first') _editPage = 0;
      else if (a === 'prev') _editPage = Math.max(0, _editPage - 1);
      else if (a === 'next') _editPage = Math.min(totalPages - 1, _editPage + 1);
      else if (a === 'last') _editPage = totalPages - 1;
      _renderEditor();
      document.getElementById('pv-edit-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Click (ou Enter/Espaço) em qualquer parte do card da variante copia
  // título+tradução pros inputs editáveis abaixo.
  document.querySelectorAll('.pv-variant').forEach(card => {
    const trigger = () => {
      const num = parseInt(card.dataset.num, 10);
      _useVariant(num, card.dataset.key);
    };
    card.addEventListener('click', trigger);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }
    });
  });

  document.querySelectorAll('.pv-edit-title').forEach(inp => {
    inp.addEventListener('input', e => _onEditField(parseInt(inp.dataset.num, 10), 'title', e.target.value));
  });
  document.querySelectorAll('.pv-edit-trans').forEach(inp => {
    inp.addEventListener('input', e => _onEditField(parseInt(inp.dataset.num, 10), 'translation', e.target.value));
  });

  document.querySelectorAll('.pv-ai').forEach(b => {
    b.addEventListener('click', () => _suggestAIForPoem(parseInt(b.dataset.num, 10)));
  });
  document.querySelectorAll('.pv-revert').forEach(b => {
    b.addEventListener('click', () => _revertEditsForPoem(parseInt(b.dataset.num, 10)));
  });

  // Botões de reporte dentro dos cards (escopados a #pv-body pra não colidir
  // com os mesmos botões da seção #pv-reports, já ligados em _wireReportsSection).
  document.querySelectorAll('#pv-body .pv-report-correct').forEach(b =>
    b.addEventListener('click', () => _markReport(b.dataset.id, 'corrected', b)));
  document.querySelectorAll('#pv-body .pv-report-archive').forEach(b =>
    b.addEventListener('click', () => _markReport(b.dataset.id, 'verified', b)));
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
  const reported = _reportsForPoem(num).length > 0;
  card.style.borderLeftColor = dirty ? '#ff9500' : (reported ? '#ff3b30' : (pending ? '#888' : 'var(--accent)'));
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

  const cfg = _currentConfig();
  const prompt = `${POETRY_GUIDELINES_BASE}

CONTEXTO:
${cfg.promptContext}

---

## CONTEXTO: REVISÃO DE UM POEMA DA COLETÂNEA ${cfg.title.toUpperCase()}

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
  window.open('https://claude.ai/new', cfg.claudeTab);

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
  const titleMatch = raw.match(/✅[^\n]*T[íi]tulo[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\s*✅|\n\s*\*?\*?\s*💡|\n\s*\*?\*?\s*🔍|$)/i);
  const transMatch = raw.match(/✅[^\n]*Tradu[çc][ãa]o[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\s*💡|\n\s*\*?\*?\s*🔍|$)/i);
  const justMatch = raw.match(/💡[^\n]*\n+([\s\S]*?)$/);
  const analysisMatch = raw.match(/🔍[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\s*✅|$)/);

  const suggestedTitle = cleanQuotes(titleMatch?.[1]);
  const suggestedTrans = cleanQuotes(transMatch?.[1]);
  const justify = cleanQuotes(justMatch?.[1]);
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

// ═══ Reportes de erro de tradução (vol='poetry') ════════════════════
// Os leitores reportam trechos pelo translation-report.js → tabela
// translation_reports. Antes esses reportes caíam na aba de Ensinamentos;
// agora ficam AQUI, na própria aba de correção dos poemas. Fluxo do admin:
// abrir a aba → ver os poemas reportados (lista no topo + filtro "só com
// reportes") → em cada card, escolher uma variante OU retraduzir → Publicar
// → marcar "Corrigido" / "Arquivar". O badge na sidebar mostra o total.

async function _loadReportsAndRender() {
  _reportsLoading = true;
  _renderReportsSection();
  try {
    const { data, error } = await supabase
      .from('translation_reports')
      .select('id, vol, file, topic_id, lang, selected_text, description, created_at, status, user_id, corrected_by, corrected_at, verified_by, verified_at')
      .eq('vol', 'poetry')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    _reportsAll = data || [];
  } catch (e) {
    console.warn('[poetry-versions] falha ao carregar reportes:', e.message);
    _reportsAll = [];
  }
  _reportsLoading = false;
  _renderReportsSection();
  // Só re-renderiza o editor se houver reportes nesta coletânea (pra os chips
  // 🚩 e o contador do filtro aparecerem). Sem reportes, evita re-render à toa
  // (e não mexe num campo de busca que o admin já possa estar usando).
  if (_reportsForActive().length) _renderEditor();
  _updateReportsBadge();
}

// "Abertos" = pendentes + corrigidos (ainda precisam de atenção/arquivo).
// status null (reportes legados sem coluna) conta como pendente.
function _openReports() {
  return _reportsAll.filter(r => !r.status || r.status === 'pending' || r.status === 'corrected');
}
function _reportsForActive() {
  return _openReports().filter(r => r.file === _activeCollection);
}
function _reportsForPoem(num) {
  return _reportsForActive().filter(r => _reportPoemNumber(r) === num);
}
function _reportedNumbersForActive() {
  const set = new Set();
  for (const r of _reportsForActive()) {
    const n = _reportPoemNumber(r);
    if (n != null) set.add(n);
  }
  return set;
}
function _reportPoemNumber(r) {
  const m = String(r.topic_id || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}
function _reporterName(uid) {
  if (!uid) return 'Usuário';
  const u = (allUsers || []).find(x => x.id === uid);
  return u?.display_name || u?.email || 'Usuário';
}

function _updateReportsBadge() {
  const badge = document.getElementById('poetryReportsTabBadge');
  if (!badge) return;
  const n = _openReports().length;
  badge.textContent = n;
  badge.classList.toggle('empty', n === 0);
}

function _renderReportsSection() {
  const host = document.getElementById('pv-reports');
  if (!host) return;

  if (_reportsLoading && _reportsAll.length === 0) {
    host.innerHTML = `<div style="font-size:0.78rem; color:var(--text-muted);">Carregando reportes de tradução…</div>`;
    return;
  }

  const mine = _reportsForActive();

  // Reportes em OUTRAS coletâneas (pra o admin saber que existem e trocar).
  const others = {};
  _openReports().forEach(r => { if (r.file !== _activeCollection) others[r.file] = (others[r.file] || 0) + 1; });
  const otherChips = Object.entries(others).map(([file, n]) =>
    `<button class="pv-report-jumpcol" data-file="${_escHtml(file)}" style="padding:3px 9px; background:var(--bg); border:1px solid var(--border); border-radius:20px; font-size:0.72rem; color:var(--text-muted); cursor:pointer;">${_escHtml((COLLECTIONS[file]?.title) || file)} · ${n}</button>`
  ).join(' ');

  if (mine.length === 0) {
    host.innerHTML = `
      <div style="border:1px dashed var(--border); border-radius:10px; padding:12px 14px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <span style="font-size:0.82rem; color:var(--text-muted);">🚩 Nenhum reporte de tradução pendente nesta coletânea.</span>
        ${otherChips ? `<span style="font-size:0.74rem; color:var(--text-muted);">Em outras:</span> ${otherChips}` : ''}
      </div>`;
    _wireReportsSection();
    return;
  }

  const pending = mine.filter(r => !r.status || r.status === 'pending');
  const corrected = mine.filter(r => r.status === 'corrected');

  host.innerHTML = `
    <div style="border:1px solid color-mix(in srgb, var(--accent) 50%, transparent); border-radius:10px; overflow:hidden;">
      <div class="pv-reports-head" style="display:flex; align-items:center; gap:10px; padding:11px 14px; background:color-mix(in srgb, var(--accent) 9%, transparent); cursor:pointer; flex-wrap:wrap;">
        <span style="font-size:0.9rem; font-weight:700; color:var(--accent);">🚩 Poemas reportados</span>
        <span style="font-size:0.74rem; font-weight:600; padding:2px 9px; border-radius:20px; background:#ff3b3022; color:#ff3b30;">${pending.length} pendente${pending.length === 1 ? '' : 's'}</span>
        ${corrected.length ? `<span style="font-size:0.74rem; font-weight:600; padding:2px 9px; border-radius:20px; background:#ffb80022; color:#cc9200;">${corrected.length} aguardando arquivamento</span>` : ''}
        ${otherChips ? `<span style="margin-left:auto; font-size:0.72rem; color:var(--text-muted);">Outras:</span> ${otherChips}` : '<span style="margin-left:auto;"></span>'}
        <span class="pv-reports-toggle" style="font-size:0.8rem; color:var(--text-muted);">▾</span>
      </div>
      <div class="pv-reports-body" style="padding:10px 12px; display:flex; flex-direction:column; gap:10px;">
        ${[...pending, ...corrected].map(_renderReportRow).join('')}
      </div>
    </div>`;
  _wireReportsSection();
}

function _renderReportRow(r) {
  const num = _reportPoemNumber(r);
  const poem = num != null ? _allPoems.find(p => p.number === num) : null;
  const poemLabel = num != null ? `№ ${String(num).padStart(3, '0')}` : '—';
  const poemTitle = poem ? (poem.title || poem.section_pt || '') : '';
  const date = new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const lang = r.lang === 'ja' ? '🇯🇵' : '🇧🇷';
  const isCorrected = r.status === 'corrected';
  const trecho = _escHtml(r.selected_text || '');
  const desc = r.description ? _escHtml(r.description) : '';

  return `
    <div class="pv-report-row" data-id="${r.id}" style="border:1px solid var(--border); border-left:4px solid ${isCorrected ? '#ffb800' : '#ff3b30'}; border-radius:8px; padding:11px 13px; background:var(--bg);">
      <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin-bottom:7px;">
        <span style="font-weight:700; font-size:0.82rem; color:var(--text);">${poemLabel}</span>
        ${poemTitle ? `<span style="font-size:0.78rem; color:var(--text-muted);">${_escHtml(poemTitle)}</span>` : ''}
        <span style="font-size:0.74rem;">${lang}</span>
        ${isCorrected ? `<span style="font-size:0.68rem; padding:1px 7px; border-radius:8px; background:#ffb80022; color:#cc9200; font-weight:600;">🟡 corrigido por ${_escHtml(_reporterName(r.corrected_by))}</span>` : ''}
        <span style="margin-left:auto; font-size:0.72rem; color:var(--text-muted);">👤 ${_escHtml(_reporterName(r.user_id))} · ${date}</span>
      </div>
      ${desc ? `<div style="font-size:0.8rem; color:var(--text); font-style:italic; margin-bottom:5px;">“${desc}”</div>` : ''}
      ${trecho ? `<div style="font-size:0.76rem; line-height:1.5; color:var(--text-muted); background:color-mix(in srgb, var(--text) 5%, transparent); border-left:3px solid color-mix(in srgb, var(--accent) 50%, transparent); padding:7px 9px; border-radius:0 6px 6px 0; white-space:pre-wrap; word-break:break-word; max-height:90px; overflow:auto;">${trecho}</div>` : ''}
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:9px;">
        ${num != null ? `<button class="pv-report-jump" data-num="${num}" style="padding:5px 11px; background:rgba(99,102,241,0.12); color:#6366f1; border:1px solid rgba(99,102,241,0.3); border-radius:6px; font-size:0.75rem; font-weight:600; cursor:pointer;">↓ Corrigir este poema</button>` : ''}
        ${!isCorrected ? `<button class="pv-report-correct" data-id="${r.id}" style="padding:5px 11px; background:rgba(52,199,89,0.15); color:#1f8a3f; border:1px solid rgba(52,199,89,0.4); border-radius:6px; font-size:0.75rem; font-weight:600; cursor:pointer;">✓ Corrigido</button>` : ''}
        <button class="pv-report-archive" data-id="${r.id}" style="padding:5px 11px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.75rem; cursor:pointer;" title="Arquivar — correção publicada e revisada">📦 Arquivar</button>
      </div>
    </div>`;
}

function _wireReportsSection() {
  const host = document.getElementById('pv-reports');
  if (!host) return;

  const head = host.querySelector('.pv-reports-head');
  if (head) head.addEventListener('click', (e) => {
    if (e.target.closest('.pv-report-jumpcol')) return;
    const body = host.querySelector('.pv-reports-body');
    const tgl = host.querySelector('.pv-reports-toggle');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'flex';
    if (tgl) tgl.textContent = open ? '▸' : '▾';
  });

  host.querySelectorAll('.pv-report-jumpcol').forEach(b =>
    b.addEventListener('click', (e) => { e.stopPropagation(); loadPoetryVersions(b.dataset.file); }));
  host.querySelectorAll('.pv-report-jump').forEach(b =>
    b.addEventListener('click', () => _jumpToPoem(parseInt(b.dataset.num, 10))));
  host.querySelectorAll('.pv-report-correct').forEach(b =>
    b.addEventListener('click', () => _markReport(b.dataset.id, 'corrected', b)));
  host.querySelectorAll('.pv-report-archive').forEach(b =>
    b.addEventListener('click', () => _markReport(b.dataset.id, 'verified', b)));
}

// Leva o admin ao card de edição do poema (limpa filtros, calcula a página,
// scrolla e dá um flash) pra ele escolher uma variante ou retraduzir.
function _jumpToPoem(number) {
  const idx = _allPoems.findIndex(p => p.number === number);
  if (idx < 0) return;
  _editQuery = '';
  _editFilterPending = false;
  _editFilterReported = false;
  _editPage = Math.floor(idx / PAGE_SIZE);
  _renderEditor();
  setTimeout(() => {
    const card = document.querySelector(`.pv-card[data-num="${number}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const prev = card.style.boxShadow;
    card.style.transition = 'box-shadow 0.3s';
    card.style.boxShadow = '0 0 0 3px var(--accent)';
    setTimeout(() => { card.style.boxShadow = prev; }, 1600);
  }, 60);
}

async function _markReport(id, status, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.style.opacity = '0.6'; }
  const now = new Date().toISOString();
  const stamps = status === 'corrected'
    ? { corrected_by: _myUid, corrected_at: now }
    : { verified_by: _myUid, verified_at: now };
  const { error } = await supabase
    .from('translation_reports')
    .update({ status, ...stamps })
    .eq('id', id);
  if (error) {
    if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = '1'; }
    alert('Falha ao atualizar reporte: ' + error.message);
    return;
  }
  const r = _reportsAll.find(x => x.id === id);
  if (r) Object.assign(r, { status, ...stamps });
  _renderReportsSection();
  _renderEditor();
  _updateReportsBadge();
}

window.loadPoetryVersions = loadPoetryVersions;
