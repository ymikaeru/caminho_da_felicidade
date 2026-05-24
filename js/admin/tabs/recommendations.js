// ============================================================
// Recommendations Tab — gestão de recomendações de estudo por
// usuário. Reaproveita allUsers (carregado pela aba Usuários) e
// a RPC suggest_teachings (também usada pelo "Você quis dizer"
// da busca pública) pra picker de ensinamento.
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escHtml } from '../shared/helpers.js';
import { VOL_SHORT } from '../shared/constants.js';
import { allUsers, setAllUsers } from '../shared/state.js';

let _recSelectedUser = null;     // {id, display_name, email}
let _recPickedTeaching = null;   // {vol, file, topic_idx, title_pt, title_ja}
let _recTeachingSearchTimer = null;

async function loadRecommendationsTab() {
  // Garante que a lista de usuários esteja carregada (a aba Usuários
  // popula allUsers; se admin abrir Recomendações primeiro, refazemos).
  if (!Array.isArray(allUsers) || allUsers.length === 0) {
    const { data, error } = await supabase.rpc('admin_get_users');
    if (error) {
      document.getElementById('rec-user-list').innerHTML = `<div class="msg err" style="margin:12px;">Erro: ${_escHtml(error.message)}</div>`;
      return;
    }
    setAllUsers(data || []);
  }
  renderRecUserList();
}

function renderRecUserList() {
  const container = document.getElementById('rec-user-list');
  if (!container) return;
  const query = (document.getElementById('rec-user-search')?.value || '').toLowerCase();
  const filtered = (allUsers || []).filter(u =>
    (u.display_name || '').toLowerCase().includes(query) ||
    (u.email || '').toLowerCase().includes(query)
  );
  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding:16px; color:var(--text-muted); font-size:0.85rem;">Nenhum usuário encontrado.</div>';
    return;
  }
  container.innerHTML = filtered.map(u => {
    const idEsc = _escHtml(u.id);
    const nameEsc = _escHtml(u.display_name || 'Sem nome');
    const emailEsc = _escHtml(u.email || '—');
    const active = _recSelectedUser && _recSelectedUser.id === u.id ? ' style="background:var(--accent-soft, rgba(184,134,11,0.12)); border-left:3px solid var(--accent);"' : '';
    return `
      <div onclick="recSelectUser('${idEsc}')" style="padding:10px 12px; cursor:pointer; border-bottom:1px solid var(--border);"${active}>
        <div style="font-size:0.88rem; font-weight:500;">${nameEsc}</div>
        <div style="font-size:0.72rem; color:var(--text-muted);">${emailEsc}</div>
      </div>
    `;
  }).join('');
}

function recSelectUser(userId) {
  const u = (allUsers || []).find(x => x.id === userId);
  if (!u) return;
  _recSelectedUser = u;
  document.getElementById('rec-detail-empty').style.display = 'none';
  document.getElementById('rec-detail').style.display = 'block';
  document.getElementById('rec-detail-name').textContent = u.display_name || 'Sem nome';
  document.getElementById('rec-detail-email').textContent = u.email || '—';
  // Mantém ensinamento já picado quando troca de usuário — admin
  // pode estar recomendando o mesmo pra vários. Só habilita o
  // "Recomendar" se houver ensinamento + user (esse).
  if (_recPickedTeaching) {
    document.getElementById('rec-create-btn').disabled = false;
  }
  renderRecUserList();
  recLoadList();
}

async function recLoadList() {
  const container = document.getElementById('rec-list');
  if (!_recSelectedUser) return;
  container.innerHTML = '<div class="loading" style="padding:16px;">Carregando...</div>';
  const { data, error } = await supabase.rpc('admin_get_user_recommendations', {
    p_user_id: _recSelectedUser.id,
  });
  if (error) {
    container.innerHTML = `<div class="msg err">Erro: ${_escHtml(error.message)}</div>`;
    return;
  }
  const recs = data || [];
  if (recs.length === 0) {
    container.innerHTML = '<div style="padding:16px; color:var(--text-muted); font-size:0.85rem; text-align:center;">Nenhuma recomendação ativa.</div>';
    return;
  }
  // Estados:
  //   - ativa: archived_at null + expires_at null/futuro
  //   - arquivada pelo usuário: archived_at populado
  //   - expirada: expires_at no passado
  // Ativas e inativas (arquivadas+expiradas) recebem tratamento
  // visual distinto. Admin não recebe notificação — só vê histórico.
  const now = new Date();
  container.innerHTML = '<div style="display:flex; flex-direction:column; gap:8px;">' + recs.map(r => {
    const title = r.title_pt || '(sem título)';
    const expired = r.expires_at && new Date(r.expires_at) <= now;
    const archived = !!r.archived_at;
    const inactive = expired || archived;

    // "vista" = abriu o modal de recs (mark_recommendations_seen).
    // "lida"  = acessou o reader do ensinamento depois da criação
    //          da rec (cruzamento com access_logs no RPC v6).
    const seenLabel = r.seen_at
      ? `vista em ${new Date(r.seen_at).toLocaleDateString('pt-BR')}`
      : 'não vista';
    const seenColor = r.seen_at ? 'var(--text-muted)' : 'var(--accent)';
    const readHtml = r.read_at
      ? ` <span style="opacity:0.4;">·</span> <span style="color:#2c8a3e;" title="Acessou o ensinamento em ${new Date(r.read_at).toLocaleString('pt-BR')}">📖 lida em ${new Date(r.read_at).toLocaleDateString('pt-BR')}</span>`
      : '';
    const noteHtml = r.note ? `<div style="font-size:0.78rem; color:var(--text-muted); margin-top:4px; font-style:italic;">"${_escHtml(r.note)}"</div>` : '';
    const created = new Date(r.created_at).toLocaleDateString('pt-BR');

    let stateTag = '';
    if (archived) {
      const archDate = new Date(r.archived_at).toLocaleDateString('pt-BR');
      stateTag = ` <span title="Usuário arquivou em ${archDate}" style="display:inline-block; font-size:0.65rem; font-weight:600; padding:1px 6px; border-radius:3px; background:rgba(150,150,150,0.18); color:var(--text-muted); margin-left:6px;">📁 arquivada por usuário</span>`;
    } else if (expired) {
      const expDate = new Date(r.expires_at).toLocaleDateString('pt-BR');
      stateTag = ` <span title="Prazo expirou em ${expDate}" style="display:inline-block; font-size:0.65rem; font-weight:600; padding:1px 6px; border-radius:3px; background:rgba(150,150,150,0.18); color:var(--text-muted); margin-left:6px;">⏱ expirada</span>`;
    }

    let expiresHtml = '';
    if (r.expires_at && !expired && !archived) {
      const daysLeft = Math.ceil((new Date(r.expires_at) - now) / 86400000);
      const lbl = daysLeft === 1 ? 'expira amanhã' : `expira em ${daysLeft} dias`;
      const c = daysLeft <= 3 ? '#c80' : 'var(--text-muted)';
      expiresHtml = ` · <span style="color:${c};">⏱ ${lbl}</span>`;
    }

    const cardStyle = inactive
      ? 'padding:10px 12px; background:transparent; border:1px dashed var(--border); border-radius:5px; opacity:0.7;'
      : 'padding:10px 12px; background:var(--surface, var(--bg)); border:1px solid var(--border); border-radius:5px;';

    return `
      <div style="${cardStyle}">
        <div style="display:flex; align-items:flex-start; gap:8px;">
          <div style="flex:1;">
            <div style="font-size:0.88rem; font-weight:500;">${_escHtml(title)}${stateTag}</div>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${VOL_SHORT[r.vol] || r.vol} · ${_escHtml(r.file)}#${r.topic_idx} · criado ${created} · <span style="color:${seenColor};">${seenLabel}</span>${readHtml}${expiresHtml}</div>
            ${noteHtml}
          </div>
          <button onclick="recDelete('${_escHtml(r.id)}')" style="background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 10px; font-size:0.7rem; border-radius:3px; cursor:pointer;" title="Apagar permanentemente">✕</button>
        </div>
      </div>
    `;
  }).join('') + '</div>';
}

function recDebounceTeachingSearch() {
  clearTimeout(_recTeachingSearchTimer);
  _recTeachingSearchTimer = setTimeout(recRunTeachingSearch, 220);
}

async function recRunTeachingSearch() {
  const q = (document.getElementById('rec-teaching-search')?.value || '').trim();
  const sug = document.getElementById('rec-teaching-suggestions');
  if (q.length < 2) {
    sug.style.display = 'none';
    sug.innerHTML = '';
    return;
  }
  const { data, error } = await supabase.rpc('suggest_teachings', { q, lang: 'pt' });
  if (error || !data || data.length === 0) {
    sug.innerHTML = '<div style="padding:10px 12px; color:var(--text-muted); font-size:0.8rem;">Nenhum resultado.</div>';
    sug.style.display = 'block';
    return;
  }
  sug.innerHTML = data.map(s => {
    const title = s.title_pt || '(sem título)';
    const idx = s.topic_idx != null ? s.topic_idx : 0;
    // Encoded payload pra evitar problemas de quote.
    const payload = encodeURIComponent(JSON.stringify({
      vol: s.vol, file: s.file, topic_idx: idx,
      title_pt: title, title_ja: s.title_ja || '',
    }));
    return `
      <div onclick="recPickTeaching('${payload}')" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border); font-size:0.83rem;" onmouseover="this.style.background='var(--accent-soft, rgba(184,134,11,0.08))'" onmouseout="this.style.background=''">
        <div>${_escHtml(title)}</div>
        <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${VOL_SHORT[s.vol] || s.vol} · ${_escHtml(s.file)}#${idx}</div>
      </div>
    `;
  }).join('');
  sug.style.display = 'block';
}

function recPickTeaching(payload) {
  try {
    _recPickedTeaching = JSON.parse(decodeURIComponent(payload));
  } catch (e) { return; }
  const picked = document.getElementById('rec-teaching-picked');
  picked.innerHTML = `<strong>${_escHtml(_recPickedTeaching.title_pt)}</strong> <span style="color:var(--text-muted);">(${VOL_SHORT[_recPickedTeaching.vol] || _recPickedTeaching.vol} · ${_escHtml(_recPickedTeaching.file)}#${_recPickedTeaching.topic_idx})</span>`;
  picked.style.display = 'block';
  document.getElementById('rec-teaching-suggestions').style.display = 'none';
  document.getElementById('rec-teaching-search').value = '';
  // "Recomendar" precisa de user selecionado + ensinamento.
  // "Para todos" só precisa do ensinamento.
  document.getElementById('rec-create-btn').disabled = !_recSelectedUser;
  document.getElementById('rec-create-all-btn').disabled = false;
}

function recClearForm() {
  _recPickedTeaching = null;
  const picked = document.getElementById('rec-teaching-picked');
  if (picked) { picked.style.display = 'none'; picked.innerHTML = ''; }
  const sug = document.getElementById('rec-teaching-suggestions');
  if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; }
  const search = document.getElementById('rec-teaching-search');
  if (search) search.value = '';
  const note = document.getElementById('rec-note').value = '';
  const expires = document.getElementById('rec-expires');
  if (expires) expires.value = '';
  const btn = document.getElementById('rec-create-btn');
  if (btn) btn.disabled = true;
  const btnAll = document.getElementById('rec-create-all-btn');
  if (btnAll) btnAll.disabled = true;
}

// Lê o select de prazo e devolve uma timestamp ISO ou null.
function _recExpiresIso() {
  const days = parseInt(document.getElementById('rec-expires')?.value || '0', 10);
  if (!days || days <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function recCreate() {
  if (!_recSelectedUser || !_recPickedTeaching) return;
  const note = document.getElementById('rec-note').value.trim();
  const btn = document.getElementById('rec-create-btn');
  btn.disabled = true;
  const { error } = await supabase.rpc('admin_create_recommendation', {
    p_user_id: _recSelectedUser.id,
    p_vol: _recPickedTeaching.vol,
    p_file: _recPickedTeaching.file,
    p_topic_idx: _recPickedTeaching.topic_idx,
    p_note: note || null,
    p_expires_at: _recExpiresIso(),
  });
  if (error) {
    alert('Erro: ' + error.message);
    btn.disabled = false;
    return;
  }
  recClearForm();
  recLoadList();
}

async function recCreateAll() {
  if (!_recPickedTeaching) return;
  const note = document.getElementById('rec-note').value.trim();
  const exp = _recExpiresIso();
  const expLabel = exp
    ? ' (auto-arquiva em ' + (document.getElementById('rec-expires').options[document.getElementById('rec-expires').selectedIndex].textContent.toLowerCase()) + ')'
    : '';
  const msg = `Recomendar "${_recPickedTeaching.title_pt}" pra TODOS os usuários cadastrados${expLabel}?\n\nCada usuário receberá uma cópia. Não dá pra desfazer em massa.`;
  if (!confirm(msg)) return;
  const btn = document.getElementById('rec-create-all-btn');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Enviando...';
  const { data, error } = await supabase.rpc('admin_create_recommendation_all', {
    p_vol: _recPickedTeaching.vol,
    p_file: _recPickedTeaching.file,
    p_topic_idx: _recPickedTeaching.topic_idx,
    p_note: note || null,
    p_expires_at: exp,
  });
  btn.textContent = orig;
  if (error) {
    alert('Erro: ' + error.message);
    btn.disabled = false;
    return;
  }
  alert(`Enviado pra ${data} usuário${data === 1 ? '' : 's'}.`);
  recClearForm();
  if (_recSelectedUser) recLoadList();
}

async function recDelete(recId) {
  if (!confirm('Apagar esta recomendação?')) return;
  const { error } = await supabase.rpc('admin_delete_recommendation', { p_id: recId });
  if (error) { alert('Erro: ' + error.message); return; }
  recLoadList();
}

// Fecha o dropdown de sugestões ao clicar fora.
document.addEventListener('click', (e) => {
  const sug = document.getElementById('rec-teaching-suggestions');
  const search = document.getElementById('rec-teaching-search');
  if (!sug || !search) return;
  if (sug.contains(e.target) || search.contains(e.target)) return;
  sug.style.display = 'none';
});

Object.assign(window, {
  loadRecommendationsTab,
  renderRecUserList,
  recSelectUser,
  recDebounceTeachingSearch,
  recPickTeaching,
  recClearForm,
  recCreate,
  recCreateAll,
  recDelete
});
