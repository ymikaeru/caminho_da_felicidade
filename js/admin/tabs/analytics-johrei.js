// ============================================================
// Johrei Analytics — visitas, engajamento, Culto Mensal,
// Essência (modal boas-vindas), Apostila (impressões).
// (aba "Análise · Johrei" do admin)
// ============================================================
import Chart from 'chart.js/auto';
import { supabase } from '../../supabase-config.js';

let _jrChart = null;

async function loadJohreiAnalytics() {
  const dash = document.getElementById('jr-dashboard');
  const genAt = document.getElementById('jr-gen-at');
  const days = parseInt(document.getElementById('jr-range')?.value || '30', 10);
  if (!dash) return;
  dash.innerHTML = '<div class="loading">Carregando dados…</div>';

  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Fetch RPC and extra raw data in parallel
  const [rpcRes, rawRes, cmOpensRes, cmHeartbeatsRes, cmAudioRes, cmDownloadsRes, essShownRes, essSuppRes, essSkippedRes, apostilaPrintRes] = await Promise.all([
    supabase.rpc('admin_get_site_analytics', { p_site: 'johrei', days_back: days }),
    supabase.from('site_events').select('props,created_at').eq('site','johrei').eq('event_type','pageview').gte('created_at', since),
    // Culto Mensal: aberturas. Fetcha todos os cta de johrei e
    // filtra client-side por props.label — evita depender da sintaxe
    // de JSON path do PostgREST, que varia entre versões.
    supabase.from('site_events')
      .select('anon_id,session_id,props')
      .eq('site','johrei')
      .eq('event_type','cta')
      .gte('created_at', since),
    // Culto Mensal: heartbeats enquanto o modal estava aberto (dwell time)
    supabase.from('site_events')
      .select('session_id,props')
      .eq('site','johrei')
      .eq('event_type','heartbeat')
      .ilike('path','%modal=culto-mensal%')
      .gte('created_at', since),
    // Culto Mensal: eventos de áudio (play/pause/ended)
    supabase.from('site_events')
      .select('event_type,session_id,anon_id,props,created_at')
      .eq('site','johrei')
      .in('event_type', ['audio_play','audio_pause','audio_ended'])
      .gte('created_at', since),
    // Culto Mensal: downloads (ZIP com PDF + MP3)
    supabase.from('site_events')
      .select('anon_id,session_id,props,created_at')
      .eq('site','johrei')
      .eq('event_type','download_zip')
      .gte('created_at', since),
    // Essência: modal de boas-vindas exibido
    supabase.from('site_events')
      .select('anon_id,props')
      .eq('site','johrei')
      .eq('event_type','essencia_shown')
      .gte('created_at', since),
    // Essência: usuário marcou "não exibir mais"
    supabase.from('site_events')
      .select('anon_id,props')
      .eq('site','johrei')
      .eq('event_type','essencia_suppressed')
      .gte('created_at', since),
    // Essência: visita chegou com modal já suprimido (não exibiu)
    supabase.from('site_events')
      .select('anon_id,props')
      .eq('site','johrei')
      .eq('event_type','essencia_skipped')
      .gte('created_at', since),
    // Apostila: impressões
    supabase.from('site_events')
      .select('anon_id,props,created_at')
      .eq('site','johrei')
      .eq('event_type','apostila_print')
      .gte('created_at', since)
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
  const refs = (data.top_referrers || []).filter(r => {
    const ref = (r.referrer || '').toLowerCase();
    return !ref.startsWith('localhost') && !ref.startsWith('127.') && !ref.startsWith('0.0.0.0');
  });
  const eng = data.engagement || {};
  const items = data.top_items || [];

  console.log('[jr-analytics] totals:', t, 'daily.length:', daily.length, 'daily[0..2]:', daily.slice(0, 3));

  if (genAt) genAt.textContent = `Atualizado em ${new Date(data.generated_at).toLocaleString('pt-BR')}`;

  if (!(t.all_time_visits > 0)) {
    dash.innerHTML = '<div class="loading">Ainda não há visitas registradas.</div>';
    return;
  }

  // ── Aggregate extra fields ──────────────────────────────────
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
    hours[new Date(r.created_at).getHours()]++;
  });

  const deviceTotal = Object.values(devices).reduce((a, b) => a + b, 0) || 1;
  const topLangs = Object.entries(langMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const langTotal = topLangs.reduce((s, e) => s + e[1], 0) || 1;
  const hourMax = Math.max(...hours, 1);

  // ── Culto Mensal aggregates ─────────────────────────────────
  // Filtra opens client-side por props.label (todos os cta vieram).
  const cmOpens = (cmOpensRes.data || []).filter(r => (r.props || {}).label === 'culto_mensal_open');
  const cmHeartbeats = cmHeartbeatsRes.data || [];
  const cmAudio = cmAudioRes.data || [];

  console.log('[jr-culto-mensal]', {
    opens: cmOpens.length,
    ctaTotal: (cmOpensRes.data || []).length,
    heartbeats: cmHeartbeats.length,
    audio: cmAudio.length,
    errs: {
      opens: cmOpensRes.error?.message,
      hb: cmHeartbeatsRes.error?.message,
      audio: cmAudioRes.error?.message
    }
  });

  const cmOpenCount = cmOpens.length;
  const cmOpenUniques = new Set(cmOpens.map(r => r.anon_id)).size;

  // Dwell time: soma delta_seconds dos heartbeats no path do modal.
  // Por sessão (anon pode ter várias sessões); média é por sessão lida.
  const cmDwellBySession = {};
  cmHeartbeats.forEach(r => {
    const sec = Number((r.props || {}).delta_seconds) || 0;
    if (sec <= 0) return;
    cmDwellBySession[r.session_id] = (cmDwellBySession[r.session_id] || 0) + sec;
  });
  const cmSessionsRead = Object.keys(cmDwellBySession).length;
  const cmTotalDwell = Object.values(cmDwellBySession).reduce((a, b) => a + b, 0);
  const cmAvgDwell = cmSessionsRead ? cmTotalDwell / cmSessionsRead : 0;

  // Áudio: tocaram = sessões com pelo menos um audio_play.
  // Escuta máxima por sessão = maior total_played_seconds visto em
  // audio_pause/audio_ended. audio_play não traz total_played.
  const cmPlayedBySession = {};
  const cmPlaySessions = new Set();
  const cmPlayAnons = new Set();
  let cmCompletedCount = 0;
  cmAudio.forEach(r => {
    if (r.event_type === 'audio_play') {
      cmPlaySessions.add(r.session_id);
      cmPlayAnons.add(r.anon_id);
      return;
    }
    const total = Number((r.props || {}).total_played_seconds) || 0;
    const prev = cmPlayedBySession[r.session_id] || 0;
    if (total > prev) cmPlayedBySession[r.session_id] = total;
    if (r.event_type === 'audio_ended') cmCompletedCount++;
  });
  const cmAudioSessions = cmPlaySessions.size;
  const cmAvgListenedSec = cmAudioSessions
    ? Object.values(cmPlayedBySession).reduce((a, b) => a + b, 0) / cmAudioSessions
    : 0;
  // duration_seconds vem nos eventos; usamos o mais comum/qualquer válido
  const cmDuration = (cmAudio.find(r => (r.props || {}).duration_seconds)?.props?.duration_seconds) || 0;
  const cmAvgListenedPct = cmDuration ? Math.round((cmAvgListenedSec / cmDuration) * 100) : null;

  // Downloads do ZIP (PDF + MP3) — 1 evento por clique no botão "Baixar"
  const cmDownloads = cmDownloadsRes.data || [];
  const cmDownloadCount = cmDownloads.length;
  const cmDownloadUniques = new Set(cmDownloads.map(r => r.anon_id)).size;

  // ── Helpers ─────────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  const card = (v, label, uniques) => `<div class="jr-card">
    <div class="v">${(v ?? 0).toLocaleString('pt-BR')}</div>
    <div class="s">${label}</div>
    ${uniques != null ? `<div class="u">${uniques.toLocaleString('pt-BR')} únicos</div>` : ''}
  </div>`;
  const engCard = (v, label, suffix) => `<div class="jr-card">
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
  // Slug "a-ordem-do-johrei" → "A ordem do johrei". Slug original fica no title pra debugging.
  const prettySlug = s => {
    const str = String(s || '').replace(/[-_]+/g, ' ').trim();
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '(sem título)';
  };
  const itemsTbl = items.length
    ? `<table><thead><tr><th>Ensinamento</th><th style="text-align:right;">Visitas</th></tr></thead><tbody>${
        items.map(it => `<tr><td class="ell" title="${esc(it.item)}">${esc(prettySlug(it.item))}</td><td class="num">${(it.visits??0).toLocaleString('pt-BR')}</td></tr>`).join('')
      }</tbody></table>`
    : '<div class="loading">Sem dados ainda. (Aguardando primeiras navegações com tracking SPA ativo.)</div>';

  // Dispositivos bar
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

  // Idiomas pills
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

  // Horário sparkline (SVG)
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

  // ── Apostila (impressões) ─────────────────────────────────
  const apRows = apostilaPrintRes.data || [];
  const apPrintCount = apRows.length;
  const apUniques = new Set(apRows.map(r => r.anon_id)).size;
  const apTotalArticles = apRows.reduce((s, r) => s + (r.props?.items_count || 0), 0);
  const apArticleFreq = {};
  apRows.forEach(r => {
    const ids = (r.props?.items || '').split(',').filter(Boolean);
    ids.forEach(id => { apArticleFreq[id] = (apArticleFreq[id] || 0) + 1; });
  });
  const apTopArticles = Object.entries(apArticleFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const apTopRows = apTopArticles.map(([id, n]) => {
    const slug = id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<tr><td class="ell" title="${esc(id)}">${esc(slug)}</td><td class="num">${n}</td></tr>`;
  }).join('') || '<tr><td colspan="2" style="color:var(--text-muted);">Sem dados ainda.</td></tr>';
  const apBlock = `
    <div class="jr-chart-wrap" style="margin-bottom:24px;">
      <h3>🖨️ Apostila — Impressões (${data.days_back}d)</h3>
      <div class="jr-cards" style="margin-bottom:0;">
        ${card(apPrintCount, 'Impressões', apUniques)}
        ${engCard(apTotalArticles, 'Artigos impressos')}
        ${engCard(apPrintCount > 0 ? (apTotalArticles / apPrintCount).toFixed(1) : '—', 'Artigos / impressão')}
      </div>
      <div style="margin-top:16px;">
        <table style="width:100%;border-collapse:collapse;font-size:.85rem;">
          <thead><tr><th style="text-align:left;font-size:.65rem;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);padding:6px 12px 6px 0;border-bottom:1px solid var(--border);font-weight:500;">Artigo</th><th style="text-align:right;font-size:.65rem;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);padding:6px 0 6px 0;border-bottom:1px solid var(--border);font-weight:500;">Vezes</th></tr></thead>
          <tbody>${apTopRows}</tbody>
        </table>
      </div>
    </div>`;

  // Bloco de Culto Mensal: sempre renderiza (mesmo zerado) pra ficar
  // explícito que o tracking está ativo e que estamos esperando dados.
  const cmHasData = cmOpenCount > 0 || cmAudioSessions > 0 || cmSessionsRead > 0 || cmDownloadCount > 0;
  const cmBlock = `
    <div class="jr-chart-wrap" style="margin-bottom:24px;">
      <h3>📖 Orientação do Culto Mensal (${data.days_back}d)</h3>
      <div class="jr-cards" style="margin-bottom:0;">
        ${card(cmOpenCount, 'Aberturas', cmOpenUniques)}
        ${engCard(cmAvgDwell > 0 ? fmtTime(cmAvgDwell) : '—', 'Permanência média')}
        ${engCard(cmAudioSessions, 'Sessões que ouviram')}
        ${engCard(cmAvgListenedSec > 0 ? fmtTime(cmAvgListenedSec) : '—',
          'Escuta média' + (cmAvgListenedPct != null && cmAvgListenedPct > 0 ? ` (${cmAvgListenedPct}%)` : ''))}
        ${card(cmDownloadCount, 'Downloads (ZIP)', cmDownloadUniques)}
      </div>
      <p style="font-size:.72rem;color:var(--text-muted);margin:14px 0 0;">
        ${cmHasData
          ? `Permanência captada via heartbeats (granularidade ~30s, leituras curtas podem não aparecer). Escuta média = média do total ouvido por sessão que apertou play. Downloads = cliques no botão "Baixar" que geraram o ZIP com PDF + MP3.${cmCompletedCount > 0 ? ` <strong>${cmCompletedCount}</strong> escuta(s) completa(s).` : ''}`
          : 'Sem dados ainda no período selecionado. Confirme que o tracking foi deployado em <code>guia_johrei</code> e que alguém abriu o modal.'}
      </p>
    </div>`;

  // ── Essência (modal de boas-vindas) aggregates ──────────────
  const essShown = essShownRes.data || [];
  const essSupp = essSuppRes.data || [];
  const essSkipped = essSkippedRes.data || [];
  const essShownCount = essShown.length;
  const essShownUniques = new Set(essShown.map(r => r.anon_id)).size;
  const essSuppCount = essSupp.length;
  const essSuppUniques = new Set(essSupp.map(r => r.anon_id)).size;
  const essSkippedCount = essSkipped.length;
  const essSkippedUniques = new Set(essSkipped.map(r => r.anon_id)).size;
  const essSuppRate = essShownCount > 0
    ? Math.round((essSuppCount / essShownCount) * 100)
    : null;

  const essHasData = essShownCount > 0 || essSuppCount > 0 || essSkippedCount > 0;
  const essBlock = `
    <div class="jr-chart-wrap" style="margin-bottom:24px;">
      <h3>🪷 Essência — Modal de Boas-vindas (${data.days_back}d)</h3>
      <div class="jr-cards" style="margin-bottom:0;">
        ${card(essShownCount, 'Exibições', essShownUniques)}
        ${card(essSkippedCount, 'Já ocultaram', essSkippedUniques)}
        ${engCard(essSuppCount, '"Não mostrar mais"')}
        ${engCard(essSuppUniques, 'Únicos que suprimiram')}
        ${engCard(essSuppRate != null ? essSuppRate + '%' : '—', 'Taxa de supressão')}
      </div>
      <p style="font-size:.72rem;color:var(--text-muted);margin:14px 0 0;">
        ${essHasData
          ? 'Exibições = vezes que o modal apareceu. Já ocultaram = visitas que chegaram com o modal previamente suprimido. Supressão = quantas vezes o checkbox "Não exibir nas próximas visitas" foi marcado ao fechar.'
          : 'Sem dados ainda. Os eventos <code>essencia_shown</code>, <code>essencia_skipped</code> e <code>essencia_suppressed</code> aparecem quando o modal é exibido/oculto/suprimido no guia_johrei.'}
      </p>
    </div>`;

  dash.innerHTML = `
    <div class="jr-cards">
      ${card(t.today_visits,'Hoje',t.today_uniques)}
      ${card(t.week_visits,'7 dias',t.week_uniques)}
      ${card(t.period_visits,`${data.days_back} dias`,t.period_uniques)}
      ${card(t.all_time_visits,'Total',t.all_time_uniques)}
    </div>
    <div class="jr-cards" style="margin-bottom:24px;">
      ${engCard(fmtTime(eng.avg_session_seconds), 'Tempo médio / sessão')}
      ${engCard(eng.avg_max_scroll_pct, 'Scroll médio máx.', '%')}
      ${engCard(eng.bounce_rate_pct, 'Bounce rate', '%')}
      ${engCard(t.period_sessions, `Sessões (${data.days_back}d)`)}
    </div>
    ${cmBlock}
    ${essBlock}
    ${apBlock}
    <div class="jr-chart-wrap">
      <h3>Visitas por dia (últimos ${data.days_back} dias)</h3>
      <canvas id="jr-chart"></canvas>
    </div>
    <div class="jr-tables jr-tables--full" style="margin-bottom:16px;">
      <div class="jr-tbl"><h3>Top ensinamentos</h3>${itemsTbl}</div>
    </div>
    <div class="jr-tables" style="margin-bottom:16px;">
      <div class="jr-tbl"><h3>Top referrers</h3>${tbl(refs,'referrer','visits')}</div>
      <div class="jr-tbl"><h3>Dispositivos</h3>${deviceTotal > 1 ? deviceBars : '<div class="loading">Sem dados.</div>'}</div>
    </div>
    <div class="jr-tables">
      <div class="jr-tbl"><h3>Idiomas</h3>${topLangs.length ? langPills : '<div class="loading">Sem dados.</div>'}</div>
      <div class="jr-tbl"><h3>Horário de pico (últimos ${data.days_back} dias)</h3>${hourSvg}</div>
    </div>`;

  const ctx = document.getElementById('jr-chart');
  console.log('[jr-analytics] canvas ctx:', ctx, 'size:', ctx?.clientWidth, 'x', ctx?.clientHeight);
  if (ctx) {
    if (_jrChart) _jrChart.destroy();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b8860b';
    try {
      _jrChart = new Chart(ctx, {
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
      console.log('[jr-analytics] chart created OK');
    } catch (e) {
      console.error('[jr-analytics] chart failed:', e);
    }
  } else {
    console.error('[jr-analytics] canvas #jr-chart not found in DOM');
  }
}

Object.assign(window, {
  loadJohreiAnalytics
});
