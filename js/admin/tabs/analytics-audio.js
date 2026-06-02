// ============================================================
// Analytics de Áudio — quem ouviu os áudios recomendados e quanto.
// (aba "Análise · 🎧 Áudio" do admin)
// Agregado: admin_get_audio_listens. Drill-down por áudio (quem recebeu +
// quanto cada um ouviu): admin_get_audio_listeners (lazy, ao expandir a linha).
// max_percent = ponto máximo alcançado (high-water mark), não "ouviu X%".
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escHtml } from '../shared/helpers.js';

function _audioListenerRow(u) {
  const name = u.display_name || (u.user_id ? u.user_id.slice(0, 8) + '…' : '—');
  const pct = u.max_percent || 0;
  const done = !!u.completed;
  const bar = done ? '#2c8a3e' : 'var(--accent)';
  const status = pct === 0
    ? '<span style="color:var(--text-muted);">— não ouviu</span>'
    : done
      ? '<span style="color:#2c8a3e;">✓ completo</span>'
      : `<span style="color:var(--text-muted);">${pct}%</span>`;
  const archived = u.archived_at
    ? `<span title="Arquivou em ${new Date(u.archived_at).toLocaleDateString('pt-BR')}" style="color:#b06a00;">🗄 arquivou</span>`
    : '';
  return `
    <div class="al-row">
      <span class="al-name">${_escHtml(name)}</span>
      <div class="al-bar"><div style="width:${pct}%;height:100%;background:${bar};"></div></div>
      <span class="al-arch">${archived}</span>
      <span class="al-status">${status}</span>
    </div>`;
}

async function _loadAudioListeners(cell, path) {
  cell.innerHTML = '<div style="padding:10px 14px;color:var(--text-muted);font-size:.8rem;">Carregando…</div>';
  const { data, error } = await supabase.rpc('admin_get_audio_listeners', { p_audio_path: path });
  if (error) {
    cell.innerHTML = `<div class="msg err" style="margin:8px 14px;">Erro: ${_escHtml(error.message)}</div>`;
    return;
  }
  const rows = data || [];
  if (!rows.length) {
    cell.innerHTML = '<div style="padding:10px 14px;color:var(--text-muted);font-size:.8rem;">Ninguém recebeu este áudio.</div>';
    return;
  }
  cell.innerHTML = '<div style="padding:8px 16px 14px;display:flex;flex-direction:column;gap:7px;">'
    + rows.map(_audioListenerRow).join('') + '</div>';
}

let _audioRefreshTimer = null;
let _lastAudioSnapshot = null;

// Re-agenda o auto-refresh (30s). Auto-encerra sozinho quando a aba 🎧 sai de
// foco (não precisa hook no switchTab) — não vaza timer em background.
function _scheduleAudioRefresh() {
  if (_audioRefreshTimer) clearTimeout(_audioRefreshTimer);
  _audioRefreshTimer = setTimeout(() => {
    _audioRefreshTimer = null;
    const pane = document.getElementById('tab-audio');
    if (!pane || !pane.classList.contains('active')) return; // saiu da aba → para
    loadAudioAnalytics({ silent: true });
  }, 30000);
}

async function loadAudioAnalytics(opts) {
  const silent = !!(opts && opts.silent);
  const host = document.getElementById('audio-analytics');
  if (!host) return;
  if (!silent) host.innerHTML = '<div class="loading" style="padding:24px;color:var(--text-muted);">Carregando…</div>';

  const { data, error } = await supabase.rpc('admin_get_audio_listens');
  if (error) {
    if (!silent) host.innerHTML = `<div class="msg err" style="margin:0;">Erro ao carregar: ${_escHtml(error.message)}</div>`;
    _scheduleAudioRefresh();
    return;
  }
  const rows = data || [];
  // Auto-refresh suave: no tick silencioso, só re-renderiza se os números
  // mudaram (evita piscar a tela e perder o estado de expandir/recolher).
  const snapshot = JSON.stringify(rows);
  if (silent && snapshot === _lastAudioSnapshot) { _scheduleAudioRefresh(); return; }
  _lastAudioSnapshot = snapshot;
  if (rows.length === 0) {
    host.innerHTML = '<div style="padding:28px;color:var(--text-muted);font-size:.9rem;">Nenhum áudio foi recomendado ainda — quando houver, aqui aparece quem ouviu e quanto.</div>';
    _scheduleAudioRefresh();
    return;
  }

  const nAudios = rows.length;
  const nComAlgumOuvinte = rows.filter(r => (r.listeners || 0) > 0).length;
  const nComAlgumCompleto = rows.filter(r => (r.completed || 0) > 0).length;
  const stat = (val, lbl) =>
    `<div class="stat-card"><div class="stat-value">${val}</div><div class="stat-label">${lbl}</div></div>`;

  const tableRows = rows.map(r => {
    const path = r.audio_path || '';
    const title = r.audio_title || (path ? path.split('/').pop() : '(sem título)');
    const recd = r.recommended_to || 0;
    const listeners = r.listeners || 0;
    const pct = Math.round(Number(r.avg_percent) || 0);
    const completed = r.completed || 0;
    return `
      <tr class="audio-row" data-path="${_escHtml(path)}" style="cursor:pointer;">
        <td style="font-weight:500;"><span class="audio-caret" style="display:inline-block;width:14px;color:var(--text-muted);transition:transform .15s;transform:rotate(90deg);">▸</span> 🎵 ${_escHtml(title)}</td>
        <td style="text-align:center;font-variant-numeric:tabular-nums;">${listeners} <span style="color:var(--text-muted);">/ ${recd}</span></td>
        <td class="audio-prog-cell">
          <div class="audio-prog">
            <div class="audio-prog-bar"><div style="width:${pct}%;height:100%;background:var(--accent);"></div></div>
            <span class="audio-prog-pct">${pct}%</span>
          </div>
        </td>
        <td style="text-align:center;font-variant-numeric:tabular-nums;">${completed}</td>
      </tr>
      <tr class="audio-detail" data-path="${_escHtml(path)}"><td colspan="4" style="background:var(--bg-color);padding:0;"></td></tr>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-bottom:12px;">
      <span style="font-size:.7rem;color:var(--text-muted);">atualiza sozinho a cada 30s</span>
      <button id="audio-refresh-btn" type="button" style="padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-main);font-family:inherit;font-size:.78rem;cursor:pointer;">↻ Atualizar</button>
    </div>
    <div class="stats-grid">
      ${stat(nAudios, 'Áudios recomendados')}
      ${stat(nComAlgumOuvinte, 'Com algum ouvinte')}
      ${stat(nComAlgumCompleto, 'Com alguém que completou')}
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Áudio</th>
          <th style="text-align:center;">Ouviram</th>
          <th>Ponto máx. médio</th>
          <th style="text-align:center;">Completaram</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p style="margin:14px 2px 0;font-size:.72rem;color:var(--text-muted);line-height:1.5;">
      Clique num áudio pra ver quem recebeu e quanto cada um ouviu. "Ponto máx." = ponto mais
      distante alcançado (arrastar até o fim conta como 100%) — leia como "chegou a", não
      "ouviu na íntegra".
    </p>`;

  // Abre todos os detalhes por padrão (poucos áudios por enquanto) e carrega
  // a lista de usuários de cada um. O clique ainda recolhe/reabre.
  host.querySelectorAll('.audio-detail').forEach((detail) => {
    const cell = detail.querySelector('td');
    if (cell && !cell.dataset.loaded) {
      cell.dataset.loaded = '1';
      _loadAudioListeners(cell, detail.dataset.path);
    }
  });

  // Clicar numa linha de áudio expande/colapsa o detalhe por usuário (lazy-load).
  const tbody = host.querySelector('tbody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const row = e.target.closest('.audio-row');
      if (!row) return;
      const detail = row.nextElementSibling;
      if (!detail || !detail.classList.contains('audio-detail')) return;
      const caret = row.querySelector('.audio-caret');
      const opening = detail.hidden;
      detail.hidden = !opening;
      if (caret) caret.style.transform = opening ? 'rotate(90deg)' : '';
      if (opening) {
        const cell = detail.querySelector('td');
        if (cell && !cell.dataset.loaded) {
          cell.dataset.loaded = '1';
          _loadAudioListeners(cell, row.dataset.path);
        }
      }
    });
  }

  // Botão "↻ Atualizar" + auto-refresh: vê números novos sem trocar de aba.
  const refreshBtn = document.getElementById('audio-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadAudioAnalytics());
  _scheduleAudioRefresh();
}

Object.assign(window, { loadAudioAnalytics });
