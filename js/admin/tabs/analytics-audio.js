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
  return `
    <div style="display:flex;align-items:center;gap:10px;font-size:.82rem;">
      <span style="flex:0 0 210px;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escHtml(name)}</span>
      <div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${bar};"></div></div>
      <span style="flex:0 0 92px;text-align:right;font-variant-numeric:tabular-nums;">${status}</span>
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

async function loadAudioAnalytics() {
  const host = document.getElementById('audio-analytics');
  if (!host) return;
  host.innerHTML = '<div class="loading" style="padding:24px;color:var(--text-muted);">Carregando…</div>';

  const { data, error } = await supabase.rpc('admin_get_audio_listens');
  if (error) {
    host.innerHTML = `<div class="msg err" style="margin:0;">Erro ao carregar: ${_escHtml(error.message)}</div>`;
    return;
  }
  const rows = data || [];
  if (rows.length === 0) {
    host.innerHTML = '<div style="padding:28px;color:var(--text-muted);font-size:.9rem;">Nenhum áudio foi recomendado ainda — quando houver, aqui aparece quem ouviu e quanto.</div>';
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
        <td style="min-width:180px;">
          <div style="display:flex;align-items:center;gap:9px;">
            <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--accent);"></div></div>
            <span style="font-variant-numeric:tabular-nums;font-size:.8rem;color:var(--text-muted);min-width:34px;text-align:right;">${pct}%</span>
          </div>
        </td>
        <td style="text-align:center;font-variant-numeric:tabular-nums;">${completed}</td>
      </tr>
      <tr class="audio-detail" data-path="${_escHtml(path)}"><td colspan="4" style="background:var(--bg-color);padding:0;"></td></tr>`;
  }).join('');

  host.innerHTML = `
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
}

Object.assign(window, { loadAudioAnalytics });
