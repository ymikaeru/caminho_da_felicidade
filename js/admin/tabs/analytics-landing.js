// ============================================================
// Landing Analytics — visitas/engajamento da landing CMU
// (aba "Análise · Geral" do admin)
// ============================================================
import Chart from 'chart.js/auto';
import { supabase } from '../../supabase-config.js';

let _lpChart = null;

async function loadLandingAnalytics() {
  const dash = document.getElementById('lp-dashboard');
  const genAt = document.getElementById('lp-gen-at');
  const days = parseInt(document.getElementById('lp-range')?.value || '30', 10);
  if (!dash) return;
  dash.innerHTML = '<div class="loading">Carregando dados…</div>';

  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [rpcRes, rawRes] = await Promise.all([
    supabase.rpc('admin_get_site_analytics', { p_site: 'landing', days_back: days }),
    supabase.from('site_events').select('props,created_at').eq('site','landing').eq('event_type','pageview').gte('created_at', since)
  ]);

  if (rpcRes.error) {
    const msg = /Not authorized|42501/i.test(rpcRes.error.message)
      ? 'Sem permissão de admin para ver esta seção.'
      : `Erro: ${rpcRes.error.message}`;
    dash.innerHTML = `<div class="loading" style="color:#e05252;">${msg}</div>`;
    return;
  }

  const data = rpcRes.data;
  const raw = rawRes.data || [];
  const t = data.totals || {};
  const daily = data.daily || [];
  const refs = data.top_referrers || [];
  const eng = data.engagement || {};

  if (genAt) genAt.textContent = `Atualizado em ${new Date(data.generated_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  if (!(t.all_time_visits > 0)) {
    dash.innerHTML = '<div class="loading">Ainda não há visitas registradas.</div>';
    return;
  }

  // Agregar dispositivos, idiomas e horários
  const devices = { Mobile: 0, Tablet: 0, Desktop: 0 };
  const langMap = {};
  const hours = new Array(24).fill(0);

  raw.forEach(r => {
    const p = r.props || {};
    const w = parseInt((p.viewport || '').split('x')[0], 10);
    if (w > 0) {
      if (w < 768) devices.Mobile++;
      else if (w < 1024) devices.Tablet++;
      else devices.Desktop++;
    }
    const l = ((p.lang || '').split('-')[0].toLowerCase()) || '?';
    langMap[l] = (langMap[l] || 0) + 1;
    hours[(new Date(r.created_at).getUTCHours() + 24 - 3) % 24]++; // hora de São Paulo (UTC-3 fixo)
  });

  const deviceTotal = Object.values(devices).reduce((a, b) => a + b, 0) || 1;
  const topLangs = Object.entries(langMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const langTotal = topLangs.reduce((s, e) => s + e[1], 0) || 1;
  const hourMax = Math.max(...hours, 1);

  const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  const card = (v, label, uniques) => `<div class="lp-card">
    <div class="v">${(v ?? 0).toLocaleString('pt-BR')}</div>
    <div class="s">${label}</div>
    ${uniques != null ? `<div class="u">${uniques.toLocaleString('pt-BR')} únicos</div>` : ''}
  </div>`;
  const engCard = (v, label, suffix) => `<div class="lp-card">
    <div class="v">${v == null ? '—' : (typeof v === 'number' ? v.toLocaleString('pt-BR') : v)}${suffix || ''}</div>
    <div class="s">${label}</div>
  </div>`;
  const fmtTime = s => {
    const n = Number(s);
    if (!n || n <= 0) return '0s';
    if (n < 60) return `${Math.round(n)}s`;
    const m = Math.floor(n / 60), sec = Math.round(n % 60);
    return sec ? `${m}m ${sec}s` : `${m}m`;
  };
  const tbl = (rows, keyCol, valCol) => {
    if (!rows.length) return '<div class="loading">Sem dados.</div>';
    return `<table><thead><tr><th>${keyCol === 'path' ? 'Caminho' : 'Origem'}</th><th style="text-align:right;">Visitas</th></tr></thead><tbody>${
      rows.map(r => `<tr><td class="ell">${esc(r[keyCol])}</td><td class="num">${(r[valCol]??0).toLocaleString('pt-BR')}</td></tr>`).join('')
    }</tbody></table>`;
  };

  const deviceColors = { Mobile: '#34c759', Tablet: '#007aff', Desktop: '#b8860b' };
  const deviceBars = Object.entries(devices).map(([name, n]) => {
    const pct = Math.round(n / deviceTotal * 100);
    return `<div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:3px;">
        <span>${name}</span><span style="color:${deviceColors[name]};font-weight:600;">${pct}% <span style="color:var(--text-muted);font-weight:400;">(${n})</span></span>
      </div>
      <div style="height:7px;background:var(--border);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${deviceColors[name]};border-radius:4px;transition:width .4s;"></div>
      </div>
    </div>`;
  }).join('');

  const langPills = topLangs.map(([l, n]) => {
    const pct = Math.round(n / langTotal * 100);
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="font-size:.82rem;min-width:32px;font-weight:600;">${esc(l)}</span>
      <div style="flex:1;height:7px;background:var(--border);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:4px;"></div>
      </div>
      <span style="font-size:.75rem;color:var(--text-muted);min-width:36px;text-align:right;">${pct}%</span>
    </div>`;
  }).join('');

  const bw = 16, gap = 2, svgW = 24 * (bw + gap), svgH = 56;
  const hourBars = hours.map((v, h) => {
    const bh = Math.round((v / hourMax) * svgH);
    const x = h * (bw + gap);
    const isNight = h < 6 || h >= 22;
    return `<rect x="${x}" y="${svgH - bh}" width="${bw}" height="${bh}" rx="2" fill="${isNight ? '#6b7280' : 'var(--accent)'}" opacity="${v === 0 ? 0.15 : 0.85}"/>
      <title>${h}h: ${v} visita${v !== 1 ? 's' : ''}</title>`;
  }).join('');
  const hourPeakIdx = hours.indexOf(Math.max(...hours));
  const hourSvg = `<svg viewBox="0 0 ${svgW} ${svgH}" width="100%" height="${svgH}" style="margin-top:10px;">${hourBars}</svg>
    <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--text-muted);margin-top:3px;"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
    <p style="font-size:.78rem;color:var(--text-muted);margin:6px 0 0;">Pico: <strong>${hourPeakIdx}h</strong> (${hours[hourPeakIdx]} visitas)</p>`;

  dash.innerHTML = `
    <div class="lp-cards">
      ${card(t.today_visits,'Hoje',t.today_uniques)}
      ${card(t.week_visits,'7 dias',t.week_uniques)}
      ${card(t.period_visits,`${data.days_back} dias`,t.period_uniques)}
      ${card(t.all_time_visits,'Total',t.all_time_uniques)}
    </div>
    <div class="lp-cards" style="margin-bottom:24px;">
      ${engCard(fmtTime(eng.avg_session_seconds), 'Tempo médio / sessão')}
      ${engCard(eng.avg_max_scroll_pct, 'Scroll médio máx.', '%')}
      ${engCard(eng.bounce_rate_pct, 'Bounce rate', '%')}
      ${engCard(t.period_sessions, `Sessões (${data.days_back}d)`)}
    </div>
    <div class="lp-chart-wrap">
      <h3>Visitas por dia (últimos ${data.days_back} dias)</h3>
      <canvas id="lp-chart"></canvas>
    </div>
    <div class="lp-tables" style="margin-bottom:16px;">
      <div class="lp-tbl"><h3>Top referrers</h3>${tbl(refs,'referrer','visits')}</div>
      <div class="lp-tbl"><h3>Dispositivos</h3>${deviceTotal > 1 ? deviceBars : '<div class="loading">Sem dados.</div>'}</div>
    </div>
    <div class="lp-tables">
      <div class="lp-tbl"><h3>Idiomas</h3>${topLangs.length ? langPills : '<div class="loading">Sem dados.</div>'}</div>
      <div class="lp-tbl"><h3>Horário de pico (últimos ${data.days_back} dias)</h3>${hourSvg}</div>
    </div>`;

  const ctx = document.getElementById('lp-chart');
  if (ctx) {
    if (_lpChart) _lpChart.destroy();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b8860b';
    _lpChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: daily.map(r => r.day.slice(5)),
        datasets: [
          { label: 'Visitas', data: daily.map(r => r.visits), borderColor: accent, backgroundColor: 'rgba(184,134,11,0.1)', fill: true, tension: 0.3, pointRadius: 2 },
          { label: 'Únicos', data: daily.map(r => r.uniques), borderColor: '#6b7280', backgroundColor: 'transparent', borderDash: [4,4], tension: 0.3, pointRadius: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { font: { size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { font: { size: 10 }, precision: 0 } }
        }
      }
    });
  }
}

Object.assign(window, {
  loadLandingAnalytics
});
