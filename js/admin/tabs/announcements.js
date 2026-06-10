// ============================================================
// Announcements (landing CMU)
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escapeCmu } from '../shared/helpers.js';

// ── Markup da aba (movido de admin-supabase.html p/ manter o HTML enxuto) ──
// Injetado no import do módulo: roda antes do corpo de admin.js (imports são
// hoisted) e antes de qualquer interação — o DOM final é idêntico ao antigo.
const _TAB_MARKUP = `
              <!-- Preview: espelha .comunicado-* da landing (css/landing.css do repo ymikaeru.github.io) -->
              <style>
                /* Layout: editor (esq) · preview (dir) — substitui o flex genérico do add-user-form */
                #tab-announcements .ann-editor-layout {
                  display: flex;
                  gap: 28px;
                  align-items: flex-start;
                  flex-wrap: wrap;
                }

                #tab-announcements .ann-editor-col {
                  flex: 1 1 340px;
                  min-width: 300px;
                  display: flex;
                  flex-direction: column;
                  gap: 14px;
                }

                #tab-announcements .ann-preview-col {
                  flex: 2 1 460px;
                  min-width: 300px;
                }

                #tab-announcements .ann-editor-col label {
                  display: block;
                  font-size: .8rem;
                  font-weight: 500;
                  color: var(--text-muted);
                  margin-bottom: 4px;
                }

                #tab-announcements .ann-editor-col input[type=text] {
                  width: 100%;
                  box-sizing: border-box;
                  padding: 8px 10px;
                  border: 1px solid var(--border);
                  border-radius: 6px;
                  background: var(--surface, #fff);
                  color: var(--text);
                  font-family: inherit;
                  font-size: .9rem;
                }

                .ann-preview-head {
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: 12px;
                  flex-wrap: wrap;
                  margin-bottom: 8px;
                }

                .ann-preview-label {
                  font-size: .8rem;
                  font-weight: 500;
                  color: var(--text-muted);
                }

                .ann-device-bar {
                  display: inline-flex;
                  gap: 4px;
                }

                .ann-device-btn {
                  padding: 4px 10px;
                  border: 1px solid var(--border);
                  border-radius: 6px;
                  background: var(--surface, #fff);
                  color: var(--text-muted);
                  font-size: .78rem;
                  cursor: pointer;
                }

                .ann-device-btn:hover {
                  border-color: var(--accent);
                  color: var(--text);
                }

                .ann-device-btn.is-active {
                  background: var(--accent);
                  border-color: var(--accent);
                  color: var(--surface, #fff);
                  font-weight: 600;
                }

                .ann-skin-bar {
                  display: flex;
                  gap: 6px;
                  flex-wrap: wrap;
                  align-items: center;
                }

                .ann-skin-btn {
                  padding: 5px 12px;
                  border: 1px solid var(--border);
                  border-radius: 6px;
                  background: var(--surface, #fff);
                  color: var(--text-muted);
                  font-size: .8rem;
                  cursor: pointer;
                }

                .ann-skin-btn:hover {
                  border-color: var(--accent);
                  color: var(--text);
                }

                .ann-skin-btn.is-active {
                  background: var(--accent);
                  border-color: var(--accent);
                  color: var(--surface, #fff);
                  font-weight: 600;
                }

                #ann-preview-viewport {
                  background: rgba(0, 0, 0, .02);
                  border: 1px solid var(--border);
                  border-radius: 10px;
                  padding: 16px;
                  overflow-x: auto;
                }

                /* Painel do comunicado — espelha .comunicados-* da landing (css/landing.css de ymikaeru.github.io) */
                #ann-preview-wrap {
                  box-sizing: border-box;
                  width: 100%;
                  max-width: 1040px;
                  margin: 0 auto;
                  background: var(--surface, #fff);
                  border: 1px solid var(--border);
                  border-radius: 12px;
                  box-shadow: 0 1px 3px rgba(0, 0, 0, .06);
                  padding: 1.75rem 2rem;
                  transition: max-width .18s ease;
                }

                #ann-preview-wrap .comunicados-titulo {
                  font-family: 'Outfit', sans-serif;
                  font-size: .74rem;
                  font-weight: 600;
                  letter-spacing: .26em;
                  text-transform: uppercase;
                  color: var(--accent);
                  display: flex;
                  align-items: center;
                  gap: .65rem;
                  margin: 0 0 1.5rem;
                }

                #ann-preview-wrap .comunicados-titulo::before {
                  content: '';
                  width: 28px;
                  height: 1.5px;
                  background: var(--accent);
                  flex: none;
                }

                #ann-preview-wrap .comunicado-item+.comunicado-item {
                  margin-top: 1.9rem;
                }

                #ann-preview-wrap .comunicado-kicker {
                  font-family: 'Outfit', sans-serif;
                  font-size: .72rem;
                  font-weight: 600;
                  letter-spacing: .26em;
                  text-transform: uppercase;
                  color: var(--accent);
                  margin: 0 0 .7rem;
                }

                #ann-preview-wrap .comunicado-titulo {
                  font-family: 'Crimson Pro', Georgia, serif;
                  font-size: 1.55rem;
                  font-weight: 500;
                  letter-spacing: -.015em;
                  line-height: 1.15;
                  margin: 0 0 .65rem;
                }

                #ann-preview-wrap .comunicado-titulo:empty {
                  display: none;
                }

                #ann-preview-wrap.comunicados--solo .comunicado-titulo {
                  padding-bottom: 1.1rem;
                  margin-bottom: 1.1rem;
                  border-bottom: 1px solid var(--border);
                }

                #ann-preview-wrap .comunicado-body p {
                  font-size: 1rem;
                  line-height: 1.65;
                  color: var(--text);
                  margin: 0 0 .7rem;
                }

                #ann-preview-wrap .comunicado-body p:last-child {
                  margin-bottom: 0;
                }

                #ann-preview-wrap .comunicado-body em {
                  font-family: 'Crimson Pro', Georgia, serif;
                  font-style: italic;
                  font-size: 1.06em;
                  line-height: 1.4;
                }

                #ann-preview-wrap .comunicado-body strong {
                  font-weight: 600;
                }

                /* skins globais (classe no próprio wrap) */
                #ann-preview-wrap.comunicados--a .comunicado-titulo {
                  color: var(--text);
                }

                #ann-preview-wrap.comunicados--a .comunicado-item+.comunicado-item {
                  padding-top: 1.9rem;
                  border-top: 1px solid var(--border);
                }

                #ann-preview-wrap.comunicados--b .comunicado-titulo {
                  color: var(--accent);
                }

                #ann-preview-wrap.comunicados--b .comunicado-item+.comunicado-item {
                  padding-top: 1.9rem;
                  border-top: 1px solid var(--border);
                }

                #ann-preview-wrap.comunicados--c .comunicado-item {
                  border-left: 3px solid var(--accent);
                  padding-left: 1.5rem;
                }

                #ann-preview-wrap.comunicados--c .comunicado-titulo {
                  color: var(--text);
                }

                /* Estado mobile — espelha a media query dos comunicados na landing */
                #ann-preview-wrap.dev-mobile {
                  padding: 1.5rem 1.25rem;
                }

                #ann-preview-wrap.dev-mobile.comunicados--c .comunicado-item {
                  padding-left: 1.1rem;
                }

                #ann-preview-wrap.dev-mobile .comunicado-titulo {
                  font-size: 1.35rem;
                }
              </style>
              <div style="margin-bottom:24px;">
                <h2
                  style="margin:0 0 4px; font-size:1rem; font-weight:600; color:var(--accent); letter-spacing:1px; text-transform:uppercase;">
                  Comunicados</h2>
                <p style="font-size:0.85rem; color:var(--text-muted); margin:0;">Avisos exibidos na landing pública
                  quando
                  ativos.</p>
              </div>
              <div class="admin-section">
                <h2 id="ann-form-title">Novo Comunicado</h2>
                <div class="ann-editor-layout">
                  <!-- Editor (esquerda) -->
                  <div class="ann-editor-col">
                    <div class="form-group">
                      <label for="ann-title">Título</label>
                      <input type="text" id="ann-title" placeholder="Ex: Evento especial no domingo">
                    </div>
                    <div class="form-group">
                      <label for="ann-body">Corpo (use linha em branco para separar parágrafos)</label>
                      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
                        <button type="button" onclick="annBold()" title="Negrito — selecione um trecho e clique"
                          style="padding:3px 11px; border:1px solid var(--border); border-radius:6px; background:var(--surface,#fff); color:var(--text); font-weight:700; cursor:pointer;">B</button>
                        <button type="button" onclick="annItalic()" title="Itálico — selecione um trecho e clique"
                          style="padding:3px 13px; border:1px solid var(--border); border-radius:6px; background:var(--surface,#fff); color:var(--text); font-style:italic; font-family:serif; font-size:1.05rem; cursor:pointer;">I</button>
                        <span style="font-size:0.78rem; color:var(--text-muted);">Selecione e clique <strong>B</strong>
                          ou <em style="font-family:serif; font-size:1.05rem;">I</em> — ou <code>**negrito**</code> /
                          <code>*itálico*</code>.</span>
                      </div>
                      <textarea id="ann-body" rows="9"
                        style="width:100%; box-sizing:border-box; padding:8px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:0.9rem; background:var(--surface, #fff); color:var(--text); resize:vertical;"
                        placeholder="Texto do comunicado..."></textarea>
                    </div>
                    <div class="form-group">
                      <label><input type="checkbox" id="ann-active" checked> Ativo (visível no site)</label>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                      <button id="ann-add-btn" onclick="saveAnnouncement()">Publicar</button>
                      <button id="ann-cancel-btn" onclick="resetAnnouncementForm()"
                        style="display:none; padding:9px 16px; border:1px solid var(--border); border-radius:8px; background:none; color:var(--text-muted); font-size:0.9rem; cursor:pointer;">Cancelar
                        edição</button>
                    </div>
                  </div>
                  <!-- Preview (direita) -->
                  <div class="ann-preview-col">
                    <div class="ann-preview-head">
                      <span class="ann-preview-label">Pré-visualização <span style="font-weight:400;">— como aparece na
                          landing</span></span>
                      <div class="ann-device-bar" role="group" aria-label="Tamanho do preview">
                        <button type="button" class="ann-device-btn" data-device="mobile"
                          onclick="setAnnPreviewDevice('mobile')" title="Celular — 390px">📱 Mobile</button>
                        <button type="button" class="ann-device-btn" data-device="tablet"
                          onclick="setAnnPreviewDevice('tablet')" title="Tablet — 768px">▭ Tablet</button>
                        <button type="button" class="ann-device-btn is-active" data-device="desktop"
                          onclick="setAnnPreviewDevice('desktop')" title="Desktop — largo">🖥 Desktop</button>
                      </div>
                    </div>
                    <div class="ann-skin-bar" role="group" aria-label="Skin dos comunicados" style="margin-bottom:8px;">
                      <span style="font-size:.78rem; color:var(--text-muted); margin-right:2px;">Skin (vale pra
                        todos):</span>
                      <button type="button" class="ann-skin-btn" data-skin="a" onclick="setAnnSkin('a')"
                        title="Títulos em tinta, itens separados por linha">A · tinta</button>
                      <button type="button" class="ann-skin-btn" data-skin="b" onclick="setAnnSkin('b')"
                        title="Títulos dourados">B · dourado</button>
                      <button type="button" class="ann-skin-btn is-active" data-skin="c" onclick="setAnnSkin('c')"
                        title="Filete lateral dourado">C · filete</button>
                      <span id="ann-skin-msg" style="font-size:.75rem; margin-left:6px;"></span>
                    </div>
                    <div id="ann-preview-viewport">
                      <div id="ann-preview-wrap" class="dev-desktop comunicados--c comunicados--solo">
                        <article class="comunicado-item" id="ann-prev-article">
                          <div class="comunicado-kicker" id="ann-prev-kicker">Comunicado</div>
                          <h3 class="comunicado-titulo" id="ann-prev-title"></h3>
                          <div class="comunicado-body" id="ann-prev-body"></div>
                        </article>
                        <div id="ann-prev-empty" style="color:var(--text-muted); font-size:.88rem;">Comece a escrever —
                          o preview aparece aqui.</div>
                      </div>
                    </div>
                    <p style="font-size:.74rem; color:var(--text-muted); margin:8px 2px 0;">Preview de <strong>1
                        comunicado</strong> (rótulo "Comunicado" no item). Com 2+ ativos, a landing mostra um único
                      título "Comunicados" no topo e os itens sem repetir o rótulo.</p>
                  </div>
                </div>
                <div id="ann-msg" class="msg"></div>
              </div>
              <div class="admin-section">
                <h2>Publicações <span id="ann-count"
                    style="font-weight:400; color:var(--text-muted); font-size:0.85rem;"></span></h2>
                <div id="ann-list">
                  <div class="loading">Carregando...</div>
                </div>
              </div>
            `;
{
  const _tabEl = document.getElementById('tab-announcements');
  if (_tabEl && !_tabEl.firstElementChild) _tabEl.innerHTML = _TAB_MARKUP;
}

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
