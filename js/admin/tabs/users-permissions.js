// ============================================================
// Users + Permissions — CRUD de usuários, restrições por
// volume/arquivo, painel de Default Permissions (aplica em massa).
// Inclui o loader de section_map.js (volumeCategories) porque é
// pré-requisito do editor de restrições.
// ============================================================
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../supabase-config.js';
import { fetchAll } from '../fetch-all.js';
import { _escHtml, logAdminAction, getFileTitle } from '../shared/helpers.js';
import { VOLUMES, VOL_SHORT } from '../shared/constants.js';
import {
  allUsers, setAllUsers,
  selectedUserId, setSelectedUserId,
  volumeCategories
} from '../shared/state.js';

// ── Markup da aba (movido de admin-supabase.html p/ manter o HTML enxuto) ──
// Injetado no import do módulo: roda antes do corpo de admin.js (imports são
// hoisted) e antes de qualquer interação — o DOM final é idêntico ao antigo.
const _TAB_MARKUP = `

              <!-- Default Permissions Panel — oculto por enquanto (não em uso); remover o display:none para reativar -->
              <div class="default-perm-panel" id="default-perm-panel" style="display:none;">
                <div class="default-perm-header" id="default-perm-header" onclick="toggleDefaultPermPanel()">
                  <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:1.1rem;">🚫</span>
                    <div>
                      <h3
                        style="margin:0; font-size:0.95rem; font-weight:600; color:var(--text); display:flex; align-items:center; gap:6px;">
                        Restrição Padrão para Todos
                      </h3>
                      <p style="margin:2px 0 0; font-size:0.75rem; color:var(--text-muted);">
                        Configure e aplique uma restrição padrão para todos os usuários cadastrados
                      </p>
                    </div>
                  </div>
                  <span class="default-perm-chevron" id="default-perm-chevron">▼</span>
                </div>
                <div class="default-perm-body" id="default-perm-body">
                  <div class="default-perm-warning">
                    <span style="font-size:1.1rem; flex-shrink:0;">⚠</span>
                    <p style="margin:0; font-size:0.8rem; line-height:1.4;">
                      Esta ação <strong>sobrescreve as restrições de todos os usuários</strong> (exceto admins) com a
                      configuração abaixo. A ação não pode ser desfeita automaticamente.
                    </p>
                  </div>
                  <div id="default-perm-volumes" class="perm-volumes" style="margin-bottom:16px;"></div>
                  <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
                    <button class="apply-all-btn" id="apply-all-btn" onclick="applyDefaultPermissions()">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      Aplicar Restrições para Todos os Usuários
                    </button>
                    <span id="apply-all-msg" class="msg" style="margin:0; padding:6px 12px;"></span>
                  </div>
                  <div class="apply-all-progress" id="apply-all-progress">
                    <div class="apply-all-progress-bar" id="apply-all-bar"></div>
                    <div class="apply-all-progress-label" id="apply-all-label">Preparando...</div>
                  </div>
                </div>
              </div>

              <!-- Add User -->
              <div class="admin-section">
                <h2>Adicionar Usuário</h2>
                <div class="add-user-form">
                  <div class="form-group">
                    <label for="new-name">Nome</label>
                    <input type="text" id="new-name" placeholder="Nome do usuário">
                  </div>
                  <div class="form-group">
                    <label for="new-email">Email</label>
                    <input type="email" id="new-email" placeholder="email@exemplo.com">
                  </div>
                  <div class="form-group">
                    <label class="add-user-custompass" style="display:flex; align-items:center; gap:8px; font-weight:400; cursor:pointer;">
                      <input type="checkbox" id="new-custom-pass" onchange="toggleCustomPass()" style="width:auto; margin:0;">
                      <span>Usar senha diferente da padrão (<strong>Mioshie</strong>)</span>
                    </label>
                    <input type="password" id="new-password" placeholder="Mínimo 6 caracteres"
                      style="display:none; margin-top:8px;">
                  </div>
                  <div class="form-group">
                    <label for="new-lang">Idioma</label>
                    <select id="new-lang">
                      <option value="">🌐 Padrão (usuário escolhe)</option>
                      <option value="pt">🇧🇷 Português</option>
                      <option value="ja">🇯🇵 日本語</option>
                    </select>
                  </div>
                  <button id="add-user-btn" onclick="addUser()">Adicionar</button>
                </div>
                <div id="add-user-msg" class="msg"></div>
              </div>

              <!-- User List -->
              <div class="admin-section">
                <h2>Usuários <span id="user-count"
                    style="font-weight:400; color:var(--text-muted); font-size:0.85rem;"></span></h2>
                <div class="user-search">
                  <input type="text" id="user-search" aria-label="Buscar usuário por nome ou email"
                    placeholder="Buscar por nome ou email..." oninput="filterUsers()">
                </div>
                <div id="user-list-container">
                  <div class="loading">Carregando usuários...</div>
                </div>
              </div>

              <!-- Permission Editor -->
              <div class="perm-editor" id="perm-editor">
                <h3 id="perm-editor-title">Restrições de Acesso</h3>
                <p>Selecione os volumes e arquivos que este usuário <strong>NÃO PODERÁ</strong> ver. (Deixe desmarcado
                  para permitir o acesso livre).</p>
                <div id="perm-volumes" class="perm-volumes"></div>
                <div style="margin-top:16px; display:flex; gap:10px;">
                  <button class="login-submit-btn" style="width:auto; padding:10px 24px;" onclick="savePermissions()">💾
                    Salvar Restrições</button>
                  <button
                    style="padding:10px 24px; border:1px solid var(--border); border-radius:10px; background:var(--surface); color:var(--text); cursor:pointer;"
                    onclick="closePermEditor()">Cancelar</button>
                </div>
                <div id="save-perm-msg" class="msg" style="margin-top:12px;"></div>
              </div>

            `;
{
  const _tabEl = document.getElementById('tab-users');
  if (_tabEl && !_tabEl.firstElementChild) _tabEl.innerHTML = _TAB_MARKUP;
}

// ── Volume files for permission editor ────────────────────────

function parseSectionMapText(text) {
  const jsonStr = text.match(/window\.SECTION_MAP\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)?.[1];
  if (!jsonStr) return false;
  let sectionMap;
  try {
    sectionMap = JSON.parse(jsonStr);
  } catch (e) {
    console.warn('[parseSectionMapText] JSON inválido:', e);
    return false;
  }
  for (const vol of VOLUMES) {
    const volMap = sectionMap[vol.key] || {};
    const categories = {};
    let fileIndex = 0;
    for (const [file, info] of Object.entries(volMap)) {
      fileIndex++;
      const isNewFormat = 'section' in info;
      const sectionName = isNewFormat ? (info.section || 'Outros') : (info.pt || 'Outros');
      const title = isNewFormat
        ? (info.pt || file.replace(/\.html\.json$/, '').replace(/\.html$/, ''))
        : file.replace(/\.html\.json$/, '').replace(/\.html$/, '');
      if (!categories[sectionName]) categories[sectionName] = [];
      categories[sectionName].push({ file, title, num: fileIndex });
    }
    volumeCategories[vol.key] = categories;
  }
  return true;
}

async function loadVolumeFiles() {
  // 1. Local site_data (always up-to-date with new format)
  try {
    const resp = await fetch('site_data/section_map.js');
    if (resp.ok) {
      const text = await resp.text();
      if (parseSectionMapText(text)) return true;
    }
  } catch (e) {
    console.warn('[loadVolumeFiles] Local falhou:', e);
  }

  // 2. Supabase storage (may be older format)
  try {
    const { data: mapData } = await supabase.storage.from('teachings').download('section_map.js');
    if (mapData) {
      const text = await mapData.text();
      if (parseSectionMapText(text)) return true;
    }
  } catch (e) {
    console.warn('[loadVolumeFiles] Supabase storage falhou:', e);
  }

  // 3. Last resort: list files (shows filenames only)
  let anyLoaded = false;
  for (const vol of VOLUMES) {
    if (!volumeCategories[vol.key]) {
      try {
        const { data } = await supabase.storage.from('teachings').list(`${vol.key}/`);
        const files = (data || []).map(f => ({ file: f.name, title: f.name.replace('.html.json', '') }));
        volumeCategories[vol.key] = files.length > 0 ? { 'Todos': files } : {};
        if (files.length > 0) anyLoaded = true;
      } catch {
        volumeCategories[vol.key] = {};
      }
    } else {
      anyLoaded = true;
    }
  }

  if (!anyLoaded) {
    console.error('[loadVolumeFiles] Todas as fontes falharam — estado vazio.');
    // Signal to callers that data is unavailable
    return false;
  }
  return true;
}

// ── User list with email ──────────────────────────────────────

async function loadUsers() {
  const container = document.getElementById('user-list-container');
  container.innerHTML = '<div class="loading">Carregando usuários...</div>';

  // admin_get_users() é uma RPC SECURITY DEFINER que lê auth.users para retornar emails reais.
  // admin_get_user_visit_days() conta dias distintos com pelo menos 1 access_log (view).
  const [usersRes, visitsRes] = await Promise.all([
    supabase.rpc('admin_get_users'),
    supabase.rpc('admin_get_user_visit_days')
  ]);

  if (usersRes.error) {
    container.innerHTML = `<div class="msg err">Erro ao carregar usuários: ${_escHtml(usersRes.error.message)}</div>`;
    return;
  }

  const visitsByUser = {};
  if (!visitsRes.error && Array.isArray(visitsRes.data)) {
    for (const v of visitsRes.data) {
      visitsByUser[v.user_id] = { active_days: v.active_days, last_visit: v.last_visit };
    }
  }

  setAllUsers((usersRes.data || []).map(u => ({
    ...u,
    active_days: visitsByUser[u.id]?.active_days || 0,
    last_visit:  visitsByUser[u.id]?.last_visit  || null
  })));

  document.getElementById('user-count').textContent = `(${allUsers.length})`;
  renderUserList();
}

function renderUserList() {
  const container = document.getElementById('user-list-container');
  const query = (document.getElementById('user-search')?.value || '').toLowerCase();
  const filtered = allUsers.filter(u =>
    (u.display_name || '').toLowerCase().includes(query) ||
    (u.email || '').toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    container.innerHTML = '<div class="loading">Nenhum usuário encontrado.</div>';
    return;
  }

  // _escHtml em todos os campos controláveis pelo usuário (display_name, email).
  // UUIDs e roles vêm do Supabase e também são escapados por defesa em profundidade.
  container.innerHTML = '<div class="user-list">' + filtered.map(u => {
    const idEsc = _escHtml(u.id);
    const nameEsc = _escHtml(u.display_name || 'Sem nome');
    const emailEsc = _escHtml(u.email || '');
    const emailDisplay = _escHtml(u.email || '—');
    const initial = _escHtml((u.display_name || 'U')[0].toUpperCase());
    const roleEsc = _escHtml(u.role || '');
    const createdEsc = _escHtml(new Date(u.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    const days = Number(u.active_days || 0);
    // active_days conta dias com action='view' (abertura de ensinamento).
    // last_seen_at é heartbeat de presença, gravado a partir do login.
    // Distinguir: nunca logou × logou mas não leu × leu N dias.
    const lastSeenStr = u.last_seen_at
      ? _escHtml(new Date(u.last_seen_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
      : null;
    const daysLabel = days === 0
      ? (lastSeenStr ? `Sem leituras · acessou ${lastSeenStr}` : 'Nunca acessou')
      : days === 1 ? '1 dia ativo'
      : `${days} dias ativos`;
    const lastVisitStr = (days > 0 && u.last_visit)
      ? ` · último: ${_escHtml(new Date(u.last_visit).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}`
      : '';
    return `
    <div class="user-row ${u.id === selectedUserId ? 'active' : ''}" onclick="selectUser('${idEsc}')">
      <div class="user-avatar">${initial}</div>
      <div class="user-info">
        <div class="user-name">${nameEsc}
          <button class="reset-btn" onclick="event.stopPropagation(); openUserDetail('${idEsc}')" title="Ver progresso de leitura">📊 detalhes</button>
          <button class="reset-btn" onclick="event.stopPropagation(); resetPassword('${idEsc}', '${emailEsc}')" title="Resetar senha">🔑 reset</button>
        </div>
        <div class="user-email">${emailDisplay}</div>
        <div class="user-meta">Criado em ${createdEsc} · ${daysLabel}${lastVisitStr}</div>
      </div>
      <div class="user-actions">
        <span class="user-badge ${roleEsc}">${roleEsc}</span>
        <select class="role-select" onclick="event.stopPropagation()" onchange="changeUserLang('${idEsc}', this.value)" title="Idioma preferido do usuário">
          <option value="" ${!u.preferred_lang ? 'selected' : ''}>🌐 Idioma —</option>
          <option value="pt" ${u.preferred_lang === 'pt' ? 'selected' : ''}>🇧🇷 Português</option>
          <option value="ja" ${u.preferred_lang === 'ja' ? 'selected' : ''}>🇯🇵 日本語</option>
        </select>
        <select class="role-select" onclick="event.stopPropagation()" onchange="changeRole('${idEsc}', this.value)">
          <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
        <button class="delete-btn" onclick="event.stopPropagation(); deleteUser('${idEsc}')">✕</button>
      </div>
    </div>
  `;
  }).join('') + '</div>';
}

function filterUsers() { renderUserList(); }

// ── User detail modal ─────────────────────────────────────────

async function openUserDetail(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('modal-user-name').textContent = user.display_name || 'Usuário';

  // Queries em paralelo — reduz latência de abertura do modal.
  // As listas usam .limit() de propósito ("últimos N"); os STAT CARDS não
  // podem usar essas listas (ficavam travados em 50/20) — usam contagens
  // exatas (head:true) e o conjunto completo de pares volume/file (fetchAll).
  const [
    { data: logs },
    { data: positions },
    { data: favs },
    { data: highlights },
    { data: perms },
    { data: allLogPairs },
    { count: favCount },
    { count: hlCount }
  ] = await Promise.all([
    supabase.from('access_logs')
      .select('volume, file, action, created_at, metadata')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('reading_positions')
      .select('volume, file, progress_pct, time_spent_seconds, max_scroll_pct, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(50),
    supabase.from('synced_favorites')
      .select('volume, file, topic_title, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('user_highlights')
      .select('volume, file, text, color, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(20),
    supabase.from('user_permissions')
      .select('volume, files')
      .eq('user_id', userId),
    fetchAll(() => supabase.from('access_logs')
      .select('volume, file')
      .eq('user_id', userId)),
    supabase.from('synced_favorites')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabase.from('user_highlights')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
  ]);

  const totalViews = (allLogPairs || []).length;
  const uniqueTeachings = new Set((allLogPairs || []).map(l => `${l.volume}/${l.file}`)).size;

  let html = `
    <div class="stats-grid" style="margin-bottom:24px;">
      <div class="stat-card"><div class="stat-value">${totalViews}</div><div class="stat-label">Visualizações</div></div>
      <div class="stat-card"><div class="stat-value">${uniqueTeachings}</div><div class="stat-label">Ensinamentos</div></div>
      <div class="stat-card"><div class="stat-value">${favCount || 0}</div><div class="stat-label">Salvos</div></div>
      <div class="stat-card"><div class="stat-value">${hlCount || 0}</div><div class="stat-label">Destaques</div></div>
    </div>
    <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:16px;">
      <strong>Restrições:</strong> ${(perms || []).map(p => `${VOL_SHORT[p.volume] || p.volume}: ${p.files === null ? 'todos' : p.files.length + ' arquivos'}`).join(', ') || 'Nenhuma'}
    </p>
  `;

  // Dispositivos usados — device vem de access_logs.metadata.device (coletado
  // a partir de 05/06/2026). Deriva dos logs recentes; o mais novo (logs[0],
  // ordenado desc) é o "último usado". Esconde se só houver dado desconhecido.
  {
    const DEV_LABELS = { desktop: '🖥️ Desktop', mobile: '📱 Celular', tablet: '📲 Tablet', desconhecido: '❔ Desconhecido' };
    const DEV_ORDER = ['desktop', 'mobile', 'tablet', 'desconhecido'];
    const devNorm = (d) => (d === 'desktop' || d === 'mobile' || d === 'tablet') ? d : 'desconhecido';
    const devCounts = {};
    let lastDevice = null;
    (logs || []).forEach((l, i) => {
      const d = devNorm(l.metadata?.device);
      devCounts[d] = (devCounts[d] || 0) + 1;
      if (i === 0) lastDevice = d;
    });
    const present = DEV_ORDER.filter(k => devCounts[k]);
    const hasReal = present.some(k => k !== 'desconhecido');
    if (present.length && hasReal) {
      const chips = present.map(k => {
        const isLast = k === lastDevice;
        return `<span style="font-size:0.8rem; padding:3px 10px; border-radius:6px; background:var(--bg); border:1px solid var(--border); ${isLast ? 'font-weight:600; color:var(--accent);' : 'color:var(--text-muted);'}">${DEV_LABELS[k]} · ${devCounts[k]}</span>`;
      }).join('');
      html += `
        <h4 style="margin:16px 0 8px; font-size:0.85rem;">Dispositivos <span style="font-weight:400; color:var(--text-muted); font-size:0.72rem;">(destacado = último usado · últimos ${(logs || []).length} acessos)</span></h4>
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">${chips}</div>`;

      // Aparelho detalhado (os/navegador/modelo) — campos novos a partir de
      // 06/06/2026. Pega o log mais recente que já os tenha. iPhone/iPad não
      // expõem modelo (Apple oculta). Só renderiza se houver algum dado real.
      const detailed = (logs || []).find(l => l.metadata && (l.metadata.os || l.metadata.browser || l.metadata.model));
      if (detailed) {
        const md = detailed.metadata;
        const join = (a, b) => [a, b].filter(Boolean).join(' ');
        const parts = [
          md.model ? `📦 ${_escHtml(md.model)}` : '',
          join(md.os, md.os_version) ? `💠 ${_escHtml(join(md.os, md.os_version))}` : '',
          join(md.browser, md.browser_version) ? `🌐 ${_escHtml(join(md.browser, md.browser_version))}` : ''
        ].filter(Boolean);
        if (parts.length) {
          html += `<p style="font-size:0.78rem; color:var(--text-muted); margin:0 0 8px; display:flex; flex-wrap:wrap; gap:12px;">${parts.map(p => `<span>${p}</span>`).join('')}</p>`;
        }
      }
    }
  }

  if (positions && positions.length > 0) {
    const fmtDur = (s) => {
      const n = Number(s) || 0;
      if (n < 60) return `${n}s`;
      const m = Math.round(n / 60);
      if (m < 60) return `${m} min`;
      return `${Math.floor(m / 60)}h ${m % 60}min`;
    };
    // "Dificuldade" = ficou bastante tempo mas leu pouco do texto.
    // Usa max_scroll_pct (high-water mark de scroll), não progress_pct
    // (este é por tópicos navegados — ruidoso). Régua: ≥10 min ativo e
    // rolagem registrada entre 1% e 39%.
    // IMPORTANTE: scrollPct === 0 = SEM DADO de rolagem, NÃO "leu nada".
    // A captura de scroll só foi ao ar em 13/05/2026 (~3 semanas depois do
    // time_spent_seconds, que é cumulativo all-time) e alguns leitores ainda
    // não capturavam. Exigir scrollPct > 0 evita falso positivo em leituras
    // antigas / sem captura (era o que pintava de vermelho quem só tinha
    // tempo acumulado anterior à feature).
    const scored = positions.map(p => {
      const sec = Number(p.time_spent_seconds) || 0;
      const scrollPct = Number(p.max_scroll_pct) || 0;
      const topicPct = Number(p.progress_pct) || 0;
      const struggling = sec >= 10 * 60 && scrollPct > 0 && scrollPct < 40;
      return { ...p, _sec: sec, _scrollPct: scrollPct, _topicPct: topicPct, _struggling: struggling };
    }).sort((a, b) => {
      const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return tb - ta;
    });

    const strugglingCount = scored.filter(p => p._struggling).length;
    const note = strugglingCount > 0
      ? `<span style="color:#c0392b; font-weight:600;"> — ${strugglingCount} com possível dificuldade</span>`
      : '';
    html += `<h4 style="margin:16px 0 8px; font-size:0.85rem;">Progresso de Leitura${note}</h4>`;
    html += `<p style="font-size:0.75rem; color:var(--text-muted); margin:0 0 8px;">"Leu" = scroll máximo (quanto do texto foi exposto); "—" = sem dados de rolagem (leitura antiga ou leitor sem captura). "Tempo" é o <strong>total acumulado de todas as sessões</strong>, não de uma única leitura. Linhas em vermelho: ≥10 min com rolagem registrada &lt;40%.</p>`;
    html += `<table class="data-table"><thead><tr><th>Volume</th><th>Ensinamento</th><th title="Scroll máximo no texto">Leu</th><th title="Tópicos navegados (não confiável p/ artigos curtos)">Tópicos</th><th title="Total acumulado de todas as sessões — não é uma leitura única">Tempo total</th><th>Última leitura</th></tr></thead><tbody>`;
    scored.forEach(p => {
      const rowStyle = p._struggling ? ' style="background:rgba(192,57,43,0.08);"' : '';
      const readStyle = p._struggling ? ' style="color:#c0392b; font-weight:600;"' : '';
      const last = p.updated_at ? new Date(p.updated_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
      // scrollPct === 0 = sem captura de rolagem (≠ "leu 0%"): mostra "—".
      const leuCell = p._scrollPct > 0
        ? `${p._scrollPct}%`
        : `<span style="color:var(--text-muted);" title="Sem dados de rolagem (leitura anterior a 13/05/2026 ou leitor sem captura de scroll)">—</span>`;
      html += `<tr${rowStyle}><td>${VOL_SHORT[p.volume] || p.volume}</td><td style="font-size:0.82rem;" title="${_escHtml(p.file || '')}">${_escHtml(getFileTitle(p.volume, p.file))}</td><td${readStyle}>${leuCell}</td><td style="color:var(--text-muted);">${p._topicPct}%</td><td>${fmtDur(p._sec)}</td><td style="font-size:0.8rem; color:var(--text-muted);">${last}</td></tr>`;
    });
    html += `</tbody></table>`;
  }


  document.getElementById('modal-user-content').innerHTML = html;
  document.getElementById('user-detail-modal').classList.add('open');
}

function closeUserDetail() {
  document.getElementById('user-detail-modal').classList.remove('open');
}

// ── Select user & permission editor ───────────────────────────

async function selectUser(userId) {
  setSelectedUserId(userId);
  renderUserList();

  const title = document.getElementById('perm-editor-title');
  const user = allUsers.find(u => u.id === userId);
  title.textContent = `Restrições — ${user?.display_name || 'Usuário'}`;

  const { data: perms } = await supabase
    .from('user_permissions')
    .select('volume, files')
    .eq('user_id', userId);

  const permMap = {};
  for (const p of (perms || [])) {
    permMap[p.volume] = p.files === null ? 'all' : p.files;
  }

  const volumesDiv = document.getElementById('perm-volumes');
  volumesDiv.innerHTML = VOLUMES.map(vol => {
    const isBlocked = permMap[vol.key] !== undefined; // In blacklist, presence means blocked completely or partially
    const isAllBlocked = permMap[vol.key] === 'all';
    const blockedFiles = isAllBlocked ? new Set() : new Set(permMap[vol.key] || []);
    const categories = volumeCategories[vol.key] || {};

    const totalFiles = Object.values(categories).reduce((sum, files) => sum + files.length, 0);
    const blockedCount = isAllBlocked ? totalFiles : Object.values(categories).reduce((sum, files) => sum + files.filter(f => blockedFiles.has(f.file)).length, 0);

    const volKeyEsc = _escHtml(vol.key);
    return `
      <div class="vol-block" data-vol="${volKeyEsc}">
        <div class="vol-header" onclick="this.nextElementSibling.classList.toggle('open')">
          <input type="checkbox" ${isBlocked ? 'checked' : ''} onchange="toggleVolume('${volKeyEsc}', this.checked)">
          <span class="vol-title">${_escHtml(vol.name)}</span>
          <span style="font-size:0.75rem; color:var(--text-muted);">${isAllBlocked ? 'Todos bloqueados' : blockedCount + '/' + totalFiles + ' bloqueados'}</span>
        </div>
        <div class="vol-body">
          <div style="margin-bottom:12px;">
            <label style="font-size:0.82rem; cursor:pointer; color:#e05252; font-weight:600;">
              <input type="checkbox" ${isAllBlocked ? 'checked' : ''} onchange="toggleAllFiles('${volKeyEsc}', this.checked)">
              Bloquear todo o volume
            </label>
          </div>
          ${Object.entries(categories).map(([sectionName, files]) => {
            const sectionAllBlocked = isAllBlocked || files.every(f => blockedFiles.has(f.file));
            const sectionSomeBlocked = !sectionAllBlocked && files.some(f => blockedFiles.has(f.file));
            return `
              <div class="vol-block" style="margin-bottom:8px;">
                <div class="vol-header" onclick="this.nextElementSibling.classList.toggle('open')" style="padding:8px 12px; border-color:${sectionSomeBlocked || sectionAllBlocked ? 'rgba(224,82,82,0.3)' : 'var(--border)'}; background:${sectionSomeBlocked || sectionAllBlocked ? 'rgba(224,82,82,0.03)' : 'transparent'}">
                  <input type="checkbox" ${sectionAllBlocked ? 'checked' : ''} ${sectionSomeBlocked && !sectionAllBlocked ? 'style="opacity:0.5"' : ''} onchange="toggleSection('${volKeyEsc}', this.checked, this)">
                  <span class="vol-title" style="font-size:0.85rem; color:${sectionSomeBlocked || sectionAllBlocked ? '#e05252' : ''}">${_escHtml(sectionName)}</span>
                  <span style="font-size:0.7rem; color:var(--text-muted);">${files.length} itens</span>
                </div>
                <div class="vol-body" style="padding:8px 12px;">
                  <div class="file-list" id="files-${volKeyEsc}">
                    ${files.map(f => {
                      const isBlockedItem = blockedFiles.has(f.file) || isAllBlocked;
                      const fileEsc = _escHtml(f.file);
                      return `
                      <div class="file-item">
                        <input type="checkbox" id="file-${volKeyEsc}-${fileEsc}" value="${fileEsc}" data-vol="${volKeyEsc}" ${isBlockedItem ? 'checked' : ''}>
                        <label for="file-${volKeyEsc}-${fileEsc}" style="${isBlockedItem ? 'text-decoration:line-through; opacity:0.6; color:#e05252;' : ''}">${f.num != null ? `<span class="file-num">${_escHtml(f.num)}</span>` : ''}${_escHtml(f.title)}</label>
                      </div>
                    `}).join('')}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Fix: era `editor.classList.add('open')` — variável `editor` nunca
  // foi declarada (bug latente que dava ReferenceError silencioso). Agora
  // resolve corretamente.
  document.getElementById('perm-editor').classList.add('open');
}

function toggleVolume(vol, enabled) {
  const volBlock = document.querySelector(`.vol-block[data-vol="${vol}"]`);
  if (!volBlock) return;
  const body = volBlock.querySelector('.vol-body');
  body.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.checked = enabled;
    cb.disabled = false;
  });
}

function toggleAllFiles(vol, all) {
  const volBlock = document.querySelector(`.vol-block[data-vol="${vol}"]`);
  if (!volBlock) return;
  const fileCheckboxes = volBlock.querySelectorAll('.file-list input[type=checkbox]');
  fileCheckboxes.forEach(cb => { cb.checked = all; });
}

function toggleSection(vol, checked, headerCheckbox) {
  const volBlock = headerCheckbox.closest('.vol-block');
  if (!volBlock) return;
  const fileCheckboxes = volBlock.querySelectorAll('.file-list input[type=checkbox]');
  fileCheckboxes.forEach(cb => { cb.checked = checked; });
}

// ── Default Permissions Panel ─────────────────────────────────

function toggleDefaultPermPanel() {
  const body = document.getElementById('default-perm-body');
  const header = document.getElementById('default-perm-header');
  const chevron = document.getElementById('default-perm-chevron');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  header.classList.toggle('open', !isOpen);
  chevron.classList.toggle('open', !isOpen);
}

// Legacy key — só lido uma vez para migrar o config antigo (por-navegador)
// para o admin_settings compartilhado. Depois disso é ignorado.
const DEFAULT_PERM_LEGACY_KEY = 'mioshie_admin_default_perms';
const DEFAULT_PERM_SETTING_KEY = 'default_permissions';

let _saveDefaultPermTimer = null;
function saveDefaultPermState() {
  // Debounce — os handlers inline disparam em cascata (toggleDefaultVolume
  // chama saveDefaultPermState para cada file cb). 150ms agrupa tudo em
  // um único upsert.
  clearTimeout(_saveDefaultPermTimer);
  _saveDefaultPermTimer = setTimeout(async () => {
    const panel = document.getElementById('default-perm-volumes');
    if (!panel) return;
    const state = {};
    panel.querySelectorAll(':scope > .vol-block').forEach(volBlock => {
      const volKey = volBlock.dataset.vol;
      const allCb = volBlock.querySelector(':scope > .vol-body > div:first-child input[type=checkbox]');
      const files = Array.from(volBlock.querySelectorAll('.file-list input[type=checkbox]:checked')).map(cb => cb.value);
      state[volKey] = { blockAll: allCb?.checked || false, files };
    });
    const { error } = await supabase.from('admin_settings').upsert({
      key: DEFAULT_PERM_SETTING_KEY,
      value: state,
      updated_at: new Date().toISOString(),
      updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    }, { onConflict: 'key' });
    if (error) console.error('[saveDefaultPermState] Supabase:', error.message);
  }, 150);
}

async function restoreDefaultPermState() {
  let state = null;

  const { data, error } = await supabase
    .from('admin_settings')
    .select('value')
    .eq('key', DEFAULT_PERM_SETTING_KEY)
    .maybeSingle();
  if (error) {
    console.error('[restoreDefaultPerm] Supabase:', error.message);
    return;
  }
  if (data?.value) {
    state = data.value;
  } else {
    // Fallback: se havia config legacy em localStorage (admin anterior à
    // migração), importa e persiste no Supabase para os outros admins.
    const legacy = localStorage.getItem(DEFAULT_PERM_LEGACY_KEY);
    if (legacy) {
      try {
        state = JSON.parse(legacy);
        await supabase.from('admin_settings').upsert({
          key: DEFAULT_PERM_SETTING_KEY,
          value: state,
          updated_at: new Date().toISOString(),
          updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        }, { onConflict: 'key' });
        localStorage.removeItem(DEFAULT_PERM_LEGACY_KEY);
      } catch (e) {
        console.error('[restoreDefaultPerm] legacy parse:', e);
      }
    }
  }

  if (!state) return;

  try {
    const panel = document.getElementById('default-perm-volumes');
    if (!panel) return;
    Object.entries(state).forEach(([volKey, config]) => {
      const volBlock = panel.querySelector(`.vol-block[data-vol="${volKey}"]`);
      if (!volBlock) return;
      if (config.blockAll) {
        const allCb = volBlock.querySelector(':scope > .vol-body > div:first-child input[type=checkbox]');
        if (allCb) allCb.checked = true;
        volBlock.querySelectorAll('.file-list input[type=checkbox]').forEach(cb => { cb.checked = true; });
      } else if (config.files?.length > 0) {
        config.files.forEach(fileVal => {
          const cb = panel.querySelector(`.file-list input[data-vol="${volKey}"][value="${fileVal}"]`);
          if (cb) cb.checked = true;
        });
      }
      volBlock.querySelectorAll('.file-list input[type=checkbox]').forEach(cb => updateParentChecks(cb));
    });
  } catch(e) { console.error('[restoreDefaultPerm]', e); }
}

function renderDefaultPermVolumes() {
  const volumesDiv = document.getElementById('default-perm-volumes');
  if (!volumesDiv) return;

  volumesDiv.innerHTML = VOLUMES.map(vol => {
    const categories = volumeCategories[vol.key] || {};
    const totalFiles = Object.values(categories).reduce((sum, files) => sum + files.length, 0);

    const volKeyEsc = _escHtml(vol.key);
    return `
      <div class="vol-block" data-vol="${volKeyEsc}" data-context="default">
        <div class="vol-header" onclick="this.nextElementSibling.classList.toggle('open')">
          <input type="checkbox" onchange="toggleDefaultVolume('${volKeyEsc}', this.checked); saveDefaultPermState()">
          <span class="vol-title">${_escHtml(vol.name)}</span>
          <span style="font-size:0.75rem; color:var(--text-muted);">0/${totalFiles}</span>
        </div>
        <div class="vol-body">
          <div style="margin-bottom:12px;">
            <label style="font-size:0.82rem; cursor:pointer; color:#e05252; font-weight:600;">
              <input type="checkbox" onchange="toggleDefaultAllFiles('${volKeyEsc}', this.checked); saveDefaultPermState()">
              Bloquear todo o volume
            </label>
          </div>
          ${Object.entries(categories).map(([sectionName, files]) => `
            <div class="vol-block" style="margin-bottom:8px;">
              <div class="vol-header" onclick="this.nextElementSibling.classList.toggle('open')" style="padding:8px 12px;">
                <input type="checkbox" onchange="toggleDefaultSection('${volKeyEsc}', this.checked, this); saveDefaultPermState(); updateParentChecks(this)">
                <span class="vol-title" style="font-size:0.85rem;">${_escHtml(sectionName)}</span>
                <span style="font-size:0.7rem; color:var(--text-muted);">${files.length} itens</span>
              </div>
              <div class="vol-body" style="padding:8px 12px;">
                <div class="file-list">
                  ${files.map(f => `
                    <div class="file-item">
                      <input type="checkbox" id="dpf-${volKeyEsc}-${_escHtml(f.file)}" value="${_escHtml(f.file)}" data-vol="${volKeyEsc}" data-ctx="default" onchange="saveDefaultPermState(); updateParentChecks(this)">
                      <label for="dpf-${volKeyEsc}-${_escHtml(f.file)}">${f.num != null ? `<span class="file-num">${_escHtml(f.num)}</span>` : ''}${_escHtml(f.title)}</label>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  restoreDefaultPermState();
}

function toggleDefaultVolume(vol, enabled) {
  const panel = document.getElementById('default-perm-volumes');
  const volBlock = panel?.querySelector(`.vol-block[data-vol="${vol}"]`);
  if (!volBlock) return;
  volBlock.querySelectorAll('.vol-body input[type=checkbox]').forEach(cb => { cb.checked = enabled; });
}

function toggleDefaultAllFiles(vol, all) {
  const panel = document.getElementById('default-perm-volumes');
  const volBlock = panel?.querySelector(`.vol-block[data-vol="${vol}"]`);
  if (!volBlock) return;
  volBlock.querySelectorAll('.file-list input[type=checkbox]').forEach(cb => { cb.checked = all; });
}

function toggleDefaultSection(vol, checked, headerCheckbox) {
  const sectionBlock = headerCheckbox.closest('.vol-block');
  if (!sectionBlock) return;
  const fileCbs = sectionBlock.querySelectorAll('.file-list input[type=checkbox]');
  fileCbs.forEach(cb => { cb.checked = checked; });
  // Sync the volume-level checkbox so parent state stays consistent
  if (fileCbs.length > 0) updateParentChecks(fileCbs[0]);
}

function updateParentChecks(el) {
  // Sync section header checkbox
  const sectionBlock = el.closest('.vol-block:not([data-vol])');
  if (sectionBlock) {
    const sectionHeaderCb = sectionBlock.querySelector(':scope > .vol-header input[type=checkbox]');
    const fileCbs = sectionBlock.querySelectorAll('.file-list input[type=checkbox]');
    if (sectionHeaderCb && fileCbs.length > 0)
      sectionHeaderCb.checked = Array.from(fileCbs).every(cb => cb.checked);
  }
  // Sync volume header checkbox
  const volBlock = el.closest('.vol-block[data-vol]');
  if (volBlock) {
    const volHeaderCb = volBlock.querySelector(':scope > .vol-header input[type=checkbox]');
    const sectionCbs = volBlock.querySelectorAll(':scope > .vol-body > .vol-block > .vol-header input[type=checkbox]');
    if (volHeaderCb && sectionCbs.length > 0)
      volHeaderCb.checked = Array.from(sectionCbs).every(cb => cb.checked);
  }
}

function readDefaultPermConfig() {
  const panel = document.getElementById('default-perm-volumes');
  const perms = [];
  panel?.querySelectorAll(':scope > .vol-block').forEach(volBlock => {
    const volKey = volBlock.dataset.vol;

    const allCheckbox = volBlock.querySelector(':scope > .vol-body > div:first-child input[type=checkbox]');
    if (allCheckbox?.checked) {
      perms.push({ volume: volKey, files: null });
    } else {
      const checked = volBlock.querySelectorAll('.file-list input[type=checkbox]:checked');
      const files = Array.from(checked).map(cb => cb.value);
      if (files.length > 0) perms.push({ volume: volKey, files });
    }
  });
  return perms;
}

async function applyDefaultPermissions() {
  const btn = document.getElementById('apply-all-btn');
  const msg = document.getElementById('apply-all-msg');
  const progressWrap = document.getElementById('apply-all-progress');
  const progressBar = document.getElementById('apply-all-bar');
  const progressLabel = document.getElementById('apply-all-label');

  const defaultPerms = readDefaultPermConfig();

  if (defaultPerms.length === 0) {
    msg.textContent = 'Configure ao menos uma restrição antes de aplicar.';
    msg.className = 'msg err';
    return;
  }

  const nonAdminUsers = allUsers.filter(u => u.role !== 'admin');
  if (nonAdminUsers.length === 0) {
    msg.textContent = 'Nenhum usuário (não-admin) encontrado.';
    msg.className = 'msg err';
    return;
  }

  const totalVols = defaultPerms.map(p => p.volume).join(', ');
  const confirmMsg = `Isso vai sobrescrever e APLICAR RESTRIÇÕES em ${nonAdminUsers.length} usuário(s). Volumes afetados:\n\n${totalVols || 'Nenhum bloqueio será adicionado (acesso total liberado)'}\n\nDeseja continuar?`;
  if (!confirm(confirmMsg)) return;

  btn.disabled = true;
  msg.className = 'msg';
  msg.textContent = '';
  progressWrap.style.display = 'block';

  let done = 0;
  let successes = 0;
  const failures = [];

  for (const user of nonAdminUsers) {
    const pct = Math.round((done / nonAdminUsers.length) * 100);
    progressBar.style.width = pct + '%';
    progressLabel.textContent = `Aplicando para ${user.display_name || user.email} (${done + 1}/${nonAdminUsers.length})...`;

    // Upsert-then-delete-stale — nunca deixa o usuário sem restrições
    // mesmo por uma janela curta. Exige UNIQUE(user_id, volume) — confirmado.
    try {
      if (defaultPerms.length > 0) {
        const rows = defaultPerms.map(p => ({ user_id: user.id, volume: p.volume, files: p.files }));
        const { error: upsertErr } = await supabase
          .from('user_permissions')
          .upsert(rows, { onConflict: 'user_id,volume' });
        if (upsertErr) throw upsertErr;
      }

      // Remove apenas volumes antigos que não estão no default atual.
      // Se defaultPerms estiver vazio, remove tudo (= acesso total intencional).
      const keepVolumes = defaultPerms.map(p => p.volume);
      let delQuery = supabase.from('user_permissions').delete().eq('user_id', user.id);
      if (keepVolumes.length > 0) {
        delQuery = delQuery.not('volume', 'in', `(${keepVolumes.map(v => `"${v}"`).join(',')})`);
      }
      const { error: delErr } = await delQuery;
      if (delErr) {
        // Upsert já funcionou: usuário tem as restrições novas, mas pode
        // ter restrições antigas extras. É um estado MAIS restritivo que o
        // esperado, não menos — não é crítico de segurança.
        throw new Error(`Restrições aplicadas, mas limpeza de antigas falhou: ${delErr.message}`);
      }

      successes++;
    } catch (e) {
      console.error(`[applyDefault] Falhou para ${user.id} (${user.email}):`, e.message);
      failures.push({ user: user.display_name || user.email, reason: e.message, critical: false });
    }

    done++;
  }

  progressBar.style.width = '100%';

  if (failures.length === 0) {
    progressLabel.textContent = `✅ Concluído — ${successes} usuário(s) atualizados.`;
    msg.textContent = `Restrições aplicadas com sucesso para ${successes} usuário(s)!`;
    msg.className = 'msg ok';
    logAdminAction('apply_default_permissions', { usuarios_afetados: successes, volumes: defaultPerms.map(p => p.volume).join(', ') || 'acesso total' });
  } else {
    const preview = failures.slice(0, 3).map(f => `${f.user}: ${f.reason}`).join(' | ');
    const more = failures.length > 3 ? ` (+${failures.length - 3} mais)` : '';
    progressLabel.textContent = `⚠ ${successes} aplicado(s), ${failures.length} falha(s). Verifique o console.`;
    msg.textContent = `${successes}/${done} aplicados. Falhas: ${preview}${more}`;
    msg.className = 'msg err';
  }

  btn.disabled = false;

  setTimeout(() => {
    progressWrap.style.display = 'none';
    progressBar.style.width = '0%';
  }, 5000);
}

async function savePermissions() {
  if (!selectedUserId) return;

  const msg = document.getElementById('save-perm-msg');
  msg.className = 'msg';
  msg.style.display = 'none';

  const { error: delErr } = await supabase.from('user_permissions').delete().eq('user_id', selectedUserId);
  if (delErr) {
    msg.textContent = 'Erro ao limpar permissões: ' + delErr.message;
    msg.classList.add('err');
    msg.style.display = 'block';
    return;
  }

  const perms = [];
  const volBlocks = document.querySelectorAll('#perm-volumes > .vol-block');
  volBlocks.forEach(volBlock => {
    const volKey = volBlock.dataset.vol;
    const volCheckbox = volBlock.querySelector(':scope > .vol-header input[type=checkbox]');
    if (!volCheckbox?.checked) return;

    const allCheckbox = volBlock.querySelector(':scope > .vol-body > div:first-child input[type=checkbox]');
    if (allCheckbox?.checked) {
      perms.push({ user_id: selectedUserId, volume: volKey, files: null });
    } else {
      const fileCheckboxes = volBlock.querySelectorAll('.file-list input[type=checkbox]:checked');
      const files = Array.from(fileCheckboxes).map(cb => cb.value);
      if (files.length > 0) {
        perms.push({ user_id: selectedUserId, volume: volKey, files });
      }
    }
  });

  if (perms.length > 0) {
    const { error } = await supabase.from('user_permissions').insert(perms);
    if (error) {
      msg.textContent = 'Erro: ' + error.message;
      msg.classList.add('err');
      return;
    }
  }

  msg.textContent = 'Permissões salvas!';
  msg.classList.add('ok');
  const savedUser = allUsers.find(u => u.id === selectedUserId);
  logAdminAction('save_permissions', { email: savedUser?.email || selectedUserId, volumes_restritos: perms.length });
  document.getElementById('save-status').textContent = 'Permissões salvas!';
  document.getElementById('save-status').classList.add('saved');
  setTimeout(() => {
    document.getElementById('save-status').textContent = '';
    document.getElementById('save-status').classList.remove('saved');
  }, 3000);
}

function closePermEditor() {
  document.getElementById('perm-editor').classList.remove('open');
  setSelectedUserId(null);
  renderUserList();
}

async function changeRole(userId, role) {
  // Proteção: admin não pode remover o próprio acesso
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.id === userId && role !== 'admin') {
    alert('Você não pode remover seu próprio acesso de administrador.');
    loadUsers(); // Restaura o select para o valor correto
    return;
  }

  const { data: existing, error: fetchError } = await supabase
    .from('user_profiles').select('role').eq('id', userId).single();
  if (fetchError) {
    alert('Erro ao buscar usuário: ' + fetchError.message);
    return;
  }
  if (existing?.role === role) return;
  if (role === 'admin' && !confirm('Dar permissão de ADMIN para este usuário?')) {
    loadUsers();
    return;
  }

  // Impede rebaixar o último admin do sistema (espelho do check da edge
  // function de delete). Sem isso, poderia ficar sem nenhum administrador.
  if (existing?.role === 'admin' && role !== 'admin') {
    const { count: adminCount, error: countErr } = await supabase
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin');
    if (countErr) {
      alert('Erro ao validar quantidade de admins: ' + countErr.message);
      loadUsers();
      return;
    }
    if ((adminCount ?? 0) <= 1) {
      alert('Não é possível rebaixar o último administrador do sistema.');
      loadUsers();
      return;
    }
  }

  const { error } = await supabase
    .from('user_profiles').update({ role }).eq('id', userId);
  if (error) {
    alert('Erro ao alterar função: ' + error.message);
  } else {
    const targetUser = allUsers.find(u => u.id === userId);
    logAdminAction('change_role', { email: targetUser?.email || userId, de: existing.role, para: role });
  }
  loadUsers();
}

// Troca o idioma preferido (pt/ja) de um usuário pela aba Usuários. A RLS de
// user_profiles só permite o próprio dono atualizar a linha; por isso usamos a
// RPC admin_set_user_lang (SECURITY DEFINER + checagem is_admin) — mesmo padrão
// de admin_get_users. Valor vazio = null (volta ao default do navegador).
async function changeUserLang(userId, lang) {
  const user = allUsers.find(u => u.id === userId);
  const newLang = lang === '' ? null : lang;
  if ((user?.preferred_lang || null) === newLang) return;

  const { error } = await supabase.rpc('admin_set_user_lang', {
    p_user_id: userId,
    p_lang: newLang
  });
  if (error) {
    alert('Erro ao alterar idioma: ' + error.message);
    loadUsers(); // restaura o select para o valor real
    return;
  }
  if (user) user.preferred_lang = newLang;
  logAdminAction('change_user_lang', { email: user?.email || userId, idioma: newLang || '—' });
}

async function deleteUser(userId) {
  if (!confirm('Tem certeza que deseja remover este usuário? Esta ação não pode ser desfeita.')) return;

  const targetUser = allUsers.find(u => u.id === userId);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sessão expirada. Faça login novamente.');

    // admin-delete-user remove de auth.users + todas as tabelas relacionadas
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/admin-delete-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ user_id: userId })
    });

    let result = {};
    try { result = await resp.json(); } catch {}
    if (!resp.ok && resp.status !== 207) throw new Error(result.error || `Erro ${resp.status} ao remover usuário`);
    if (resp.status === 207) console.warn('Remoção parcial:', result.error);
    logAdminAction('delete_user', { email: targetUser?.email || userId, nome: targetUser?.display_name || '—' });
  } catch (err) {
    alert('Erro ao remover usuário: ' + err.message);
    loadUsers();
    return;
  }

  if (selectedUserId === userId) closePermEditor();
  loadUsers();
}

async function resetPassword(userId, email) {
  // Se o email já veio da RPC admin_get_users, não precisa de prompt
  const inputEmail = (email && email.trim())
    ? email
    : prompt('Email do usuário para enviar link de redefinição:', '');
  if (!inputEmail) return;

  const { error } = await supabase.auth.resetPasswordForEmail(inputEmail, {
    redirectTo: window.location.origin + '/mioshie_college_app/reset-password.html'
  });
  if (error) {
    alert('Erro ao enviar link: ' + error.message);
  } else {
    alert(`Link de redefinição enviado para ${inputEmail}.`);
  }
}

const DEFAULT_NEW_PASSWORD = 'Mioshie';

// Mostra/esconde o campo de senha personalizada. Sem o checkbox marcado,
// o usuário é criado com a senha padrão (DEFAULT_NEW_PASSWORD).
function toggleCustomPass() {
  const checked = document.getElementById('new-custom-pass')?.checked;
  const input = document.getElementById('new-password');
  if (!input) return;
  input.style.display = checked ? '' : 'none';
  if (checked) {
    input.value = '';
    input.focus();
  }
}

async function addUser() {
  const name = document.getElementById('new-name').value.trim();
  const email = document.getElementById('new-email').value.trim().toLowerCase();
  const useCustom = document.getElementById('new-custom-pass')?.checked;
  const password = useCustom ? document.getElementById('new-password').value : DEFAULT_NEW_PASSWORD;
  const preferred_lang = document.getElementById('new-lang')?.value || null;
  const msg = document.getElementById('add-user-msg');
  const btn = document.getElementById('add-user-btn');

  if (!email) {
    msg.textContent = 'Email é obrigatório.';
    msg.className = 'msg err';
    return;
  }

  if (useCustom && password.length < 6) {
    msg.textContent = 'A senha personalizada deve ter pelo menos 6 caracteres.';
    msg.className = 'msg err';
    return;
  }

  btn.disabled = true;
  msg.className = 'msg';
  msg.style.display = 'none';

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sessão expirada. Faça login novamente.');

    // Usa Edge Function para criar via Admin API — NÃO altera a sessão do admin logado
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/admin-create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ email, password, display_name: name, preferred_lang })
    });

    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Erro ao criar usuário');

    msg.textContent = 'Usuário criado com sucesso!';
    msg.className = 'msg ok';
    logAdminAction('add_user', { email, nome: name || '—' });
    document.getElementById('new-name').value = '';
    document.getElementById('new-email').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('new-custom-pass').checked = false;
    toggleCustomPass();
    document.getElementById('new-lang').value = '';
    loadUsers();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'msg err';
  }

  btn.disabled = false;
}

Object.assign(window, {
  // Volume files (helper exposto pra outros módulos que ainda precisam)
  loadVolumeFiles,
  // User list
  loadUsers,
  filterUsers,
  // User detail
  openUserDetail,
  closeUserDetail,
  // Permission editor
  selectUser,
  toggleVolume,
  toggleAllFiles,
  toggleSection,
  // Default Permissions
  toggleDefaultPermPanel,
  saveDefaultPermState,
  toggleDefaultVolume,
  toggleDefaultAllFiles,
  toggleDefaultSection,
  updateParentChecks,
  applyDefaultPermissions,
  // CRUD
  savePermissions,
  closePermEditor,
  changeRole,
  changeUserLang,
  deleteUser,
  resetPassword,
  addUser,
  toggleCustomPass,
  // helper exposto pra Analytics (que ainda usa via initial bootstrap)
  renderDefaultPermVolumes
});
