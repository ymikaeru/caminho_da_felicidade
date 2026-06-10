// ============================================================
// Disciples Analytics — Publicações de Discípulos
// Lê access_logs e reading_positions filtrados por volume='disciples'
// ============================================================
import Chart from 'chart.js/auto';
import { supabase } from '../../supabase-config.js';
import { fetchAll } from '../fetch-all.js';
import { _escHtml, _loadAdminIds } from '../shared/helpers.js';
import { _adminIds } from '../shared/state.js';
import { DISCIPLES_BOOK_TITLES } from '../shared/constants.js';

let _dcChart = null;

async function loadDisciplesAnalytics() {
  const dash = document.getElementById('dc-dashboard');
  const genAt = document.getElementById('dc-gen-at');
  const days = parseInt(document.getElementById('dc-range')?.value || '30', 10);
  if (!dash) return;
  dash.innerHTML = '<div class="loading">Carregando dados…</div>';

  await _loadAdminIds();

  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    // (o antigo .limit(5000) não funcionava: PostgREST corta em 1000 — fetchAll pagina)
    const [logsRes, posRes] = await Promise.all([
      fetchAll(() => supabase.from('access_logs')
        .select('user_id, file, action, created_at')
        .eq('volume', 'disciples')
        .gte('created_at', since)
        .order('created_at', { ascending: false }), null),
      fetchAll(() => supabase.from('reading_positions')
        .select('user_id, file, time_spent_seconds, topic_index, total_topics, progress_pct, updated_at')
        .eq('volume', 'disciples'), 'updated_at')
    ]);

    if (logsRes.error || posRes.error) {
      const e = logsRes.error || posRes.error;
      dash.innerHTML = `<div class="loading" style="color:#e05252;">Erro: ${_escHtml(e.message)}</div>`;
      return;
    }

    const logs = (logsRes.data || []).filter(l => !_adminIds.has(l.user_id));
    const positions = (posRes.data || []).filter(p => !_adminIds.has(p.user_id));

    if (genAt) genAt.textContent = `Atualizado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

    if (!logs.length && !positions.length) {
      dash.innerHTML = '<div class="loading">Ainda não há leitura registrada nos livros de discípulos.</div>';
      return;
    }

    // Resolve display names
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

    const bookTitle = id => DISCIPLES_BOOK_TITLES[id] || id;

    // ── Totals ──
    const totalOpens = logs.filter(l => l.action === 'view').length;
    const uniqueReaders = new Set([
      ...logs.map(l => l.user_id),
      ...positions.filter(p => (p.time_spent_seconds || 0) > 0).map(p => p.user_id)
    ]).size;
    const totalSeconds = positions.reduce((s, p) => s + (p.time_spent_seconds || 0), 0);
    const lastActivity = logs[0]?.created_at || null;

    // ── Per-book ──
    const allBookIds = new Set([
      ...Object.keys(DISCIPLES_BOOK_TITLES),
      ...logs.map(l => l.file).filter(Boolean),
      ...positions.map(p => p.file).filter(Boolean)
    ]);
    const bookStats = {};
    for (const id of allBookIds) {
      bookStats[id] = { opens: 0, readers: new Set(), seconds: 0, lastAt: null };
    }
    for (const l of logs) {
      if (!l.file) continue;
      const b = bookStats[l.file];
      if (l.action === 'view') b.opens++;
      b.readers.add(l.user_id);
      if (!b.lastAt || l.created_at > b.lastAt) b.lastAt = l.created_at;
    }
    for (const p of positions) {
      if (!p.file) continue;
      const b = bookStats[p.file];
      b.seconds += p.time_spent_seconds || 0;
      if ((p.time_spent_seconds || 0) > 0) b.readers.add(p.user_id);
    }

    // ── Daily series ──
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

    // ── Top readers (by time_spent) ──
    const readerMap = new Map();
    for (const p of positions) {
      const cur = readerMap.get(p.user_id) || { user_id: p.user_id, seconds: 0, books: new Set(), lastAt: null };
      cur.seconds += p.time_spent_seconds || 0;
      if ((p.time_spent_seconds || 0) > 0) cur.books.add(p.file);
      if (!cur.lastAt || p.updated_at > cur.lastAt) cur.lastAt = p.updated_at;
      readerMap.set(p.user_id, cur);
    }
    const topReaders = [...readerMap.values()]
      .filter(r => r.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 15);

    const byBookReaders = {};
    for (const p of positions) {
      if (!p.file || !(p.time_spent_seconds > 0)) continue;
      if (!byBookReaders[p.file]) byBookReaders[p.file] = new Map();
      const bm = byBookReaders[p.file];
      const cur = bm.get(p.user_id) || { user_id: p.user_id, seconds: 0, lastAt: null };
      cur.seconds += p.time_spent_seconds;
      if (!cur.lastAt || p.updated_at > cur.lastAt) cur.lastAt = p.updated_at;
      bm.set(p.user_id, cur);
    }

    // ── Render helpers ──
    const fmtSecs = secs => {
      secs = Math.round(secs || 0);
      if (secs < 60) return `${secs}s`;
      if (secs < 3600) return `${Math.round(secs / 60)} min`;
      const h = Math.floor(secs / 3600);
      const m = Math.round((secs - h * 3600) / 60);
      return m ? `${h}h ${m}min` : `${h}h`;
    };
    const fmtDate = iso => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
    const card = (v, label, sub) => `<div class="dc-card">
      <div class="v">${typeof v === 'number' ? v.toLocaleString('pt-BR') : (v ?? '—')}</div>
      <div class="s">${label}</div>
      ${sub != null ? `<div class="u">${sub}</div>` : ''}
    </div>`;

    const bookCardHtml = id => {
      const b = bookStats[id];
      return `<div class="dc-card dc-book-card">
        <div style="font-size:.95rem; font-weight:600; margin-bottom:4px;">${_escHtml(bookTitle(id))}</div>
        <div class="u" style="margin:0;">${b.lastAt ? 'Última: ' + fmtDate(b.lastAt) : 'Nenhum acesso ainda'}</div>
        <div class="dc-book-stats">
          <div><div class="v">${b.opens.toLocaleString('pt-BR')}</div><div class="s">aberturas</div></div>
          <div><div class="v">${b.readers.size.toLocaleString('pt-BR')}</div><div class="s">leitores</div></div>
          <div><div class="v">${fmtSecs(b.seconds)}</div><div class="s">tempo lido</div></div>
        </div>
      </div>`;
    };

    const perBookReadersHtml = Object.keys(DISCIPLES_BOOK_TITLES).map(id => {
      const title = DISCIPLES_BOOK_TITLES[id];
      const readers = [...(byBookReaders[id]?.values() || [])]
        .filter(r => r.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 10);
      if (!readers.length) {
        return `<div class="dc-tbl"><h3>Top leitores · ${_escHtml(title)}</h3><div class="loading">Sem tempo registrado ainda.</div></div>`;
      }
      return `<div class="dc-tbl"><h3>Top leitores · ${_escHtml(title)}</h3><table><thead><tr><th>Usuário</th><th style="text-align:right;">Tempo</th><th>Última leitura</th></tr></thead><tbody>${
        readers.map(r => `<tr>
          <td>${_escHtml(nameMap[r.user_id] || 'Desconhecido')}</td>
          <td class="num">${fmtSecs(r.seconds)}</td>
          <td style="font-size:.78rem; color:var(--text-muted);">${fmtDate(r.lastAt)}</td>
        </tr>`).join('')
      }</tbody></table></div>`;
    }).join('');

    const recentRows = logs.filter(l => l.action === 'view').slice(0, 25);
    const recentHtml = recentRows.length
      ? `<table><thead><tr><th>Usuário</th><th>Livro</th><th>Quando</th></tr></thead><tbody>${
          recentRows.map(l => `<tr>
            <td>${_escHtml(nameMap[l.user_id] || 'Desconhecido')}</td>
            <td>${_escHtml(bookTitle(l.file))}</td>
            <td style="font-size:.78rem; color:var(--text-muted);">${fmtDate(l.created_at)}</td>
          </tr>`).join('')
        }</tbody></table>`
      : '<div class="loading">Sem aberturas no período.</div>';

    // ── Progresso por leitor × livro ──
    const progressRows = positions
      .filter(p => p.total_topics > 0 || (p.time_spent_seconds || 0) > 0)
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    const progressBar = pct => {
      const w = Math.max(0, Math.min(100, Math.round(pct || 0)));
      return `<div style="display:flex; align-items:center; gap:8px; min-width:140px;">
        <div style="flex:1; height:6px; background:var(--border); border-radius:3px; overflow:hidden;">
          <div style="height:100%; width:${w}%; background:var(--accent); border-radius:3px;"></div>
        </div>
        <span style="font-size:.78rem; color:var(--text-muted); min-width:36px; text-align:right;">${w}%</span>
      </div>`;
    };
    const SUSPICIOUS_MIN_PER_CHAP = 3;
    const SUSPICIOUS_MIN_PROGRESS = 25;
    const fmtMinPerChap = mpc => {
      if (!isFinite(mpc) || mpc <= 0) return '—';
      if (mpc < 1) return `${Math.round(mpc * 60)}s`;
      return `${mpc < 10 ? mpc.toFixed(1) : Math.round(mpc)} min`;
    };
    let suspiciousCount = 0;
    const progressBodyRows = progressRows.map(p => {
      const tot = p.total_topics || 0;
      const idx = (p.topic_index ?? 0);
      const chap = tot > 0 ? `${idx + 1} de ${tot}` : '—';
      const pct = (tot > 0) ? ((idx + 1) / tot) * 100 : (p.progress_pct || 0);
      const secs = p.time_spent_seconds || 0;
      const chaptersOpened = idx + 1;
      const minPerChap = chaptersOpened > 0 ? (secs / 60) / chaptersOpened : 0;
      const isSuspicious = pct >= SUSPICIOUS_MIN_PROGRESS && minPerChap > 0 && minPerChap < SUSPICIOUS_MIN_PER_CHAP;
      if (isSuspicious) suspiciousCount++;
      const rowStyle = isSuspicious ? ' style="background:rgba(192, 57, 43, 0.08);"' : '';
      const warn = isSuspicious ? `<span title="Menos de ${SUSPICIOUS_MIN_PER_CHAP} min por capítulo — possível click-through" style="color:#c0392b; margin-right:4px;">⚠️</span>` : '';
      const mpcCellStyle = isSuspicious ? 'font-size:.78rem; color:#c0392b; font-weight:600;' : 'font-size:.78rem; color:var(--text-muted);';
      return `<tr${rowStyle}>
        <td>${warn}${_escHtml(nameMap[p.user_id] || 'Desconhecido')}</td>
        <td>${_escHtml(bookTitle(p.file))}</td>
        <td style="font-size:.82rem; color:var(--text-muted);">${chap}</td>
        <td>${progressBar(pct)}</td>
        <td class="num">${fmtSecs(secs)}</td>
        <td class="num" style="${mpcCellStyle}">${fmtMinPerChap(minPerChap)}</td>
        <td style="font-size:.78rem; color:var(--text-muted);">${fmtDate(p.updated_at)}</td>
      </tr>`;
    }).join('');
    const progressNote = `<p style="font-size:.75rem; color:var(--text-muted); margin:0 0 8px;">"Min/cap" = tempo total ÷ capítulos navegados. ⚠️ Linhas em vermelho: ≥${SUSPICIOUS_MIN_PROGRESS}% de progresso com menos de ${SUSPICIOUS_MIN_PER_CHAP} min por capítulo — possível click-through sem leitura efetiva${suspiciousCount ? ` (${suspiciousCount} caso${suspiciousCount > 1 ? 's' : ''})` : ''}.</p>`;
    const progressHtml = progressRows.length
      ? progressNote + `<table><thead><tr><th>Usuário</th><th>Livro</th><th>Capítulo</th><th>Progresso</th><th style="text-align:right;">Tempo</th><th style="text-align:right;" title="Tempo total ÷ capítulos navegados">Min/cap</th><th>Última leitura</th></tr></thead><tbody>${progressBodyRows}</tbody></table>`
      : '<div class="loading">Sem progresso registrado ainda.</div>';

    dash.innerHTML = `
      <div class="dc-cards">
        ${card(totalOpens, `Aberturas (${days} dias)`)}
        ${card(uniqueReaders, 'Leitores únicos')}
        ${card(fmtSecs(totalSeconds), 'Tempo total lido')}
        ${card(fmtDate(lastActivity), 'Última atividade')}
      </div>
      <div class="dc-cards">
        ${[...allBookIds].map(bookCardHtml).join('')}
      </div>
      <div class="dc-chart-wrap">
        <h3>Aberturas por dia (últimos ${days} dias)</h3>
        <canvas id="dc-chart"></canvas>
      </div>
      <div class="dc-tables">
        ${perBookReadersHtml}
      </div>
      <div class="dc-tables">
        <div class="dc-tbl"><h3>Atividade recente</h3>${recentHtml}</div>
      </div>
      <div class="dc-tbl" style="margin-top:16px;">
        <h3>Progresso de leitura (por usuário e livro)</h3>${progressHtml}
      </div>
    `;

    // ── Chart ──
    const ctx = document.getElementById('dc-chart');
    if (ctx) {
      if (_dcChart) _dcChart.destroy();
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b8860b';
      try {
        _dcChart = new Chart(ctx, {
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
        console.error('[dc-analytics] chart failed:', e);
      }
    }
  } catch (err) {
    console.error('[dc-analytics] load failed:', err);
    dash.innerHTML = `<div class="loading" style="color:#e05252;">Erro: ${_escHtml(err.message || String(err))}</div>`;
  }
}

Object.assign(window, {
  loadDisciplesAnalytics
});
