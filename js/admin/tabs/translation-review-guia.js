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
      ? `<button class="report-verify-btn" style="background:rgba(0,122,255,0.1); color:#007aff; border-color:rgba(0,122,255,0.3);" onclick="window.open(${_escHtml(JSON.stringify(r.page_url))}, '_blank')" title="Abrir artigo no site">👁️ Preview</button>`
      : '';

    const editBtn = `<button class="report-verify-btn" style="background:rgba(255,160,0,0.12); color:#a87a1b; border-color:rgba(255,160,0,0.4);" onclick="openGuiaEditor('${r.id}')" title="Abrir editor inline, fixar trecho reportado">✏️ Editar</button>`;
    const archiveBtn = `<button class="report-verify-btn" style="background:rgba(52,199,89,0.15); color:#1f8a3f; border-color:rgba(52,199,89,0.4);" onclick="archiveGuiaReport('${r.id}', this)" title="Marcar como resolvido">📦 Arquivar</button>`;
    const dismissBtn = `<button class="report-verify-btn" style="background:rgba(255,59,48,0.1); color:#ff3b30; border-color:rgba(255,59,48,0.3);" onclick="dismissGuiaReport('${r.id}', this)" title="Não é erro / duplicado / spam">✕ Dispensar</button>`;

    let actions = '';
    let chip = '';
    if (state === 'open') {
      actions = `${previewBtn}${editBtn}${archiveBtn}${dismissBtn}`;
    } else if (state === 'corrected') {
      actions = `${previewBtn}${editBtn}${archiveBtn}`;
      chip = `<span class="report-status-chip status-corrected" title="Editor salvou correção, aguarda revisão de outro admin">🟡 Corrigido · ${shortDate(r.corrected_at)}</span>`;
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

// ============================================================
// Editor inline — Phase 3
// Baixa o JSON do Storage, acha o artigo, edita conteudo, salva
// de volta + captura pt_before/pt_after no reporte.
// ============================================================

// Mapeia tab → arquivo no bucket guia-data
const GUIA_TAB_TO_FILE = {
  fundamentos:           'tab_fundamentos.json',
  pratica:               'tab_pratica.json',
  critica_farmacologica: 'tab_critica_farmacologica.json',
  por_regiao:            'tab_por_regiao.json',
  estudo_aprofundado:    'tab_estudo_aprofundado.json',
  estudo_detalhado:      'tab_estudo_detalhado.json',
};

let _ge_currentReport = null;
let _ge_currentFile = null;
let _ge_currentJson = null;
let _ge_currentPath = null;       // [s, c, a] em sub_abas[s].categorias[c].artigos[a]
let _ge_originalConteudo = null;
let _ge_originalConteudoJp = null;
let _ge_mode = 'grid';             // 'paragraph' | 'grid' (modo de render do editor)
let _ge_focusedRowIdx = -1;        // qual linha de parágrafo está focada (modo parágrafo)

// Localiza artigo dentro de tab_*.json (schema A)
function _ge_findArticleInTabJson(json, articleId) {
  if (!json || !json.sub_abas) return null;
  for (let s = 0; s < json.sub_abas.length; s++) {
    const cats = json.sub_abas[s].categorias || [];
    for (let c = 0; c < cats.length; c++) {
      const arts = cats[c].artigos || [];
      for (let a = 0; a < arts.length; a++) {
        if (arts[a].id === articleId) return { article: arts[a], path: [s, c, a] };
      }
    }
  }
  return null;
}

function _ge_setStatus(html, isError = false) {
  const el = document.getElementById('guia-editor-status');
  if (!el) return;
  el.innerHTML = html;
  el.style.color = isError ? '#ff3b30' : 'var(--text-muted)';
  el.style.display = 'block';
}

async function openGuiaEditor(reportId) {
  const r = (_allGuiaReports || []).find(x => x.id === reportId);
  if (!r) return;

  const filename = GUIA_TAB_TO_FILE[r.tab];
  if (!filename) {
    alert(`Editor inline ainda não disponível pra aba "${r.tab}".\n\nEsta aba lê do guia_atendimento.json (schema diferente).\nPor enquanto, edite manualmente no Supabase Dashboard → Storage → guia-data.`);
    return;
  }

  _ge_currentReport = r;
  _ge_currentFile = filename;
  _ge_currentJson = null;
  _ge_currentPath = null;
  _ge_originalConteudo = null;

  const modal = document.getElementById('guia-editor-modal');
  if (!modal) {
    alert('Modal do editor não está no DOM (admin-supabase.html desatualizado?).');
    return;
  }
  modal.classList.add('open');

  // Popula contexto
  document.getElementById('guia-editor-article-title').textContent = r.article_title || r.article_id || '(sem título)';
  document.getElementById('guia-editor-tab').textContent = GUIA_TAB_LABELS[r.tab] || r.tab;
  document.getElementById('guia-editor-file').textContent = filename;
  document.getElementById('guia-editor-selected').textContent = r.selected_text || '';
  const descLabel = document.getElementById('guia-editor-desc-label');
  const descEl    = document.getElementById('guia-editor-desc');
  if (r.description) {
    descLabel.style.display = 'block';
    descEl.style.display = 'block';
    descEl.textContent = r.description;
  } else {
    descLabel.style.display = 'none';
    descEl.style.display = 'none';
    descEl.textContent = '';
  }

  const ta = document.getElementById('guia-editor-area');
  const jpTa = document.getElementById('guia-editor-jp');
  const grid = document.getElementById('guia-editor-grid');
  const jpCol = document.getElementById('guia-editor-jp-col');
  const paras = document.getElementById('guia-editor-paragraphs');
  ta.value = '';
  if (jpTa) jpTa.value = '';
  if (grid) grid.style.display = 'none';
  if (jpCol) jpCol.style.display = 'none';
  if (paras) { paras.style.display = 'none'; paras.innerHTML = ''; }
  _ge_mode = 'grid';
  _ge_focusedRowIdx = -1;
  const saveBtn = document.getElementById('guia-editor-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '💾 Salvar e marcar Corrigido';
  // Esconde botão "Retraduzir tudo" até confirmarmos que JP existe
  const retradBtn = document.getElementById('guia-editor-retraduzir');
  if (retradBtn) retradBtn.style.display = 'none';

  _ge_setStatus('Baixando arquivo do Storage…');

  let data, error;
  try {
    ({ data, error } = await supabase.storage.from('guia-data').download(filename));
  } catch (e) {
    _ge_setStatus(`Falha de rede: ${_escHtml(e.message)}`, true);
    return;
  }
  if (error) {
    _ge_setStatus(`Erro ao baixar: ${_escHtml(error.message)}`, true);
    return;
  }

  let text, json;
  try {
    text = await data.text();
    json = JSON.parse(text);
  } catch (e) {
    _ge_setStatus(`JSON inválido em ${filename}: ${_escHtml(e.message)}`, true);
    return;
  }

  const located = _ge_findArticleInTabJson(json, r.article_id);
  if (!located) {
    _ge_setStatus(`Artigo "${_escHtml(r.article_id)}" não encontrado em ${filename}. Talvez o id tenha mudado desde o reporte.`, true);
    return;
  }

  _ge_currentJson = json;
  _ge_currentPath = located.path;
  const conteudo = located.article.conteudo || '';
  _ge_originalConteudo = conteudo;
  const jp = located.article.conteudo_jp || located.article.content_jp || '';
  _ge_originalConteudoJp = jp;

  // Mostra "Retraduzir tudo" quando há JP (qualquer modo)
  if (jp && retradBtn) retradBtn.style.display = 'inline-block';

  const ptParas = conteudo.split(/\n\n+/);
  const jpParas = jp.split(/\n\n+/);
  const needle = (r.selected_text || '').trim();

  // Modo parágrafo a parágrafo: requer JP existente E bijeção exata
  if (jp && jpParas.length === ptParas.length && ptParas.length >= 1) {
    _ge_mode = 'paragraph';
    _ge_renderParagraphs(ptParas, jpParas, needle);
    paras.style.display = 'flex';
  } else {
    // Fallback: modo grid 2-col (ou single col sem JP)
    _ge_mode = 'grid';
    if (jp && jpTa && jpCol && grid) {
      jpTa.value = jp;
      jpCol.style.display = 'block';
      grid.style.display = 'flex';
      if (jpParas.length !== ptParas.length && ptParas.length > 0) {
        _ge_setStatus(`⚠ JP tem ${jpParas.length} parágrafos, PT tem ${ptParas.length}. Modo lado-a-lado (sem bijeção exata). Edite manualmente.`, true);
      }
    } else if (grid) {
      grid.style.display = 'block';
    }
    ta.value = conteudo;
    if (jp && jpParas.length === ptParas.length) {
      // bijeção ok mas algum outro motivo caiu aqui (defensivo)
      document.getElementById('guia-editor-status').style.display = 'none';
    }

    // Auto-localiza o trecho reportado no textarea único
    if (needle) {
      const match = _ge_findNeedle(conteudo, needle);
      if (match) {
        ta.focus();
        ta.setSelectionRange(match.start, match.end);
        const before = conteudo.slice(0, match.start);
        const linesBefore = (before.match(/\n/g) || []).length;
        const lineHeight = parseInt(getComputedStyle(ta).lineHeight, 10) || 22;
        ta.scrollTop = Math.max(0, linesBefore * lineHeight - 80);
        if (match.fuzzy && !document.getElementById('guia-editor-status').textContent) {
          _ge_setStatus(`⚠ Trecho exato não encontrado — selecionei a melhor aproximação. Use Ctrl+F se precisar.`, true);
        }
      } else {
        ta.focus();
        if (!document.getElementById('guia-editor-status').textContent) {
          _ge_setStatus(`⚠ Trecho reportado não foi localizado no artigo. Use Ctrl+F pra buscar manualmente.`, true);
        }
      }
    }
  }

  saveBtn.disabled = false;
}

// ────────────────────────────────────────────────────────────
// Render modo parágrafo: linhas JP|PT, bijetadas 1:1
// ────────────────────────────────────────────────────────────
function _ge_renderParagraphs(ptParas, jpParas, needle) {
  const container = document.getElementById('guia-editor-paragraphs');
  if (!container) return;
  container.innerHTML = '';

  // Localiza qual parágrafo contém o trecho reportado (tolerante)
  let targetRow = -1;
  if (needle) {
    for (let i = 0; i < ptParas.length; i++) {
      const m = _ge_findNeedle(ptParas[i], needle);
      if (m) { targetRow = i; break; }
    }
  }

  for (let i = 0; i < ptParas.length; i++) {
    const row = document.createElement('div');
    row.className = 'ge-para-row';
    row.dataset.idx = String(i);
    row.style.cssText = `
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
      padding: 12px; border: 1px solid ${i === targetRow ? 'rgba(255,160,0,0.45)' : 'var(--border)'};
      border-radius: 8px;
      background: ${i === targetRow ? 'rgba(255,160,0,0.05)' : 'transparent'};
    `;

    const jpCell = document.createElement('div');
    jpCell.style.cssText = 'min-width:0;';
    jpCell.innerHTML = `
      <div style="font-size:.65rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.08em; margin-bottom:4px;">📜 JP · ¶${i+1}</div>
      <pre style="margin:0; padding:10px; background:rgba(0,0,0,0.02); border:1px solid var(--border); border-radius:6px; font-family:'Noto Serif JP','Yu Mincho',serif; font-size:.9rem; line-height:1.8; color:var(--text); white-space:pre-wrap; word-wrap:break-word; max-height:300px; overflow-y:auto;"></pre>
    `;
    jpCell.querySelector('pre').textContent = jpParas[i];

    const ptCell = document.createElement('div');
    ptCell.style.cssText = 'min-width:0; position:relative;';
    ptCell.innerHTML = `
      <div style="font-size:.65rem; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:.08em; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
        <span>✏️ PT · ¶${i+1}${i === targetRow ? ' · <span style="color:#a87a1b;">⚠ reportado</span>' : ''}</span>
        <button type="button" class="ge-para-ai-btn" data-idx="${i}" title="Sugerir IA pra este parágrafo" style="padding:2px 8px; background:rgba(168,85,247,0.1); color:#a855f7; border:1px solid rgba(168,85,247,0.3); border-radius:5px; font-size:.7rem; font-weight:600; cursor:pointer; text-transform:none; letter-spacing:0;">✨ IA</button>
      </div>
      <textarea class="ge-para-pt" data-idx="${i}" spellcheck="true" wrap="soft"
        style="width:100%; box-sizing:border-box; min-height:80px; padding:10px;
          font-family:'Crimson Pro',serif; font-size:.92rem; line-height:1.6;
          border:1px solid var(--border); border-radius:6px;
          background:var(--bg); color:var(--text); resize:vertical;
          white-space:pre-wrap; word-wrap:break-word; overflow-wrap:break-word; outline:none;"></textarea>
    `;
    const taPara = ptCell.querySelector('textarea');
    taPara.value = ptParas[i];

    // Auto-resize approximado pra caber o conteúdo (linhas + padding)
    const lines = (ptParas[i].match(/\n/g) || []).length + 1;
    const approxLines = Math.max(lines, Math.ceil(ptParas[i].length / 80));
    taPara.style.minHeight = Math.max(80, approxLines * 22 + 20) + 'px';

    taPara.addEventListener('focus', () => { _ge_focusedRowIdx = i; });
    taPara.addEventListener('input', () => { _ge_focusedRowIdx = i; });

    row.appendChild(jpCell);
    row.appendChild(ptCell);
    container.appendChild(row);
  }

  // Wire dos botões IA por parágrafo
  container.querySelectorAll('.ge-para-ai-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      _ge_focusedRowIdx = parseInt(btn.dataset.idx, 10);
      const ta = container.querySelector(`textarea.ge-para-pt[data-idx="${_ge_focusedRowIdx}"]`);
      if (ta) ta.focus();
      suggestGuiaAI();
    });
  });

  // Foca + scroll + auto-select do trecho reportado
  if (targetRow >= 0) {
    setTimeout(() => {
      const rowEl = container.querySelector(`.ge-para-row[data-idx="${targetRow}"]`);
      const ta = container.querySelector(`textarea.ge-para-pt[data-idx="${targetRow}"]`);
      if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (ta) {
        ta.focus();
        _ge_focusedRowIdx = targetRow;
        const m = _ge_findNeedle(ta.value, needle);
        if (m) {
          ta.setSelectionRange(m.start, m.end);
          if (m.fuzzy) {
            _ge_setStatus(`⚠ Match aproximado no ¶${targetRow+1} — pontuação/espaços podem ter mudado desde o reporte.`, true);
          } else {
            document.getElementById('guia-editor-status').style.display = 'none';
          }
        }
      }
    }, 200);
  } else if (needle) {
    _ge_setStatus(`⚠ Trecho reportado não localizado em nenhum parágrafo. Procure manualmente nas ${ptParas.length} caixas.`, true);
  } else {
    document.getElementById('guia-editor-status').style.display = 'none';
  }
}

// Localiza needle dentro de haystack com tolerância progressiva:
// 1) match exato
// 2) match com whitespace colapsado
// 3) match dos primeiros N "tokens" (palavras ≥4 chars) — fuzzy
// Devolve { start, end, fuzzy: boolean } ou null.
function _ge_findNeedle(haystack, needle) {
  if (!needle) return null;
  // (1) exato
  let idx = haystack.indexOf(needle);
  if (idx >= 0) return { start: idx, end: idx + needle.length, fuzzy: false };

  // (2) whitespace colapsado nos dois lados — reconstrói índice
  const collapseMap = [];
  let collapsed = '';
  let prev = ' ';
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i];
    const isWs = /\s/.test(ch);
    if (isWs) {
      if (prev !== ' ') {
        collapsed += ' ';
        collapseMap.push(i);
      }
      prev = ' ';
    } else {
      collapsed += ch;
      collapseMap.push(i);
      prev = ch;
    }
  }
  const needleNorm = needle.replace(/\s+/g, ' ').trim();
  idx = collapsed.indexOf(needleNorm);
  if (idx >= 0 && collapseMap[idx] !== undefined && collapseMap[idx + needleNorm.length - 1] !== undefined) {
    return {
      start: collapseMap[idx],
      end: collapseMap[idx + needleNorm.length - 1] + 1,
      fuzzy: false
    };
  }

  // (3) fuzzy: prefixo decrescente. Útil quando alguém já editou o trecho
  // (ex.: trocou ";" por "—") e só a primeira metade casa. Quebra em
  // boundary de palavra pra não cortar no meio.
  const minPrefix = 15;
  for (let len = needleNorm.length - 1; len >= minPrefix; len -= 4) {
    let probe = needleNorm.slice(0, len);
    // Recua até o fim de uma palavra
    const lastSpace = probe.lastIndexOf(' ');
    if (lastSpace >= minPrefix) probe = probe.slice(0, lastSpace);
    if (probe.length < minPrefix) break;
    const idx = collapsed.indexOf(probe);
    if (idx >= 0 && collapseMap[idx] !== undefined) {
      const startReal = collapseMap[idx];
      // Estende até o comprimento aproximado do needle original
      const endReal = Math.min(haystack.length, startReal + needle.length);
      return { start: startReal, end: endReal, fuzzy: true };
    }
  }

  return null;
}

function closeGuiaEditor(force = false) {
  if (!force && _ge_originalConteudo !== null) {
    let current;
    if (_ge_mode === 'paragraph') {
      const tas = document.querySelectorAll('#guia-editor-paragraphs textarea.ge-para-pt');
      const arr = [];
      tas.forEach(t => { arr[parseInt(t.dataset.idx, 10)] = t.value; });
      current = arr.join('\n\n');
    } else {
      current = document.getElementById('guia-editor-area')?.value || '';
    }
    if (current !== _ge_originalConteudo) {
      if (!confirm('Há alterações não salvas. Descartar?')) return;
    }
  }
  const modal = document.getElementById('guia-editor-modal');
  if (modal) modal.classList.remove('open');
  _ge_currentReport = null;
  _ge_currentFile = null;
  _ge_currentJson = null;
  _ge_currentPath = null;
  _ge_originalConteudo = null;
  _ge_originalConteudoJp = null;
  _ge_mode = 'grid';
  _ge_focusedRowIdx = -1;
}

async function saveGuiaEditor() {
  if (!_ge_currentReport || !_ge_currentJson || !_ge_currentPath) return;
  const ta = document.getElementById('guia-editor-area');
  const saveBtn = document.getElementById('guia-editor-save');

  // Coleta conteúdo conforme modo de render
  let newConteudo;
  if (_ge_mode === 'paragraph') {
    const tas = document.querySelectorAll('#guia-editor-paragraphs textarea.ge-para-pt');
    const arr = [];
    tas.forEach(t => { arr[parseInt(t.dataset.idx, 10)] = t.value; });
    newConteudo = arr.join('\n\n');
  } else {
    newConteudo = ta.value;
  }

  if (newConteudo === _ge_originalConteudo) {
    _ge_setStatus('Nada mudou — feche pra cancelar.', true);
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvando…';
  _ge_setStatus('Subindo JSON pro Storage…');

  // Aplica edição no JSON
  const [s, c, a] = _ge_currentPath;
  _ge_currentJson.sub_abas[s].categorias[c].artigos[a].conteudo = newConteudo;

  const finalJson = JSON.stringify(_ge_currentJson, null, 2);
  const blob = new Blob([finalJson], { type: 'application/json' });

  const { error: upErr } = await supabase.storage.from('guia-data')
    .upload(_ge_currentFile, blob, { upsert: true, contentType: 'application/json', cacheControl: '0' });

  if (upErr) {
    _ge_setStatus(`Erro ao salvar no Storage: ${_escHtml(upErr.message)}`, true);
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Salvar e marcar Corrigido';
    return;
  }

  // Captura pt_before/pt_after — preferência: parágrafo (split \n\n) que continha selected_text
  let pt_before = _ge_originalConteudo;
  let pt_after  = newConteudo;
  const needle = (_ge_currentReport.selected_text || '').trim();
  if (needle) {
    const parasBefore = _ge_originalConteudo.split(/\n\n+/);
    const parasAfter  = newConteudo.split(/\n\n+/);
    const beforeIdx = parasBefore.findIndex(p => p.includes(needle));
    // Só usa o parágrafo isolado se a contagem casar (edição inline, sem reordenar)
    if (beforeIdx >= 0 && parasBefore.length === parasAfter.length) {
      pt_before = parasBefore[beforeIdx];
      pt_after  = parasAfter[beforeIdx];
    }
  }

  const now = new Date().toISOString();
  const update = { status: 'corrected', corrected_at: now, pt_before, pt_after };
  const { error: updErr } = await supabase
    .from('translation_reports_guia')
    .update(update)
    .eq('id', _ge_currentReport.id);

  if (updErr) {
    _ge_setStatus(`Arquivo salvo no Storage, mas falhou atualizar o reporte: ${_escHtml(updErr.message)}`, true);
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Salvar e marcar Corrigido';
    return;
  }

  // Sync local
  const idx = _allGuiaReports.findIndex(r => r.id === _ge_currentReport.id);
  if (idx !== -1) Object.assign(_allGuiaReports[idx], update);

  _ge_setStatus('✅ Salvo. Site público mostra a edição na próxima carga.');
  saveBtn.textContent = '✓ Salvo';

  // Marca como salvo pra que close() não pergunte
  _ge_originalConteudo = newConteudo;

  setTimeout(() => {
    closeGuiaEditor(true);
    _renderGuiaReports();
  }, 1200);
}

// ============================================================
// Sugestão IA — Phase 4
// Botão dentro do editor: monta prompt com glossário Johrei +
// passagem reportada + comentário + artigo completo (contexto),
// copia pro clipboard, abre claude.ai em tab nomeada. Quando user
// volta, auto-cola resposta do clipboard. Parse, compara lado-a-
// lado, aplica substituindo a selection do textarea.
// ============================================================

const GUIA_AI_GUIDELINES = `Você é um revisor sênior brasileiro, devoto da Sekaikyūseikyō, com conhecimento profundo dos ensinamentos de Meishu-sama sobre Johrei. Sua tarefa é revisar trechos do Guia Prático do Johrei (material de referência pra ministrantes brasileiros) em português brasileiro elevado mas acessível.

PRINCÍPIO DOUTRINÁRIO: o que o mundo chama de "doença" é, sob a ótica de Meishu-sama, purificação se manifestando. Use "doença" quando descrever o fenômeno externo; use "purificação", "manifestação" ou "afecção" quando a perspectiva for doutrinária.

GLOSSÁRIO MANDATÓRIO (nunca substituir por sinônimos):
- jōka / 浄化 → purificação
- yakudoku / 薬毒 → toxinas medicinais (NUNCA "veneno")
- kyūsho / 急所 → ponto vital
- katamari / 固まり → indurações (técnico) ou solidificações (nódulos)
- Johrei / 浄霊 → Johrei (nunca traduzir)
- Ohikari / 御光 → Ohikari (1ª menção: "Ohikari [御光]"; depois "Ohikari")
- 浄霊医術 → arte do Johrei (NUNCA "arte médica do Johrei")
- 力を抜く → retirar a força (NUNCA "relaxar a força")
- Komyo Nyorai / 光明如来 → Komyo Nyorai (não traduzir)
- Kannon / 観音 → Kannon (1ª menção: "Kannon [観音]"; depois "Kannon")
- Shakuson / 釈尊 → Shakuson
- kamisama / 神様 → Deus (sem "nosso", sem "o Senhor")
- oshie / 教え → ensinamento (não "doutrina")
- sukui / 救い → salvação
- gokago / 御加護 → proteção divina
- in'nen / 因縁 → vínculo cármico
- gō / 業 → carma
- zaie / 罪穢 → impurezas espirituais
- shinkō / 信仰 → fé (não "crença" nem "fervor")
- Meishu-sama (minúsculo no "sama")

CALIBRAÇÃO DE REGISTRO PT-BR:
Português brasileiro natural pra ministrantes. Solene mas não pomposo. Direto mas não casual. Como um mestre japonês falando português brasileiro fluente.

EVITAR (lusitanismos e academicismos):
- "Ademais" / "Outrossim" → "Além disso", "E ainda"
- "Cumpre" / "Mister" → "É preciso", "É necessário"
- "Eis que" → "Vejam:", "Pois bem,"
- "Por conseguinte" / "Destarte" → "Por isso", "Assim"
- "Configura-se como" → "É", "Constitui"
- "Sob esta ótica" → "Deste ponto de vista"
- "Há que se" → "É preciso"
- "Outrora" → "Antigamente"
- "Em contrapartida" excessivo → alternar com "Por outro lado", "Já"
- Em-dash decorativo (—) substituindo vírgula ou ponto sem razão

PREFERIR:
- Conectivos vivos: "Por isso", "Assim", "Desta forma"
- Convocações diretas: "Vejam:", "Compreendam:", "É fundamental notar:"
- "É preciso" em vez de "É imperativo"
- Sacralidade brasileira: "graça divina", "missão", "fé verdadeira"

REGRA DE BIJEÇÃO: NUNCA fundir nem dividir parágrafos. Mantenha a mesma quantidade de quebras de linha do texto original. Se o trecho selecionado é uma frase dentro de um parágrafo, devolva apenas essa frase corrigida — não o parágrafo todo.`;

const GUIA_CLAUDE_TAB = 'guia-claude-ai-correction';
let _ge_aiPasteEl = null;       // textarea aguardando paste
let _ge_aiLastAutoPasted = '';

async function suggestGuiaAI() {
  if (!_ge_currentReport || _ge_originalConteudo == null) return;

  const r = _ge_currentReport;

  let selectedNow = '';
  let contextPara = '';
  let jpPara = '';
  let jpFullForFallback = '';
  let ptParaIdx = -1;

  if (_ge_mode === 'paragraph') {
    // Modo parágrafo: usa a row focada (ou a do reporte se nenhuma focada ainda)
    let idx = _ge_focusedRowIdx;
    if (idx < 0) {
      // fallback: acha row que tem o needle reportado
      const tas = document.querySelectorAll('#guia-editor-paragraphs textarea.ge-para-pt');
      const needle = (r.selected_text || '').trim();
      tas.forEach(t => {
        if (idx < 0 && needle && _ge_findNeedle(t.value, needle)) idx = parseInt(t.dataset.idx, 10);
      });
      if (idx < 0) idx = 0;
    }
    const taPara = document.querySelector(`#guia-editor-paragraphs textarea.ge-para-pt[data-idx="${idx}"]`);
    if (!taPara) return;

    ptParaIdx = idx;
    contextPara = taPara.value;
    // Texto selecionado: o que o admin destacou na textarea, ou o needle reportado
    const ss = taPara.selectionStart, se = taPara.selectionEnd;
    selectedNow = (se > ss) ? taPara.value.slice(ss, se) : (r.selected_text || taPara.value);

    // JP correspondente: o <pre> da mesma row
    const row = taPara.closest('.ge-para-row');
    const jpEl = row?.querySelector('pre');
    if (jpEl) jpPara = jpEl.textContent || '';
  } else {
    // Modo grid (textarea único): comportamento anterior
    const ta = document.getElementById('guia-editor-area');
    const selStart = ta.selectionStart;
    const selEnd = ta.selectionEnd;
    selectedNow = (selEnd > selStart)
      ? ta.value.slice(selStart, selEnd)
      : (r.selected_text || '');

    const ptParas = ta.value.split(/\n\n+/);
    if (selectedNow) {
      ptParaIdx = ptParas.findIndex(p => p.includes(selectedNow));
      if (ptParaIdx >= 0) contextPara = ptParas[ptParaIdx];
    }

    const jpTa = document.getElementById('guia-editor-jp');
    const jpFull = jpTa?.value || '';
    if (jpFull) {
      const jpParas = jpFull.split(/\n\n+/);
      if (ptParaIdx >= 0 && jpParas.length === ptParas.length) {
        jpPara = jpParas[ptParaIdx];
      } else if (ptParaIdx >= 0 && jpParas[ptParaIdx]) {
        jpPara = jpParas[ptParaIdx];
      }
      if (!jpPara) jpFullForFallback = jpFull;
    }
  }

  const hasJp = !!(jpPara || jpFullForFallback);

  const taskBlock = hasJp
    ? `## TAREFA

Você tem o **japonês original como fonte canônica**. Sua tarefa é avaliar se a tradução PT atual transmite fielmente o significado doutrinário do JP, aplicando o glossário e a calibração de registro PT-BR.

Devolva APENAS o trecho selecionado retraduzido (sem o parágrafo inteiro), preservando:
- O sentido doutrinário do JP
- A quantidade original de quebras de linha
- A correspondência 1:1 entre frases JP e PT (não fundir nem dividir)`
    : `## TAREFA

Analise o trecho à luz do glossário, da calibração de registro e do comentário do usuário. Devolva APENAS o trecho selecionado corrigido (sem o parágrafo inteiro), preservando o sentido doutrinário e a quantidade original de quebras de linha.`;

  const prompt = `${GUIA_AI_GUIDELINES}

---

## CONTEXTO

**Arquivo:** ${_ge_currentFile} (Guia do Johrei — Supabase Storage)
**Aba:** ${GUIA_TAB_LABELS[r.tab] || r.tab}
**Artigo:** ${r.article_title || r.article_id}
${hasJp ? '**Fonte JP disponível:** sim (usar como referência canônica)' : '**Fonte JP disponível:** não (revisão PT-only)'}

## TRECHO PT A REVISAR

"${selectedNow}"
${r.description ? `\n## COMENTÁRIO DO USUÁRIO (pista sobre o erro)\n\n"${r.description}"\n` : ''}
${contextPara && contextPara !== selectedNow ? `## PARÁGRAFO PT COMPLETO (contexto — não retradurar)\n\n${contextPara}\n` : ''}
${jpPara ? `## PARÁGRAFO JP CORRESPONDENTE (fonte canônica)\n\n${jpPara}\n` : ''}
${jpFullForFallback ? `## ARTIGO JP COMPLETO (contexto — bijeção parágrafo a parágrafo não detectada)\n\n${jpFullForFallback.slice(0, 3000)}${jpFullForFallback.length > 3000 ? '\n[…JP truncado]' : ''}\n` : ''}
---

${taskBlock}

## FORMATO OBRIGATÓRIO DA RESPOSTA

**📜 Trecho corrigido:**
[apenas o trecho corrigido, pronto pra colar de volta no admin]

**💡 Justificativa:**
- [Mudança 1: regra/termo aplicado${hasJp ? ' / divergência JP→PT corrigida' : ''}]
- [Mudança 2 se houver]`;

  try {
    await navigator.clipboard.writeText(prompt);
  } catch (e) {
    const tmp = document.createElement('textarea');
    tmp.value = prompt;
    tmp.style.position = 'fixed'; tmp.style.opacity = '0';
    document.body.appendChild(tmp); tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
  }

  window.open('https://claude.ai/new', GUIA_CLAUDE_TAB);

  // Mostra painel de paste abaixo do textarea
  let panel = document.getElementById('guia-editor-ai-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'guia-editor-ai-panel';
    panel.style.cssText = 'margin-top:12px; padding:14px; border:1px solid rgba(168,85,247,0.35); border-radius:10px; background:rgba(168,85,247,0.04);';
    document.getElementById('guia-editor-area').insertAdjacentElement('afterend', panel);
  }
  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="font-size:.72rem; font-weight:700; color:#a855f7; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px;">✨ Sugestão da IA</div>
    <div style="font-size:.82rem; color:var(--text-muted); margin-bottom:10px; line-height:1.5;">
      1) Prompt copiado e <a href="https://claude.ai/new" target="${GUIA_CLAUDE_TAB}" style="color:#a855f7;">claude.ai</a> aberto. Cole com Ctrl+V e envie.<br>
      2) Copie a resposta completa do Claude (com 📜) e volte aqui — vai colar automaticamente.
    </div>
    <textarea id="guia-ai-paste" placeholder="Cole aqui a resposta completa do Claude (incluindo o marcador 📜)…"
      style="width:100%; box-sizing:border-box; min-height:100px; padding:8px 10px; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:.85rem; font-family:inherit; resize:vertical;"></textarea>
    <div style="display:flex; gap:8px; margin-top:10px; align-items:center;">
      <button onclick="parseGuiaAISuggestion()" style="padding:6px 14px; background:#a855f7; color:#fff; border:none; border-radius:6px; font-size:.78rem; font-weight:600; cursor:pointer;">Comparar</button>
      <button onclick="discardGuiaAIPanel()" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:.78rem; cursor:pointer;">Cancelar</button>
    </div>
  `;
  _ge_aiPasteEl = panel.querySelector('#guia-ai-paste');
  setTimeout(() => _ge_aiPasteEl?.focus(), 100);
}

function parseGuiaAISuggestion() {
  const panel = document.getElementById('guia-editor-ai-panel');
  const paste = panel?.querySelector('#guia-ai-paste');
  if (!paste) return;
  const raw = (paste.value || '').trim();
  if (!raw) return;

  // Extrai o trecho corrigido (entre 📜 e 💡/fim)
  const m = raw.match(/📜[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\s*💡|\n\s*\*?\*?\s*🔍|$)/);
  let extracted = m ? m[1].trim() : raw;
  extracted = extracted.replace(/^["']\s*|\s*["']$/g, '').replace(/^\*+\s*|\s*\*+$/g, '').trim();

  // Justificativa
  const justMatch = raw.match(/💡[^\n]*\n+([\s\S]*?)$/);
  const justify = justMatch ? justMatch[1].trim().replace(/^["']\s*|\s*["']$/g, '') : '';

  const ta = document.getElementById('guia-editor-area');
  const currentSel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || (_ge_currentReport.selected_text || '');

  _ge_aiPasteEl = null;
  panel.innerHTML = `
    <div style="font-size:.72rem; font-weight:700; color:#a855f7; text-transform:uppercase; letter-spacing:.1em; margin-bottom:10px;">✨ Comparação</div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <div>
        <div style="font-size:.7rem; color:var(--text-muted); margin-bottom:4px; font-weight:600;">📄 Trecho atual</div>
        <div style="padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-radius:6px; font-size:.85rem; line-height:1.55; min-height:60px; white-space:pre-wrap;">${_escHtml(currentSel)}</div>
      </div>
      <div>
        <div style="font-size:.7rem; color:#a855f7; margin-bottom:4px; font-weight:600;">✅ Sugestão (editável)</div>
        <div class="guia-ai-new" contenteditable="true" style="padding:8px 10px; background:rgba(168,85,247,0.05); border:1px solid rgba(168,85,247,0.4); border-radius:6px; font-size:.85rem; line-height:1.55; min-height:60px; white-space:pre-wrap; color:var(--text);">${_escHtml(extracted)}</div>
      </div>
    </div>
    ${justify ? `<div style="margin-top:10px; padding:8px 10px; background:var(--surface); border-left:3px solid #a855f7; border-radius:4px; font-size:.8rem; line-height:1.5; color:var(--text-muted);"><b>💡 Justificativa:</b> ${_escHtml(justify)}</div>` : ''}
    <div style="display:flex; gap:8px; margin-top:10px; align-items:center; flex-wrap:wrap;">
      <button onclick="applyGuiaAISuggestion()" style="padding:6px 14px; background:#34c759; color:#fff; border:none; border-radius:6px; font-size:.78rem; font-weight:600; cursor:pointer;">✓ Aplicar no editor</button>
      <button onclick="discardGuiaAIPanel()" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:.78rem; cursor:pointer;">✗ Descartar</button>
      <span style="font-size:.72rem; color:var(--text-muted);">Edite a sugestão antes de aplicar, se quiser</span>
    </div>
  `;
}

function applyGuiaAISuggestion() {
  const panel = document.getElementById('guia-editor-ai-panel');
  const newEl = panel?.querySelector('.guia-ai-new');
  if (!newEl) return;
  const newText = (newEl.textContent || '').trim();
  if (!newText) return;

  // Em modo parágrafo: aplica no textarea da row focada
  let ta;
  if (_ge_mode === 'paragraph' && _ge_focusedRowIdx >= 0) {
    ta = document.querySelector(`#guia-editor-paragraphs textarea.ge-para-pt[data-idx="${_ge_focusedRowIdx}"]`);
  }
  if (!ta) ta = document.getElementById('guia-editor-area');
  if (!ta) return;

  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  let targetStart = s;
  let targetEnd   = e;
  if (s === e) {
    const orig = _ge_currentReport?.selected_text || '';
    const located = _ge_findNeedle(ta.value, orig);
    if (located) {
      targetStart = located.start;
      targetEnd = located.end;
    } else {
      // Em modo parágrafo, se nada selecionado e needle não casa, substitui a row inteira
      if (_ge_mode === 'paragraph') {
        if (!confirm('Substituir o parágrafo inteiro pela sugestão da IA?')) return;
        targetStart = 0;
        targetEnd = ta.value.length;
      } else {
        alert('Selecione o trecho a substituir no editor antes de aplicar.');
        return;
      }
    }
  }

  const newValue = ta.value.slice(0, targetStart) + newText + ta.value.slice(targetEnd);
  ta.value = newValue;
  ta.focus();
  ta.setSelectionRange(targetStart, targetStart + newText.length);

  // Feedback visual
  ta.style.transition = 'background-color 0.4s';
  ta.style.backgroundColor = 'rgba(52,199,89,0.12)';
  setTimeout(() => { ta.style.backgroundColor = ''; }, 700);

  discardGuiaAIPanel();
}

function discardGuiaAIPanel() {
  const panel = document.getElementById('guia-editor-ai-panel');
  if (panel) {
    panel.style.display = 'none';
    panel.innerHTML = '';
  }
  _ge_aiPasteEl = null;
}

// Auto-paste do clipboard quando admin volta da aba do claude.ai
window.addEventListener('focus', async () => {
  if (!_ge_aiPasteEl || !_ge_aiPasteEl.isConnected || _ge_aiPasteEl.value.trim()) return;
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (e) { return; }
  if (!text || text === _ge_aiLastAutoPasted) return;
  // Heurística: tem marcador 📜 e não é o nosso próprio prompt
  if (!/📜/.test(text)) return;
  if (/GLOSSÁRIO MANDATÓRIO|GUIA_AI_GUIDELINES/.test(text)) return;
  _ge_aiPasteEl.value = text;
  _ge_aiLastAutoPasted = text;
});

// ============================================================
// Retradução completa do artigo — Phase 7
// Diferente do "Sugerir IA" (1 parágrafo) — manda o artigo
// inteiro pra Claude com pedido de retradução fresh do JP,
// devolve N parágrafos numerados, substitui o PT inteiro.
// ============================================================

const GUIA_RETRADUCAO_TAB = 'guia-claude-retraducao';

async function retraduzirTudoGuiaAI() {
  if (!_ge_currentReport || !_ge_originalConteudoJp) {
    alert('Retradução requer fonte JP disponível.');
    return;
  }

  const r = _ge_currentReport;
  const jp = _ge_originalConteudoJp;
  const jpParas = jp.split(/\n\n+/);
  const ptParasAtual = _ge_originalConteudo.split(/\n\n+/);

  // Numera os parágrafos JP no prompt
  const jpNumbered = jpParas.map((p, i) => `¶${i+1}\n${p}`).join('\n\n');

  const prompt = `${GUIA_AI_GUIDELINES}

---

## CONTEXTO

**Arquivo:** ${_ge_currentFile} (Guia do Johrei)
**Aba:** ${GUIA_TAB_LABELS[r.tab] || r.tab}
**Artigo:** ${r.article_title || r.article_id}

## TAREFA: RETRADUÇÃO COMPLETA DO ARTIGO

Você vai retraduzir o artigo INTEIRO do japonês ao português brasileiro.
**NÃO** se baseie na tradução PT atual — ela tem problemas e está sendo
substituída. Traduza fresh do JP, aplicando rigorosamente o glossário e
a calibração de registro PT-BR.

**REGRA DE BIJEÇÃO 1:1 (CRÍTICA):** o JP tem **${jpParas.length} parágrafos**
numerados ¶1 a ¶${jpParas.length}. Devolva EXATAMENTE ${jpParas.length}
parágrafos PT, na mesma ordem e mesma numeração. NÃO fundir, NÃO dividir.

## JAPONÊS ORIGINAL (${jpParas.length} parágrafos)

${jpNumbered}

---

## FORMATO OBRIGATÓRIO DA RESPOSTA

Devolva exatamente ${jpParas.length} parágrafos PT, no formato:

**📜 Retradução completa:**

¶1
[parágrafo 1 retraduzido]

¶2
[parágrafo 2 retraduzido]

...

¶${jpParas.length}
[parágrafo ${jpParas.length} retraduzido]

(Sem texto adicional antes ou depois dos parágrafos numerados.)`;

  try {
    await navigator.clipboard.writeText(prompt);
  } catch (e) {
    const tmp = document.createElement('textarea');
    tmp.value = prompt;
    tmp.style.position = 'fixed'; tmp.style.opacity = '0';
    document.body.appendChild(tmp); tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
  }

  window.open('https://claude.ai/new', GUIA_RETRADUCAO_TAB);

  // Painel de paste — overlay no topo do editor body
  let panel = document.getElementById('guia-editor-retraducao-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'guia-editor-retraducao-panel';
    panel.style.cssText = 'margin-bottom:14px; padding:14px; border:1px solid rgba(99,102,241,0.4); border-radius:10px; background:rgba(99,102,241,0.04);';
    const body = document.querySelector('#guia-editor-modal .editor-body');
    body.insertBefore(panel, body.firstChild);
  }
  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="font-size:.72rem; font-weight:700; color:#6366f1; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px;">🔄 Retradução completa via IA</div>
    <div style="font-size:.82rem; color:var(--text-muted); margin-bottom:10px; line-height:1.5;">
      Prompt copiado e <a href="https://claude.ai/new" target="${GUIA_RETRADUCAO_TAB}" style="color:#6366f1;">claude.ai</a> aberto.
      Cole com Ctrl+V, envie, copie a resposta completa do Claude e cole abaixo.
      <strong>Esperando ${jpParas.length} parágrafos PT</strong> em formato <code>¶N</code>.
    </div>
    <textarea id="guia-retraducao-paste" placeholder="Cole aqui a resposta completa do Claude (com 📜 Retradução completa: e ¶1, ¶2, …)…"
      style="width:100%; box-sizing:border-box; min-height:140px; padding:10px; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:.85rem; font-family:inherit; resize:vertical;"></textarea>
    <div style="display:flex; gap:8px; margin-top:10px; align-items:center; flex-wrap:wrap;">
      <button onclick="parseGuiaRetraducao()" style="padding:6px 14px; background:#6366f1; color:#fff; border:none; border-radius:6px; font-size:.78rem; font-weight:600; cursor:pointer;">Comparar</button>
      <button onclick="discardGuiaRetraducaoPanel()" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:.78rem; cursor:pointer;">Cancelar</button>
      <span style="font-size:.72rem; color:var(--text-muted);">JP tem ${jpParas.length}¶ · PT atual tem ${ptParasAtual.length}¶</span>
    </div>
  `;

  // Auto-paste do clipboard quando user volta da aba claude.ai
  _ge_aiPasteEl = panel.querySelector('#guia-retraducao-paste');
  setTimeout(() => _ge_aiPasteEl?.focus(), 100);
}

function parseGuiaRetraducao() {
  const panel = document.getElementById('guia-editor-retraducao-panel');
  const paste = panel?.querySelector('#guia-retraducao-paste');
  if (!paste) return;
  const raw = (paste.value || '').trim();
  if (!raw) return;

  // Extrai bloco depois de "📜 Retradução completa:" (ou usa raw direto)
  const blockM = raw.match(/📜[^\n]*\n+([\s\S]*)$/);
  const block = blockM ? blockM[1].trim() : raw;

  // Quebra por marcadores ¶N (capturando o número e o conteúdo até o próximo ¶N ou fim)
  const paraRe = /¶(\d+)\s*\n+([\s\S]*?)(?=\n+¶\d+\b|$)/g;
  const found = [];
  let m;
  while ((m = paraRe.exec(block)) !== null) {
    const num = parseInt(m[1], 10);
    const content = m[2].trim();
    found.push({ num, content });
  }

  const jpParas = (_ge_originalConteudoJp || '').split(/\n\n+/);
  const expected = jpParas.length;

  _ge_aiPasteEl = null;

  if (found.length === 0) {
    panel.innerHTML = `
      <div style="font-size:.72rem; font-weight:700; color:#ff9500; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px;">⚠ Resposta não estruturada</div>
      <div style="font-size:.82rem; color:var(--text-muted); margin-bottom:8px;">Não encontrei marcadores <code>¶N</code>. Peça pro Claude reformatar e cole de novo.</div>
      <div style="padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-radius:6px; font-size:.8rem; max-height:200px; overflow-y:auto; white-space:pre-wrap;">${_escHtml(raw.slice(0, 800))}</div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button onclick="discardGuiaRetraducaoPanel()" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:.78rem; cursor:pointer;">Fechar</button>
      </div>
    `;
    return;
  }

  // Stash globalmente pra applyGuiaRetraducao usar
  window._ge_retraducaoParsed = found;
  window._ge_retraducaoExpected = expected;

  const countMatch = found.length === expected;
  const countWarning = countMatch
    ? `<span style="color:#34c759;">✓ ${found.length} parágrafos (esperados ${expected})</span>`
    : `<span style="color:#ff3b30;">⚠ recebido ${found.length}, esperado ${expected} — aplicar mesmo assim pode bagunçar a bijeção JP/PT</span>`;

  const ptAtual = _ge_originalConteudo.split(/\n\n+/);

  let rowsHtml = '';
  const maxRows = Math.max(expected, found.length);
  for (let i = 0; i < maxRows; i++) {
    const oldPt = ptAtual[i] || '<em style="color:var(--text-muted);">(sem ¶ correspondente)</em>';
    const newPt = found.find(f => f.num === i + 1)?.content || '<em style="color:#ff3b30;">(¶ não fornecido pela IA)</em>';
    const changed = oldPt !== newPt && !newPt.startsWith('<em');
    rowsHtml += `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:8px; border-top:1px solid var(--border); ${changed ? 'background:rgba(99,102,241,0.03);' : ''}">
        <div>
          <div style="font-size:.62rem; color:var(--text-muted); font-weight:700; margin-bottom:3px;">¶${i+1} ATUAL</div>
          <div style="font-size:.8rem; line-height:1.5; max-height:120px; overflow-y:auto; white-space:pre-wrap;">${typeof oldPt === 'string' && !oldPt.startsWith('<em') ? _escHtml(oldPt) : oldPt}</div>
        </div>
        <div>
          <div style="font-size:.62rem; color:#6366f1; font-weight:700; margin-bottom:3px;">¶${i+1} NOVA</div>
          <div style="font-size:.8rem; line-height:1.5; max-height:120px; overflow-y:auto; white-space:pre-wrap;">${typeof newPt === 'string' && !newPt.startsWith('<em') ? _escHtml(newPt) : newPt}</div>
        </div>
      </div>
    `;
  }

  panel.innerHTML = `
    <div style="font-size:.72rem; font-weight:700; color:#6366f1; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px;">🔄 Preview da retradução</div>
    <div style="font-size:.85rem; margin-bottom:10px;">${countWarning}</div>
    <div style="max-height:400px; overflow-y:auto; border:1px solid var(--border); border-radius:6px; background:var(--bg);">
      ${rowsHtml}
    </div>
    <div style="display:flex; gap:8px; margin-top:12px; align-items:center; flex-wrap:wrap;">
      <button onclick="applyGuiaRetraducao()" ${countMatch ? '' : 'data-mismatch="1"'} style="padding:6px 14px; background:#34c759; color:#fff; border:none; border-radius:6px; font-size:.78rem; font-weight:600; cursor:pointer;">✓ Substituir tudo</button>
      <button onclick="discardGuiaRetraducaoPanel()" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:.78rem; cursor:pointer;">✗ Descartar</button>
      <span style="font-size:.72rem; color:var(--text-muted);">Aplicar não salva — você ainda precisa clicar 💾 Salvar</span>
    </div>
  `;
}

function applyGuiaRetraducao() {
  const found = window._ge_retraducaoParsed || [];
  const expected = window._ge_retraducaoExpected || 0;
  if (!found.length) return;

  if (found.length !== expected) {
    if (!confirm(`A IA devolveu ${found.length} parágrafos mas o JP tem ${expected}. Aplicar mesmo assim?\n\nIsso vai quebrar a bijeção JP/PT — o modo parágrafo pode parar de funcionar.`)) return;
  } else {
    if (!confirm(`Substituir os ${expected} parágrafos PT pela retradução? Os textos atuais serão sobrescritos no editor (não salva no Storage até você clicar 💾 Salvar).`)) return;
  }

  // Aplica conforme modo de render
  if (_ge_mode === 'paragraph') {
    const tas = document.querySelectorAll('#guia-editor-paragraphs textarea.ge-para-pt');
    // Map por idx pra cobrir caso de ¶ faltando
    const byIdx = new Map(found.map(f => [f.num - 1, f.content]));
    tas.forEach(t => {
      const idx = parseInt(t.dataset.idx, 10);
      if (byIdx.has(idx)) {
        t.value = byIdx.get(idx);
        t.style.transition = 'background-color 0.5s';
        t.style.backgroundColor = 'rgba(52,199,89,0.12)';
        setTimeout(() => { t.style.backgroundColor = ''; }, 900);
      }
    });
  } else {
    // Modo grid: rebuild conteudo single textarea
    const ordered = [];
    found.sort((a, b) => a.num - b.num);
    for (const f of found) ordered.push(f.content);
    const ta = document.getElementById('guia-editor-area');
    if (ta) {
      ta.value = ordered.join('\n\n');
      ta.style.transition = 'background-color 0.5s';
      ta.style.backgroundColor = 'rgba(52,199,89,0.12)';
      setTimeout(() => { ta.style.backgroundColor = ''; }, 900);
    }
  }

  discardGuiaRetraducaoPanel();
}

function discardGuiaRetraducaoPanel() {
  const panel = document.getElementById('guia-editor-retraducao-panel');
  if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
  delete window._ge_retraducaoParsed;
  delete window._ge_retraducaoExpected;
  if (_ge_aiPasteEl && _ge_aiPasteEl.id === 'guia-retraducao-paste') _ge_aiPasteEl = null;
}

Object.assign(window, {
  loadGuiaReports,
  toggleGuiaVerifiedSection,
  archiveGuiaReport,
  dismissGuiaReport,
  openGuiaEditor,
  closeGuiaEditor,
  saveGuiaEditor,
  suggestGuiaAI,
  parseGuiaAISuggestion,
  applyGuiaAISuggestion,
  discardGuiaAIPanel,
  retraduzirTudoGuiaAI,
  parseGuiaRetraducao,
  applyGuiaRetraducao,
  discardGuiaRetraducaoPanel,
});
