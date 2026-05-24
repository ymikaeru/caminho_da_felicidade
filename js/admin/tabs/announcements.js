// ============================================================
// Announcements (landing CMU)
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escapeCmu } from '../shared/helpers.js';

async function loadAnnouncements() {
  const list = document.getElementById('ann-list');
  const count = document.getElementById('ann-count');
  list.innerHTML = '<div class="loading">Carregando...</div>';
  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, body, published_at, is_active')
    .order('published_at', { ascending: false })
    .limit(200);
  if (error) {
    list.innerHTML = `<div class="msg err">Erro: ${_escapeCmu(error.message)}</div>`;
    return;
  }
  count.textContent = `(${data.length})`;
  if (!data.length) {
    list.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">Nenhum comunicado publicado.</p>';
    return;
  }
  list.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Publicado</th><th>Título</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${data.map(a => `
          <tr>
            <td style="white-space:nowrap; font-variant-numeric:tabular-nums;">${new Date(a.published_at).toLocaleDateString('pt-BR')}</td>
            <td>
              <strong>${_escapeCmu(a.title)}</strong>
              <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px; max-width:480px;">${_escapeCmu((a.body || '').slice(0, 140))}${(a.body || '').length > 140 ? '…' : ''}</div>
            </td>
            <td>
              <label style="display:inline-flex; gap:6px; align-items:center; cursor:pointer;">
                <input type="checkbox" ${a.is_active ? 'checked' : ''} onchange="toggleAnnouncement('${a.id}', this.checked)">
                ${a.is_active ? '<span style="color:var(--accent); font-size:0.8rem;">Ativo</span>' : '<span style="color:var(--text-muted); font-size:0.8rem;">Inativo</span>'}
              </label>
            </td>
            <td><button class="editor-btn-cancel" onclick="deleteAnnouncement('${a.id}')" style="padding:4px 10px; font-size:0.8rem;">Excluir</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function addAnnouncement() {
  const title = document.getElementById('ann-title').value.trim();
  const body = document.getElementById('ann-body').value.trim();
  const is_active = document.getElementById('ann-active').checked;
  const msg = document.getElementById('ann-msg');
  if (!title || !body) {
    msg.className = 'msg err';
    msg.textContent = 'Título e corpo são obrigatórios.';
    return;
  }
  const { error } = await supabase.from('announcements').insert({ title, body, is_active });
  if (error) {
    msg.className = 'msg err';
    msg.textContent = 'Erro: ' + error.message;
    return;
  }
  msg.className = 'msg ok';
  msg.textContent = 'Comunicado publicado.';
  document.getElementById('ann-title').value = '';
  document.getElementById('ann-body').value = '';
  document.getElementById('ann-active').checked = true;
  loadAnnouncements();
}

async function toggleAnnouncement(id, active) {
  const { error } = await supabase.from('announcements').update({ is_active: active }).eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  loadAnnouncements();
}

async function deleteAnnouncement(id) {
  if (!confirm('Excluir este comunicado?')) return;
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  loadAnnouncements();
}

Object.assign(window, {
  loadAnnouncements,
  addAnnouncement,
  toggleAnnouncement,
  deleteAnnouncement
});
