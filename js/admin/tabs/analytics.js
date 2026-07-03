// ============================================================
// Analytics central — aba "Análise · Geral" do admin.
// loadAnalytics dispara em paralelo 18 sub-cargas (overview, funnel,
// segmentation, article quality, sessions, volume popularity, top
// teachings, heatmap, completion, recent activity, content protection,
// sync stats, role distribution, daily chart, top users ranking,
// top users by time, engagement by volume, popular favorites,
// retention).
// ============================================================
import { supabase } from '../../supabase-config.js';
import { fetchAll } from '../fetch-all.js';
import { _escHtml, _loadAdminIds, getFileTitle } from '../shared/helpers.js';
import { VOL_SHORT } from '../shared/constants.js';
import { allUsers, _adminIds, volumeCategories } from '../shared/state.js';

// Seções da aba extraídas p/ módulos-irmãos (mesma aba, só organização):
import { loadRecentActivity, loadTopUsersRanking, loadEngagementProfiles, loadTopUsersByTime, loadRetentionRate } from './analytics-sections-users.js?v=1';
import { loadArticleQuality, loadVolumePopularity, loadTopTeachings, loadCompletionRates, loadReadMarksStats, loadContentProtection, loadEngagementByVolume, loadPopularFavorites } from './analytics-sections-content.js?v=1';
import { loadSessionStats, loadHeatmap, loadDeviceBreakdown, loadPushSubscribers, loadSyncStats, loadRoleDistribution, loadDailyActivityChart } from './analytics-sections-platform.js?v=1';

// ── Markup da aba (movido de admin-supabase.html p/ manter o HTML enxuto) ──
// Injetado no import do módulo: roda antes do corpo de admin.js (imports são
// hoisted) e antes de qualquer interação — o DOM final é idêntico ao antigo.
const _TAB_MARKUP = `
              <div style="display:flex; align-items:center; margin-bottom:24px;">
                <h2 style="margin:0;">Analytics</h2>
                <select class="period-select" id="analytics-period" onchange="loadAnalytics()">
                  <option value="all" selected>Todo o período</option>
                  <option value="7">Últimos 7 dias</option>
                  <option value="30">Últimos 30 dias</option>
                  <option value="90">Últimos 90 dias</option>
                  <option value="365">Último ano</option>
                </select>
              </div>

              <!-- Online Users -->
              <div class="online-card" id="online-users-card">
                <div class="online-header">
                  <div class="online-dot"></div>
                  <span class="online-title">Usuários Online / Recentes</span>
                  <span class="online-count" id="online-count">—</span>
                </div>
                <div class="online-list" id="online-list">
                  <div class="loading">Verificando...</div>
                </div>
              </div>

              <!-- Overview -->
              <div class="admin-section">
                <h2>Visão Geral</h2>
                <div class="stats-grid" id="stats-cards">
                  <div class="stat-card">
                    <div class="stat-value" id="stat-total-users">—</div>
                    <div class="stat-label">Total Usuários</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-value" id="stat-active-users">—</div>
                    <div class="stat-label">Ativos (período)</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-value" id="stat-new-users">—</div>
                    <div class="stat-label">Novos (período)</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-value" id="stat-total-views">—</div>
                    <div class="stat-label">Visualizações</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-value" id="stat-teachings-read">—</div>
                    <div class="stat-label">Ensinamentos Únicos</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-value" id="stat-avg-session">—</div>
                    <div class="stat-label">Média/User</div>
                  </div>
                </div>
              </div>

              <!-- Engagement Funnel -->
              <div class="admin-section">
                <h2>🎯 Funil de Engajamento</h2>
                <div id="engagement-funnel">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- User Segmentation -->
              <div class="admin-section">
                <h2>🧭 Segmentação de Usuários</h2>
                <div id="user-segmentation">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Volume Popularity -->
              <div class="admin-section">
                <h2>Popularidade por Volume</h2>
                <div id="volume-chart">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Tabelas de Conteúdo (dropdown) -->
              <div class="admin-section">
                <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
                  <h2 style="margin:0;">Conteúdo</h2>
                  <select class="period-select" id="content-table-selector"
                    onchange="selectAnalyticsTable('content', this.value)">
                    <option value="top-teachings" selected>Ensinamentos Mais Lidos</option>
                    <option value="article-quality">💎 Qualidade por Ensinamento</option>
                    <option value="popular-favorites">⭐ Salvos &amp; Destaques Populares</option>
                  </select>
                </div>
                <div id="top-teachings">
                  <div class="loading">Carregando...</div>
                </div>
                <div id="article-quality" style="display:none;">
                  <div class="loading">Carregando...</div>
                </div>
                <div id="popular-favorites" style="display:none;">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Tabelas de Usuários (dropdown) -->
              <div class="admin-section">
                <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
                  <h2 style="margin:0;">Usuários</h2>
                  <select class="period-select" id="users-table-selector"
                    onchange="selectAnalyticsTable('users', this.value)">
                    <option value="engagement-profiles" selected>🎯 Análise de Engajamento</option>
                    <option value="recent-activity">Atividade Recente</option>
                    <option value="top-users-ranking">👥 Ranking por Leituras (contagem)</option>
                    <option value="top-users-time">⏳ Tempo Total no Site por Usuário</option>
                  </select>
                </div>
                <div id="engagement-profiles">
                  <div class="loading">Carregando...</div>
                </div>
                <div id="recent-activity" style="display:none;">
                  <div class="loading">Carregando...</div>
                </div>
                <div id="top-users-ranking" style="display:none;">
                  <div class="loading">Carregando...</div>
                </div>
                <div id="top-users-time" style="display:none;">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Two col: Heatmap + Completion -->
              <div class="two-col">
                <div class="admin-section">
                  <h2>Atividade por Hora do Dia</h2>
                  <div id="heatmap-chart">
                    <div class="loading">Carregando...</div>
                  </div>
                  <div class="heatmap-labels">
                    <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
                  </div>
                </div>
                <div class="admin-section">
                  <h2>Taxa de Conclusão por Volume</h2>
                  <div id="completion-chart">
                    <div class="loading">Carregando...</div>
                  </div>
                </div>
              </div>

              <!-- Ensinamentos Lidos (botão "Marcar como lido") -->
              <div class="admin-section">
                <h2>📖 Ensinamentos marcados como lido</h2>
                <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:16px;">
                  Marcações do botão “Marcar como lido” no período, por usuário. “Tópicos” conta cada
                  marcação (um volume de referência com muitos sub-tópicos curtos infla esse número);
                  “Publicações” deduplica por volume+arquivo e é o valor comparável ao Ranking de Usuários
                  Mais Ativos (que mede tempo de leitura, não cliques no botão).
                </p>
                <div id="read-marks-stats">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Content Protection (print / copy) -->
              <div class="admin-section">
                <h2>🛡️ Cópias e Impressões</h2>
                <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:16px;">
                  Cópias e impressões registradas no período. Cada evento de cópia (Ctrl+C, recortar ou clique-direito)
                  e
                  cada impressão é contado individualmente.
                </p>
                <div id="content-protection-stats">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Device Breakdown (desktop / mobile / tablet) -->
              <div class="admin-section">
                <h2>📱 Dispositivos de Acesso</h2>
                <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:16px;">
                  De qual tipo de aparelho os discípulos acessam (desktop, celular ou tablet), no período. Coletado a
                  partir de 05/06/2026 — acessos anteriores aparecem como “Desconhecido”.
                </p>
                <div id="device-breakdown">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Web Push: quem ativou os avisos de recomendação -->
              <div class="admin-section">
                <h2>🔔 Avisos Ativados (Web Push)</h2>
                <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:16px;">
                  Quem ativou as notificações de recomendação, em qual aparelho e quando. Cada linha é um
                  aparelho/navegador (a mesma pessoa pode ativar em vários). Lista completa, sem recorte de período.
                </p>
                <div id="push-subscribers">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Daily Activity Line Chart -->
              <div class="admin-section">
                <h2>📈 Atividade Diária</h2>
                <div id="daily-activity-chart">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Session Stats -->
              <div class="admin-section">
                <h2>⏱️ Sessions de Leitura</h2>
                <div id="session-stats">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Engagement by Volume -->
              <div class="admin-section">
                <h2>📊 Engajamento por Volume</h2>
                <div id="engagement-by-volume">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Retention Rate -->
              <div class="admin-section">
                <h2>🔄 Taxa de Retenção</h2>
                <div id="retention-rate">
                  <div class="loading">Carregando...</div>
                </div>
              </div>

              <!-- Storage & Sync Stats -->
              <div class="two-col">
                <div class="admin-section">
                  <h2>Dados Sincronizados</h2>
                  <div id="sync-stats">
                    <div class="loading">Carregando...</div>
                  </div>
                </div>
                <div class="admin-section">
                  <h2>Distribuição por Perfil</h2>
                  <div id="role-distribution">
                    <div class="loading">Carregando...</div>
                  </div>
                </div>
              </div>

            `;
{
  const _tabEl = document.getElementById('tab-analytics');
  if (_tabEl && !_tabEl.firstElementChild) _tabEl.innerHTML = _TAB_MARKUP;
}

// "Todo o período" (padrão) vira um nº de dias REAL — da gênese dos dados até
// hoje — em vez de um valor especial. Assim os 18 sub-loads continuam
// recebendo (days numérico, since ISO) sem nenhum caso especial: o gráfico
// diário e a retenção usam a janela verdadeira, e o .gte(since) pega tudo.
const CDF_GENESIS_MS = Date.UTC(2026, 3, 18); // 18/04/2026 — antes do 1º access_log (20/04)
function getPeriodDays() {
  const v = document.getElementById('analytics-period')?.value || 'all';
  if (v === 'all') return Math.ceil((Date.now() - CDF_GENESIS_MS) / 86400000);
  return parseInt(v);
}

async function loadAnalytics() {
  const days = getPeriodDays();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  await _loadAdminIds();

  loadOnlineUsers();
  loadOverviewStats(days, since);
  loadEngagementFunnel(days, since);
  loadUserSegmentation(days, since);
  loadVolumePopularity(days, since);
  loadTopTeachings(days, since);
  loadArticleQuality(days, since);
  loadHeatmap(days, since);
  loadCompletionRates(days, since);
  loadRecentActivity(days, since);
  loadReadMarksStats(days, since);
  loadContentProtection(days, since);
  loadDeviceBreakdown(days, since);
  loadPushSubscribers();
  loadSyncStats();
  loadRoleDistribution();
  loadDailyActivityChart(days, since);
  loadSessionStats(days, since);
  loadEngagementProfiles(days, since);
  loadTopUsersRanking(days, since);
  loadTopUsersByTime(days, since);
  loadEngagementByVolume(days, since);
  loadPopularFavorites(days, since);
  loadRetentionRate(days, since);
}

// ── Online Users — combina heartbeat (last_seen_at) + access_logs ──────
async function loadOnlineUsers() {
  const now = Date.now();
  const cutoff60 = new Date(now - 60 * 60000).toISOString();

  const [profilesRes, logsRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('id, display_name, last_seen_at')
      .not('last_seen_at', 'is', null)
      .neq('role', 'admin')
      .gte('last_seen_at', cutoff60)
      .order('last_seen_at', { ascending: false }),
    supabase
      .from('access_logs')
      .select('user_id, created_at, volume, file')
      .gte('created_at', cutoff60)
      .order('created_at', { ascending: false })
  ]);

  // userId → { name, lastSeen, lastVol, lastFile }
  const activityMap = new Map();

  for (const p of (profilesRes.data || [])) {
    activityMap.set(p.id, { name: p.display_name, lastSeen: new Date(p.last_seen_at), lastVol: null, lastFile: null });
  }

  // Agrupa logs: guarda o mais recente por usuário (ignorando admins)
  const logLatest = new Map();
  for (const l of (logsRes.data || [])) {
    if (_adminIds.has(l.user_id)) continue;
    const t = new Date(l.created_at);
    if (!logLatest.has(l.user_id) || t > logLatest.get(l.user_id).t)
      logLatest.set(l.user_id, { t, volume: l.volume, file: l.file });
  }

  // Busca nomes de usuários só nos logs
  const unknownIds = [...logLatest.keys()].filter(uid => !activityMap.has(uid));
  if (unknownIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles').select('id, display_name').in('id', unknownIds);
    for (const p of (profiles || [])) {
      const log = logLatest.get(p.id);
      activityMap.set(p.id, { name: p.display_name, lastSeen: log.t, lastVol: log.volume, lastFile: log.file });
    }
  }

  // Usa timestamp mais recente e registra última atividade
  for (const [uid, log] of logLatest) {
    const entry = activityMap.get(uid);
    if (!entry) continue;
    if (log.t > entry.lastSeen) entry.lastSeen = log.t;
    entry.lastVol = log.volume;
    entry.lastFile = log.file;
  }

  const volLabel = v => VOL_SHORT[v] || v || '';

  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
  }

  // Categoriza por recência
  const active = [], recent = [], idle = [];
  for (const [, u] of activityMap) {
    const diff = (now - u.lastSeen.getTime()) / 60000;
    const e = {
      name: u.name || 'Sem nome',
      minutesAgo: Math.round(diff),
      activity: u.lastVol ? `${volLabel(u.lastVol)} · ${getFileTitle(u.lastVol, u.lastFile)}` : null,
      activityTip: u.lastFile || ''
    };
    if (diff <= 10)      active.push({ ...e, status: 'active' });
    else if (diff <= 30) recent.push({ ...e, status: 'recent' });
    else                 idle.push({ ...e, status: 'idle' });
  }

  document.getElementById('online-count').textContent = active.length + recent.length;

  const all = [...active, ...recent, ...idle];
  if (all.length === 0) {
    document.getElementById('online-list').innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted);">Nenhum usuário ativo na última hora.</span>';
    return;
  }

  document.getElementById('online-list').innerHTML = all.map(u => {
    const tooltip = u.activity ? _escHtml(u.activity) : '';
    return `
    <div class="online-user" style="padding:8px 14px;"${tooltip ? ` title="${tooltip}"` : ''}>
      <div style="display:flex; align-items:center; gap:6px; width:100%;">
        <div class="online-user-dot ${u.status}"></div>
        <span class="online-user-name">${_escHtml(u.name)}</span>
        <span class="online-user-time" style="margin-left:auto;">${u.status === 'active' ? 'agora' : u.minutesAgo + ' min atrás'}</span>
      </div>
    </div>`;
  }).join('');
}


async function loadOverviewStats(days, since) {
  // Total users (exclude admins)
  const { count: totalUserCount } = await supabase
    .from('user_profiles')
    .select('*', { count: 'exact', head: true })
    .neq('role', 'admin');
  document.getElementById('stat-total-users').textContent = totalUserCount || 0;

  const { data: activeUsers } = await fetchAll(() => supabase
    .from('access_logs')
    .select('user_id, volume, file')
    .gte('created_at', since));
  const activeFiltered = (activeUsers || []).filter(u => !_adminIds.has(u.user_id));
  const uniqueActive = new Set(activeFiltered.map(u => u.user_id));
  document.getElementById('stat-active-users').textContent = uniqueActive.size;

  const { count: newUsers } = await supabase
    .from('user_profiles')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since)
    .neq('role', 'admin');
  document.getElementById('stat-new-users').textContent = newUsers || 0;

  const totalViews = activeFiltered.length;
  document.getElementById('stat-total-views').textContent = totalViews;

  const uniqueTeachings = new Set(activeFiltered.map(v => `${v.volume}/${v.file}`));
  document.getElementById('stat-teachings-read').textContent = uniqueTeachings.size;

  const avg = uniqueActive.size > 0 ? Math.round(totalViews / uniqueActive.size * 10) / 10 : 0;
  document.getElementById('stat-avg-session').textContent = avg;
}

// ── Engagement Funnel ─────────────────────────────────────────────────
// Cliques → iniciou leitura → leu ≥60s → leu ≥180s. Unidade: par único
// (usuário × artigo) para dar proporções comparáveis entre as etapas.
async function loadEngagementFunnel(days, since) {
  const container = document.getElementById('engagement-funnel');

  const [logsRes, posRes] = await Promise.all([
    fetchAll(() => supabase.from('access_logs').select('user_id, volume, file').gte('created_at', since)),
    fetchAll(() => supabase.from('reading_positions').select('user_id, volume, file, time_spent_seconds, progress_pct').gte('updated_at', since), 'updated_at')
  ]);

  const logs = (logsRes.data || []).filter(r => !_adminIds.has(r.user_id));
  const positions = (posRes.data || []).filter(r => !_adminIds.has(r.user_id));

  const clickedPairs = new Set(logs.map(r => `${r.user_id}|${r.volume}|${r.file}`));
  const uniqueClicks = clickedPairs.size;

  if (uniqueClicks === 0) {
    container.innerHTML = '<div class="loading">Sem cliques no período.</div>';
    return;
  }

  // Indexa o tempo cumulativo por par (user × artigo) para cruzar com os
  // cliques. Se o mesmo par aparece em mais de um row (não deveria, mas
  // por segurança), fica com o maior tempo.
  const timeByPair = new Map();
  for (const r of positions) {
    const key = `${r.user_id}|${r.volume}|${r.file}`;
    const t = r.time_spent_seconds || 0;
    if (t > (timeByPair.get(key) || 0)) timeByPair.set(key, t);
  }

  let started = 0, real = 0, deep = 0;
  for (const key of clickedPairs) {
    const t = timeByPair.get(key) || 0;
    if (t > 0)   started++;
    if (t >= 60) real++;
    if (t >= 180) deep++;
  }

  const bounce = Math.round((1 - real / uniqueClicks) * 100);
  const bounceColor = bounce > 80 ? '#ef4444' : bounce > 60 ? '#f59e0b' : '#10b981';

  const steps = [
    { label: 'Cliques (user × artigo)', value: uniqueClicks, color: 'var(--text-muted)' },
    { label: 'Iniciou leitura (>0s ativos)', value: started, color: '#3b82f6' },
    { label: 'Leitura real (≥60s)', value: real, color: '#10b981' },
    { label: 'Leitura profunda (≥180s)', value: deep, color: '#8b5cf6' },
  ];

  container.innerHTML = `
    <p style="font-size:0.8rem; color:var(--text-muted); margin:-8px 0 14px;">
      Conversão de clique em leitura efetiva, contando pares únicos (usuário × artigo). Tempo é cumulativo na tabela <code>reading_positions</code>, então rows antigos que foram re-acessados no período entram.
    </p>
    <div style="display:grid; gap:10px;">
      ${steps.map(s => {
        const pct = Math.round(s.value / uniqueClicks * 100);
        const rel = (s.value / uniqueClicks * 100).toFixed(1);
        return `
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:180px; font-size:0.8rem; color:var(--text-muted); text-align:right; flex-shrink:0;">${s.label}</div>
            <div class="chart-bar-track" style="flex:1;">
              <div class="chart-bar-fill" style="width:${pct}%; background:${s.color};"></div>
            </div>
            <div style="font-size:0.8rem; font-weight:600; width:110px; text-align:right; flex-shrink:0;">${s.value} <span style="color:var(--text-muted); font-weight:400;">(${rel}%)</span></div>
          </div>`;
      }).join('')}
    </div>
    <div style="margin-top:18px; padding:12px 14px; background:var(--bg); border-radius:8px; border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
      <span style="font-size:0.9rem; color:var(--text-muted);">Taxa de bounce (clique sem leitura ≥60s):</span>
      <span style="font-size:1.35rem; font-weight:600; color:${bounceColor};">${bounce}%</span>
    </div>
  `;
}

// ── User Segmentation ─────────────────────────────────────────────────
// Classifica cada usuário não-admin do período em 4 perfis mutuamente
// exclusivos baseados em tempo médio de leitura, dias distintos de acesso
// e presença de highlights/favoritos.
async function loadUserSegmentation(days, since) {
  const container = document.getElementById('user-segmentation');

  const [logsRes, posRes, hlRes, favRes] = await Promise.all([
    fetchAll(() => supabase.from('access_logs').select('user_id, created_at').gte('created_at', since)),
    fetchAll(() => supabase.from('reading_positions').select('user_id, time_spent_seconds').gte('updated_at', since), 'updated_at'),
    fetchAll(() => supabase.from('user_highlights').select('user_id').gte('updated_at', since), 'updated_at'),
    fetchAll(() => supabase.from('synced_favorites').select('user_id').gte('created_at', since)),
  ]);

  const logs = (logsRes.data || []).filter(r => !_adminIds.has(r.user_id));
  const positions = (posRes.data || []).filter(r => !_adminIds.has(r.user_id));
  const highlights = (hlRes.data || []).filter(r => !_adminIds.has(r.user_id));
  const favs = (favRes.data || []).filter(r => !_adminIds.has(r.user_id));

  // Nome por user_id para tooltip de hover por segmento. allUsers vem do
  // loadUsers() (RPC admin_get_users que junta auth.users + user_profiles),
  // então tem display_name + email reais. Se loadUsers ainda não rodou ou
  // algum id estiver órfão, cai pro fetch direto em user_profiles.
  const nameById = {};
  (Array.isArray(allUsers) ? allUsers : []).forEach(u => {
    nameById[u.id] = u.display_name || u.email || null;
  });
  const activeIds = Array.from(new Set([
    ...logs.map(r => r.user_id),
    ...positions.map(r => r.user_id),
  ]));
  const missing = activeIds.filter(id => !nameById[id]);
  if (missing.length) {
    const { data: profs } = await supabase
      .from('user_profiles')
      .select('id, display_name')
      .in('id', missing);
    (profs || []).forEach(p => { nameById[p.id] = p.display_name || null; });
  }

  if (logs.length === 0) {
    container.innerHTML = '<div class="loading">Sem atividade no período.</div>';
    return;
  }

  // Por usuário: dias distintos, tempo médio, tem highlight/fav?
  const users = {};
  const touch = uid => (users[uid] = users[uid] || { days: new Set(), timeSum: 0, timeCount: 0, hasEngage: false });

  logs.forEach(l => touch(l.user_id).days.add(l.created_at.slice(0, 10)));
  positions.forEach(p => {
    if ((p.time_spent_seconds || 0) > 0) {
      const u = touch(p.user_id);
      u.timeSum += p.time_spent_seconds;
      u.timeCount++;
    }
  });
  highlights.forEach(h => touch(h.user_id).hasEngage = true);
  favs.forEach(f => touch(f.user_id).hasEngage = true);

  const segments = { engaged: [], returning: [], casual: [], skimmer: [] };

  for (const [uid, u] of Object.entries(users)) {
    const avgTime = u.timeCount > 0 ? u.timeSum / u.timeCount : 0;
    const days = u.days.size;
    // Ordem de prioridade: engaged > returning > casual > skimmer
    if (avgTime >= 120 || u.hasEngage) segments.engaged.push(uid);
    else if (days >= 3) segments.returning.push(uid);
    else if (avgTime >= 30) segments.casual.push(uid);
    else segments.skimmer.push(uid);
  }

  const total = Object.values(segments).reduce((a, arr) => a + arr.length, 0);
  const defs = [
    { key: 'engaged',   label: 'Engajados',    desc: '≥120s médios ou marcam destaques/favs', color: '#10b981', emoji: '🔥' },
    { key: 'returning', label: 'Retornantes',  desc: '≥3 dias distintos no período',           color: '#8b5cf6', emoji: '🔄' },
    { key: 'casual',    label: 'Casuais',      desc: 'tempo médio entre 30s e 120s',           color: '#3b82f6', emoji: '👤' },
    { key: 'skimmer',   label: 'Skimmers',     desc: '<30s médios — clicam sem ler',           color: '#ef4444', emoji: '⚡' },
  ];

  container.innerHTML = `
    <p style="font-size:0.8rem; color:var(--text-muted); margin:-8px 0 14px;">
      ${total} usuários ativos no período, classificados por comportamento de leitura. Ordem: engajados → retornantes → casuais → skimmers (primeira condição ganha).
    </p>
    <div class="stats-grid" style="margin-bottom:18px;">
      ${defs.map(d => {
        const ids = segments[d.key];
        const count = ids.length;
        const pct = total > 0 ? Math.round(count / total * 100) : 0;
        const names = ids
          .map(uid => nameById[uid] || 'Usuário sem nome')
          .sort((a, b) => a.localeCompare(b, 'pt-BR'));
        const tip = count === 0
          ? `${d.label}: ninguém no período`
          : `${d.label} (${count}):\n• ${names.join('\n• ')}`;
        return `
          <div class="stat-card" style="border-top:3px solid ${d.color}; cursor:help;" title="${_escHtml(tip)}">
            <div class="stat-value" style="color:${d.color};">${d.emoji} ${count}</div>
            <div class="stat-label">${d.label} <span style="opacity:0.6;">(${pct}%)</span></div>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px;">${d.desc}</div>
          </div>`;
      }).join('')}
    </div>
  `;
}


// Dois dropdowns independentes — "Conteúdo" e "Usuários" — alternam qual
// tabela do grupo aparece (todas já carregadas por loadAnalytics; o select só
// troca a vista). Cada grupo é toggleado isoladamente p/ não esconder a tabela
// do outro dropdown.
const _ANALYTICS_TABLE_GROUPS = {
  content: ['top-teachings', 'article-quality', 'popular-favorites'],
  users: ['engagement-profiles', 'recent-activity', 'top-users-ranking', 'top-users-time']
};
function selectAnalyticsTable(group, id) {
  (_ANALYTICS_TABLE_GROUPS[group] || []).forEach(x => {
    const el = document.getElementById(x);
    if (el) el.style.display = (x === id) ? '' : 'none';
  });
}

// Só loadAnalytics, loadOnlineUsers e selectAnalyticsTable são expostos:
// loadAnalytics é o entry point chamado pelo switchTab; loadOnlineUsers é
// re-disparado a cada 60s pelo intervalo setado em switchTab (admin.js);
// selectAnalyticsTable é o onchange do dropdown de tabelas detalhadas.
Object.assign(window, {
  loadAnalytics,
  loadOnlineUsers,
  selectAnalyticsTable
});
