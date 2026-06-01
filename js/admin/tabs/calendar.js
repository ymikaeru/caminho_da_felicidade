// ============================================================
// Calendar Events (landing CMU)
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escapeCmu } from '../shared/helpers.js';

async function loadCalendarEvents() {
  const list = document.getElementById('cal-list');
  const count = document.getElementById('cal-count');
  _initSeletorMes(); // popula os selects de mês/ano (pt-BR) na 1ª abertura
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
            <td style="white-space:nowrap; font-variant-numeric:tabular-nums;">${_fmtBR(e.date)}</td>
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

// Insert compartilhado entre o formulário manual e as sugestões
async function _insertEvento(date, title, description) {
  return await supabase.from('calendar_events').insert({ date, title, description });
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
  const { error } = await _insertEvento(date, title, description);
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

// ============================================================
// Sugestões do mês — eventos recorrentes da CMU
// ============================================================

// Opções de horário iguais às do formulário "Novo Evento"
const HORARIOS = {
  'Manhã': ['7h00','7h30','8h00','8h30','9h00','9h30','10h00','10h30','11h00','11h30'],
  'Tarde': ['13h00','13h30','14h00','14h30','15h00','15h30','16h00','17h00'],
  'Noite': ['18h00','18h30','19h00','19h30','20h00','20h30']
};

// Helpers de data — sempre em horário LOCAL (sem toISOString, que desloca em UTC-3)
const _pad = n => String(n).padStart(2, '0');
const _fmt = dt => `${dt.getFullYear()}-${_pad(dt.getMonth() + 1)}-${_pad(dt.getDate())}`;
function _addDays(dt, n) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n); }
function _firstWeekday(y, m, target) {
  for (let d = 1; d <= 7; d++) { const dt = new Date(y, m, d); if (dt.getDay() === target) return dt; }
}
function _nthWeekday(y, m, target, n) { return _addDays(_firstWeekday(y, m, target), (n - 1) * 7); }

// Datas em pt-BR sem depender do idioma do navegador (controles nativos seguem o locale do browser)
const _MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const _WD_FULL = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];

// Formata "YYYY-MM-DD" -> "dd/mm/aaaa" (parse manual, sem Date, p/ não deslocar em UTC-3)
function _fmtBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${_pad(d)}/${_pad(m)}/${y}`;
}

// "dd/mm/aaaa" -> "YYYY-MM-DD" (valida data real); retorna '' se inválida
function _parseBR(str) {
  const m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const d = +m[1], mo = +m[2], y = +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  return `${y}-${_pad(mo)}-${_pad(d)}`;
}

// Dia da semana por extenso a partir de "YYYY-MM-DD"
function _weekdayBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return _WD_FULL[new Date(y, m - 1, d).getDay()];
}

// Popula os selects de mês (pt-BR) e ano, e define o padrão (mês atual). Roda só uma vez.
function _initSeletorMes() {
  const selMes = document.getElementById('cal-sug-mes');
  const selAno = document.getElementById('cal-sug-ano');
  if (!selMes || !selAno || selMes.dataset.init) return;
  const now = new Date();
  selMes.innerHTML = _MESES.map((nome, i) => `<option value="${i + 1}">${nome}</option>`).join('');
  let anos = '';
  for (let a = now.getFullYear() - 1; a <= now.getFullYear() + 2; a++) anos += `<option value="${a}">${a}</option>`;
  selAno.innerHTML = anos;
  selMes.value = String(now.getMonth() + 1);
  selAno.value = String(now.getFullYear());
  selMes.dataset.init = '1';
}

// Gera as sugestões recorrentes para um mês (month0 = 0-based), ordenadas por data
function _gerarSugestoes(year, month0) {
  // 1º domingo do mês; exceto quando o mês começa no sábado (dia 1 = sáb), aí é nesse sábado
  const cultoMensal = new Date(year, month0, 1).getDay() === 6
    ? new Date(year, month0, 1)
    : _firstWeekday(year, month0, 0);
  const prep1       = _addDays(cultoMensal, -2);               // 2 dias antes
  const prep2       = _addDays(cultoMensal, -1);               // 1 dia antes
  const acaoGracas  = _addDays(cultoMensal, 7);                // fim de semana seguinte
  const ancestrais  = _nthWeekday(year, month0, 0, 3);         // 3º domingo
  const museu       = _addDays(ancestrais, -1);                // sábado que antecede os Ancestrais (3º fim de semana)
  const dia18Sab    = new Date(year, month0, 18).getDay() === 6;

  const sugestoes = [
    { date: _fmt(prep1), horario: '9h00', title: 'Preparativos', obs: '' },
    { date: _fmt(prep2), horario: '9h00', title: 'Preparativos', obs: '' },
    { date: _fmt(cultoMensal), horario: '10h00', title: 'Culto Mensal', obs: 'Sede Central',
      aviso: 'Confira se há feriado entre o dia 1 e este fim de semana — nesse caso a data costuma mudar.' },
    { date: _fmt(acaoGracas), horario: '11h00', title: 'Culto em Ação de Graças', obs: 'Protótipo do Paraíso' },
    { date: _fmt(museu), horario: '10h00', title: 'Museu', obs: '' },
    { date: _fmt(ancestrais), horario: '16h00', title: 'Culto pelos Ancestrais', obs: '',
      aviso: dia18Sab ? 'O dia 18 cai no sábado — confira se o Culto pelos Ancestrais não deve ser no fim de semana anterior.' : null }
  ];
  return sugestoes.sort((a, b) => a.date.localeCompare(b.date));
}

function _horarioOptions(selecionado) {
  let html = '<option value="">— sem horário —</option>';
  for (const [grupo, lista] of Object.entries(HORARIOS)) {
    html += `<optgroup label="${grupo}">`;
    html += lista.map(h => `<option${h === selecionado ? ' selected' : ''}>${h}</option>`).join('');
    html += '</optgroup>';
  }
  return html;
}

let _sugestoesAtuais = [];

function _renderSugestoes(sugestoes, existentes) {
  const cont = document.getElementById('cal-sug-list');
  if (!cont) return;
  if (!sugestoes.length) { cont.innerHTML = ''; return; }
  const inputStyle = 'width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:0.9rem;';
  cont.innerHTML = sugestoes.map((s, i) => {
    const jaExiste = existentes.has(`${s.date}|${s.title}`);
    return `
    <div id="sug-card-${i}" style="border:1px solid var(--border); border-radius:10px; padding:12px; display:flex; flex-direction:column; ${jaExiste ? 'opacity:0.6;' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
        <strong style="color:var(--accent);">${_escapeCmu(s.title)} <span id="sug-dow-${i}" style="font-weight:400; color:var(--text-muted); font-size:0.8rem;">· ${_weekdayBR(s.date)}</span></strong>
        ${jaExiste ? '<span style="font-size:0.72rem; padding:2px 8px; border-radius:999px; background:var(--border); color:var(--text-muted);">já cadastrado</span>' : ''}
      </div>
      <div style="display:grid; grid-template-columns:150px 1fr; gap:8px; margin-bottom:8px;">
        <input type="text" id="sug-date-${i}" value="${_fmtBR(s.date)}" placeholder="dd/mm/aaaa" inputmode="numeric" oninput="atualizarDiaSugestao(${i})" style="${inputStyle} font-variant-numeric:tabular-nums;">
        <select id="sug-hora-${i}" style="${inputStyle}">${_horarioOptions(s.horario)}</select>
      </div>
      <input type="text" id="sug-title-${i}" value="${_escapeCmu(s.title)}" placeholder="Título" style="${inputStyle} margin-bottom:8px;">
      <input type="text" id="sug-obs-${i}" value="${_escapeCmu(s.obs)}" placeholder="Observações (opcional)" style="${inputStyle}">
      ${s.aviso ? `<div style="margin-top:8px; font-size:0.78rem; color:var(--text-muted); border-left:3px solid var(--accent); padding-left:8px;">⚠ ${_escapeCmu(s.aviso)}</div>` : ''}
      <div style="margin-top:auto; padding-top:10px;">
        <button id="sug-btn-${i}" onclick="aplicarSugestao(${i})" ${jaExiste ? 'disabled' : ''} style="padding:6px 14px; font-size:0.85rem;">${jaExiste ? 'Já adicionado' : 'Adicionar'}</button>
      </div>
    </div>`;
  }).join('');
}

async function gerarSugestoesCalendario() {
  const cont = document.getElementById('cal-sug-list');
  const msg = document.getElementById('cal-sug-msg');
  if (msg) { msg.className = 'msg'; msg.textContent = ''; }
  const month = Number(document.getElementById('cal-sug-mes')?.value);
  const year = Number(document.getElementById('cal-sug-ano')?.value);
  if (!month || !year) {
    if (cont) cont.innerHTML = '<div class="msg err">Escolha o mês e o ano.</div>';
    return;
  }
  const month0 = month - 1;
  const sugestoes = _gerarSugestoes(year, month0);
  _sugestoesAtuais = sugestoes;

  // Eventos já existentes no intervalo (janela alargada p/ pegar Preparativos do mês anterior)
  const inicio = _fmt(new Date(year, month0, -2));
  const fim = _fmt(new Date(year, month0 + 1, 0));
  let existentes = new Set();
  const { data } = await supabase
    .from('calendar_events')
    .select('date, title')
    .gte('date', inicio)
    .lte('date', fim);
  existentes = new Set((data || []).map(e => `${e.date}|${e.title}`));

  _renderSugestoes(sugestoes, existentes);
}

function _lerCartao(i) {
  const dateEl = document.getElementById(`sug-date-${i}`);
  if (!dateEl) return null;
  const date    = _parseBR(dateEl.value); // '' se a data estiver inválida
  const horario = document.getElementById(`sug-hora-${i}`).value.trim();
  const title   = document.getElementById(`sug-title-${i}`).value.trim();
  const obs     = document.getElementById(`sug-obs-${i}`).value.trim();
  const description = [horario, obs].filter(Boolean).join(' — ') || null;
  return { date, title, description };
}

async function aplicarSugestao(i) {
  const msg = document.getElementById('cal-sug-msg');
  const c = _lerCartao(i);
  if (!c) return;
  if (!c.date || !c.title) {
    if (msg) { msg.className = 'msg err'; msg.textContent = 'Verifique a data (dd/mm/aaaa) e o título.'; }
    return;
  }
  const { error } = await _insertEvento(c.date, c.title, c.description);
  if (error) {
    if (msg) { msg.className = 'msg err'; msg.textContent = 'Erro: ' + error.message; }
    return;
  }
  const btn = document.getElementById(`sug-btn-${i}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Adicionado ✓'; }
  const card = document.getElementById(`sug-card-${i}`);
  if (card) card.style.opacity = '0.6';
  if (msg) { msg.className = 'msg ok'; msg.textContent = `"${c.title}" adicionado.`; }
  loadCalendarEvents();
}

async function aplicarTodasSugestoes() {
  const msg = document.getElementById('cal-sug-msg');
  if (!_sugestoesAtuais.length) {
    if (msg) { msg.className = 'msg err'; msg.textContent = 'Gere as sugestões primeiro.'; }
    return;
  }
  let adicionados = 0, erros = 0;
  for (let i = 0; i < _sugestoesAtuais.length; i++) {
    const btn = document.getElementById(`sug-btn-${i}`);
    if (!btn || btn.disabled) continue; // pula já cadastrados / já adicionados
    const c = _lerCartao(i);
    if (!c || !c.date || !c.title) { erros++; continue; }
    const { error } = await _insertEvento(c.date, c.title, c.description);
    if (error) { erros++; continue; }
    btn.disabled = true; btn.textContent = 'Adicionado ✓';
    const card = document.getElementById(`sug-card-${i}`);
    if (card) card.style.opacity = '0.6';
    adicionados++;
  }
  if (msg) {
    msg.className = erros ? 'msg err' : 'msg ok';
    msg.textContent = `${adicionados} evento(s) adicionado(s).` + (erros ? ` ${erros} com erro.` : '');
  }
  loadCalendarEvents();
}

// Atualiza o rótulo de dia da semana quando o admin edita a data do cartão
function atualizarDiaSugestao(i) {
  const el = document.getElementById(`sug-date-${i}`);
  const dow = document.getElementById(`sug-dow-${i}`);
  if (!el || !dow) return;
  const iso = _parseBR(el.value);
  dow.textContent = iso ? `· ${_weekdayBR(iso)}` : '· data inválida';
}

Object.assign(window, {
  loadCalendarEvents,
  calAtalho,
  addCalendarEvent,
  deleteCalendarEvent,
  gerarSugestoesCalendario,
  aplicarSugestao,
  aplicarTodasSugestoes,
  atualizarDiaSugestao
});
