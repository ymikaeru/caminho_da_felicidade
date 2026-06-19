// ============================================================
// Poetry Analytics — engajamento de leitura + poemas salvos
// (aba "Análise · Poesia" do admin)
// ============================================================
import Chart from 'chart.js/auto';
import { supabase } from '../../supabase-config.js';
import { fetchAll } from '../fetch-all.js';
import { _escHtml, _loadAdminIds } from '../shared/helpers.js';
import { _adminIds } from '../shared/state.js';
import { POETRY_BOOK_TITLES } from '../shared/constants.js';

let _paChart = null;

async function loadPoetryAnalytics() {
  const dash = document.getElementById('pa-dashboard');
  const genAt = document.getElementById('pa-gen-at');
  const days = parseInt(document.getElementById('pa-range')?.value || '30', 10);
  if (!dash) return;
  dash.innerHTML = '<div class="loading">Carregando dados…</div>';

  await _loadAdminIds();

  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    // (os antigos .limit(5000)/.limit(10000) não funcionavam: o PostgREST
    // corta em 1000 de qualquer jeito — fetchAll pagina até o fim)
    const [logsRes, posRes, savedRes] = await Promise.all([
      fetchAll(() => supabase.from('access_logs')
        .select('user_id, file, action, created_at')
        .eq('volume', 'poetry')
        .gte('created_at', since)
        .order('created_at', { ascending: false }), null),
      fetchAll(() => supabase.from('reading_positions')
        .select('user_id, file, time_spent_seconds, updated_at')
        .eq('volume', 'poetry'), 'updated_at'),
      // Poemas salvos: agrega all-time (não filtra por período — salvar
      // é uma intenção persistente, não um sinal de atividade recente).
      fetchAll(() => supabase.from('user_highlights')
        .select('user_id, file, topic_id, topic_title, text, updated_at')
        .eq('volume', 'poetry'), 'updated_at'),
    ]);

    if (logsRes.error || posRes.error) {
      const e = logsRes.error || posRes.error;
      dash.innerHTML = `<div class="loading" style="color:#e05252;">Erro: ${_escHtml(e.message)}</div>`;
      return;
    }
    if (savedRes.error) console.warn('[pa-analytics] saved highlights:', savedRes.error.message);

    const logs = (logsRes.data || []).filter(l => !_adminIds.has(l.user_id));
    const positions = (posRes.data || []).filter(p => !_adminIds.has(p.user_id));
    const savedHl = (savedRes.data || []).filter(h => !_adminIds.has(h.user_id));

    if (genAt) genAt.textContent = `Atualizado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

    if (!logs.length && !positions.length) {
      dash.innerHTML = '<div class="loading">Ainda não há leitura registrada nas obras poéticas.</div>';
      return;
    }

    const userIds = [...new Set([
      ...logs.map(l => l.user_id),
      ...positions.map(p => p.user_id)
    ])];
    let nameMap = {};
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, display_name')
        .in('id', userIds);
      nameMap = Object.fromEntries((profiles || []).map(p => [p.id, p.display_name || 'Sem nome']));
    }

    const workTitle = id => POETRY_BOOK_TITLES[id] || id;

    const totalOpens = logs.filter(l => l.action === 'view').length;
    const uniqueReaders = new Set([
      ...logs.map(l => l.user_id),
      ...positions.filter(p => (p.time_spent_seconds || 0) > 0).map(p => p.user_id)
    ]).size;
    const totalSeconds = positions.reduce((s, p) => s + (p.time_spent_seconds || 0), 0);
    const lastActivity = logs[0]?.created_at || null;

    const allWorkIds = new Set([
      ...Object.keys(POETRY_BOOK_TITLES),
      ...logs.map(l => l.file).filter(Boolean),
      ...positions.map(p => p.file).filter(Boolean)
    ]);
    const workStats = {};
    for (const id of allWorkIds) {
      workStats[id] = { opens: 0, readers: new Set(), seconds: 0, lastAt: null };
    }
    for (const l of logs) {
      if (!l.file) continue;
      const b = workStats[l.file];
      if (l.action === 'view') b.opens++;
      b.readers.add(l.user_id);
      if (!b.lastAt || l.created_at > b.lastAt) b.lastAt = l.created_at;
    }
    for (const p of positions) {
      if (!p.file) continue;
      const b = workStats[p.file];
      b.seconds += p.time_spent_seconds || 0;
      if ((p.time_spent_seconds || 0) > 0) b.readers.add(p.user_id);
    }

    const dayKeys = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const dayMap = new Map(dayKeys.map(k => [k, { day: k, opens: 0, uniques: new Set() }]));
    for (const l of logs) {
      if (l.action !== 'view') continue;
      const key = (l.created_at || '').slice(0, 10);
      const entry = dayMap.get(key);
      if (entry) { entry.opens++; entry.uniques.add(l.user_id); }
    }
    const daily = dayKeys.map(k => {
      const e = dayMap.get(k);
      return { day: k, opens: e.opens, uniques: e.uniques.size };
    });

    const readerMap = new Map();
    for (const p of positions) {
      const cur = readerMap.get(p.user_id) || { user_id: p.user_id, seconds: 0, works: new Set(), lastAt: null };
      cur.seconds += p.time_spent_seconds || 0;
      if ((p.time_spent_seconds || 0) > 0) cur.works.add(p.file);
      if (!cur.lastAt || p.updated_at > cur.lastAt) cur.lastAt = p.updated_at;
      readerMap.set(p.user_id, cur);
    }
    const topReaders = [...readerMap.values()]
      .filter(r => r.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 15);

    const byWorkReaders = {};
    for (const p of positions) {
      if (!p.file || !(p.time_spent_seconds > 0)) continue;
      if (!byWorkReaders[p.file]) byWorkReaders[p.file] = new Map();
      const wm = byWorkReaders[p.file];
      const cur = wm.get(p.user_id) || { user_id: p.user_id, seconds: 0, lastAt: null };
      cur.seconds += p.time_spent_seconds;
      if (!cur.lastAt || p.updated_at > cur.lastAt) cur.lastAt = p.updated_at;
      wm.set(p.user_id, cur);
    }

    const fmtSecs = secs => {
      secs = Math.round(secs || 0);
      if (secs < 60) return `${secs}s`;
      if (secs < 3600) return `${Math.round(secs / 60)} min`;
      const h = Math.floor(secs / 3600);
      const m = Math.round((secs - h * 3600) / 60);
      return m ? `${h}h ${m}min` : `${h}h`;
    };
    const fmtDate = iso => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const card = (v, label, sub) => `<div class="dc-card">
      <div class="v">${typeof v === 'number' ? v.toLocaleString('pt-BR') : (v ?? '—')}</div>
      <div class="s">${label}</div>
      ${sub != null ? `<div class="u">${sub}</div>` : ''}
    </div>`;

    const workCardHtml = id => {
      const b = workStats[id];
      return `<div class="dc-card dc-book-card">
        <div style="font-size:.95rem; font-weight:600; margin-bottom:4px;">${_escHtml(workTitle(id))}</div>
        <div class="u" style="margin:0;">${b.lastAt ? 'Última: ' + fmtDate(b.lastAt) : 'Nenhum acesso ainda'}</div>
        <div class="dc-book-stats">
          <div><div class="v">${b.opens.toLocaleString('pt-BR')}</div><div class="s">aberturas</div></div>
          <div><div class="v">${b.readers.size.toLocaleString('pt-BR')}</div><div class="s">leitores</div></div>
          <div><div class="v">${fmtSecs(b.seconds)}</div><div class="s">tempo lido</div></div>
        </div>
      </div>`;
    };

    const perWorkReadersHtml = Object.keys(POETRY_BOOK_TITLES).map(id => {
      const title = POETRY_BOOK_TITLES[id];
      const readers = [...(byWorkReaders[id]?.values() || [])]
        .filter(r => r.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 10);
      if (!readers.length) {
        return `<div class="dc-tbl"><h3>Top leitores · ${_escHtml(title)}</h3><div class="loading">Sem tempo registrado ainda.</div></div>`;
      }
      return `<div class="dc-tbl"><h3>Top leitores · ${_escHtml(title)}</h3><table><thead><tr><th>Usuário</th><th style="text-align:right;">Tempo</th><th>Última leitura</th></tr></thead><tbody>${readers.map(r => `<tr>
          <td>${_escHtml(nameMap[r.user_id] || 'Desconhecido')}</td>
          <td class="num">${fmtSecs(r.seconds)}</td>
          <td style="font-size:.78rem; color:var(--text-muted);">${fmtDate(r.lastAt)}</td>
        </tr>`).join('')
        }</tbody></table></div>`;
    }).join('');

    const recentRows = logs.filter(l => l.action === 'view').slice(0, 25);
    const recentHtml = recentRows.length
      ? `<table><thead><tr><th>Usuário</th><th>Obra</th><th>Quando</th></tr></thead><tbody>${recentRows.map(l => `<tr>
            <td>${_escHtml(nameMap[l.user_id] || 'Desconhecido')}</td>
            <td>${_escHtml(workTitle(l.file))}</td>
            <td style="font-size:.78rem; color:var(--text-muted);">${fmtDate(l.created_at)}</td>
          </tr>`).join('')
      }</tbody></table>`
      : '<div class="loading">Sem aberturas no período.</div>';

    // ── Poemas Salvos: ranking + stats ─────────────────────────
    // Agrega all-time por (file, topic_id), conta usuários distintos.
    const savedTotal = savedHl.length;
    const savedUsers = new Set(savedHl.map(h => h.user_id)).size;
    const poemMap = new Map();
    for (const h of savedHl) {
      const key = `${h.file}__${h.topic_id || '__null'}`;
      let p = poemMap.get(key);
      if (!p) {
        p = {
          file: h.file,
          topic_id: h.topic_id,
          topic_title: h.topic_title || '',
          text: h.text || '',
          users: new Set(),
          latestAt: null,
        };
        poemMap.set(key, p);
      }
      p.users.add(h.user_id);
      if (!p.latestAt || h.updated_at > p.latestAt) p.latestAt = h.updated_at;
      // Mantém topic_title/text mais ricos caso varie entre versões
      if (!p.topic_title && h.topic_title) p.topic_title = h.topic_title;
      if (!p.text && h.text) p.text = h.text;
    }
    const topSaved = [...poemMap.values()]
      .sort((a, b) => b.users.size - a.users.size || (b.latestAt || '').localeCompare(a.latestAt || ''))
      .slice(0, 25);

    const _previewText = (t, max) => {
      const first = (t || '').split(/\n+/)[0] || '';
      if (first.length <= max) return first;
      return first.slice(0, max) + '…';
    };

    const topSavedHtml = topSaved.length
      ? `<table><thead><tr><th style="width:6%;">#</th><th>Poema</th><th>Obra</th><th style="text-align:right;">Salvos</th></tr></thead><tbody>${topSaved.map((p, i) => {
        const w = workTitle(p.file);
        const collShort = p.file === 'yama-to-mizu' ? 'Yama' : p.file === 'warai-no-izumi' ? 'Warai' : p.file === 'akimaro-kineishu' ? 'Akemaro' : (p.file || '—');
        const title = p.topic_title || _previewText(p.text, 50) || (p.topic_id || '—');
        return `<tr>
              <td style="color:var(--text-muted);">${i + 1}</td>
              <td style="font-size:.82rem;" title="${_escHtml(_previewText(p.text, 120))}">${_escHtml(title)}</td>
              <td style="font-size:.78rem; color:var(--text-muted);" title="${_escHtml(w)}">${_escHtml(collShort)}</td>
              <td class="num">${p.users.size}</td>
            </tr>`;
      }).join('')
      }</tbody></table>`
      : '<div class="loading">Nenhum poema salvo ainda.</div>';

    // Top usuários que mais salvaram
    const saverMap = new Map();
    for (const h of savedHl) {
      let s = saverMap.get(h.user_id);
      if (!s) { s = { user_id: h.user_id, count: 0, files: new Set(), lastAt: null }; saverMap.set(h.user_id, s); }
      s.count++;
      if (h.file) s.files.add(h.file);
      if (!s.lastAt || h.updated_at > s.lastAt) s.lastAt = h.updated_at;
    }
    const topSavers = [...saverMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // Carrega nomes faltantes (savers que não apareceram em logs/positions)
    const missingNames = topSavers.map(s => s.user_id).filter(id => !nameMap[id]);
    if (missingNames.length) {
      try {
        const { data: extra } = await supabase
          .from('user_profiles').select('id, display_name').in('id', missingNames);
        (extra || []).forEach(p => { nameMap[p.id] = p.display_name || 'Sem nome'; });
      } catch (_) { }
    }

    const topSaversHtml = topSavers.length
      ? `<table><thead><tr><th>Usuário</th><th style="text-align:right;">Poemas</th><th>Obras</th><th>Último</th></tr></thead><tbody>${topSavers.map(s => `<tr>
            <td>${_escHtml(nameMap[s.user_id] || 'Desconhecido')}</td>
            <td class="num">${s.count}</td>
            <td style="font-size:.78rem;">${[...s.files].map(f => f === 'yama-to-mizu' ? 'Yama' : f === 'warai-no-izumi' ? 'Warai' : f === 'akimaro-kineishu' ? 'Akemaro' : f).join(', ')}</td>
            <td style="font-size:.78rem; color:var(--text-muted);">${fmtDate(s.lastAt)}</td>
          </tr>`).join('')
      }</tbody></table>`
      : '<div class="loading">Ninguém salvou poemas ainda.</div>';

    dash.innerHTML = `
      <div class="dc-section">
        <h3 class="dc-section-title">Engajamento de leitura · últimos ${days} dias</h3>
        <div class="dc-cards">
          ${card(totalOpens, 'Aberturas')}
          ${card(uniqueReaders, 'Leitores únicos')}
          ${card(fmtSecs(totalSeconds), 'Tempo total lido')}
          ${card(fmtDate(lastActivity), 'Última atividade')}
        </div>
        <div class="dc-chart-wrap">
          <h3>Aberturas por dia</h3>
          <canvas id="pa-chart"></canvas>
        </div>
      </div>

      <div class="dc-section">
        <h3 class="dc-section-title">Por obra · acumulado</h3>
        <div class="dc-cards">
          ${[...allWorkIds].map(workCardHtml).join('')}
        </div>
      </div>

      <div class="dc-section">
        <h3 class="dc-section-title">Poemas salvos · acumulado</h3>
        <div class="dc-cards">
          ${card(savedTotal, 'Total salvo')}
          ${card(savedUsers, 'Usuários que salvaram')}
          ${card(poemMap.size, 'Poemas distintos')}
        </div>
        <div class="dc-tables">
          <div class="dc-tbl"><h3>Poemas mais salvos (top 25)</h3>${topSavedHtml}</div>
          <div class="dc-tbl"><h3>Usuários que mais salvam (top 15)</h3>${topSaversHtml}</div>
        </div>
      </div>

      <div class="dc-section">
        <h3 class="dc-section-title">Atividade dos leitores</h3>
        <div class="dc-tables">
          ${perWorkReadersHtml}
        </div>
        <div class="dc-tables">
          <div class="dc-tbl"><h3>Atividade recente</h3>${recentHtml}</div>
        </div>
      </div>
    `;

    const ctx = document.getElementById('pa-chart');
    if (ctx) {
      if (_paChart) _paChart.destroy();
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b8860b';
      try {
        _paChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: daily.map(r => r.day.slice(5)),
            datasets: [
              { label: 'Aberturas', data: daily.map(r => r.opens), borderColor: accent, backgroundColor: 'rgba(184,134,11,0.1)', fill: true, tension: 0.3, pointRadius: 2 },
              { label: 'Únicos', data: daily.map(r => r.uniques), borderColor: '#6b7280', backgroundColor: 'transparent', borderDash: [4, 4], tension: 0.3, pointRadius: 2 }
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
      } catch (e) {
        console.error('[pa-analytics] chart failed:', e);
      }
    }
  } catch (err) {
    console.error('[pa-analytics] load failed:', err);
    dash.innerHTML = `<div class="loading" style="color:#e05252;">Erro: ${_escHtml(err.message || String(err))}</div>`;
  }
}

Object.assign(window, {
  loadPoetryAnalytics
});
