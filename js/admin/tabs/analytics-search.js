// ============================================================
// Search Analytics — métricas de busca (latência, top queries,
// zero-result, top usuários por volume de buscas).
// ============================================================
import { supabase } from '../../supabase-config.js';
import { fetchAll } from '../fetch-all.js';
import { _escHtml, _loadAdminIds } from '../shared/helpers.js';
import { _adminIds } from '../shared/state.js';

async function loadSearchAnalytics() {
  await _loadAdminIds();
  const days = parseInt(document.getElementById('sa-range')?.value || '30', 10);
  const genAt = document.getElementById('sa-gen-at');
  const totalEl = document.getElementById('sa-stat-total');
  const p50El = document.getElementById('sa-stat-p50');
  const p95El = document.getElementById('sa-stat-p95');
  const p99El = document.getElementById('sa-stat-p99');
  const topEl = document.getElementById('sa-top-queries');
  const zeroEl = document.getElementById('sa-zero-queries');
  const searchersEl = document.getElementById('sa-top-searchers');
  const recentEl = document.getElementById('sa-recent-searches');
  if (!topEl || !zeroEl) return;

  topEl.innerHTML = '<div class="loading">Carregando...</div>';
  zeroEl.innerHTML = '<div class="loading">Carregando...</div>';
  if (searchersEl) searchersEl.innerHTML = '<div class="loading">Carregando...</div>';
  if (recentEl) recentEl.innerHTML = '<div class="loading">Carregando...</div>';
  totalEl.textContent = '—'; p50El.textContent = '—'; p95El.textContent = '—'; p99El.textContent = '—';

  try {
    const { data, error } = await supabase.rpc('admin_search_analytics', { days_back: days });
    if (error) {
      topEl.innerHTML = `<div class="loading" style="color:#e05252;">Erro: ${_escHtml(error.message)}</div>`;
      zeroEl.innerHTML = '';
      if (genAt) genAt.textContent = 'Falha ao carregar';
      return;
    }
    if (genAt) {
      const since = new Date(data.since);
      genAt.textContent = `Período: últimos ${days} dia(s) — desde ${since.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
    }

    // Latency cards
    const lat = data.latency || {};
    totalEl.textContent = (lat.count ?? 0).toLocaleString('pt-BR');
    p50El.textContent = lat.p50 != null ? Math.round(lat.p50) : '—';
    p95El.textContent = lat.p95 != null ? Math.round(lat.p95) : '—';
    p99El.textContent = lat.p99 != null ? Math.round(lat.p99) : '—';

    // Top queries
    const top = data.top_queries || [];
    if (!top.length) {
      topEl.innerHTML = '<div class="loading">Sem buscas registradas no período.</div>';
    } else {
      const maxCount = top[0].count;
      topEl.innerHTML = top.map(({ query, count }) => {
        const isHot = count >= maxCount * 0.5;
        return `<span class="search-tag ${isHot ? 'hot' : ''}">${_escHtml(query)} (${count})</span>`;
      }).join('');
    }

    // Zero-result queries
    const zero = data.zero_result_queries || [];
    if (!zero.length) {
      zeroEl.innerHTML = '<div class="loading">Nenhuma busca sem resultado no período. 🎉</div>';
    } else {
      zeroEl.innerHTML = zero.map(({ query, count, last_seen }) => {
        const ago = last_seen ? new Date(last_seen).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
        return `<span class="search-tag" title="Última: ${_escHtml(ago)}" style="background:rgba(224,82,82,0.08); color:#c44; border-color:rgba(224,82,82,0.25);">${_escHtml(query)} (${count})</span>`;
      }).join('');
    }
  } catch (err) {
    topEl.innerHTML = `<div class="loading" style="color:#e05252;">Erro: ${_escHtml(err?.message || String(err))}</div>`;
    zeroEl.innerHTML = '';
  }

  // Buscas por usuário — query direta em search_logs (admins podem ler tudo via RLS)
  if (searchersEl && recentEl) {
    try {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data: { session } } = await supabase.auth.getSession();
      const myUid = session?.user?.id;

      // (o antigo .limit(2000) não funcionava: PostgREST corta em 1000 — fetchAll pagina)
      const { data: logs } = await fetchAll(() => supabase
        .from('search_logs')
        .select('user_id, query, results_count, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false }), null);

      // Exclui admins (por role) e o próprio usuário logado
      const filtered = (logs || []).filter(r =>
        !_adminIds.has(r.user_id) && r.user_id !== myUid
      );

      if (!filtered.length) {
        searchersEl.innerHTML = '<div class="loading">Sem buscas no período.</div>';
        recentEl.innerHTML = '<div class="loading">—</div>';
      } else {
        const uids = [...new Set(filtered.map(r => r.user_id))];
        const { data: profiles } = await supabase
          .from('user_profiles').select('id, display_name').in('id', uids);
        const nameMap = {};
        (profiles || []).forEach(p => nameMap[p.id] = p.display_name || 'Desconhecido');

        // Top usuários por volume de buscas
        const byUser = {};
        filtered.forEach(r => {
          const u = byUser[r.user_id] || (byUser[r.user_id] = { total: 0, zeros: 0, last: null });
          u.total++;
          if (r.results_count === 0) u.zeros++;
          if (!u.last || r.created_at > u.last) u.last = r.created_at;
        });
        const topSearchers = Object.entries(byUser)
          .map(([uid, u]) => ({ uid, ...u, name: nameMap[uid] || 'Desconhecido' }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 15);

        const maxTotal = topSearchers[0]?.total || 1;
        const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';

        searchersEl.innerHTML = `
          <p style="font-size:0.75rem; color:var(--text-muted); margin:-8px 0 12px;">Buscas no período por usuário (excluindo admins). Zero = buscas sem resultado.</p>
          <div class="ranking-list">
            ${topSearchers.map((u, i) => {
              const initial = (u.name || 'U')[0].toUpperCase();
              const pct = Math.round(u.total / maxTotal * 100);
              const posClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
              return `
                <div class="ranking-item">
                  <div class="ranking-pos ${posClass}">${i + 1}</div>
                  <div class="ranking-avatar">${initial}</div>
                  <div class="ranking-info">
                    <div class="ranking-name">${_escHtml(u.name)}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">
                      ${u.zeros > 0 ? `<span style="color:#c44;">${u.zeros} sem resultado</span> · ` : ''}último acesso ${fmtDate(u.last)}
                    </div>
                  </div>
                  <div class="ranking-bar-track"><div class="ranking-bar-fill" style="width:${pct}%"></div></div>
                  <div class="ranking-value">${u.total} buscas</div>
                </div>`;
            }).join('')}
          </div>`;

        // Todas as buscas do período (já limitado a 2000 na query), scrollável
        const recent = filtered;
        recentEl.innerHTML = `
          <table style="font-size:0.85rem; width:100%; border-collapse:collapse; table-layout:fixed;">
            <colgroup>
              <col style="width:22%;">
              <col style="width:auto;">
              <col style="width:60px;">
              <col style="width:110px;">
            </colgroup>
            <thead style="position:sticky; top:0; background:var(--surface); z-index:1;"><tr>
              <th style="text-align:left; font-size:.65rem; text-transform:uppercase; letter-spacing:.1em; color:var(--text-muted); padding:6px 12px 6px 0; border-bottom:1px solid var(--border); font-weight:500;">Usuário</th>
              <th style="text-align:left; font-size:.65rem; text-transform:uppercase; letter-spacing:.1em; color:var(--text-muted); padding:6px 12px 6px 0; border-bottom:1px solid var(--border); font-weight:500;">Busca</th>
              <th style="text-align:right; font-size:.65rem; text-transform:uppercase; letter-spacing:.1em; color:var(--text-muted); padding:6px 0 6px 0; border-bottom:1px solid var(--border); font-weight:500;">Result.</th>
              <th style="text-align:right; font-size:.65rem; text-transform:uppercase; letter-spacing:.1em; color:var(--text-muted); padding:6px 0 6px 12px; border-bottom:1px solid var(--border); font-weight:500;">Hora</th>
            </tr></thead>
            <tbody>
              ${recent.map(r => {
                const name = nameMap[r.user_id] || '?';
                const isZero = r.results_count === 0;
                return `<tr>
                  <td style="padding:7px 12px 7px 0; border-bottom:1px solid var(--border); color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_escHtml(name)}</td>
                  <td style="padding:7px 12px 7px 0; border-bottom:1px solid var(--border); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; ${isZero ? 'color:var(--text-muted);' : ''}">${_escHtml(r.query)}</td>
                  <td style="padding:7px 0; border-bottom:1px solid var(--border); text-align:right; font-weight:${isZero ? '600' : '400'}; color:${isZero ? '#c44' : 'var(--accent)'};">${isZero ? '0' : (r.results_count ?? '—')}</td>
                  <td style="padding:7px 0 7px 12px; border-bottom:1px solid var(--border); text-align:right; font-size:0.78rem; color:var(--text-muted); white-space:nowrap;">${new Date(r.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`;
      }
    } catch (err) {
      if (searchersEl) searchersEl.innerHTML = `<div class="loading" style="color:#e05252;">Erro: ${_escHtml(err?.message || String(err))}</div>`;
    }
  }
}

Object.assign(window, {
  loadSearchAnalytics
});
