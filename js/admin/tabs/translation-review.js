// ============================================================
// Translation Review — Reports (relatos de tradução) + Editor
// (correção inline com diff/snapshot). Acoplados via
// _currentEditReportId / openEditorFromReport.
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escHtml, logAdminAction, getFileTitle } from '../shared/helpers.js';
import { VOLUMES, VOL_SHORT } from '../shared/constants.js';
import { allUsers, volumeCategories, _myUid, _reportNotes } from '../shared/state.js';

let _reportsLoaded = false;
let _allReports = [];
let _prevSet = null; // Set "vol/file/topic_idx" dos artigos com content_ptbr_prev (retraduzidos)

// manifesto leve dos artigos que têm versão anterior arquivada (data/retrad_prev_index.json)
async function _ensurePrevSet() {
  if (_prevSet) return;
  try {
    const arr = await (await fetch('data/retrad_prev_index.json?' + Date.now())).json();
    _prevSet = new Set(arr.map((x) => `${x.vol}/${x.file}/${x.topic_idx}`));
  } catch (_) { _prevSet = new Set(); }
}

async function loadReports(forceReload = false) {
  if (_reportsLoaded && !forceReload) return;
  _reportsLoaded = true;
  await _ensurePrevSet();

  const container = document.getElementById('reportsContainer');
  const summary = document.getElementById('reportsSummary');
  container.innerHTML = '<div class="loading">Carregando relatórios...</div>';

  const { data, error } = await supabase
    .from('translation_reports')
    .select('id, vol, file, topic_id, lang, selected_text, description, created_at, status, user_id, corrected_by, corrected_at, verified_by, verified_at, pt_before, pt_after')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    container.innerHTML = `<div class="msg err">Erro ao carregar: ${_escHtml(error.message)}</div>`;
    return;
  }

  // Discípulos e Poesia têm abas próprias com editor próprio (disciples-reports.js
  // e poetry-versions.js → seção "Poemas reportados") — exclui aqui pra não
  // aparecerem em dois lugares.
  _allReports = (data || []).filter(r => r.vol !== 'disciples' && r.vol !== 'poetry');

  // Carrega notas de todos os reports em uma query só
  if (_allReports.length) {
    const ids = _allReports.map(r => r.id);
    const { data: notes } = await supabase
      .from('report_notes')
      .select('id, report_id, admin_id, note, created_at')
      .in('report_id', ids)
      .order('created_at', { ascending: true });
    // _reportNotes vem do shared/state.js — mutação in-place
    // Limpa primeiro pra não acumular stale entries
    for (const k of Object.keys(_reportNotes)) delete _reportNotes[k];
    (notes || []).forEach(n => {
      if (!_reportNotes[n.report_id]) _reportNotes[n.report_id] = [];
      _reportNotes[n.report_id].push(n);
    });
  }

  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
  }

  _renderReports();
}

// ── Card + grupo de relatórios (escopo de módulo: reusado por
//    _renderReports e _renderOmitidos) ─────────────────────────────
// ── Build report card HTML ──────────────────────────────────────
// state: 'pending' | 'corrected' | 'verified'
function buildCard(r, state) {
  const date = new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const escapedText = r.selected_text?.replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';
  const escapedDesc = r.description?.replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';
  const fileLabel = r.file ? getFileTitle(r.vol, r.file) : '—';
  const langLabel = r.lang === 'ja' ? '🇯🇵 Japonês' : '🇧🇷 Português';
  const topicIdx = r.topic_id != null
    ? (String(r.topic_id).match(/\d+/)?.[0] ?? '')
    : '';

  let userName = 'Usuário Desconhecido';
  if (r.user_id) {
    const u = allUsers.find(x => x.id === r.user_id);
    if (u) userName = u.display_name || u.email || 'Usuário';
  }

  const adminName = (uid) => {
    if (!uid) return 'admin';
    const u = allUsers.find(x => x.id === uid);
    return u?.display_name || u?.email || 'admin';
  };
  const shortDate = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  };

  const editBtn = `<button class="report-verify-btn" style="background:rgba(255,160,0,0.1); color:var(--text); border-color:var(--border);" onclick="openEditorFromReport('${r.id}')" title="Abrir editor já localizando o trecho reportado">✏️ Editar</button>`;
  const aiBtn = `<button class="report-verify-btn" style="background:rgba(99,102,241,0.1); color:#6366f1; border-color:rgba(99,102,241,0.3);" onclick="suggestTranslationWithAI('${r.id}')" title="Sugerir correção pontual via Claude AI">✨ Claude</button>`;
  const geminiBtn = `<button class="report-verify-btn" style="background:rgba(26,115,232,0.1); color:#1a73e8; border-color:rgba(26,115,232,0.3);" onclick="suggestWithGemini('${r.id}')" title="Sugerir correção pontual via Gemini">🔷 Gemini</button>`;
  const correctBtn = `<button class="report-verify-btn" style="background:rgba(52,199,89,0.15); color:#1f8a3f; border-color:rgba(52,199,89,0.4);" onclick="markCorrected('${r.id}', this)" title="Marcar correção como aplicada — aguarda revisão para arquivar">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Corrigido
    </button>`;
  const archiveBtn = `<button class="report-verify-btn" style="background:rgba(52,199,89,0.15); color:#1f8a3f; border-color:rgba(52,199,89,0.4);" onclick="archiveReport('${r.id}', this)" title="Arquivar — correção revisada e confirmada">
      📦 Arquivar
    </button>`;
  // Triagem: move o reporte para a aba "Omitidos (em pesquisa)" — trecho que
  // parece ter sido omitido da tradução e precisa de pesquisa do texto completo.
  const omitBtn = `<button class="report-verify-btn" style="background:rgba(175,82,222,0.12); color:#af52de; border-color:rgba(175,82,222,0.35);" onclick="moveToOmitidos('${r.id}', this)" title="Mover para 'Omitidos (em pesquisa)' — separa das correções rápidas">📋 Omitido</button>`;
  const backBtn = `<button class="report-verify-btn" style="background:rgba(142,142,147,0.12); color:var(--text-muted); border-color:var(--border);" onclick="unmarkOmitido('${r.id}', this)" title="Voltar para a fila principal (Relatórios)">↩ Voltar p/ Relatórios</button>`;

  const previewRaw = _stripHtmlText(r.pt_after || r.selected_text || '');
  const previewSnippet = previewRaw.replace(/\s+/g, ' ').trim().slice(0, 80);
  const previewUrl = `reader.html?vol=${encodeURIComponent(r.vol)}&file=${encodeURIComponent(r.file)}${topicIdx ? `&topic=${topicIdx}` : ''}&preview=${encodeURIComponent(previewSnippet)}`;
  const previewBtn = `<button class="report-verify-btn" style="background:rgba(0,122,255,0.1); color:#007aff; border-color:rgba(0,122,255,0.3);" onclick="window.open('${previewUrl.replace(/'/g, "\\'")}', '_blank')" title="Abrir artigo no leitor focando neste trecho">👁️ Preview</button>`;

  let actions = '';
  let chip = '';
  if (state === 'pending') {
    actions = `${previewBtn}${editBtn}${aiBtn}${geminiBtn}${correctBtn}${omitBtn}`;
  } else if (state === 'corrected') {
    actions = `${previewBtn}${editBtn}${archiveBtn}`;
    chip = `<span class="report-status-chip status-corrected" title="Aguardando arquivamento por outro admin">🟡 Corrigido por ${_escHtml(adminName(r.corrected_by))} · ${shortDate(r.corrected_at)}</span>`;
  } else if (state === 'omitted') {
    // Aba "Omitidos (em pesquisa)" — fluxo completo: pesquisar, editar e, ao
    // concluir, marcar Corrigido; ou devolver para a fila principal.
    actions = `${previewBtn}${editBtn}${aiBtn}${geminiBtn}${correctBtn}${backBtn}`;
    chip = `<span class="report-status-chip" style="background:rgba(175,82,222,0.12); color:#af52de;" title="Trecho possivelmente omitido — pesquisando se o texto completo existe">📋 Em pesquisa (texto omitido)</span>`;
  } else { // verified
    actions = `${previewBtn}`;
    chip = `<span class="report-status-chip status-archived">📦 Arquivado por ${_escHtml(adminName(r.verified_by))} · ${shortDate(r.verified_at)}</span>`;
  }

  let diffHtml = '';
  const showDiff = (state === 'corrected' || state === 'verified') && r.pt_after;
  if (showDiff) {
    const beforeRaw = r.pt_before ? _stripHtmlText(r.pt_before) : (r.selected_text || '');
    const afterRaw = _stripHtmlText(r.pt_after);
    let beforeHtml = _escHtml(beforeRaw);
    if (r.pt_before && r.selected_text) {
      const needle = r.selected_text.replace(/\s+/g, ' ').trim();
      if (needle) {
        const re = new RegExp(
          needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
          'g'
        );
        const matches = [...beforeRaw.matchAll(re)];
        if (matches.length > 0) {
          let out = '';
          let lastEnd = 0;
          for (const m of matches) {
            out += _escHtml(beforeRaw.slice(lastEnd, m.index));
            out += `<mark class="diff-needle">${_escHtml(m[0])}</mark>`;
            lastEnd = m.index + m[0].length;
          }
          out += _escHtml(beforeRaw.slice(lastEnd));
          beforeHtml = out;
        }
      }
    }
    diffHtml = `
      <div class="report-diff">
        <div class="diff-side diff-before">
          <div class="diff-label">📄 Trecho original${r.pt_before ? ' (parágrafo completo)' : ''}</div>
          <div class="diff-text">${beforeHtml}</div>
        </div>
        <div class="diff-side diff-after">
          <div class="diff-label">✅ Versão corrigida</div>
          <div class="diff-text">${_escHtml(afterRaw)}</div>
        </div>
      </div>`;
  }

  return `
    <div class="report-card state-${state}" id="report-card-${r.id}">
      <div class="report-header">
        <span class="report-vol">${VOL_SHORT[r.vol] || r.vol}</span>
        <span class="report-file" title="${_escHtml(r.file || '')}">${_escHtml(fileLabel)}</span>
        ${topicIdx !== '' ? `<span class="report-topic-idx" title="Índice do tópico (data-p-idx)">#${topicIdx}</span>` : ''}
        ${(_prevSet && _prevSet.has(`${r.vol}/${r.file}/${topicIdx}`)) ? `<span class="report-prev-chip" title="Este artigo foi retraduzido — abra o editor para ver/comparar a versão anterior" onclick="openEditorFromReport('${r.id}')">↺ versão anterior</span>` : ''}
        <span class="report-lang">${langLabel}</span>
        <span class="report-user">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          ${userName}
        </span>
        <span class="report-date">${date}</span>
        ${actions ? `<div class="report-actions" style="display:flex; gap:8px; flex-wrap:wrap;">${actions}</div>` : ''}
      </div>
      ${chip ? `<div class="report-chip-row">${chip}</div>` : ''}
      ${showDiff ? '' : `<div class="report-text"><mark class="report-selected">${escapedText}</mark></div>`}
      ${escapedDesc ? `<div class="report-description">${escapedDesc}</div>` : ''}
      ${diffHtml}
      <div class="report-ai-panel" id="report-ai-panel-${r.id}" style="display:none; margin-top:12px; padding:12px; border:1px solid rgba(99,102,241,0.3); border-radius:8px; background:rgba(99,102,241,0.04);"></div>
      <div class="rn-thread">
        <div class="rn-label">💬 Notas internas</div>
        <div id="rn-thread-${r.id}">${_buildNotesThread(r.id)}</div>
        <div class="rn-input-row">
          <textarea id="rn-input-${r.id}" class="rn-input"
            placeholder="Escreva uma nota… (Ctrl+Enter para enviar)"
            onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){sendReportNote('${r.id}');event.preventDefault();}"></textarea>
          <button class="rn-send" onclick="sendReportNote('${r.id}')">Enviar</button>
        </div>
      </div>
    </div>`;
}

// Helper: agrupa por volume e renderiza com header
function renderGroup(list, state, headerPrefix, opts = {}) {
  const byVol = {};
  list.forEach(r => {
    if (!byVol[r.vol]) byVol[r.vol] = [];
    byVol[r.vol].push(r);
  });
  let out = '';
  // Ordem conhecida primeiro; QUALQUER outra chave de volume presente nos
  // dados (disciples, poetry, ou futuras) é anexada — antes só os 4 volumes
  // do College eram iterados, então reportes de "Disc"/Poesia eram contados
  // no card "Volume c/ mais reportes" mas NUNCA renderizados na lista.
  const KNOWN_ORDER = ['mioshiec1','mioshiec2','mioshiec3','mioshiec4','disciples','poetry'];
  const VOL_GROUP_NAME = { disciples: 'Livros de Discípulos', poetry: 'Poesia' };
  const orderedVols = [
    ...KNOWN_ORDER.filter(v => byVol[v]),
    ...Object.keys(byVol).filter(v => !KNOWN_ORDER.includes(v)).sort()
  ];
  for (const vol of orderedVols) {
    const group = byVol[vol];
    if (!group || group.length === 0) continue;
    const volName = VOLUMES.find(v => v.key === vol)?.name || VOL_GROUP_NAME[vol] || VOL_SHORT[vol] || vol;
    out += `<div class="report-group-label" style="${opts.labelStyle || ''}">${headerPrefix} ${volName} — ${group.length}</div>`;
    group.forEach(r => { out += buildCard(r, state); });
  }
  return out;
}

function _renderReports() {
  const container = document.getElementById('reportsContainer');
  const summary = document.getElementById('reportsSummary');
  const reports = _allReports;

  const pending   = reports.filter(r => !r.status || r.status === 'pending');
  const corrected = reports.filter(r => r.status === 'corrected');
  const verified  = reports.filter(r => r.status === 'verified');
  const needsAttention = pending.length + corrected.length;

  // ── Badge: pending + corrected (tudo que ainda precisa atenção) ──
  const badge = document.getElementById('reportsTabBadge');
  if (badge) {
    badge.textContent = needsAttention;
    badge.classList.toggle('empty', needsAttention === 0);
  }
  // Mantém o badge da aba "Omitidos (em pesquisa)" em dia mesmo sem visitá-la.
  _updateOmittedBadge();

  // ── Summary cards ──────────────────────────────────────────────
  const open = [...pending, ...corrected];
  const uniqueFiles = new Set(open.map(r => `${r.vol}/${r.file}`)).size;
  const volCounts = {};
  open.forEach(r => { volCounts[r.vol] = (volCounts[r.vol] || 0) + 1; });
  const topVol = Object.entries(volCounts).sort((a, b) => b[1] - a[1])[0];

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
      <div class="val">${uniqueFiles}</div>
      <div class="lbl">Arquivos Distintos</div>
    </div>
    <div class="report-summary-item">
      <div class="val">${topVol ? (VOL_SHORT[topVol[0]] || topVol[0]) : '—'}</div>
      <div class="lbl">Volume c/ mais reportes</div>
    </div>
    <div class="report-summary-item">
      <div class="val" style="color:#34c759">${verified.length}</div>
      <div class="lbl">Arquivados</div>
    </div>
  `;

  let html = '';

  // ── Pendentes ──────────────────────────────────────────────────
  if (pending.length > 0) {
    html += '<div class="report-list" id="pendingList">';
    html += renderGroup(pending, 'pending', '⚠');
    html += '</div>';
  }

  // ── Corrigidos (aguardando arquivamento) ───────────────────────
  if (corrected.length > 0) {
    html += `
      <div class="report-section-corrected" id="correctedSection">
        <div class="report-section-corrected-header">
          🟡 Aguardando arquivamento
          <span class="pill">${corrected.length} ${corrected.length === 1 ? 'reporte' : 'reportes'}</span>
        </div>
        <div class="report-list">
          ${corrected.map(r => buildCard(r, 'corrected')).join('')}
        </div>
      </div>`;
  }

  if (pending.length === 0 && corrected.length === 0) {
    html += '<div class="report-empty">✅ Nenhum reporte pendente ou aguardando arquivamento.</div>';
  }

  // ── Arquivados (histórico colapsável) ──────────────────────────
  if (verified.length > 0) {
    html += `
      <div class="report-verified-section" id="verifiedSection" style="margin-top:24px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <button class="report-verify-btn" id="verifiedToggle" onclick="toggleVerifiedSection()" style="gap:6px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="verifiedToggleIcon" style="transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>
            Histórico de Arquivados <span style="opacity:0.6; font-weight:400;">(${verified.length})</span>
          </button>
          <button class="report-verify-btn" style="background:rgba(255,59,48,0.1); color:#ff3b30; border-color:rgba(255,59,48,0.2); padding:6px 12px; font-size:0.75rem;" onclick="clearVerifiedHistory(this)" title="Apagar todos os relatórios arquivados">
            ✕ Limpar Histórico
          </button>
        </div>
        <div class="report-verified-body" id="verifiedBody" style="display:none">
          <div class="report-list">
            ${renderGroup(verified, 'verified', '📦', { labelStyle: 'opacity:0.6' })}
          </div>
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

// ============================================================
// Omitidos (em pesquisa) — aba separada para os reportes em que o trecho
// parece OMITIDO da tradução e exige pesquisa do texto completo. Reusa o
// mesmo _allReports (status === 'omitted'), buildCard e renderGroup.
// ============================================================
function _updateOmittedBadge() {
  const n = _allReports.filter(r => r.status === 'omitted').length;
  const ob = document.getElementById('omittedTabBadge');
  if (ob) { ob.textContent = n; ob.classList.toggle('empty', n === 0); }
}

function _renderOmitidos() {
  const container = document.getElementById('omittedContainer');
  if (!container) return;
  const summary = document.getElementById('omittedSummary');
  const omitted = _allReports.filter(r => r.status === 'omitted');
  _updateOmittedBadge();

  if (summary) {
    const uniqueFiles = new Set(omitted.map(r => `${r.vol}/${r.file}`)).size;
    const volCounts = {};
    omitted.forEach(r => { volCounts[r.vol] = (volCounts[r.vol] || 0) + 1; });
    const topVol = Object.entries(volCounts).sort((a, b) => b[1] - a[1])[0];
    summary.innerHTML = `
      <div class="report-summary-item">
        <div class="val" style="color:#af52de">${omitted.length}</div>
        <div class="lbl">Em pesquisa</div>
      </div>
      <div class="report-summary-item">
        <div class="val">${uniqueFiles}</div>
        <div class="lbl">Arquivos Distintos</div>
      </div>
      <div class="report-summary-item">
        <div class="val">${topVol ? (VOL_SHORT[topVol[0]] || topVol[0]) : '—'}</div>
        <div class="lbl">Volume c/ mais</div>
      </div>`;
  }

  if (!omitted.length) {
    container.innerHTML = `<div class="report-empty">Nenhum item em pesquisa. Na aba <strong>Relatórios</strong>, use o botão <strong style="color:#af52de">📋 Omitido</strong> de um reporte pendente para mover trechos que precisam de pesquisa do texto completo para cá.</div>`;
    return;
  }
  container.innerHTML = '<div class="report-list">' + renderGroup(omitted, 'omitted', '📋') + '</div>';
}

// Chamado por switchTab('reports-omitted'). Garante que os reportes já foram
// carregados (compartilha _allReports com a aba Relatórios) e renderiza.
async function loadOmitidos() {
  if (!_reportsLoaded) { await loadReports(); }
  _renderOmitidos();
}

// Pendente → Omitido (triagem para pesquisa)
async function moveToOmitidos(id, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '...'; }
  const { error } = await supabase
    .from('translation_reports')
    .update({ status: 'omitted' })
    .eq('id', id);
  if (error) {
    console.error('[admin] moveToOmitidos failed:', error.message);
    alert('Erro ao mover para Omitidos: ' + error.message +
      '\n\nSe a mensagem mencionar "constraint", aplique a migration ' +
      'supabase/migrations/translation_reports_add_omitted_status.sql no SQL Editor do Supabase.');
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '📋 Omitido'; }
    return;
  }
  const idx = _allReports.findIndex(r => r.id === id);
  if (idx !== -1) _allReports[idx].status = 'omitted';
  _renderReports();
  _renderOmitidos();
}

// Omitido → Pendente (devolve para a fila principal)
async function unmarkOmitido(id, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '...'; }
  const { error } = await supabase
    .from('translation_reports')
    .update({ status: 'pending' })
    .eq('id', id);
  if (error) {
    console.error('[admin] unmarkOmitido failed:', error.message);
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '↩ Voltar p/ Relatórios'; }
    return;
  }
  const idx = _allReports.findIndex(r => r.id === id);
  if (idx !== -1) _allReports[idx].status = 'pending';
  _renderReports();
  _renderOmitidos();
}

function toggleVerifiedSection() {
  const body = document.getElementById('verifiedBody');
  const icon = document.getElementById('verifiedToggleIcon');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.style.transform = open ? '' : 'rotate(180deg)';
}

// Pendente → Corrigido
async function markCorrected(id, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '...'; }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('translation_reports')
    .update({ status: 'corrected', corrected_by: _myUid, corrected_at: now })
    .eq('id', id);

  if (error) {
    console.error('[admin] markCorrected failed:', error.message);
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Corrigir'; }
    return;
  }

  const idx = _allReports.findIndex(r => r.id === id);
  if (idx !== -1) {
    _allReports[idx].status = 'corrected';
    _allReports[idx].corrected_by = _myUid;
    _allReports[idx].corrected_at = now;
  }
  _renderReports();
  _renderOmitidos(); // se veio da aba Omitidos, remove de lá
}

// Corrigido → Arquivado
async function archiveReport(id, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '...'; }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('translation_reports')
    .update({ status: 'verified', verified_by: _myUid, verified_at: now })
    .eq('id', id);

  if (error) {
    console.error('[admin] archiveReport failed:', error.message);
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Arquivar'; }
    return;
  }

  const idx = _allReports.findIndex(r => r.id === id);
  if (idx !== -1) {
    _allReports[idx].status = 'verified';
    _allReports[idx].verified_by = _myUid;
    _allReports[idx].verified_at = now;
  }
  _renderReports();
  _renderOmitidos();
}

function _buildNotesThread(reportId) {
  const notes = _reportNotes[reportId] || [];
  if (!notes.length) return '<div class="rn-empty">Nenhuma nota ainda.</div>';
  return notes.map(n => {
    const isMine = n.admin_id === _myUid;
    const author = allUsers.find(u => u.id === n.admin_id);
    const name = author?.display_name || 'Admin';
    const initial = name[0].toUpperCase();
    const hora = new Date(n.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const delBtn = isMine
      ? `<button class="rn-del" onclick="deleteReportNote('${n.id}','${reportId}')" title="Apagar">✕</button>`
      : '';
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

async function sendReportNote(reportId) {
  const textarea = document.getElementById(`rn-input-${reportId}`);
  const text = textarea?.value?.trim();
  if (!text) return;

  const btn = textarea?.closest('.rn-input-row')?.querySelector('.rn-send');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  const { data: note, error } = await supabase
    .from('report_notes')
    .insert({ report_id: reportId, admin_id: _myUid, note: text })
    .select()
    .single();

  if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }

  if (error) { console.error('[report notes] send failed:', error.message); return; }

  if (!_reportNotes[reportId]) _reportNotes[reportId] = [];
  _reportNotes[reportId].push(note);
  textarea.value = '';

  const thread = document.getElementById(`rn-thread-${reportId}`);
  if (thread) {
    thread.innerHTML = _buildNotesThread(reportId);
    thread.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function deleteReportNote(noteId, reportId) {
  const { error } = await supabase
    .from('report_notes')
    .delete()
    .eq('id', noteId);

  if (error) { console.error('[report notes] delete failed:', error.message); return; }

  if (_reportNotes[reportId]) {
    _reportNotes[reportId] = _reportNotes[reportId].filter(n => n.id !== noteId);
  }

  const thread = document.getElementById(`rn-thread-${reportId}`);
  if (thread) thread.innerHTML = _buildNotesThread(reportId);
}

export const TRANSLATION_GUIDELINES = `Você é um revisor sênior brasileiro, devoto da Sekaikyūseikyō, com conhecimento profundo do registro religioso e doutrinário em português brasileiro. Sua tradução deve soar como Meishu-sama falando diretamente com discípulos brasileiros.

PRINCÍPIO DOUTRINÁRIO FUNDAMENTAL: aquilo que o mundo chama de "doença" é, sob a ótica de Meishu-sama, purificação se manifestando. O frame deve ser sempre espiritual, nunca clínico. Quando o autor descreve o fenômeno externo, é legítimo usar "doença"; quando a perspectiva é doutrinária, preferir "purificação", "manifestação" ou "afecção".

GLOSSÁRIO MANDATÓRIO (nunca traduzir por sinônimos):
- 浄化 / jōka → purificação
- 病気 / byōki (fenômeno externo) → doença
- 薬毒 / yakudoku → toxinas medicinais (nunca "veneno")
- 急所 / kyūsho → ponto vital
- 固まり / katamari → indurações (técnico) ou solidificações (nódulos)
- 浄霊 / jōrei → Johrei (nunca traduzir)
- 御光 / Ohikari → Ohikari (nunca traduzir; 1ª menção: "Ohikari [御光]")
- 浄霊医術 → arte do Johrei (NUNCA "arte médica do Johrei")
- 力を抜く → retirar a força (nunca "relaxar a força")
- 観音 / Kannon → Kannon [観音] (1ª menção), depois Kannon
- 釈尊 / Shakuson → Shakuson [釈尊] (1ª menção), depois Shakuson
- 神様 / kamisama → Deus (sem "nosso", sem "o Senhor")
- 教え / oshie → ensinamento (não "doutrina")
- 救い / sukui → salvação
- 御加護 / gokago → proteção divina
- 因縁 / in'nen → vínculo cármico
- 業 / gō → carma
- 罪穢 / zaie → impurezas espirituais
- 真理 / shinri → verdade
- 信仰 / shinkō → fé (não "crença", não "fervor")
- 想念 / sonen → sonen (em itálico, minúsculo)
- 原因 (em contexto patológico) → etiologia (técnico) ou causa (narrativo)
- 御神霊 / Kami genérico → Deus
- Tratamento: sempre "Meishu-sama" (minúsculo no sama)
- Pergunta-resposta: **(Pergunta)** e **(Meishu-sama)** em negrito

CALIBRAÇÃO DE REGISTRO PT-BR (CRÍTICO):

Português brasileiro elevado mas vivo. Solene, mas não pomposo. Sábio, mas não acadêmico. Direto, mas não casual. Como um mestre japonês falando em português brasileiro fluente — autoridade tranquila, sabedoria sem ostentação.

EVITAR (lusitanismos, academicismos, pompa desnecessária):
- "Ademais" / "Outrossim" → use "Além disso", "E ainda", "E também"
- "Cumpre" / "Insta" / "Mister" → use "É preciso", "É necessário"
- "Eis que" / "Há de se notar" → use "Vejam:", "Pois bem,", "É preciso notar"
- "Constitui verdadeiramente" → use "É verdadeiramente"
- "Tal qual" desnecessário → use "Assim como"
- "Em contrapartida" excessivo → alterne com "Por outro lado", "Já"
- "Sob esta ótica" / "Em tal mister" → use "Deste ponto de vista", "Vendo assim"
- "Outrora" → use "Antigamente", "No passado"
- "Por conseguinte" / "Destarte" → use "Por isso", "Assim", "Desta forma"
- "Configura-se como" → use "É", "Constitui"
- "Há que se" → use "É preciso"
- "Nesta senda" / "Sob este prisma" → use "Neste sentido", "Assim"

PREFERIR:
- Conectivos brasileiros vivos: "Por isso", "Assim", "Desta forma", "E então"
- Convocações diretas: "Vejam:", "Pensem nisto:", "Compreendam:", "É fundamental compreender:"
- Modernidade: "É preciso" em vez de "É imperativo"
- Sacralidade brasileira: "graça divina", "missão", "fé verdadeira", "elevação espiritual"
- Afirmações fortes: "É impossível", "Inexiste", "É de fato", "Verdadeiramente"

EXEMPLOS DE CALIBRAÇÃO (estude e siga este padrão):

JP: それを否定するわけにはいかない。
❌ "Não se pode obstá-lo." (rebuscado, lusitano)
✅ "Não se pode negar isso." (natural, claro, mantém autoridade)

JP: 神様の恵みは無限である。
❌ "A graça divina constitui verdadeiramente o infinito." (pomposo)
✅ "A graça de Deus é infinita." (direto, profundo, brasileiro)

JP: 病気とは浄化作用である。
❌ "A enfermidade configura-se como atuação purificatória." (acadêmico)
✅ "A doença é a purificação se manifestando." (claro, doutrinário)

JP: それゆえ、信仰深き者は救われる。
❌ "Outrossim, aqueles dotados de profunda fé hão de ser salvos." (lusitano + pomposo)
✅ "Por isso, aqueles que têm fé verdadeira são salvos." (vivo, brasileiro, sacro)

JP: 浄霊を行なうにあたっては、力を抜くことが肝要である。
❌ "Cumpre, ao ministrar Johrei, despojar-se do esforço muscular." (acadêmico, errado terminologicamente)
✅ "Ao ministrar Johrei, é fundamental retirar a força." (correto, direto)

ESTILO GERAL:
- Tom de mestre falando com discípulos (autoridade tranquila, não professoral)
- Naturalizar metáforas mantendo a intenção espiritual (Shin-i [真意])
- Bijeção 1:1 de parágrafos JP↔PT — NUNCA fundir nem dividir parágrafos
- Linhas em branco onde o JP tem linha em branco
- Pergunta-resposta: cada turno é um parágrafo separado`;

const CLAUDE_TAB_NAME = 'claude-ai-correction';

let _activeAIPanel = null; // { type: 'report'|'segment', textarea: HTMLElement, reportId?: string }

async function suggestTranslationWithAI(reportId) {
  const r = _allReports.find(x => x.id === reportId);
  if (!r) return;

  const btn = document.querySelector(`#report-card-${reportId} button[onclick*="suggestTranslationWithAI"]`);
  const origHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Buscando…'; }

  const topicIdx = parseInt((r.topic_id || '0').replace(/\D/g, '')) || 0;
  let contentJa = '', contentPt = '';
  try {
    const { data } = await supabase
      .from('teachings_topics')
      .select('content_ja, content_pt, title_pt, title_ja')
      .eq('vol', r.vol)
      .eq('file', r.file)
      .eq('topic_idx', topicIdx)
      .maybeSingle();
    if (data) {
      contentJa = data.content_ja || '';
      contentPt = data.content_pt || '';
    }
  } catch (e) { console.warn('[suggestAI] fetch failed:', e); }

  if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }

  const prompt = `${TRANSLATION_GUIDELINES}

---

## CONTEXTO: SUGESTÃO DE CORREÇÃO PONTUAL

Um usuário reportou um possível erro de tradução nos ensinamentos de Meishu-sama. Sua missão é identificar exatamente onde está o erro (mesmo que o trecho selecionado pelo usuário não seja o ponto exato) e sugerir a correção, aplicando todas as diretrizes acima.

## DADOS DO REPORT

**Localização:** ${r.vol} / ${r.file} / tópico ${topicIdx}
**Idioma onde o erro foi identificado:** ${r.lang === 'ja' ? 'Japonês' : 'Português'}
**Trecho selecionado pelo usuário:**
"${r.selected_text || '(não informado)'}"
${r.description ? `\n**Comentário do usuário (pista sobre o erro):**\n"${r.description}"` : ''}

---
${contentJa ? `## TEXTO JAPONÊS ORIGINAL (referência canônica)

${contentJa}

` : ''}${contentPt ? `## TRADUÇÃO PT-BR ATUAL (versão em uso no site)

${contentPt}

` : ''}---

## TAREFA

Compare o japonês original com a tradução PT-BR atual. Use o comentário do usuário como pista, mas analise o tópico completo se necessário.

Responda **exatamente** neste formato:

**🔍 Erro identificado:**
[Descreva onde está o problema — qual trecho do PT não corresponde ao JP, ou qual termo do glossário foi violado. Se o trecho selecionado não for o erro exato, aponte onde realmente está.]

**📄 Trecho atual (PT):**
"[cole o trecho problemático exato da tradução atual]"

**✅ Correção sugerida (PT):**
"[cole o trecho corrigido — aplicando glossário, calibração de registro PT-BR e estilo]"

**💡 Justificativa:**
[Explique brevemente — qual palavra japonesa foi mal traduzida, qual regra do glossário foi violada, qual ajuste de calibração de registro foi necessário.]`;

  try {
    await navigator.clipboard.writeText(prompt);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = prompt;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  window.open('https://claude.ai/new', CLAUDE_TAB_NAME);

  const panel = document.getElementById(`report-ai-panel-${reportId}`);
  if (panel) {
    panel.style.display = 'block';
    panel.innerHTML = `
      <div style="font-size:0.72rem; font-weight:600; color:#6366f1; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px;">✨ Sugestão da IA</div>
      <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px; line-height:1.5;">
        1) Prompt copiado e claude.ai aberto. Cole com Ctrl+V e envie.<br>
        2) Copie a resposta completa do Claude e cole abaixo (ou apenas volte aqui — colamos automaticamente).
      </div>
      <textarea class="report-ai-paste" placeholder="Cole aqui a resposta completa do Claude (incluindo 📄 Trecho atual e ✅ Correção sugerida)..."
        style="width:100%; box-sizing:border-box; min-height:100px; padding:8px 10px; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:0.85rem; font-family:inherit; resize:vertical;"></textarea>
      <div style="display:flex; gap:8px; margin-top:8px; align-items:center;">
        <button onclick="_reportParseAISuggestion('${reportId}')" style="padding:6px 14px; background:#6366f1; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">Comparar</button>
        <button onclick="_reportDiscardAIPanel('${reportId}')" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">Cancelar</button>
      </div>
    `;
    const paste = panel.querySelector('.report-ai-paste');
    if (paste) {
      setTimeout(() => paste.focus(), 100);
      _activeAIPanel = { type: 'report', textarea: paste, reportId };
    }
  }
}

function _reportParseAISuggestion(reportId) {
  const panel = document.getElementById(`report-ai-panel-${reportId}`);
  if (!panel) return;
  const paste = panel.querySelector('.report-ai-paste');
  if (!paste) return;
  const raw = (paste.value || '').trim();
  if (!raw) return;

  const cleanQuotes = (s) => (s || '').replace(/^["']\s*|\s*["']$/g, '').replace(/^\*+\s*|\s*\*+$/g, '').trim();
  const currentMatch = raw.match(/📄[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\s*✅|\n\s*\*?\*?\s*💡|\n\s*\*?\*?\s*🔍|$)/);
  const suggestMatch = raw.match(/✅[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\s*💡|\n\s*\*?\*?\s*🔍|$)/);
  const justifyMatch = raw.match(/💡[^\n]*\n+([\s\S]*?)$/);

  const ptCurrent = cleanQuotes(currentMatch?.[1]);
  const ptSuggest = cleanQuotes(suggestMatch?.[1]);
  const justify = cleanQuotes(justifyMatch?.[1]);

  if (!ptCurrent && !ptSuggest) {
    panel.innerHTML = `
      <div style="font-size:0.72rem; font-weight:600; color:#ff9500; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px;">⚠ Resposta não estruturada</div>
      <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Não encontrei os marcadores 📄/✅ esperados. Veja a resposta crua:</div>
      <div style="padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-radius:6px; font-size:0.82rem; line-height:1.55; white-space:pre-wrap; max-height:300px; overflow-y:auto;">${_escHtml(raw)}</div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button onclick="_reportDiscardAIPanel('${reportId}')" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">Fechar</button>
      </div>
    `;
    return;
  }

  _activeAIPanel = null;
  panel.innerHTML = `
    <div style="font-size:0.72rem; font-weight:600; color:#6366f1; text-transform:uppercase; letter-spacing:.1em; margin-bottom:10px;">✨ Sugestão da IA</div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <div>
        <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px; font-weight:600;">📄 Trecho atual (PT)</div>
        <div style="padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-radius:6px; font-size:0.85rem; line-height:1.55; min-height:60px; white-space:pre-wrap;">${_escHtml(ptCurrent || '(não detectado)')}</div>
      </div>
      <div>
        <div style="font-size:0.7rem; color:#6366f1; margin-bottom:4px; font-weight:600;">✅ Correção sugerida (PT)</div>
        <div class="report-ai-new" contenteditable="true" style="padding:8px 10px; background:rgba(99,102,241,0.04); border:1px solid rgba(99,102,241,0.4); border-radius:6px; font-size:0.85rem; line-height:1.55; min-height:60px; white-space:pre-wrap; color:var(--text);">${_escHtml(ptSuggest || '')}</div>
      </div>
    </div>
    ${justify ? `<div style="margin-top:10px; padding:8px 10px; background:var(--surface); border-left:3px solid #6366f1; border-radius:4px; font-size:0.8rem; line-height:1.5; color:var(--text-muted);"><b>💡 Justificativa:</b> ${_escHtml(justify)}</div>` : ''}
    <div style="display:flex; gap:8px; margin-top:10px; align-items:center; flex-wrap:wrap;">
      <button onclick="_reportCopySuggestion('${reportId}', this)" style="padding:6px 14px; background:#34c759; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">📋 Copiar correção</button>
      <button onclick="openEditorFromReport('${reportId}')" style="padding:6px 14px; background:rgba(255,160,0,0.15); color:var(--text); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">📝 Abrir editor</button>
      <button onclick="_reportDiscardAIPanel('${reportId}')" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">Fechar</button>
      <span style="font-size:0.72rem; color:var(--text-muted);">Edite a correção antes de copiar, se quiser</span>
    </div>
  `;
}

async function _reportCopySuggestion(reportId, btnEl) {
  const panel = document.getElementById(`report-ai-panel-${reportId}`);
  const newEl = panel?.querySelector('.report-ai-new');
  if (!newEl) return;
  const text = (newEl.textContent || '').trim();
  if (!text) return;
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  const orig = btnEl.innerHTML;
  btnEl.innerHTML = '✓ Copiado';
  setTimeout(() => { btnEl.innerHTML = orig; }, 1500);
}

function _reportDiscardAIPanel(reportId) {
  const panel = document.getElementById(`report-ai-panel-${reportId}`);
  if (!panel) return;
  panel.style.display = 'none';
  panel.innerHTML = '';
  if (_activeAIPanel && _activeAIPanel.reportId === reportId) _activeAIPanel = null;
}

// ── Gemini: chamada direta à API via Edge Function ─────────────────────────

async function suggestWithGemini(reportId) {
  const r = _allReports.find(x => x.id === reportId);
  if (!r) return;

  const btn = document.querySelector(`#report-card-${reportId} button[onclick*="suggestWithGemini"]`);
  const origHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Consultando…'; }

  const panel = document.getElementById(`report-ai-panel-${reportId}`);
  if (panel) {
    panel.style.display = 'block';
    panel.innerHTML = `<div style="font-size:0.8rem; color:var(--text-muted); padding:4px 0;">⏳ Consultando Gemini…</div>`;
  }

  const topicIdx = parseInt((r.topic_id || '0').replace(/\D/g, '')) || 0;
  let contentJa = '', contentPt = '';
  try {
    const { data } = await supabase
      .from('teachings_topics')
      .select('content_ja, content_pt')
      .eq('vol', r.vol)
      .eq('file', r.file)
      .eq('topic_idx', topicIdx)
      .maybeSingle();
    if (data) { contentJa = data.content_ja || ''; contentPt = data.content_pt || ''; }
  } catch (e) { console.warn('[geminiAI] fetch failed:', e); }

  const prompt = `${TRANSLATION_GUIDELINES}

---

## CONTEXTO: SUGESTÃO DE CORREÇÃO PONTUAL

Um usuário reportou um possível erro de tradução nos ensinamentos de Meishu-sama. Sua missão é identificar exatamente onde está o erro (mesmo que o trecho selecionado pelo usuário não seja o ponto exato) e sugerir a correção, aplicando todas as diretrizes acima.

## DADOS DO REPORT

**Localização:** ${r.vol} / ${r.file} / tópico ${topicIdx}
**Idioma onde o erro foi identificado:** ${r.lang === 'ja' ? 'Japonês' : 'Português'}
**Trecho selecionado pelo usuário:**
"${r.selected_text || '(não informado)'}"
${r.description ? `\n**Comentário do usuário (pista sobre o erro):**\n"${r.description}"` : ''}

---
${contentJa ? `## TEXTO JAPONÊS ORIGINAL (referência canônica)\n\n${contentJa}\n\n` : ''}${contentPt ? `## TRADUÇÃO PT-BR ATUAL (versão em uso no site)\n\n${contentPt}\n\n` : ''}---

## TAREFA

Compare o japonês original com a tradução PT-BR atual. Use o comentário do usuário como pista, mas analise o tópico completo se necessário.

Responda com os campos JSON:
- "erro_identificado": onde está o problema — qual trecho do PT não corresponde ao JP, ou qual termo do glossário foi violado
- "trecho_atual": o trecho problemático exato da tradução atual
- "correcao_sugerida": o trecho corrigido — aplicando glossário, calibração de registro PT-BR e estilo
- "justificativa": explicação breve — qual palavra japonesa foi mal traduzida, qual regra foi violada`;

  try {
    const { data, error } = await supabase.functions.invoke('gemini-suggest', { body: { prompt } });
    if (error) {
      // supabase-js entrega FunctionsHttpError com a mensagem genérica
      // "Edge Function returned a non-2xx status code". O corpo real
      // fica em error.context (Response). Lê-lo aqui pra mostrar o
      // motivo de fato (chave inválida, modelo sem acesso, etc.).
      let detail = '';
      try {
        const body = await error.context?.json?.();
        if (body?.error) {
          const extra = body.detail ? ` — ${body.detail}` : (body.raw ? ` — resposta crua: ${body.raw.slice(0, 200)}…` : '');
          detail = body.error + extra;
        }
      } catch (_) {
        try { detail = await error.context?.text?.(); } catch (_) {}
      }
      throw new Error(detail || error.message || String(error));
    }
    if (data?.error) {
      const extra = data.detail ? ` — ${data.detail}` : (data.raw ? ` — resposta crua: ${data.raw.slice(0, 200)}…` : '');
      throw new Error(data.error + extra);
    }
    const result = data?.result;
    if (!result) throw new Error('Resposta vazia do Gemini');
    _renderGeminiResult(reportId, result);
  } catch (e) {
    if (panel) {
      panel.innerHTML = `
        <div style="color:#ff3b30; font-size:0.82rem; margin-bottom:8px;">❌ Erro ao consultar Gemini: ${_escHtml(String(e.message))}</div>
        <button onclick="_reportDiscardAIPanel('${reportId}')" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">Fechar</button>`;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

function _renderGeminiResult(reportId, result) {
  const panel = document.getElementById(`report-ai-panel-${reportId}`);
  if (!panel) return;

  const ptCurrent = (result.trecho_atual || '').trim();
  const ptSuggest = (result.correcao_sugerida || '').trim();
  const erroId    = (result.erro_identificado || '').trim();
  const justify   = (result.justificativa || '').trim();

  panel.innerHTML = `
    <div style="font-size:0.72rem; font-weight:600; color:#1a73e8; text-transform:uppercase; letter-spacing:.1em; margin-bottom:10px;">🔷 Sugestão do Gemini</div>
    ${erroId ? `<div style="margin-bottom:8px; padding:8px 10px; background:var(--surface); border-left:3px solid #1a73e8; border-radius:4px; font-size:0.8rem; line-height:1.5; color:var(--text-muted);"><b>🔍 Erro identificado:</b> ${_escHtml(erroId)}</div>` : ''}
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <div>
        <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px; font-weight:600;">📄 Trecho atual (PT)</div>
        <div style="padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-radius:6px; font-size:0.85rem; line-height:1.55; min-height:60px; white-space:pre-wrap;">${_escHtml(ptCurrent || '(não detectado)')}</div>
      </div>
      <div>
        <div style="font-size:0.7rem; color:#1a73e8; margin-bottom:4px; font-weight:600;">✅ Correção sugerida (PT)</div>
        <div class="report-ai-new" contenteditable="true" style="padding:8px 10px; background:rgba(26,115,232,0.04); border:1px solid rgba(26,115,232,0.4); border-radius:6px; font-size:0.85rem; line-height:1.55; min-height:60px; white-space:pre-wrap; color:var(--text);">${_escHtml(ptSuggest || '')}</div>
      </div>
    </div>
    ${justify ? `<div style="margin-top:10px; padding:8px 10px; background:var(--surface); border-left:3px solid #1a73e8; border-radius:4px; font-size:0.8rem; line-height:1.5; color:var(--text-muted);"><b>💡 Justificativa:</b> ${_escHtml(justify)}</div>` : ''}
    <div style="display:flex; gap:8px; margin-top:10px; align-items:center; flex-wrap:wrap;">
      <button onclick="_reportCopySuggestion('${reportId}', this)" style="padding:6px 14px; background:#34c759; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">📋 Copiar correção</button>
      <button onclick="openEditorFromReport('${reportId}')" style="padding:6px 14px; background:rgba(255,160,0,0.15); color:var(--text); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">📝 Abrir editor</button>
      <button onclick="_reportDiscardAIPanel('${reportId}')" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">Fechar</button>
      <span style="font-size:0.72rem; color:var(--text-muted);">Edite a correção antes de copiar, se quiser</span>
    </div>
  `;
}

// ── Auto-paste do clipboard quando volta da aba do claude.ai
let _lastAutoPasted = '';
window.addEventListener('focus', async () => {
  if (!_activeAIPanel || !_activeAIPanel.textarea) return;
  const ta = _activeAIPanel.textarea;
  if (!ta.isConnected || ta.value.trim()) return;
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (e) { return; }
  if (!text || text === _lastAutoPasted) return;
  const looksLikeReply = /(📜|📄|✅|🔍)/.test(text) && text.length > 50;
  if (!looksLikeReply) return;
  if (/TRANSLATION_GUIDELINES|GLOSSÁRIO MANDATÓRIO/.test(text)) return;
  ta.value = text;
  _lastAutoPasted = text;
  let toast = document.getElementById('ai-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ai-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#6366f1;color:#fff;padding:10px 20px;border-radius:10px;font-size:0.85rem;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2);transition:opacity 0.3s;';
    document.body.appendChild(toast);
  }
  toast.textContent = '📋 Resposta do Claude colada automaticamente. Clique "Comparar".';
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 3500);
});

function _editorRetranslateSegment(btnEl) {
  const segRow = btnEl.closest('.editor-seg-row');
  if (!segRow) return;

  const jaEl = segRow.querySelector('.topic-readonly-text');
  const ptEl = segRow.querySelector('.seg-editable');
  const panel = segRow.querySelector('.seg-ai-panel');
  if (!jaEl || !ptEl || !panel) return;

  const jaSeg = (jaEl.textContent || '').trim();
  const ptSeg = (ptEl.textContent || '').trim();

  const topicBlock = segRow.closest('.topic-edit-block');
  const allJa = topicBlock?.querySelectorAll('.topic-readonly-text') || [];
  const allPt = topicBlock?.querySelectorAll('.seg-editable') || [];
  const fullJa = Array.from(allJa).map(e => (e.textContent || '').trim()).filter(Boolean).join('\n\n');
  const fullPt = Array.from(allPt).map(e => (e.textContent || '').trim()).filter(Boolean).join('\n\n');

  const prompt = `${TRANSLATION_GUIDELINES}

---

## CONTEXTO: RETRADUÇÃO DE PARÁGRAFO ESPECÍFICO

Você foi solicitado a retraduzir UM parágrafo específico de um ensinamento de Meishu-sama. Use o resto do tópico abaixo apenas como contexto para entender o sentido e a continuidade — mas entregue APENAS a retradução do parágrafo solicitado.

## TÓPICO COMPLETO (apenas referência)

### Texto japonês completo:
${fullJa}

### Tradução PT atual completa (referência, NÃO copiar):
${fullPt}

---

## PARÁGRAFO PARA RETRADUZIR

### Original japonês:
${jaSeg}

### Tradução PT atual (questionada):
${ptSeg}

---

## TAREFA

Retraduza APENAS o parágrafo acima, aplicando TODAS as diretrizes:
- Glossário mandatório completo
- Calibração de registro PT-BR (sem lusitanismos, sem academicismos)
- Tom de mestre falando com discípulos
- NÃO fundir, NÃO dividir — UM parágrafo só

## FORMATO OBRIGATÓRIO DA RESPOSTA

**📜 Parágrafo retraduzido:**
[Apenas o parágrafo, em uma única linha ou bloco contínuo, pronto para copiar e colar de volta no admin]

**🔍 Mudanças principais:**
- [Mudança 1: termo do glossário aplicado / lusitanismo removido / etc.]
- [Mudança 2]
- [Mudança 3 se houver]`;

  try {
    navigator.clipboard.writeText(prompt);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = prompt;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  window.open('https://claude.ai/new', CLAUDE_TAB_NAME);

  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="font-size:0.72rem; font-weight:600; color:#a855f7; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px;">🔄 Sugestão da IA</div>
    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px; line-height:1.5;">
      1) Prompt copiado e claude.ai aberto. Cole com Ctrl+V e envie.<br>
      2) Copie a resposta completa do Claude e cole abaixo.
    </div>
    <textarea class="seg-ai-paste" placeholder="Cole aqui a resposta completa do Claude (incluindo os marcadores 📜 e 🔍)..."
      style="width:100%; box-sizing:border-box; min-height:90px; padding:8px 10px; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:0.85rem; font-family:inherit; resize:vertical;"></textarea>
    <div style="display:flex; gap:8px; margin-top:8px; align-items:center;">
      <button onclick="_editorParseAISuggestion(this)" style="padding:6px 14px; background:#a855f7; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">Comparar</button>
      <button onclick="_editorDiscardAIPanel(this)" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">Cancelar</button>
    </div>
  `;
  const paste = panel.querySelector('.seg-ai-paste');
  if (paste) {
    setTimeout(() => paste.focus(), 100);
    _activeAIPanel = { type: 'segment', textarea: paste };
  }
}

function _editorParseAISuggestion(btnEl) {
  const panel = btnEl.closest('.seg-ai-panel');
  const segRow = panel.closest('.editor-seg-row');
  const ptEl = segRow.querySelector('.seg-editable');
  const paste = panel.querySelector('.seg-ai-paste');
  if (!paste || !ptEl) return;

  const raw = paste.value.trim();
  if (!raw) return;

  if (_activeAIPanel && _activeAIPanel.type === 'segment') _activeAIPanel = null;

  let extracted = raw;
  const m = raw.match(/📜[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\s*🔍|\n\s*\*?\*?\s*Mudanças|$)/);
  if (m && m[1]) extracted = m[1].trim();
  extracted = extracted.replace(/^\*+\s*|\s*\*+$/g, '').trim();

  const ptCurrent = (ptEl.textContent || '').trim();

  panel.innerHTML = `
    <div style="font-size:0.72rem; font-weight:600; color:#a855f7; text-transform:uppercase; letter-spacing:.1em; margin-bottom:10px;">🔄 Comparação</div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <div>
        <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px; font-weight:600;">PT atual</div>
        <div style="padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-radius:6px; font-size:0.85rem; line-height:1.55; min-height:60px; white-space:pre-wrap;">${_escHtml(ptCurrent)}</div>
      </div>
      <div>
        <div style="font-size:0.7rem; color:#a855f7; margin-bottom:4px; font-weight:600;">Nova sugestão</div>
        <div class="seg-ai-new" contenteditable="true" style="padding:8px 10px; background:rgba(168,85,247,0.04); border:1px solid rgba(168,85,247,0.4); border-radius:6px; font-size:0.85rem; line-height:1.55; min-height:60px; white-space:pre-wrap; color:var(--text);">${_escHtml(extracted)}</div>
      </div>
    </div>
    <div style="display:flex; gap:8px; margin-top:10px; align-items:center;">
      <button onclick="_editorAcceptAISuggestion(this)" style="padding:6px 14px; background:#34c759; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">✓ Aceitar nova</button>
      <button onclick="_editorDiscardAIPanel(this)" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">✗ Manter atual</button>
      <span style="font-size:0.72rem; color:var(--text-muted);">Edite a nova sugestão antes de aceitar, se quiser</span>
    </div>
  `;
}

function _editorAcceptAISuggestion(btnEl) {
  const panel = btnEl.closest('.seg-ai-panel');
  const segRow = panel.closest('.editor-seg-row');
  const ptEl = segRow.querySelector('.seg-editable');
  const newEl = panel.querySelector('.seg-ai-new');
  if (!ptEl || !newEl) return;

  ptEl.textContent = (newEl.textContent || '').trim();
  panel.style.display = 'none';
  panel.innerHTML = '';
  ptEl.style.transition = 'background 0.4s';
  ptEl.style.background = 'rgba(52,199,89,0.15)';
  setTimeout(() => { ptEl.style.background = ''; }, 800);
}

function _editorDiscardAIPanel(btnEl) {
  const panel = btnEl.closest('.seg-ai-panel');
  if (!panel) return;
  panel.style.display = 'none';
  panel.innerHTML = '';
  if (_activeAIPanel && _activeAIPanel.type === 'segment') _activeAIPanel = null;
}

async function clearVerifiedHistory(btnEl) {
  const { count, error: countErr } = await supabase
    .from('translation_reports')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'verified');

  if (countErr) {
    alert('Erro ao verificar quantidade de relatórios: ' + countErr.message);
    return;
  }

  if (!count || count === 0) {
    alert('Não há relatórios arquivados para apagar.');
    return;
  }

  if (!confirm(`Tem certeza? Isso apagará PERMANENTEMENTE ${count} relatório(s) arquivado(s) do banco de dados.\n\nEsta ação não pode ser desfeita.`)) return;

  const originalText = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.innerHTML = 'Limpando...';

  const { data, error } = await supabase
    .from('translation_reports')
    .delete()
    .eq('status', 'verified')
    .select();

  if (error) {
    console.error('[admin] clearVerifiedHistory failed:', error.message);
    alert('Erro ao limpar histórico: ' + error.message);
    btnEl.disabled = false;
    btnEl.innerHTML = originalText;
    return;
  }

  if (!data || data.length === 0) {
    alert('Nenhum relatório foi apagado.\nO banco de dados possivelmente bloqueou a exclusão (RLS).');
  } else {
    alert(`${data.length} relatórios apagados permanentemente.`);
  }

  _reportsLoaded = false;
  loadReports();
}

// ── Editor Logic ────────────────────────────────────────────────────────
let _currentEditVol = null;
let _currentEditFile = null;
let _currentEditJson = null;
let _currentReportHighlight = null;
let _currentEditReportId = null;
let _editorPtSnapshot = new Map();
let _currentReportSegmentKey = null;

function openEditorFromReport(reportId) {
  const r = (_allReports || []).find(x => x.id === reportId);
  if (!r) return;
  openEditor(r.vol, r.file, { text: r.selected_text, lang: r.lang, reportId });
}

async function openEditor(vol, file, reportHighlight = null) {
  if (!vol || !file) return;
  _currentEditVol = vol;
  _currentEditFile = file.endsWith('.json') ? file : file + '.json';
  _currentEditJson = null;
  _currentReportHighlight = reportHighlight && reportHighlight.text ? reportHighlight : null;
  _currentEditReportId = reportHighlight && reportHighlight.reportId ? reportHighlight.reportId : null;
  _editorPtSnapshot = new Map();
  _currentReportSegmentKey = null;

  const modal = document.getElementById('editor-modal');
  const textarea = document.getElementById('editor-textarea');
  const structuredBody = document.getElementById('editor-structured-body');
  const hint = document.getElementById('editor-search-hint');
  const subtitle = document.getElementById('editor-target-file');
  const msg = document.getElementById('editor-msg');
  const btn = document.getElementById('editor-btn-save');

  subtitle.textContent = `${vol}/${_currentEditFile}`;
  textarea.value = '';
  textarea.style.display = 'none';
  structuredBody.style.display = 'none';
  structuredBody.innerHTML = '';

  msg.className = 'msg';
  msg.textContent = 'Baixando arquivo do Supabase...';
  msg.style.display = 'block';
  btn.disabled = true;
  modal.classList.add('open');

  try {
    const { data, error } = await supabase.storage.from('teachings').download(`${vol}/${_currentEditFile}`);
    if (error) throw error;
    if (!data) throw new Error('Arquivo vazio ou indisponível no storage');

    const text = await data.text();

    try {
      _currentEditJson = JSON.parse(text);
      if (_currentEditJson.themes) {
        structuredBody.style.display = 'flex';
        renderStructuredEditor(_currentEditJson);
        if (_currentEditReportId) {
          _editorPtSnapshot = new Map();
          _currentReportSegmentKey = null;
          const needle = (_currentReportHighlight?.text || '')
            .replace(/\s+/g, ' ').trim().toLowerCase();
          document.querySelectorAll('#editor-structured-body .editor-seg-content').forEach(el => {
            const path = el.getAttribute('data-path');
            const segIdx = el.closest('.editor-seg-row')?.getAttribute('data-seg-idx');
            if (path == null || segIdx == null) return;
            const key = `${path}::${segIdx}`;
            _editorPtSnapshot.set(key, el.innerHTML);
            if (needle && !_currentReportSegmentKey) {
              const segText = _stripHtmlText(el.innerHTML)
                .replace(/\s+/g, ' ').trim().toLowerCase();
              if (segText.includes(needle)) _currentReportSegmentKey = key;
            }
          });
          if (needle && !_currentReportSegmentKey) {
            const tokens = needle.split(/[\s,.\-()"'\[\]「」『』〈〉【】、。]+/)
              .filter(w => w.length >= 4);
            let bestKey = null, bestScore = 0;
            _editorPtSnapshot.forEach((html, key) => {
              const text = _stripHtmlText(html).toLowerCase();
              const score = tokens.reduce((a, t) => a + (text.includes(t) ? 1 : 0), 0);
              if (score > bestScore) { bestScore = score; bestKey = key; }
            });
            if (bestScore >= Math.max(2, Math.floor(tokens.length / 3))) {
              _currentReportSegmentKey = bestKey;
            }
          }
        }
        if (_currentReportHighlight) {
          hint.innerHTML = '🖍️ <strong>Trecho reportado destacado em amarelo.</strong> Edite apenas a caixa da direita (Português).';
          setTimeout(() => _highlightReportedPassage(_currentReportHighlight), 50);
        } else {
          hint.innerHTML = '💡 <strong>Dica:</strong> Use <b>Ctrl+F</b> para buscar palavras. Edite apenas as caixas da direita (Português).';
        }
      } else {
        throw new Error('No themes array found');
      }
    } catch(e) {
      console.warn("Using raw JSON fallback:", e);
      textarea.value = JSON.stringify(JSON.parse(text), null, 2);
      textarea.style.display = 'block';
      hint.innerHTML = '💡 <strong>Modo Código:</strong> Arquivo não padronizado. Edite o JSON cru com <b>muito cuidado</b> com aspas e chaves.';
    }

    btn.disabled = false;
    msg.style.display = 'none';
  } catch (err) {
    console.error('Editor download error:', err);
    msg.textContent = `Erro ao baixar: ${err.message}`;
    msg.className = 'msg err';
    btn.disabled = true;
  }
}

function renderStructuredEditor(jsonData) {
  const container = document.getElementById('editor-structured-body');
  let html = '';

  jsonData.themes.forEach((theme, tIdx) => {
    if (!theme.topics) return;
    theme.topics.forEach((topic, pIdx) => {
      const jaTitle = topic.title_ja || topic.title || 'Sem título JA';
      const ptTitle = (topic.title_ptbr || topic.title_pt || topic.title || '').replace(/"/g, '&quot;');

      const jaContent = topic.content || '';
      const ptContent = topic.content_ptbr || topic.content_pt || '';

      const pathPrefix = `${tIdx}-${pIdx}`;

      const jaSegs = jaContent.split(/<br\s*\/?>/i).map(_cleanSoftBreakArtifacts);
      const ptSegs = ptContent.split(/<br\s*\/?>/i).map(_cleanSoftBreakArtifacts);
      const maxLen = Math.max(jaSegs.length, ptSegs.length);

      let segmentsHtml = '';
      for (let i = 0; i < maxLen; i++) {
         const jS = (jaSegs[i] || '').trim();
         const pS = (ptSegs[i] || '').trim();
         if (!jS && !pS) continue;
         segmentsHtml += `
           <div class="topic-split-grid editor-seg-row" data-seg-idx="${i}" style="border-top:1px solid rgba(184,134,11,0.08); padding-top:16px; margin-top:16px; position:relative;">
             <div class="topic-split-col ja-col" style="padding:0 16px 16px 16px">
               <div class="topic-readonly-text html-content">${jS}</div>
             </div>
             <div class="topic-split-col pt-col" style="padding:0 16px 16px 16px; position:relative;">
               <button onclick="_editorRetranslateSegment(this)" title="Retraduzir este parágrafo via Claude AI"
                 style="position:absolute; top:0; right:8px; padding:3px 10px; background:rgba(168,85,247,0.1); color:#a855f7; border:1px solid rgba(168,85,247,0.3); border-radius:6px; font-size:0.72rem; font-weight:600; cursor:pointer; z-index:1;">🔄 IA</button>
               <div class="seg-editable editor-seg-content" contenteditable="true"
                    data-path="${pathPrefix}-content_ptbr-seg" spellcheck="true">${pS.trim()}</div>
               <div class="seg-ai-panel" style="display:none; margin-top:12px; border:1px dashed rgba(168,85,247,0.4); border-radius:8px; padding:12px; background:rgba(168,85,247,0.04);"></div>
             </div>
           </div>
         `;
      }

      const prevPt = (topic.content_ptbr_prev || '').trim();
      const hasPrev = prevPt && prevPt !== ptContent.trim();
      const prevChip = hasPrev
        ? `<button class="prev-toggle" onclick="_togglePrevPanel('${pathPrefix}')" title="Esta tradução foi substituída — ver a versão anterior para conferência/garimpo de trechos">↺ versão anterior</button>`
        : '';
      let prevPanel = '';
      if (hasPrev) {
        const prevParas = prevPt.split(/\n\n+|<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
        const rows = prevParas.map((p) => `
          <div class="prev-seg-row">
            <button class="prev-copy" title="Copiar este trecho" onclick="_copyPrevSeg(this)">⧉</button>
            <div class="prev-seg-text">${_escHtml(p)}</div>
          </div>`).join('');
        prevPanel = `
          <div class="topic-prev-panel" id="prev-panel-${pathPrefix}" style="display:none">
            <div class="prev-panel-head">Versão anterior (substituída) — ${prevParas.length} trecho(s). Use ⧉ para copiar e colar na edição atual.</div>
            ${rows}
          </div>`;
      }

      html += `
        <div class="topic-edit-block">
          <div class="topic-edit-header">
            <span>Tópico ${pIdx + 1}</span>
            ${prevChip}
          </div>
          ${prevPanel}
          ${segmentsHtml}
        </div>
      `;
    });
  });

  container.innerHTML = html;

  container.querySelectorAll('.seg-editable').forEach(div => {
    div.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!e.shiftKey) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!div.contains(range.commonAncestorContainer)) return;
      range.deleteContents();
      const br = document.createElement('br');
      br.setAttribute('data-soft', '1');
      range.insertNode(br);
      range.setStartAfter(br);
      range.setEndAfter(br);
      sel.removeAllRanges();
      sel.addRange(range);
    });
    div.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  });

  container.querySelectorAll('textarea').forEach(t => {
    const autoResize = () => { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; };
    autoResize();
    t.addEventListener('input', autoResize);
  });
}

function _highlightReportedPassage({ text, lang }) {
  if (!text) return;
  const needle = text.replace(/\s+/g, ' ').trim();
  if (!needle) return;

  const ptSegs = document.querySelectorAll('#editor-structured-body .seg-editable');
  const jaSegs = document.querySelectorAll('#editor-structured-body .topic-readonly-text');
  const candidates = lang === 'ja' ? [jaSegs, ptSegs] : [ptSegs, jaSegs];

  let firstMark = null;
  let anyMatch = false;
  for (const list of candidates) {
    for (const el of list) {
      const count = _wrapAllMatchesInElement(el, needle);
      if (count > 0) {
        anyMatch = true;
        if (!firstMark) firstMark = el.querySelector('mark.editor-report-highlight');
      }
    }
    if (anyMatch) break;
  }

  if (firstMark) {
    firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  const hint = document.getElementById('editor-search-hint');
  if (hint) {
    hint.innerHTML = '⚠ <strong>Trecho reportado não foi localizado automaticamente.</strong> Use <b>Ctrl+F</b> para buscar: <em>' + _escHtml(needle.slice(0, 80)) + (needle.length > 80 ? '…' : '') + '</em>';
  }
  return false;
}

function _wrapAllMatchesInElement(root, needle, markClass = 'editor-report-highlight') {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  if (!nodes.length) return 0;

  let combined = '';
  const nodeMap = [];
  for (const node of nodes) {
    nodeMap.push({ node, start: combined.length, end: combined.length + node.nodeValue.length });
    combined += node.nodeValue;
  }
  let normalized = '';
  const charMap = [];
  let prevWasSpace = false;
  for (let i = 0; i < combined.length; i++) {
    const ch = combined[i];
    if (/[\s ]/.test(ch)) {
      if (!prevWasSpace && normalized.length > 0) {
        normalized += ' ';
        charMap.push(i);
      }
      prevWasSpace = true;
    } else {
      normalized += ch;
      charMap.push(i);
      prevWasSpace = false;
    }
  }
  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    charMap.pop();
  }

  const needleNorm = needle.replace(/[\s ]+/g, ' ').trim();
  if (!needleNorm) return 0;

  const ranges = [];
  let searchFrom = 0;
  while (true) {
    const idx = normalized.indexOf(needleNorm, searchFrom);
    if (idx === -1) break;
    const startIdx = idx;
    const endIdx = idx + needleNorm.length - 1;
    if (startIdx >= charMap.length || endIdx >= charMap.length) break;
    const startOffset = charMap[startIdx];
    const endOffset = charMap[endIdx] + 1;
    ranges.push({ startOffset, endOffset });
    searchFrom = idx + Math.max(1, needleNorm.length);
  }

  if (!ranges.length) return 0;

  let wrapped = 0;
  for (let r = ranges.length - 1; r >= 0; r--) {
    const { startOffset, endOffset } = ranges[r];
    let startNode = null, startDelta = 0, endNode = null, endDelta = 0;
    for (const m of nodeMap) {
      if (startNode === null && startOffset >= m.start && startOffset < m.end) {
        startNode = m.node; startDelta = startOffset - m.start;
      }
      if (endOffset > m.start && endOffset <= m.end) {
        endNode = m.node; endDelta = endOffset - m.start;
      }
    }
    if (!startNode || !endNode) continue;
    try {
      const range = document.createRange();
      range.setStart(startNode, startDelta);
      range.setEnd(endNode, endDelta);
      const mark = document.createElement('mark');
      mark.className = markClass;
      try {
        range.surroundContents(mark);
      } catch (_) {
        const frag = range.extractContents();
        mark.appendChild(frag);
        range.insertNode(mark);
      }
      wrapped++;
    } catch (e) {
      console.warn('[_wrapAllMatchesInElement] failed:', e);
    }
  }
  return wrapped;
}

function _cleanSoftBreakArtifacts(html) {
  if (!html) return html;
  return html
    .replace(/[​-‍﻿]/g, '')
    .replace(/(<br[^>]*data-soft[^>]*>\s*<br[^>]*data-soft[^>]*>)(?:\s*<br[^>]*data-soft[^>]*>)+/gi, '$1');
}

function _sanitizeSegHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('*').forEach(el => {
    el.removeAttribute('style');
    el.removeAttribute('class');
    el.removeAttribute('id');
  });
  tmp.querySelectorAll('span').forEach(span => {
    const parent = span.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  });
  tmp.querySelectorAll('mark').forEach(mark => {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
  return tmp.innerHTML.trim();
}

function closeEditor() {
  document.getElementById('editor-modal').classList.remove('open');
  _currentEditVol = null;
  _currentEditFile = null;
  _currentEditJson = null;
  _currentReportHighlight = null;
  _currentEditReportId = null;
  _editorPtSnapshot = new Map();
  _currentReportSegmentKey = null;
}

async function _captureCorrectionDiff() {
  const reportId = _currentEditReportId;
  if (!reportId || !_currentReportSegmentKey) return;

  const report = (_allReports || []).find(r => r.id === reportId);
  if (!report) return;

  let currentEl = null;
  document.querySelectorAll('#editor-structured-body .editor-seg-content').forEach(el => {
    const path = el.getAttribute('data-path');
    const segIdx = el.closest('.editor-seg-row')?.getAttribute('data-seg-idx');
    if (path != null && segIdx != null && `${path}::${segIdx}` === _currentReportSegmentKey) {
      currentEl = el;
    }
  });
  if (!currentEl) return;

  const beforeRaw = _editorPtSnapshot.get(_currentReportSegmentKey);
  const afterRaw  = currentEl.innerHTML;
  if (beforeRaw == null) return;

  const beforeSan = _sanitizeSegHtml(beforeRaw);
  const afterSan  = _sanitizeSegHtml(afterRaw);
  if (beforeSan === afterSan) return;

  const now = new Date().toISOString();
  const update = {
    status: 'corrected',
    corrected_by: _myUid,
    corrected_at: now,
    pt_after: afterSan
  };
  if (!report.pt_before) update.pt_before = beforeSan;

  const { error } = await supabase
    .from('translation_reports')
    .update(update)
    .eq('id', reportId);

  if (error) {
    console.error('[admin] capture diff update failed:', error.message);
    return;
  }

  Object.assign(report, update);
  if (_reportsLoaded) _renderReports();
}

function _stripHtmlText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

async function saveEditor() {
  const textarea = document.getElementById('editor-textarea');
  const msg = document.getElementById('editor-msg');
  const btn = document.getElementById('editor-btn-save');
  let finalContentString = '';

  if (_currentEditJson && _currentEditJson.themes) {
    try {
      const titles = document.querySelectorAll('.editor-input-field[data-path$="-title_ptbr"]');
      titles.forEach(input => {
        const keys = input.getAttribute('data-path').split('-');
        const tIdx = parseInt(keys[0], 10);
        const pIdx = parseInt(keys[1], 10);
        _currentEditJson.themes[tIdx].topics[pIdx].title_ptbr = input.value;
      });

      _currentEditJson.themes.forEach((theme, tIdx) => {
        if (!theme.topics) return;
        theme.topics.forEach((topic, pIdx) => {
          const segs = document.querySelectorAll(`.editor-seg-content[data-path="${tIdx}-${pIdx}-content_ptbr-seg"]`);
          if (segs.length > 0) {
            const joined = Array.from(segs).map(s => _sanitizeSegHtml(s.innerHTML)).join('<br/>\n');
            topic.content_ptbr = joined;
          }
        });
      });

      finalContentString = JSON.stringify(_currentEditJson, null, 2);
    } catch (e) {
      msg.textContent = 'Erro ao processar formulário estruturado.';
      msg.className = 'msg err';
      msg.style.display = 'block';
      return;
    }
  }
  else {
    let contentRaw = textarea.value;
    try {
      finalContentString = JSON.stringify(JSON.parse(contentRaw), null, 2);
    } catch (e) {
      if (!confirm('Atenção: O formato JSON está inválido e pode quebrar a leitura.\n\nTem certeza que deseja salvar mesmo assim?')) {
        msg.textContent = 'Corrija o formato JSON cru.';
        msg.className = 'msg err';
        msg.style.display = 'block';
        return;
      }
      finalContentString = contentRaw;
    }
  }

  btn.disabled = true;
  btn.textContent = 'Salvando...';
  msg.style.display = 'none';

  try {
    const blob = new Blob([finalContentString], { type: 'application/json' });
    const { error } = await supabase.storage.from('teachings')
      .upload(`${_currentEditVol}/${_currentEditFile}`, blob, { upsert: true, contentType: 'application/json', cacheControl: '0' });

    if (error) throw error;

    if (_currentEditReportId && _editorPtSnapshot.size > 0) {
      try { await _captureCorrectionDiff(); }
      catch (e) { console.warn('[admin] capture diff failed:', e); }
    }

    msg.textContent = 'Arquivo salvo/atualizado com sucesso! 🎉';
    msg.className = 'msg ok';
    msg.style.display = 'block';
    setTimeout(() => closeEditor(), 1500);
  } catch (err) {
    console.error('Editor upload error:', err);
    msg.textContent = `Falha ao salvar: ${err.message}`;
    msg.className = 'msg err';
    msg.style.display = 'block';
    btn.disabled = false;
  }
  btn.textContent = '💾 Salvar na Nuvem';
}

// ---- Versão anterior (content_ptbr_prev) — comparar/garimpar trechos inline ----
function _togglePrevPanel(pathPrefix) {
  const panel = document.getElementById(`prev-panel-${pathPrefix}`);
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  const chip = document.querySelector(`.prev-toggle[onclick*="'${pathPrefix}'"]`);
  if (chip) chip.classList.toggle('on', !open);
}
async function _copyPrevSeg(btnEl) {
  const txt = btnEl.parentElement.querySelector('.prev-seg-text')?.innerText || '';
  try {
    await navigator.clipboard.writeText(txt);
    const old = btnEl.textContent; btnEl.textContent = '✓';
    setTimeout(() => { btnEl.textContent = old; }, 900);
  } catch (_) {
    const r = document.createRange(); r.selectNodeContents(btnEl.parentElement.querySelector('.prev-seg-text'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
}

Object.assign(window, {
  // Reports
  toggleVerifiedSection,
  markCorrected,
  archiveReport,
  verifyReport: archiveReport, // alias legado
  // Omitidos (em pesquisa)
  loadOmitidos,
  moveToOmitidos,
  unmarkOmitido,
  sendReportNote,
  deleteReportNote,
  // AI helpers (report side)
  suggestTranslationWithAI,
  suggestWithGemini,
  _renderGeminiResult,
  _reportParseAISuggestion,
  _reportCopySuggestion,
  _reportDiscardAIPanel,
  // AI helpers (editor side)
  _editorRetranslateSegment,
  _editorParseAISuggestion,
  _editorAcceptAISuggestion,
  _editorDiscardAIPanel,
  // Verified history
  clearVerifiedHistory,
  // Editor
  openEditorFromReport,
  openEditor,
  closeEditor,
  saveEditor,
  // Versão anterior (content_ptbr_prev)
  _togglePrevPanel,
  _copyPrevSeg,
  // Reports loader (chamado por switchTab)
  loadReports,
  // _wrapAllMatchesInElement — também usado por openHlReader (highlights-saved.js)
  _wrapAllMatchesInElement
});
