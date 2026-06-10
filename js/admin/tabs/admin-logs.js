// ============================================================
// Admin Logs Tab — auditoria de ações administrativas
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escHtml } from '../shared/helpers.js';

async function loadAdminLogs() {
  const container = document.getElementById('admin-logs-container');
  if (!container) return;
  container.innerHTML = '<div class="loading">Carregando logs...</div>';

  const days = parseInt(document.getElementById('log-filter-days')?.value || '30');
  let query = supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(500);
  if (days > 0) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    query = query.gte('created_at', since);
  }

  const { data: logs, error } = await query;
  if (error) {
    container.innerHTML = `<div class="msg err" style="display:block;">Erro ao carregar logs: ${_escHtml(error.message)}</div>`;
    return;
  }
  if (!logs || logs.length === 0) {
    container.innerHTML = '<div class="report-empty">Nenhum log encontrado neste período.</div>';
    return;
  }

  const adminSelect = document.getElementById('log-filter-admin');
  const currentFilter = adminSelect?.value || '';
  const admins = [...new Set(logs.map(l => l.admin_email))];
  if (adminSelect) {
    adminSelect.innerHTML = '<option value="">Todos os admins</option>' +
      admins.map(a => `<option value="${_escHtml(a)}"${a === currentFilter ? ' selected' : ''}>${_escHtml(a)}</option>`).join('');
  }

  window._adminLogsAll = logs;
  filterAdminLogs();
}

function filterAdminLogs() {
  const filter = document.getElementById('log-filter-admin')?.value || '';
  const logs = (window._adminLogsAll || []).filter(l => !filter || l.admin_email === filter);
  renderAdminLogs(logs);
}

function renderAdminLogs(logs) {
  const container = document.getElementById('admin-logs-container');
  if (!logs || logs.length === 0) {
    container.innerHTML = '<div class="report-empty">Nenhum log para este filtro.</div>';
    return;
  }
  const ACTION_LABELS = {
    'add_user':                  { label: 'Criou usuário',              color: '#34c759' },
    'delete_user':               { label: 'Excluiu usuário',            color: '#ff3b30' },
    'change_role':               { label: 'Alterou role',               color: '#ffc107' },
    'save_permissions':          { label: 'Salvou restrições',          color: '#b8860b' },
    'apply_default_permissions': { label: 'Aplicou restrições a todos', color: '#e05252' },
    'search_replace':            { label: 'Buscar & Substituir',        color: '#8e7cc3' },
    'rebuild_search_index':      { label: 'Regenerou Índice de Busca',  color: '#5ba4cf' },
    'delete_highlight':          { label: 'Apagou destaque',            color: '#ff3b30' },
  };
  container.innerHTML = `<table class="data-table">
    <thead><tr><th>Data/Hora</th><th>Admin</th><th>Ação</th><th>Detalhes</th></tr></thead>
    <tbody>${logs.map(log => {
      const info = ACTION_LABELS[log.action] || { label: log.action, color: 'var(--text-muted)' };
      const dt = new Date(log.created_at);
      const dtStr = dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
      const details = log.details || {};
      const detailStr = Object.entries(details)
        .map(([k, v]) => `<span style="color:var(--text-muted);font-size:0.75rem;">${_escHtml(k)}:</span> <strong>${_escHtml(String(v))}</strong>`)
        .join(' &nbsp;·&nbsp; ');
      return `<tr>
        <td style="white-space:nowrap;color:var(--text-muted);font-size:0.8rem;">${dtStr}</td>
        <td style="font-size:0.82rem;">${_escHtml(log.admin_email)}</td>
        <td><span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:0.75rem;font-weight:700;background:${info.color}22;color:${info.color};">${_escHtml(info.label)}</span></td>
        <td style="font-size:0.82rem;">${detailStr || '<span style="color:var(--text-muted);">—</span>'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

Object.assign(window, {
  loadAdminLogs,
  filterAdminLogs
});
