// ============================================================
// Inbox Tab — Caixa de Entrada do Reverendo
// ============================================================
// O inverso da aba Recomendações: aqui o admin LÊ as mensagens privadas
// que os usuários enviaram a partir de um ensinamento/poema, RESPONDE
// (o usuário vê a resposta + badge) e, se for edificante, REPASSA a todos
// reusando admin_create_recommendation_all (ensinamentos).
//
// Backend: study_messages.sql (admin_get_messages / admin_reply_message /
// admin_delete_message). Repassar poema fica pra fase 2 (a RPC bulk de
// poesia pede lista de ids + poem_number/text que a mensagem não guarda).
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escHtml } from '../shared/helpers.js';
import { VOL_SHORT } from '../shared/constants.js';

let _inboxMessages = [];

async function loadInboxTab() {
  const container = document.getElementById('inbox-list');
  if (!container) return;
  container.innerHTML = '<div class="loading" style="padding:16px;">Carregando...</div>';
  const { data, error } = await supabase.rpc('admin_get_messages');
  if (error) {
    container.innerHTML = `<div class="msg err" style="margin:12px;">Erro: ${_escHtml(error.message)}</div>`;
    return;
  }
  _inboxMessages = data || [];
  renderInbox();
}

function renderInbox() {
  const container = document.getElementById('inbox-list');
  if (!container) return;
  if (_inboxMessages.length === 0) {
    container.innerHTML = '<div style="padding:16px; color:var(--text-muted); font-size:0.85rem; text-align:center;">Nenhuma mensagem recebida ainda.</div>';
    return;
  }
  const now = new Date();
  container.innerHTML = '<div style="display:flex; flex-direction:column; gap:12px;">'
    + _inboxMessages.map(m => _renderCard(m, now)).join('')
    + '</div>';
}

function _renderCard(m, now) {
  const isPoem = m.vol === 'poetry';
  const title = isPoem
    ? (m.title_snapshot || '(poema)')
    : (m.title_pt || m.title_snapshot || '(sem título)');
  const refLine = isPoem
    ? `Poesia · ${_escHtml(m.file)}`
    : `${VOL_SHORT[m.vol] || m.vol} · ${_escHtml(m.file)}#${m.topic_idx}`;
  const openHref = isPoem
    ? `${encodeURIComponent(m.file)}.html?poem=${encodeURIComponent(m.poem_topic_id || '')}&hl_scroll=1`
    : `reader.html?vol=${encodeURIComponent(m.vol)}&file=${encodeURIComponent(m.file)}&topic=${encodeURIComponent(m.topic_idx)}`;

  const sender = _escHtml(m.sender_name || 'Sem nome');
  const email = _escHtml(m.sender_email || '—');
  const created = new Date(m.created_at).toLocaleString('pt-BR');
  const answered = !!m.admin_reply;

  const stateTag = answered
    ? `<span style="display:inline-block; font-size:0.65rem; font-weight:600; padding:1px 7px; border-radius:3px; background:rgba(44,138,62,0.15); color:#2c8a3e; margin-left:8px;">✓ respondida</span>`
    : `<span style="display:inline-block; font-size:0.65rem; font-weight:600; padding:1px 7px; border-radius:3px; background:rgba(184,134,11,0.18); color:var(--accent); margin-left:8px;">● nova</span>`;

  // Resposta já dada, ou caixa de resposta.
  let replyBlock;
  if (answered) {
    const repliedAt = m.replied_at ? new Date(m.replied_at).toLocaleDateString('pt-BR') : '';
    replyBlock = `
      <div style="margin-top:10px; padding:10px 12px; background:rgba(44,138,62,0.07); border-left:3px solid #2c8a3e; border-radius:4px;">
        <div style="font-size:0.68rem; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:#2c8a3e; margin-bottom:4px;">Sua resposta${repliedAt ? ' · ' + repliedAt : ''}</div>
        <div style="font-size:0.86rem; color:var(--text-main); line-height:1.5;">${_escHtml(m.admin_reply)}</div>
      </div>`;
  } else {
    replyBlock = `
      <div style="margin-top:10px; display:flex; flex-direction:column; gap:6px;">
        <textarea id="inbox-reply-${_escHtml(m.id)}" rows="2" placeholder="Escreva uma resposta ao usuário..." style="width:100%; padding:8px 10px; font-size:0.85rem; border:1px solid var(--border); border-radius:5px; resize:vertical; font-family:inherit; background:var(--bg,#fff); color:inherit; box-sizing:border-box;"></textarea>
        <div style="display:flex; justify-content:flex-end;">
          <button onclick="inboxReply('${_escHtml(m.id)}')" style="padding:5px 14px; font-size:0.78rem; background:var(--accent); color:#fff; border:none; border-radius:5px; cursor:pointer; font-weight:600;">Responder</button>
        </div>
      </div>`;
  }

  // Repassar a todos — só ensinamento na v1 (ver cabeçalho).
  const repassarBtn = isPoem
    ? ''
    : `<button onclick="inboxRepassar('${_escHtml(m.id)}')" style="background:none; border:1px solid var(--accent); color:var(--accent); padding:4px 10px; font-size:0.7rem; border-radius:3px; cursor:pointer; white-space:nowrap;" title="Recomendar este ensinamento a todos os usuários">↗ Repassar a todos</button>`;

  return `
    <div style="padding:12px 14px; background:var(--surface, var(--bg)); border:1px solid var(--border); border-radius:6px;">
      <div style="display:flex; align-items:flex-start; gap:8px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:0.82rem; font-weight:600;">${sender} ${stateTag}</div>
          <div style="font-size:0.7rem; color:var(--text-muted); margin-top:1px;">${email} · ${created}</div>
        </div>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <a href="${openHref}" target="_blank" rel="noopener" style="background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 10px; font-size:0.7rem; border-radius:3px; cursor:pointer; text-decoration:none; white-space:nowrap;" title="Abrir o ensinamento/poema numa nova aba">↗ Abrir</a>
          ${repassarBtn}
          <button onclick="inboxDelete('${_escHtml(m.id)}')" style="background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 10px; font-size:0.7rem; border-radius:3px; cursor:pointer;" title="Apagar permanentemente">✕</button>
        </div>
      </div>
      <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border);">
        <div style="font-size:0.82rem; font-weight:600; color:var(--text-main);">${_escHtml(title)}</div>
        <div style="font-size:0.68rem; color:var(--text-muted); margin-top:1px;">${refLine}</div>
        <div style="font-size:0.9rem; color:var(--text-main); margin-top:8px; font-style:italic; line-height:1.5;">"${_escHtml(m.body)}"</div>
      </div>
      ${replyBlock}
    </div>`;
}

async function inboxReply(id) {
  const ta = document.getElementById(`inbox-reply-${id}`);
  if (!ta) return;
  const reply = ta.value.trim();
  if (!reply) { alert('Escreva uma resposta.'); return; }
  ta.disabled = true;
  const { error } = await supabase.rpc('admin_reply_message', { p_id: id, p_reply: reply });
  if (error) { alert('Erro: ' + error.message); ta.disabled = false; return; }
  loadInboxTab();
}

// Repassa o ensinamento a TODOS os usuários, virando uma Recomendação do
// Reverendo (curada — a nota é dele, não o texto privado do usuário).
async function inboxRepassar(id) {
  const m = _inboxMessages.find(x => x.id === id);
  if (!m) return;
  if (m.vol === 'poetry') { alert('Repasse de poema ainda não disponível.'); return; }
  const note = prompt('Nota opcional para a recomendação (deixe vazio para nenhuma):', '');
  if (note === null) return; // cancelou
  if (!confirm(`Recomendar "${m.title_pt || m.title_snapshot || 'este ensinamento'}" para TODOS os usuários?\n\nCada um receberá uma cópia. Não dá pra desfazer em massa.`)) return;
  const { data, error } = await supabase.rpc('admin_create_recommendation_all', {
    p_vol: m.vol,
    p_file: m.file,
    p_topic_idx: m.topic_idx || 0,
    p_note: note.trim() || null,
    p_expires_at: null,
  });
  if (error) { alert('Erro: ' + error.message); return; }
  alert(`Repassado para ${data} usuário${data === 1 ? '' : 's'}.`);
}

async function inboxDelete(id) {
  if (!confirm('Apagar esta mensagem?')) return;
  const { error } = await supabase.rpc('admin_delete_message', { p_id: id });
  if (error) { alert('Erro: ' + error.message); return; }
  loadInboxTab();
}

Object.assign(window, {
  loadInboxTab,
  inboxReply,
  inboxRepassar,
  inboxDelete,
});
