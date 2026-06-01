// ============================================================
// Announcements (landing CMU)
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escapeCmu } from '../shared/helpers.js';

let _editingAnnId = null;
let _announcementsMap = {};
let _annSkin = 'c'; // skin GLOBAL dos comunicados (a/b/c) — vale pra todos

// ── Pré-visualização ──────────────────────────────────────────
// Espelha a renderização da landing (js/landing.js do repo ymikaeru.github.io:
// formatarBody / aplicarFormatacao / escapar). Mantenha em sincronia se a
// landing mudar as regras: parágrafos por linha em branco, **negrito** e
// *itálico*, com escape de HTML antes de tudo.
function _annEscapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function _annAplicarFormatacao(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}
function _annFormatarBody(texto) {
  return _annEscapar(texto || '')
    .split(/\n{2,}/)
    .map(p => `<p>${_annAplicarFormatacao(p.replace(/\n/g, '<br>'))}</p>`)
    .join('');
}
// Atualiza o preview a partir dos campos do form (título sem markdown, igual
// à landing; corpo com a formatação completa).
function renderAnnPreview() {
  const titleEl = document.getElementById('ann-prev-title');
  const bodyEl  = document.getElementById('ann-prev-body');
  if (!titleEl || !bodyEl) return;
  const title = (document.getElementById('ann-title')?.value || '').trim();
  const body  = (document.getElementById('ann-body')?.value || '').trim();
  titleEl.textContent = title;
  bodyEl.innerHTML = body ? _annFormatarBody(body) : '';
  const hasContent = !!(title || body);
  const kickerEl = document.getElementById('ann-prev-kicker');
  if (kickerEl) kickerEl.style.display = hasContent ? '' : 'none';
  const emptyEl = document.getElementById('ann-prev-empty');
  if (emptyEl) emptyEl.style.display = hasContent ? 'none' : '';
}
let _annPreviewWired = false;
function _wireAnnPreview() {
  if (_annPreviewWired) return;
  const t = document.getElementById('ann-title');
  const b = document.getElementById('ann-body');
  if (!t || !b) return;
  t.addEventListener('input', renderAnnPreview);
  b.addEventListener('input', renderAnnPreview);
  setAnnPreviewDevice('desktop');
  loadAnnSkin();
  _annPreviewWired = true;
}

// Larguras de simulação do preview (px). Troca o max-width do card e aplica
// o estado .dev-mobile (que espelha a media query dos comunicados na landing).
const _ANN_DEVICE_W = { mobile: 390, tablet: 768, desktop: 1040 };
function setAnnPreviewDevice(device) {
  const wrap = document.getElementById('ann-preview-wrap');
  if (!wrap) return;
  const w = _ANN_DEVICE_W[device] || _ANN_DEVICE_W.desktop;
  wrap.style.maxWidth = w + 'px';
  wrap.classList.remove('dev-mobile', 'dev-tablet', 'dev-desktop');
  wrap.classList.add('dev-' + device);
  document.querySelectorAll('.ann-device-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.device === device);
  });
}

// ── Skin GLOBAL dos comunicados (a/b/c) ───────────────────────
// Guardado em public.landing_config (id=1). A escolha vale pra TODOS os
// comunicados; a landing lê o mesmo registro e aplica .comunicados--X.
const _ANN_SKINS = ['a', 'b', 'c'];
function _applyAnnSkin(skin) {
  if (!_ANN_SKINS.includes(skin)) skin = 'c';
  _annSkin = skin;
  const wrap = document.getElementById('ann-preview-wrap');
  if (wrap) {
    wrap.classList.remove('comunicados--a', 'comunicados--b', 'comunicados--c');
    wrap.classList.add('comunicados--' + skin);
  }
  document.querySelectorAll('.ann-skin-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.skin === skin);
  });
}
async function loadAnnSkin() {
  try {
    const { data, error } = await supabase
      .from('landing_config').select('comunicados_skin').eq('id', 1).maybeSingle();
    _applyAnnSkin(!error && data ? data.comunicados_skin : 'c');
  } catch (e) {
    _applyAnnSkin('c');
  }
}
async function setAnnSkin(skin) {
  _applyAnnSkin(skin);
  const m = document.getElementById('ann-skin-msg');
  if (m) { m.textContent = 'Salvando…'; m.style.color = 'var(--text-muted)'; }
  const { error } = await supabase.from('landing_config')
    .upsert({ id: 1, comunicados_skin: _annSkin, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (!m) return;
  if (error) {
    m.textContent = /landing_config|relation|exist/i.test(error.message || '')
      ? 'Rode a migração landing_config.sql no Supabase.'
      : 'Erro: ' + error.message;
    m.style.color = '#c0392b';
  } else {
    m.textContent = '✓ Skin salvo — vale pra todos os comunicados';
    m.style.color = '#2c8a3e';
  }
}

function _collectAnnForm() {
  return {
    title:     document.getElementById('ann-title').value.trim(),
    body:      document.getElementById('ann-body').value.trim(),
    is_active: document.getElementById('ann-active').checked,
  };
}

function resetAnnouncementForm() {
  _editingAnnId = null;
  document.getElementById('ann-form-title').textContent = 'Novo Comunicado';
  document.getElementById('ann-title').value = '';
  document.getElementById('ann-body').value = '';
  document.getElementById('ann-active').checked = true;
  document.getElementById('ann-add-btn').textContent = 'Publicar';
  document.getElementById('ann-cancel-btn').style.display = 'none';
  const msg = document.getElementById('ann-msg');
  msg.className = 'msg';
  msg.textContent = '';
  renderAnnPreview();
}

function editAnnouncement(id) {
  const a = _announcementsMap[id];
  if (!a) return;
  _editingAnnId = id;
  document.getElementById('ann-form-title').textContent = 'Editando comunicado';
  document.getElementById('ann-title').value = a.title || '';
  document.getElementById('ann-body').value = a.body || '';
  document.getElementById('ann-active').checked = a.is_active;
  document.getElementById('ann-add-btn').textContent = 'Atualizar';
  document.getElementById('ann-cancel-btn').style.display = '';
  document.getElementById('ann-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  renderAnnPreview();
}

// Envolve a seleção do textarea em ** ** (negrito). Sem seleção, insere
// **** e posiciona o cursor no meio para o admin digitar.
function annBold() {
  const ta = document.getElementById('ann-body');
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
  const sel = v.slice(s, e);
  if (sel) {
    ta.value = v.slice(0, s) + '**' + sel + '**' + v.slice(e);
    ta.setSelectionRange(s + 2, e + 2);
  } else {
    ta.value = v.slice(0, s) + '****' + v.slice(s);
    ta.setSelectionRange(s + 2, s + 2);
  }
  renderAnnPreview();
  ta.focus();
}

// Envolve a seleção do textarea em * * (itálico). Sem seleção, insere
// ** e posiciona o cursor no meio para o admin digitar.
function annItalic() {
  const ta = document.getElementById('ann-body');
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
  const sel = v.slice(s, e);
  if (sel) {
    ta.value = v.slice(0, s) + '*' + sel + '*' + v.slice(e);
    ta.setSelectionRange(s + 1, e + 1);
  } else {
    ta.value = v.slice(0, s) + '**' + v.slice(s);
    ta.setSelectionRange(s + 1, s + 1);
  }
  renderAnnPreview();
  ta.focus();
}

async function saveAnnouncement() {
  const payload = _collectAnnForm();
  const msg = document.getElementById('ann-msg');
  if (!payload.title || !payload.body) {
    msg.className = 'msg err';
    msg.textContent = 'Título e corpo são obrigatórios.';
    return;
  }
  const btn = document.getElementById('ann-add-btn');
  btn.disabled = true;
  let error;
  if (_editingAnnId) {
    ({ error } = await supabase.from('announcements').update(payload).eq('id', _editingAnnId));
  } else {
    ({ error } = await supabase.from('announcements').insert(payload));
  }
  btn.disabled = false;
  if (error) {
    msg.className = 'msg err';
    msg.textContent = 'Erro: ' + error.message;
    return;
  }
  msg.className = 'msg ok';
  msg.textContent = _editingAnnId ? 'Comunicado atualizado.' : 'Comunicado publicado.';
  resetAnnouncementForm();
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
  if (_editingAnnId === id) resetAnnouncementForm();
  loadAnnouncements();
}

async function loadAnnouncements() {
  _wireAnnPreview();
  renderAnnPreview();
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
  _announcementsMap = {};
  (data || []).forEach(a => { _announcementsMap[a.id] = a; });
  count.textContent = `(${data.length})`;
  if (!data.length) {
    list.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">Nenhum comunicado publicado.</p>';
    return;
  }
  list.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Publicado</th><th>Título</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${data.map(a => {
          // Tira os marcadores ** e * só para o preview ficar legível na lista.
          const preview = (a.body || '').replace(/\*\*/g, '').replace(/\*/g, '');
          return `
          <tr>
            <td style="white-space:nowrap; font-variant-numeric:tabular-nums;">${new Date(a.published_at).toLocaleDateString('pt-BR')}</td>
            <td>
              <strong style="color:var(--accent);">${_escapeCmu(a.title)}</strong>
              <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px; max-width:480px;">${_escapeCmu(preview.slice(0, 140))}${preview.length > 140 ? '…' : ''}</div>
            </td>
            <td>
              <label style="display:inline-flex; gap:6px; align-items:center; cursor:pointer;">
                <input type="checkbox" ${a.is_active ? 'checked' : ''} onchange="toggleAnnouncement('${a.id}', this.checked)">
                ${a.is_active ? '<span style="color:var(--accent); font-size:0.8rem;">Ativo</span>' : '<span style="color:var(--text-muted); font-size:0.8rem;">Inativo</span>'}
              </label>
            </td>
            <td style="white-space:nowrap;">
              <button class="reset-btn" onclick="editAnnouncement('${a.id}')">Editar</button>
              <button class="delete-btn" onclick="deleteAnnouncement('${a.id}')">Excluir</button>
            </td>
          </tr>
        `;}).join('')}
      </tbody>
    </table>
  `;
}

Object.assign(window, {
  resetAnnouncementForm,
  editAnnouncement,
  annBold,
  annItalic,
  saveAnnouncement,
  toggleAnnouncement,
  deleteAnnouncement,
  loadAnnouncements,
  setAnnPreviewDevice,
  setAnnSkin
});
