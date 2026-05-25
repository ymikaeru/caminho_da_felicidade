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
  ta.style.display = 'none';
  ta.value = '';
  const saveBtn = document.getElementById('guia-editor-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '💾 Salvar e marcar Corrigido';

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

  ta.value = conteudo;
  ta.style.display = 'block';
  document.getElementById('guia-editor-status').style.display = 'none';
  saveBtn.disabled = false;

  // Auto-localiza o trecho reportado. Faz busca tolerante a mudanças
  // de espaço/pontuação porque o reporte pode ter sido feito antes de
  // alguma edição prévia (em-dash trocado por ;, etc).
  const needle = (r.selected_text || '').trim();
  if (needle) {
    const match = _ge_findNeedle(conteudo, needle);
    if (match) {
      ta.focus();
      ta.setSelectionRange(match.start, match.end);
      const before = conteudo.slice(0, match.start);
      const linesBefore = (before.match(/\n/g) || []).length;
      const lineHeight = parseInt(getComputedStyle(ta).lineHeight, 10) || 22;
      ta.scrollTop = Math.max(0, linesBefore * lineHeight - 80);
      if (match.fuzzy) {
        _ge_setStatus(`⚠ Trecho exato não encontrado — selecionei a melhor aproximação (texto pode ter sido editado desde o reporte). Use Ctrl+F se precisar.`, true);
      }
    } else {
      ta.focus();
      _ge_setStatus(`⚠ Trecho reportado não foi localizado no artigo. Use Ctrl+F pra buscar manualmente.`, true);
    }
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
  const ta = document.getElementById('guia-editor-area');
  if (!force && ta && _ge_originalConteudo !== null && ta.value !== _ge_originalConteudo) {
    if (!confirm('Há alterações não salvas. Descartar?')) return;
  }
  const modal = document.getElementById('guia-editor-modal');
  if (modal) modal.classList.remove('open');
  _ge_currentReport = null;
  _ge_currentFile = null;
  _ge_currentJson = null;
  _ge_currentPath = null;
  _ge_originalConteudo = null;
}

async function saveGuiaEditor() {
  if (!_ge_currentReport || !_ge_currentJson || !_ge_currentPath) return;
  const ta = document.getElementById('guia-editor-area');
  const saveBtn = document.getElementById('guia-editor-save');
  const newConteudo = ta.value;

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

Object.assign(window, {
  loadGuiaReports,
  toggleGuiaVerifiedSection,
  archiveGuiaReport,
  dismissGuiaReport,
  openGuiaEditor,
  closeGuiaEditor,
  saveGuiaEditor,
});
