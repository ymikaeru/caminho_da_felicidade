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
  const [{ data, error }, listensRes] = await Promise.all([
    supabase.rpc('admin_get_user_recommendations', { p_user_id: _recSelectedUser.id }),
    supabase.rpc('admin_get_user_audio_listens', { p_user_id: _recSelectedUser.id }),
  ]);
  if (error) {
    container.innerHTML = `<div class="msg err">Erro: ${_escHtml(error.message)}</div>`;
    return;
  }
  const recs = data || [];
  // Escutas de áudio do usuário (audio_path → {max_percent, completed}) p/ o selo.
  const listenByPath = {};
  (listensRes && listensRes.data ? listensRes.data : []).forEach(l => { listenByPath[l.audio_path] = l; });
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
    const isAudio = !!r.audio_path;
    const isPoetry = r.vol === 'poetry';
    const title = isAudio
      ? `🎵 ${r.audio_title || '(áudio sem título)'}`
      : isPoetry
        ? `📜 ${r.poem_title || '(poema)'}`
        : (r.title_pt || '(sem título)');
    // Linha de referência: ensinamento mostra vol/file#topic; áudio
    // mostra "Áudio · <nome-do-arquivo>" (vol/file são nulos); poesia
    // mostra "Poesia · <coletânea>" (title vem de poem_title).
    const refLine = isAudio
      ? `Áudio${r.audio_path ? ' · ' + _escHtml(r.audio_path.split('/').pop()) : ''}`
      : isPoetry
        ? `Poesia · ${_escHtml(r.file)}`
        : `${VOL_SHORT[r.vol] || r.vol} · ${_escHtml(r.file)}#${r.topic_idx}`;
    const expired = r.expires_at && new Date(r.expires_at) <= now;
    const archived = !!r.archived_at;
    const inactive = expired || archived;

    // "vista" = abriu o modal de recs (mark_recommendations_seen).
    // "lida"  = acessou o reader do ensinamento depois da criação
    //          da rec (cruzamento com access_logs no RPC v6).
    const seenLabel = r.seen_at
      ? `vista em ${new Date(r.seen_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
      : 'não vista';
    const seenColor = r.seen_at ? 'var(--text-muted)' : 'var(--accent)';
    const readHtml = r.read_at
      ? ` <span style="opacity:0.4;">·</span> <span style="color:#2c8a3e;" title="Acessou o ensinamento em ${new Date(r.read_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}">📖 lida em ${new Date(r.read_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>`
      : '';
    const noteHtml = r.note ? `<div style="font-size:0.78rem; color:var(--text-muted); margin-top:4px; font-style:italic;">"${_escHtml(r.note)}"</div>` : '';
    const created = new Date(r.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    // Selo de escuta (só áudio): casa a rec com audio_listens pelo audio_path.
    // max_percent = ponto máximo alcançado (high-water mark).
    const listenHtml = isAudio ? (() => {
      const l = listenByPath[r.audio_path];
      if (!l || !l.max_percent) return ` <span style="opacity:0.4;">·</span> <span style="color:var(--accent);">🎧 não ouviu</span>`;
      if (l.completed || l.max_percent >= 95) return ` <span style="opacity:0.4;">·</span> <span style="color:#2c8a3e;" title="Chegou ao fim">🎧 ouviu completo</span>`;
      return ` <span style="opacity:0.4;">·</span> <span style="color:#c80;" title="Ponto máximo alcançado">🎧 ouviu ${l.max_percent}%</span>`;
    })() : '';

    let stateTag = '';
    if (archived) {
      const archDate = new Date(r.archived_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      stateTag = ` <span title="Usuário arquivou em ${archDate}" style="display:inline-block; font-size:0.65rem; font-weight:600; padding:1px 6px; border-radius:3px; background:rgba(150,150,150,0.18); color:var(--text-muted); margin-left:6px;">📁 arquivada por usuário</span>`;
    } else if (expired) {
      const expDate = new Date(r.expires_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
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
            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${refLine} · criado ${created} · <span style="color:${seenColor};">${seenLabel}</span>${readHtml}${listenHtml}${expiresHtml}</div>
            ${noteHtml}
          </div>
          <div style="display:flex; gap:6px; flex-shrink:0;">
            ${isAudio
              ? ''
              : isPoetry
                ? `<a href="${encodeURIComponent(r.file)}.html?poem=${encodeURIComponent(r.poem_topic_id || '')}&hl_scroll=1" target="_blank" rel="noopener" style="background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 10px; font-size:0.7rem; border-radius:3px; cursor:pointer; text-decoration:none; white-space:nowrap;" title="Abrir o poema numa nova aba">↗ Abrir</a>`
                : `<a href="reader.html?vol=${encodeURIComponent(r.vol)}&file=${encodeURIComponent(r.file)}&topic=${encodeURIComponent(r.topic_idx)}" target="_blank" rel="noopener" style="background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 10px; font-size:0.7rem; border-radius:3px; cursor:pointer; text-decoration:none; white-space:nowrap;" title="Abrir o ensinamento numa nova aba">↗ Abrir</a>`}
            <button onclick="recDelete('${_escHtml(r.id)}')" style="background:none; border:1px solid var(--border); color:var(--text-muted); padding:4px 10px; font-size:0.7rem; border-radius:3px; cursor:pointer;" title="Apagar permanentemente">✕</button>
          </div>
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

// ============================================================
// Recomendação de áudio (avulsa) — aba "Recomendar Áudio".
// O áudio mais recente fica GUARDADO (admin_get_current_audio, v13) e
// pode ser recomendado quantas vezes quiser sem re-upload. Subir um
// arquivo novo TROCA o guardado: apaga o anterior (linhas + arquivos do
// bucket privado `rec-audio`), mantendo o "1 áudio por vez". Envio em
// lote pros destinatários marcados. Bloco independente do ensinamento.
// ============================================================
const REC_AUDIO_BUCKET = 'rec-audio';
let _recAudioSelectedIds = new Set();
// Áudio guardado = a recomendação de áudio mais recente. Quando existe,
// o admin pode recomendá-lo de novo sem subir arquivo; só troca quando
// sobe um arquivo novo. { audio_path, audio_title, _url? } | null.
let _recCurrentAudio = null;

// Carrega a aba: garante allUsers, busca o áudio guardado e popula o
// checklist de destinatários.
async function loadRecommendAudioTab() {
  if (!Array.isArray(allUsers) || allUsers.length === 0) {
    const { data, error } = await supabase.rpc('admin_get_users');
    if (error) {
      const el = document.getElementById('rec-audio-user-list');
      if (el) el.innerHTML = `<div class="msg err" style="margin:12px;">Erro: ${_escHtml(error.message)}</div>`;
      return;
    }
    setAllUsers(data || []);
  }
  await _recLoadCurrentAudio();
  renderRecAudioUserList();
}

// Busca o áudio guardado via RPC (RLS impede ler recs de outros usuários
// no cliente) e minta uma signed URL pra prévia no player. Degrada de boa
// se a RPC não existir ainda (v13 não rodada) — só não mostra o guardado.
async function _recLoadCurrentAudio() {
  try {
    const { data, error } = await supabase.rpc('admin_get_current_audio');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    _recCurrentAudio = (row && row.audio_path) ? row : null;
    if (_recCurrentAudio) {
      const { data: signed } = await supabase.storage
        .from(REC_AUDIO_BUCKET).createSignedUrl(_recCurrentAudio.audio_path, 3600);
      _recCurrentAudio._url = signed ? signed.signedUrl : '';
    }
  } catch (e) {
    console.warn('[audio] não consegui carregar o áudio guardado:', e?.message || e);
    _recCurrentAudio = null;
  }
  _recRenderCurrentAudio();
}

// Renderiza o bloco "Áudio guardado" no topo da aba.
function _recRenderCurrentAudio() {
  const box = document.getElementById('rec-audio-current');
  if (!box) return;
  if (!_recCurrentAudio) {
    box.innerHTML = '<span style="color:var(--text-muted); font-size:0.82rem;">Nenhum áudio guardado ainda. Suba um arquivo abaixo para recomendar.</span>';
    return;
  }
  const t = _recCurrentAudio.audio_title || '(áudio sem título)';
  const url = _recCurrentAudio._url || '';
  // Título em cima, player numa linha própria (full-width, com teto no
  // desktop). Player nativo dentro de um flex-row encolhe demais no mobile
  // e o Chrome esconde a barra de progresso — por isso fica empilhado.
  box.innerHTML =
    `<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">` +
      `<div style="font-size:0.9rem; font-weight:600; color:var(--text-main);">🎵 ${_escHtml(t)}</div>` +
      `<button onclick="recRenameAudio()" style="background:none; border:1px solid var(--border); color:var(--text-muted); padding:3px 10px; font-size:0.72rem; border-radius:4px; cursor:pointer; white-space:nowrap;" title="Renomear o título do áudio guardado (não reenvia nada)">✏️ Renomear</button>` +
    `</div>` +
    (url ? `<audio controls preload="none" src="${_escHtml(url)}" style="display:block; width:100%; max-width:420px; margin-top:8px;"></audio>` : '') +
    `<div style="font-size:0.76rem; color:var(--text-muted); margin-top:8px;">Recomende este áudio quantas vezes quiser, para quem quiser, sem subir de novo. Para trocar, escolha um arquivo novo abaixo.</div>`;
}

// Renomeia o título do áudio guardado (RPC v14) — não toca no arquivo do
// Storage nem reenvia; atualiza o título para todos que já têm a recomendação.
// Usa edição inline (não prompt(), que alguns navegadores suprimem).
function recRenameAudio() {
  if (!_recCurrentAudio) return;
  const box = document.getElementById('rec-audio-current');
  if (!box) return;
  const atual = _recCurrentAudio.audio_title || '';
  box.innerHTML =
    `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">` +
      `<input id="rec-audio-rename-input" type="text" value="${_escHtml(atual)}" style="flex:1; min-width:240px; padding:7px 10px; font-size:0.9rem; border:1px solid var(--accent); border-radius:5px; background:var(--bg,#fff); color:inherit; box-sizing:border-box;">` +
      `<button onclick="recRenameAudioSave()" style="padding:7px 14px; font-size:0.82rem; background:var(--accent); color:#fff; border:none; border-radius:5px; cursor:pointer; font-weight:600;">Salvar</button>` +
      `<button onclick="recRenameAudioCancel()" style="padding:7px 12px; font-size:0.82rem; background:none; border:1px solid var(--border); color:var(--text-muted); border-radius:5px; cursor:pointer;">Cancelar</button>` +
    `</div>` +
    `<div id="rec-audio-rename-msg" style="font-size:0.78rem; min-height:1em; margin-top:6px; color:var(--text-muted);"></div>`;
  const inp = document.getElementById('rec-audio-rename-input');
  if (inp) { inp.focus(); inp.select(); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') recRenameAudioSave(); if (e.key === 'Escape') recRenameAudioCancel(); }); }
}

async function recRenameAudioSave() {
  const inp = document.getElementById('rec-audio-rename-input');
  const msg = document.getElementById('rec-audio-rename-msg');
  if (!inp || !_recCurrentAudio) return;
  const t = inp.value.trim();
  if (!t) { if (msg) { msg.style.color = '#c00'; msg.textContent = 'O título não pode ficar vazio.'; } return; }
  if (t === (_recCurrentAudio.audio_title || '')) { _recRenderCurrentAudio(); return; }
  if (msg) { msg.style.color = 'var(--text-muted)'; msg.textContent = 'Salvando...'; }
  const { data, error } = await supabase.rpc('admin_rename_current_audio', { p_title: t });
  if (error) { if (msg) { msg.style.color = '#c00'; msg.textContent = 'Erro: ' + error.message; } return; }
  _recCurrentAudio.audio_title = t;
  _recRenderCurrentAudio();
}

function recRenameAudioCancel() {
  _recRenderCurrentAudio();
}

function _recAudioFilteredUsers() {
  const q = (document.getElementById('rec-audio-user-search')?.value || '').toLowerCase();
  const users = allUsers || [];
  if (!q) return users.slice();
  return users.filter(u =>
    (u.display_name || '').toLowerCase().includes(q) ||
    (u.email || '').toLowerCase().includes(q));
}

function renderRecAudioUserList() {
  const container = document.getElementById('rec-audio-user-list');
  if (!container) return;
  const filtered = _recAudioFilteredUsers();
  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:0.82rem; text-align:center;">Nenhum usuário.</div>';
    recAudioValidate();
    return;
  }
  const prevScroll = container.scrollTop;
  container.innerHTML = filtered.slice(0, 600).map(u => {
    const sel = _recAudioSelectedIds.has(u.id);
    const bg = sel
      ? 'background:var(--accent-soft, rgba(184,134,11,0.12)); border-left:3px solid var(--accent);'
      : 'border-left:3px solid transparent;';
    const check = sel
      ? '<span style="display:inline-flex; align-items:center; justify-content:center; width:17px; height:17px; border-radius:4px; background:var(--accent); color:#fff; font-size:0.72rem; flex-shrink:0;">✓</span>'
      : '<span style="display:inline-block; width:17px; height:17px; border-radius:4px; border:1.5px solid var(--border); flex-shrink:0;"></span>';
    return `
      <div onclick="recAudioToggleUser('${_escHtml(u.id)}')" style="padding:7px 12px; cursor:pointer; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:9px; ${bg}">
        ${check}
        <div style="flex:1; min-width:0;">
          <div style="font-size:0.84rem; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_escHtml(u.display_name || 'Sem nome')}</div>
          <div style="font-size:0.7rem; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_escHtml(u.email || '—')}</div>
        </div>
      </div>`;
  }).join('');
  container.scrollTop = prevScroll;
  recAudioValidate();
}

function recAudioToggleUser(id) {
  if (_recAudioSelectedIds.has(id)) _recAudioSelectedIds.delete(id);
  else _recAudioSelectedIds.add(id);
  renderRecAudioUserList();
}

// "Selecionar todos" respeita o filtro de busca: marca todos os
// visíveis; se já estavam todos marcados, desmarca (vira toggle).
function recAudioToggleAll() {
  const visible = _recAudioFilteredUsers();
  if (visible.length === 0) return;
  const allSel = visible.every(u => _recAudioSelectedIds.has(u.id));
  if (allSel) visible.forEach(u => _recAudioSelectedIds.delete(u.id));
  else visible.forEach(u => _recAudioSelectedIds.add(u.id));
  renderRecAudioUserList();
}

// Habilita o botão (arquivo + título + ≥1 destinatário), atualiza o
// contador e o label do "Selecionar/Desmarcar todos".
function recAudioValidate() {
  const file = document.getElementById('rec-audio-file')?.files?.[0];
  const title = (document.getElementById('rec-audio-title')?.value || '').trim();
  const n = _recAudioSelectedIds.size;
  const btn = document.getElementById('rec-audio-create-btn');
  if (btn) {
    // Com arquivo novo: precisa de título. Sem arquivo: reusa o áudio
    // guardado (precisa existir). Sempre precisa de ≥1 destinatário.
    const ok = n > 0 && (file ? !!title : !!_recCurrentAudio);
    btn.disabled = !ok;
    btn.textContent = n > 1 ? `Recomendar áudio (${n})` : 'Recomendar áudio';
  }
  const count = document.getElementById('rec-audio-selcount');
  if (count) count.textContent = n === 0
    ? 'Nenhum selecionado'
    : (n === 1 ? '1 destinatário selecionado' : `${n} destinatários selecionados`);
  const selAll = document.getElementById('rec-audio-selall');
  if (selAll) {
    const visible = _recAudioFilteredUsers();
    const allSel = visible.length > 0 && visible.every(u => _recAudioSelectedIds.has(u.id));
    selAll.textContent = allSel ? 'Desmarcar todos' : 'Selecionar todos';
  }
}

// Lê o select de prazo do áudio e devolve ISO ou null.
function _recAudioExpiresIso() {
  const days = parseInt(document.getElementById('rec-audio-expires')?.value || '0', 10);
  if (!days || days <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// Sobe o arquivo no bucket privado e devolve o PATH (não a URL —
// o cliente do usuário minta uma signed URL ao renderizar). Path
// único via UUID pra evitar colisão.
async function _recUploadAudio(file) {
  const ext = (file.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
  const path = `audio/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(REC_AUDIO_BUCKET).upload(path, file, {
    contentType: file.type || 'audio/mpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

// "1 áudio por vez": apaga as recomendações do(s) áudio(s) anterior(es)
// e remove os arquivos antigos do bucket (libera espaço, inclusive
// órfãos de envios passados), preservando só o recém-enviado.
// Não-fatal: qualquer falha aqui é logada mas não derruba o envio.
async function _recPurgePreviousAudio(keepPath) {
  try {
    await supabase.rpc('admin_purge_other_audio_recommendations', { p_keep_path: keepPath });
  } catch (e) {
    console.warn('[audio] purge das recomendações antigas falhou:', e?.message || e);
  }
  try {
    const { data: files } = await supabase.storage.from(REC_AUDIO_BUCKET).list('audio', { limit: 1000 });
    const keepName = (keepPath || '').split('/').pop();
    const toRemove = (files || [])
      .filter(f => f.name && f.name !== keepName)
      .map(f => `audio/${f.name}`);
    if (toRemove.length) await supabase.storage.from(REC_AUDIO_BUCKET).remove(toRemove);
  } catch (e) {
    console.warn('[audio] limpeza do bucket falhou:', e?.message || e);
  }
}

// Recomenda áudio. O modo é decidido pela presença de um arquivo:
//   • COM arquivo  → sobe o novo, envia e TROCA o guardado: apaga o
//     anterior (linhas + arquivos do Storage). "Apaga só quando sobe um novo."
//   • SEM arquivo  → reusa o áudio guardado: só envia. Não sobe nada,
//     não apaga nada. "Recomende quantas vezes quiser."
async function recCreateAudio() {
  const file = document.getElementById('rec-audio-file')?.files?.[0];
  const ids = Array.from(_recAudioSelectedIds);
  if (ids.length === 0) return;

  // Resolve o áudio a enviar (novo upload x guardado).
  let path, title;
  const replacing = !!file;
  if (replacing) {
    title = document.getElementById('rec-audio-title').value.trim();
    if (!title) return;
  } else {
    if (!_recCurrentAudio) return;
    path = _recCurrentAudio.audio_path;
    title = _recCurrentAudio.audio_title || '';
  }

  if (ids.length >= 10 && !confirm(`Recomendar "${title || 'o áudio guardado'}" pra ${ids.length} usuários?\n\nCada um recebe uma cópia. Não dá pra desfazer em massa.`)) return;
  const note = document.getElementById('rec-audio-note').value.trim();
  const msg = document.getElementById('rec-audio-msg');
  const btn = document.getElementById('rec-audio-create-btn');
  btn.disabled = true;
  msg.style.color = 'var(--text-muted)';
  msg.textContent = (replacing ? 'Subindo e enviando' : 'Enviando o áudio guardado')
    + ` pra ${ids.length} usuário${ids.length === 1 ? '' : 's'}...`;
  try {
    if (replacing) path = await _recUploadAudio(file);
    const { data, error } = await supabase.rpc('admin_create_audio_recommendations_bulk', {
      p_user_ids: ids,
      p_audio_path: path,
      p_audio_title: title,
      p_note: note || null,
      p_expires_at: _recAudioExpiresIso(),
    });
    if (error) throw error;
    // Só ao TROCAR: apaga as recomendações e os arquivos do áudio
    // anterior (libera espaço). Não-fatal — não bloqueia o sucesso.
    if (replacing) await _recPurgePreviousAudio(path);
    const created = typeof data === 'number' ? data : ids.length;
    recClearAudioForm();           // limpa arquivo/título/nota/prazo/seleção
    await _recLoadCurrentAudio();   // re-renderiza o "áudio guardado"
    msg.style.color = '#2c8a3e';
    msg.textContent = `✓ Enviado pra ${created} usuário${created === 1 ? '' : 's'}`
      + (replacing ? ' — áudio guardado (anterior substituído).' : '.');
  } catch (e) {
    msg.style.color = '#c00';
    msg.textContent = 'Erro: ' + (e.message || String(e));
    recAudioValidate();
  }
}

function recClearAudioForm() {
  const file = document.getElementById('rec-audio-file');
  if (file) file.value = '';
  const title = document.getElementById('rec-audio-title');
  if (title) title.value = '';
  const note = document.getElementById('rec-audio-note');
  if (note) note.value = '';
  const expires = document.getElementById('rec-audio-expires');
  if (expires) expires.value = '';
  const search = document.getElementById('rec-audio-user-search');
  if (search) search.value = '';
  _recAudioSelectedIds.clear();
  renderRecAudioUserList();
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
  recDelete,
  loadRecommendAudioTab,
  renderRecAudioUserList,
  recAudioToggleUser,
  recAudioToggleAll,
  recAudioValidate,
  recCreateAudio,
  recClearAudioForm,
  recRenameAudio,
  recRenameAudioSave,
  recRenameAudioCancel
});
