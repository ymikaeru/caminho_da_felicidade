// ============================================================
// Análise Geral — seções "Usuários" (extraído de analytics.js)
// Atividade recente (paginada), ranking de leitores, perfis de
// engajamento (score 0-100 + streak), tempo total e retenção.
// Mesma aba "Análise · Geral"; só organização de código.
// ============================================================
import { supabase } from '../../supabase-config.js';
import { fetchAll } from '../fetch-all.js';
import { _escHtml, getFileTitle } from '../shared/helpers.js';
import { VOL_SHORT } from '../shared/constants.js';
import { _adminIds, volumeCategories } from '../shared/state.js';

let _recentActivityCtx = null;
const RECENT_ACTIVITY_PAGE_SIZE = 25;

async function loadRecentActivity(days, since) {
  _recentActivityCtx = { since: since || null, cursor: null, items: [], nameCache: {}, exhausted: false };
  document.getElementById('recent-activity').innerHTML = '<div class="loading">Carregando...</div>';
  await _appendMoreRecentActivity();
}

async function _appendMoreRecentActivity() {
  // Captura o contexto da carga atual. loadRecentActivity reatribui
  // _recentActivityCtx a um objeto NOVO a cada (re)carga; um clique rápido em
  // "Atualizar" dispara cargas concorrentes que, ao retomar após o await,
  // enxergavam o ctx da OUTRA pelo global e poluíam .items entre si — o que
  // levava a remaining<=0, kept=[] e crash em kept[kept.length-1].created_at.
  // Operar sobre `ctx` (local) isola cada carga; o guard pós-await descarta a
  // que foi superada por uma mais nova.
  const ctx = _recentActivityCtx;
  if (!ctx || ctx.exhausted) return;
  const BATCH = 200;
  const target = RECENT_ACTIVITY_PAGE_SIZE;
  const before = ctx.items.length;

  while (ctx.items.length - before < target && !ctx.exhausted) {
    let q = supabase
      .from('access_logs')
      .select('user_id, volume, file, action, created_at')
      .order('created_at', { ascending: false })
      .limit(BATCH);
    if (ctx.since) q = q.gte('created_at', ctx.since);
    if (ctx.cursor) q = q.lt('created_at', ctx.cursor);
    const { data } = await q;
    if (_recentActivityCtx !== ctx) return; // uma carga mais nova assumiu — aborta
    if (!data || data.length === 0) { ctx.exhausted = true; break; }
    const remaining = target - (ctx.items.length - before);
    const nonAdmin = data.filter(d => !_adminIds.has(d.user_id));
    const kept = nonAdmin.slice(0, remaining);
    ctx.items = ctx.items.concat(kept);
    if (kept.length < nonAdmin.length) {
      // Cortamos não-admins neste lote (slice) → ainda há linhas nesta janela.
      // Avança o cursor só até a última REALMENTE incluída; avançar pro fim do lote
      // (como era antes) pulava as linhas descartadas e fazia dias inteiros sumirem.
      ctx.cursor = kept[kept.length - 1].created_at;
    } else {
      // Incluímos todas as não-admins do lote → pode avançar pro fim do lote.
      ctx.cursor = data[data.length - 1].created_at;
      if (data.length < BATCH) ctx.exhausted = true;
    }
  }

  if (_recentActivityCtx !== ctx) return; // não renderiza estado obsoleto
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
        const dateStr = date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' ' + date.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
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

// ============================================================
// Top Users Ranking
// ============================================================

async function loadTopUsersRanking(days, since, shared) {
  // Conta leituras "reais" por TEMPO ATIVO (estilo YouTube): só conta quem
  // ficou ≥ 30 s na página com aba visível e atividade recente.
  // (30s = fundo do vale na distribuição de tempos: corta o "abriu, passou
  //  o olho e fechou" em 0-20s sem penalizar leitura real de textos curtos.)
  const MIN_READ_SECONDS = 30;
  // Filtro por tempo aplicado em JS sobre reading_positions do período (shared).
  const data = shared.positions.filter(d => (d.time_spent_seconds || 0) >= MIN_READ_SECONDS);

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
// Engagement Profiles — visão pastoral + score
// ============================================================
// Substitui a leitura de "quem leu mais" (contagem crua, que confunde
// "leu muito uma vez e sumiu" com "engajado") por uma análise que combina
// 5 sinais em um score 0–100 E classifica cada disciplo num estado
// acionável para acolhimento (Assíduo / Crescendo / Esfriando / Inativo).
//
// Score (pesos somam 100):
//   • recência        (30) — dias desde o último acesso (decai em 30 dias)
//   • consistência    (25) — dias distintos ativos (hábito de estudo)
//   • profundidade    (20) — % média de progresso nas leituras
//   • tempo           (15) — horas totais investidas
//   • ações           (10) — grifos + salvos + marcações (estudo deliberado)
//
// A recência entra no score, então quem sumiu cai sozinho — resolvendo o
// caso "leu 99 publicações mas não vem há 27 dias".
async function loadEngagementProfiles(days, since, shared) {
  const container = document.getElementById('engagement-profiles');
  const nowMs = Date.now();
  const DAY = 86400000;

  // Tudo do prefetch compartilhado do período (já sem admins).
  const logs = shared.logs;
  const positions = shared.positions;
  const hls = shared.highlights;
  const marks = shared.readMarks;
  const favs = shared.favorites;

  // Agrega por usuário (admins fora).
  const U = {};
  const ensure = id => (U[id] || (U[id] = {
    access: [], pubs: new Set(), progSum: 0, progN: 0, secs: 0, grifos: 0, favs: 0, marcados: 0
  }));
  (logs || []).forEach(l => { if (_adminIds.has(l.user_id)) return; ensure(l.user_id).access.push(new Date(l.created_at).getTime()); });
  (positions || []).forEach(p => {
    if (_adminIds.has(p.user_id)) return;
    const u = ensure(p.user_id);
    u.pubs.add(`${p.volume}/${p.file}`);
    if (p.progress_pct != null) { u.progSum += p.progress_pct; u.progN++; }
    u.secs += p.time_spent_seconds || 0;
  });
  (hls || []).forEach(h => { if (_adminIds.has(h.user_id)) return; ensure(h.user_id).grifos++; });
  (marks || []).forEach(m => { if (_adminIds.has(m.user_id)) return; ensure(m.user_id).marcados++; });
  (favs || []).forEach(f => { if (_adminIds.has(f.user_id)) return; ensure(f.user_id).favs++; });

  const uids = Object.keys(U);
  if (!uids.length) {
    container.innerHTML = '<div class="loading">Sem atividade registrada no período.</div>';
    return;
  }

  const clamp01 = x => Math.max(0, Math.min(1, x));
  const dateKey = ts => new Date(ts).toLocaleDateString('pt-BR');
  // Número do dia LOCAL (mesmo fuso do observador, coerente com dateKey acima).
  // Streak = dias de calendário consecutivos com pelo menos um acesso.
  const dayNum = ts => { const d = new Date(ts); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / DAY); };
  const computeStreaks = access => {
    if (!access.length) return { current: 0, best: 0 };
    const days = [...new Set(access.map(dayNum))].sort((a, b) => a - b);
    let best = 1, run = 1;
    for (let i = 1; i < days.length; i++) {
      if (days[i] === days[i - 1] + 1) { run++; if (run > best) best = run; }
      else run = 1;
    }
    // Sequência ATUAL: só conta se o último dia ativo é hoje ou ontem (senão
    // já quebrou). Conta pra trás enquanto os dias forem consecutivos.
    const todayNum = dayNum(nowMs), lastDay = days[days.length - 1];
    let current = 0;
    if (todayNum - lastDay <= 1) {
      current = 1;
      for (let i = days.length - 1; i > 0; i--) {
        if (days[i] === days[i - 1] + 1) current++; else break;
      }
    }
    return { current, best };
  };
  const rows = uids.map(uid => {
    const u = U[uid];
    const lastAccess = u.access.reduce((a, b) => b > a ? b : a, 0);
    const daysSince = lastAccess ? Math.floor((nowMs - lastAccess) / DAY) : 999;
    const { current: streakNow, best: streakBest } = computeStreaks(u.access);
    const activeDays = new Set(u.access.map(dateKey)).size;
    const activeDaysRecent = new Set(u.access.filter(ts => ts >= nowMs - 14 * DAY).map(dateKey)).size;
    const activeDaysPrior = new Set(u.access.filter(ts => ts < nowMs - 14 * DAY && ts >= nowMs - 28 * DAY).map(dateKey)).size;
    const avgProgress = u.progN ? u.progSum / u.progN : 0;
    const hours = u.secs / 3600;
    const pubs = u.pubs.size;
    const actions = u.grifos + u.favs + u.marcados;

    const recPts = 30 * clamp01(1 - daysSince / 30);
    const consPts = 25 * clamp01(activeDays / 30);
    const depthPts = 20 * clamp01(avgProgress / 60);
    const timePts = 15 * clamp01(hours / 20);
    const actPts = 10 * clamp01(actions / 50);
    const score = Math.round(recPts + consPts + depthPts + timePts + actPts);

    // "Já foi engajado" = tem lastro real (não um visitante de 1 toque).
    const wasEngaged = activeDays >= 3 || hours >= 1 || actions >= 5;
    let state;
    if (daysSince > 30) state = 'inativo';
    else if (daysSince >= 8) state = wasEngaged ? 'esfriando' : 'inativo';
    else if (activeDays >= 10) state = 'assiduo';
    else if (activeDaysPrior === 0 ? activeDaysRecent >= 2 : activeDaysRecent > activeDaysPrior) state = 'crescendo';
    else state = 'assiduo';

    return { uid, daysSince, activeDays, streakNow, streakBest, avgProgress, hours, pubs, grifos: u.grifos, favs: u.favs, marcados: u.marcados, actions, score, state, wasEngaged, recPts, consPts, depthPts, timePts, actPts };
  });

  // Nomes.
  const { data: profiles } = await supabase.from('user_profiles').select('id, display_name').in('id', uids);
  const nameMap = {};
  (profiles || []).forEach(p => nameMap[p.id] = p.display_name);
  const nameOf = uid => nameMap[uid] || 'Desconhecido';

  const STATE = {
    assiduo:   { emoji: '🟢', label: 'Assíduo',   chip: 'background:rgba(34,197,94,.15);color:#16a34a;' },
    crescendo: { emoji: '🌱', label: 'Crescendo', chip: 'background:rgba(20,184,166,.15);color:#0d9488;' },
    esfriando: { emoji: '🟡', label: 'Esfriando', chip: 'background:rgba(245,158,11,.2);color:#d97706;' },
    inativo:   { emoji: '⚪', label: 'Inativo',    chip: 'background:rgba(148,163,184,.2);color:#64748b;' }
  };
  const CHIP_BASE = 'display:inline-block;font-size:0.62rem;font-weight:700;padding:1px 7px;border-radius:999px;vertical-align:middle;white-space:nowrap;';
  const chip = st => `<span style="${CHIP_BASE}${STATE[st].chip}">${STATE[st].emoji} ${STATE[st].label}</span>`;
  const recTxt = d => d <= 0 ? 'hoje' : d === 1 ? 'ontem' : d >= 999 ? 'nunca' : `há ${d} dias`;
  // Selo de sequência atual (🔥) — só aparece a partir de 2 dias seguidos.
  const streakBadge = n => n >= 2
    ? `<span style="${CHIP_BASE}background:rgba(239,68,68,.14);color:#dc2626;" title="dias ativos consecutivos, sem faltar um dia">🔥 ${n} dias seguidos</span>`
    : '';

  // Contagem por estado.
  const counts = { assiduo: 0, crescendo: 0, esfriando: 0, inativo: 0 };
  rows.forEach(r => counts[r.state]++);
  const stateCards = ['assiduo', 'crescendo', 'esfriando', 'inativo'].map(s =>
    `<div class="stat-card"><div class="stat-value">${STATE[s].emoji} ${counts[s]}</div><div class="stat-label">${STATE[s].label}</div></div>`
  ).join('');

  // Precisam de atenção: esfriando + inativos que já foram engajados
  // (drifted). Ordena por recência (quem saiu há menos tempo = mais fácil
  // de reacolher) primeiro.
  const attn = rows
    .filter(r => r.state === 'esfriando' || (r.state === 'inativo' && r.wasEngaged))
    .sort((a, b) => a.daysSince - b.daysSince)
    .slice(0, 12);
  const attnTotal = rows.filter(r => r.state === 'esfriando' || (r.state === 'inativo' && r.wasEngaged)).length;
  let attentionHtml = '';
  if (attn.length) {
    const items = attn.map(r => `
      <div style="display:flex; align-items:center; gap:8px; padding:6px 0; font-size:0.82rem; border-top:1px solid var(--border);">
        ${chip(r.state)}
        <strong style="flex-shrink:0;">${_escHtml(nameOf(r.uid))}</strong>
        <span style="color:var(--text-muted); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${recTxt(r.daysSince)} sem vir · ${r.pubs} publicações lidas · ${r.grifos} grifos · ${r.activeDays} dias ativos</span>
      </div>`).join('');
    const more = attnTotal > attn.length ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:6px;">+ ${attnTotal - attn.length} outros</div>` : '';
    attentionHtml = `
      <div style="border-left:3px solid #d97706; background:rgba(245,158,11,0.08); border-radius:8px; padding:12px 14px; margin-bottom:18px;">
        <div style="font-weight:600; font-size:0.85rem; margin-bottom:4px; color:#d97706;">⚠ Precisam de atenção — estavam engajados e esfriaram</div>
        <div style="font-size:0.72rem; color:var(--text-muted); margin-bottom:6px;">Bons candidatos a um contato do Reverendo antes de se afastarem de vez.</div>
        ${items}${more}
      </div>`;
  }

  // Em sequência: quem está numa sequência ATIVA de dias consecutivos
  // (vindo sem faltar até hoje/ontem). Ordena pela maior sequência atual.
  const onStreak = rows.filter(r => r.streakNow >= 2).sort((a, b) => b.streakNow - a.streakNow || b.streakBest - a.streakBest);
  let streakHtml = '';
  if (onStreak.length) {
    const items = onStreak.slice(0, 12).map(r => `
      <div style="display:flex; align-items:center; gap:8px; padding:6px 0; font-size:0.82rem; border-top:1px solid var(--border);">
        <span style="flex-shrink:0; font-weight:700; color:#dc2626; min-width:56px;">🔥 ${r.streakNow}d</span>
        <strong style="flex-shrink:0;">${_escHtml(nameOf(r.uid))}</strong>
        <span style="color:var(--text-muted); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">seguidos até ${recTxt(r.daysSince)} · recorde ${r.streakBest} dias · ${r.activeDays} dias ativos no período</span>
      </div>`).join('');
    const more = onStreak.length > 12 ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:6px;">+ ${onStreak.length - 12} outros em sequência</div>` : '';
    streakHtml = `
      <div style="border-left:3px solid #dc2626; background:rgba(239,68,68,0.07); border-radius:8px; padding:12px 14px; margin-bottom:18px;">
        <div style="font-weight:600; font-size:0.85rem; margin-bottom:4px; color:#dc2626;">🔥 Em sequência — vindo dias consecutivos sem faltar</div>
        <div style="font-size:0.72rem; color:var(--text-muted); margin-bottom:6px;">Disciplos com hábito diário de estudo agora. ${onStreak.length} em sequência ativa.</div>
        ${items}${more}
      </div>`;
  }

  // Ranking por score.
  const ranked = rows.slice().sort((a, b) => b.score - a.score || a.daysSince - b.daysSince).slice(0, 20);
  const maxScore = ranked[0].score || 1;
  const rankHtml = ranked.map((r, i) => {
    const name = nameOf(r.uid);
    const initial = (name || 'U')[0].toUpperCase();
    const posClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    const barPct = Math.round(r.score / maxScore * 100);
    return `
      <div class="ranking-item">
        <div class="ranking-pos ${posClass}">${i + 1}</div>
        <div class="ranking-avatar">${initial}</div>
        <div class="ranking-info">
          <div class="ranking-name">${_escHtml(name)} ${chip(r.state)} ${streakBadge(r.streakNow)}</div>
          <div style="font-size:0.66rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">recência ${Math.round(r.recPts)} · consistência ${Math.round(r.consPts)} · profundidade ${Math.round(r.depthPts)} · tempo ${Math.round(r.timePts)} · ações ${Math.round(r.actPts)} · <span title="último acesso">${recTxt(r.daysSince)}</span> · <span title="maior sequência de dias consecutivos no período">recorde ${r.streakBest}d</span></div>
        </div>
        <div class="ranking-bar-track" style="max-width:110px;"><div class="ranking-bar-fill" style="width:${barPct}%"></div></div>
        <div class="ranking-value">${r.score}/100</div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <p style="font-size:0.75rem; color:var(--text-muted); margin:-8px 0 14px;">
      Engajamento real por disciplo (${rows.length} no período) — combina recência, consistência, profundidade de leitura, tempo e ações deliberadas. Não é contagem de cliques.
    </p>
    <div class="stats-grid" style="margin-bottom:18px;">${stateCards}</div>
    ${streakHtml}
    ${attentionHtml}
    <h4 style="margin:0 0 10px; font-size:0.9rem;">Ranking por engajamento <span style="font-weight:400; color:var(--text-muted); font-size:0.75rem;">(score 0–100)</span></h4>
    <div class="ranking-list">${rankHtml}</div>
    <details style="margin-top:14px; font-size:0.78rem; color:var(--text-muted);">
      <summary style="cursor:pointer;">Como o score e os estados são calculados</summary>
      <div style="margin-top:8px; line-height:1.7;">
        <strong>Score (0–100):</strong> recência (30) + consistência de dias ativos (25) + profundidade média de leitura (20) + tempo investido (15) + ações deliberadas — grifos, salvos e marcações (10).<br>
        <strong>🔥 Sequência (streak):</strong> dias de calendário consecutivos com pelo menos um acesso, sem faltar um dia. A "sequência atual" só conta se a pessoa veio hoje ou ontem; "recorde" é a maior sequência dentro do período selecionado.<br>
        <strong>🟢 Assíduo:</strong> ativo nos últimos 7 dias e constante.<br>
        <strong>🌱 Crescendo:</strong> ativo recentemente e com atividade em alta (bom momento para incentivar).<br>
        <strong>🟡 Esfriando:</strong> já foi engajado, mas está 8–30 dias sem vir.<br>
        <strong>⚪ Inativo:</strong> mais de 30 dias sem acessar (ou quase nunca esteve ativo).
      </div>
    </details>`;
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

  const { data: raw } = await fetchAll(() => supabase
    .from('reading_positions')
    .select('user_id, volume, file, time_spent_seconds, updated_at')
    .gt('time_spent_seconds', 0), 'updated_at');
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
// Retention Rate
// ============================================================

async function loadRetentionRate(days, since, shared) {
  // access_logs do período (shared); first/last por usuário sai de min/max,
  // então a ordem do array não importa.
  const allLogs = shared.logs;

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

export {
  loadRecentActivity,
  loadTopUsersRanking,
  loadEngagementProfiles,
  loadTopUsersByTime,
  loadRetentionRate
};
