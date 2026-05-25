// ============================================================
// Translation Review — Guia do Johrei (reports anônimos)
//
// Lê de translation_reports_guia (schema diferente do CdF — sem
// user_id, com article_id/tab/page_url). Phase 2 = visualização +
// arquivamento. Editor inline com fix de conteúdo vem na Phase 3,
// IA na Phase 4.
//
// Status workflow:
//   open      → recém-recebido
//   corrected → Phase 3: editor salvou pt_after (auto-set)
//   verified  → admin confirmou que está resolvido
//   dismissed → admin descartou (não é erro / spam / duplicado)
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escHtml } from '../shared/helpers.js';

let _guiaReportsLoaded = false;
let _allGuiaReports = [];

// Mapeia tab → label legível (alinha com data.js do guia_johrei)
const GUIA_TAB_LABELS = {
  fundamentos:           'O Johrei',
  pratica:               'Prática',
  critica_farmacologica: 'Sobre a Purificação',
  por_regiao:            'Purificações',
  estudo_aprofundado:    'Estudo Aprofundado',
  estudo_detalhado:      'Estudo do Ponto Focal',
  pontos_focais:         'Pontos Focais',
  mapa:                  'Mapa Interativo',
  culto_mensal:          'Culto Mensal',
};

async function loadGuiaReports(forceReload = false) {
  if (_guiaReportsLoaded && !forceReload) return;
  _guiaReportsLoaded = true;

  const container = document.getElementById('guiaReportsContainer');
  if (!container) return;
  container.innerHTML = '<div class="loading">Carregando relatórios…</div>';

  const { data, error } = await supabase
    .from('translation_reports_guia')
    .select('id, article_id, article_title, tab, page_url, selected_text, description, pt_before, pt_after, status, corrected_at, verified_at, user_agent, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    container.innerHTML = `<div class="msg err">Erro ao carregar: ${_escHtml(error.message)}</div>`;
    return;
  }

  _allGuiaReports = data || [];
  _renderGuiaReports();
}

function _renderGuiaReports() {
  const container = document.getElementById('guiaReportsContainer');
  const summary   = document.getElementById('guiaReportsSummary');
  const reports   = _allGuiaReports;

  const open      = reports.filter(r => !r.status || r.status === 'open');
  const corrected = reports.filter(r => r.status === 'corrected');
  const verified  = reports.filter(r => r.status === 'verified');
  const dismissed = reports.filter(r => r.status === 'dismissed');
  const needsAttention = open.length + corrected.length;

  // Badge na aba (mostra pendentes + aguardando arquivamento)
  const badge = document.getElementById('guiaReportsTabBadge');
  if (badge) {
    badge.textContent = needsAttention;
    badge.classList.toggle('empty', needsAttention === 0);
  }

  // Summary cards
  const activeForSummary = [...open, ...corrected];
  const uniqueArticles = new Set(activeForSummary.map(r => r.article_id)).size;
  const tabCounts = {};
  activeForSummary.forEach(r => { tabCounts[r.tab] = (tabCounts[r.tab] || 0) + 1; });
  const topTab = Object.entries(tabCounts).sort((a,b) => b[1] - a[1])[0];

  if (summary) {
    summary.innerHTML = `
      <div class="report-summary-item">
        <div class="val" style="color:#ff3b30">${open.length}</div>
        <div class="lbl">Pendentes</div>
      </div>
      <div class="report-summary-item">
        <div class="val" style="color:#ffb800">${corrected.length}</div>
        <div class="lbl">Aguardando arquivamento</div>
      </div>
      <div class="report-summary-item">
        <div class="val">${uniqueArticles}</div>
        <div class="lbl">Artigos distintos</div>
      </div>
      <div class="report-summary-item">
        <div class="val">${topTab ? (GUIA_TAB_LABELS[topTab[0]] || topTab[0]) : '—'}</div>
        <div class="lbl">Aba com mais reportes</div>
      </div>
      <div class="report-summary-item">
        <div class="val" style="color:#34c759">${verified.length}</div>
        <div class="lbl">Arquivados</div>
      </div>
    `;
  }

  // Cards
  function shortDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  }

  function buildCard(r, state) {
    const date = new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const tabLabel = GUIA_TAB_LABELS[r.tab] || r.tab || '—';
    const articleTitle = r.article_title || r.article_id || '(sem título)';

    const previewBtn = r.page_url
      ? `<button class="report-verify-btn" style="background:rgba(0,122,255,0.1); color:#007aff; border-color:rgba(0,122,255,0.3);" onclick="window.open(${JSON.stringify(r.page_url)}, '_blank')" title="Abrir artigo no site">👁️ Preview</button>`
      : '';

    const archiveBtn = `<button class="report-verify-btn" style="background:rgba(52,199,89,0.15); color:#1f8a3f; border-color:rgba(52,199,89,0.4);" onclick="archiveGuiaReport('${r.id}', this)" title="Marcar como resolvido">📦 Arquivar</button>`;
    const dismissBtn = `<button class="report-verify-btn" style="background:rgba(255,59,48,0.1); color:#ff3b30; border-color:rgba(255,59,48,0.3);" onclick="dismissGuiaReport('${r.id}', this)" title="Não é erro / duplicado / spam">✕ Dispensar</button>`;

    let actions = '';
    let chip = '';
    if (state === 'open') {
      actions = `${previewBtn}${archiveBtn}${dismissBtn}`;
    } else if (state === 'corrected') {
      actions = `${previewBtn}${archiveBtn}`;
      chip = `<span class="report-status-chip status-corrected" title="Phase 3+: editor salvou correção, aguarda revisão">🟡 Corrigido · ${shortDate(r.corrected_at)}</span>`;
    } else if (state === 'verified') {
      actions = `${previewBtn}`;
      chip = `<span class="report-status-chip status-archived">📦 Arquivado · ${shortDate(r.verified_at)}</span>`;
    } else { // dismissed
      actions = `${previewBtn}`;
      chip = `<span class="report-status-chip" style="background:rgba(120,120,120,0.1); color:#888;">✕ Dispensado</span>`;
    }

    // Diff só aparece se houver pt_before + pt_after (vem da Phase 3)
    let diffHtml = '';
    if (r.pt_after && r.pt_before) {
      diffHtml = `
        <div class="report-diff">
          <div class="diff-side diff-before">
            <div class="diff-label">📄 Antes</div>
            <div class="diff-text">${_escHtml(r.pt_before)}</div>
          </div>
          <div class="diff-side diff-after">
            <div class="diff-label">✅ Depois</div>
            <div class="diff-text">${_escHtml(r.pt_after)}</div>
          </div>
        </div>`;
    }

    return `
      <div class="report-card state-${state}" id="guia-report-card-${r.id}">
        <div class="report-header">
          <span class="report-vol">${_escHtml(tabLabel)}</span>
          <span class="report-file" title="${_escHtml(r.article_id || '')}">${_escHtml(articleTitle)}</span>
          <span class="report-date">${date}</span>
          ${actions ? `<div class="report-actions" style="display:flex; gap:8px; flex-wrap:wrap;">${actions}</div>` : ''}
        </div>
        ${chip ? `<div class="report-chip-row">${chip}</div>` : ''}
        ${!diffHtml ? `<div class="report-text"><mark class="report-selected">${_escHtml(r.selected_text || '')}</mark></div>` : ''}
        ${r.description ? `<div class="report-description">${_escHtml(r.description)}</div>` : ''}
        ${diffHtml}
      </div>`;
  }

  // Agrupa por tab
  function renderGroup(list, state, headerPrefix, opts = {}) {
    const byTab = {};
    list.forEach(r => {
      const t = r.tab || '_outras';
      if (!byTab[t]) byTab[t] = [];
      byTab[t].push(r);
    });
    let out = '';
    // Ordem fixa pra previsibilidade; tabs novas caem no fim
    const tabOrder = ['fundamentos','pratica','critica_farmacologica','por_regiao','estudo_aprofundado','estudo_detalhado','pontos_focais','mapa','culto_mensal'];
    const seen = new Set();
    for (const tabKey of tabOrder) {
      const group = byTab[tabKey];
      if (!group || group.length === 0) continue;
      seen.add(tabKey);
      const tabName = GUIA_TAB_LABELS[tabKey] || tabKey;
      out += `<div class="report-group-label" style="${opts.labelStyle || ''}">${headerPrefix} ${_escHtml(tabName)} — ${group.length}</div>`;
      group.forEach(r => { out += buildCard(r, state); });
    }
    // Tabs não previstas no array acima
    for (const tabKey of Object.keys(byTab)) {
      if (seen.has(tabKey)) continue;
      const group = byTab[tabKey];
      const tabName = GUIA_TAB_LABELS[tabKey] || tabKey;
      out += `<div class="report-group-label" style="${opts.labelStyle || ''}">${headerPrefix} ${_escHtml(tabName)} — ${group.length}</div>`;
      group.forEach(r => { out += buildCard(r, state); });
    }
    return out;
  }

  let html = '';

  if (open.length > 0) {
    html += '<div class="report-list" id="guiaPendingList">';
    html += renderGroup(open, 'open', '⚠');
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

  if (open.length === 0 && corrected.length === 0) {
    html += '<div class="report-empty">✅ Nenhum reporte pendente.</div>';
  }

  const archive = [...verified, ...dismissed];
  if (archive.length > 0) {
    html += `
      <div class="report-verified-section" style="margin-top:24px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <button class="report-verify-btn" id="guiaVerifiedToggle" onclick="toggleGuiaVerifiedSection()" style="gap:6px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="guiaVerifiedToggleIcon" style="transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>
            Histórico <span style="opacity:0.6; font-weight:400;">(${verified.length} arquivados · ${dismissed.length} dispensados)</span>
          </button>
        </div>
        <div class="report-verified-body" id="guiaVerifiedBody" style="display:none">
          <div class="report-list">
            ${renderGroup(verified, 'verified', '📦', { labelStyle: 'opacity:0.6' })}
            ${renderGroup(dismissed, 'dismissed', '✕', { labelStyle: 'opacity:0.6' })}
          </div>
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

function toggleGuiaVerifiedSection() {
  const body = document.getElementById('guiaVerifiedBody');
  const icon = document.getElementById('guiaVerifiedToggleIcon');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.style.transform = open ? '' : 'rotate(180deg)';
}

async function _updateGuiaReportStatus(id, newStatus, timestampField, btnEl, origLabel) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }

  const update = { status: newStatus };
  if (timestampField) update[timestampField] = new Date().toISOString();

  const { error } = await supabase
    .from('translation_reports_guia')
    .update(update)
    .eq('id', id);

  if (error) {
    console.error(`[guia-reports] status→${newStatus} failed:`, error.message);
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = origLabel; }
    alert(`Erro ao atualizar: ${error.message}`);
    return;
  }

  const idx = _allGuiaReports.findIndex(r => r.id === id);
  if (idx !== -1) Object.assign(_allGuiaReports[idx], update);
  _renderGuiaReports();
}

async function archiveGuiaReport(id, btnEl) {
  return _updateGuiaReportStatus(id, 'verified', 'verified_at', btnEl, '📦 Arquivar');
}

async function dismissGuiaReport(id, btnEl) {
  if (!confirm('Dispensar este reporte?\n(Some da lista principal e vai pro histórico marcado como "não é erro")')) return;
  return _updateGuiaReportStatus(id, 'dismissed', null, btnEl, '✕ Dispensar');
}

Object.assign(window, {
  loadGuiaReports,
  toggleGuiaVerifiedSection,
  archiveGuiaReport,
  dismissGuiaReport,
});
