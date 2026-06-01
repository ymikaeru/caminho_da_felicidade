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
import { _escHtml, _loadAdminIds, getFileTitle } from '../shared/helpers.js';
import { VOLUMES, VOL_SHORT } from '../shared/constants.js';
import { allUsers, _adminIds, volumeCategories } from '../shared/state.js';

function getPeriodDays() {
  return parseInt(document.getElementById('analytics-period')?.value || '30');
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
  loadContentProtection(days, since);
  loadSyncStats();
  loadRoleDistribution();
  loadDailyActivityChart(days, since);
  loadSessionStats(days, since);
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

  const { data: activeUsers } = await supabase
    .from('access_logs')
    .select('user_id, volume, file')
    .gte('created_at', since);
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
    supabase.from('access_logs').select('user_id, volume, file').gte('created_at', since),
    supabase.from('reading_positions').select('user_id, volume, file, time_spent_seconds, progress_pct').gte('updated_at', since)
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
    supabase.from('access_logs').select('user_id, created_at').gte('created_at', since),
    supabase.from('reading_positions').select('user_id, time_spent_seconds').gte('updated_at', since),
    supabase.from('user_highlights').select('user_id').gte('updated_at', since),
    supabase.from('synced_favorites').select('user_id').gte('created_at', since),
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

// ── Article Quality ───────────────────────────────────────────────────
// Top 15 ensinamentos por score de qualidade. Score combina tempo médio
// de leitura, progresso médio e engajamento (highlights + favoritos).
async function loadArticleQuality(days, since) {
  const container = document.getElementById('article-quality');

  const [logsRes, posRes, hlRes, favRes] = await Promise.all([
    supabase.from('access_logs').select('user_id, volume, file').gte('created_at', since),
    supabase.from('reading_positions').select('user_id, volume, file, time_spent_seconds, progress_pct').gte('updated_at', since),
    supabase.from('user_highlights').select('user_id, volume, file').gte('updated_at', since),
    supabase.from('synced_favorites').select('user_id, volume, file').gte('created_at', since),
  ]);

  const logs = (logsRes.data || []).filter(r => !_adminIds.has(r.user_id));
  const positions = (posRes.data || []).filter(r => !_adminIds.has(r.user_id));
  const highlights = (hlRes.data || []).filter(r => !_adminIds.has(r.user_id));
  const favs = (favRes.data || []).filter(r => !_adminIds.has(r.user_id));

  if (logs.length === 0) {
    container.innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const arts = {};
  const keyFor = r => `${r.volume}/${r.file}`;
  const touch = r => (arts[keyFor(r)] = arts[keyFor(r)] || {
    volume: r.volume, file: r.file,
    views: 0, readers: new Set(),
    timeSum: 0, timeCount: 0,
    progSum: 0, progCount: 0, completed: 0,
    highlights: 0, favs: 0,
  });

  logs.forEach(l => { const a = touch(l); a.views++; a.readers.add(l.user_id); });
  positions.forEach(p => {
    const a = touch(p);
    if ((p.time_spent_seconds || 0) > 0) { a.timeSum += p.time_spent_seconds; a.timeCount++; }
    if ((p.progress_pct || 0) > 0) {
      a.progSum += p.progress_pct; a.progCount++;
      if (p.progress_pct >= 70) a.completed++;
    }
  });
  highlights.forEach(h => touch(h).highlights++);
  favs.forEach(f => touch(f).favs++);

  // Score period-aware: 50% views_no_periodo + 30% conclusao + 20% engajamento.
  // avgTime sai do score (é acumulador all-time, não respeita o período);
  // continua na tabela como coluna informativa.
  const rows = Object.values(arts).map(a => {
    const avgTime = a.timeCount > 0 ? a.timeSum / a.timeCount : 0;
    const avgProg = a.progCount > 0 ? a.progSum / a.progCount : 0;
    const complRate = a.progCount > 0 ? a.completed / a.progCount : 0;
    const engage = a.highlights + a.favs;
    return { ...a, readers: a.readers.size, avgTime, avgProg, complRate, engage };
  }).filter(a => a.views >= 2); // filtra artigos com 1 view só (ruído)

  if (rows.length === 0) {
    container.innerHTML = '<div class="loading">Sem artigos com dados suficientes.</div>';
    return;
  }

  const maxViews = Math.max(...rows.map(r => r.views), 1);
  const maxEngage = Math.max(...rows.map(r => r.engage), 1);
  rows.forEach(r => {
    r.score = Math.round((0.5 * (r.views / maxViews) + 0.3 * r.complRate + 0.2 * (r.engage / maxEngage)) * 100);
  });
  rows.sort((a, b) => b.score - a.score);
  const top = rows.slice(0, 15);

  // Garante que o mapa volume→file→title esteja carregado para getFileTitle
  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
  }

  const fmtTime = s => s < 60 ? `${Math.round(s)}s` : `${Math.floor(s/60)}m${String(Math.round(s%60)).padStart(2,'0')}s`;

  container.innerHTML = `
    <p style="font-size:0.8rem; color:var(--text-muted); margin:-8px 0 14px;">
      Score = 50% views no período + 30% conclusão (≥70% dos tópicos) + 20% engajamento (highlights + favs). Só artigos com ≥2 views. Tempo médio é acumulado all-time (não respeita o período).
    </p>
    <div style="overflow-x:auto;">
      <table class="data-table">
        <thead>
          <tr>
            <th style="text-align:left;">#</th>
            <th style="text-align:left;">Ensinamento</th>
            <th style="text-align:left;">Volume</th>
            <th>Views</th>
            <th>Leitores</th>
            <th>Tempo méd.</th>
            <th>Progresso méd.</th>
            <th>Concluíram</th>
            <th>⭐ / 🖍️</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          ${top.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td style="text-align:left; font-size:0.82rem;" title="${_escHtml(r.volume)}/${_escHtml(r.file)}">${_escHtml(getFileTitle(r.volume, r.file))}</td>
              <td style="text-align:left;">${VOL_SHORT[r.volume] || r.volume}</td>
              <td>${r.views}</td>
              <td>${r.readers}</td>
              <td>${r.timeCount > 0 ? fmtTime(r.avgTime) : '—'}</td>
              <td>${r.progCount > 0 ? Math.round(r.avgProg) + '%' : '—'}</td>
              <td>${r.progCount > 0 ? Math.round(r.complRate * 100) + '%' : '—'}</td>
              <td>${r.favs} / ${r.highlights}</td>
              <td><strong style="color:var(--accent);">${r.score}</strong></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ── Session Stats ─────────────────────────────────────────────────────
// Agrupa access_logs por usuário, sessões separadas por gap > 30 min.
// Mostra: total de sessions, duração média, artigos por session, distribuição.
async function loadSessionStats(days, since) {
  const container = document.getElementById('session-stats');
  const GAP_MS = 30 * 60 * 1000;

  const { data: raw } = await supabase
    .from('access_logs')
    .select('user_id, created_at, volume, file')
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  const logs = (raw || []).filter(r => !_adminIds.has(r.user_id));

  if (logs.length === 0) {
    container.innerHTML = '<div class="loading">Sem atividade no período.</div>';
    return;
  }

  // Agrupa por usuário ordenado no tempo
  const byUser = {};
  logs.forEach(l => (byUser[l.user_id] = byUser[l.user_id] || []).push(l));

  const sessions = [];
  for (const events of Object.values(byUser)) {
    let cur = null;
    for (const e of events) {
      const t = new Date(e.created_at).getTime();
      if (!cur || (t - cur.lastT) > GAP_MS) {
        if (cur) sessions.push(cur);
        cur = { user: e.user_id, start: t, lastT: t, articles: new Set() };
      } else {
        cur.lastT = t;
      }
      cur.articles.add(`${e.volume}/${e.file}`);
    }
    if (cur) sessions.push(cur);
  }

  const total = sessions.length;
  const durations = sessions.map(s => (s.lastT - s.start) / 1000); // em seg
  const articleCounts = sessions.map(s => s.articles.size);

  const avgDuration = durations.reduce((a, b) => a + b, 0) / total;
  const avgArticles = articleCounts.reduce((a, b) => a + b, 0) / total;

  // Distribuição de artigos por session
  const bucket = { 'Só 1': 0, '2–3': 0, '4–7': 0, '8+': 0 };
  articleCounts.forEach(n => {
    if (n === 1) bucket['Só 1']++;
    else if (n <= 3) bucket['2–3']++;
    else if (n <= 7) bucket['4–7']++;
    else bucket['8+']++;
  });
  const maxBucket = Math.max(...Object.values(bucket), 1);

  const fmtDur = s => s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s/60)}min` : `${(s/3600).toFixed(1)}h`;

  // Estimativa grosseira: sessão com 1 artigo e duração <10s ≈ abandonou logo
  const bounced = sessions.filter(s => s.articles.size === 1 && (s.lastT - s.start) / 1000 < 10).length;
  const bouncePct = Math.round(bounced / total * 100);

  container.innerHTML = `
    <p style="font-size:0.8rem; color:var(--text-muted); margin:-8px 0 14px;">
      Sessions definidas por gap &lt;30min entre cliques do mesmo usuário. Duração = primeiro → último clique (não inclui tempo no último artigo).
    </p>
    <div class="stats-grid" style="margin-bottom:18px;">
      <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Total Sessions</div></div>
      <div class="stat-card"><div class="stat-value">${fmtDur(avgDuration)}</div><div class="stat-label">Duração Média</div></div>
      <div class="stat-card"><div class="stat-value">${avgArticles.toFixed(1)}</div><div class="stat-label">Artigos / Session</div></div>
      <div class="stat-card"><div class="stat-value" style="color:${bouncePct > 50 ? '#ef4444' : bouncePct > 30 ? '#f59e0b' : '#10b981'};">${bouncePct}%</div><div class="stat-label">Saíram em &lt;10s</div></div>
    </div>
    <h3 style="font-size:0.9rem; color:var(--text-muted); margin:0 0 10px;">Profundidade (artigos por session)</h3>
    <div style="display:grid; gap:8px;">
      ${Object.entries(bucket).map(([lbl, val]) => {
        const pct = Math.round(val / maxBucket * 100);
        const share = Math.round(val / total * 100);
        return `
          <div class="chart-bar">
            <div class="chart-bar-label">${lbl} artigo${lbl === 'Só 1' ? '' : 's'}</div>
            <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%;"></div></div>
            <div class="chart-bar-value" style="width:90px;">${val} <span style="color:var(--text-muted); font-weight:400;">(${share}%)</span></div>
          </div>`;
      }).join('')}
    </div>
  `;
}

async function loadVolumePopularity(days, since) {
  const { data } = await supabase
    .from('access_logs')
    .select('volume, user_id')
    .gte('created_at', since);

  const filtered = (data || []).filter(d => !_adminIds.has(d.user_id));
  if (filtered.length === 0) {
    document.getElementById('volume-chart').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const counts = {};
  VOLUMES.forEach(v => counts[v.key] = 0);
  filtered.forEach(d => { if (counts[d.volume] !== undefined) counts[d.volume]++; });
  const max = Math.max(...Object.values(counts), 1);

  document.getElementById('volume-chart').innerHTML = VOLUMES.map(vol => {
    const count = counts[vol.key];
    const pct = Math.round(count / max * 100);
    const shortName = vol.name.split('—')[0].trim();
    return `
      <div class="chart-bar">
        <div class="chart-bar-label">${shortName}</div>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
        <div class="chart-bar-value">${count}</div>
      </div>`;
  }).join('');
}

async function loadTopTeachings(days, since) {
  const { data: raw } = await supabase
    .from('access_logs')
    .select('volume, file, user_id')
    .gte('created_at', since);
  const data = (raw || []).filter(d => !_adminIds.has(d.user_id));

  if (!data.length) {
    document.getElementById('top-teachings').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const counts = {};
  data.forEach(v => {
    const key = `${v.volume}/${v.file}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);

  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
  }

  document.getElementById('top-teachings').innerHTML = `
    <table class="data-table">
      <thead><tr><th>#</th><th>Ensinamento</th><th>Volume</th><th>Visualizações</th></tr></thead>
      <tbody>${sorted.map((item, i) => {
        const [vol, file] = item[0].split('/');
        return `<tr><td>${i + 1}</td><td style="font-size:0.82rem;" title="${_escHtml(file)}">${_escHtml(getFileTitle(vol, file))}</td><td>${VOL_SHORT[vol] || vol}</td><td><strong>${item[1]}</strong></td></tr>`;
      }).join('')}</tbody>
    </table>`;
}

async function loadHeatmap(days, since) {
  const { data: raw } = await supabase
    .from('access_logs')
    .select('created_at, user_id')
    .gte('created_at', since);
  const data = (raw || []).filter(d => !_adminIds.has(d.user_id));

  if (!data.length) {
    document.getElementById('heatmap-chart').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const hourCounts = new Array(24).fill(0);
  data.forEach(d => {
    const h = new Date(d.created_at).getHours();
    hourCounts[h]++;
  });

  const max = Math.max(...hourCounts, 1);

  document.getElementById('heatmap-chart').innerHTML = `
    <div class="heatmap">
      ${hourCounts.map(c => {
        const level = c === 0 ? 0 : c < max * 0.25 ? 1 : c < max * 0.5 ? 2 : c < max * 0.75 ? 3 : 4;
        return `<div class="heatmap-cell" data-level="${level}" title="${c} acessos"></div>`;
      }).join('')}
    </div>`;
}

async function loadCompletionRates(days, since) {
  const { data: raw } = await supabase
    .from('reading_positions')
    .select('volume, progress_pct, user_id')
    .gte('updated_at', since);
  const data = (raw || []).filter(d => !_adminIds.has(d.user_id));

  if (!data.length) {
    document.getElementById('completion-chart').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const volData = {};
  VOLUMES.forEach(v => volData[v.key] = { total: 0, completed: 0 });
  data.forEach(d => {
    if (volData[d.volume]) {
      volData[d.volume].total++;
      if (d.progress_pct >= 90) volData[d.volume].completed++;
    }
  });

  document.getElementById('completion-chart').innerHTML = VOLUMES.map(vol => {
    const d = volData[vol.key];
    const rate = d.total > 0 ? Math.round(d.completed / d.total * 100) : 0;
    const shortName = vol.name.split('—')[0].trim();
    return `
      <div class="chart-bar">
        <div class="chart-bar-label">${shortName}</div>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${rate}%"></div></div>
        <div class="chart-bar-value">${rate}%</div>
      </div>`;
  }).join('');
}

let _recentActivityCtx = null;
const RECENT_ACTIVITY_PAGE_SIZE = 25;

async function loadRecentActivity(days, since) {
  _recentActivityCtx = { since: since || null, cursor: null, items: [], nameCache: {}, exhausted: false };
  document.getElementById('recent-activity').innerHTML = '<div class="loading">Carregando...</div>';
  await _appendMoreRecentActivity();
}

async function _appendMoreRecentActivity() {
  if (!_recentActivityCtx || _recentActivityCtx.exhausted) return;
  const BATCH = 200;
  const target = RECENT_ACTIVITY_PAGE_SIZE;
  const before = _recentActivityCtx.items.length;

  while (_recentActivityCtx.items.length - before < target && !_recentActivityCtx.exhausted) {
    let q = supabase
      .from('access_logs')
      .select('user_id, volume, file, action, created_at')
      .order('created_at', { ascending: false })
      .limit(BATCH);
    if (_recentActivityCtx.since) q = q.gte('created_at', _recentActivityCtx.since);
    if (_recentActivityCtx.cursor) q = q.lt('created_at', _recentActivityCtx.cursor);
    const { data } = await q;
    if (!data || data.length === 0) { _recentActivityCtx.exhausted = true; break; }
    _recentActivityCtx.cursor = data[data.length - 1].created_at;
    const remaining = target - (_recentActivityCtx.items.length - before);
    const filtered = data.filter(d => !_adminIds.has(d.user_id)).slice(0, remaining);
    _recentActivityCtx.items = _recentActivityCtx.items.concat(filtered);
    if (data.length < BATCH) _recentActivityCtx.exhausted = true;
  }

  await _renderRecentActivity();
}

async function _renderRecentActivity() {
  const data = _recentActivityCtx.items;
  if (!data.length) {
    document.getElementById('recent-activity').innerHTML = '<div class="loading">Sem atividade.</div>';
    return;
  }

  const missingIds = [...new Set(data.map(d => d.user_id).filter(id => !(id in _recentActivityCtx.nameCache)))];
  if (missingIds.length) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, display_name')
      .in('id', missingIds);
    (profiles || []).forEach(p => { _recentActivityCtx.nameCache[p.id] = p.display_name; });
  }
  const nameMap = _recentActivityCtx.nameCache;

  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
  }

  const loadMoreBtn = _recentActivityCtx.exhausted
    ? `<div style="text-align:center; margin-top:14px; color:var(--text-muted); font-size:0.8rem;">Fim da atividade no período.</div>`
    : `<div style="text-align:center; margin-top:14px;"><button id="recent-load-more" class="btn-zen" style="padding:8px 20px; font-size:0.85rem;">Carregar mais</button></div>`;

  document.getElementById('recent-activity').innerHTML = `
    <table class="data-table">
      <thead><tr><th>Usuário</th><th>Ação</th><th>Volume</th><th>Ensinamento</th><th>Data</th></tr></thead>
      <tbody>${data.map(d => {
        const date = new Date(d.created_at);
        const dateStr = date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const title = d.file ? getFileTitle(d.volume, d.file) : '—';
        return `<tr><td>${_escHtml(nameMap[d.user_id] || 'Desconhecido')}</td><td>${_escHtml(d.action || '')}</td><td>${VOL_SHORT[d.volume] || d.volume}</td><td style="font-size:0.82rem;" title="${_escHtml(d.file || '')}">${_escHtml(title)}</td><td style="font-size:0.8rem; color:var(--text-muted);">${dateStr}</td></tr>`;
      }).join('')}</tbody>
    </table>${loadMoreBtn}`;

  const btn = document.getElementById('recent-load-more');
  if (btn) btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Carregando...';
    await _appendMoreRecentActivity();
  });
}

async function loadContentProtection(days, since) {
  const container = document.getElementById('content-protection-stats');
  if (!container) return;

  let q = supabase
    .from('access_logs')
    .select('user_id, volume, file, action, created_at, metadata')
    .in('action', ['print', 'copy'])
    .order('created_at', { ascending: false })
    .limit(2000);
  if (since) q = q.gte('created_at', since);
  const { data: raw, error } = await q;
  if (error) {
    container.innerHTML = `<div class="msg err" style="display:block;">Falha ao carregar: ${_escHtml(error.message)}</div>`;
    return;
  }

  const rows = (raw || []).filter(r => !_adminIds.has(r.user_id));
  const prints = rows.filter(r => r.action === 'print');
  const copies = rows.filter(r => r.action === 'copy');

  const byUser = new Map();
  rows.forEach(r => {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { prints: 0, copies: 0, last: r.created_at, lastVol: r.volume, lastFile: r.file });
    const u = byUser.get(r.user_id);
    if (r.action === 'print') u.prints++; else u.copies++;
    if (r.created_at > u.last) { u.last = r.created_at; u.lastVol = r.volume; u.lastFile = r.file; }
  });

  let nameMap = {};
  const userIds = [...byUser.keys()];
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, display_name')
      .in('id', userIds);
    (profiles || []).forEach(p => { nameMap[p.id] = p.display_name; });
  }

  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) {}
  }

  const cardsHtml = `
    <div class="stats-grid" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-value">${copies.length}</div><div class="stat-label">Cópias</div></div>
      <div class="stat-card"><div class="stat-value">${prints.length}</div><div class="stat-label">Impressões</div></div>
      <div class="stat-card"><div class="stat-value">${byUser.size}</div><div class="stat-label">Usuários Envolvidos</div></div>
    </div>`;

  let tableHtml = '';
  if (byUser.size === 0) {
    tableHtml = `<div class="loading">Nenhuma atividade de cópia ou impressão no período.</div>`;
  } else {
    const sortedUsers = [...byUser.entries()]
      .sort((a, b) => (b[1].copies + b[1].prints) - (a[1].copies + a[1].prints));
    tableHtml = `
      <table class="data-table">
        <thead><tr><th>Usuário</th><th>Cópias</th><th>Impressões</th><th>Última Ação</th><th>Último Ensinamento</th></tr></thead>
        <tbody>${sortedUsers.map(([uid, u]) => {
          const date = new Date(u.last);
          const dateStr = date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const title = u.lastFile ? getFileTitle(u.lastVol, u.lastFile) : '—';
          return `<tr>
            <td>${_escHtml(nameMap[uid] || 'Desconhecido')}</td>
            <td style="font-weight:${u.copies ? '600' : '400'};">${u.copies}</td>
            <td style="font-weight:${u.prints ? '600' : '400'};">${u.prints}</td>
            <td style="font-size:0.8rem; color:var(--text-muted);">${dateStr}</td>
            <td style="font-size:0.82rem;" title="${_escHtml(u.lastFile || '')}">${VOL_SHORT[u.lastVol] || u.lastVol || '—'} · ${_escHtml(title)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  // Lista de trechos copiados (com texto, quando disponível)
  const copyRows = copies.filter(r => r.metadata && r.metadata.text);
  let copiesListHtml = '';
  if (copyRows.length > 0) {
    const recentCopies = copyRows.slice(0, 50);
    copiesListHtml = `
      <div style="margin-top:24px;">
        <h3 style="font-size:0.78rem; text-transform:uppercase; letter-spacing:.14em; color:var(--text-muted); margin:0 0 12px; font-weight:600;">📋 Trechos copiados (últimos ${recentCopies.length} de ${copyRows.length})</h3>
        <div style="display:flex; flex-direction:column; gap:10px; max-height:520px; overflow-y:auto; padding-right:6px;">
          ${recentCopies.map(r => {
            const date = new Date(r.created_at);
            const dateStr = date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const title = r.file ? getFileTitle(r.volume, r.file) : '—';
            const text = r.metadata.text || '';
            const length = r.metadata.length || text.length;
            const lengthBadge = length > 2000 ? `<span style="color:#c44;">${length} chars (truncado)</span>` : `${length} chars`;
            return `
              <div style="border:1px solid var(--border); border-radius:10px; padding:12px 14px; background:var(--surface);">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
                  <span style="font-size:0.78rem; font-weight:600; color:var(--accent);">${_escHtml(nameMap[r.user_id] || 'Desconhecido')}</span>
                  <span style="font-size:0.7rem; color:var(--text-muted);">·</span>
                  <span style="font-size:0.72rem; color:var(--text-muted);" title="${_escHtml(r.file || '')}">${VOL_SHORT[r.volume] || r.volume || '—'} · ${_escHtml(title)}</span>
                  <span style="font-size:0.7rem; color:var(--text-muted);">·</span>
                  <span style="font-size:0.72rem; color:var(--text-muted);">${dateStr}</span>
                  <span style="margin-left:auto; font-size:0.68rem; color:var(--text-muted); background:var(--bg); padding:2px 8px; border-radius:4px;">${lengthBadge}</span>
                </div>
                <div style="font-size:0.85rem; line-height:1.55; padding:8px 10px; background:var(--bg); border-radius:6px; white-space:pre-wrap; word-break:break-word; max-height:120px; overflow-y:auto;">${_escHtml(text)}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>`;
  } else if (copies.length > 0) {
    copiesListHtml = `
      <div style="margin-top:24px; padding:14px; background:var(--surface); border:1px solid var(--border); border-radius:10px; font-size:0.82rem; color:var(--text-muted);">
        ⓘ ${copies.length} cópia(s) registrada(s) sem o conteúdo capturado. Cópias futuras já incluirão o texto.
      </div>`;
  }

  container.innerHTML = cardsHtml + tableHtml + copiesListHtml;
}

async function loadSyncStats() {
  const [posRes, favRes, hlRes] = await Promise.all([
    supabase.from('reading_positions').select('*', { count: 'exact', head: true }),
    supabase.from('synced_favorites').select('*', { count: 'exact', head: true }),
    supabase.from('user_highlights').select('*', { count: 'exact', head: true })
  ]);

  document.getElementById('sync-stats').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${posRes.count || 0}</div><div class="stat-label">Posições Salvas</div></div>
      <div class="stat-card"><div class="stat-value">${favRes.count || 0}</div><div class="stat-label">Favoritos</div></div>
      <div class="stat-card"><div class="stat-value">${hlRes.count || 0}</div><div class="stat-label">Destaques</div></div>
    </div>`;
}

async function loadRoleDistribution() {
  const { data } = await supabase.from('user_profiles').select('role');
  if (!data || data.length === 0) {
    document.getElementById('role-distribution').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const counts = {};
  data.forEach(d => counts[d.role] = (counts[d.role] || 0) + 1);
  const total = data.length;
  const max = Math.max(...Object.values(counts), 1);

  document.getElementById('role-distribution').innerHTML = Object.entries(counts).map(([role, count]) => {
    const pct = Math.round(count / max * 100);
    const pctTotal = Math.round(count / total * 100);
    return `
      <div class="chart-bar">
        <div class="chart-bar-label">${role}</div>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
        <div class="chart-bar-value">${count} (${pctTotal}%)</div>
      </div>`;
  }).join('');
}

// ============================================================
// Daily Activity Line Chart
// ============================================================

async function loadDailyActivityChart(days, since) {
  const { data: raw } = await supabase
    .from('access_logs')
    .select('created_at, user_id')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  const data = (raw || []).filter(d => !_adminIds.has(d.user_id));

  const chartEl = document.getElementById('daily-activity-chart');
  if (!data.length) {
    chartEl.innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const dayMap = {};
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    dayMap[key] = 0;
  }

  data.forEach(d => {
    const key = d.created_at.split('T')[0];
    if (dayMap[key] !== undefined) dayMap[key]++;
  });

  const entries = Object.entries(dayMap);
  const values = entries.map(e => e[1]);
  const maxVal = Math.max(...values, 1);
  const chartH = 220;
  const padL = 40;
  const padR = 10;
  const padT = 10;
  const padB = 30;
  // Largura = largura real do container, então o SVG renderiza ~1:1 (altura fixa ≈ svgH),
  // em vez de escalar junto com a tela e ficar gigante em telas largas.
  const svgW = Math.max((chartEl && chartEl.clientWidth) || 900, 320);
  const svgH = chartH + padT + padB;
  const plotW = svgW - padL - padR;
  const plotH = chartH;

  const points = entries.map((e, i) => {
    const x = padL + (i / Math.max(entries.length - 1, 1)) * plotW;
    const y = padT + plotH - (e[1] / maxVal) * plotH;
    return { x, y, val: e[1], date: e[0] };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = linePath + ` L${points[points.length - 1].x},${padT + plotH} L${points[0].x},${padT + plotH} Z`;

  const yTicks = 4;
  let yLines = '';
  for (let i = 0; i <= yTicks; i++) {
    const y = padT + (i / yTicks) * plotH;
    const val = Math.round(maxVal * (1 - i / yTicks));
    yLines += `<line x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
    yLines += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="12">${val}</text>`;
  }

  const labelCount = Math.min(entries.length, 7);
  const labelStep = Math.max(Math.floor(entries.length / labelCount), 1);
  let xLabels = '';
  for (let i = 0; i < entries.length; i += labelStep) {
    const p = points[i];
    const label = entries[i][0].slice(5);
    xLabels += `<text x="${p.x}" y="${svgH - 6}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${label}</text>`;
  }

  const dots = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--accent)" opacity="0.8"><title>${p.date}: ${p.val} views</title></circle>`).join('');

  chartEl.innerHTML = `
    <div class="line-chart-container">
      <svg viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="xMidYMid meet">
        ${yLines}
        <path d="${areaPath}" fill="var(--accent)" opacity="0.08"/>
        <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
        ${dots}
        ${xLabels}
      </svg>
    </div>`;
}

// ============================================================
// Top Users Ranking
// ============================================================

async function loadTopUsersRanking(days, since) {
  // Conta leituras "reais" por TEMPO ATIVO (estilo YouTube): só conta quem
  // ficou ≥ 60 s na página com aba visível e atividade recente.
  const MIN_READ_SECONDS = 20;
  const { data: raw } = await supabase
    .from('reading_positions')
    .select('user_id, volume, file, time_spent_seconds')
    .gte('updated_at', since)
    .gte('time_spent_seconds', MIN_READ_SECONDS);
  const data = (raw || []).filter(d => !_adminIds.has(d.user_id));

  if (!data.length) {
    document.getElementById('top-users-ranking').innerHTML = '<div class="loading">Sem leituras registradas no período.</div>';
    return;
  }

  // Cada entrada única (user, vol, file) é um ensinamento lido
  const reads = {};
  data.forEach(d => {
    if (!reads[d.user_id]) reads[d.user_id] = new Set();
    reads[d.user_id].add(`${d.volume}/${d.file}`);
  });
  const sorted = Object.entries(reads)
    .map(([uid, set]) => [uid, set.size])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const maxReads = sorted[0][1];

  const userIds = sorted.map(s => s[0]);
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, display_name')
    .in('id', userIds);
  const nameMap = {};
  (profiles || []).forEach(p => nameMap[p.id] = p.display_name);

  document.getElementById('top-users-ranking').innerHTML = `
    <p style="font-size:0.75rem; color:var(--text-muted); margin:-8px 0 12px;">Contagem de ensinamentos efetivamente lidos (≥${MIN_READ_SECONDS}s de leitura ativa).</p>
    <div class="ranking-list">
      ${sorted.map(([uid, count], i) => {
        const name = nameMap[uid] || 'Desconhecido';
        const initial = (name || 'U')[0].toUpperCase();
        const pct = Math.round(count / maxReads * 100);
        const posClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
        return `
          <div class="ranking-item">
            <div class="ranking-pos ${posClass}">${i + 1}</div>
            <div class="ranking-avatar">${initial}</div>
            <div class="ranking-info">
              <div class="ranking-name">${_escHtml(name)}</div>
            </div>
            <div class="ranking-bar-track"><div class="ranking-bar-fill" style="width:${pct}%"></div></div>
            <div class="ranking-value">${count} lidos</div>
          </div>`;
      }).join('')}
    </div>`;
}

// ============================================================
// Top Users by Total Time
// ============================================================
// `reading_positions.time_spent_seconds` é cumulativo all-time (cada
// heartbeat soma na linha existente; updated_at só marca o último
// toque). Por isso NÃO filtramos por período — o `since` daria um
// resultado errado: pegaria linhas tocadas no período mas somaria
// tempo histórico inteiro acumulado nelas.
//
// Mostra: top 10 leitores all-time + último acesso (que respeita
// visualmente o filtro de período só pra contexto).
async function loadTopUsersByTime(days, since) {
  const fmtSecs = secs => {
    secs = Math.round(secs || 0);
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.round(secs / 60)} min`;
    const h = Math.floor(secs / 3600);
    const m = Math.round((secs - h * 3600) / 60);
    return m ? `${h}h ${m}min` : `${h}h`;
  };

  const { data: raw } = await supabase
    .from('reading_positions')
    .select('user_id, volume, file, time_spent_seconds, updated_at')
    .gt('time_spent_seconds', 0);
  const data = (raw || []).filter(d => !_adminIds.has(d.user_id));

  if (!data.length) {
    document.getElementById('top-users-time').innerHTML = '<div class="loading">Sem tempo de leitura registrado no período.</div>';
    return;
  }

  // Agrega: total de segundos, ensinamentos distintos, último acesso por usuário
  const byUser = {};
  data.forEach(d => {
    const u = byUser[d.user_id] || (byUser[d.user_id] = { secs: 0, items: new Set(), last: null });
    u.secs += (d.time_spent_seconds || 0);
    u.items.add(`${d.volume}/${d.file}`);
    if (!u.last || d.updated_at > u.last) u.last = d.updated_at;
  });

  const sorted = Object.entries(byUser)
    .map(([uid, u]) => ({ uid, secs: u.secs, items: u.items.size, last: u.last }))
    .sort((a, b) => b.secs - a.secs)
    .slice(0, 10);
  const maxSecs = sorted[0].secs;

  const userIds = sorted.map(s => s.uid);
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, display_name')
    .in('id', userIds);
  const nameMap = {};
  (profiles || []).forEach(p => nameMap[p.id] = p.display_name);

  const fmtRel = iso => {
    if (!iso) return '—';
    const diffMs = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diffMs / 86400000);
    if (days === 0) return 'hoje';
    if (days === 1) return 'ontem';
    if (days < 30) return `há ${days} dias`;
    const months = Math.floor(days / 30);
    return months === 1 ? 'há 1 mês' : `há ${months} meses`;
  };

  document.getElementById('top-users-time').innerHTML = `
    <p style="font-size:0.75rem; color:var(--text-muted); margin:-8px 0 12px;">Tempo total acumulado (all-time) de leitura ativa por usuário. Heartbeat de 15s, só conta com aba visível. Não inclui tempo navegando index/buscas/destaques. O filtro de período no topo não se aplica a este card — só ao "último acesso".</p>
    <div class="ranking-list">
      ${sorted.map((u, i) => {
        const name = nameMap[u.uid] || 'Desconhecido';
        const initial = (name || 'U')[0].toUpperCase();
        const pct = Math.round(u.secs / maxSecs * 100);
        const posClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
        return `
          <div class="ranking-item">
            <div class="ranking-pos ${posClass}">${i + 1}</div>
            <div class="ranking-avatar">${initial}</div>
            <div class="ranking-info">
              <div class="ranking-name">${_escHtml(name)}</div>
              <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${u.items} ensinamentos · último acesso ${fmtRel(u.last)}</div>
            </div>
            <div class="ranking-bar-track"><div class="ranking-bar-fill" style="width:${pct}%"></div></div>
            <div class="ranking-value">${fmtSecs(u.secs)}</div>
          </div>`;
      }).join('')}
    </div>`;
}

// ============================================================
// Engagement by Volume
// ============================================================

async function loadEngagementByVolume(days, since) {
  const [logsRes, posRes] = await Promise.all([
    supabase.from('access_logs').select('volume, user_id').gte('created_at', since),
    supabase.from('reading_positions').select('volume, progress_pct, user_id').gte('updated_at', since)
  ]);

  const logs = (logsRes.data || []).filter(d => !_adminIds.has(d.user_id));
  const positions = (posRes.data || []).filter(d => !_adminIds.has(d.user_id));

  if (logs.length === 0) {
    document.getElementById('engagement-by-volume').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const volStats = {};
  VOLUMES.forEach(v => {
    volStats[v.key] = { views: 0, uniqueUsers: new Set(), totalProgress: 0, progressCount: 0, completed: 0 };
  });

  logs.forEach(l => {
    if (volStats[l.volume]) {
      volStats[l.volume].views++;
      volStats[l.volume].uniqueUsers.add(l.user_id);
    }
  });

  positions.forEach(p => {
    if (volStats[p.volume]) {
      volStats[p.volume].totalProgress += p.progress_pct;
      volStats[p.volume].progressCount++;
      if (p.progress_pct >= 90) volStats[p.volume].completed++;
    }
  });

  document.getElementById('engagement-by-volume').innerHTML = `
    <div class="engagement-grid">
      ${VOLUMES.map(vol => {
        const s = volStats[vol.key];
        const avgProgress = s.progressCount > 0 ? Math.round(s.totalProgress / s.progressCount * 10) / 10 : 0;
        const completionRate = s.progressCount > 0 ? Math.round(s.completed / s.progressCount * 100) : 0;
        return `
          <div class="engagement-card">
            <div class="vol-name">${vol.name.split('—')[0].trim()}</div>
            <div class="engagement-stat">
              <span class="label">Visualizações</span>
              <span class="value">${s.views}</span>
            </div>
            <div class="engagement-stat">
              <span class="label">Usuários únicos</span>
              <span class="value">${s.uniqueUsers.size}</span>
            </div>
            <div class="engagement-stat">
              <span class="label">Progresso médio</span>
              <span class="value">${avgProgress}%</span>
            </div>
            <div class="engagement-stat">
              <span class="label">Taxa conclusão (≥90%)</span>
              <span class="value">${completionRate}%</span>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

// ============================================================
// Popular Favorites & Highlights
// ============================================================

async function loadPopularFavorites(days, since) {
  // Favoritos: ranking all-time (sem filtro de período). Toggle on/off não
  // gera novo created_at, então filtrar por período subestima popularidade.
  // Highlights: filtrado por updated_at, refletindo atividade no período.
  const [favRes, hlRes] = await Promise.all([
    supabase.from('synced_favorites').select('volume, file, topic_title, user_id'),
    supabase.from('user_highlights').select('volume, file, user_id').gte('updated_at', since)
  ]);

  const favs = (favRes.data || []).filter(d => !_adminIds.has(d.user_id));
  const highlights = (hlRes.data || []).filter(d => !_adminIds.has(d.user_id));

  if (favs.length === 0 && highlights.length === 0) {
    document.getElementById('popular-favorites').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
    try { await window.loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
  }

  const favCounts = {};
  favs.forEach(f => {
    const key = `${f.volume}/${f.file}`;
    if (!favCounts[key]) favCounts[key] = { volume: f.volume, file: f.file, title: getFileTitle(f.volume, f.file), favs: 0, highlights: 0 };
    favCounts[key].favs++;
  });

  highlights.forEach(h => {
    const key = `${h.volume}/${h.file}`;
    if (favCounts[key]) {
      favCounts[key].highlights++;
    } else {
      favCounts[key] = { volume: h.volume, file: h.file, title: getFileTitle(h.volume, h.file), favs: 0, highlights: 1 };
    }
  });

  const sorted = Object.values(favCounts).sort((a, b) => (b.favs + b.highlights) - (a.favs + a.highlights)).slice(0, 15);
  const maxTotal = sorted.length > 0 ? sorted[0].favs + sorted[0].highlights : 1;

  document.getElementById('popular-favorites').innerHTML = `
    <table class="data-table">
      <thead><tr><th>#</th><th>Ensinamento</th><th>Volume</th><th>⭐ Favoritos</th><th>🖍 Destaques</th><th>Total</th></tr></thead>
      <tbody>${sorted.map((item, i) => {
        const total = item.favs + item.highlights;
        const pct = Math.round(total / maxTotal * 100);
        const countClass = total >= maxTotal * 0.5 ? 'high' : 'med';
        return `<tr>
          <td>${i + 1}</td>
          <td style="font-size:0.82rem;" title="${_escHtml(item.file)}">${_escHtml(item.title)}</td>
          <td>${VOL_SHORT[item.volume] || item.volume}</td>
          <td><span class="fav-count ${countClass}">${item.favs}</span></td>
          <td><span class="fav-count ${countClass}">${item.highlights}</span></td>
          <td><strong>${total}</strong></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

// ============================================================
// Retention Rate
// ============================================================

async function loadRetentionRate(days, since) {
  // Busca apenas o período selecionado para evitar trazer a tabela inteira
  const { data: rawLogs } = await supabase
    .from('access_logs')
    .select('user_id, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  const allLogs = (rawLogs || []).filter(d => !_adminIds.has(d.user_id));

  if (!allLogs.length) {
    document.getElementById('retention-rate').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const sinceDate = new Date(since);
  const halfAgo = new Date(Date.now() - (days / 2) * 86400000);

  const userActivity = {};
  allLogs.forEach(l => {
    if (!userActivity[l.user_id]) userActivity[l.user_id] = { first: l.created_at, last: l.created_at, total: 0, inPeriod: false, beforeHalf: false, afterHalf: false };
    const d = new Date(l.created_at);
    userActivity[l.user_id].total++;
    if (d < new Date(userActivity[l.user_id].first)) userActivity[l.user_id].first = l.created_at;
    if (d > new Date(userActivity[l.user_id].last)) userActivity[l.user_id].last = l.created_at;
    if (d >= sinceDate) userActivity[l.user_id].inPeriod = true;
    if (d < halfAgo) userActivity[l.user_id].beforeHalf = true;
    if (d >= halfAgo) userActivity[l.user_id].afterHalf = true;
  });

  // Variável local: NÃO confundir com o `allUsers` importado do shared/state.
  // Aqui é apenas a coleção de atividade computada por usuário neste período.
  const allActivity = Object.values(userActivity);
  const activeInPeriod = allActivity.filter(u => u.inPeriod);
  const returningUsers = activeInPeriod.filter(u => u.beforeHalf && u.afterHalf);
  const newUsers = activeInPeriod.filter(u => !u.beforeHalf && u.afterHalf);
  const churnedUsers = allActivity.filter(u => u.beforeHalf && !u.afterHalf);

  const totalActive = activeInPeriod.length;
  const returningPct = totalActive > 0 ? Math.round(returningUsers.length / totalActive * 100) : 0;
  const newPct = totalActive > 0 ? Math.round(newUsers.length / totalActive * 100) : 0;

  const weekMap = {};
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const weekNum = Math.floor(i / 7);
    const key = `S${days / 7 > 4 ? Math.floor((days - i - 1) / 7) + 1 : weekNum + 1}`;
    if (!weekMap[key]) weekMap[key] = { total: 0, returning: 0, newU: 0 };
  }

  activeInPeriod.forEach(u => {
    const lastDate = new Date(u.last);
    const daysAgo = Math.floor((now - lastDate) / 86400000);
    const weekNum = Math.floor(daysAgo / 7);
    const key = `S${days / 7 > 4 ? Math.floor((days - daysAgo - 1) / 7) + 1 : weekNum + 1}`;
    if (weekMap[key]) {
      weekMap[key].total++;
      if (u.beforeHalf && u.afterHalf) weekMap[key].returning++;
      else weekMap[key].newU++;
    }
  });

  const weekEntries = Object.entries(weekMap);

  document.getElementById('retention-rate').innerHTML = `
    <div class="retention-grid">
      <div class="retention-card">
        <div class="retention-circle returning">${returningPct}%</div>
        <div class="retention-label">Usuários Retornando</div>
        <div class="retention-sublabel">${returningUsers.length} de ${totalActive} ativos</div>
      </div>
      <div class="retention-card">
        <div class="retention-circle new-users">${newPct}%</div>
        <div class="retention-label">Usuários Novos</div>
        <div class="retention-sublabel">${newUsers.length} de ${totalActive} ativos</div>
      </div>
    </div>
    <div style="margin-top:12px; font-size:0.8rem; color:var(--text-muted);">
      Total de usuários que já acessaram: <strong>${allActivity.length}</strong> &nbsp;|&nbsp;
      Inativos no período: <strong>${churnedUsers.length}</strong>
    </div>
    ${weekEntries.length > 1 ? `
    <table class="retention-table">
      <thead><tr><th>Período</th><th>Ativos</th><th>Retornando</th><th>Novos</th><th>Retenção</th></tr></thead>
      <tbody>${weekEntries.map(([key, w]) => {
        const rate = w.total > 0 ? Math.round(w.returning / w.total * 100) : 0;
        return `<tr>
          <td><strong>${key}</strong></td>
          <td>${w.total}</td>
          <td>${w.returning}</td>
          <td>${w.newU}</td>
          <td><div class="retention-bar"><div class="retention-bar-fill" style="width:${rate}%"></div></div>${rate}%</td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : ''}`;
}

// Só loadAnalytics e loadOnlineUsers são expostos: loadAnalytics é o entry
// point chamado pelo switchTab; loadOnlineUsers é re-disparado a cada 60s
// pelo intervalo setado em switchTab (admin.js).
Object.assign(window, {
  loadAnalytics,
  loadOnlineUsers
});
