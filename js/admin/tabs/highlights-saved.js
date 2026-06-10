// ============================================================
// Destaques + Salvos — visualização e gestão dos destaques e
// artigos salvos por usuário (admin). Compartilha padrão de UI
// (lista de usuários à esquerda + detalhes à direita).
// ============================================================
import { supabase } from '../../supabase-config.js';
import { fetchAll } from '../fetch-all.js';
import { _escHtml, logAdminAction, getFileTitle } from '../shared/helpers.js';
import { VOL_SHORT } from '../shared/constants.js';
import { allUsers, volumeCategories } from '../shared/state.js';

// ── Destaques Tab ─────────────────────────────────────────────
let _hlCountByUser = null; // Map<userId, number>

async function _loadHighlightCounts() {
  if (_hlCountByUser) return _hlCountByUser;
  const counts = new Map();
  try {
    // Traz só user_id (campo leve) — contagem client-side agrupada por usuário
    // (fetchAll: all-time já passa de 1000 linhas e o PostgREST truncaria)
    const { data, error } = await fetchAll(() => supabase.from('user_highlights').select('user_id'), 'updated_at');
    if (error) throw error;
    (data || []).forEach(h => counts.set(h.user_id, (counts.get(h.user_id) || 0) + 1));
  } catch (e) {
    console.warn('[_loadHighlightCounts] falhou:', e.message);
  }
  _hlCountByUser = counts;
  return counts;
}

async function initHlTab() {
  await _loadHighlightCounts();
  const q = (document.getElementById('hl-user-search')?.value || '').toLowerCase();
  const filtered = q
    ? allUsers.filter(u => (u.display_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
    : allUsers;
  renderHlUserList(filtered);
}

function filterHlUsers() {
  const q = document.getElementById('hl-user-search').value.toLowerCase();
  const filtered = allUsers.filter(u =>
    (u.display_name || '').toLowerCase().includes(q) ||
    (u.email || '').toLowerCase().includes(q)
  );
  renderHlUserList(filtered);
}

function renderHlUserList(users) {
  const container = document.getElementById('hl-user-list');
  if (!users || users.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:8px 0;">Nenhum usuário encontrado.</div>';
    return;
  }
  // Ordena: quem tem mais destaques aparece primeiro (facilita varredura)
  const counts = _hlCountByUser || new Map();
  const withCounts = users.map(u => ({ u, count: counts.get(u.id) || 0 }));
  withCounts.sort((a, b) => b.count - a.count);

  container.innerHTML = withCounts.map(({ u, count }) => {
    const active = count > 0;
    const badge = `<span title="${count} destaque${count !== 1 ? 's' : ''}" style="flex-shrink:0; display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; background:${active ? 'rgba(184,134,11,0.14)' : 'rgba(120,120,120,0.10)'}; color:${active ? 'var(--accent)' : 'var(--text-muted)'}; font-size:0.78rem; font-weight:700;">🖍 ${count}</span>`;
    return `
    <div class="user-row" onclick="loadUserHighlights('${u.id}', '${_escHtml(u.display_name || u.email || 'Usuário')}')">
      <div class="user-avatar">${(u.display_name || u.email || '?')[0].toUpperCase()}</div>
      <div class="user-info">
        <div class="user-name">${_escHtml(u.display_name || '')}</div>
        <div class="user-email">${_escHtml(u.email || '')}</div>
      </div>
      <div class="user-meta" style="flex-shrink:0; font-size:0.75rem; color:var(--text-muted); margin-left:auto;">${_escHtml(u.role || 'user')}</div>
      ${badge}
    </div>`;
  }).join('');
}

async function loadUserHighlights(userId, userName) {
  const container = document.getElementById('hl-results-container');
  const header = document.getElementById('hl-results-header');
  document.getElementById('hl-selected-name').textContent = userName;
  document.getElementById('hl-total-count').textContent = '';
  header.style.display = 'flex';
  container.innerHTML = '<div class="loading">Carregando destaques...</div>';
  // Guarda quem é o dono dos destaques pra usar no delete e no log
  window._currentHlUserId = userId;
  window._currentHlUserName = userName;
  // Scroll the highlights header into view so o admin não precisa rolar até o fim da lista de usuários
  header.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Ensure the volume→file→title map is loaded before rendering
  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
  }

  const { data, error } = await supabase
    .rpc('get_user_highlights_for_admin', { target_user_id: userId });

  if (error) {
    container.innerHTML = `<div class="msg err">Erro ao carregar: ${_escHtml(error.message)}</div>`;
    return;
  }

  const highlights = data || [];
  const poemCount = highlights.filter(h => h.volume === 'poetry').length;
  const hlCount = highlights.length - poemCount;
  const parts = [];
  if (hlCount > 0) parts.push(`${hlCount} destaque${hlCount !== 1 ? 's' : ''}`);
  if (poemCount > 0) parts.push(`${poemCount} poema${poemCount !== 1 ? 's' : ''} salvo${poemCount !== 1 ? 's' : ''}`);
  document.getElementById('hl-total-count').textContent = parts.join(' · ') || '0 destaques';

  if (highlights.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); font-size:0.9rem; padding:20px 0;">Nenhum destaque encontrado para este usuário.</div>';
    return;
  }

  const colorMap = {
    yellow: '#fff3a1', green: '#a8e6cf', blue: '#a0c4ff',
    pink: '#ffb3c6', purple: '#d4a5f5', orange: '#ffd6a5'
  };

  // Indexa cada destaque para o handler de clique poder recuperar texto/vol/file sem escape inline
  const indexed = highlights.map((h, i) => ({ ...h, _idx: i }));
  window._currentHlContext = indexed;

  // Agrupar por volume + arquivo
  const grouped = new Map();
  indexed.forEach(h => {
    const key = `${h.volume}__${h.file}`;
    if (!grouped.has(key)) grouped.set(key, { volume: h.volume, file: h.file, items: [] });
    grouped.get(key).items.push(h);
  });

  let html = '';
  for (const [, group] of grouped.entries()) {
    const volLabel = VOL_SHORT[group.volume] || group.volume;
    const fileLabel = getFileTitle(group.volume, group.file);
    const isPoetry = group.volume === 'poetry';
    const itemNoun = isPoetry
      ? (group.items.length === 1 ? 'poema salvo' : 'poemas salvos')
      : (group.items.length === 1 ? 'destaque' : 'destaques');
    html += `
      <div style="margin-bottom:28px;">
        <div style="font-weight:600; color:var(--accent); font-size:0.88rem; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:8px;" title="${_escHtml(group.file)}">
          <span style="background:rgba(184,134,11,0.12); border-radius:6px; padding:2px 8px; font-size:0.72rem; font-weight:700;">${_escHtml(volLabel)}</span>
          ${_escHtml(fileLabel)}
          <span style="font-weight:400; color:var(--text-muted); font-size:0.78rem; margin-left:auto;">${group.items.length} ${itemNoun}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${group.items.map(h => {
            const date = new Date(h.updated_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            if (isPoetry) {
              // Poemas salvos não têm cor (sempre yellow fixo) nem comentário;
              // mostra o número/seção e o texto do poema (original + tradução).
              const lines = (h.text || '').split(/\n+/);
              const orig = lines[0] || '';
              const trans = lines.slice(1).join(' ').trim();
              return `
                <div class="hl-card" data-hl-idx="${h._idx}" onclick="openHighlightInContext(${h._idx})" title="Clique para ver na coletânea" style="cursor:pointer; padding:10px 14px; background:var(--surface); border-radius:8px; border:1px solid var(--border); border-left:3px solid var(--accent); transition:transform 0.12s ease, box-shadow 0.12s ease, opacity 0.25s ease;">
                  ${h.topic_title ? `<div style="font-size:0.73rem; color:var(--text-muted); margin-bottom:6px; font-family:'Outfit',sans-serif; letter-spacing:0.04em;">${_escHtml(h.topic_title)}</div>` : ''}
                  ${orig ? `<div style="font-family:'Noto Serif JP',serif; font-size:0.95rem; line-height:1.7; color:var(--text); white-space:pre-line;">${_escHtml(orig)}</div>` : ''}
                  ${trans ? `<div style="font-family:'Crimson Pro',serif; font-style:italic; font-size:0.85rem; line-height:1.55; color:var(--text-muted); margin-top:4px;">${_escHtml(trans)}</div>` : ''}
                  <div style="display:flex; align-items:center; gap:10px; margin-top:8px;">
                    <span style="font-size:0.7rem; color:var(--text-muted); font-family:'Outfit',sans-serif;">${date}</span>
                    <button class="hl-delete-btn" onclick="event.stopPropagation(); deleteHighlightAt(${h._idx})" title="Apagar este poema salvo" style="margin-left:auto; padding:3px 9px; border:1px solid rgba(255,59,48,0.3); background:rgba(255,59,48,0.06); color:#ff3b30; border-radius:6px; font-size:0.72rem; font-weight:600; cursor:pointer; font-family:'Outfit',sans-serif;">🗑 Apagar</button>
                  </div>
                </div>
              `;
            }
            const bg = colorMap[h.color] || '#fff3a1';
            return `
              <div class="hl-card" data-hl-idx="${h._idx}" onclick="openHighlightInContext(${h._idx})" title="Clique para ver no contexto" style="cursor:pointer; border-left:4px solid ${bg}; padding:10px 14px; background:var(--surface); border-radius:0 8px 8px 0; border:1px solid var(--border); border-left-color:${bg}; transition:transform 0.12s ease, box-shadow 0.12s ease, opacity 0.25s ease;">
                ${h.topic_title ? `<div style="font-size:0.73rem; color:var(--text-muted); margin-bottom:4px; font-family:'Outfit',sans-serif;">${_escHtml(h.topic_title)}</div>` : ''}
                <div style="font-size:0.95rem; line-height:1.6; color:var(--text);">${_escHtml(h.text)}</div>
                ${h.comment ? `<div style="margin-top:6px; font-size:0.82rem; color:var(--text-muted); font-style:italic; font-family:'Outfit',sans-serif;">📝 ${_escHtml(h.comment)}</div>` : ''}
                <div style="display:flex; align-items:center; gap:10px; margin-top:8px;">
                  <span style="font-size:0.7rem; color:var(--text-muted); font-family:'Outfit',sans-serif;">${date}</span>
                  <button class="hl-delete-btn" onclick="event.stopPropagation(); deleteHighlightAt(${h._idx})" title="Apagar este destaque" style="margin-left:auto; padding:3px 9px; border:1px solid rgba(255,59,48,0.3); background:rgba(255,59,48,0.06); color:#ff3b30; border-radius:6px; font-size:0.72rem; font-weight:600; cursor:pointer; font-family:'Outfit',sans-serif;">🗑 Apagar</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

// Abre o destaque em um modal de LEITURA (não-editável), marcando a passagem
// com a cor original do usuário e rolando até ela.
function openHighlightInContext(idx) {
  // Lookup por _idx (não posição) — após deletes o array é filtrado
  const h = (window._currentHlContext || []).find(x => x._idx === idx);
  if (!h || !h.volume || !h.file) return;
  openHlReader(h.volume, h.file, {
    text: h.text || '',
    color: h.color || 'yellow',
    comment: h.comment || '',
    topicTitle: h.topic_title || ''
  });
}

function closeHlReader() {
  const m = document.getElementById('hl-reader-modal');
  if (m) m.classList.remove('open');
}

// Apaga um destaque do usuário (destaques que vazaram por bug, etc).
// Requer admin (RLS em user_highlights). Confirma antes, anima a remoção do
// card, atualiza contagens locais e registra a ação em admin_logs.
async function deleteHighlightAt(idx) {
  // Lookup por _idx (não posição) — após deletes o array é filtrado
  const h = (window._currentHlContext || []).find(x => x._idx === idx);
  if (!h) return;

  const uid = window._currentHlUserId;

  // Estratégia de identificação:
  //   1) id (UUID PK) — caminho padrão se o RPC devolver
  //   2) chave composta (user_id, volume, file, topic_id, start_char, end_char)
  //      — mesma unique constraint usada pelo client em sync.js
  const hasId        = !!h.id;
  const hasComposite = !!uid && h.volume != null && h.file != null
                    && h.topic_id != null && h.start_char != null && h.end_char != null;

  if (!hasId && !hasComposite) {
    const fields = Object.keys(h).filter(k => k !== '_idx').join(', ');
    console.error('[deleteHighlightAt] Faltam campos pra identificar o destaque. Disponíveis:', fields, h);
    alert(
      'Não foi possível identificar este destaque para apagar.\n\n' +
      'O RPC get_user_highlights_for_admin precisa devolver o campo "id" ' +
      '(ou pelo menos topic_id, start_char e end_char). Atualize a função no Supabase.\n\n' +
      'Campos disponíveis agora: ' + fields
    );
    return;
  }

  const preview = (h.text || '').slice(0, 80) + ((h.text || '').length > 80 ? '…' : '');
  if (!confirm(`Apagar este destaque?\n\n"${preview}"\n\nEsta ação não pode ser desfeita.`)) return;

  // Encontra o card e dá feedback de "apagando…"
  const card = document.querySelector(`.hl-card[data-hl-idx="${idx}"]`);
  const btn  = card?.querySelector('.hl-delete-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Apagando…'; }

  try {
    let q = supabase.from('user_highlights').delete({ count: 'exact' });
    if (hasId) {
      q = q.eq('id', h.id);
    } else {
      q = q.eq('user_id', uid)
           .eq('volume', h.volume)
           .eq('file', h.file)
           .eq('topic_id', h.topic_id)
           .eq('start_char', Number(h.start_char))
           .eq('end_char', Number(h.end_char));
    }
    const { error, count } = await q;
    if (error) throw error;
    if (count === 0) throw new Error('Nenhuma linha foi apagada (RLS bloqueou ou destaque já não existia).');

    // Anima a remoção do card
    if (card) {
      card.style.opacity = '0';
      card.style.pointerEvents = 'none';
      setTimeout(() => card.remove(), 250);
    }

    // Atualiza estado local: remove do contexto, ajusta contador no header
    window._currentHlContext = (window._currentHlContext || []).filter(x => x._idx !== idx);
    const remaining = window._currentHlContext.length;
    const countEl = document.getElementById('hl-total-count');
    if (countEl) countEl.textContent = `${remaining} destaque${remaining !== 1 ? 's' : ''}`;

    // Atualiza o badge na lista de usuários (o cache _hlCountByUser)
    if (uid && _hlCountByUser) {
      _hlCountByUser.set(uid, Math.max(0, (_hlCountByUser.get(uid) || 1) - 1));
      // Re-render da lista de usuários pra atualizar o badge
      const q2 = (document.getElementById('hl-user-search')?.value || '').toLowerCase();
      const filtered = q2
        ? allUsers.filter(u => (u.display_name || '').toLowerCase().includes(q2) || (u.email || '').toLowerCase().includes(q2))
        : allUsers;
      renderHlUserList(filtered);
    }

    // Se era o último, mostra estado vazio
    if (remaining === 0) {
      const container = document.getElementById('hl-results-container');
      if (container) container.innerHTML = '<div style="color:var(--text-muted); font-size:0.9rem; padding:20px 0;">Nenhum destaque restante para este usuário.</div>';
    }

    // Registra a ação
    logAdminAction('delete_highlight', {
      user_id: uid,
      user_name: window._currentHlUserName || '—',
      volume: h.volume,
      file: h.file,
      trecho: (h.text || '').slice(0, 120)
    });
  } catch (err) {
    console.error('[deleteHighlightAt]', err);
    alert(`Erro ao apagar destaque: ${err.message || err}`);
    if (btn) { btn.disabled = false; btn.textContent = '🗑 Apagar'; }
  }
}

// ── Salvos (favoritos) ──
let _favCountByUser = null; // Map<userId, number>

async function _loadFavoriteCounts() {
  if (_favCountByUser) return _favCountByUser;
  const counts = new Map();
  try {
    const { data, error } = await fetchAll(() => supabase.from('synced_favorites').select('user_id'));
    if (error) throw error;
    (data || []).forEach(f => counts.set(f.user_id, (counts.get(f.user_id) || 0) + 1));
  } catch (e) {
    console.warn('[_loadFavoriteCounts] falhou:', e.message);
  }
  _favCountByUser = counts;
  return counts;
}

async function initSavedTab() {
  await _loadFavoriteCounts();
  const q = (document.getElementById('sv-user-search')?.value || '').toLowerCase();
  const filtered = q
    ? allUsers.filter(u => (u.display_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
    : allUsers;
  renderSavedUserList(filtered);
}

function filterSavedUsers() {
  const q = document.getElementById('sv-user-search').value.toLowerCase();
  const filtered = allUsers.filter(u =>
    (u.display_name || '').toLowerCase().includes(q) ||
    (u.email || '').toLowerCase().includes(q)
  );
  renderSavedUserList(filtered);
}

function renderSavedUserList(users) {
  const container = document.getElementById('sv-user-list');
  if (!users || users.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:8px 0;">Nenhum usuário encontrado.</div>';
    return;
  }
  const counts = _favCountByUser || new Map();
  const withCounts = users.map(u => ({ u, count: counts.get(u.id) || 0 }));
  withCounts.sort((a, b) => b.count - a.count);

  container.innerHTML = withCounts.map(({ u, count }) => {
    const active = count > 0;
    const badge = `<span title="${count} salvo${count !== 1 ? 's' : ''}" style="flex-shrink:0; display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; background:${active ? 'rgba(184,134,11,0.14)' : 'rgba(120,120,120,0.10)'}; color:${active ? 'var(--accent)' : 'var(--text-muted)'}; font-size:0.78rem; font-weight:700;">🔖 ${count}</span>`;
    return `
    <div class="user-row" onclick="loadUserSaved('${u.id}', '${_escHtml(u.display_name || u.email || 'Usuário')}')">
      <div class="user-avatar">${(u.display_name || u.email || '?')[0].toUpperCase()}</div>
      <div class="user-info">
        <div class="user-name">${_escHtml(u.display_name || '')}</div>
        <div class="user-email">${_escHtml(u.email || '')}</div>
      </div>
      <div class="user-meta" style="flex-shrink:0; font-size:0.75rem; color:var(--text-muted); margin-left:auto;">${_escHtml(u.role || 'user')}</div>
      ${badge}
    </div>`;
  }).join('');
}

async function loadUserSaved(userId, userName) {
  const container = document.getElementById('sv-results-container');
  const header = document.getElementById('sv-results-header');
  document.getElementById('sv-selected-name').textContent = userName;
  document.getElementById('sv-total-count').textContent = '';
  header.style.display = 'flex';
  container.innerHTML = '<div class="loading">Carregando artigos salvos...</div>';
  header.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
  }

  const { data, error } = await fetchAll(() => supabase
    .from('synced_favorites')
    .select('volume, file, topic_index, topic_title, snippet, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false }), null);

  if (error) {
    container.innerHTML = `<div class="msg err">Erro ao carregar: ${_escHtml(error.message)}</div>`;
    return;
  }

  const favorites = data || [];
  document.getElementById('sv-total-count').textContent = `${favorites.length} salvo${favorites.length !== 1 ? 's' : ''}`;

  if (favorites.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); font-size:0.9rem; padding:20px 0;">Nenhum artigo salvo por este usuário.</div>';
    return;
  }

  // Agrupar por volume + arquivo
  const grouped = new Map();
  favorites.forEach(f => {
    const key = `${f.volume}__${f.file}`;
    if (!grouped.has(key)) grouped.set(key, { volume: f.volume, file: f.file, items: [] });
    grouped.get(key).items.push(f);
  });

  let html = '';
  for (const [, group] of grouped.entries()) {
    const volLabel = VOL_SHORT[group.volume] || group.volume;
    const fileLabel = getFileTitle(group.volume, group.file);
    html += `
      <div style="margin-bottom:28px;">
        <div style="font-weight:600; color:var(--accent); font-size:0.88rem; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:8px;" title="${_escHtml(group.file)}">
          <span style="background:rgba(184,134,11,0.12); border-radius:6px; padding:2px 8px; font-size:0.72rem; font-weight:700;">${_escHtml(volLabel)}</span>
          ${_escHtml(fileLabel)}
          <span style="font-weight:400; color:var(--text-muted); font-size:0.78rem; margin-left:auto;">${group.items.length} salvo${group.items.length !== 1 ? 's' : ''}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${group.items.map(f => {
            const date = f.created_at ? new Date(f.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
            return `
              <div style="padding:10px 14px; background:var(--surface); border-radius:8px; border:1px solid var(--border);">
                ${f.topic_title ? `<div style="font-size:0.82rem; color:var(--text); font-weight:600; margin-bottom:4px;">${_escHtml(f.topic_title)}</div>` : ''}
                ${f.snippet ? `<div style="font-size:0.85rem; line-height:1.55; color:var(--text-muted);">${_escHtml(f.snippet)}</div>` : ''}
                ${date ? `<div style="font-size:0.7rem; color:var(--text-muted); margin-top:8px; font-family:'Outfit',sans-serif;">${date}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

// Remove TODAS as cores/fontes inline do HTML legado dos ensinamentos
// (font color, bgcolor, color: nos style=""). Garante que o modal renderize
// tudo no tema padrão, sem depender de overrides CSS frágeis.
function _neutralizeContentHtml(html) {
  if (!html) return '';
  return String(html)
    // Atributos presentacionais HTML4
    .replace(/\s(?:color|bgcolor|face|size)\s*=\s*"[^"]*"/gi, '')
    .replace(/\s(?:color|bgcolor|face|size)\s*=\s*'[^']*'/gi, '')
    .replace(/\s(?:color|bgcolor|face|size)\s*=\s*[^\s>]+/gi, '')
    // Limpa color/background/font-* dentro de style=""
    .replace(/\sstyle\s*=\s*"([^"]*)"/gi, (_, css) => {
      const cleaned = css
        .replace(/(?:^|;)\s*(?:color|background|background-color|font-family|font-size)\s*:[^;]*/gi, '')
        .replace(/^\s*;+/, '').trim();
      return cleaned ? ` style="${cleaned}"` : '';
    })
    .replace(/\sstyle\s*=\s*'([^']*)'/gi, (_, css) => {
      const cleaned = css
        .replace(/(?:^|;)\s*(?:color|background|background-color|font-family|font-size)\s*:[^;]*/gi, '')
        .replace(/^\s*;+/, '').trim();
      return cleaned ? ` style='${cleaned}'` : '';
    });
}

// Modal de leitura: baixa o JSON do ensinamento, renderiza o lado PT em modo
// somente-leitura, marca o trecho destacado pelo usuário com a cor original e
// rola até a primeira ocorrência. Se não encontrar em PT, tenta JA.
async function openHlReader(vol, file, opts = {}) {
  const { text = '', color = 'yellow', comment = '', topicTitle = '' } = opts;
  const fileName = file.endsWith('.json') ? file : file + '.json';

  const modal    = document.getElementById('hl-reader-modal');
  const body     = document.getElementById('hl-reader-body');
  const titleEl  = document.getElementById('hl-reader-title');
  const metaEl   = document.getElementById('hl-reader-meta');
  const snipEl   = document.getElementById('hl-reader-snippet');

  // Garante que o mapa de títulos esteja carregado
  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) {}
  }

  titleEl.textContent = getFileTitle(vol, file);
  metaEl.textContent  = `${VOL_SHORT[vol] || vol} · ${fileName}`;

  // Mostra o snippet APENAS quando há comentário do usuário — caso contrário
  // o trecho destacado e o título já aparecem no corpo (evita poluição visual).
  if (comment) {
    snipEl.innerHTML = `📝 ${_escHtml(comment)}`;
    snipEl.style.display = 'block';
  } else {
    snipEl.style.display = 'none';
  }

  body.innerHTML = '<div class="hl-reader-msg">Baixando ensinamento…</div>';
  modal.classList.add('open');

  try {
    const { data, error } = await supabase.storage.from('teachings').download(`${vol}/${fileName}`);
    if (error) throw error;
    if (!data) throw new Error('Arquivo vazio ou indisponível.');

    const json = JSON.parse(await data.text());
    if (!json || !Array.isArray(json.themes)) throw new Error('Estrutura inesperada (sem themes).');

    // Renderiza PT (preferencial). Se PT estiver vazio para um tópico, cai pro JA.
    // Sem header próprio: o content_ptbr já traz seu próprio título + data, então
    // adicionar um header em maiúsculas duplicaria a informação.
    let html = '';
    json.themes.forEach((theme) => {
      (theme.topics || []).forEach((topic) => {
        const ptContent = topic.content_ptbr || topic.content_pt || '';
        const jaContent = topic.content || '';
        const useContent = (ptContent && ptContent.trim()) ? ptContent : jaContent;
        if (!useContent || !useContent.trim()) return;
        html += `
          <div class="hl-reader-topic">
            <div class="hl-reader-topic-content html-content">${_neutralizeContentHtml(useContent)}</div>
          </div>
        `;
      });
    });
    body.innerHTML = html || '<div class="hl-reader-msg">Sem conteúdo disponível neste ensinamento.</div>';

    // Marca a passagem destacada (texto puro, whitespace-insensitive).
    // A marca usa um tom único e sutil via CSS — sem refletir a cor escolhida
    // pelo usuário, para manter o modal visualmente limpo.
    if (text) {
      const blocks = body.querySelectorAll('.hl-reader-topic-content');
      let firstMark = null;
      for (const el of blocks) {
        const count = window._wrapAllMatchesInElement(el, text, 'hl-reader-mark');
        if (count > 0 && !firstMark) firstMark = el.querySelector('mark.hl-reader-mark');
      }

      if (firstMark) {
        setTimeout(() => firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
      } else {
        const warn = document.createElement('div');
        warn.className = 'hl-reader-warn';
        warn.innerHTML = 'Trecho destacado não foi localizado automaticamente. Use <b>Ctrl+F</b> para buscar.';
        body.insertBefore(warn, body.firstChild);
      }
    }
  } catch (err) {
    console.error('[openHlReader]', err);
    body.innerHTML = `<div class="hl-reader-msg" style="color:#c0392b;">Erro ao carregar: ${_escHtml(err.message || String(err))}</div>`;
  }
}

// ESC fecha o modal de leitura quando aberto
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const m = document.getElementById('hl-reader-modal');
  if (m && m.classList.contains('open')) closeHlReader();
});

// Hooks de inicialização das abas: chamados pelo switchTab() do admin.js.
// initHlTab/initSavedTab não eram window.* originalmente — eram funções
// locais. Mas switchTab as chamava via lookup global; pra preservar o
// contrato, registramos as duas.
Object.assign(window, {
  initHlTab,
  initSavedTab,
  filterHlUsers,
  loadUserHighlights,
  openHighlightInContext,
  closeHlReader,
  deleteHighlightAt,
  filterSavedUsers,
  loadUserSaved,
  openHlReader
});
