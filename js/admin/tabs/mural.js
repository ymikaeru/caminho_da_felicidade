// ============================================================
// Mural Tab — moderação do Mural de Descobertas
// ============================================================
// Fila de pré-moderação: posts entram 'pending' e só aparecem no feed
// depois que o admin aprova. Aqui o admin vê todos (COM autor — admin_get_posts),
// aprova, oculta ou apaga. Backend: study_posts.sql.
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escHtml } from '../shared/helpers.js';
import { VOL_SHORT } from '../shared/constants.js';

let _muralPosts = [];

async function loadMuralTab() {
  const container = document.getElementById('mural-mod-list');
  if (!container) return;
  container.innerHTML = '<div class="loading" style="padding:16px;">Carregando...</div>';
  const { data, error } = await supabase.rpc('admin_get_posts');
  if (error) {
    container.innerHTML = `<div class="msg err" style="margin:12px;">Erro: ${_escHtml(error.message)}</div>`;
    return;
  }
  _muralPosts = data || [];
  renderMural();
}

function renderMural() {
  const container = document.getElementById('mural-mod-list');
  if (!container) return;
  if (_muralPosts.length === 0) {
    container.innerHTML = '<div style="padding:16px; color:var(--text-muted); font-size:0.85rem; text-align:center;">Nenhuma reflexão recebida ainda.</div>';
    return;
  }
  const pending = _muralPosts.filter(p => p.status === 'pending').length;
  const head = pending > 0
    ? `<div style="margin-bottom:12px; font-size:0.85rem; color:var(--accent); font-weight:600;">${pending} aguardando aprovação</div>`
    : '';
  container.innerHTML = head
    + '<div style="display:flex; flex-direction:column; gap:12px;">'
    + _muralPosts.map(_card).join('')
    + '</div>';
}

function _card(p) {
  const id = _escHtml(p.id);
  const isPoem = p.vol === 'poetry';
  const title = isPoem
    ? (p.title_snapshot || '(poema)')
    : (p.title_pt || p.title_snapshot || '(sem título)');
  const refLine = isPoem
    ? `Poesia · ${_escHtml(p.file)}`
    : `${VOL_SHORT[p.vol] || p.vol} · ${_escHtml(p.file)}#${p.topic_idx}`;
  const openHref = isPoem
    ? `${encodeURIComponent(p.file)}.html?poem=${encodeURIComponent(p.poem_topic_id || '')}&hl_scroll=1`
    : `reader.html?vol=${encodeURIComponent(p.vol)}&file=${encodeURIComponent(p.file)}&topic=${encodeURIComponent(p.topic_idx)}`;
  const sender = _escHtml(p.author_name || 'Sem nome');
  const email = _escHtml(p.author_email || '—');
  const created = new Date(p.created_at).toLocaleString('pt-BR');

  const statusMap = {
    pending:  { bg: 'rgba(184,134,11,0.18)', c: 'var(--accent)', t: '● aguardando' },
    approved: { bg: 'rgba(44,138,62,0.15)',  c: '#2c8a3e',       t: '✓ aprovada' },
    hidden:   { bg: 'rgba(150,150,150,0.18)', c: 'var(--text-muted)', t: '⊘ oculta' },
  };
  const st = statusMap[p.status] || statusMap.pending;
  const statusTag = `<span style="display:inline-block; font-size:0.65rem; font-weight:600; padding:1px 7px; border-radius:3px; background:${st.bg}; color:${st.c}; margin-left:8px;">${st.t}</span>`;

  // Poema aparece inline (o que o feed mostraria); ensinamento mostra só o ref.
  const excerptHtml = p.excerpt
    ? `<div style="margin-top:8px; padding-left:12px; border-left:2px solid var(--accent); font-family:'Crimson Pro',Georgia,serif; font-style:italic; white-space:pre-line; line-height:1.6; color:var(--text-main); font-size:0.9rem;">${_escHtml(p.excerpt)}</div>`
    : '';

  const approveBtn = p.status !== 'approved'
    ? `<button onclick="muralApprove('${id}')" style="background:var(--accent); border:1px solid var(--accent); color:#fff; padding:4px 12px; font-size:0.72rem; border-radius:3px; cursor:pointer; font-weight:600; white-space:nowrap;" title="Aprovar — passa a aparecer no mural">✓ Aprovar</button>`
    : '';
  const hideBtn = p.status === 'approved'
    ? `<button onclick="muralHide('${id}')" style="background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 10px; font-size:0.72rem; border-radius:3px; cursor:pointer; white-space:nowrap;" title="Ocultar do mural">Ocultar</button>`
    : '';

  return `
    <div style="padding:12px 14px; background:var(--surface, var(--bg)); border:1px solid var(--border); border-radius:6px;">
      <div style="display:flex; align-items:flex-start; gap:8px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:0.82rem; font-weight:600;">${sender} ${statusTag}</div>
          <div style="font-size:0.7rem; color:var(--text-muted); margin-top:1px;">${email} · ${created}</div>
        </div>
        <div style="display:flex; gap:6px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;">
          <a href="${openHref}" target="_blank" rel="noopener" style="background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 10px; font-size:0.72rem; border-radius:3px; text-decoration:none; white-space:nowrap;" title="Abrir o ensinamento/poema">↗ Abrir</a>
          ${approveBtn}
          ${hideBtn}
          <button onclick="muralDelete('${id}')" style="background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 10px; font-size:0.72rem; border-radius:3px; cursor:pointer;" title="Apagar permanentemente">✕</button>
        </div>
      </div>
      <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border);">
        <div style="font-size:0.8rem; font-weight:600; color:var(--text-main);">${_escHtml(title)}</div>
        <div style="font-size:0.68rem; color:var(--text-muted); margin-top:1px;">${refLine}</div>
        ${excerptHtml}
        <div style="font-size:0.92rem; color:var(--text-main); margin-top:8px; line-height:1.55;">${_escHtml(p.body)}</div>
      </div>
    </div>`;
}

async function muralApprove(id) {
  const { error } = await supabase.rpc('admin_approve_post', { p_id: id });
  if (error) { alert('Erro: ' + error.message); return; }
  loadMuralTab();
}

async function muralHide(id) {
  const { error } = await supabase.rpc('admin_set_post_status', { p_id: id, p_status: 'hidden' });
  if (error) { alert('Erro: ' + error.message); return; }
  loadMuralTab();
}

async function muralDelete(id) {
  if (!confirm('Apagar esta reflexão permanentemente?')) return;
  const { error } = await supabase.rpc('admin_delete_post', { p_id: id });
  if (error) { alert('Erro: ' + error.message); return; }
  loadMuralTab();
}

Object.assign(window, {
  loadMuralTab,
  muralApprove,
  muralHide,
  muralDelete,
});
