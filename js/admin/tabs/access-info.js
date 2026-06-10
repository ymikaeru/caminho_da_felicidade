// ============================================================
// Access Info (difusões e casas de Johrei — landing CMU)
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escapeCmu } from '../shared/helpers.js';

// ── Markup da aba (movido de admin-supabase.html p/ manter o HTML enxuto) ──
// Injetado no import do módulo: roda antes do corpo de admin.js (imports são
// hoisted) e antes de qualquer interação — o DOM final é idêntico ao antigo.
const _TAB_MARKUP = `
              <div style="margin-bottom:24px;">
                <h2
                  style="margin:0 0 4px; font-size:1rem; font-weight:600; color:var(--accent); letter-spacing:1px; text-transform:uppercase;">
                  Dados de Acesso</h2>
                <p style="font-size:0.85rem; color:var(--text-muted); margin:0;">Informações de difusões e casas de
                  Johrei
                  exibidas na landing pública.</p>
              </div>
              <div class="admin-section">
                <h2 id="access-form-title">Novo Registro</h2>
                <div class="add-user-form" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                  <div class="form-group">
                    <label for="access-category">Categoria</label>
                    <select id="access-category"
                      style="width:100%; padding:9px 12px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:0.9rem;">
                      <option value="sede">Sede Central</option>
                      <option value="regional">Regional</option>
                      <option value="difusao">Difusão</option>
                      <option value="johrei">Casa de Johrei</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label for="access-nome">Nome</label>
                    <input type="text" id="access-nome" placeholder="Ex: Sede Central">
                  </div>
                  <div class="form-group" style="grid-column:1/-1;">
                    <label for="access-endereco">Endereço</label>
                    <input type="text" id="access-endereco" placeholder="Ex: Rua das Flores, 123 — São Paulo/SP">
                  </div>
                  <div class="form-group">
                    <label for="access-dias">Dias de funcionamento</label>
                    <input type="text" id="access-dias" placeholder="Ex: Terças e Quintas">
                  </div>
                  <div class="form-group">
                    <label>Horário</label>
                    <div style="display:flex; align-items:center; gap:6px;">
                      <select id="access-horario-ini"
                        style="flex:1; padding:9px 8px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:0.9rem;">
                        <option value="">—</option>
                        <optgroup label="Manhã">
                          <option>7h00</option>
                          <option>7h30</option>
                          <option>8h00</option>
                          <option>8h30</option>
                          <option>9h00</option>
                          <option>9h30</option>
                          <option>10h00</option>
                          <option>10h30</option>
                          <option>11h00</option>
                          <option>11h30</option>
                        </optgroup>
                        <optgroup label="Tarde">
                          <option>13h00</option>
                          <option>13h30</option>
                          <option>14h00</option>
                          <option>14h30</option>
                          <option>15h00</option>
                          <option>15h30</option>
                          <option>16h00</option>
                          <option>17h00</option>
                        </optgroup>
                        <optgroup label="Noite">
                          <option>18h00</option>
                          <option>18h30</option>
                          <option>19h00</option>
                          <option>19h30</option>
                          <option>20h00</option>
                          <option>20h30</option>
                        </optgroup>
                      </select>
                      <span style="color:var(--text-muted); font-size:0.85rem; flex-shrink:0;">às</span>
                      <select id="access-horario-fim"
                        style="flex:1; padding:9px 8px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:0.9rem;">
                        <option value="">—</option>
                        <optgroup label="Manhã">
                          <option>7h00</option>
                          <option>7h30</option>
                          <option>8h00</option>
                          <option>8h30</option>
                          <option>9h00</option>
                          <option>9h30</option>
                          <option>10h00</option>
                          <option>10h30</option>
                          <option>11h00</option>
                          <option>11h30</option>
                        </optgroup>
                        <optgroup label="Tarde">
                          <option>13h00</option>
                          <option>13h30</option>
                          <option>14h00</option>
                          <option>14h30</option>
                          <option>15h00</option>
                          <option>15h30</option>
                          <option>16h00</option>
                          <option>17h00</option>
                        </optgroup>
                        <optgroup label="Noite">
                          <option>18h00</option>
                          <option>18h30</option>
                          <option>19h00</option>
                          <option>19h30</option>
                          <option>20h00</option>
                          <option>20h30</option>
                        </optgroup>
                      </select>
                    </div>
                  </div>
                  <div class="form-group">
                    <label for="access-telefone">Telefone</label>
                    <input type="text" id="access-telefone" placeholder="Ex: (11) 99999-9999">
                  </div>
                  <div class="form-group">
                    <label for="access-sort">Ordem</label>
                    <input type="number" id="access-sort" value="0" min="0"
                      style="width:100%; padding:9px 12px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:0.9rem;">
                  </div>
                  <div class="form-group" style="display:flex; align-items:flex-end; padding-bottom:2px;">
                    <label><input type="checkbox" id="access-active" checked> Ativo (visível no site)</label>
                  </div>
                  <div style="grid-column:1/-1; display:flex; gap:8px; align-items:center;">
                    <button id="access-add-btn" onclick="saveAccessInfo()">Adicionar</button>
                    <button id="access-cancel-btn" onclick="resetAccessForm()"
                      style="display:none; padding:9px 16px; border:1px solid var(--border); border-radius:8px; background:none; color:var(--text-muted); font-size:0.9rem; cursor:pointer;">Cancelar
                      edição</button>
                  </div>
                </div>
                <div id="access-msg" class="msg"></div>
              </div>
              <div class="admin-section">
                <h2>Registros <span id="access-count"
                    style="font-weight:400; color:var(--text-muted); font-size:0.85rem;"></span></h2>
                <div id="access-list">
                  <div class="loading">Carregando...</div>
                </div>
              </div>
            `;
{
  const _tabEl = document.getElementById('tab-access');
  if (_tabEl && !_tabEl.firstElementChild) _tabEl.innerHTML = _TAB_MARKUP;
}

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
