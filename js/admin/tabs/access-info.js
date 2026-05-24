// ============================================================
// Access Info (difusões e casas de Johrei — landing CMU)
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escapeCmu } from '../shared/helpers.js';

let _editingAccessId = null;
let _accessInfoMap = {};

function _collectAccessForm() {
  return {
    category:   document.getElementById('access-category').value,
    nome:       document.getElementById('access-nome').value.trim(),
    endereco:   document.getElementById('access-endereco').value.trim() || null,
    dias:       document.getElementById('access-dias').value.trim() || null,
    horario:    [document.getElementById('access-horario-ini').value, document.getElementById('access-horario-fim').value].filter(Boolean).join(' às ') || null,
    telefone:   document.getElementById('access-telefone').value.trim() || null,
    sort_order: Number(document.getElementById('access-sort').value) || 0,
    is_active:  document.getElementById('access-active').checked,
  };
}

function resetAccessForm() {
  _editingAccessId = null;
  document.getElementById('access-form-title').textContent = 'Novo Registro';
  document.getElementById('access-category').value = 'difusao';
  document.getElementById('access-nome').value = '';
  document.getElementById('access-endereco').value = '';
  document.getElementById('access-dias').value = '';
  document.getElementById('access-horario-ini').value = '';
  document.getElementById('access-horario-fim').value = '';
  document.getElementById('access-telefone').value = '';
  document.getElementById('access-sort').value = '0';
  document.getElementById('access-active').checked = true;
  document.getElementById('access-add-btn').textContent = 'Adicionar';
  document.getElementById('access-cancel-btn').style.display = 'none';
  document.getElementById('access-msg').className = 'msg';
}

function editAccessInfo(id) {
  const a = _accessInfoMap[id];
  if (!a) return;
  _editingAccessId = id;
  document.getElementById('access-form-title').textContent = 'Editando registro';
  document.getElementById('access-category').value = a.category || 'difusao';
  document.getElementById('access-nome').value = a.nome || '';
  document.getElementById('access-endereco').value = a.endereco || '';
  document.getElementById('access-dias').value = a.dias || '';
  const [hIni = '', hFim = ''] = (a.horario || '').split(' às ');
  document.getElementById('access-horario-ini').value = hIni;
  document.getElementById('access-horario-fim').value = hFim;
  document.getElementById('access-telefone').value = a.telefone || '';
  document.getElementById('access-sort').value = a.sort_order ?? 0;
  document.getElementById('access-active').checked = a.is_active;
  document.getElementById('access-add-btn').textContent = 'Atualizar';
  document.getElementById('access-cancel-btn').style.display = '';
  document.getElementById('access-nome').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function saveAccessInfo() {
  const payload = _collectAccessForm();
  const msg = document.getElementById('access-msg');
  if (!payload.nome) {
    msg.className = 'msg err'; msg.textContent = 'Nome é obrigatório.'; return;
  }
  const btn = document.getElementById('access-add-btn');
  btn.disabled = true;
  let error;
  if (_editingAccessId) {
    ({ error } = await supabase.from('access_info').update(payload).eq('id', _editingAccessId));
  } else {
    ({ error } = await supabase.from('access_info').insert(payload));
  }
  btn.disabled = false;
  if (error) { msg.className = 'msg err'; msg.textContent = 'Erro: ' + error.message; return; }
  msg.className = 'msg ok';
  msg.textContent = _editingAccessId ? 'Registro atualizado.' : 'Registro adicionado.';
  resetAccessForm();
  loadAccessInfo();
}

async function toggleAccessInfo(id, active) {
  const { error } = await supabase.from('access_info').update({ is_active: active }).eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  loadAccessInfo();
}

async function deleteAccessInfo(id) {
  if (!confirm('Excluir este registro?')) return;
  const { error } = await supabase.from('access_info').delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  loadAccessInfo();
}

async function loadAccessInfo() {
  const list = document.getElementById('access-list');
  const count = document.getElementById('access-count');
  list.innerHTML = '<div class="loading">Carregando...</div>';
  const { data, error } = await supabase
    .from('access_info')
    .select('id, category, nome, endereco, dias, horario, telefone, is_active, sort_order')
    .order('sort_order', { ascending: true });
  if (error) {
    list.innerHTML = `<div class="msg err">Erro: ${_escapeCmu(error.message)}</div>`; return;
  }
  _accessInfoMap = {};
  (data || []).forEach(a => { _accessInfoMap[a.id] = a; });
  count.textContent = `(${(data || []).length})`;
  if (!data || !data.length) {
    list.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">Nenhum registro cadastrado.</p>'; return;
  }
  list.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Categoria</th><th>Nome</th><th>Endereço</th>
          <th>Dias / Horário</th><th>Telefone</th><th>Ord.</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${data.map(a => `
          <tr>
            <td><span style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--accent); letter-spacing:.04em;">
              ${{ sede: 'Sede', regional: 'Regional', difusao: 'Difusão', johrei: 'Johrei' }[a.category] || a.category}
            </span></td>
            <td><strong>${_escapeCmu(a.nome || '')}</strong></td>
            <td style="font-size:0.82rem; color:var(--text-muted); max-width:200px;">${_escapeCmu(a.endereco || '—')}</td>
            <td style="font-size:0.82rem;">
              ${a.dias    ? `<div>${_escapeCmu(a.dias)}</div>` : ''}
              ${a.horario ? `<div style="color:var(--text-muted);">${_escapeCmu(a.horario)}</div>` : ''}
              ${!a.dias && !a.horario ? '—' : ''}
            </td>
            <td style="font-size:0.82rem; white-space:nowrap;">${_escapeCmu(a.telefone || '—')}</td>
            <td style="font-variant-numeric:tabular-nums; text-align:center;">${a.sort_order ?? 0}</td>
            <td>
              <label style="display:inline-flex; gap:6px; align-items:center; cursor:pointer;">
                <input type="checkbox" ${a.is_active ? 'checked' : ''} onchange="toggleAccessInfo('${a.id}', this.checked)">
                ${a.is_active
                  ? '<span style="color:var(--accent); font-size:0.8rem;">Ativo</span>'
                  : '<span style="color:var(--text-muted); font-size:0.8rem;">Inativo</span>'}
              </label>
            </td>
            <td style="white-space:nowrap;">
              <button class="reset-btn" onclick="editAccessInfo('${a.id}')">Editar</button>
              <button class="delete-btn" onclick="deleteAccessInfo('${a.id}')">Excluir</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

Object.assign(window, {
  resetAccessForm,
  editAccessInfo,
  saveAccessInfo,
  toggleAccessInfo,
  deleteAccessInfo,
  loadAccessInfo
});
