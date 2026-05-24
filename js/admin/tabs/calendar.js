// ============================================================
// Calendar Events (landing CMU)
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escapeCmu } from '../shared/helpers.js';

async function loadCalendarEvents() {
  const list = document.getElementById('cal-list');
  const count = document.getElementById('cal-count');
  list.innerHTML = '<div class="loading">Carregando...</div>';
  const { data, error } = await supabase
    .from('calendar_events')
    .select('id, date, title, description, created_at')
    .order('date', { ascending: false })
    .limit(500);
  if (error) {
    list.innerHTML = `<div class="msg err">Erro: ${_escapeCmu(error.message)}</div>`;
    return;
  }
  count.textContent = `(${data.length})`;
  if (!data.length) {
    list.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">Nenhum evento cadastrado.</p>';
    return;
  }
  list.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Data</th><th>Título</th><th>Descrição</th><th></th></tr></thead>
      <tbody>
        ${data.map(e => `
          <tr>
            <td style="white-space:nowrap; font-variant-numeric:tabular-nums;">${_escapeCmu(e.date)}</td>
            <td><strong>${_escapeCmu(e.title)}</strong></td>
            <td style="color:var(--text-muted);">${_escapeCmu(e.description || '')}</td>
            <td><button class="editor-btn-cancel" onclick="deleteCalendarEvent('${e.id}')" style="padding:4px 10px; font-size:0.8rem;">Excluir</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function calAtalho(alvo) {
  const d = new Date();
  if (alvo === 0 || alvo === 1) {
    d.setDate(d.getDate() + alvo);
  } else {
    const alvo_dow = alvo === 'sab' ? 6 : 0;
    const diff = (alvo_dow - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
  }
  document.getElementById('cal-date').value = d.toISOString().slice(0, 10);
}

async function addCalendarEvent() {
  const date    = document.getElementById('cal-date').value;
  const title   = document.getElementById('cal-title').value.trim();
  const horario = document.getElementById('cal-horario').value.trim();
  const obs     = document.getElementById('cal-desc').value.trim();
  const description = [horario, obs].filter(Boolean).join(' — ') || null;
  const msg = document.getElementById('cal-msg');
  if (!date || !title) {
    msg.className = 'msg err';
    msg.textContent = 'Data e título são obrigatórios.';
    return;
  }
  const { error } = await supabase.from('calendar_events').insert({ date, title, description });
  if (error) {
    msg.className = 'msg err';
    msg.textContent = 'Erro: ' + error.message;
    return;
  }
  msg.className = 'msg ok';
  msg.textContent = 'Evento adicionado.';
  document.getElementById('cal-date').value = '';
  document.getElementById('cal-horario').value = '';
  document.getElementById('cal-title').value = '';
  document.getElementById('cal-desc').value = '';
  loadCalendarEvents();
}

async function deleteCalendarEvent(id) {
  if (!confirm('Excluir este evento?')) return;
  const { error } = await supabase.from('calendar_events').delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  loadCalendarEvents();
}

Object.assign(window, {
  loadCalendarEvents,
  calAtalho,
  addCalendarEvent,
  deleteCalendarEvent
});
