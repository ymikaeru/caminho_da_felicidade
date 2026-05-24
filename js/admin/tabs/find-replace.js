// ============================================================
// Find & Replace (bulk correction across Storage JSONs)
// ============================================================
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../supabase-config.js';
import { logAdminAction } from '../shared/helpers.js';

let _frResults = [];   // array of per-file match objects
let _frSearch = '';
let _frReplace = '';

function _frEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _frStripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || d.innerText || '').trim();
}

// Retorna [{startIdx, endIdx}] para todas as ocorrências literais de needle em haystack
function _frFindAll(haystack, needle) {
  const out = [];
  if (!haystack || !needle) return out;
  let from = 0;
  while (true) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    out.push({ startIdx: i, endIdx: i + needle.length });
    from = i + needle.length;
  }
  return out;
}

// Navega num objeto JSON por array de chaves/índices
function _frGetByPath(obj, path) {
  let cur = obj;
  for (const key of path) cur = cur[key];
  return cur;
}

// Substitui apenas as ocorrências cujo índice (0-based) está em selectedSet
function _frReplaceSelected(text, needle, replacement, selectedSet) {
  if (!selectedSet || !selectedSet.size) return { newText: text, count: 0 };
  let result = '';
  let from = 0;
  let occIdx = 0;
  let count = 0;
  while (true) {
    const i = text.indexOf(needle, from);
    if (i === -1) { result += text.slice(from); break; }
    result += text.slice(from, i);
    if (selectedSet.has(occIdx)) { result += replacement; count++; }
    else { result += needle; }
    from = i + needle.length;
    occIdx++;
  }
  return { newText: result, count };
}

// Produz um "diff line" com contexto (~40 chars) ao redor da ocorrência
function _frDiffLine(fullText, match, needle, replacement) {
  const ctx = 45;
  const start = Math.max(0, match.startIdx - ctx);
  const end = Math.min(fullText.length, match.endIdx + ctx);
  const pre = (start > 0 ? '…' : '') + fullText.slice(start, match.startIdx);
  const post = fullText.slice(match.endIdx, end) + (end < fullText.length ? '…' : '');
  return {
    oldHtml: _frEsc(pre) + '<mark>' + _frEsc(needle) + '</mark>' + _frEsc(post),
    newHtml: _frEsc(pre) + '<mark>' + _frEsc(replacement) + '</mark>' + _frEsc(post),
  };
}

// Percorre recursivamente um nó (book) coletando matches em .content e .title
function _frScanBookNode(node, parentPath, needle, out) {
  if (!node || typeof node !== 'object') return;
  const path = [...parentPath];
  if (typeof node.title === 'string') {
    const matches = _frFindAll(node.title, needle);
    if (matches.length) out.push({ field: 'title', text: node.title, path, matches });
  }
  if (typeof node.content === 'string') {
    const matches = _frFindAll(node.content, needle);
    if (matches.length) out.push({ field: 'content', text: node.content, path, matches });
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((ch, i) => _frScanBookNode(ch, [...path, 'children', i], needle, out));
  }
}

// Escaneia o JSON de um arquivo e retorna lista de "campos" que contêm matches.
// searchInJa=true: busca em title/content (JA) e expõe title_ptbr/content_ptbr como contexto.
function _frScanJson(json, needle, isBook, searchInJa = false) {
  const hits = [];
  if (isBook) {
    // Livros têm só title/content (sem split JA/PT) — modo JA não se aplica
    if (searchInJa) return hits;
    if (Array.isArray(json.sections)) {
      json.sections.forEach((s, i) => _frScanBookNode(s, ['sections', i], needle, hits));
    }
  } else {
    if (!Array.isArray(json.themes)) return hits;
    // [campo a buscar, campo do outro idioma usado como contexto/edição]
    const fieldPairs = searchInJa
      ? [['title', 'title_ptbr'], ['content', 'content_ptbr']]
      : [['title_ptbr', 'title'], ['content_ptbr', 'content']];
    json.themes.forEach((theme, tIdx) => {
      if (!Array.isArray(theme.topics)) return;
      theme.topics.forEach((topic, pIdx) => {
        fieldPairs.forEach(([searchField, otherField]) => {
          const val = topic[searchField];
          if (typeof val !== 'string') return;
          const matches = _frFindAll(val, needle);
          if (matches.length) {
            hits.push({
              field: searchField,
              text: val,
              jaText: typeof topic[otherField] === 'string' ? topic[otherField] : '',
              path: ['themes', tIdx, 'topics', pIdx],
              matches
            });
          }
        });
      });
    });
  }
  return hits;
}

async function _frListFiles(prefix) {
  try {
    const { data, error } = await supabase.storage.from('teachings').list(prefix, { limit: 1000 });
    if (error) throw error;
    return (data || [])
      .filter(f => f.name && f.name.endsWith('.json'))
      .map(f => f.name);
  } catch (e) {
    console.warn(`[fr] list ${prefix} falhou:`, e.message);
    return [];
  }
}

async function _frDownloadJson(path) {
  const { data: authData } = await supabase.auth.getSession();
  const token = authData?.session?.access_token;
  if (!token) throw new Error('Não autenticado');
  const url = `${SUPABASE_URL}/storage/v1/object/authenticated/teachings/${path}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY }
  });
  if (!res.ok) throw new Error(`Download falhou: ${res.status} — ${path}`);
  return res.json();
}

async function _frUploadJson(path, json) {
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const { error } = await supabase.storage.from('teachings')
    .upload(path, blob, { upsert: true, contentType: 'application/json', cacheControl: '0' });
  if (error) throw error;
}

// Mudar o texto a buscar invalida resultados antigos (precisa rodar nova busca)
function onFindReplaceSearchChange() {
  if (!_frResults.length) return;
  const s = document.getElementById('fr-search').value;
  if (s === _frSearch) return;
  _frResults = [];
  document.getElementById('fr-results-container').innerHTML =
    '<div class="fr-empty">Texto de busca alterado — clique em <strong>Buscar</strong> para atualizar os resultados.</div>';
  const sel = document.getElementById('fr-btn-apply-selected');
  const all = document.getElementById('fr-btn-apply-all');
  [sel, all].forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
  document.getElementById('fr-progress').textContent = '';
}

// Atualiza só as linhas "novo" do diff sem recriar o DOM (preserva checkboxes)
function updateFindReplaceDiff() {
  _frReplace = document.getElementById('fr-replace').value;
  document.querySelectorAll('.fr-diff-item[data-fi]').forEach(item => {
    const fi = parseInt(item.dataset.fi, 10);
    const hi = parseInt(item.dataset.hi, 10);
    const mi = parseInt(item.dataset.mi, 10);
    const r = _frResults[fi];
    if (!r || r.applied) return;
    const hit = r.hits[hi];
    if (!hit) return;
    const m = hit.matches[mi];
    if (!m) return;
    const d = _frDiffLine(hit.text, m, _frSearch, _frReplace);
    const newLine = item.querySelector('.fr-diff-new');
    if (newLine) newLine.innerHTML = d.newHtml;
  });
}

// Mudar só a substituição atualiza o preview sem recriar o DOM (preserva checkboxes)
function onFindReplaceReplaceChange() {
  if (!_frResults.length) return;
  updateFindReplaceDiff();
}

// Alterna entre o modo PT (find/replace clássico) e o modo "Buscar no japonês"
// (localiza termo JA e abre o editor para o admin corrigir o PT manualmente).
function onFindReplaceModeChange() {
  const ja = document.getElementById('fr-search-ja').checked;
  const replaceCol = document.getElementById('fr-replace-col');
  const grid       = document.getElementById('fr-search-grid');
  const searchEl   = document.getElementById('fr-search');
  const searchLbl  = document.getElementById('fr-search-label');
  const btnSel     = document.getElementById('fr-btn-apply-selected');
  const btnAll     = document.getElementById('fr-btn-apply-all');

  if (ja) {
    replaceCol.style.display = 'none';
    grid.style.gridTemplateColumns = '1fr';
    searchEl.placeholder = 'Termo japonês (ex: 善言讃詞)';
    searchLbl.textContent = 'Termo japonês a localizar';
    btnSel.style.display = 'none';
    btnAll.style.display = 'none';
    // Modo JA não se aplica a livros (sem split JA/PT)
    document.querySelectorAll('.fr-scope[value="books"]').forEach(c => {
      c.checked = false; c.disabled = true;
      const lbl = c.closest('label'); if (lbl) lbl.style.opacity = '0.4';
    });
  } else {
    replaceCol.style.display = '';
    grid.style.gridTemplateColumns = '1fr 1fr';
    searchEl.placeholder = 'Ex: a Imagem da Luz Divina (Komei Nyorai)';
    searchLbl.textContent = 'Texto a buscar';
    btnSel.style.display = '';
    btnAll.style.display = '';
    document.querySelectorAll('.fr-scope[value="books"]').forEach(c => {
      c.disabled = false;
      const lbl = c.closest('label'); if (lbl) lbl.style.opacity = '';
    });
  }

  // Limpa resultados anteriores — mudar de modo invalida o que estava na tela
  _frResults = [];
  document.getElementById('fr-results-container').innerHTML = '';
  document.getElementById('fr-progress').textContent = '';
}

async function runFindReplaceSearch() {
  const search = document.getElementById('fr-search').value;
  const replace = document.getElementById('fr-replace').value;
  const searchInJa = document.getElementById('fr-search-ja').checked;
  const progress = document.getElementById('fr-progress');
  const container = document.getElementById('fr-results-container');
  const btnSearch = document.getElementById('fr-btn-search');

  if (!search) {
    container.innerHTML = '<div class="fr-empty">Informe o texto a buscar.</div>';
    return;
  }
  // Modo PT (replace ativo) precisa que search ≠ replace; modo JA não usa replace
  if (!searchInJa && search === replace) {
    container.innerHTML = '<div class="fr-empty">O texto a buscar é igual ao de substituição — nada a fazer.</div>';
    return;
  }

  const scopes = Array.from(document.querySelectorAll('.fr-scope:checked')).map(c => c.value);
  if (!scopes.length) {
    container.innerHTML = '<div class="fr-empty">Selecione ao menos um escopo.</div>';
    return;
  }

  _frSearch = search;
  _frReplace = replace;
  _frResults = [];

  btnSearch.disabled = true;
  btnSearch.textContent = 'Buscando…';
  container.innerHTML = '<div class="loading">Listando arquivos…</div>';
  progress.textContent = '';

  // Monta lista (prefix, file, isBook)
  const work = [];
  for (const scope of scopes) {
    const files = await _frListFiles(scope === 'books' ? 'books' : scope);
    for (const f of files) work.push({ vol: scope, file: f, path: `${scope === 'books' ? 'books' : scope}/${f}`, isBook: scope === 'books' });
  }

  if (!work.length) {
    container.innerHTML = '<div class="fr-empty">Nenhum arquivo encontrado no escopo selecionado.</div>';
    btnSearch.disabled = false;
    btnSearch.textContent = '🔎 Buscar';
    return;
  }

  let scanned = 0;
  const results = [];
  // Paraleliza em lotes de 8 para não saturar
  const BATCH = 8;
  for (let i = 0; i < work.length; i += BATCH) {
    const slice = work.slice(i, i + BATCH);
    await Promise.all(slice.map(async (w) => {
      try {
        const json = await _frDownloadJson(w.path);
        const hits = _frScanJson(json, _frSearch, w.isBook, searchInJa);
        if (hits.length) {
          const totalMatches = hits.reduce((s, h) => s + h.matches.length, 0);
          results.push({ ...w, hits, totalMatches, applied: false, searchInJa });
        }
      } catch (e) {
        console.warn(`[fr] scan ${w.path} falhou:`, e.message);
      }
      scanned++;
      progress.textContent = `Analisando ${scanned}/${work.length} arquivos…`;
    }));
  }

  results.sort((a, b) => a.path.localeCompare(b.path));
  _frResults = results;

  btnSearch.disabled = false;
  btnSearch.textContent = '🔎 Buscar';
  progress.textContent = `${results.length} arquivo(s) com ${results.reduce((s, r) => s + r.totalMatches, 0)} ocorrência(s).`;

  renderFindReplaceResults();
}

function renderFindReplaceResults() {
  const container = document.getElementById('fr-results-container');
  const btnSel = document.getElementById('fr-btn-apply-selected');
  const btnAll = document.getElementById('fr-btn-apply-all');

  const hasPending = _frResults.some(r => !r.applied);
  [btnSel, btnAll].forEach(b => {
    b.disabled = !hasPending;
    b.style.opacity = hasPending ? '1' : '0.5';
  });

  if (!_frResults.length) {
    container.innerHTML = '<div class="fr-empty">Nenhuma ocorrência encontrada.</div>';
    return;
  }

  container.innerHTML = _frResults.map((r, idx) => {
    const fieldBadges = [...new Set(r.hits.map(h => h.field))].map(f => `<span class="fr-file-field">${_frEsc(f)}</span>`).join('');

    // ── Modo "Buscar no japonês" ─────────────────────────────────
    // Não há diff/replace: só mostra o trecho JA com highlight + o PT
    // correspondente, e um botão pra abrir o editor estruturado.
    if (r.searchInJa) {
      const itemsHtml = r.hits.map(hit => {
        // Mostra o trecho JA com highlight em volta de cada match (só âncora — não vai ser editado/apagado)
        const jaSnippets = hit.matches.map(m => {
          const d = _frDiffLine(hit.text, m, _frSearch, _frSearch);
          return `<div class="fr-ja-anchor">${d.oldHtml}</div>`;
        }).join('');
        const ptText = (hit.jaText || '').trim();
        const ptHtml = ptText
          ? `<div style="margin-top:6px; padding:8px 10px; background:rgba(184,134,11,0.06); border-left:2px solid var(--accent); border-radius:0 6px 6px 0; font-size:0.85rem; line-height:1.6; color:var(--text);">
              <div style="font-size:0.68rem; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">PT atual (${_frEsc(hit.field === 'title' ? 'title_ptbr' : 'content_ptbr')})</div>
              ${_frEsc(_frStripHtml(ptText))}
            </div>`
          : `<div style="margin-top:6px; padding:8px 10px; background:rgba(255,80,80,0.08); border-left:2px solid #e05252; border-radius:0 6px 6px 0; font-size:0.82rem; color:var(--text-muted);">⚠ Sem tradução PT correspondente neste tópico.</div>`;
        return `<div class="fr-diff-item" style="align-items:flex-start;">
          <div class="fr-diff-item-body">
            <div style="font-size:0.7rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">JA (${_frEsc(hit.field)})</div>
            ${jaSnippets}
            ${ptHtml}
          </div>
        </div>`;
      }).join('');

      // Escapa os args pra inline onclick (search/file podem ter aspas)
      const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
      const editArg = `'${escAttr(r.vol)}', '${escAttr(r.file)}'`;
      return `<div class="fr-file-card" data-fr-idx="${idx}">
        <div class="fr-file-header">
          <span class="fr-file-path">${_frEsc(r.path)}</span>
          ${fieldBadges}
          <span class="fr-file-count">${r.totalMatches} ${r.totalMatches === 1 ? 'ocorrência' : 'ocorrências'}</span>
          <div class="fr-file-actions">
            <button class="fr-apply-btn" onclick="openFrJaEditor(${editArg})">✏️ Editar PT no editor</button>
          </div>
        </div>
        <div class="fr-diff-list">${itemsHtml}</div>
      </div>`;
    }

    // ── Modo PT (clássico find/replace) ──────────────────────────
    const diffHtml = r.hits.map((hit, hIdx) => {
      return hit.matches.map((m, mIdx) => {
        const d = _frDiffLine(hit.text, m, _frSearch, _frReplace);
        const checkHtml = r.applied ? '' :
          `<input type="checkbox" class="fr-occ-check fr-checkbox" data-fi="${idx}" data-hi="${hIdx}" data-mi="${mIdx}" checked style="margin-top:3px; flex-shrink:0;">`;
        const jaBtnHtml = (mIdx === 0 && hit.jaText)
          ? `<button class="fr-ja-btn" onclick="const p=this.nextElementSibling;p.hidden=!p.hidden;this.textContent=p.hidden?'日本語 ▸':'日本語 ▾'">日本語 ▸</button><div class="fr-ja-inline" hidden>${_frEsc(_frStripHtml(hit.jaText))}</div>`
          : '';
        return `<div class="fr-diff-item" data-fi="${idx}" data-hi="${hIdx}" data-mi="${mIdx}">
          ${checkHtml}
          <div class="fr-diff-item-body">
            <div class="fr-diff-line fr-diff-old">${d.oldHtml}</div>
            <div class="fr-diff-line fr-diff-new">${d.newHtml}</div>
            ${jaBtnHtml}
          </div>
        </div>`;
      }).join('');
    }).join('');

    return `<div class="fr-file-card ${r.applied ? 'applied' : ''}" data-fr-idx="${idx}">
      <div class="fr-file-header">
        ${r.applied ? '<span style="width:16px;text-align:center;">✅</span>' : ''}
        <span class="fr-file-path">${_frEsc(r.path)}</span>
        ${fieldBadges}
        <span class="fr-file-count">${r.totalMatches} ${r.totalMatches === 1 ? 'ocorrência' : 'ocorrências'}</span>
        <div class="fr-file-actions">
          ${r.applied
            ? '<button class="fr-apply-btn done" disabled>✓ Aplicado</button>'
            : `<button class="fr-apply-btn" onclick="applyFindReplaceRow(${idx})">Aplicar marcadas</button>`}
        </div>
      </div>
      <div class="fr-diff-list">${diffHtml}</div>
    </div>`;
  }).join('');
}

// Abre o editor estruturado do arquivo, com o termo JA destacado pra o
// admin localizar visualmente o tópico e digitar a tradução PT correta.
// openEditor vive no admin.js — chamada via window.* (lookup global).
function openFrJaEditor(vol, file) {
  window.openEditor(vol, file, { text: _frSearch || '', lang: 'ja' });
}

// forceAll=true → aplica todas as ocorrências ignorando checkboxes (usado por "Aplicar tudo")
async function applyFindReplaceRow(idx, forceAll) {
  const r = _frResults[idx];
  if (!r || r.applied) return;

  // Monta mapa hitIdx → Set<matchIdx> de ocorrências selecionadas
  let selMap;
  let totalSelected;
  if (forceAll) {
    selMap = new Map();
    r.hits.forEach((hit, hIdx) => {
      const s = new Set();
      hit.matches.forEach((_, mIdx) => s.add(mIdx));
      selMap.set(hIdx, s);
    });
    totalSelected = r.totalMatches;
  } else {
    const checked = Array.from(document.querySelectorAll(`.fr-occ-check[data-fi="${idx}"]:checked`));
    if (!checked.length) { alert('Nenhuma ocorrência marcada para aplicar.'); return; }
    selMap = new Map();
    checked.forEach(cb => {
      const hi = parseInt(cb.dataset.hi, 10);
      const mi = parseInt(cb.dataset.mi, 10);
      if (!selMap.has(hi)) selMap.set(hi, new Set());
      selMap.get(hi).add(mi);
    });
    totalSelected = checked.length;
  }

  const btns = document.querySelectorAll(`.fr-file-card[data-fr-idx="${idx}"] button`);
  btns.forEach(b => { b.disabled = true; b.textContent = 'Salvando…'; });

  try {
    const fresh = await _frDownloadJson(r.path);
    let totalReplaced = 0;

    r.hits.forEach((hit, hIdx) => {
      const selected = selMap.get(hIdx);
      if (!selected || !selected.size) return;
      const parent = _frGetByPath(fresh, hit.path);
      const currentText = parent[hit.field];
      const { newText, count } = _frReplaceSelected(currentText, _frSearch, _frReplace, selected);
      parent[hit.field] = newText;
      totalReplaced += count;
    });

    if (totalReplaced === 0) {
      alert(`O texto "${_frSearch}" não está mais presente em ${r.path}. Nada foi alterado.`);
    } else {
      await _frUploadJson(r.path, fresh);
      await logAdminAction('search_replace', {
        arquivo: r.path,
        ocorrencias: totalReplaced,
        de: _frSearch.slice(0, 80) + (_frSearch.length > 80 ? '…' : ''),
        para: _frReplace.slice(0, 80) + (_frReplace.length > 80 ? '…' : '')
      });
      if (totalReplaced !== totalSelected) {
        alert(`Aviso: esperado ${totalSelected} substituição(ões), mas ${totalReplaced} foram feitas. O arquivo pode ter sido editado entretanto.`);
      }
    }

    // Re-escaneia o JSON atualizado para mostrar ocorrências restantes
    const remaining = _frScanJson(fresh, _frSearch, r.isBook);
    r.hits = remaining;
    r.totalMatches = remaining.reduce((s, h) => s + h.matches.length, 0);
    if (!r.totalMatches) r.applied = true;

    renderFindReplaceResults();
  } catch (e) {
    console.error('[fr] apply falhou:', e);
    alert(`Falha ao aplicar em ${r.path}: ${e.message}`);
    renderFindReplaceResults();
  }
}

// Aplica apenas as ocorrências marcadas, em todos os arquivos que têm ao menos uma
async function applyFindReplaceSelected() {
  const pending = _frResults
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => !r.applied && !!document.querySelector(`.fr-occ-check[data-fi="${i}"]:checked`));
  if (!pending.length) { alert('Nenhuma ocorrência marcada.'); return; }
  if (!confirm(`Aplicar substituições marcadas em ${pending.length} arquivo(s)?`)) return;
  const progress = document.getElementById('fr-progress');
  for (let n = 0; n < pending.length; n++) {
    progress.textContent = `Aplicando ${n + 1}/${pending.length}…`;
    await applyFindReplaceRow(pending[n].i, false);
  }
  progress.textContent = `Concluído. ${pending.length} arquivo(s) processado(s).`;
}

// Aplica TODAS as ocorrências em todos os arquivos pendentes (ignora checkboxes)
async function applyFindReplaceAll() {
  const pending = _frResults.map((r, i) => ({ r, i })).filter(x => !x.r.applied);
  if (!pending.length) return;
  if (!confirm(`Aplicar substituição em TODAS as ocorrências dos ${pending.length} arquivo(s) listado(s)?`)) return;
  const progress = document.getElementById('fr-progress');
  for (let n = 0; n < pending.length; n++) {
    progress.textContent = `Aplicando ${n + 1}/${pending.length}…`;
    await applyFindReplaceRow(pending[n].i, true);
  }
  progress.textContent = `Concluído. ${pending.length} arquivo(s) atualizado(s).`;
}

Object.assign(window, {
  onFindReplaceSearchChange,
  onFindReplaceReplaceChange,
  onFindReplaceModeChange,
  runFindReplaceSearch,
  openFrJaEditor,
  applyFindReplaceRow,
  applyFindReplaceSelected,
  applyFindReplaceAll
});
