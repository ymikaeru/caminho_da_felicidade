// ============================================================
// Análise Geral — seções "Plataforma" (extraído de analytics.js)
// Sessões, heatmap de horários, dispositivos, inscritos no push,
// stats de sync, distribuição de roles e gráfico de atividade diária.
// Mesma aba "Análise · Geral"; só organização de código.
// ============================================================
import { supabase } from '../../supabase-config.js';
import { fetchAll } from '../fetch-all.js';
import { _escHtml } from '../shared/helpers.js';
import { _adminIds } from '../shared/state.js';

// ── Session Stats ─────────────────────────────────────────────────────
// Agrupa access_logs por usuário, sessões separadas por gap > 30 min.
// Mostra: total de sessions, duração média, artigos por session, distribuição.
async function loadSessionStats(days, since, shared) {
  const container = document.getElementById('session-stats');
  const GAP_MS = 30 * 60 * 1000;

  // Cópia ordenada ascendente: o agrupamento de sessões abaixo assume os
  // eventos em ordem cronológica; o array compartilhado não garante ordem.
  const logs = [...shared.logs].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

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

async function loadHeatmap(days, since, shared) {
  const data = shared.logs;

  if (!data.length) {
    document.getElementById('heatmap-chart').innerHTML = '<div class="loading">Sem dados.</div>';
    return;
  }

  const hourCounts = new Array(24).fill(0);
  data.forEach(d => {
    // Hora em São Paulo (UTC-3 fixo, sem horário de verão) — não depende do fuso do navegador
    const h = (new Date(d.created_at).getUTCHours() + 24 - 3) % 24;
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

// ============================================================
// Device Breakdown (desktop / celular / tablet)
// ============================================================
// Lê metadata.device dos access_logs (action='view') no período. O device é
// capturado no logAccess (login.js) a partir de 05/06/2026 — acessos
// anteriores não têm o campo e caem no balde "desconhecido". A quebra por
// usuário fica no modal de detalhe da aba Usuários (openUserDetail).
async function loadDeviceBreakdown(days, since) {
  const container = document.getElementById('device-breakdown');
  if (!container) return;

  const { data: raw, error } = await fetchAll(() => {
    let q = supabase
      .from('access_logs')
      .select('user_id, metadata')
      .eq('action', 'view');
    if (since) q = q.gte('created_at', since);
    return q;
  });
  if (error) {
    container.innerHTML = `<div class="msg err" style="display:block;">Falha ao carregar: ${_escHtml(error.message)}</div>`;
    return;
  }

  const rows = (raw || []).filter(r => !_adminIds.has(r.user_id));
  if (rows.length === 0) {
    container.innerHTML = '<div class="loading">Sem acessos no período.</div>';
    return;
  }

  const LABELS = { desktop: '🖥️ Desktop', mobile: '📱 Celular', tablet: '📲 Tablet', desconhecido: '❔ Desconhecido' };
  const ORDER = ['desktop', 'mobile', 'tablet', 'desconhecido'];
  const norm = (d) => (d === 'desktop' || d === 'mobile' || d === 'tablet') ? d : 'desconhecido';

  const agg = {};
  ORDER.forEach(k => { agg[k] = { accesses: 0, users: new Set() }; });
  rows.forEach(r => {
    const d = norm(r.metadata?.device);
    agg[d].accesses++;
    agg[d].users.add(r.user_id);
  });

  const totalAccesses = rows.length;
  const present = ORDER.filter(k => agg[k].accesses > 0);

  // Cards: usuários únicos por device + total de acessos no rótulo.
  const cardsHtml = `
    <div class="stats-grid" style="margin-bottom:20px;">
      ${present.map(k => `
        <div class="stat-card">
          <div class="stat-value">${agg[k].users.size}</div>
          <div class="stat-label">${LABELS[k]}</div>
          <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">${agg[k].accesses} acesso(s)</div>
        </div>`).join('')}
    </div>`;

  // Barras proporcionais por nº de acessos.
  const max = Math.max(...present.map(k => agg[k].accesses), 1);
  const barsHtml = present.map(k => {
    const pct = Math.round(agg[k].accesses / max * 100);
    const pctTotal = Math.round(agg[k].accesses / totalAccesses * 100);
    return `
      <div class="chart-bar">
        <div class="chart-bar-label">${LABELS[k]}</div>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
        <div class="chart-bar-value">${agg[k].accesses} (${pctTotal}%)</div>
      </div>`;
  }).join('');

  container.innerHTML = cardsHtml + barsHtml;
}

// 🔔 Quem ativou os avisos (Web Push). Lê via RPC admin (RLS da tabela só
// mostra as inscrições do próprio usuário). Lista é pequena — sem fetchAll.
async function loadPushSubscribers() {
  const container = document.getElementById('push-subscribers');
  if (!container) return;

  const { data, error } = await supabase.rpc('admin_get_push_subscriptions');
  if (error) {
    const missing = /admin_get_push_subscriptions/i.test(error.message || '');
    container.innerHTML = `<div class="msg err" style="display:block;">${missing
      ? 'RPC ausente — rode a migration <code>push_notifications_v2.sql</code> no SQL Editor.'
      : 'Falha ao carregar: ' + _escHtml(error.message)}</div>`;
    return;
  }
  const rows = data || [];
  if (rows.length === 0) {
    container.innerHTML = '<div class="loading">Ninguém ativou os avisos ainda.</div>';
    return;
  }

  // Aparelho/navegador legível a partir do user-agent gravado na inscrição.
  const deviceOf = (ua) => {
    const s = String(ua || '');
    let os = 'Desktop';
    if (/iphone/i.test(s)) os = '📱 iPhone';
    else if (/ipad|macintosh.+mobile/i.test(s)) os = '📲 iPad';
    else if (/android/i.test(s)) os = /mobile/i.test(s) ? '📱 Android' : '📲 Tablet Android';
    else if (/windows/i.test(s)) os = '🖥️ Windows';
    else if (/macintosh/i.test(s)) os = '🖥️ Mac';
    else if (/linux/i.test(s)) os = '🖥️ Linux';
    let br = '';
    if (/edg\//i.test(s)) br = 'Edge';
    else if (/samsungbrowser/i.test(s)) br = 'Samsung';
    else if (/firefox\//i.test(s)) br = 'Firefox';
    else if (/crios|chrome\//i.test(s)) br = 'Chrome';
    else if (/safari\//i.test(s)) br = 'Safari';
    return br ? `${os} · ${br}` : os;
  };

  // Estilo do agrupamento (1x por página): usuário colapsável via <details>.
  if (!document.getElementById('pushSubsStyle')) {
    const st = document.createElement('style');
    st.id = 'pushSubsStyle';
    st.textContent = `
      .push-sub-user { border:1px solid var(--border); border-radius:10px; margin-bottom:8px; overflow:hidden; }
      .push-sub-user > summary { display:flex; align-items:center; gap:12px; padding:10px 14px; cursor:pointer;
        user-select:none; list-style:none; transition: background .15s; }
      .push-sub-user > summary::-webkit-details-marker { display:none; }
      .push-sub-user > summary:hover { background: var(--accent-soft, rgba(184,134,11,.08)); }
      .push-sub-avatar { flex:none; width:30px; height:30px; border-radius:50%; display:flex; align-items:center;
        justify-content:center; background: var(--accent-soft, rgba(184,134,11,.15)); color: var(--accent);
        font-weight:700; font-size:.85rem; }
      .push-sub-name { font-weight:600; color: var(--text-main); min-width:0; overflow:hidden;
        text-overflow:ellipsis; white-space:nowrap; }
      .push-sub-chip { flex:none; font-size:.72rem; color: var(--text-muted); border:1px solid var(--border);
        border-radius:999px; padding:2px 9px; white-space:nowrap; }
      .push-sub-last { margin-left:auto; flex:none; font-size:.75rem; color: var(--text-muted); white-space:nowrap; }
      .push-sub-chevron { flex:none; color: var(--text-muted); transition: transform .18s; }
      .push-sub-user[open] .push-sub-chevron { transform: rotate(180deg); }
      .push-sub-devices { border-top:1px solid var(--border); padding:4px 14px 8px; }
      .push-sub-device { display:flex; align-items:center; gap:10px; padding:7px 0 7px 42px; font-size:.85rem;
        color: var(--text-main); border-bottom:1px dashed var(--border); }
      .push-sub-device:last-child { border-bottom:none; }
      .push-sub-device-date { margin-left:auto; font-size:.75rem; color: var(--text-muted); white-space:nowrap; }
      @media (max-width:600px){ .push-sub-last { display:none; } .push-sub-device { padding-left:0; } }
    `;
    document.head.appendChild(st);
  }

  // Agrupa por usuário (mais recente primeiro, fora e dentro do grupo).
  const byUser = new Map();
  rows.forEach(r => {
    const k = r.user_id;
    if (!byUser.has(k)) byUser.set(k, { name: r.display_name || r.email || k, devices: [] });
    byUser.get(k).devices.push(r);
  });
  const users = [...byUser.values()];
  users.forEach(u => u.devices.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
  users.sort((a, b) => new Date(b.devices[0].created_at) - new Date(a.devices[0].created_at));

  const fmtD = (iso) => new Date(iso).toLocaleDateString('pt-BR');
  const fmtDT = (iso) => `${fmtD(iso)} ${new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  const cardsHtml = `
    <div class="stats-grid" style="margin-bottom:20px;">
      <div class="stat-card">
        <div class="stat-value">${users.length}</div>
        <div class="stat-label">🙋 Usuário(s)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${rows.length}</div>
        <div class="stat-label">🔔 Aparelho(s)</div>
      </div>
    </div>`;

  const usersHtml = users.map(u => {
    const initial = (u.name || '?').trim().charAt(0).toUpperCase() || '?';
    const devicesHtml = u.devices.map(d => `
      <div class="push-sub-device">
        <span>${_escHtml(deviceOf(d.ua))}</span>
        <span class="push-sub-device-date">${fmtDT(d.created_at)}</span>
      </div>`).join('');
    return `
      <details class="push-sub-user">
        <summary>
          <span class="push-sub-avatar">${_escHtml(initial)}</span>
          <span class="push-sub-name">${_escHtml(u.name)}</span>
          <span class="push-sub-chip">${u.devices.length} aparelho${u.devices.length === 1 ? '' : 's'}</span>
          <span class="push-sub-last">último: ${fmtD(u.devices[0].created_at)}</span>
          <svg class="push-sub-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="push-sub-devices">${devicesHtml}</div>
      </details>`;
  }).join('');

  container.innerHTML = cardsHtml + usersHtml;
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
      <div class="stat-card"><div class="stat-value">${favRes.count || 0}</div><div class="stat-label">Salvos</div></div>
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

async function loadDailyActivityChart(days, since, shared) {
  const data = shared.logs; // agrupado por dia num map — ordem não importa

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


export {
  loadSessionStats,
  loadHeatmap,
  loadDeviceBreakdown,
  loadPushSubscribers,
  loadSyncStats,
  loadRoleDistribution,
  loadDailyActivityChart
};
