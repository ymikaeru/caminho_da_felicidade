// ============================================================
// Analytics — Descoberta ("Descobrir um Ensinamento")
// ============================================================
// O recurso existe pra mudar um comportamento medido: o usuário mediano abriu
// 26 de 1.505 temas, e a escolha do assunto era sempre movida pela necessidade
// do momento. A pergunta que este painel responde não é "quantos cliques",
// é CONVERSÃO: de cada tanto que a pessoa espia, quanto ela abre pra ler?
//
// Toda a agregação acontece no banco (RPC admin_discovery_analytics) — baixar
// linhas esbarraria no cap de 1000 do PostgREST, que é a razão de
// js/admin/fetch-all.js existir.
// ============================================================
import { supabase } from '../../supabase-config.js';
import { _escHtml } from '../shared/helpers.js';

const VOL_NOMES = {
  mioshiec1: 'Mundo Espiritual',
  mioshiec2: 'Método Divino de Saúde',
  mioshiec3: 'A Verdadeira Fé',
  mioshiec4: 'Ensinamentos Diversos'
};

const _num = (n) => (n ?? 0).toLocaleString('pt-BR');
const _data = (iso) => iso
  ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  : '—';

async function loadDiscoveryAnalytics() {
  const days = parseInt(document.getElementById('da-range')?.value || '30', 10);
  const genAt = document.getElementById('da-gen-at');
  const usersEl = document.getElementById('da-users');
  const daysEl = document.getElementById('da-days');
  const readEl = document.getElementById('da-most-read');
  if (!usersEl) return;

  usersEl.innerHTML = '<div class="loading">Carregando...</div>';
  if (daysEl) daysEl.innerHTML = '';
  if (readEl) readEl.innerHTML = '';

  const card = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  ['da-stat-open', 'da-stat-draw', 'da-stat-read', 'da-stat-conv', 'da-stat-save', 'da-stat-users']
    .forEach(id => card(id, '—'));

  try {
    const { data, error } = await supabase.rpc('admin_discovery_analytics', { days_back: days });
    if (error) {
      usersEl.innerHTML = `<div class="loading" style="color:#e05252;">Erro: ${_escHtml(error.message)}</div>`;
      if (genAt) genAt.textContent = 'Falha ao carregar';
      return;
    }

    if (genAt) {
      genAt.textContent = `Período: últimos ${days} dia(s) — desde ${_data(data.since)}`;
    }

    const t = data.totais || {};
    const sorteios = t.draw || 0;
    const leituras = t.read || 0;
    card('da-stat-open', _num(t.open));
    card('da-stat-draw', _num(sorteios));
    card('da-stat-read', _num(leituras));
    // A métrica que importa: espiar virou ler?
    card('da-stat-conv', sorteios ? Math.round((leituras / sorteios) * 100) + '%' : '—');
    card('da-stat-save', _num(t.save));
    card('da-stat-users', _num(data.usuarios_distintos));

    // ---- por usuário ----
    const porUsuario = data.por_usuario || [];
    if (!porUsuario.length) {
      usersEl.innerHTML = '<div class="loading">Ninguém usou a descoberta no período.</div>';
    } else {
      const uids = porUsuario.map(u => u.user_id);
      const { data: profiles } = await supabase
        .from('user_profiles').select('id, display_name').in('id', uids);
      const nomes = {};
      (profiles || []).forEach(p => { nomes[p.id] = p.display_name || 'Desconhecido'; });

      usersEl.innerHTML = `
        <p style="font-size:0.75rem; color:var(--text-muted); margin:-8px 0 12px;">
          Conversão = Ensinamentos abertos para leitura ÷ cartas sorteadas.</p>
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
          <thead><tr>
            <th style="text-align:left;  ${_th()}">Usuário</th>
            <th style="text-align:right; ${_th()}">Aberturas</th>
            <th style="text-align:right; ${_th()}">Sorteios</th>
            <th style="text-align:right; ${_th()}">Leituras</th>
            <th style="text-align:right; ${_th()}">Conversão</th>
            <th style="text-align:right; ${_th()}">Guardados</th>
            <th style="text-align:right; ${_th()}">Último uso</th>
          </tr></thead>
          <tbody>
            ${porUsuario.map(u => {
              const conv = u.sorteios ? Math.round((u.leituras / u.sorteios) * 100) : null;
              return `<tr>
                <td style="${_td()} overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_escHtml(nomes[u.user_id] || 'Desconhecido')}</td>
                <td style="${_td()} text-align:right;">${_num(u.aberturas)}</td>
                <td style="${_td()} text-align:right;">${_num(u.sorteios)}</td>
                <td style="${_td()} text-align:right; color:var(--accent); font-weight:600;">${_num(u.leituras)}</td>
                <td style="${_td()} text-align:right;">${conv == null ? '—' : conv + '%'}</td>
                <td style="${_td()} text-align:right;">${_num(u.guardados)}</td>
                <td style="${_td()} text-align:right; color:var(--text-muted); white-space:nowrap;">${_data(u.ultimo_uso)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    }

    // ---- dia a dia (o hábito pega ou esfria?) ----
    const porDia = data.por_dia || [];
    if (daysEl) {
      if (!porDia.length) {
        daysEl.innerHTML = '<div class="loading">Sem atividade no período.</div>';
      } else {
        const maxAb = Math.max(...porDia.map(d => d.aberturas || 0), 1);
        daysEl.innerHTML = `
          <div style="display:flex; align-items:flex-end; gap:3px; height:110px; overflow-x:auto; padding-bottom:4px;">
            ${porDia.map(d => {
              const h = Math.max(2, Math.round(((d.aberturas || 0) / maxAb) * 100));
              const tt = `${d.dia}: ${d.aberturas} abertura(s), ${d.sorteios} sorteio(s), ${d.leituras} leitura(s)`;
              return `<div title="${_escHtml(tt)}" style="flex:0 0 10px; height:${h}%; background:var(--accent); opacity:.75; border-radius:2px 2px 0 0;"></div>`;
            }).join('')}
          </div>
          <p style="font-size:0.72rem; color:var(--text-muted); margin:8px 0 0;">
            Aberturas do modal por dia — ${_escHtml(String(porDia[0].dia))} a ${_escHtml(String(porDia[porDia.length - 1].dia))}.
            Passe o mouse para os números.</p>`;
      }
    }

    // ---- o que a descoberta levou a ler ----
    if (readEl) {
      const lidos = data.mais_lidos || [];
      const porVolume = data.por_volume || {};
      const volLinhas = Object.entries(porVolume)
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => `<span class="search-tag">${_escHtml(VOL_NOMES[v] || v)} (${n})</span>`)
        .join('');

      readEl.innerHTML = (volLinhas
        ? `<div style="margin-bottom:14px;">${volLinhas}</div>`
        : '') + (!lidos.length
        ? '<div class="loading">Nenhum Ensinamento foi aberto pela descoberta no período.</div>'
        : `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
             <thead><tr>
               <th style="text-align:left;  ${_th()}">Ensinamento</th>
               <th style="text-align:right; ${_th()}">Aberturas</th>
             </tr></thead>
             <tbody>
               ${lidos.map(m => {
                 const href = `reader.html?vol=${encodeURIComponent(m.vol)}&file=${encodeURIComponent(m.file)}` +
                              (m.topic_index ? `&topic=${m.topic_index}` : '');
                 const rot = `${VOL_NOMES[m.vol] || m.vol} · ${m.file}${m.topic_index ? ' #' + m.topic_index : ''}`;
                 return `<tr>
                   <td style="${_td()} overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                     <a href="${_escHtml(href)}" target="_blank" rel="noopener" style="color:var(--text);">${_escHtml(rot)}</a></td>
                   <td style="${_td()} text-align:right; color:var(--accent); font-weight:600;">${_num(m.n)}</td>
                 </tr>`;
               }).join('')}
             </tbody>
           </table>`);
    }
  } catch (err) {
    usersEl.innerHTML = `<div class="loading" style="color:#e05252;">Erro: ${_escHtml(err?.message || String(err))}</div>`;
  }
}

// Estilos de tabela iguais aos das outras abas de analytics (inline, porque o
// _admin.css não tem classe pra isso e o padrão da casa aqui é inline).
function _th() {
  return 'font-size:.65rem; text-transform:uppercase; letter-spacing:.1em; color:var(--text-muted); padding:6px 12px 6px 0; border-bottom:1px solid var(--border); font-weight:500;';
}
function _td() {
  return 'padding:7px 12px 7px 0; border-bottom:1px solid var(--border);';
}

Object.assign(window, { loadDiscoveryAnalytics });
