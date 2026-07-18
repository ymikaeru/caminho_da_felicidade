// ============================================================
// Poema da landing (public.landing_config id=1)
// Aba dedicada. Dois blocos:
//   1) POOLS POR ESTAÇÃO (season_pools jsonb) — a curadoria de poemas por
//      estação brasileira. A landing rotaciona por mês/ano DENTRO do pool da
//      estação atual, garantindo 3 poemas distintos por trimestre (regra
//      anti-repetição em landing.js: escolherDoPool). Puxa do Yama to Mizu.
//   2) POEMA FIXO (poema_*) — override manual: quando ativo, aparece no lugar
//      da rotação. Serve pra fixar um poema específico numa ocasião.
// A landing (ymikaeru.github.io/js/landing.js) lê os dois; prioridade:
//   poema fixo → pool da estação → TODAS_POESIAS hardcoded (fallback).
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escapeCmu } from '../shared/helpers.js';

// Estações brasileiras (espelha ESTACOES de landing.js). A ordem dos meses
// define a posição 0/1/2 usada pela rotação anti-repetição.
const SEASONS = [
  { key: 'verao',     label: 'Verão',     kigo: 'Verão',     meses: [12, 1, 2],  emoji: '☀️' },
  { key: 'outono',    label: 'Outono',    kigo: 'Outono',    meses: [3, 4, 5],   emoji: '🍂' },
  { key: 'inverno',   label: 'Inverno',   kigo: 'Inverno',   meses: [6, 7, 8],   emoji: '❄️' },
  { key: 'primavera', label: 'Primavera', kigo: 'Primavera', meses: [9, 10, 11], emoji: '🌸' }
];
const MESES_PT = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const YAMA_URL = 'data/poetry/yama_to_mizu.json';

// Estado do módulo.
let _pools = { verao: [], outono: [], inverno: [], primavera: [] };
let _activeSeason = 'verao';
let _yama = null;         // seções do yama_to_mizu.json (lazy)
let _poolsDirty = false;

// ── Markup da aba (injetado no import do módulo; padrão das demais abas) ──
const _TAB_MARKUP = `
              <div style="margin-bottom:24px;">
                <h2 style="margin:0 0 4px; font-size:1rem; font-weight:600; color:var(--accent); letter-spacing:1px; text-transform:uppercase;">Poema da landing</h2>
                <p style="font-size:0.85rem; color:var(--text-muted); margin:0;">O poema em destaque acima do calendário na landing pública (cmu.org.br).</p>
              </div>

              <!-- ── BLOCO 1: pools por estação ── -->
              <div class="admin-section">
                <h3 style="margin:0 0 6px; font-size:.92rem; font-weight:600; color:var(--text);">Poemas por estação (rotação automática)</h3>
                <p style="font-size:0.82rem; color:var(--text-muted); margin:0 0 16px;">Cure um conjunto de poemas do <strong>Yama to Mizu</strong> para cada estação brasileira. A landing mostra 1 por mês, rodando dentro do pool da estação atual — <strong>sem repetir de um mês para o outro</strong> e avançando a cada ano. Recomendado: <strong>≥3 poemas por estação</strong>.</p>

                <div id="season-tabs" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px;"></div>
                <div id="season-body"></div>

                <div style="display:flex; gap:12px; align-items:center; margin-top:18px;">
                  <button id="pools-save-btn" onclick="savePoolsConfig()"
                    style="padding:10px 24px; background:var(--accent); color:#fff; border:1px solid var(--accent); border-radius:8px; font-family:inherit; font-size:0.9rem; font-weight:600; cursor:pointer;">Salvar pools</button>
                  <span id="pools-msg" class="msg" style="margin:0;"></span>
                </div>
              </div>

              <!-- ── BLOCO 2: poema fixo (override) ── -->
              <div class="admin-section" style="margin-top:26px;">
                <h3 style="margin:0 0 6px; font-size:.92rem; font-weight:600; color:var(--text);">Poema fixo (override manual)</h3>
                <p style="font-size:0.82rem; color:var(--text-muted); margin:0 0 18px;">Quando ativado, este poema aparece <strong>no lugar</strong> da rotação por estação — útil pra fixar um poema específico numa ocasião. Desative para voltar à rotação.</p>
                <div style="display:flex; flex-wrap:wrap; gap:24px; align-items:flex-start;">
                  <div style="flex:1 1 360px; min-width:300px; display:flex; flex-direction:column; gap:12px;">
                    <label style="display:flex; gap:8px; align-items:center; font-size:0.9rem; color:var(--text); font-weight:500;">
                      <input type="checkbox" id="poema-ativo" onchange="renderPoemaPreview()">
                      Mostrar este poema fixo (no lugar da rotação)
                    </label>
                    <div class="form-group">
                      <label for="poema-autor" style="display:block; font-size:.8rem; color:var(--text-muted); margin-bottom:4px;">Autor — linha de cima em dourado (vazio = só o título discreto)</label>
                      <input type="text" id="poema-autor" oninput="renderPoemaPreview()" placeholder="Poemas de Meishu-Sama"
                        style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:0.9rem; background:var(--surface, #fff); color:var(--text);">
                    </div>
                    <div class="form-group">
                      <label for="poema-titulo" style="display:block; font-size:.8rem; color:var(--text-muted); margin-bottom:4px;">Título da coleção — entre aspas + kanji entre parênteses (vazio = padrão "Yama to Mizu")</label>
                      <input type="text" id="poema-titulo" oninput="renderPoemaPreview()" placeholder="&quot;Akemaro Kin'eishū&quot; (明麿近詠集)"
                        style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:0.9rem; background:var(--surface, #fff); color:var(--text);">
                    </div>
                    <div class="form-group">
                      <label for="poema-original" style="display:block; font-size:.8rem; color:var(--text-muted); margin-bottom:4px;">Japonês — separe os versos com espaço (vira coluna vertical)</label>
                      <textarea id="poema-original" rows="2" oninput="renderPoemaPreview()" placeholder="諸人の　眼を醒す鐘うてど　耳を塞ぎて聞かむともせず"
                        style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:0.95rem; background:var(--surface, #fff); color:var(--text); resize:vertical;"></textarea>
                    </div>
                    <div class="form-group">
                      <label for="poema-romaji" style="display:block; font-size:.8rem; color:var(--text-muted); margin-bottom:4px;">Romaji — Enter quebra a linha</label>
                      <textarea id="poema-romaji" rows="2" oninput="renderPoemaPreview()" placeholder="Morobito no / manako o samasu / kane utedo&#10;mimi o fusagite / kikan tomo sezu"
                        style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:0.9rem; background:var(--surface, #fff); color:var(--text); resize:vertical;"></textarea>
                    </div>
                    <div class="form-group">
                      <label for="poema-translation" style="display:block; font-size:.8rem; color:var(--text-muted); margin-bottom:4px;">Tradução (português) — Enter quebra a linha</label>
                      <textarea id="poema-translation" rows="3" oninput="renderPoemaPreview()" placeholder="Embora eu faça soar o sino..."
                        style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:0.9rem; background:var(--surface, #fff); color:var(--text); resize:vertical;"></textarea>
                    </div>
                    <div style="display:flex; gap:12px; align-items:center; margin-top:4px;">
                      <button id="poema-save-btn" onclick="savePoemaConfig()"
                        style="padding:10px 24px; background:var(--accent); color:#fff; border:1px solid var(--accent); border-radius:8px; font-family:inherit; font-size:0.9rem; font-weight:600; cursor:pointer; letter-spacing:.02em;">Publicar Poema Fixo</button>
                      <span id="poema-msg" class="msg" style="margin:0;"></span>
                    </div>
                    <div style="font-size:.74rem; color:var(--text-muted); margin-top:2px;">Vazio ou desativado → a landing volta à rotação por estação.</div>
                  </div>
                  <div style="flex:1 1 300px; min-width:280px;">
                    <div style="font-size:.78rem; color:var(--text-muted); margin-bottom:8px;">Pré-visualização <span style="font-weight:400;">— como aparece na landing</span></div>
                    <div id="poema-preview" style="border:1px solid var(--border); border-radius:10px; padding:18px 20px; background:rgba(0,0,0,.02);"></div>
                  </div>
                </div>
              </div>

              <!-- ── Modal seletor do Yama to Mizu ── -->
              <div id="yama-picker" style="display:none; position:fixed; inset:0; z-index:4000; background:rgba(0,0,0,.5); align-items:center; justify-content:center; padding:20px;">
                <div style="background:var(--surface, #fff); color:var(--text); width:min(760px, 96vw); max-height:88vh; border-radius:12px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,.35);">
                  <div style="padding:14px 18px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px;">
                    <strong id="picker-title" style="font-size:.95rem;">Adicionar do Yama to Mizu</strong>
                    <button onclick="closeYamaPicker()" style="margin-left:auto; background:none; border:none; font-size:1.4rem; line-height:1; color:var(--text-muted); cursor:pointer;">×</button>
                  </div>
                  <div style="padding:12px 18px; border-bottom:1px solid var(--border); display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
                    <select id="picker-section" onchange="renderPickerList()" style="flex:1 1 240px; padding:7px 9px; border:1px solid var(--border); border-radius:6px; background:var(--surface,#fff); color:var(--text); font-size:.85rem;"></select>
                    <input type="text" id="picker-search" oninput="renderPickerList()" placeholder="Buscar em JA / romaji / tradução…"
                      style="flex:2 1 240px; padding:7px 9px; border:1px solid var(--border); border-radius:6px; background:var(--surface,#fff); color:var(--text); font-size:.85rem;">
                  </div>
                  <div id="picker-list" style="overflow-y:auto; padding:6px 10px 14px;"></div>
                </div>
              </div>
            `;
{
  const _tabEl = document.getElementById('tab-landing-poem');
  if (_tabEl && !_tabEl.firstElementChild) {
    _tabEl.innerHTML = _TAB_MARKUP;
    // Delegação de eventos para a lista de pools (botões dinâmicos).
    _tabEl.addEventListener('click', _onPoolsClick);
  }
}

// ============================================================
// BLOCO 1 — pools por estação
// ============================================================

// Estação brasileira do mês atual (só pra abrir na aba mais útil).
function _currentSeasonKey() {
  const m = new Date().getMonth() + 1;
  return (SEASONS.find(s => s.meses.includes(m)) || SEASONS[0]).key;
}

// Espelha escolherDoPool() de landing.js — pra mostrar o "trio deste ano".
function _anoDaEstacao(season, mes1, ano) {
  if (season.key === 'verao' && mes1 !== 12) return ano - 1;
  return ano;
}
function _escolherDoPool(pool, season, mes1, ano) {
  if (!pool.length) return null;
  const pos = season.meses.indexOf(mes1);
  const k = _anoDaEstacao(season, mes1, ano);
  const n = pool.length;
  const off = (((k * 3) % n) + n) % n;
  return pool[(off + pos) % n];
}

function _seasonTabsHTML() {
  return SEASONS.map(s => {
    const n = (_pools[s.key] || []).length;
    const active = s.key === _activeSeason;
    const warn = n > 0 && n < 3;
    return `<button data-action="season" data-season="${s.key}"
      style="padding:8px 14px; border-radius:8px; cursor:pointer; font-family:inherit; font-size:.85rem; font-weight:${active ? 600 : 500};
        border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};
        background:${active ? 'var(--accent)' : 'transparent'};
        color:${active ? '#fff' : 'var(--text)'};">
      ${s.emoji} ${s.label}
      <span style="opacity:.75; font-size:.78em;">(${n})${warn ? ' ⚠️' : ''}</span>
    </button>`;
  }).join('');
}

function _poemRowHTML(p, idx, total) {
  const ja = _escapeCmu((p.original || '').slice(0, 40));
  const tr = _escapeCmu((p.translation || '').slice(0, 90));
  const ttl = _escapeCmu(p.title || '(sem título)');
  return `<div style="display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border:1px solid var(--border); border-radius:8px; margin-bottom:8px; background:rgba(0,0,0,.015);">
    <div style="flex:0 0 auto; display:flex; flex-direction:column; gap:2px; padding-top:2px;">
      <button data-action="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="Subir"
        style="border:1px solid var(--border); background:var(--surface,#fff); color:var(--text); border-radius:4px; width:26px; height:22px; cursor:pointer; opacity:${idx === 0 ? .35 : 1};">▲</button>
      <button data-action="down" data-idx="${idx}" ${idx === total - 1 ? 'disabled' : ''} title="Descer"
        style="border:1px solid var(--border); background:var(--surface,#fff); color:var(--text); border-radius:4px; width:26px; height:22px; cursor:pointer; opacity:${idx === total - 1 ? .35 : 1};">▼</button>
    </div>
    <div style="flex:1 1 auto; min-width:0;">
      <div style="font-weight:600; font-size:.86rem; color:var(--text); margin-bottom:2px;">${ttl}</div>
      <div style="font-family:'Noto Serif JP',serif; font-size:.82rem; color:var(--text); opacity:.85;">${ja}${(p.original || '').length > 40 ? '…' : ''}</div>
      <div style="font-size:.78rem; color:var(--text-muted); font-style:italic; margin-top:2px;">${tr}${(p.translation || '').length > 90 ? '…' : ''}</div>
    </div>
    <div style="flex:0 0 auto; display:flex; flex-direction:column; gap:6px;">
      <button data-action="pin" data-idx="${idx}" title="Fixar este como override manual"
        style="border:1px solid var(--border); background:var(--surface,#fff); color:var(--text); border-radius:6px; padding:4px 8px; cursor:pointer; font-size:.76rem;">📌 Fixar</button>
      <button data-action="remove" data-idx="${idx}" title="Remover do pool"
        style="border:1px solid var(--border); background:var(--surface,#fff); color:#c0392b; border-radius:6px; padding:4px 8px; cursor:pointer; font-size:.76rem;">✕ Remover</button>
    </div>
  </div>`;
}

function _trioPreviewHTML(season) {
  const pool = _pools[season.key] || [];
  if (pool.length < 1) return '';
  const ano = new Date().getFullYear();
  const cells = season.meses.map(m => {
    const p = _escolherDoPool(pool, season, m, ano);
    const t = p ? _escapeCmu((p.title || p.translation || '').slice(0, 34)) : '—';
    return `<div style="flex:1 1 120px; border:1px solid var(--border); border-radius:8px; padding:8px 10px; background:rgba(0,0,0,.02);">
      <div style="font-size:.7rem; text-transform:uppercase; letter-spacing:.05em; color:var(--accent); font-weight:600; margin-bottom:3px;">${MESES_PT[m]}</div>
      <div style="font-size:.8rem; color:var(--text);">${t}</div>
    </div>`;
  }).join('');
  const warn = pool.length < 3
    ? `<div style="font-size:.76rem; color:#b26a00; margin-top:8px;">⚠️ Com menos de 3 poemas nesta estação, algum mês vai repetir. Adicione mais para variar.</div>`
    : '';
  return `<div style="margin-top:16px;">
    <div style="font-size:.76rem; color:var(--text-muted); margin-bottom:6px;">Prévia do trio deste ano (${ano}) — o que aparece em cada mês:</div>
    <div style="display:flex; flex-wrap:wrap; gap:8px;">${cells}</div>${warn}
  </div>`;
}

function renderPools() {
  const tabs = document.getElementById('season-tabs');
  const body = document.getElementById('season-body');
  if (!tabs || !body) return;
  tabs.innerHTML = _seasonTabsHTML();
  const season = SEASONS.find(s => s.key === _activeSeason);
  const pool = _pools[_activeSeason] || [];
  const list = pool.length
    ? pool.map((p, i) => _poemRowHTML(p, i, pool.length)).join('')
    : `<div style="font-size:.85rem; color:var(--text-muted); padding:14px; border:1px dashed var(--border); border-radius:8px;">Nenhum poema nesta estação ainda. Use “+ Adicionar do Yama to Mizu”.</div>`;
  body.innerHTML = `
    <div style="font-size:.82rem; color:var(--text-muted); margin-bottom:12px;">
      Estação <strong>${season.emoji} ${season.label}</strong> — meses ${season.meses.map(m => MESES_PT[m]).join(', ')}.
    </div>
    <div>${list}</div>
    <button data-action="add"
      style="margin-top:6px; padding:9px 16px; border:1px dashed var(--accent); background:transparent; color:var(--accent); border-radius:8px; cursor:pointer; font-family:inherit; font-size:.85rem; font-weight:600;">+ Adicionar do Yama to Mizu</button>
    ${_trioPreviewHTML(season)}
  `;
}

function _onPoolsClick(ev) {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const idx = btn.dataset.idx != null ? parseInt(btn.dataset.idx, 10) : -1;
  const pool = _pools[_activeSeason];
  if (action === 'season') {
    _activeSeason = btn.dataset.season;
    renderPools();
  } else if (action === 'add') {
    openYamaPicker();
  } else if (action === 'remove') {
    pool.splice(idx, 1);
    _poolsDirty = true;
    renderPools();
  } else if (action === 'up' && idx > 0) {
    [pool[idx - 1], pool[idx]] = [pool[idx], pool[idx - 1]];
    _poolsDirty = true;
    renderPools();
  } else if (action === 'down' && idx < pool.length - 1) {
    [pool[idx + 1], pool[idx]] = [pool[idx], pool[idx + 1]];
    _poolsDirty = true;
    renderPools();
  } else if (action === 'pin') {
    _pinToOverride(pool[idx]);
  }
}

// Copia um poema do pool para o bloco de override e ativa — o admin "escolhe
// outra opção" quando quiser fugir da rotação.
function _pinToOverride(p) {
  if (!p) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('poema-autor', '');
  set('poema-titulo', '');
  set('poema-original', p.original || '');
  set('poema-romaji', p.romaji || '');
  set('poema-translation', p.translation || '');
  const chk = document.getElementById('poema-ativo');
  if (chk) chk.checked = true;
  renderPoemaPreview();
  const msg = document.getElementById('poema-msg');
  if (msg) { msg.className = 'msg'; msg.textContent = 'Carregado no poema fixo — revise e clique “Publicar Poema Fixo”.'; }
  document.getElementById('poema-preview')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function savePoolsConfig() {
  const msg = document.getElementById('pools-msg');
  const btn = document.getElementById('pools-save-btn');
  if (btn) btn.disabled = true;
  if (msg) { msg.className = 'msg'; msg.textContent = 'Salvando…'; }
  const payload = { id: 1, season_pools: _pools, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('landing_config').upsert(payload, { onConflict: 'id' });
  if (btn) btn.disabled = false;
  if (!msg) return;
  if (error) {
    msg.className = 'msg err';
    msg.textContent = /season_pools|column|exist|relation/i.test(error.message || '')
      ? 'Rode a migração landing_season_pools.sql (coluna season_pools) no Supabase.'
      : 'Erro: ' + error.message;
  } else {
    _poolsDirty = false;
    msg.className = 'msg ok';
    msg.textContent = '✓ Pools salvos — já valem na landing.';
  }
}

// ============================================================
// Seletor do Yama to Mizu (modal)
// ============================================================
async function _loadYama() {
  if (_yama) return _yama;
  const res = await fetch(YAMA_URL);
  if (!res.ok) throw new Error('Falha ao carregar Yama to Mizu: ' + res.status);
  const data = await res.json();
  _yama = data.sections || [];
  return _yama;
}

async function openYamaPicker() {
  const modal = document.getElementById('yama-picker');
  const title = document.getElementById('picker-title');
  const season = SEASONS.find(s => s.key === _activeSeason);
  if (title) title.textContent = `Adicionar em ${season.emoji} ${season.label}`;
  if (modal) modal.style.display = 'flex';
  const listEl = document.getElementById('picker-list');
  if (listEl) listEl.innerHTML = '<div style="padding:20px; color:var(--text-muted); font-size:.85rem;">Carregando acervo…</div>';
  try {
    await _loadYama();
    _fillPickerSections();
    renderPickerList();
  } catch (e) {
    if (listEl) listEl.innerHTML = `<div style="padding:20px; color:#c0392b; font-size:.85rem;">${_escapeCmu(e.message)}</div>`;
  }
}

function closeYamaPicker() {
  const modal = document.getElementById('yama-picker');
  if (modal) modal.style.display = 'none';
}

function _fillPickerSections() {
  const sel = document.getElementById('picker-section');
  if (!sel) return;
  const opts = ['<option value="-1">Todas as seções</option>']
    .concat(_yama.map((s, i) => {
      const jp = s.title_jp ? s.title_jp.replace(/\s+/g, '') : '';
      const pt = s.title_pt || '';
      const n = (s.poems || []).length;
      return `<option value="${i}">${_escapeCmu((jp ? jp + ' — ' : '') + pt)} (${n})</option>`;
    }));
  sel.innerHTML = opts.join('');
}

function renderPickerList() {
  const listEl = document.getElementById('picker-list');
  if (!listEl || !_yama) return;
  const secIdx = parseInt(document.getElementById('picker-section')?.value ?? '-1', 10);
  const q = (document.getElementById('picker-search')?.value || '').trim().toLowerCase();
  const season = SEASONS.find(s => s.key === _activeSeason);
  const already = new Set((_pools[_activeSeason] || []).map(p => p.original));

  const rows = [];
  const secs = secIdx >= 0 ? [[secIdx, _yama[secIdx]]] : _yama.map((s, i) => [i, s]);
  let count = 0;
  const LIMIT = 300;
  for (const [si, sec] of secs) {
    for (let pi = 0; pi < (sec.poems || []).length; pi++) {
      const p = sec.poems[pi];
      if (q) {
        const hay = `${p.original || ''} ${p.reading || ''} ${p.translation || ''} ${p.title || ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      if (count >= LIMIT) { rows.push(`<div style="padding:10px; color:var(--text-muted); font-size:.8rem;">… refine a busca para ver mais (mostrando ${LIMIT}).</div>`); break; }
      count++;
      const inPool = already.has(p.original);
      const ttl = _escapeCmu(p.title || sec.title_pt || '');
      const ja = _escapeCmu((p.original || '').slice(0, 46));
      const tr = _escapeCmu((p.translation || '').slice(0, 110));
      rows.push(`<div style="display:flex; gap:10px; align-items:flex-start; padding:9px 8px; border-bottom:1px solid var(--border);">
        <div style="flex:1 1 auto; min-width:0;">
          <div style="font-weight:600; font-size:.82rem;">${ttl}</div>
          <div style="font-family:'Noto Serif JP',serif; font-size:.8rem; opacity:.85;">${ja}${(p.original || '').length > 46 ? '…' : ''}</div>
          <div style="font-size:.76rem; color:var(--text-muted); font-style:italic;">${tr}${(p.translation || '').length > 110 ? '…' : ''}</div>
        </div>
        <button data-picker-add="${si}:${pi}" ${inPool ? 'disabled' : ''}
          style="flex:0 0 auto; border:1px solid ${inPool ? 'var(--border)' : 'var(--accent)'}; background:${inPool ? 'transparent' : 'var(--accent)'}; color:${inPool ? 'var(--text-muted)' : '#fff'}; border-radius:6px; padding:5px 10px; cursor:${inPool ? 'default' : 'pointer'}; font-size:.78rem; font-weight:600;">${inPool ? '✓ no pool' : 'Adicionar'}</button>
      </div>`);
    }
    if (count >= LIMIT) break;
  }
  listEl.innerHTML = rows.length ? rows.join('') : '<div style="padding:20px; color:var(--text-muted); font-size:.85rem;">Nada encontrado.</div>';
  // Liga os botões "Adicionar" (delegação local do modal).
  listEl.onclick = (ev) => {
    const b = ev.target.closest('button[data-picker-add]');
    if (!b || b.disabled) return;
    const [si, pi] = b.dataset.pickerAdd.split(':').map(Number);
    _addFromYama(si, pi, season);
    b.disabled = true;
    b.textContent = '✓ no pool';
    b.style.background = 'transparent';
    b.style.color = 'var(--text-muted)';
    b.style.borderColor = 'var(--border)';
  };
}

function _addFromYama(si, pi, season) {
  const p = _yama[si]?.poems?.[pi];
  if (!p) return;
  _pools[season.key].push({
    title: p.title || '',
    original: p.original || '',
    romaji: p.reading || '',        // no JSON o romaji vem em "reading"
    translation: p.translation || '',
    kigo: season.kigo,
    meses: season.meses.slice()
  });
  _poolsDirty = true;
  renderPools();
}

// ============================================================
// BLOCO 2 — poema fixo (override) — inalterado do original
// ============================================================
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
    box.innerHTML = '<div style="color:var(--text-muted); font-size:.85rem;">Desativado — a landing mostra a rotação por estação.</div>';
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
      .select('poema_ativo, poema_autor, poema_titulo, poema_original, poema_romaji, poema_translation, season_pools')
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
      if (data.season_pools && typeof data.season_pools === 'object') {
        for (const s of SEASONS) {
          _pools[s.key] = Array.isArray(data.season_pools[s.key]) ? data.season_pools[s.key] : [];
        }
      }
    }
  } catch (e) { /* mantém o que estiver no form */ }
  _activeSeason = _currentSeasonKey();
  renderPools();
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
    msg.textContent = '✓ Poema fixo publicado — já aparece na landing.';
  }
}

Object.assign(window, {
  renderPoemaPreview,
  loadPoemaConfig,
  savePoemaConfig,
  savePoolsConfig,
  openYamaPicker,
  closeYamaPicker,
  renderPickerList
});
