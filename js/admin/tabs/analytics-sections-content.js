// ============================================================
// Análise Geral — seções "Conteúdo" (extraído de analytics.js)
// Qualidade de artigo, popularidade por volume, top ensinamentos,
// conclusão, Ensinamentos marcados como lido (+ modal de trecho
// copiado), proteção de conteúdo, engajamento por volume e favoritos.
// Mesma aba "Análise · Geral"; só organização de código.
// ============================================================
import { supabase } from '../../supabase-config.js';
import { fetchAll } from '../fetch-all.js';
import { _escHtml, getFileTitle } from '../shared/helpers.js';
import { VOLUMES, VOL_SHORT } from '../shared/constants.js';
import { _adminIds, volumeCategories } from '../shared/state.js';

// ── Article Quality ───────────────────────────────────────────────────
// Top 15 ensinamentos por score de qualidade. Score combina tempo médio
// de leitura, progresso médio e engajamento (highlights + favoritos).
async function loadArticleQuality(days, since, shared) {
  const container = document.getElementById('article-quality');

  const logs = shared.logs;
  const positions = shared.positions;
  const highlights = shared.highlights;
  const favs = shared.favorites;

  if (logs.length === 0) {
    container.innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const arts = {};
  const keyFor = r => `${r.volume}/${r.file}`;
  const touch = r => (arts[keyFor(r)] = arts[keyFor(r)] || {
    volume: r.volume, file: r.file,
    views: 0, readers: new Set(),
    timeSum: 0, timeCount: 0,
    progSum: 0, progCount: 0, completed: 0,
    highlights: 0, favs: 0,
  });

  logs.forEach(l => { const a = touch(l); a.views++; a.readers.add(l.user_id); });
  positions.forEach(p => {
    const a = touch(p);
    if ((p.time_spent_seconds || 0) > 0) { a.timeSum += p.time_spent_seconds; a.timeCount++; }
    if ((p.progress_pct || 0) > 0) {
      a.progSum += p.progress_pct; a.progCount++;
      if (p.progress_pct >= 70) a.completed++;
    }
  });
  highlights.forEach(h => touch(h).highlights++);
  favs.forEach(f => touch(f).favs++);

  // Score period-aware: 50% views_no_periodo + 30% conclusao + 20% engajamento.
  // avgTime sai do score (é acumulador all-time, não respeita o período);
  // continua na tabela como coluna informativa.
  const rows = Object.values(arts).map(a => {
    const avgTime = a.timeCount > 0 ? a.timeSum / a.timeCount : 0;
    const avgProg = a.progCount > 0 ? a.progSum / a.progCount : 0;
    const complRate = a.progCount > 0 ? a.completed / a.progCount : 0;
    const engage = a.highlights + a.favs;
    return { ...a, readers: a.readers.size, avgTime, avgProg, complRate, engage };
  }).filter(a => a.views >= 2); // filtra artigos com 1 view só (ruído)

  if (rows.length === 0) {
    container.innerHTML = '<div class="loading">Sem artigos com dados suficientes.</div>';
    return;
  }

  const maxViews = Math.max(...rows.map(r => r.views), 1);
  const maxEngage = Math.max(...rows.map(r => r.engage), 1);
  rows.forEach(r => {
    r.score = Math.round((0.5 * (r.views / maxViews) + 0.3 * r.complRate + 0.2 * (r.engage / maxEngage)) * 100);
  });
  rows.sort((a, b) => b.score - a.score);
  const top = rows.slice(0, 15);

  // Garante que o mapa volume→file→title esteja carregado para getFileTitle
  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
  }

  const fmtTime = s => s < 60 ? `${Math.round(s)}s` : `${Math.floor(s/60)}m${String(Math.round(s%60)).padStart(2,'0')}s`;

  container.innerHTML = `
    <p style="font-size:0.8rem; color:var(--text-muted); margin:-8px 0 14px;">
      Score = 50% views no período + 30% conclusão (≥70% dos tópicos) + 20% engajamento (highlights + favs). Só artigos com ≥2 views. Tempo médio é acumulado all-time (não respeita o período).
    </p>
    <div style="overflow-x:auto;">
      <table class="data-table">
        <thead>
          <tr>
            <th style="text-align:left;">#</th>
            <th style="text-align:left;">Ensinamento</th>
            <th style="text-align:left;">Volume</th>
            <th>Views</th>
            <th>Leitores</th>
            <th>Tempo méd.</th>
            <th>Progresso méd.</th>
            <th>Concluíram</th>
            <th>⭐ / 🖍️</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          ${top.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td style="text-align:left; font-size:0.82rem;" title="${_escHtml(r.volume)}/${_escHtml(r.file)}">${_escHtml(getFileTitle(r.volume, r.file))}</td>
              <td style="text-align:left;">${VOL_SHORT[r.volume] || r.volume}</td>
              <td>${r.views}</td>
              <td>${r.readers}</td>
              <td>${r.timeCount > 0 ? fmtTime(r.avgTime) : '—'}</td>
              <td>${r.progCount > 0 ? Math.round(r.avgProg) + '%' : '—'}</td>
              <td>${r.progCount > 0 ? Math.round(r.complRate * 100) + '%' : '—'}</td>
              <td>${r.favs} / ${r.highlights}</td>
              <td><strong style="color:var(--accent);">${r.score}</strong></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function loadVolumePopularity(days, since, shared) {
  const filtered = shared.logs;
  if (filtered.length === 0) {
    document.getElementById('volume-chart').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const counts = {};
  VOLUMES.forEach(v => counts[v.key] = 0);
  filtered.forEach(d => { if (counts[d.volume] !== undefined) counts[d.volume]++; });
  const max = Math.max(...Object.values(counts), 1);

  document.getElementById('volume-chart').innerHTML = VOLUMES.map(vol => {
    const count = counts[vol.key];
    const pct = Math.round(count / max * 100);
    const shortName = vol.name.split('—')[0].trim();
    return `
      <div class="chart-bar">
        <div class="chart-bar-label">${shortName}</div>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
        <div class="chart-bar-value">${count}</div>
      </div>`;
  }).join('');
}

async function loadTopTeachings(days, since, shared) {
  const data = shared.logs;

  if (!data.length) {
    document.getElementById('top-teachings').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const counts = {};
  data.forEach(v => {
    const key = `${v.volume}/${v.file}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);

  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
  }

  document.getElementById('top-teachings').innerHTML = `
    <table class="data-table">
      <thead><tr><th>#</th><th>Ensinamento</th><th>Volume</th><th>Visualizações</th></tr></thead>
      <tbody>${sorted.map((item, i) => {
        const [vol, file] = item[0].split('/');
        return `<tr><td>${i + 1}</td><td style="font-size:0.82rem;" title="${_escHtml(file)}">${_escHtml(getFileTitle(vol, file))}</td><td>${VOL_SHORT[vol] || vol}</td><td><strong>${item[1]}</strong></td></tr>`;
      }).join('')}</tbody>
    </table>`;
}

async function loadCompletionRates(days, since, shared) {
  const data = shared.positions;

  if (!data.length) {
    document.getElementById('completion-chart').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const volData = {};
  VOLUMES.forEach(v => volData[v.key] = { total: 0, completed: 0 });
  data.forEach(d => {
    if (volData[d.volume]) {
      volData[d.volume].total++;
      if (d.progress_pct >= 90) volData[d.volume].completed++;
    }
  });

  document.getElementById('completion-chart').innerHTML = VOLUMES.map(vol => {
    const d = volData[vol.key];
    const rate = d.total > 0 ? Math.round(d.completed / d.total * 100) : 0;
    const shortName = vol.name.split('—')[0].trim();
    return `
      <div class="chart-bar">
        <div class="chart-bar-label">${shortName}</div>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${rate}%"></div></div>
        <div class="chart-bar-value">${rate}%</div>
      </div>`;
  }).join('');
}

// ============================================================
// Ensinamentos Lidos (botão "Marcar como lido") por usuário
// ============================================================
// Lê read_marks direto — a policy "Admins leem marcas de lido" (is_admin())
// já existe no banco. Admins ficam fora da conta (mesmo critério das demais
// seções). Filtra pelo período via created_at (data em que MARCOU).
async function loadReadMarksStats(days, since, shared) {
  const container = document.getElementById('read-marks-stats');
  if (!container) return;

  const rows = shared.readMarks;
  if (!rows.length) {
    container.innerHTML = `<div class="loading">Nenhum Ensinamento marcado como lido no período.</div>`;
    return;
  }

  // "Tópicos" (rows.length) ≠ "Publicações" (pubs.size, distinto por vol+file):
  // read_marks é por TÓPICO — um volume de referência como Pontos Vitais do
  // Johrei tem dezenas de sub-tópicos curtos por arquivo, então marcar cada um
  // infla a contagem de tópicos rápido (ex.: 113 tópicos marcados num único
  // arquivo). "Publicações" deduplica por vol+file — é o número comparável
  // com o Ranking de Usuários Mais Ativos (que conta arquivos únicos com
  // ≥30s de leitura em reading_positions, outra tabela/heurística).
  const byUser = new Map();
  rows.forEach(r => {
    if (!byUser.has(r.user_id)) {
      byUser.set(r.user_id, { count: 0, vols: new Set(), pubs: new Set(), last: r.created_at, lastVol: r.volume, lastFile: r.file, lastTitle: r.topic_title });
    }
    const u = byUser.get(r.user_id);
    u.count++;
    if (r.volume) u.vols.add(r.volume);
    if (r.volume && r.file) u.pubs.add(`${r.volume}/${r.file}`);
    if (r.created_at > u.last) { u.last = r.created_at; u.lastVol = r.volume; u.lastFile = r.file; u.lastTitle = r.topic_title; }
  });

  let nameMap = {};
  const userIds = [...byUser.keys()];
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, display_name')
      .in('id', userIds);
    (profiles || []).forEach(p => { nameMap[p.id] = p.display_name; });
  }

  const totalPubs = [...byUser.values()].reduce((sum, u) => sum + u.pubs.size, 0);
  const cardsHtml = `
    <div class="stats-grid" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-value">${rows.length}</div><div class="stat-label">Tópicos marcados</div></div>
      <div class="stat-card"><div class="stat-value">${totalPubs}</div><div class="stat-label">Publicações distintas</div></div>
      <div class="stat-card"><div class="stat-value">${byUser.size}</div><div class="stat-label">Usuários que marcaram</div></div>
      <div class="stat-card"><div class="stat-value">${Math.round(rows.length / byUser.size)}</div><div class="stat-label">Média de tópicos por usuário</div></div>
    </div>`;

  const sorted = [...byUser.entries()].sort((a, b) => b[1].count - a[1].count);
  const tableHtml = `
    <table class="data-table">
      <thead><tr><th>Usuário</th><th>Tópicos</th><th title="Publicações distintas (deduplicado por volume+arquivo) — comparável ao Ranking de Usuários Mais Ativos">Publicações</th><th>Volumes</th><th>Última marcação</th><th>Último Ensinamento lido</th></tr></thead>
      <tbody>${sorted.map(([uid, u]) => {
        const date = new Date(u.last);
        const dateStr = date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' ' + date.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
        const title = u.lastTitle || (u.lastFile ? getFileTitle(u.lastVol, u.lastFile) : '—');
        return `<tr>
          <td>${_escHtml(nameMap[uid] || 'Desconhecido')}</td>
          <td style="font-weight:600;">${u.count}</td>
          <td>${u.pubs.size}</td>
          <td>${u.vols.size}</td>
          <td style="font-size:0.8rem; color:var(--text-muted);">${dateStr}</td>
          <td style="font-size:0.82rem;" title="${_escHtml(u.lastFile || '')}">${VOL_SHORT[u.lastVol] || u.lastVol || '—'} · ${_escHtml(title)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;

  container.innerHTML = cardsHtml + tableHtml;
}

// Trechos copiados renderizados por último — o modal de leitura busca por
// índice daqui (data-copy-idx + listener delegado; nada de texto de usuário
// em onclick inline — mesma lição do XSS A2 da auditoria).
let _copyExcerpts = [];

// Modal de leitura do trecho copiado: o preview no card tem ~120px e trechos
// chegam a milhares de chars — impraticável ler no scroll interno.
function _openCopyExcerptModal(idx) {
  const item = _copyExcerpts[idx];
  if (!item) return;

  let overlay = document.getElementById('cpExcerptModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'cpExcerptModal';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:10500; background:rgba(0,0,0,0.55); display:none; align-items:center; justify-content:center; padding:20px;';
    overlay.innerHTML = `
      <div style="background:var(--surface); color:var(--text); width:min(860px, 96vw); max-height:90vh; border-radius:12px; box-shadow:0 18px 60px rgba(0,0,0,0.35); display:flex; flex-direction:column; overflow:hidden;">
        <div style="display:flex; align-items:flex-start; gap:12px; padding:16px 20px; border-bottom:1px solid var(--border);">
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.72rem; text-transform:uppercase; letter-spacing:.12em; color:var(--text-muted); font-weight:600; margin-bottom:4px;">Trecho copiado</div>
            <div id="cpExcerptMeta" style="font-size:0.85rem; color:var(--text-muted); line-height:1.5;"></div>
          </div>
          <button type="button" id="cpExcerptClose" aria-label="Fechar" style="background:none; border:none; cursor:pointer; font-size:1.5rem; line-height:1; color:var(--text-muted); padding:4px 8px;">&times;</button>
        </div>
        <div id="cpExcerptBody" style="flex:1; overflow-y:auto; padding:20px 24px; font-family:Georgia, 'Times New Roman', serif; font-size:1.02rem; line-height:1.7; white-space:pre-wrap; word-break:break-word;"></div>
        <div style="display:flex; align-items:center; gap:10px; padding:12px 20px; border-top:1px solid var(--border);">
          <span id="cpExcerptLen" style="font-size:0.75rem; color:var(--text-muted);"></span>
          <button type="button" id="cpExcerptCopy" style="margin-left:auto; border:1px solid var(--border); background:none; color:var(--accent); border-radius:6px; padding:7px 14px; font-size:0.8rem; cursor:pointer;">📋 Copiar texto</button>
          <button type="button" id="cpExcerptOk" style="border:none; background:var(--accent); color:#fff; border-radius:6px; padding:7px 16px; font-size:0.8rem; font-weight:600; cursor:pointer;">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.style.display = 'none'; };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#cpExcerptClose').addEventListener('click', close);
    overlay.querySelector('#cpExcerptOk').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.style.display !== 'none') close();
    });
    overlay.querySelector('#cpExcerptCopy').addEventListener('click', async () => {
      const btn = overlay.querySelector('#cpExcerptCopy');
      try { await navigator.clipboard.writeText(overlay.querySelector('#cpExcerptBody').textContent || ''); } catch (e) {}
      btn.textContent = '✓ Copiado';
      setTimeout(() => { btn.textContent = '📋 Copiar texto'; }, 1600);
    });
  }

  overlay.querySelector('#cpExcerptMeta').innerHTML =
    `<strong style="color:var(--accent);">${_escHtml(item.name)}</strong>` +
    ` · ${_escHtml(item.volLabel)} · ${_escHtml(item.title)} · ${_escHtml(item.dateStr)}`;
  // textContent (não innerHTML): o trecho é conteúdo do usuário.
  overlay.querySelector('#cpExcerptBody').textContent = item.text;
  overlay.querySelector('#cpExcerptLen').textContent = item.truncated
    ? `⚠ Captura limitada: exibindo ${item.text.length} de ${item.length} caracteres do trecho original`
    : `${item.length} caracteres`;
  overlay.style.display = 'flex';
  overlay.querySelector('#cpExcerptBody').scrollTop = 0;
}

async function loadContentProtection(days, since) {
  const container = document.getElementById('content-protection-stats');
  if (!container) return;

  // (o antigo .limit(2000) não funcionava: o PostgREST corta em 1000 de
  // qualquer jeito — fetchAll pagina; print/copy são eventos raros)
  const buildQ = () => {
    let q = supabase
      .from('access_logs')
      .select('user_id, volume, file, action, created_at, metadata')
      .in('action', ['print', 'copy'])
      .order('created_at', { ascending: false });
    if (since) q = q.gte('created_at', since);
    return q;
  };
  const { data: raw, error } = await fetchAll(buildQ, null);
  if (error) {
    container.innerHTML = `<div class="msg err" style="display:block;">Falha ao carregar: ${_escHtml(error.message)}</div>`;
    return;
  }

  const rows = (raw || []).filter(r => !_adminIds.has(r.user_id));
  const prints = rows.filter(r => r.action === 'print');
  const copies = rows.filter(r => r.action === 'copy');

  const byUser = new Map();
  rows.forEach(r => {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { prints: 0, copies: 0, last: r.created_at, lastVol: r.volume, lastFile: r.file });
    const u = byUser.get(r.user_id);
    if (r.action === 'print') u.prints++; else u.copies++;
    if (r.created_at > u.last) { u.last = r.created_at; u.lastVol = r.volume; u.lastFile = r.file; }
  });

  let nameMap = {};
  const userIds = [...byUser.keys()];
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, display_name')
      .in('id', userIds);
    (profiles || []).forEach(p => { nameMap[p.id] = p.display_name; });
  }

  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) {}
  }

  const cardsHtml = `
    <div class="stats-grid" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-value">${copies.length}</div><div class="stat-label">Cópias</div></div>
      <div class="stat-card"><div class="stat-value">${prints.length}</div><div class="stat-label">Impressões</div></div>
      <div class="stat-card"><div class="stat-value">${byUser.size}</div><div class="stat-label">Usuários Envolvidos</div></div>
    </div>`;

  let tableHtml = '';
  if (byUser.size === 0) {
    tableHtml = `<div class="loading">Nenhuma atividade de cópia ou impressão no período.</div>`;
  } else {
    const sortedUsers = [...byUser.entries()]
      .sort((a, b) => (b[1].copies + b[1].prints) - (a[1].copies + a[1].prints));
    tableHtml = `
      <table class="data-table">
        <thead><tr><th>Usuário</th><th>Cópias</th><th>Impressões</th><th>Última Ação</th><th>Último Ensinamento</th></tr></thead>
        <tbody>${sortedUsers.map(([uid, u]) => {
          const date = new Date(u.last);
          const dateStr = date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' ' + date.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
          const title = u.lastFile ? getFileTitle(u.lastVol, u.lastFile) : '—';
          return `<tr>
            <td>${_escHtml(nameMap[uid] || 'Desconhecido')}</td>
            <td style="font-weight:${u.copies ? '600' : '400'};">${u.copies}</td>
            <td style="font-weight:${u.prints ? '600' : '400'};">${u.prints}</td>
            <td style="font-size:0.8rem; color:var(--text-muted);">${dateStr}</td>
            <td style="font-size:0.82rem;" title="${_escHtml(u.lastFile || '')}">${VOL_SHORT[u.lastVol] || u.lastVol || '—'} · ${_escHtml(title)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  // Lista de trechos copiados (com texto, quando disponível). Cada card abre
  // o modal de leitura (_openCopyExcerptModal) — o preview de 120px é só um
  // aperitivo; trechos reais passam de milhares de chars.
  const copyRows = copies.filter(r => r.metadata && r.metadata.text);
  let copiesListHtml = '';
  if (copyRows.length > 0) {
    const recentCopies = copyRows.slice(0, 50);
    _copyExcerpts = recentCopies.map(r => {
      const date = new Date(r.created_at);
      const dateStr = date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' ' + date.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
      const text = r.metadata.text || '';
      const length = r.metadata.length || text.length;
      return {
        name: nameMap[r.user_id] || 'Desconhecido',
        volLabel: VOL_SHORT[r.volume] || r.volume || '—',
        title: r.file ? getFileTitle(r.volume, r.file) : '—',
        dateStr, text, length,
        truncated: length > text.length,
      };
    });
    copiesListHtml = `
      <details style="margin-top:24px;">
        <summary style="font-size:0.78rem; text-transform:uppercase; letter-spacing:.14em; color:var(--text-muted); margin:0 0 12px; font-weight:600; cursor:pointer; user-select:none;">📋 Trechos copiados (últimos ${recentCopies.length} de ${copyRows.length})</summary>
        <div style="display:flex; flex-direction:column; gap:10px; max-height:520px; overflow-y:auto; padding-right:6px;">
          ${_copyExcerpts.map((it, i) => {
            const lengthBadge = it.truncated ? `<span style="color:#c44;">${it.length} chars (truncado)</span>` : `${it.length} chars`;
            return `
              <div data-copy-idx="${i}" title="Clique para ler o trecho completo" style="border:1px solid var(--border); border-radius:10px; padding:12px 14px; background:var(--surface); cursor:pointer;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
                  <span style="font-size:0.78rem; font-weight:600; color:var(--accent);">${_escHtml(it.name)}</span>
                  <span style="font-size:0.7rem; color:var(--text-muted);">·</span>
                  <span style="font-size:0.72rem; color:var(--text-muted);">${_escHtml(it.volLabel)} · ${_escHtml(it.title)}</span>
                  <span style="font-size:0.7rem; color:var(--text-muted);">·</span>
                  <span style="font-size:0.72rem; color:var(--text-muted);">${it.dateStr}</span>
                  <span style="margin-left:auto; font-size:0.68rem; color:var(--text-muted); background:var(--bg); padding:2px 8px; border-radius:4px;">${lengthBadge}</span>
                  <span style="font-size:0.68rem; color:var(--accent); border:1px solid var(--accent); padding:2px 8px; border-radius:4px;">⤢ ampliar</span>
                </div>
                <div style="font-size:0.85rem; line-height:1.55; padding:8px 10px; background:var(--bg); border-radius:6px; white-space:pre-wrap; word-break:break-word; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden;">${_escHtml(it.text)}</div>
              </div>
            `;
          }).join('')}
        </div>
      </details>`;
  } else if (copies.length > 0) {
    copiesListHtml = `
      <div style="margin-top:24px; padding:14px; background:var(--surface); border:1px solid var(--border); border-radius:10px; font-size:0.82rem; color:var(--text-muted);">
        ⓘ ${copies.length} cópia(s) registrada(s) sem o conteúdo capturado. Cópias futuras já incluirão o texto.
      </div>`;
  }

  container.innerHTML = cardsHtml + tableHtml + copiesListHtml;
  // Delegado + atribuição direta (não addEventListener): loadContentProtection
  // re-roda a cada troca de período e listeners empilhados abririam N modais.
  container.onclick = (e) => {
    const card = e.target.closest('[data-copy-idx]');
    if (!card) return;
    // Selecionar texto no preview não deve abrir o modal.
    const sel = window.getSelection();
    if (sel && sel.toString()) return;
    _openCopyExcerptModal(parseInt(card.dataset.copyIdx, 10));
  };
}

// ============================================================
// Engagement by Volume
// ============================================================

async function loadEngagementByVolume(days, since, shared) {
  const logs = shared.logs;
  const positions = shared.positions;

  if (logs.length === 0) {
    document.getElementById('engagement-by-volume').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const volStats = {};
  VOLUMES.forEach(v => {
    volStats[v.key] = { views: 0, uniqueUsers: new Set(), totalProgress: 0, progressCount: 0, completed: 0 };
  });

  logs.forEach(l => {
    if (volStats[l.volume]) {
      volStats[l.volume].views++;
      volStats[l.volume].uniqueUsers.add(l.user_id);
    }
  });

  positions.forEach(p => {
    if (volStats[p.volume]) {
      volStats[p.volume].totalProgress += p.progress_pct;
      volStats[p.volume].progressCount++;
      if (p.progress_pct >= 90) volStats[p.volume].completed++;
    }
  });

  document.getElementById('engagement-by-volume').innerHTML = `
    <div class="engagement-grid">
      ${VOLUMES.map(vol => {
        const s = volStats[vol.key];
        const avgProgress = s.progressCount > 0 ? Math.round(s.totalProgress / s.progressCount * 10) / 10 : 0;
        const completionRate = s.progressCount > 0 ? Math.round(s.completed / s.progressCount * 100) : 0;
        return `
          <div class="engagement-card">
            <div class="vol-name">${vol.name.split('—')[0].trim()}</div>
            <div class="engagement-stat">
              <span class="label">Visualizações</span>
              <span class="value">${s.views}</span>
            </div>
            <div class="engagement-stat">
              <span class="label">Usuários únicos</span>
              <span class="value">${s.uniqueUsers.size}</span>
            </div>
            <div class="engagement-stat">
              <span class="label">Progresso médio</span>
              <span class="value">${avgProgress}%</span>
            </div>
            <div class="engagement-stat">
              <span class="label">Taxa conclusão (≥90%)</span>
              <span class="value">${completionRate}%</span>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

// ============================================================
// Popular Favorites & Highlights
// ============================================================

async function loadPopularFavorites(days, since, shared) {
  // Favoritos: ranking all-time (sem filtro de período). Toggle on/off não
  // gera novo created_at, então filtrar por período subestima popularidade —
  // por isso este é o único fetch próprio (o shared.favorites é do período).
  // Highlights: do período (shared.highlights), refletindo atividade recente.
  const { data: favRaw } = await fetchAll(() => supabase.from('synced_favorites').select('volume, file, topic_title, user_id'));
  const favs = (favRaw || []).filter(d => !_adminIds.has(d.user_id));
  const highlights = shared.highlights;

  if (favs.length === 0 && highlights.length === 0) {
    document.getElementById('popular-favorites').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
  }

  const favCounts = {};
  favs.forEach(f => {
    const key = `${f.volume}/${f.file}`;
    if (!favCounts[key]) favCounts[key] = { volume: f.volume, file: f.file, title: getFileTitle(f.volume, f.file), favs: 0, highlights: 0 };
    favCounts[key].favs++;
  });

  highlights.forEach(h => {
    const key = `${h.volume}/${h.file}`;
    if (favCounts[key]) {
      favCounts[key].highlights++;
    } else {
      favCounts[key] = { volume: h.volume, file: h.file, title: getFileTitle(h.volume, h.file), favs: 0, highlights: 1 };
    }
  });

  const sorted = Object.values(favCounts).sort((a, b) => (b.favs + b.highlights) - (a.favs + a.highlights)).slice(0, 15);
  const maxTotal = sorted.length > 0 ? sorted[0].favs + sorted[0].highlights : 1;

  document.getElementById('popular-favorites').innerHTML = `
    <table class="data-table">
      <thead><tr><th>#</th><th>Ensinamento</th><th>Volume</th><th>⭐ Salvos</th><th>🖍 Destaques</th><th>Total</th></tr></thead>
      <tbody>${sorted.map((item, i) => {
        const total = item.favs + item.highlights;
        const pct = Math.round(total / maxTotal * 100);
        const countClass = total >= maxTotal * 0.5 ? 'high' : 'med';
        return `<tr>
          <td>${i + 1}</td>
          <td style="font-size:0.82rem;" title="${_escHtml(item.file)}">${_escHtml(item.title)}</td>
          <td>${VOL_SHORT[item.volume] || item.volume}</td>
          <td><span class="fav-count ${countClass}">${item.favs}</span></td>
          <td><span class="fav-count ${countClass}">${item.highlights}</span></td>
          <td><strong>${total}</strong></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}


export {
  loadArticleQuality,
  loadVolumePopularity,
  loadTopTeachings,
  loadCompletionRates,
  loadReadMarksStats,
  loadContentProtection,
  loadEngagementByVolume,
  loadPopularFavorites
};
