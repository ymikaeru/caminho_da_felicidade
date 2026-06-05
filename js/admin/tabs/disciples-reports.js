// ============================================================
// Reportes de Discípulos — aba dedicada
//
// Lê de translation_reports onde vol='disciples'. Os livros de
// discípulos ficam em books/<file>.json (bucket teachings), são
// SÓ em português (campo único `content` em Markdown) e têm
// estrutura recursiva (sections[].children[]). O editor do College
// (themes/topics bilíngue) não serve — por isso este módulo tem
// editor próprio.
//
// Status workflow (igual translation_reports do College):
//   pending   → recém-recebido
//   corrected → editor salvou (auto-set) — aguarda arquivamento
//   verified  → admin confirmou (arquivado)
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escHtml, getFileTitle } from '../shared/helpers.js';
import { allUsers, _myUid, _reportNotes } from '../shared/state.js';

let _discReportsLoaded = false;
let _allDisciplesReports = [];

// ── Editor state ──────────────────────────────────────────────
let _de_currentReport = null;
let _de_currentFilename = null; // nome real do arquivo no Storage (≠ id do livro)
let _de_rootJson = null;       // livro inteiro (mutar node.content + re-stringificar)
let _de_targetNode = null;     // referência ao nó da seção dentro de _de_rootJson
let _de_originalContent = null;
let _de_contentSections = [];  // [{node, ancestors:[titles], label}] — só nós com conteúdo

// O `file` do reporte é o ID do livro (vem do ?book= da URL), que NÃO é
// necessariamente o nome do arquivo no Storage (ex.: id
// 'ashita-no-ijitsu-wo-ikiru' → arquivo 'ashita-no-ijitsu.json'). O mapa
// id→file vem do disciples_index.json. Cacheado após a 1ª carga.
let _discBookIndex = null;
async function _de_resolveFilename(bookId) {
  if (!_discBookIndex) {
    try {
      const { data, error } = await supabase.storage.from('teachings').download('books/disciples_index.json');
      if (error || !data) throw error || new Error('vazio');
      const idx = JSON.parse(await data.text());
      _discBookIndex = {};
      (idx.books || []).forEach(b => { if (b.id && b.file) _discBookIndex[b.id] = b.file; });
    } catch (e) {
      console.warn('[disc-reports] disciples_index.json não carregou:', e?.message);
      _discBookIndex = {}; // marca como tentado; cai no fallback
    }
  }
  if (_discBookIndex[bookId]) return _discBookIndex[bookId];
  // Fallback: id == stem do arquivo (vale p/ keigyou, shin-dendo-tebiki…)
  return bookId.endsWith('.json') ? bookId : `${bookId}.json`;
}

// ──────────────────────────────────────────────────────────────
async function loadDisciplesReports(forceReload = false) {
  if (_discReportsLoaded && !forceReload) return;
  _discReportsLoaded = true;

  const container = document.getElementById('discReportsContainer');
  if (!container) return;
  container.innerHTML = '<div class="loading">Carregando relatórios…</div>';

  const { data, error } = await supabase
    .from('translation_reports')
    .select('id, vol, file, topic_id, lang, selected_text, description, created_at, status, user_id, corrected_by, corrected_at, verified_by, verified_at, pt_before, pt_after')
    .eq('vol', 'disciples')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    container.innerHTML = `<div class="msg err">Erro ao carregar: ${_escHtml(error.message)}</div>`;
    return;
  }

  _allDisciplesReports = data || [];

  // Carrega notas internas. Mexe só nos ids destes reportes pra não
  // clobberar as notas já carregadas pela aba principal (_reportNotes
  // é compartilhado em shared/state.js).
  if (_allDisciplesReports.length) {
    const ids = _allDisciplesReports.map(r => r.id);
    const { data: notes } = await supabase
      .from('report_notes')
      .select('id, report_id, admin_id, note, created_at')
      .in('report_id', ids)
      .order('created_at', { ascending: true });
    ids.forEach(id => { delete _reportNotes[id]; });
    (notes || []).forEach(n => {
      if (!_reportNotes[n.report_id]) _reportNotes[n.report_id] = [];
      _reportNotes[n.report_id].push(n);
    });
  }

  _renderDisciplesReports();
}

function _renderDisciplesReports() {
  const container = document.getElementById('discReportsContainer');
  const summary = document.getElementById('discReportsSummary');
  const reports = _allDisciplesReports;

  const pending   = reports.filter(r => !r.status || r.status === 'pending');
  const corrected = reports.filter(r => r.status === 'corrected');
  const verified  = reports.filter(r => r.status === 'verified');
  const needsAttention = pending.length + corrected.length;

  const badge = document.getElementById('discReportsTabBadge');
  if (badge) {
    badge.textContent = needsAttention;
    badge.classList.toggle('empty', needsAttention === 0);
  }

  // ── Summary cards ──
  const open = [...pending, ...corrected];
  const uniqueBooks = new Set(open.map(r => r.file)).size;
  const bookCounts = {};
  open.forEach(r => { bookCounts[r.file] = (bookCounts[r.file] || 0) + 1; });
  const topBook = Object.entries(bookCounts).sort((a, b) => b[1] - a[1])[0];

  if (summary) {
    summary.innerHTML = `
      <div class="report-summary-item">
        <div class="val" style="color:#ff3b30">${pending.length}</div>
        <div class="lbl">Pendentes</div>
      </div>
      <div class="report-summary-item">
        <div class="val" style="color:#ffb800">${corrected.length}</div>
        <div class="lbl">Aguardando arquivamento</div>
      </div>
      <div class="report-summary-item">
        <div class="val">${uniqueBooks}</div>
        <div class="lbl">Livros distintos</div>
      </div>
      <div class="report-summary-item">
        <div class="val" style="font-size:1rem; line-height:1.3;">${topBook ? _escHtml(getFileTitle('disciples', topBook[0])) : '—'}</div>
        <div class="lbl">Livro c/ mais reportes</div>
      </div>
      <div class="report-summary-item">
        <div class="val" style="color:#34c759">${verified.length}</div>
        <div class="lbl">Arquivados</div>
      </div>
    `;
  }

  // ── Card builder ──
  function shortDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  }
  const adminName = (uid) => {
    if (!uid) return 'admin';
    const u = allUsers.find(x => x.id === uid);
    return u?.display_name || u?.email || 'admin';
  };

  function buildCard(r, state) {
    const date = new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const bookLabel = getFileTitle('disciples', r.file);
    const sectionId = (r.topic_id || '').replace(/^sec-/, '');

    let userName = 'Usuário Desconhecido';
    if (r.user_id) {
      const u = allUsers.find(x => x.id === r.user_id);
      if (u) userName = u.display_name || u.email || 'Usuário';
    }

    const previewUrl = `reader.html?pub=disciples&book=${encodeURIComponent(r.file)}`;
    const previewBtn = `<button class="report-verify-btn" style="background:rgba(0,122,255,0.1); color:#007aff; border-color:rgba(0,122,255,0.3);" onclick="window.open(${_escHtml(JSON.stringify(previewUrl))}, '_blank')" title="Abrir o livro no leitor">👁️ Preview</button>`;
    const editBtn = `<button class="report-verify-btn" style="background:rgba(255,160,0,0.12); color:#a87a1b; border-color:rgba(255,160,0,0.4);" onclick="openDisciplesEditor('${r.id}')" title="Abrir editor, localizar o trecho reportado">✏️ Editar</button>`;
    const correctBtn = `<button class="report-verify-btn" style="background:rgba(52,199,89,0.15); color:#1f8a3f; border-color:rgba(52,199,89,0.4);" onclick="markDisciplesCorrected('${r.id}', this)" title="Marcar correção como aplicada — aguarda revisão">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Corrigido</button>`;
    const archiveBtn = `<button class="report-verify-btn" style="background:rgba(52,199,89,0.15); color:#1f8a3f; border-color:rgba(52,199,89,0.4);" onclick="archiveDisciplesReport('${r.id}', this)" title="Arquivar — correção revisada">📦 Arquivar</button>`;

    let actions = '', chip = '';
    if (state === 'pending') {
      actions = `${previewBtn}${editBtn}${correctBtn}`;
    } else if (state === 'corrected') {
      actions = `${previewBtn}${editBtn}${archiveBtn}`;
      chip = `<span class="report-status-chip status-corrected" title="Aguardando arquivamento por outro admin">🟡 Corrigido por ${_escHtml(adminName(r.corrected_by))} · ${shortDate(r.corrected_at)}</span>`;
    } else { // verified
      actions = `${previewBtn}`;
      chip = `<span class="report-status-chip status-archived">📦 Arquivado por ${_escHtml(adminName(r.verified_by))} · ${shortDate(r.verified_at)}</span>`;
    }

    let diffHtml = '';
    if (r.pt_after && r.pt_before) {
      diffHtml = `
        <div class="report-diff">
          <div class="diff-side diff-before"><div class="diff-label">📄 Antes</div><div class="diff-text">${_escHtml(r.pt_before)}</div></div>
          <div class="diff-side diff-after"><div class="diff-label">✅ Depois</div><div class="diff-text">${_escHtml(r.pt_after)}</div></div>
        </div>`;
    }

    return `
      <div class="report-card state-${state}" id="disc-report-card-${r.id}">
        <div class="report-header">
          <span class="report-vol">📖</span>
          <span class="report-file" title="${_escHtml(r.file || '')}">${_escHtml(bookLabel)}</span>
          ${sectionId ? `<span class="report-topic-idx" title="Seção (id)">${_escHtml(sectionId)}</span>` : ''}
          <span class="report-lang">🇧🇷 Português</span>
          <span class="report-user">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            ${_escHtml(userName)}
          </span>
          <span class="report-date">${date}</span>
          ${actions ? `<div class="report-actions" style="display:flex; gap:8px; flex-wrap:wrap;">${actions}</div>` : ''}
        </div>
        ${chip ? `<div class="report-chip-row">${chip}</div>` : ''}
        ${!diffHtml ? `<div class="report-text"><mark class="report-selected">${_escHtml(r.selected_text || '')}</mark></div>` : ''}
        ${r.description ? `<div class="report-description">${_escHtml(r.description)}</div>` : ''}
        ${diffHtml}
        <div class="rn-thread">
          <div class="rn-label">💬 Notas internas</div>
          <div id="rn-thread-${r.id}">${_discBuildNotesThread(r.id)}</div>
          <div class="rn-input-row">
            <textarea id="rn-input-${r.id}" class="rn-input"
              placeholder="Escreva uma nota… (Ctrl+Enter para enviar)"
              onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){sendReportNote('${r.id}');event.preventDefault();}"></textarea>
            <button class="rn-send" onclick="sendReportNote('${r.id}')">Enviar</button>
          </div>
        </div>
      </div>`;
  }

  // ── Agrupa por livro (file) ──
  function renderGroup(list, state, headerPrefix, opts = {}) {
    const byBook = {};
    list.forEach(r => { (byBook[r.file] || (byBook[r.file] = [])).push(r); });
    let out = '';
    for (const file of Object.keys(byBook).sort()) {
      const group = byBook[file];
      if (!group.length) continue;
      const bookName = getFileTitle('disciples', file);
      out += `<div class="report-group-label" style="${opts.labelStyle || ''}">${headerPrefix} ${_escHtml(bookName)} — ${group.length}</div>`;
      group.forEach(r => { out += buildCard(r, state); });
    }
    return out;
  }

  let html = '';

  if (pending.length > 0) {
    html += '<div class="report-list" id="discPendingList">';
    html += renderGroup(pending, 'pending', '⚠');
    html += '</div>';
  }

  if (corrected.length > 0) {
    html += `
      <div class="report-section-corrected">
        <div class="report-section-corrected-header">
          🟡 Aguardando arquivamento
          <span class="pill">${corrected.length} ${corrected.length === 1 ? 'reporte' : 'reportes'}</span>
        </div>
        <div class="report-list">${corrected.map(r => buildCard(r, 'corrected')).join('')}</div>
      </div>`;
  }

  if (pending.length === 0 && corrected.length === 0) {
    html += '<div class="report-empty">✅ Nenhum reporte de discípulos pendente.</div>';
  }

  if (verified.length > 0) {
    html += `
      <div class="report-verified-section" style="margin-top:24px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <button class="report-verify-btn" id="discVerifiedToggle" onclick="toggleDiscVerifiedSection()" style="gap:6px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="discVerifiedToggleIcon" style="transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>
            Histórico de Arquivados <span style="opacity:0.6; font-weight:400;">(${verified.length})</span>
          </button>
        </div>
        <div class="report-verified-body" id="discVerifiedBody" style="display:none">
          <div class="report-list">${renderGroup(verified, 'verified', '📦', { labelStyle: 'opacity:0.6' })}</div>
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

function toggleDiscVerifiedSection() {
  const body = document.getElementById('discVerifiedBody');
  const icon = document.getElementById('discVerifiedToggleIcon');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (icon) icon.style.transform = isOpen ? '' : 'rotate(180deg)';
}

// Cópia local de _buildNotesThread (translation-review.js não o expõe).
// O re-render pós-envio é feito por sendReportNote (window) com markup idêntico.
function _discBuildNotesThread(reportId) {
  const notes = _reportNotes[reportId] || [];
  if (!notes.length) return '<div class="rn-empty">Nenhuma nota ainda.</div>';
  return notes.map(n => {
    const isMine = n.admin_id === _myUid;
    const author = allUsers.find(u => u.id === n.admin_id);
    const name = author?.display_name || 'Admin';
    const initial = (name[0] || 'A').toUpperCase();
    const hora = new Date(n.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const delBtn = isMine ? `<button class="rn-del" onclick="deleteReportNote('${n.id}','${reportId}')" title="Apagar">✕</button>` : '';
    return `
      <div class="rn-bubble">
        <div class="rn-avatar${isMine ? ' mine' : ''}">${initial}</div>
        <div class="rn-body">
          <div class="rn-meta">
            <span class="rn-name">${_escHtml(isMine ? 'Você' : name)}</span>
            <span>${hora}</span>
            ${delBtn}
          </div>
          <div class="rn-text">${_escHtml(n.note)}</div>
        </div>
      </div>`;
  }).join('');
}

// ── Status workflow (fns próprias — não reusar as do College que
//    mutam _allReports e re-renderizam a aba errada) ──
async function _updateDiscReportStatus(id, newStatus, stamps, btnEl, origLabel) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }

  const update = { status: newStatus, ...stamps };
  const { error } = await supabase
    .from('translation_reports')
    .update(update)
    .eq('id', id);

  if (error) {
    console.error(`[disc-reports] status→${newStatus} falhou:`, error.message);
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = origLabel; }
    alert(`Erro ao atualizar: ${error.message}`);
    return;
  }

  const idx = _allDisciplesReports.findIndex(r => r.id === id);
  if (idx !== -1) Object.assign(_allDisciplesReports[idx], update);
  _renderDisciplesReports();
}

async function markDisciplesCorrected(id, btnEl) {
  return _updateDiscReportStatus(id, 'corrected', { corrected_by: _myUid, corrected_at: new Date().toISOString() }, btnEl, 'Corrigido');
}
async function archiveDisciplesReport(id, btnEl) {
  return _updateDiscReportStatus(id, 'verified', { verified_by: _myUid, verified_at: new Date().toISOString() }, btnEl, '📦 Arquivar');
}

// ============================================================
// Editor — baixa books/<file>.json, acha a seção, edita o
// Markdown PT, salva de volta + captura pt_before/pt_after.
// ============================================================
function _de_setStatus(html, isError = false) {
  const el = document.getElementById('disc-editor-status');
  if (!el) return;
  el.innerHTML = html;
  el.style.color = isError ? '#ff3b30' : 'var(--text-muted)';
  el.style.display = 'block';
}

// Achata a árvore recursiva de sections em nós COM conteúdo,
// guardando os títulos ancestrais pro breadcrumb.
function _de_collectContentSections(rootJson) {
  const out = [];
  (function rec(arr, ancestors) {
    (arr || []).forEach(node => {
      if ((node.content || '').trim()) {
        const label = [...ancestors, node.title || node.id || '(sem título)'].filter(Boolean).join(' › ');
        out.push({ node, ancestors, label });
      }
      if (node.children && node.children.length) rec(node.children, [...ancestors, node.title || '']);
    });
  })(rootJson.sections || [], []);
  return out;
}

// Acha o índice (em _de_contentSections) da seção reportada.
function _de_locateIndex(report) {
  const wantId = (report.topic_id || '').replace(/^sec-/, '');
  if (wantId) {
    const byId = _de_contentSections.findIndex(s => s.node.id === wantId);
    if (byId !== -1) return byId;
  }
  const needle = (report.selected_text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (needle) {
    const byText = _de_contentSections.findIndex(s => (s.node.content || '').replace(/\s+/g, ' ').toLowerCase().includes(needle));
    if (byText !== -1) return byText;
  }
  return -1;
}

async function openDisciplesEditor(reportId) {
  const r = (_allDisciplesReports || []).find(x => x.id === reportId);
  if (!r) return;

  _de_currentReport = r;
  _de_currentFilename = null;
  _de_rootJson = null;
  _de_targetNode = null;
  _de_originalContent = null;
  _de_contentSections = [];

  const modal = document.getElementById('disc-editor-modal');
  if (!modal) { alert('Modal do editor não está no DOM (admin-supabase.html desatualizado?).'); return; }
  modal.classList.add('open');

  // Contexto
  document.getElementById('disc-editor-book-title').textContent = getFileTitle('disciples', r.file);
  document.getElementById('disc-editor-file').textContent = '…';
  document.getElementById('disc-editor-topic').textContent = (r.topic_id || '—');
  document.getElementById('disc-editor-selected').textContent = r.selected_text || '';
  const descLabel = document.getElementById('disc-editor-desc-label');
  const descEl = document.getElementById('disc-editor-desc');
  if (r.description) {
    descLabel.style.display = 'block'; descEl.style.display = 'block'; descEl.textContent = r.description;
  } else {
    descLabel.style.display = 'none'; descEl.style.display = 'none'; descEl.textContent = '';
  }

  const ta = document.getElementById('disc-editor-area');
  const sel = document.getElementById('disc-editor-section-sel');
  ta.value = '';
  sel.innerHTML = '';
  document.getElementById('disc-editor-breadcrumb').textContent = '';
  const saveBtn = document.getElementById('disc-editor-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '💾 Salvar e marcar Corrigido';

  _de_setStatus('Baixando livro do Storage…');

  // Resolve o id do livro → nome real do arquivo no Storage.
  const fname = await _de_resolveFilename(r.file);
  _de_currentFilename = fname;
  document.getElementById('disc-editor-file').textContent = `books/${fname}`;

  let data, error;
  try {
    ({ data, error } = await supabase.storage.from('teachings').download(`books/${fname}`));
  } catch (e) { _de_setStatus(`Falha de rede: ${_escHtml(e.message)}`, true); return; }
  if (error) { _de_setStatus(`Erro ao baixar books/${_escHtml(fname)}: ${_escHtml(error.message)}`, true); return; }

  let json;
  try { json = JSON.parse(await data.text()); }
  catch (e) { _de_setStatus(`JSON inválido em books/${_escHtml(fname)}: ${_escHtml(e.message)}`, true); return; }

  _de_rootJson = json;
  document.getElementById('disc-editor-book-title').textContent = json.title || getFileTitle('disciples', r.file);
  _de_contentSections = _de_collectContentSections(json);

  if (!_de_contentSections.length) {
    _de_setStatus('Este livro não tem nenhuma seção com conteúdo editável.', true);
    return;
  }

  // Popula o <select> de seções
  sel.innerHTML = _de_contentSections
    .map((s, i) => `<option value="${i}">${_escHtml(s.label)}</option>`)
    .join('');
  sel.onchange = () => _de_loadSectionIntoEditor(parseInt(sel.value, 10));

  // Pré-seleciona a seção reportada
  let idx = _de_locateIndex(r);
  let locateWarn = '';
  if (idx === -1) { idx = 0; locateWarn = '⚠ Não consegui localizar o trecho reportado automaticamente. Escolha a seção no menu acima ou use Ctrl+F.'; }
  sel.value = String(idx);
  _de_loadSectionIntoEditor(idx, locateWarn);

  saveBtn.disabled = false;
}

function _de_loadSectionIntoEditor(idx, locateWarn = '') {
  const entry = _de_contentSections[idx];
  if (!entry) return;
  _de_targetNode = entry.node;
  _de_originalContent = entry.node.content || '';

  document.getElementById('disc-editor-breadcrumb').textContent = entry.label;

  const ta = document.getElementById('disc-editor-area');
  ta.value = _de_originalContent;

  // Tenta selecionar/scrollar até o trecho reportado (best-effort).
  const needle = (_de_currentReport?.selected_text || '').trim();
  let warn = locateWarn;
  if (needle) {
    const match = _de_findNeedle(_de_originalContent, needle);
    if (match) {
      ta.focus();
      ta.setSelectionRange(match.start, match.end);
      const linesBefore = (_de_originalContent.slice(0, match.start).match(/\n/g) || []).length;
      const lineHeight = parseInt(getComputedStyle(ta).lineHeight, 10) || 22;
      ta.scrollTop = Math.max(0, linesBefore * lineHeight - 80);
      if (match.fuzzy && !warn) warn = '⚠ Trecho exato não encontrado — selecionei a melhor aproximação. Confira com Ctrl+F.';
    } else if (!warn) {
      warn = '⚠ Trecho reportado não localizado nesta seção. Use Ctrl+F ou troque a seção no menu.';
    }
  }
  if (warn) _de_setStatus(warn, true);
  else { const el = document.getElementById('disc-editor-status'); if (el) el.style.display = 'none'; }
}

// Localiza needle no haystack com tolerância (exato → ws-colapsado → prefixo fuzzy).
// Devolve { start, end, fuzzy } ou null. (Adaptado de translation-review-guia.js)
function _de_findNeedle(haystack, needle) {
  if (!needle) return null;
  let idx = haystack.indexOf(needle);
  if (idx >= 0) return { start: idx, end: idx + needle.length, fuzzy: false };

  const collapseMap = [];
  let collapsed = '', prev = ' ';
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i];
    if (/\s/.test(ch)) {
      if (prev !== ' ') { collapsed += ' '; collapseMap.push(i); }
      prev = ' ';
    } else { collapsed += ch; collapseMap.push(i); prev = ch; }
  }
  const needleNorm = needle.replace(/\s+/g, ' ').trim();
  idx = collapsed.indexOf(needleNorm);
  if (idx >= 0 && collapseMap[idx] !== undefined && collapseMap[idx + needleNorm.length - 1] !== undefined) {
    return { start: collapseMap[idx], end: collapseMap[idx + needleNorm.length - 1] + 1, fuzzy: false };
  }

  const minPrefix = 15;
  for (let len = needleNorm.length - 1; len >= minPrefix; len -= 4) {
    let probe = needleNorm.slice(0, len);
    const lastSpace = probe.lastIndexOf(' ');
    if (lastSpace >= minPrefix) probe = probe.slice(0, lastSpace);
    if (probe.length < minPrefix) break;
    const j = collapsed.indexOf(probe);
    if (j >= 0 && collapseMap[j] !== undefined) {
      const startReal = collapseMap[j];
      return { start: startReal, end: Math.min(haystack.length, startReal + needle.length), fuzzy: true };
    }
  }
  return null;
}

function closeDisciplesEditor(force = false) {
  if (!force && _de_originalContent !== null) {
    const current = document.getElementById('disc-editor-area')?.value || '';
    if (current !== _de_originalContent && !confirm('Há alterações não salvas. Descartar?')) return;
  }
  const modal = document.getElementById('disc-editor-modal');
  if (modal) modal.classList.remove('open');
  _de_currentReport = null;
  _de_currentFilename = null;
  _de_rootJson = null;
  _de_targetNode = null;
  _de_originalContent = null;
  _de_contentSections = [];
}

async function saveDisciplesEditor() {
  if (!_de_currentReport || !_de_rootJson || !_de_targetNode) return;
  const ta = document.getElementById('disc-editor-area');
  const saveBtn = document.getElementById('disc-editor-save');
  const newContent = ta.value;

  if (newContent === _de_originalContent) { _de_setStatus('Nada mudou — feche pra cancelar.', true); return; }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvando…';
  _de_setStatus('Subindo livro pro Storage…');

  // Aplica a edição no nó (referência dentro de _de_rootJson)
  _de_targetNode.content = newContent;

  // Usa o MESMO nome de arquivo resolvido na abertura (id do livro ≠ arquivo).
  const fname = _de_currentFilename || (_de_currentReport.file.endsWith('.json') ? _de_currentReport.file : `${_de_currentReport.file}.json`);
  const blob = new Blob([JSON.stringify(_de_rootJson, null, 2)], { type: 'application/json' });
  const { error: upErr } = await supabase.storage.from('teachings')
    .upload(`books/${fname}`, blob, { upsert: true, contentType: 'application/json', cacheControl: '0' });

  if (upErr) {
    _de_setStatus(`Erro ao salvar no Storage: ${_escHtml(upErr.message)}`, true);
    saveBtn.disabled = false; saveBtn.textContent = '💾 Salvar e marcar Corrigido';
    return;
  }

  const now = new Date().toISOString();
  const update = {
    status: 'corrected', corrected_by: _myUid, corrected_at: now,
    pt_before: _de_originalContent, pt_after: newContent
  };
  const { error: updErr } = await supabase
    .from('translation_reports')
    .update(update)
    .eq('id', _de_currentReport.id);

  if (updErr) {
    _de_setStatus(`Livro salvo no Storage, mas falhou atualizar o reporte: ${_escHtml(updErr.message)}`, true);
    saveBtn.disabled = false; saveBtn.textContent = '💾 Salvar e marcar Corrigido';
    return;
  }

  const idx = _allDisciplesReports.findIndex(r => r.id === _de_currentReport.id);
  if (idx !== -1) Object.assign(_allDisciplesReports[idx], update);

  _de_setStatus('✅ Salvo. O leitor mostra a edição na próxima carga.');
  saveBtn.textContent = '✓ Salvo';
  _de_originalContent = newContent; // pra close() não perguntar

  setTimeout(() => { closeDisciplesEditor(true); _renderDisciplesReports(); }, 1200);
}

Object.assign(window, {
  loadDisciplesReports,
  markDisciplesCorrected,
  archiveDisciplesReport,
  toggleDiscVerifiedSection,
  openDisciplesEditor,
  closeDisciplesEditor,
  saveDisciplesEditor,
});
