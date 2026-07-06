// ============================================================
// Poema da landing (public.landing_config id=1)
// Aba dedicada — antes vivia DENTRO da aba "Calendário", o que misturava dois
// assuntos. O admin grava aqui; a landing (js/landing.js de ymikaeru.github.io)
// lê o mesmo registro e mostra o poema no lugar da rotação automática por mês.
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escapeCmu } from '../shared/helpers.js';

// ── Markup da aba (injetado no import do módulo; padrão das demais abas) ──
const _TAB_MARKUP = `
              <div style="margin-bottom:24px;">
                <h2
                  style="margin:0 0 4px; font-size:1rem; font-weight:600; color:var(--accent); letter-spacing:1px; text-transform:uppercase;">
                  Poema da landing</h2>
                <p style="font-size:0.85rem; color:var(--text-muted); margin:0;">O poema em destaque acima do
                  calendário na landing pública (cmu.org.br).</p>
              </div>
              <div class="admin-section">
                <p style="font-size:0.82rem; color:var(--text-muted); margin:0 0 18px;">Por padrão a landing mostra um
                  poema "Yama to Mizu" que gira por mês. Ative abaixo para fixar um poema específico no lugar da
                  rotação.</p>
                <div style="display:flex; flex-wrap:wrap; gap:24px; align-items:flex-start;">
                  <div style="flex:1 1 360px; min-width:300px; display:flex; flex-direction:column; gap:12px;">
                    <label style="display:flex; gap:8px; align-items:center; font-size:0.9rem; color:var(--text); font-weight:500;">
                      <input type="checkbox" id="poema-ativo" onchange="renderPoemaPreview()">
                      Mostrar este poema fixo (no lugar da rotação por mês)
                    </label>
                    <div class="form-group">
                      <label for="poema-autor" style="display:block; font-size:.8rem; color:var(--text-muted); margin-bottom:4px;">Autor — linha de cima em dourado (vazio = só o título discreto)</label>
                      <input type="text" id="poema-autor" oninput="renderPoemaPreview()"
                        placeholder="Poemas de Meishu-Sama"
                        style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:0.9rem; background:var(--surface, #fff); color:var(--text);">
                    </div>
                    <div class="form-group">
                      <label for="poema-titulo" style="display:block; font-size:.8rem; color:var(--text-muted); margin-bottom:4px;">Título da coleção — entre aspas + kanji entre parênteses (vazio = padrão "Yama to Mizu")</label>
                      <input type="text" id="poema-titulo" oninput="renderPoemaPreview()"
                        placeholder="&quot;Akemaro Kin'eishū&quot; (明麿近詠集)"
                        style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:0.9rem; background:var(--surface, #fff); color:var(--text);">
                    </div>
                    <div class="form-group">
                      <label for="poema-original" style="display:block; font-size:.8rem; color:var(--text-muted); margin-bottom:4px;">Japonês — separe os versos com espaço (vira coluna vertical)</label>
                      <textarea id="poema-original" rows="2" oninput="renderPoemaPreview()"
                        placeholder="諸人の　眼を醒す鐘うてど　耳を塞ぎて聞かむともせず"
                        style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:0.95rem; background:var(--surface, #fff); color:var(--text); resize:vertical;"></textarea>
                    </div>
                    <div class="form-group">
                      <label for="poema-romaji" style="display:block; font-size:.8rem; color:var(--text-muted); margin-bottom:4px;">Romaji — Enter quebra a linha</label>
                      <textarea id="poema-romaji" rows="2" oninput="renderPoemaPreview()"
                        placeholder="Morobito no / manako o samasu / kane utedo&#10;mimi o fusagite / kikan tomo sezu"
                        style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:0.9rem; background:var(--surface, #fff); color:var(--text); resize:vertical;"></textarea>
                    </div>
                    <div class="form-group">
                      <label for="poema-translation" style="display:block; font-size:.8rem; color:var(--text-muted); margin-bottom:4px;">Tradução (português) — Enter quebra a linha</label>
                      <textarea id="poema-translation" rows="3" oninput="renderPoemaPreview()"
                        placeholder="Embora eu faça soar o sino..."
                        style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:0.9rem; background:var(--surface, #fff); color:var(--text); resize:vertical;"></textarea>
                    </div>
                    <div style="display:flex; gap:12px; align-items:center; margin-top:4px;">
                      <button id="poema-save-btn" onclick="savePoemaConfig()"
                        style="padding:10px 24px; background:var(--accent); color:#fff; border:1px solid var(--accent); border-radius:8px; font-family:inherit; font-size:0.9rem; font-weight:600; cursor:pointer; letter-spacing:.02em;">Publicar Poema</button>
                      <span id="poema-msg" class="msg" style="margin:0;"></span>
                    </div>
                    <div style="font-size:.74rem; color:var(--text-muted); margin-top:2px;">Vazio ou desativado → a landing
                      volta à rotação automática por mês.</div>
                  </div>
                  <div style="flex:1 1 300px; min-width:280px;">
                    <div style="font-size:.78rem; color:var(--text-muted); margin-bottom:8px;">Pré-visualização <span style="font-weight:400;">— como aparece na landing</span></div>
                    <div id="poema-preview"
                      style="border:1px solid var(--border); border-radius:10px; padding:18px 20px; background:rgba(0,0,0,.02);"></div>
                  </div>
                </div>
              </div>
            `;
{
  const _tabEl = document.getElementById('tab-landing-poem');
  if (_tabEl && !_tabEl.firstElementChild) _tabEl.innerHTML = _TAB_MARKUP;
}

// Espelha cabecalhoPoemaHTML() da landing: com autor, kicker dourado + título
// serifado; sem autor, eyebrow discreto. O (kanji) fica sempre mais leve.
function _cabecalhoPoemaPreview(autor, titulo) {
  const t = (titulo && titulo.trim()) || 'Poemas "Yama to Mizu" (山と水)';
  const m = t.match(/^(.*?)\s*(\([^)]*\))\s*$/);
  const tituloHTML = m
    ? `${_escapeCmu(m[1])} <span style="font-family:'Noto Serif JP',serif; font-style:normal; font-size:.82em; opacity:.72;">${_escapeCmu(m[2])}</span>`
    : _escapeCmu(t);
  const a = autor && autor.trim();
  if (a) {
    return `<div style="font-family:'Outfit',sans-serif; text-transform:uppercase; letter-spacing:.18em; font-size:.66rem; font-weight:600; color:var(--accent); margin-bottom:5px;">${_escapeCmu(a)}</div>
      <div style="font-family:'Crimson Pro',Georgia,serif; font-style:italic; font-size:1.3rem; line-height:1.2; color:var(--text);">${tituloHTML}</div>`;
  }
  return `<div style="font-family:'Crimson Pro',Georgia,serif; font-size:.95rem; letter-spacing:.04em; color:var(--text-muted);">${tituloHTML}</div>`;
}

function renderPoemaPreview() {
  const box = document.getElementById('poema-preview');
  if (!box) return;
  const ativo = document.getElementById('poema-ativo')?.checked;
  const autor = (document.getElementById('poema-autor')?.value || '').trim();
  const titulo = (document.getElementById('poema-titulo')?.value || '').trim();
  const original = (document.getElementById('poema-original')?.value || '').trim();
  const romaji = (document.getElementById('poema-romaji')?.value || '').trim();
  const translation = (document.getElementById('poema-translation')?.value || '').trim();
  if (!ativo) {
    box.innerHTML = '<div style="color:var(--text-muted); font-size:.85rem;">Desativado — a landing mostra a rotação automática por mês.</div>';
    return;
  }
  if (!original && !romaji && !translation) {
    box.innerHTML = '<div style="color:var(--text-muted); font-size:.85rem;">Preencha o poema para ver o preview.</div>';
    return;
  }
  box.innerHTML = `
    <div style="margin-bottom:14px;">${_cabecalhoPoemaPreview(autor, titulo)}</div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:20px; align-items:start;">
      <div>
        ${original ? `<div style="font-family:'Noto Serif JP', serif; font-size:1.15rem; font-weight:600; line-height:1.9; letter-spacing:.06em; color:var(--text);">${_escapeCmu(original)}</div>` : ''}
        ${romaji ? `<p style="font-family:'Crimson Pro',Georgia,serif; font-style:italic; color:var(--text-muted); font-size:.82rem; line-height:1.55; margin:10px 0 0;">${_escapeCmu(romaji).replace(/\n+/g, '<br>')}</p>` : ''}
      </div>
      ${translation ? `<p style="font-family:'Crimson Pro',Georgia,serif; font-style:italic; font-size:1.25rem; line-height:1.6; margin:0; color:var(--text); border-left:2px solid rgba(184,134,11,.4); padding-left:16px;">${_escapeCmu(translation).replace(/\n+/g, '<br>')}</p>` : ''}
    </div>
  `;
}

async function loadPoemaConfig() {
  try {
    const { data, error } = await supabase
      .from('landing_config')
      .select('poema_ativo, poema_autor, poema_titulo, poema_original, poema_romaji, poema_translation')
      .eq('id', 1)
      .maybeSingle();
    if (!error && data) {
      const a = document.getElementById('poema-ativo');
      const au = document.getElementById('poema-autor');
      const ti = document.getElementById('poema-titulo');
      const o = document.getElementById('poema-original');
      const r = document.getElementById('poema-romaji');
      const t = document.getElementById('poema-translation');
      if (a) a.checked = !!data.poema_ativo;
      if (au) au.value = data.poema_autor || '';
      if (ti) ti.value = data.poema_titulo || '';
      if (o) o.value = data.poema_original || '';
      if (r) r.value = data.poema_romaji || '';
      if (t) t.value = data.poema_translation || '';
    }
  } catch (e) { /* mantém o que estiver no form */ }
  renderPoemaPreview();
}

async function savePoemaConfig() {
  const msg = document.getElementById('poema-msg');
  const btn = document.getElementById('poema-save-btn');
  const payload = {
    id: 1,
    poema_ativo: document.getElementById('poema-ativo').checked,
    poema_autor: document.getElementById('poema-autor').value.trim() || null,
    poema_titulo: document.getElementById('poema-titulo').value.trim() || null,
    poema_original: document.getElementById('poema-original').value.trim() || null,
    poema_romaji: document.getElementById('poema-romaji').value.trim() || null,
    poema_translation: document.getElementById('poema-translation').value.trim() || null,
    updated_at: new Date().toISOString()
  };
  if (btn) btn.disabled = true;
  if (msg) { msg.className = 'msg'; msg.textContent = 'Publicando…'; }
  const { error } = await supabase.from('landing_config').upsert(payload, { onConflict: 'id' });
  if (btn) btn.disabled = false;
  if (!msg) return;
  if (error) {
    msg.className = 'msg err';
    msg.textContent = /landing_config|poema_|column|exist|relation/i.test(error.message || '')
      ? 'Rode a migração landing_config.sql (colunas poema_*) no Supabase.'
      : 'Erro: ' + error.message;
  } else {
    msg.className = 'msg ok';
    msg.textContent = '✓ Poema publicado — já aparece na landing.';
  }
}

Object.assign(window, {
  renderPoemaPreview,
  loadPoemaConfig,
  savePoemaConfig
});
