    import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';
    import Chart from 'chart.js/auto';

    const VOLUMES = [
      { key: 'mioshiec1', name: 'Volume 1 — Mundo Espiritual' },
      { key: 'mioshiec2', name: 'Volume 2 — Método Divino de Saúde' },
      { key: 'mioshiec3', name: 'Volume 3 — A Verdadeira Fé' },
      { key: 'mioshiec4', name: 'Volume 4 — Ensinamentos Complementares' }
    ];

    const VOL_SHORT = {
      mioshiec1: 'V1', mioshiec2: 'V2', mioshiec3: 'V3', mioshiec4: 'V4',
      shumeic1:  'V1', shumeic2:  'V2', shumeic3:  'V3', shumeic4:  'V4',
      disciples: 'Disc'
    };

    let allUsers = [];
    let _myUid = null;
    let _reportNotes = {}; // { report_id: [notes] }
    let selectedUserId = null;
    let volumeCategories = {};
    let _adminIds = new Set();

    async function _loadAdminIds() {
      try {
        const { data } = await supabase
          .from('user_profiles')
          .select('id')
          .eq('role', 'admin');
        _adminIds = new Set((data || []).map(u => u.id));
      } catch (e) {
        console.warn('[_loadAdminIds] failed:', e.message);
      }
    }

    let _onlineRefreshInterval = null;

    // ── Helpers ───────────────────────────────────────────────────
    function _escHtml(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;').replace(/`/g, '&#96;');
    }

    async function logAdminAction(action, details = {}) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        await supabase.from('admin_logs').insert({
          admin_id: session.user.id,
          admin_email: session.user.email,
          action,
          details
        });
      } catch (e) {
        console.warn('[adminLog]', e.message);
      }
    }

    // ── Admin Logs Tab ────────────────────────────────────────────
    window.loadAdminLogs = async function() {
      const container = document.getElementById('admin-logs-container');
      if (!container) return;
      container.innerHTML = '<div class="loading">Carregando logs...</div>';

      const days = parseInt(document.getElementById('log-filter-days')?.value || '30');
      let query = supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(500);
      if (days > 0) {
        const since = new Date(Date.now() - days * 86400000).toISOString();
        query = query.gte('created_at', since);
      }

      const { data: logs, error } = await query;
      if (error) {
        container.innerHTML = `<div class="msg err" style="display:block;">Erro ao carregar logs: ${_escHtml(error.message)}</div>`;
        return;
      }
      if (!logs || logs.length === 0) {
        container.innerHTML = '<div class="report-empty">Nenhum log encontrado neste período.</div>';
        return;
      }

      const adminSelect = document.getElementById('log-filter-admin');
      const currentFilter = adminSelect?.value || '';
      const admins = [...new Set(logs.map(l => l.admin_email))];
      if (adminSelect) {
        adminSelect.innerHTML = '<option value="">Todos os admins</option>' +
          admins.map(a => `<option value="${_escHtml(a)}"${a === currentFilter ? ' selected' : ''}>${_escHtml(a)}</option>`).join('');
      }

      window._adminLogsAll = logs;
      filterAdminLogs();
    };

    window.filterAdminLogs = function() {
      const filter = document.getElementById('log-filter-admin')?.value || '';
      const logs = (window._adminLogsAll || []).filter(l => !filter || l.admin_email === filter);
      renderAdminLogs(logs);
    };

    function renderAdminLogs(logs) {
      const container = document.getElementById('admin-logs-container');
      if (!logs || logs.length === 0) {
        container.innerHTML = '<div class="report-empty">Nenhum log para este filtro.</div>';
        return;
      }
      const ACTION_LABELS = {
        'add_user':                  { label: 'Criou usuário',              color: '#34c759' },
        'delete_user':               { label: 'Excluiu usuário',            color: '#ff3b30' },
        'change_role':               { label: 'Alterou role',               color: '#ffc107' },
        'save_permissions':          { label: 'Salvou restrições',          color: '#b8860b' },
        'apply_default_permissions': { label: 'Aplicou restrições a todos', color: '#e05252' },
        'search_replace':            { label: 'Buscar & Substituir',        color: '#8e7cc3' },
        'rebuild_search_index':      { label: 'Regenerou Índice de Busca',  color: '#5ba4cf' },
        'delete_highlight':          { label: 'Apagou destaque',            color: '#ff3b30' },
      };
      container.innerHTML = `<table class="data-table">
        <thead><tr><th>Data/Hora</th><th>Admin</th><th>Ação</th><th>Detalhes</th></tr></thead>
        <tbody>${logs.map(log => {
          const info = ACTION_LABELS[log.action] || { label: log.action, color: 'var(--text-muted)' };
          const dt = new Date(log.created_at);
          const dtStr = dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const details = log.details || {};
          const detailStr = Object.entries(details)
            .map(([k, v]) => `<span style="color:var(--text-muted);font-size:0.75rem;">${_escHtml(k)}:</span> <strong>${_escHtml(String(v))}</strong>`)
            .join(' &nbsp;·&nbsp; ');
          return `<tr>
            <td style="white-space:nowrap;color:var(--text-muted);font-size:0.8rem;">${dtStr}</td>
            <td style="font-size:0.82rem;">${_escHtml(log.admin_email)}</td>
            <td><span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:0.75rem;font-weight:700;background:${info.color}22;color:${info.color};">${_escHtml(info.label)}</span></td>
            <td style="font-size:0.82rem;">${detailStr || '<span style="color:var(--text-muted);">—</span>'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    }

    // ── Destaques Tab ─────────────────────────────────────────────
    let _hlCountByUser = null; // Map<userId, number>

    async function _loadHighlightCounts() {
      if (_hlCountByUser) return _hlCountByUser;
      const counts = new Map();
      try {
        // Traz só user_id (campo leve) — contagem client-side agrupada por usuário
        const { data, error } = await supabase.from('user_highlights').select('user_id');
        if (error) throw error;
        (data || []).forEach(h => counts.set(h.user_id, (counts.get(h.user_id) || 0) + 1));
      } catch (e) {
        console.warn('[_loadHighlightCounts] falhou:', e.message);
      }
      _hlCountByUser = counts;
      return counts;
    }

    async function initHlTab() {
      await _loadHighlightCounts();
      const q = (document.getElementById('hl-user-search')?.value || '').toLowerCase();
      const filtered = q
        ? allUsers.filter(u => (u.display_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
        : allUsers;
      renderHlUserList(filtered);
    }

    window.filterHlUsers = function() {
      const q = document.getElementById('hl-user-search').value.toLowerCase();
      const filtered = allUsers.filter(u =>
        (u.display_name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      );
      renderHlUserList(filtered);
    };

    function renderHlUserList(users) {
      const container = document.getElementById('hl-user-list');
      if (!users || users.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:8px 0;">Nenhum usuário encontrado.</div>';
        return;
      }
      // Ordena: quem tem mais destaques aparece primeiro (facilita varredura)
      const counts = _hlCountByUser || new Map();
      const withCounts = users.map(u => ({ u, count: counts.get(u.id) || 0 }));
      withCounts.sort((a, b) => b.count - a.count);

      container.innerHTML = withCounts.map(({ u, count }) => {
        const active = count > 0;
        const badge = `<span title="${count} destaque${count !== 1 ? 's' : ''}" style="flex-shrink:0; display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; background:${active ? 'rgba(184,134,11,0.14)' : 'rgba(120,120,120,0.10)'}; color:${active ? 'var(--accent)' : 'var(--text-muted)'}; font-size:0.78rem; font-weight:700;">🖍 ${count}</span>`;
        return `
        <div class="user-row" onclick="loadUserHighlights('${u.id}', '${_escHtml(u.display_name || u.email || 'Usuário')}')">
          <div class="user-avatar">${(u.display_name || u.email || '?')[0].toUpperCase()}</div>
          <div class="user-info">
            <div class="user-name">${_escHtml(u.display_name || '')}</div>
            <div class="user-email">${_escHtml(u.email || '')}</div>
          </div>
          <div class="user-meta" style="flex-shrink:0; font-size:0.75rem; color:var(--text-muted); margin-left:auto;">${_escHtml(u.role || 'user')}</div>
          ${badge}
        </div>`;
      }).join('');
    }

    const DISCIPLES_BOOK_TITLES = {
      keigyou: 'Keigyou',
      'ashita-no-ijitsu-wo-ikiru': 'Ashita No Ijitsu Wo Ikiru'
    };

    function getFileTitle(volume, file) {
      if (volume === 'disciples') return DISCIPLES_BOOK_TITLES[file] || file;
      const cats = volumeCategories?.[volume];
      if (cats) {
        for (const arr of Object.values(cats)) {
          const hit = arr.find(x => x.file === file);
          if (hit?.title) return hit.title;
        }
      }
      return file.replace(/\.html\.json$/, '').replace(/\.json$/, '').replace(/\.html$/, '');
    }

    window.loadUserHighlights = async function(userId, userName) {
      const container = document.getElementById('hl-results-container');
      const header = document.getElementById('hl-results-header');
      document.getElementById('hl-selected-name').textContent = userName;
      document.getElementById('hl-total-count').textContent = '';
      header.style.display = 'flex';
      container.innerHTML = '<div class="loading">Carregando destaques...</div>';
      // Guarda quem é o dono dos destaques pra usar no delete e no log
      window._currentHlUserId = userId;
      window._currentHlUserName = userName;
      // Scroll the highlights header into view so o admin não precisa rolar até o fim da lista de usuários
      header.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Ensure the volume→file→title map is loaded before rendering
      if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
        try { await loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
      }

      const { data, error } = await supabase
        .rpc('get_user_highlights_for_admin', { target_user_id: userId });

      if (error) {
        container.innerHTML = `<div class="msg err">Erro ao carregar: ${_escHtml(error.message)}</div>`;
        return;
      }

      const highlights = data || [];
      document.getElementById('hl-total-count').textContent = `${highlights.length} destaque${highlights.length !== 1 ? 's' : ''}`;

      if (highlights.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:0.9rem; padding:20px 0;">Nenhum destaque encontrado para este usuário.</div>';
        return;
      }

      const colorMap = {
        yellow: '#fff3a1', green: '#a8e6cf', blue: '#a0c4ff',
        pink: '#ffb3c6', purple: '#d4a5f5', orange: '#ffd6a5'
      };

      // Indexa cada destaque para o handler de clique poder recuperar texto/vol/file sem escape inline
      const indexed = highlights.map((h, i) => ({ ...h, _idx: i }));
      window._currentHlContext = indexed;

      // Agrupar por volume + arquivo
      const grouped = new Map();
      indexed.forEach(h => {
        const key = `${h.volume}__${h.file}`;
        if (!grouped.has(key)) grouped.set(key, { volume: h.volume, file: h.file, items: [] });
        grouped.get(key).items.push(h);
      });

      let html = '';
      for (const [, group] of grouped.entries()) {
        const volLabel = VOL_SHORT[group.volume] || group.volume;
        const fileLabel = getFileTitle(group.volume, group.file);
        html += `
          <div style="margin-bottom:28px;">
            <div style="font-weight:600; color:var(--accent); font-size:0.88rem; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:8px;" title="${_escHtml(group.file)}">
              <span style="background:rgba(184,134,11,0.12); border-radius:6px; padding:2px 8px; font-size:0.72rem; font-weight:700;">${_escHtml(volLabel)}</span>
              ${_escHtml(fileLabel)}
              <span style="font-weight:400; color:var(--text-muted); font-size:0.78rem; margin-left:auto;">${group.items.length} destaque${group.items.length !== 1 ? 's' : ''}</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:10px;">
              ${group.items.map(h => {
                const bg = colorMap[h.color] || '#fff3a1';
                const date = new Date(h.updated_at).toLocaleDateString('pt-BR');
                return `
                  <div class="hl-card" data-hl-idx="${h._idx}" onclick="openHighlightInContext(${h._idx})" title="Clique para ver no contexto" style="cursor:pointer; border-left:4px solid ${bg}; padding:10px 14px; background:var(--surface); border-radius:0 8px 8px 0; border:1px solid var(--border); border-left-color:${bg}; transition:transform 0.12s ease, box-shadow 0.12s ease, opacity 0.25s ease;">
                    ${h.topic_title ? `<div style="font-size:0.73rem; color:var(--text-muted); margin-bottom:4px; font-family:'Outfit',sans-serif;">${_escHtml(h.topic_title)}</div>` : ''}
                    <div style="font-size:0.95rem; line-height:1.6; color:var(--text);">${_escHtml(h.text)}</div>
                    ${h.comment ? `<div style="margin-top:6px; font-size:0.82rem; color:var(--text-muted); font-style:italic; font-family:'Outfit',sans-serif;">📝 ${_escHtml(h.comment)}</div>` : ''}
                    <div style="display:flex; align-items:center; gap:10px; margin-top:8px;">
                      <span style="font-size:0.7rem; color:var(--text-muted); font-family:'Outfit',sans-serif;">${date}</span>
                      <button class="hl-delete-btn" onclick="event.stopPropagation(); deleteHighlightAt(${h._idx})" title="Apagar este destaque" style="margin-left:auto; padding:3px 9px; border:1px solid rgba(255,59,48,0.3); background:rgba(255,59,48,0.06); color:#ff3b30; border-radius:6px; font-size:0.72rem; font-weight:600; cursor:pointer; font-family:'Outfit',sans-serif;">🗑 Apagar</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }
      container.innerHTML = html;
    };

    // Abre o destaque em um modal de LEITURA (não-editável), marcando a passagem
    // com a cor original do usuário e rolando até ela.
    window.openHighlightInContext = function(idx) {
      // Lookup por _idx (não posição) — após deletes o array é filtrado
      const h = (window._currentHlContext || []).find(x => x._idx === idx);
      if (!h || !h.volume || !h.file) return;
      window.openHlReader(h.volume, h.file, {
        text: h.text || '',
        color: h.color || 'yellow',
        comment: h.comment || '',
        topicTitle: h.topic_title || ''
      });
    };

    window.closeHlReader = function() {
      const m = document.getElementById('hl-reader-modal');
      if (m) m.classList.remove('open');
    };

    // Apaga um destaque do usuário (destaques que vazaram por bug, etc).
    // Requer admin (RLS em user_highlights). Confirma antes, anima a remoção do
    // card, atualiza contagens locais e registra a ação em admin_logs.
    window.deleteHighlightAt = async function(idx) {
      // Lookup por _idx (não posição) — após deletes o array é filtrado
      const h = (window._currentHlContext || []).find(x => x._idx === idx);
      if (!h) return;

      const uid = window._currentHlUserId;

      // Estratégia de identificação:
      //   1) id (UUID PK) — caminho padrão se o RPC devolver
      //   2) chave composta (user_id, volume, file, topic_id, start_char, end_char)
      //      — mesma unique constraint usada pelo client em sync.js
      const hasId        = !!h.id;
      const hasComposite = !!uid && h.volume != null && h.file != null
                        && h.topic_id != null && h.start_char != null && h.end_char != null;

      if (!hasId && !hasComposite) {
        const fields = Object.keys(h).filter(k => k !== '_idx').join(', ');
        console.error('[deleteHighlightAt] Faltam campos pra identificar o destaque. Disponíveis:', fields, h);
        alert(
          'Não foi possível identificar este destaque para apagar.\n\n' +
          'O RPC get_user_highlights_for_admin precisa devolver o campo "id" ' +
          '(ou pelo menos topic_id, start_char e end_char). Atualize a função no Supabase.\n\n' +
          'Campos disponíveis agora: ' + fields
        );
        return;
      }

      const preview = (h.text || '').slice(0, 80) + ((h.text || '').length > 80 ? '…' : '');
      if (!confirm(`Apagar este destaque?\n\n"${preview}"\n\nEsta ação não pode ser desfeita.`)) return;

      // Encontra o card e dá feedback de "apagando…"
      const card = document.querySelector(`.hl-card[data-hl-idx="${idx}"]`);
      const btn  = card?.querySelector('.hl-delete-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Apagando…'; }

      try {
        let q = supabase.from('user_highlights').delete({ count: 'exact' });
        if (hasId) {
          q = q.eq('id', h.id);
        } else {
          q = q.eq('user_id', uid)
               .eq('volume', h.volume)
               .eq('file', h.file)
               .eq('topic_id', h.topic_id)
               .eq('start_char', Number(h.start_char))
               .eq('end_char', Number(h.end_char));
        }
        const { error, count } = await q;
        if (error) throw error;
        if (count === 0) throw new Error('Nenhuma linha foi apagada (RLS bloqueou ou destaque já não existia).');

        // Anima a remoção do card
        if (card) {
          card.style.opacity = '0';
          card.style.pointerEvents = 'none';
          setTimeout(() => card.remove(), 250);
        }

        // Atualiza estado local: remove do contexto, ajusta contador no header
        window._currentHlContext = (window._currentHlContext || []).filter(x => x._idx !== idx);
        const remaining = window._currentHlContext.length;
        const countEl = document.getElementById('hl-total-count');
        if (countEl) countEl.textContent = `${remaining} destaque${remaining !== 1 ? 's' : ''}`;

        // Atualiza o badge na lista de usuários (o cache _hlCountByUser)
        const uid = window._currentHlUserId;
        if (uid && _hlCountByUser) {
          _hlCountByUser.set(uid, Math.max(0, (_hlCountByUser.get(uid) || 1) - 1));
          // Re-render da lista de usuários pra atualizar o badge
          const q = (document.getElementById('hl-user-search')?.value || '').toLowerCase();
          const filtered = q
            ? allUsers.filter(u => (u.display_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
            : allUsers;
          renderHlUserList(filtered);
        }

        // Se era o último, mostra estado vazio
        if (remaining === 0) {
          const container = document.getElementById('hl-results-container');
          if (container) container.innerHTML = '<div style="color:var(--text-muted); font-size:0.9rem; padding:20px 0;">Nenhum destaque restante para este usuário.</div>';
        }

        // Registra a ação
        logAdminAction('delete_highlight', {
          user_id: uid,
          user_name: window._currentHlUserName || '—',
          volume: h.volume,
          file: h.file,
          trecho: (h.text || '').slice(0, 120)
        });
      } catch (err) {
        console.error('[deleteHighlightAt]', err);
        alert(`Erro ao apagar destaque: ${err.message || err}`);
        if (btn) { btn.disabled = false; btn.textContent = '🗑 Apagar'; }
      }
    };

    // Remove TODAS as cores/fontes inline do HTML legado dos ensinamentos
    // (font color, bgcolor, color: nos style=""). Garante que o modal renderize
    // tudo no tema padrão, sem depender de overrides CSS frágeis.
    function _neutralizeContentHtml(html) {
      if (!html) return '';
      return String(html)
        // Atributos presentacionais HTML4
        .replace(/\s(?:color|bgcolor|face|size)\s*=\s*"[^"]*"/gi, '')
        .replace(/\s(?:color|bgcolor|face|size)\s*=\s*'[^']*'/gi, '')
        .replace(/\s(?:color|bgcolor|face|size)\s*=\s*[^\s>]+/gi, '')
        // Limpa color/background/font-* dentro de style=""
        .replace(/\sstyle\s*=\s*"([^"]*)"/gi, (_, css) => {
          const cleaned = css
            .replace(/(?:^|;)\s*(?:color|background|background-color|font-family|font-size)\s*:[^;]*/gi, '')
            .replace(/^\s*;+/, '').trim();
          return cleaned ? ` style="${cleaned}"` : '';
        })
        .replace(/\sstyle\s*=\s*'([^']*)'/gi, (_, css) => {
          const cleaned = css
            .replace(/(?:^|;)\s*(?:color|background|background-color|font-family|font-size)\s*:[^;]*/gi, '')
            .replace(/^\s*;+/, '').trim();
          return cleaned ? ` style='${cleaned}'` : '';
        });
    }

    // Modal de leitura: baixa o JSON do ensinamento, renderiza o lado PT em modo
    // somente-leitura, marca o trecho destacado pelo usuário com a cor original e
    // rola até a primeira ocorrência. Se não encontrar em PT, tenta JA.
    window.openHlReader = async function(vol, file, opts = {}) {
      const { text = '', color = 'yellow', comment = '', topicTitle = '' } = opts;
      const fileName = file.endsWith('.json') ? file : file + '.json';

      const modal    = document.getElementById('hl-reader-modal');
      const body     = document.getElementById('hl-reader-body');
      const titleEl  = document.getElementById('hl-reader-title');
      const metaEl   = document.getElementById('hl-reader-meta');
      const snipEl   = document.getElementById('hl-reader-snippet');

      // Garante que o mapa de títulos esteja carregado
      if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
        try { await loadVolumeFiles(); } catch (e) {}
      }

      titleEl.textContent = getFileTitle(vol, file);
      metaEl.textContent  = `${VOL_SHORT[vol] || vol} · ${fileName}`;

      // Mostra o snippet APENAS quando há comentário do usuário — caso contrário
      // o trecho destacado e o título já aparecem no corpo (evita poluição visual).
      if (comment) {
        snipEl.innerHTML = `📝 ${_escHtml(comment)}`;
        snipEl.style.display = 'block';
      } else {
        snipEl.style.display = 'none';
      }

      body.innerHTML = '<div class="hl-reader-msg">Baixando ensinamento…</div>';
      modal.classList.add('open');

      try {
        const { data, error } = await supabase.storage.from('teachings').download(`${vol}/${fileName}`);
        if (error) throw error;
        if (!data) throw new Error('Arquivo vazio ou indisponível.');

        const json = JSON.parse(await data.text());
        if (!json || !Array.isArray(json.themes)) throw new Error('Estrutura inesperada (sem themes).');

        // Renderiza PT (preferencial). Se PT estiver vazio para um tópico, cai pro JA.
        // Sem header próprio: o content_ptbr já traz seu próprio título + data, então
        // adicionar um header em maiúsculas duplicaria a informação.
        let html = '';
        json.themes.forEach((theme) => {
          (theme.topics || []).forEach((topic) => {
            const ptContent = topic.content_ptbr || topic.content_pt || '';
            const jaContent = topic.content || '';
            const useContent = (ptContent && ptContent.trim()) ? ptContent : jaContent;
            if (!useContent || !useContent.trim()) return;
            html += `
              <div class="hl-reader-topic">
                <div class="hl-reader-topic-content html-content">${_neutralizeContentHtml(useContent)}</div>
              </div>
            `;
          });
        });
        body.innerHTML = html || '<div class="hl-reader-msg">Sem conteúdo disponível neste ensinamento.</div>';

        // Marca a passagem destacada (texto puro, whitespace-insensitive).
        // A marca usa um tom único e sutil via CSS — sem refletir a cor escolhida
        // pelo usuário, para manter o modal visualmente limpo.
        if (text) {
          const blocks = body.querySelectorAll('.hl-reader-topic-content');
          let firstMark = null;
          for (const el of blocks) {
            const count = _wrapAllMatchesInElement(el, text, 'hl-reader-mark');
            if (count > 0 && !firstMark) firstMark = el.querySelector('mark.hl-reader-mark');
          }

          if (firstMark) {
            setTimeout(() => firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
          } else {
            const warn = document.createElement('div');
            warn.className = 'hl-reader-warn';
            warn.innerHTML = 'Trecho destacado não foi localizado automaticamente. Use <b>Ctrl+F</b> para buscar.';
            body.insertBefore(warn, body.firstChild);
          }
        }
      } catch (err) {
        console.error('[openHlReader]', err);
        body.innerHTML = `<div class="hl-reader-msg" style="color:#c0392b;">Erro ao carregar: ${_escHtml(err.message || String(err))}</div>`;
      }
    };

    // ESC fecha o modal de leitura quando aberto
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const m = document.getElementById('hl-reader-modal');
      if (m && m.classList.contains('open')) window.closeHlReader();
    });

    window.switchAdminSection = function(section) {
      document.querySelectorAll('.tab-group[data-section]').forEach(g => {
        g.style.display = g.dataset.section === section ? '' : 'none';
      });
      try { localStorage.setItem('admin_section', section); } catch (e) {}
      const firstTab = { 'landing': 'calendar', 'caminho': 'users', 'johrei': 'analytics-johrei' }[section];
      if (firstTab && window.switchTab) window.switchTab(firstTab);
    };

    (function _restoreAdminSection() {
      try {
        const saved = localStorage.getItem('admin_section') || 'caminho';
        const sel = document.getElementById('adminSectionSel');
        if (sel) sel.value = saved;
        // Defer so switchTab is already defined when this runs
        setTimeout(() => window.switchAdminSection(saved), 0);
      } catch (e) { setTimeout(() => window.switchAdminSection('caminho'), 0); }
    })();

    window.switchTab = function(tab) {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      const tabIndex = { 'analytics-landing': 0, 'calendar': 1, 'access': 2, 'announcements': 3, 'analytics': 4, 'analytics-disciples': 5, 'analytics-search': 6, 'users': 7, 'destaques': 8, 'reports': 9, 'findreplace': 10, 'logs': 11, 'analytics-johrei': 12, 'essencia-guia': 13 }[tab];
      document.querySelectorAll('.admin-tab')[tabIndex].classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'analytics') {
        loadAnalytics();
        if (_onlineRefreshInterval) clearInterval(_onlineRefreshInterval);
        _onlineRefreshInterval = setInterval(loadOnlineUsers, 60000);
      } else {
        if (_onlineRefreshInterval) { clearInterval(_onlineRefreshInterval); _onlineRefreshInterval = null; }
      }
      if (tab === 'reports') loadReports();
      if (tab === 'destaques') initHlTab();
      if (tab === 'calendar') loadCalendarEvents();
      if (tab === 'announcements') loadAnnouncements();
      if (tab === 'access') loadAccessInfo();
      if (tab === 'logs') loadAdminLogs();
      if (tab === 'analytics-johrei') loadJohreiAnalytics();
      if (tab === 'analytics-landing') loadLandingAnalytics();
      if (tab === 'analytics-disciples') loadDisciplesAnalytics();
      if (tab === 'analytics-search') loadSearchAnalytics();
    };

    // ============================================================
    // Calendar Events (landing CMU)
    // ============================================================
    function _escapeCmu(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    window.loadCalendarEvents = async function() {
      const list = document.getElementById('cal-list');
      const count = document.getElementById('cal-count');
      list.innerHTML = '<div class="loading">Carregando...</div>';
      const { data, error } = await supabase
        .from('calendar_events')
        .select('id, date, title, description, created_at')
        .order('date', { ascending: false })
        .limit(500);
      if (error) {
        list.innerHTML = `<div class="msg err">Erro: ${_escapeCmu(error.message)}</div>`;
        return;
      }
      count.textContent = `(${data.length})`;
      if (!data.length) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">Nenhum evento cadastrado.</p>';
        return;
      }
      list.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Data</th><th>Título</th><th>Descrição</th><th></th></tr></thead>
          <tbody>
            ${data.map(e => `
              <tr>
                <td style="white-space:nowrap; font-variant-numeric:tabular-nums;">${_escapeCmu(e.date)}</td>
                <td><strong>${_escapeCmu(e.title)}</strong></td>
                <td style="color:var(--text-muted);">${_escapeCmu(e.description || '')}</td>
                <td><button class="editor-btn-cancel" onclick="deleteCalendarEvent('${e.id}')" style="padding:4px 10px; font-size:0.8rem;">Excluir</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    };

    window.calAtalho = function(alvo) {
      const d = new Date();
      if (alvo === 0 || alvo === 1) {
        d.setDate(d.getDate() + alvo);
      } else {
        const alvo_dow = alvo === 'sab' ? 6 : 0;
        const diff = (alvo_dow - d.getDay() + 7) % 7 || 7;
        d.setDate(d.getDate() + diff);
      }
      document.getElementById('cal-date').value = d.toISOString().slice(0, 10);
    };

    window.addCalendarEvent = async function() {
      const date    = document.getElementById('cal-date').value;
      const title   = document.getElementById('cal-title').value.trim();
      const horario = document.getElementById('cal-horario').value.trim();
      const obs     = document.getElementById('cal-desc').value.trim();
      const description = [horario, obs].filter(Boolean).join(' — ') || null;
      const msg = document.getElementById('cal-msg');
      if (!date || !title) {
        msg.className = 'msg err';
        msg.textContent = 'Data e título são obrigatórios.';
        return;
      }
      const { error } = await supabase.from('calendar_events').insert({ date, title, description });
      if (error) {
        msg.className = 'msg err';
        msg.textContent = 'Erro: ' + error.message;
        return;
      }
      msg.className = 'msg ok';
      msg.textContent = 'Evento adicionado.';
      document.getElementById('cal-date').value = '';
      document.getElementById('cal-horario').value = '';
      document.getElementById('cal-title').value = '';
      document.getElementById('cal-desc').value = '';
      loadCalendarEvents();
    };

    window.deleteCalendarEvent = async function(id) {
      if (!confirm('Excluir este evento?')) return;
      const { error } = await supabase.from('calendar_events').delete().eq('id', id);
      if (error) { alert('Erro: ' + error.message); return; }
      loadCalendarEvents();
    };

    // ============================================================
    // Announcements (landing CMU)
    // ============================================================
    window.loadAnnouncements = async function() {
      const list = document.getElementById('ann-list');
      const count = document.getElementById('ann-count');
      list.innerHTML = '<div class="loading">Carregando...</div>';
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, body, published_at, is_active')
        .order('published_at', { ascending: false })
        .limit(200);
      if (error) {
        list.innerHTML = `<div class="msg err">Erro: ${_escapeCmu(error.message)}</div>`;
        return;
      }
      count.textContent = `(${data.length})`;
      if (!data.length) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">Nenhum comunicado publicado.</p>';
        return;
      }
      list.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Publicado</th><th>Título</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${data.map(a => `
              <tr>
                <td style="white-space:nowrap; font-variant-numeric:tabular-nums;">${new Date(a.published_at).toLocaleDateString('pt-BR')}</td>
                <td>
                  <strong>${_escapeCmu(a.title)}</strong>
                  <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px; max-width:480px;">${_escapeCmu((a.body || '').slice(0, 140))}${(a.body || '').length > 140 ? '…' : ''}</div>
                </td>
                <td>
                  <label style="display:inline-flex; gap:6px; align-items:center; cursor:pointer;">
                    <input type="checkbox" ${a.is_active ? 'checked' : ''} onchange="toggleAnnouncement('${a.id}', this.checked)">
                    ${a.is_active ? '<span style="color:var(--accent); font-size:0.8rem;">Ativo</span>' : '<span style="color:var(--text-muted); font-size:0.8rem;">Inativo</span>'}
                  </label>
                </td>
                <td><button class="editor-btn-cancel" onclick="deleteAnnouncement('${a.id}')" style="padding:4px 10px; font-size:0.8rem;">Excluir</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    };

    window.addAnnouncement = async function() {
      const title = document.getElementById('ann-title').value.trim();
      const body = document.getElementById('ann-body').value.trim();
      const is_active = document.getElementById('ann-active').checked;
      const msg = document.getElementById('ann-msg');
      if (!title || !body) {
        msg.className = 'msg err';
        msg.textContent = 'Título e corpo são obrigatórios.';
        return;
      }
      const { error } = await supabase.from('announcements').insert({ title, body, is_active });
      if (error) {
        msg.className = 'msg err';
        msg.textContent = 'Erro: ' + error.message;
        return;
      }
      msg.className = 'msg ok';
      msg.textContent = 'Comunicado publicado.';
      document.getElementById('ann-title').value = '';
      document.getElementById('ann-body').value = '';
      document.getElementById('ann-active').checked = true;
      loadAnnouncements();
    };

    window.toggleAnnouncement = async function(id, active) {
      const { error } = await supabase.from('announcements').update({ is_active: active }).eq('id', id);
      if (error) { alert('Erro: ' + error.message); return; }
      loadAnnouncements();
    };

    window.deleteAnnouncement = async function(id) {
      if (!confirm('Excluir este comunicado?')) return;
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) { alert('Erro: ' + error.message); return; }
      loadAnnouncements();
    };

    // ============================================================
    // Access Info (difusões e casas de Johrei — landing CMU)
    // ============================================================
    let _editingAccessId = null;
    let _accessInfoMap = {};

    function _collectAccessForm() {
      return {
        category:   document.getElementById('access-category').value,
        nome:       document.getElementById('access-nome').value.trim(),
        endereco:   document.getElementById('access-endereco').value.trim() || null,
        dias:       document.getElementById('access-dias').value.trim() || null,
        horario:    [document.getElementById('access-horario-ini').value, document.getElementById('access-horario-fim').value].filter(Boolean).join(' às ') || null,
        telefone:   document.getElementById('access-telefone').value.trim() || null,
        sort_order: Number(document.getElementById('access-sort').value) || 0,
        is_active:  document.getElementById('access-active').checked,
      };
    }

    window.resetAccessForm = function() {
      _editingAccessId = null;
      document.getElementById('access-form-title').textContent = 'Novo Registro';
      document.getElementById('access-category').value = 'difusao';
      document.getElementById('access-nome').value = '';
      document.getElementById('access-endereco').value = '';
      document.getElementById('access-dias').value = '';
      document.getElementById('access-horario-ini').value = '';
      document.getElementById('access-horario-fim').value = '';
      document.getElementById('access-telefone').value = '';
      document.getElementById('access-sort').value = '0';
      document.getElementById('access-active').checked = true;
      document.getElementById('access-add-btn').textContent = 'Adicionar';
      document.getElementById('access-cancel-btn').style.display = 'none';
      document.getElementById('access-msg').className = 'msg';
    };

    window.editAccessInfo = function(id) {
      const a = _accessInfoMap[id];
      if (!a) return;
      _editingAccessId = id;
      document.getElementById('access-form-title').textContent = 'Editando registro';
      document.getElementById('access-category').value = a.category || 'difusao';
      document.getElementById('access-nome').value = a.nome || '';
      document.getElementById('access-endereco').value = a.endereco || '';
      document.getElementById('access-dias').value = a.dias || '';
      const [hIni = '', hFim = ''] = (a.horario || '').split(' às ');
      document.getElementById('access-horario-ini').value = hIni;
      document.getElementById('access-horario-fim').value = hFim;
      document.getElementById('access-telefone').value = a.telefone || '';
      document.getElementById('access-sort').value = a.sort_order ?? 0;
      document.getElementById('access-active').checked = a.is_active;
      document.getElementById('access-add-btn').textContent = 'Atualizar';
      document.getElementById('access-cancel-btn').style.display = '';
      document.getElementById('access-nome').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    window.saveAccessInfo = async function() {
      const payload = _collectAccessForm();
      const msg = document.getElementById('access-msg');
      if (!payload.nome) {
        msg.className = 'msg err'; msg.textContent = 'Nome é obrigatório.'; return;
      }
      const btn = document.getElementById('access-add-btn');
      btn.disabled = true;
      let error;
      if (_editingAccessId) {
        ({ error } = await supabase.from('access_info').update(payload).eq('id', _editingAccessId));
      } else {
        ({ error } = await supabase.from('access_info').insert(payload));
      }
      btn.disabled = false;
      if (error) { msg.className = 'msg err'; msg.textContent = 'Erro: ' + error.message; return; }
      msg.className = 'msg ok';
      msg.textContent = _editingAccessId ? 'Registro atualizado.' : 'Registro adicionado.';
      resetAccessForm();
      loadAccessInfo();
    };

    window.toggleAccessInfo = async function(id, active) {
      const { error } = await supabase.from('access_info').update({ is_active: active }).eq('id', id);
      if (error) { alert('Erro: ' + error.message); return; }
      loadAccessInfo();
    };

    window.deleteAccessInfo = async function(id) {
      if (!confirm('Excluir este registro?')) return;
      const { error } = await supabase.from('access_info').delete().eq('id', id);
      if (error) { alert('Erro: ' + error.message); return; }
      loadAccessInfo();
    };

    window.loadAccessInfo = async function() {
      const list = document.getElementById('access-list');
      const count = document.getElementById('access-count');
      list.innerHTML = '<div class="loading">Carregando...</div>';
      const { data, error } = await supabase
        .from('access_info')
        .select('id, category, nome, endereco, dias, horario, telefone, is_active, sort_order')
        .order('sort_order', { ascending: true });
      if (error) {
        list.innerHTML = `<div class="msg err">Erro: ${_escapeCmu(error.message)}</div>`; return;
      }
      _accessInfoMap = {};
      (data || []).forEach(a => { _accessInfoMap[a.id] = a; });
      count.textContent = `(${(data || []).length})`;
      if (!data || !data.length) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">Nenhum registro cadastrado.</p>'; return;
      }
      list.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Categoria</th><th>Nome</th><th>Endereço</th>
              <th>Dias / Horário</th><th>Telefone</th><th>Ord.</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${data.map(a => `
              <tr>
                <td><span style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--accent); letter-spacing:.04em;">
                  ${{ sede: 'Sede', regional: 'Regional', difusao: 'Difusão', johrei: 'Johrei' }[a.category] || a.category}
                </span></td>
                <td><strong>${_escapeCmu(a.nome || '')}</strong></td>
                <td style="font-size:0.82rem; color:var(--text-muted); max-width:200px;">${_escapeCmu(a.endereco || '—')}</td>
                <td style="font-size:0.82rem;">
                  ${a.dias    ? `<div>${_escapeCmu(a.dias)}</div>` : ''}
                  ${a.horario ? `<div style="color:var(--text-muted);">${_escapeCmu(a.horario)}</div>` : ''}
                  ${!a.dias && !a.horario ? '—' : ''}
                </td>
                <td style="font-size:0.82rem; white-space:nowrap;">${_escapeCmu(a.telefone || '—')}</td>
                <td style="font-variant-numeric:tabular-nums; text-align:center;">${a.sort_order ?? 0}</td>
                <td>
                  <label style="display:inline-flex; gap:6px; align-items:center; cursor:pointer;">
                    <input type="checkbox" ${a.is_active ? 'checked' : ''} onchange="toggleAccessInfo('${a.id}', this.checked)">
                    ${a.is_active
                      ? '<span style="color:var(--accent); font-size:0.8rem;">Ativo</span>'
                      : '<span style="color:var(--text-muted); font-size:0.8rem;">Inativo</span>'}
                  </label>
                </td>
                <td style="white-space:nowrap;">
                  <button class="reset-btn" onclick="editAccessInfo('${a.id}')">Editar</button>
                  <button class="delete-btn" onclick="deleteAccessInfo('${a.id}')">Excluir</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    };

    let _reportsLoaded = false;
    let _allReports = [];

    async function loadReports(forceReload = false) {
      if (_reportsLoaded && !forceReload) return;
      _reportsLoaded = true;

      const container = document.getElementById('reportsContainer');
      const summary = document.getElementById('reportsSummary');
      container.innerHTML = '<div class="loading">Carregando relatórios...</div>';

      const { data, error } = await supabase
        .from('translation_reports')
        .select('id, vol, file, topic_id, lang, selected_text, description, created_at, status, user_id')
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) {
        container.innerHTML = `<div class="msg err">Erro ao carregar: ${_escHtml(error.message)}</div>`;
        return;
      }

      _allReports = data || [];

      // Carrega notas de todos os reports em uma query só
      if (_allReports.length) {
        const ids = _allReports.map(r => r.id);
        const { data: notes } = await supabase
          .from('report_notes')
          .select('id, report_id, admin_id, note, created_at')
          .in('report_id', ids)
          .order('created_at', { ascending: true });
        _reportNotes = {};
        (notes || []).forEach(n => {
          if (!_reportNotes[n.report_id]) _reportNotes[n.report_id] = [];
          _reportNotes[n.report_id].push(n);
        });
      }

      if (!volumeCategories || Object.keys(volumeCategories).length === 0) {
        try { await loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
      }

      _renderReports();
    }

    function _renderReports() {
      const container = document.getElementById('reportsContainer');
      const summary = document.getElementById('reportsSummary');
      const reports = _allReports;

      const pending  = reports.filter(r => r.status !== 'verified');
      const verified = reports.filter(r => r.status === 'verified');

      // ── Badge: only pending count ──────────────────────────────────
      const badge = document.getElementById('reportsTabBadge');
      if (badge) {
        badge.textContent = pending.length;
        badge.classList.toggle('empty', pending.length === 0);
      }

      // ── Summary cards ──────────────────────────────────────────────
      const uniqueFiles = new Set(pending.map(r => `${r.vol}/${r.file}`)).size;
      const volCounts = {};
      pending.forEach(r => { volCounts[r.vol] = (volCounts[r.vol] || 0) + 1; });
      const topVol = Object.entries(volCounts).sort((a, b) => b[1] - a[1])[0];

      summary.innerHTML = `
        <div class="report-summary-item">
          <div class="val">${pending.length}</div>
          <div class="lbl">Pendentes</div>
        </div>
        <div class="report-summary-item">
          <div class="val">${uniqueFiles}</div>
          <div class="lbl">Arquivos Distintos</div>
        </div>
        <div class="report-summary-item">
          <div class="val">${topVol ? (VOL_SHORT[topVol[0]] || topVol[0]) : '—'}</div>
          <div class="lbl">Volume c/ mais reportes</div>
        </div>
        <div class="report-summary-item">
          <div class="val" style="color:#34c759">${verified.length}</div>
          <div class="lbl">Verificados</div>
        </div>
      `;

      // ── Build report card HTML ──────────────────────────────────────
      function buildCard(r, isPending) {
        const date = new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        const escapedText = r.selected_text?.replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';
        const escapedDesc = r.description?.replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';
        const fileLabel = r.file ? getFileTitle(r.vol, r.file) : '—';
        const langLabel = r.lang === 'ja' ? '🇯🇵 Japonês' : '🇧🇷 Português';

        let userName = 'Usuário Desconhecido';
        if (r.user_id) {
          const u = allUsers.find(x => x.id === r.user_id);
          if (u) userName = u.display_name || u.email || 'Usuário';
        }

        const verifyBtn = isPending
          ? `<button class="report-verify-btn" onclick="verifyReport('${r.id}', this)" title="Marcar como verificado">
               <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
               Verificado
             </button>`
          : `<span class="report-verified-tag">✓ Verificado</span>`;

        const editBtn = `<button class="report-verify-btn" style="background:rgba(255,160,0,0.1); color:var(--text); border-color:var(--border);" onclick="openEditorFromReport('${r.id}')" title="Abrir editor já localizando o trecho reportado">✏️ Editar</button>`;
        const aiBtn = `<button class="report-verify-btn" style="background:rgba(99,102,241,0.1); color:#6366f1; border-color:rgba(99,102,241,0.3);" onclick="suggestTranslationWithAI('${r.id}')" title="Sugerir correção pontual via Claude AI">✨ Sugerir IA</button>`;

        return `
          <div class="report-card" id="report-card-${r.id}">
            <div class="report-header">
              <span class="report-vol">${VOL_SHORT[r.vol] || r.vol}</span>
              <span class="report-file" title="${_escHtml(r.file || '')}">${_escHtml(fileLabel)}</span>
              <span class="report-lang">${langLabel}</span>
              <span class="report-user">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                ${userName}
              </span>
              <span class="report-date">${date}</span>
              <div class="report-actions" style="display:flex; gap:8px; flex-wrap:wrap;">
                ${editBtn}
                ${aiBtn}
                ${verifyBtn}
              </div>
            </div>
            <div class="report-text"><mark class="report-selected">${escapedText}</mark></div>
            ${escapedDesc ? `<div class="report-description">${escapedDesc}</div>` : ''}
            <div class="rn-thread">
              <div class="rn-label">💬 Notas internas</div>
              <div id="rn-thread-${r.id}">${_buildNotesThread(r.id)}</div>
              <div class="rn-input-row">
                <textarea id="rn-input-${r.id}" class="rn-input"
                  placeholder="Escreva uma nota… (Ctrl+Enter para enviar)"
                  onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){sendReportNote('${r.id}');event.preventDefault();}"></textarea>
                <button class="rn-send" onclick="sendReportNote('${r.id}')">Enviar</button>
              </div>
            </div>
          </div>`;
      }

      // ── Pending section ────────────────────────────────────────────
      let html = '';

      if (pending.length === 0) {
        html += '<div class="report-empty">✅ Todos os reportes foram verificados.</div>';
      } else {
        const byVol = {};
        pending.forEach(r => {
          if (!byVol[r.vol]) byVol[r.vol] = [];
          byVol[r.vol].push(r);
        });

        html += '<div class="report-list" id="pendingList">';
        for (const vol of ['mioshiec1','mioshiec2','mioshiec3','mioshiec4']) {
          const group = byVol[vol];
          if (!group || group.length === 0) continue;
          const volName = VOLUMES.find(v => v.key === vol)?.name || vol;
          html += `<div class="report-group-label">⚠ ${volName} — ${group.length} reporte${group.length !== 1 ? 's' : ''}</div>`;
          group.forEach(r => { html += buildCard(r, true); });
        }
        html += '</div>';
      }

      // ── Verified collapsible section ───────────────────────────────
      if (verified.length > 0) {
        html += `
          <div class="report-verified-section" id="verifiedSection">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <button class="report-verify-btn" id="verifiedToggle" onclick="toggleVerifiedSection()" style="gap:6px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="verifiedToggleIcon" style="transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>
                Histórico de Verificados <span style="opacity:0.6; font-weight:400;">(${verified.length})</span>
              </button>
              <button class="report-verify-btn" style="background:rgba(255,59,48,0.1); color:#ff3b30; border-color:rgba(255,59,48,0.2); padding:6px 12px; font-size:0.75rem;" onclick="clearVerifiedHistory(this)" title="Apagar todos os relatórios verificados">
                ✕ Limpar Histórico
              </button>
            </div>
            <div class="report-verified-body" id="verifiedBody" style="display:none">
              <div class="report-list">`;

        const byVolV = {};
        verified.forEach(r => {
          if (!byVolV[r.vol]) byVolV[r.vol] = [];
          byVolV[r.vol].push(r);
        });
        for (const vol of ['mioshiec1','mioshiec2','mioshiec3','mioshiec4']) {
          const group = byVolV[vol];
          if (!group || group.length === 0) continue;
          const volName = VOLUMES.find(v => v.key === vol)?.name || vol;
          html += `<div class="report-group-label" style="opacity:0.6">✓ ${volName} — ${group.length}</div>`;
          group.forEach(r => { html += buildCard(r, false); });
        }

        html += `      </div>
            </div>
          </div>`;
      }

      container.innerHTML = html;
    }

    window.toggleVerifiedSection = function() {
      const body = document.getElementById('verifiedBody');
      const icon = document.getElementById('verifiedToggleIcon');
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      if (icon) icon.style.transform = open ? '' : 'rotate(180deg)';
    };

    window.verifyReport = async function(id, btnEl) {
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = '...'; }

      const { error } = await supabase
        .from('translation_reports')
        .update({ status: 'verified' })
        .eq('id', id);

      if (error) {
        console.error('[admin] verifyReport failed:', error.message);
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Verificado'; }
        return;
      }

      // Update local state and re-render without full reload
      const idx = _allReports.findIndex(r => r.id === id);
      if (idx !== -1) _allReports[idx].status = 'verified';
      _renderReports();
    };

    function _buildNotesThread(reportId) {
      const notes = _reportNotes[reportId] || [];
      if (!notes.length) return '<div class="rn-empty">Nenhuma nota ainda.</div>';
      return notes.map(n => {
        const isMine = n.admin_id === _myUid;
        const author = allUsers.find(u => u.id === n.admin_id);
        const name = author?.display_name || 'Admin';
        const initial = name[0].toUpperCase();
        const hora = new Date(n.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        const delBtn = isMine
          ? `<button class="rn-del" onclick="deleteReportNote('${n.id}','${reportId}')" title="Apagar">✕</button>`
          : '';
        return `
          <div class="rn-bubble">
            <div class="rn-avatar${isMine ? ' mine' : ''}">${initial}</div>
            <div class="rn-body">
              <div class="rn-meta">
                <span class="rn-name">${_escHtml(isMine ? 'Você' : name)}</span>
                <span>${hora}</span>
                ${delBtn}
              </div>
              <div class="rn-text">${_escHtml(n.note)}</div>
            </div>
          </div>`;
      }).join('');
    }

    window.sendReportNote = async function(reportId) {
      const textarea = document.getElementById(`rn-input-${reportId}`);
      const text = textarea?.value?.trim();
      if (!text) return;

      const btn = textarea?.closest('.rn-input-row')?.querySelector('.rn-send');
      if (btn) { btn.disabled = true; btn.textContent = '…'; }

      const { data: note, error } = await supabase
        .from('report_notes')
        .insert({ report_id: reportId, admin_id: _myUid, note: text })
        .select()
        .single();

      if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }

      if (error) { console.error('[report notes] send failed:', error.message); return; }

      if (!_reportNotes[reportId]) _reportNotes[reportId] = [];
      _reportNotes[reportId].push(note);
      textarea.value = '';

      const thread = document.getElementById(`rn-thread-${reportId}`);
      if (thread) {
        thread.innerHTML = _buildNotesThread(reportId);
        thread.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };

    window.deleteReportNote = async function(noteId, reportId) {
      const { error } = await supabase
        .from('report_notes')
        .delete()
        .eq('id', noteId);

      if (error) { console.error('[report notes] delete failed:', error.message); return; }

      if (_reportNotes[reportId]) {
        _reportNotes[reportId] = _reportNotes[reportId].filter(n => n.id !== noteId);
      }

      const thread = document.getElementById(`rn-thread-${reportId}`);
      if (thread) thread.innerHTML = _buildNotesThread(reportId);
    };

    // Diretrizes compartilhadas pelos prompts de sugestão e retradução.
    // Mantém glossário, registro PT-BR e exemplos de calibração GOOD/BAD em
    // um só lugar — qualquer ajuste afeta os dois fluxos.
    const TRANSLATION_GUIDELINES = `Você é um revisor sênior brasileiro, devoto da Sekaikyūseikyō, com conhecimento profundo do registro religioso e doutrinário em português brasileiro. Sua tradução deve soar como Meishu-sama falando diretamente com discípulos brasileiros.

PRINCÍPIO DOUTRINÁRIO FUNDAMENTAL: aquilo que o mundo chama de "doença" é, sob a ótica de Meishu-sama, purificação se manifestando. O frame deve ser sempre espiritual, nunca clínico. Quando o autor descreve o fenômeno externo, é legítimo usar "doença"; quando a perspectiva é doutrinária, preferir "purificação", "manifestação" ou "afecção".

GLOSSÁRIO MANDATÓRIO (nunca traduzir por sinônimos):
- 浄化 / jōka → purificação
- 病気 / byōki (fenômeno externo) → doença
- 薬毒 / yakudoku → toxinas medicinais (nunca "veneno")
- 急所 / kyūsho → ponto vital
- 固まり / katamari → indurações (técnico) ou solidificações (nódulos)
- 浄霊 / jōrei → Johrei (nunca traduzir)
- 御光 / Ohikari → Ohikari (nunca traduzir; 1ª menção: "Ohikari [御光]")
- 浄霊医術 → arte do Johrei (NUNCA "arte médica do Johrei")
- 力を抜く → retirar a força (nunca "relaxar a força")
- 観音 / Kannon → Kannon [観音] (1ª menção), depois Kannon
- 釈尊 / Shakuson → Shakuson [釈尊] (1ª menção), depois Shakuson
- 神様 / kamisama → Deus (sem "nosso", sem "o Senhor")
- 教え / oshie → ensinamento (não "doutrina")
- 救い / sukui → salvação
- 御加護 / gokago → proteção divina
- 因縁 / in'nen → vínculo cármico
- 業 / gō → carma
- 罪穢 / zaie → impurezas espirituais
- 真理 / shinri → verdade
- 信仰 / shinkō → fé (não "crença", não "fervor")
- 想念 / sonen → sonen (em itálico, minúsculo)
- 原因 (em contexto patológico) → etiologia (técnico) ou causa (narrativo)
- 御神霊 / Kami genérico → Deus
- Tratamento: sempre "Meishu-sama" (minúsculo no sama)
- Pergunta-resposta: **(Pergunta)** e **(Meishu-sama)** em negrito

CALIBRAÇÃO DE REGISTRO PT-BR (CRÍTICO):

Português brasileiro elevado mas vivo. Solene, mas não pomposo. Sábio, mas não acadêmico. Direto, mas não casual. Como um mestre japonês falando em português brasileiro fluente — autoridade tranquila, sabedoria sem ostentação.

EVITAR (lusitanismos, academicismos, pompa desnecessária):
- "Ademais" / "Outrossim" → use "Além disso", "E ainda", "E também"
- "Cumpre" / "Insta" / "Mister" → use "É preciso", "É necessário"
- "Eis que" / "Há de se notar" → use "Vejam:", "Pois bem,", "É preciso notar"
- "Constitui verdadeiramente" → use "É verdadeiramente"
- "Tal qual" desnecessário → use "Assim como"
- "Em contrapartida" excessivo → alterne com "Por outro lado", "Já"
- "Sob esta ótica" / "Em tal mister" → use "Deste ponto de vista", "Vendo assim"
- "Outrora" → use "Antigamente", "No passado"
- "Por conseguinte" / "Destarte" → use "Por isso", "Assim", "Desta forma"
- "Configura-se como" → use "É", "Constitui"
- "Há que se" → use "É preciso"
- "Nesta senda" / "Sob este prisma" → use "Neste sentido", "Assim"

PREFERIR:
- Conectivos brasileiros vivos: "Por isso", "Assim", "Desta forma", "E então"
- Convocações diretas: "Vejam:", "Pensem nisto:", "Compreendam:", "É fundamental compreender:"
- Modernidade: "É preciso" em vez de "É imperativo"
- Sacralidade brasileira: "graça divina", "missão", "fé verdadeira", "elevação espiritual"
- Afirmações fortes: "É impossível", "Inexiste", "É de fato", "Verdadeiramente"

EXEMPLOS DE CALIBRAÇÃO (estude e siga este padrão):

JP: それを否定するわけにはいかない。
❌ "Não se pode obstá-lo." (rebuscado, lusitano)
✅ "Não se pode negar isso." (natural, claro, mantém autoridade)

JP: 神様の恵みは無限である。
❌ "A graça divina constitui verdadeiramente o infinito." (pomposo)
✅ "A graça de Deus é infinita." (direto, profundo, brasileiro)

JP: 病気とは浄化作用である。
❌ "A enfermidade configura-se como atuação purificatória." (acadêmico)
✅ "A doença é a purificação se manifestando." (claro, doutrinário)

JP: それゆえ、信仰深き者は救われる。
❌ "Outrossim, aqueles dotados de profunda fé hão de ser salvos." (lusitano + pomposo)
✅ "Por isso, aqueles que têm fé verdadeira são salvos." (vivo, brasileiro, sacro)

JP: 浄霊を行なうにあたっては、力を抜くことが肝要である。
❌ "Cumpre, ao ministrar Johrei, despojar-se do esforço muscular." (acadêmico, errado terminologicamente)
✅ "Ao ministrar Johrei, é fundamental retirar a força." (correto, direto)

ESTILO GERAL:
- Tom de mestre falando com discípulos (autoridade tranquila, não professoral)
- Naturalizar metáforas mantendo a intenção espiritual (Shin-i [真意])
- Bijeção 1:1 de parágrafos JP↔PT — NUNCA fundir nem dividir parágrafos
- Linhas em branco onde o JP tem linha em branco
- Pergunta-resposta: cada turno é um parágrafo separado`;

    window.suggestTranslationWithAI = async function(reportId) {
      const r = _allReports.find(x => x.id === reportId);
      if (!r) return;

      const btn = document.querySelector(`#report-card-${reportId} button[onclick*="suggestTranslationWithAI"]`);
      const origHtml = btn?.innerHTML;
      if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Buscando…'; }

      // Busca content_ja e content_pt do tópico correspondente
      const topicIdx = parseInt((r.topic_id || '0').replace(/\D/g, '')) || 0;
      let contentJa = '', contentPt = '';
      try {
        const { data } = await supabase
          .from('teachings_topics')
          .select('content_ja, content_pt, title_pt, title_ja')
          .eq('vol', r.vol)
          .eq('file', r.file)
          .eq('topic_idx', topicIdx)
          .maybeSingle();
        if (data) {
          contentJa = data.content_ja || '';
          contentPt = data.content_pt || '';
        }
      } catch (e) { console.warn('[suggestAI] fetch failed:', e); }

      if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }

      const prompt = `${TRANSLATION_GUIDELINES}

---

## CONTEXTO: SUGESTÃO DE CORREÇÃO PONTUAL

Um usuário reportou um possível erro de tradução nos ensinamentos de Meishu-sama. Sua missão é identificar exatamente onde está o erro (mesmo que o trecho selecionado pelo usuário não seja o ponto exato) e sugerir a correção, aplicando todas as diretrizes acima.

## DADOS DO REPORT

**Localização:** ${r.vol} / ${r.file} / tópico ${topicIdx}
**Idioma onde o erro foi identificado:** ${r.lang === 'ja' ? 'Japonês' : 'Português'}
**Trecho selecionado pelo usuário:**
"${r.selected_text || '(não informado)'}"
${r.description ? `\n**Comentário do usuário (pista sobre o erro):**\n"${r.description}"` : ''}

---
${contentJa ? `## TEXTO JAPONÊS ORIGINAL (referência canônica)

${contentJa}

` : ''}${contentPt ? `## TRADUÇÃO PT-BR ATUAL (versão em uso no site)

${contentPt}

` : ''}---

## TAREFA

Compare o japonês original com a tradução PT-BR atual. Use o comentário do usuário como pista, mas analise o tópico completo se necessário.

Responda **exatamente** neste formato:

**🔍 Erro identificado:**
[Descreva onde está o problema — qual trecho do PT não corresponde ao JP, ou qual termo do glossário foi violado. Se o trecho selecionado não for o erro exato, aponte onde realmente está.]

**📄 Trecho atual (PT):**
"[cole o trecho problemático exato da tradução atual]"

**✅ Correção sugerida (PT):**
"[cole o trecho corrigido — aplicando glossário, calibração de registro PT-BR e estilo]"

**💡 Justificativa:**
[Explique brevemente — qual palavra japonesa foi mal traduzida, qual regra do glossário foi violada, qual ajuste de calibração de registro foi necessário.]`;

      try {
        await navigator.clipboard.writeText(prompt);
      } catch (e) {
        // Fallback para browsers sem clipboard API
        const ta = document.createElement('textarea');
        ta.value = prompt;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      window.open('https://claude.ai/new', '_blank');

      // Toast de confirmação
      let toast = document.getElementById('ai-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ai-toast';
        toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#6366f1;color:#fff;padding:10px 20px;border-radius:10px;font-size:0.85rem;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2);transition:opacity 0.3s;';
        document.body.appendChild(toast);
      }
      toast.textContent = '✨ Prompt copiado! Cole no Claude com Ctrl+V e pressione Enter.';
      toast.style.opacity = '1';
      setTimeout(() => { toast.style.opacity = '0'; }, 4000);
    };

    // ─── Retradução de parágrafo individual (dentro do editor) ───
    // Fluxo: clica 🔄 IA → abre Claude + expande painel inline → admin
    // cola resposta → sistema extrai o parágrafo → mostra comparação
    // lado-a-lado → admin aceita/descarta/edita.
    window._editorRetranslateSegment = function(btnEl) {
      const segRow = btnEl.closest('.editor-seg-row');
      if (!segRow) return;

      const jaEl = segRow.querySelector('.topic-readonly-text');
      const ptEl = segRow.querySelector('.seg-editable');
      const panel = segRow.querySelector('.seg-ai-panel');
      if (!jaEl || !ptEl || !panel) return;

      const jaSeg = (jaEl.textContent || '').trim();
      const ptSeg = (ptEl.textContent || '').trim();

      // Reúne contexto do tópico inteiro pra Claude entender o entorno
      const topicBlock = segRow.closest('.topic-edit-block');
      const allJa = topicBlock?.querySelectorAll('.topic-readonly-text') || [];
      const allPt = topicBlock?.querySelectorAll('.seg-editable') || [];
      const fullJa = Array.from(allJa).map(e => (e.textContent || '').trim()).filter(Boolean).join('\n\n');
      const fullPt = Array.from(allPt).map(e => (e.textContent || '').trim()).filter(Boolean).join('\n\n');

      const prompt = `${TRANSLATION_GUIDELINES}

---

## CONTEXTO: RETRADUÇÃO DE PARÁGRAFO ESPECÍFICO

Você foi solicitado a retraduzir UM parágrafo específico de um ensinamento de Meishu-sama. Use o resto do tópico abaixo apenas como contexto para entender o sentido e a continuidade — mas entregue APENAS a retradução do parágrafo solicitado.

## TÓPICO COMPLETO (apenas referência)

### Texto japonês completo:
${fullJa}

### Tradução PT atual completa (referência, NÃO copiar):
${fullPt}

---

## PARÁGRAFO PARA RETRADUZIR

### Original japonês:
${jaSeg}

### Tradução PT atual (questionada):
${ptSeg}

---

## TAREFA

Retraduza APENAS o parágrafo acima, aplicando TODAS as diretrizes:
- Glossário mandatório completo
- Calibração de registro PT-BR (sem lusitanismos, sem academicismos)
- Tom de mestre falando com discípulos
- NÃO fundir, NÃO dividir — UM parágrafo só

## FORMATO OBRIGATÓRIO DA RESPOSTA

**📜 Parágrafo retraduzido:**
[Apenas o parágrafo, em uma única linha ou bloco contínuo, pronto para copiar e colar de volta no admin]

**🔍 Mudanças principais:**
- [Mudança 1: termo do glossário aplicado / lusitanismo removido / etc.]
- [Mudança 2]
- [Mudança 3 se houver]`;

      try {
        navigator.clipboard.writeText(prompt);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = prompt;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      window.open('https://claude.ai/new', '_blank');

      // Expande painel pra paste da resposta
      panel.style.display = 'block';
      panel.innerHTML = `
        <div style="font-size:0.72rem; font-weight:600; color:#a855f7; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px;">🔄 Sugestão da IA</div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px; line-height:1.5;">
          1) Prompt copiado e claude.ai aberto. Cole com Ctrl+V e envie.<br>
          2) Copie a resposta completa do Claude e cole abaixo.
        </div>
        <textarea class="seg-ai-paste" placeholder="Cole aqui a resposta completa do Claude (incluindo os marcadores 📜 e 🔍)..."
          style="width:100%; box-sizing:border-box; min-height:90px; padding:8px 10px; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:0.85rem; font-family:inherit; resize:vertical;"></textarea>
        <div style="display:flex; gap:8px; margin-top:8px; align-items:center;">
          <button onclick="_editorParseAISuggestion(this)" style="padding:6px 14px; background:#a855f7; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">Comparar</button>
          <button onclick="_editorDiscardAIPanel(this)" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">Cancelar</button>
        </div>
      `;
      const paste = panel.querySelector('.seg-ai-paste');
      if (paste) setTimeout(() => paste.focus(), 100);
    };

    // Extrai o parágrafo retraduzido da resposta colada (entre 📜 e 🔍 ou fim)
    window._editorParseAISuggestion = function(btnEl) {
      const panel = btnEl.closest('.seg-ai-panel');
      const segRow = panel.closest('.editor-seg-row');
      const ptEl = segRow.querySelector('.seg-editable');
      const paste = panel.querySelector('.seg-ai-paste');
      if (!paste || !ptEl) return;

      const raw = paste.value.trim();
      if (!raw) return;

      // Tenta extrair o trecho entre "📜 Parágrafo retraduzido:" e "🔍 Mudanças"
      // Se falhar, usa o raw todo (limpando markdown comum).
      let extracted = raw;
      const m = raw.match(/📜[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\s*🔍|\n\s*\*?\*?\s*Mudanças|$)/);
      if (m && m[1]) extracted = m[1].trim();
      // Remove ** e linhas vazias soltas no início/fim
      extracted = extracted.replace(/^\*+\s*|\s*\*+$/g, '').trim();

      const ptCurrent = (ptEl.textContent || '').trim();

      panel.innerHTML = `
        <div style="font-size:0.72rem; font-weight:600; color:#a855f7; text-transform:uppercase; letter-spacing:.1em; margin-bottom:10px;">🔄 Comparação</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px; font-weight:600;">PT atual</div>
            <div style="padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-radius:6px; font-size:0.85rem; line-height:1.55; min-height:60px; white-space:pre-wrap;">${_escHtml(ptCurrent)}</div>
          </div>
          <div>
            <div style="font-size:0.7rem; color:#a855f7; margin-bottom:4px; font-weight:600;">Nova sugestão</div>
            <div class="seg-ai-new" contenteditable="true" style="padding:8px 10px; background:rgba(168,85,247,0.04); border:1px solid rgba(168,85,247,0.4); border-radius:6px; font-size:0.85rem; line-height:1.55; min-height:60px; white-space:pre-wrap; color:var(--text);">${_escHtml(extracted)}</div>
          </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:10px; align-items:center;">
          <button onclick="_editorAcceptAISuggestion(this)" style="padding:6px 14px; background:#34c759; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;">✓ Aceitar nova</button>
          <button onclick="_editorDiscardAIPanel(this)" style="padding:6px 14px; background:transparent; color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:0.78rem; cursor:pointer;">✗ Manter atual</button>
          <span style="font-size:0.72rem; color:var(--text-muted);">Edite a nova sugestão antes de aceitar, se quiser</span>
        </div>
      `;
    };

    // Substitui o seg-editable pela nova sugestão e fecha o painel
    window._editorAcceptAISuggestion = function(btnEl) {
      const panel = btnEl.closest('.seg-ai-panel');
      const segRow = panel.closest('.editor-seg-row');
      const ptEl = segRow.querySelector('.seg-editable');
      const newEl = panel.querySelector('.seg-ai-new');
      if (!ptEl || !newEl) return;

      ptEl.textContent = (newEl.textContent || '').trim();
      panel.style.display = 'none';
      panel.innerHTML = '';
      // Pisca o seg-editable pra dar feedback
      ptEl.style.transition = 'background 0.4s';
      ptEl.style.background = 'rgba(52,199,89,0.15)';
      setTimeout(() => { ptEl.style.background = ''; }, 800);
    };

    window._editorDiscardAIPanel = function(btnEl) {
      const panel = btnEl.closest('.seg-ai-panel');
      if (!panel) return;
      panel.style.display = 'none';
      panel.innerHTML = '';
    };

    window.clearVerifiedHistory = async function(btnEl) {
      // First, count how many records will be affected so the admin knows exactly what they're deleting
      const { count, error: countErr } = await supabase
        .from('translation_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'verified');

      if (countErr) {
        alert('Erro ao verificar quantidade de relatórios: ' + countErr.message);
        return;
      }

      if (!count || count === 0) {
        alert('Não há relatórios verificados para apagar.');
        return;
      }

      if (!confirm(`Tem certeza? Isso apagará PERMANENTEMENTE ${count} relatório(s) verificado(s) do banco de dados.\n\nEsta ação não pode ser desfeita.`)) return;

      const originalText = btnEl.innerHTML;
      btnEl.disabled = true;
      btnEl.innerHTML = 'Limpando...';

      const { data, error } = await supabase
        .from('translation_reports')
        .delete()
        .eq('status', 'verified')
        .select();

      if (error) {
        console.error('[admin] clearVerifiedHistory failed:', error.message);
        alert('Erro ao limpar histórico: ' + error.message);
        btnEl.disabled = false;
        btnEl.innerHTML = originalText;
        return;
      }
      
      if (!data || data.length === 0) {
        alert('Nenhum relatório foi apagado.\nO banco de dados possivelmente bloqueou a exclusão (RLS).');
      } else {
        alert(`${data.length} relatórios apagados permanentemente.`);
      }

      // Force reload to refresh UI
      _reportsLoaded = false;
      loadReports();
    };

    // ── Editor Logic ────────────────────────────────────────────────────────
    let _currentEditVol = null;
    let _currentEditFile = null;
    let _currentEditJson = null;
    let _currentReportHighlight = null; // { text, lang }

    window.openEditorFromReport = function(reportId) {
      const r = (_allReports || []).find(x => x.id === reportId);
      if (!r) return;
      openEditor(r.vol, r.file, { text: r.selected_text, lang: r.lang });
    };

    window.openEditor = async function(vol, file, reportHighlight = null) {
      if (!vol || !file) return;
      _currentEditVol = vol;
      _currentEditFile = file.endsWith('.json') ? file : file + '.json';
      _currentEditJson = null;
      _currentReportHighlight = reportHighlight && reportHighlight.text ? reportHighlight : null;

      const modal = document.getElementById('editor-modal');
      const textarea = document.getElementById('editor-textarea');
      const structuredBody = document.getElementById('editor-structured-body');
      const hint = document.getElementById('editor-search-hint');
      const subtitle = document.getElementById('editor-target-file');
      const msg = document.getElementById('editor-msg');
      const btn = document.getElementById('editor-btn-save');

      subtitle.textContent = `${vol}/${_currentEditFile}`;
      textarea.value = '';
      textarea.style.display = 'none';
      structuredBody.style.display = 'none';
      structuredBody.innerHTML = '';
      
      msg.className = 'msg';
      msg.textContent = 'Baixando arquivo do Supabase...';
      msg.style.display = 'block';
      btn.disabled = true;
      modal.classList.add('open');

      try {
        const { data, error } = await supabase.storage.from('teachings').download(`${vol}/${_currentEditFile}`);
        if (error) throw error;
        if (!data) throw new Error('Arquivo vazio ou indisponível no storage');

        const text = await data.text();
        
        try {
          _currentEditJson = JSON.parse(text);
          if (_currentEditJson.themes) {
            structuredBody.style.display = 'flex';
            renderStructuredEditor(_currentEditJson);
            if (_currentReportHighlight) {
              hint.innerHTML = '🖍️ <strong>Trecho reportado destacado em amarelo.</strong> Edite apenas a caixa da direita (Português).';
              setTimeout(() => _highlightReportedPassage(_currentReportHighlight), 50);
            } else {
              hint.innerHTML = '💡 <strong>Dica:</strong> Use <b>Ctrl+F</b> para buscar palavras. Edite apenas as caixas da direita (Português).';
            }
          } else {
            throw new Error('No themes array found');
          }
        } catch(e) {
          // Fallback to raw editor if JSON is weird
          console.warn("Using raw JSON fallback:", e);
          textarea.value = JSON.stringify(JSON.parse(text), null, 2);
          textarea.style.display = 'block';
          hint.innerHTML = '💡 <strong>Modo Código:</strong> Arquivo não padronizado. Edite o JSON cru com <b>muito cuidado</b> com aspas e chaves.';
        }

        btn.disabled = false;
        msg.style.display = 'none';
      } catch (err) {
        console.error('Editor download error:', err);
        msg.textContent = `Erro ao baixar: ${err.message}`;
        msg.className = 'msg err';
        btn.disabled = true;
      }
    };

    function renderStructuredEditor(jsonData) {
      const container = document.getElementById('editor-structured-body');
      let html = '';

      jsonData.themes.forEach((theme, tIdx) => {
        if (!theme.topics) return;
        theme.topics.forEach((topic, pIdx) => {
          const jaTitle = topic.title_ja || topic.title || 'Sem título JA';
          const ptTitle = (topic.title_ptbr || topic.title_pt || topic.title || '').replace(/"/g, '&quot;');
          
          const jaContent = topic.content || '';
          const ptContent = topic.content_ptbr || topic.content_pt || '';

          const pathPrefix = `${tIdx}-${pIdx}`;

          // Extrai o header do título (onde fica a publicação antes da quebra real)
          const jaSegs = jaContent.split(/<br\s*\/?>/i);
          const ptSegs = ptContent.split(/<br\s*\/?>/i);
          const maxLen = Math.max(jaSegs.length, ptSegs.length);

          let segmentsHtml = '';
          for (let i = 0; i < maxLen; i++) {
             const jS = (jaSegs[i] || '').trim();
             const pS = (ptSegs[i] || '').trim();
             if (!jS && !pS) continue;
             segmentsHtml += `
               <div class="topic-split-grid editor-seg-row" data-seg-idx="${i}" style="border-top:1px solid rgba(184,134,11,0.08); padding-top:16px; margin-top:16px; position:relative;">
                 <div class="topic-split-col ja-col" style="padding:0 16px 16px 16px">
                   <div class="topic-readonly-text html-content">${jS}</div>
                 </div>
                 <div class="topic-split-col pt-col" style="padding:0 16px 16px 16px; position:relative;">
                   <button onclick="_editorRetranslateSegment(this)" title="Retraduzir este parágrafo via Claude AI"
                     style="position:absolute; top:0; right:8px; padding:3px 10px; background:rgba(168,85,247,0.1); color:#a855f7; border:1px solid rgba(168,85,247,0.3); border-radius:6px; font-size:0.72rem; font-weight:600; cursor:pointer; z-index:1;">🔄 IA</button>
                   <div class="seg-editable editor-seg-content" contenteditable="true"
                        data-path="${pathPrefix}-content_ptbr-seg" spellcheck="true">${pS.trim()}</div>
                   <div class="seg-ai-panel" style="display:none; margin-top:12px; border:1px dashed rgba(168,85,247,0.4); border-radius:8px; padding:12px; background:rgba(168,85,247,0.04);"></div>
                 </div>
               </div>
             `;
          }

          html += `
            <div class="topic-edit-block">
              <div class="topic-edit-header">
                <span>Tópico ${pIdx + 1}</span>
              </div>
              ${segmentsHtml}
            </div>
          `;
        });
      });

      container.innerHTML = html;

      // Bloqueia Enter nos contenteditable de segmentos (br já separa segmentos)
      // Bloqueia paste com HTML para evitar estilos inline indesejados
      container.querySelectorAll('.seg-editable').forEach(div => {
        div.addEventListener('keydown', e => {
          if (e.key === 'Enter') e.preventDefault();
        });
        div.addEventListener('paste', e => {
          e.preventDefault();
          const text = (e.clipboardData || window.clipboardData).getData('text/plain');
          document.execCommand('insertText', false, text);
        });
      });

      // Auto-resize textareas comuns (título etc.)
      container.querySelectorAll('textarea').forEach(t => {
        const autoResize = () => { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; };
        autoResize();
        t.addEventListener('input', autoResize);
      });
    }

    // Localiza o trecho reportado pelo usuário dentro do editor estruturado e
    // aplica um <mark> amarelo em todas as ocorrências, além de rolar até a primeira.
    function _highlightReportedPassage({ text, lang }) {
      if (!text) return;
      const needle = text.replace(/\s+/g, ' ').trim();
      if (!needle) return;

      const ptSegs = document.querySelectorAll('#editor-structured-body .seg-editable');
      const jaSegs = document.querySelectorAll('#editor-structured-body .topic-readonly-text');
      const candidates = lang === 'ja' ? [jaSegs, ptSegs] : [ptSegs, jaSegs];

      let firstMark = null;
      let anyMatch = false;
      for (const list of candidates) {
        for (const el of list) {
          const count = _wrapAllMatchesInElement(el, needle);
          if (count > 0) {
            anyMatch = true;
            if (!firstMark) firstMark = el.querySelector('mark.editor-report-highlight');
          }
        }
        if (anyMatch) break;
      }

      if (firstMark) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }

      const hint = document.getElementById('editor-search-hint');
      if (hint) {
        hint.innerHTML = '⚠ <strong>Trecho reportado não foi localizado automaticamente.</strong> Use <b>Ctrl+F</b> para buscar: <em>' + _escHtml(needle.slice(0, 80)) + (needle.length > 80 ? '…' : '') + '</em>';
      }
      return false;
    }

    // Envolve TODAS as ocorrências de `needle` (texto plano, whitespace-insensitive)
    // em <mark>. Constrói um mapa de caracteres da versão normalizada → offsets
    // originais para lidar com quebras de linha, espaços duplos e NBSP.
    function _wrapAllMatchesInElement(root, needle, markClass = 'editor-report-highlight') {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      if (!nodes.length) return 0;

      // Monta combined + charMap: charMap[i] = offset original do i-ésimo char normalizado
      let combined = '';
      const nodeMap = [];
      for (const node of nodes) {
        nodeMap.push({ node, start: combined.length, end: combined.length + node.nodeValue.length });
        combined += node.nodeValue;
      }
      // Normaliza combined colapsando whitespace (inclui NBSP \u00A0) e mantém charMap
      let normalized = '';
      const charMap = [];
      let prevWasSpace = false;
      for (let i = 0; i < combined.length; i++) {
        const ch = combined[i];
        if (/[\s\u00A0]/.test(ch)) {
          if (!prevWasSpace && normalized.length > 0) {
            normalized += ' ';
            charMap.push(i);
          }
          prevWasSpace = true;
        } else {
          normalized += ch;
          charMap.push(i);
          prevWasSpace = false;
        }
      }
      // Remove espaço trailing se houver
      if (normalized.endsWith(' ')) {
        normalized = normalized.slice(0, -1);
        charMap.pop();
      }

      const needleNorm = needle.replace(/[\s\u00A0]+/g, ' ').trim();
      if (!needleNorm) return 0;

      // Encontra todas as ocorrências do needle em normalized
      const ranges = [];
      let searchFrom = 0;
      while (true) {
        const idx = normalized.indexOf(needleNorm, searchFrom);
        if (idx === -1) break;
        const startIdx = idx;
        const endIdx = idx + needleNorm.length - 1;
        if (startIdx >= charMap.length || endIdx >= charMap.length) break;
        const startOffset = charMap[startIdx];
        // endOffset é inclusivo no charMap; precisa ser exclusivo para Range
        const endOffset = charMap[endIdx] + 1;
        ranges.push({ startOffset, endOffset });
        searchFrom = idx + Math.max(1, needleNorm.length);
      }

      if (!ranges.length) return 0;

      // Envolve do último para o primeiro para preservar offsets
      let wrapped = 0;
      for (let r = ranges.length - 1; r >= 0; r--) {
        const { startOffset, endOffset } = ranges[r];
        let startNode = null, startDelta = 0, endNode = null, endDelta = 0;
        for (const m of nodeMap) {
          if (startNode === null && startOffset >= m.start && startOffset < m.end) {
            startNode = m.node; startDelta = startOffset - m.start;
          }
          if (endOffset > m.start && endOffset <= m.end) {
            endNode = m.node; endDelta = endOffset - m.start;
          }
        }
        if (!startNode || !endNode) continue;
        try {
          const range = document.createRange();
          range.setStart(startNode, startDelta);
          range.setEnd(endNode, endDelta);
          const mark = document.createElement('mark');
          mark.className = markClass;
          try {
            range.surroundContents(mark);
          } catch (_) {
            // surroundContents falha se o range cruza boundaries de elemento.
            // Fallback: extrai conteúdo e envolve.
            const frag = range.extractContents();
            mark.appendChild(frag);
            range.insertNode(mark);
          }
          wrapped++;
        } catch (e) {
          console.warn('[_wrapAllMatchesInElement] failed:', e);
        }
      }
      return wrapped;
    }

    function _sanitizeSegHtml(html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      tmp.querySelectorAll('*').forEach(el => {
        el.removeAttribute('style');
        el.removeAttribute('class');
        el.removeAttribute('id');
      });
      // Desembrulha <span>s — inseridos pelo browser para aplicar estilos inline
      tmp.querySelectorAll('span').forEach(span => {
        const parent = span.parentNode;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
      });
      // Desembrulha <mark>s — grifo visual do relatório, não deve persistir
      tmp.querySelectorAll('mark').forEach(mark => {
        const parent = mark.parentNode;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
      });
      return tmp.innerHTML.trim();
    }

    window.closeEditor = function() {
      document.getElementById('editor-modal').classList.remove('open');
      _currentEditVol = null;
      _currentEditFile = null;
      _currentEditJson = null;
      _currentReportHighlight = null;
    };

    window.saveEditor = async function() {
      const textarea = document.getElementById('editor-textarea');
      const msg = document.getElementById('editor-msg');
      const btn = document.getElementById('editor-btn-save');
      let finalContentString = '';

      // Structured mode saving
      if (_currentEditJson && _currentEditJson.themes) {
        try {
          // Salvar títulos
          const titles = document.querySelectorAll('.editor-input-field[data-path$="-title_ptbr"]');
          titles.forEach(input => {
            const keys = input.getAttribute('data-path').split('-');
            const tIdx = parseInt(keys[0], 10);
            const pIdx = parseInt(keys[1], 10);
            _currentEditJson.themes[tIdx].topics[pIdx].title_ptbr = input.value;
          });

          // Salvar conteúdos segmentados (contenteditable divs)
          _currentEditJson.themes.forEach((theme, tIdx) => {
            if (!theme.topics) return;
            theme.topics.forEach((topic, pIdx) => {
              const segs = document.querySelectorAll(`.editor-seg-content[data-path="${tIdx}-${pIdx}-content_ptbr-seg"]`);
              if (segs.length > 0) {
                const joined = Array.from(segs).map(s => _sanitizeSegHtml(s.innerHTML)).join('<br/>\n');
                topic.content_ptbr = joined;
              }
            });
          });

          finalContentString = JSON.stringify(_currentEditJson, null, 2);
        } catch (e) {
          msg.textContent = 'Erro ao processar formulário estruturado.';
          msg.className = 'msg err';
          msg.style.display = 'block';
          return;
        }
      } 
      // Raw mode saving fallback
      else {
        let contentRaw = textarea.value;
        try {
          finalContentString = JSON.stringify(JSON.parse(contentRaw), null, 2);
        } catch (e) {
          if (!confirm('Atenção: O formato JSON está inválido e pode quebrar a leitura.\n\nTem certeza que deseja salvar mesmo assim?')) {
            msg.textContent = 'Corrija o formato JSON cru.';
            msg.className = 'msg err';
            msg.style.display = 'block';
            return;
          }
          finalContentString = contentRaw;
        }
      }

      btn.disabled = true;
      btn.textContent = 'Salvando...';
      msg.style.display = 'none';

      try {
        const blob = new Blob([finalContentString], { type: 'application/json' });
        const { error } = await supabase.storage.from('teachings')
          .upload(`${_currentEditVol}/${_currentEditFile}`, blob, { upsert: true, contentType: 'application/json', cacheControl: '0' });

        if (error) throw error;

        msg.textContent = 'Arquivo salvo/atualizado com sucesso! 🎉';
        msg.className = 'msg ok';
        msg.style.display = 'block';
        setTimeout(() => closeEditor(), 1500);
      } catch (err) {
        console.error('Editor upload error:', err);
        msg.textContent = `Falha ao salvar: ${err.message}`;
        msg.className = 'msg err';
        msg.style.display = 'block';
        btn.disabled = false;
      }
      btn.textContent = '💾 Salvar na Nuvem';
    };


    async function checkAdmin() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.href = 'login.html'; return; }
      _myUid = session.user.id;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (profile?.role !== 'admin') {
        alert('Acesso restrito a administradores.');
        window.location.href = 'index.html';
        return;
      }

      const unlocked = await runAdminPinGate();
      if (!unlocked) return; // gate fechou a sessão / redirecionou

      document.body.classList.remove('admin-locked');

      loadUsers();
      const ok = await loadVolumeFiles();
      if (!ok) {
        const volumesDiv = document.getElementById('default-perm-volumes');
        if (volumesDiv) {
          volumesDiv.innerHTML = `<div class="msg err" style="display:block;">⚠ Falha ao carregar lista de volumes. Verifique sua conexão e <a href="#" onclick="location.reload(); return false;" style="color:inherit; text-decoration:underline;">recarregue a página</a>.</div>`;
        }
      } else {
        renderDefaultPermVolumes();
      }
    }

    // ── Admin PIN gate ─────────────────────────────────────────────
    // Camada extra ao entrar no painel. PIN fica como hash bcrypt no Supabase
    // (RPCs has_admin_pin / set_admin_pin / verify_admin_pin). O PIN é pedido
    // a cada carregamento da página — não há cache de sessão.
    async function runAdminPinGate() {
      const { data: hasPin, error: hasErr } = await supabase.rpc('has_admin_pin');
      if (hasErr) {
        console.warn('[adminPinGate] has_admin_pin falhou:', hasErr);
        alert('Não foi possível validar o gate de administrador. Tente novamente.');
        return false;
      }

      const isFirstTime = !hasPin;
      const modal  = document.getElementById('adminPinModal');
      const input  = document.getElementById('adminPinInput');
      const desc   = document.getElementById('adminPinDesc');
      const title  = document.getElementById('adminPinTitle');
      const msg    = document.getElementById('adminPinMsg');
      const submit = document.getElementById('adminPinSubmit');
      const cancel = document.getElementById('adminPinCancel');

      title.textContent = isFirstTime ? 'Definir PIN de Administrador' : 'Acesso Administrativo';
      desc.textContent  = isFirstTime
        ? 'Crie um PIN numérico (4 a 12 dígitos) que será exigido sempre que você entrar no painel.'
        : 'Digite seu PIN para continuar.';
      input.value = '';
      msg.textContent = '';
      msg.className = 'admin-pin-msg';
      modal.classList.add('open');
      setTimeout(() => input.focus(), 50);

      return new Promise((resolve) => {
        const setBusy = (b) => { submit.disabled = b; cancel.disabled = b; input.disabled = b; };

        const tryValidate = async () => {
          const pin = (input.value || '').trim();
          msg.className = 'admin-pin-msg';
          if (!/^[0-9]{4,12}$/.test(pin)) {
            msg.textContent = 'PIN deve ter de 4 a 12 dígitos numéricos.';
            msg.classList.add('err');
            return;
          }
          setBusy(true);
          try {
            if (isFirstTime) {
              const { error } = await supabase.rpc('set_admin_pin', { new_pin: pin });
              if (error) throw error;
              msg.textContent = 'PIN definido. Liberando painel…';
              msg.classList.add('ok');
              setTimeout(() => { modal.classList.remove('open'); resolve(true); }, 600);
            } else {
              const { data: ok, error } = await supabase.rpc('verify_admin_pin', { pin });
              if (error) throw error;
              if (!ok) {
                msg.textContent = 'PIN incorreto.';
                msg.classList.add('err');
                input.value = '';
                input.focus();
                setBusy(false);
                return;
              }
              modal.classList.remove('open');
              resolve(true);
            }
          } catch (err) {
            console.error('[adminPinGate] erro:', err);
            msg.textContent = 'Falha: ' + (err.message || err);
            msg.classList.add('err');
            setBusy(false);
          }
        };

        const onCancel = async () => {
          await supabase.auth.signOut().catch(() => {});
          window.location.href = 'login.html';
          resolve(false);
        };

        submit.onclick = tryValidate;
        cancel.onclick = onCancel;
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); tryValidate(); } };
      });
    }
    window.runAdminPinGate = runAdminPinGate;

    // Sair do painel sempre desloga (evita esquecer o logout aberto).
    window.adminLeave = async function adminLeave(ev, dest) {
      if (ev && ev.preventDefault) ev.preventDefault();
      try { await supabase.auth.signOut(); } catch (_) {}
      window.location.href = dest || 'index.html';
    };

    // Auto-saída do painel admin por inatividade (10 minutos sem mexer).
    // NÃO faz signOut — só redireciona para fora do admin. A sessão da conta
    // continua válida; voltar ao painel exige o PIN novamente (gate em cada load).
    (function setupAdminIdleLogout() {
      const IDLE_MS = 10 * 60 * 1000;
      const WARN_MS = 30 * 1000; // pinta de vermelho nos últimos 30s
      let endsAt = Date.now() + IDLE_MS;
      let tickHandle = null;

      const badge = document.createElement('div');
      badge.className = 'admin-idle-timer';
      badge.title = 'Sai do painel automaticamente por inatividade';
      document.body.appendChild(badge);

      const doLeave = () => {
        if (tickHandle) clearInterval(tickHandle);
        window.location.href = 'index.html';
      };

      const tick = () => {
        const left = endsAt - Date.now();
        if (left <= 0) { doLeave(); return; }
        const s = Math.ceil(left / 1000);
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        badge.textContent = `⏱ ${mm}:${ss}`;
        badge.classList.toggle('warn', left <= WARN_MS);
      };

      const reset = () => { endsAt = Date.now() + IDLE_MS; tick(); };

      ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach((evt) => {
        window.addEventListener(evt, reset, { passive: true });
      });

      tick();
      tickHandle = setInterval(tick, 1000);
    })();

    // Trocar PIN a partir do painel (chamado pela UI da aba Usuários).
    window.changeAdminPin = async function changeAdminPin() {
      const cur = prompt('PIN atual (deixe em branco se ainda não definiu):') || '';
      if (cur) {
        const { data: ok, error } = await supabase.rpc('verify_admin_pin', { pin: cur });
        if (error) { alert('Erro: ' + error.message); return; }
        if (!ok)  { alert('PIN atual incorreto.'); return; }
      }
      const nv = prompt('Novo PIN (4 a 12 dígitos):') || '';
      if (!/^[0-9]{4,12}$/.test(nv)) { alert('PIN inválido (4 a 12 dígitos numéricos).'); return; }
      const { error } = await supabase.rpc('set_admin_pin', { new_pin: nv });
      if (error) { alert('Erro: ' + error.message); return; }
      alert('PIN atualizado.');
    };

    // ── Volume files for permission editor ────────────────────────

    function parseSectionMapText(text) {
      const jsonStr = text.match(/window\.SECTION_MAP\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)?.[1];
      if (!jsonStr) return false;
      let sectionMap;
      try {
        sectionMap = JSON.parse(jsonStr);
      } catch (e) {
        console.warn('[parseSectionMapText] JSON inválido:', e);
        return false;
      }
      for (const vol of VOLUMES) {
        const volMap = sectionMap[vol.key] || {};
        const categories = {};
        let fileIndex = 0;
        for (const [file, info] of Object.entries(volMap)) {
          fileIndex++;
          const isNewFormat = 'section' in info;
          const sectionName = isNewFormat ? (info.section || 'Outros') : (info.pt || 'Outros');
          const title = isNewFormat
            ? (info.pt || file.replace(/\.html\.json$/, '').replace(/\.html$/, ''))
            : file.replace(/\.html\.json$/, '').replace(/\.html$/, '');
          if (!categories[sectionName]) categories[sectionName] = [];
          categories[sectionName].push({ file, title, num: fileIndex });
        }
        volumeCategories[vol.key] = categories;
      }
      return true;
    }

    async function loadVolumeFiles() {
      // 1. Local site_data (always up-to-date with new format)
      try {
        const resp = await fetch('site_data/section_map.js');
        if (resp.ok) {
          const text = await resp.text();
          if (parseSectionMapText(text)) return true;
        }
      } catch (e) {
        console.warn('[loadVolumeFiles] Local falhou:', e);
      }

      // 2. Supabase storage (may be older format)
      try {
        const { data: mapData } = await supabase.storage.from('teachings').download('section_map.js');
        if (mapData) {
          const text = await mapData.text();
          if (parseSectionMapText(text)) return true;
        }
      } catch (e) {
        console.warn('[loadVolumeFiles] Supabase storage falhou:', e);
      }

      // 3. Last resort: list files (shows filenames only)
      let anyLoaded = false;
      for (const vol of VOLUMES) {
        if (!volumeCategories[vol.key]) {
          try {
            const { data } = await supabase.storage.from('teachings').list(`${vol.key}/`);
            const files = (data || []).map(f => ({ file: f.name, title: f.name.replace('.html.json', '') }));
            volumeCategories[vol.key] = files.length > 0 ? { 'Todos': files } : {};
            if (files.length > 0) anyLoaded = true;
          } catch {
            volumeCategories[vol.key] = {};
          }
        } else {
          anyLoaded = true;
        }
      }

      if (!anyLoaded) {
        console.error('[loadVolumeFiles] Todas as fontes falharam — estado vazio.');
        // Signal to callers that data is unavailable
        return false;
      }
      return true;
    }

    // ── User list with email ──────────────────────────────────────

    window.loadUsers = async function() {
      const container = document.getElementById('user-list-container');
      container.innerHTML = '<div class="loading">Carregando usuários...</div>';

      // admin_get_users() é uma RPC SECURITY DEFINER que lê auth.users para retornar emails reais.
      // admin_get_user_visit_days() conta dias distintos com pelo menos 1 access_log (view).
      const [usersRes, visitsRes] = await Promise.all([
        supabase.rpc('admin_get_users'),
        supabase.rpc('admin_get_user_visit_days')
      ]);

      if (usersRes.error) {
        container.innerHTML = `<div class="msg err">Erro ao carregar usuários: ${_escHtml(usersRes.error.message)}</div>`;
        return;
      }

      const visitsByUser = {};
      if (!visitsRes.error && Array.isArray(visitsRes.data)) {
        for (const v of visitsRes.data) {
          visitsByUser[v.user_id] = { active_days: v.active_days, last_visit: v.last_visit };
        }
      }

      allUsers = (usersRes.data || []).map(u => ({
        ...u,
        active_days: visitsByUser[u.id]?.active_days || 0,
        last_visit:  visitsByUser[u.id]?.last_visit  || null
      }));

      document.getElementById('user-count').textContent = `(${allUsers.length})`;
      renderUserList();
    };

    function renderUserList() {
      const container = document.getElementById('user-list-container');
      const query = (document.getElementById('user-search')?.value || '').toLowerCase();
      const filtered = allUsers.filter(u =>
        (u.display_name || '').toLowerCase().includes(query) ||
        (u.email || '').toLowerCase().includes(query)
      );

      if (filtered.length === 0) {
        container.innerHTML = '<div class="loading">Nenhum usuário encontrado.</div>';
        return;
      }

      // _escHtml em todos os campos controláveis pelo usuário (display_name, email).
      // UUIDs e roles vêm do Supabase e também são escapados por defesa em profundidade.
      container.innerHTML = '<div class="user-list">' + filtered.map(u => {
        const idEsc = _escHtml(u.id);
        const nameEsc = _escHtml(u.display_name || 'Sem nome');
        const emailEsc = _escHtml(u.email || '');
        const emailDisplay = _escHtml(u.email || '—');
        const initial = _escHtml((u.display_name || 'U')[0].toUpperCase());
        const roleEsc = _escHtml(u.role || '');
        const createdEsc = _escHtml(new Date(u.created_at).toLocaleDateString('pt-BR'));
        const days = Number(u.active_days || 0);
        const daysLabel = days === 0 ? 'Nunca acessou'
                        : days === 1 ? '1 dia ativo'
                        : `${days} dias ativos`;
        const lastVisitStr = u.last_visit
          ? ` · último: ${_escHtml(new Date(u.last_visit).toLocaleDateString('pt-BR'))}`
          : '';
        return `
        <div class="user-row ${u.id === selectedUserId ? 'active' : ''}" onclick="selectUser('${idEsc}')">
          <div class="user-avatar">${initial}</div>
          <div class="user-info">
            <div class="user-name">${nameEsc}
              <button class="reset-btn" onclick="event.stopPropagation(); resetPassword('${idEsc}', '${emailEsc}')" title="Resetar senha">🔑 reset</button>
            </div>
            <div class="user-email">${emailDisplay}</div>
            <div class="user-meta">Criado em ${createdEsc} · ${daysLabel}${lastVisitStr}</div>
          </div>
          <div class="user-actions">
            <span class="user-badge ${roleEsc}">${roleEsc}</span>
            <select class="role-select" onclick="event.stopPropagation()" onchange="changeRole('${idEsc}', this.value)">
              <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteUser('${idEsc}')">✕</button>
          </div>
        </div>
      `;
      }).join('') + '</div>';
    }

    window.filterUsers = function() { renderUserList(); };

    // ── User detail modal ─────────────────────────────────────────

    window.openUserDetail = async function(userId) {
      const user = allUsers.find(u => u.id === userId);
      if (!user) return;

      document.getElementById('modal-user-name').textContent = user.display_name || 'Usuário';

      // 5 queries em paralelo — reduz latência de abertura do modal
      const [
        { data: logs },
        { data: positions },
        { data: favs },
        { data: highlights },
        { data: perms }
      ] = await Promise.all([
        supabase.from('access_logs')
          .select('volume, file, action, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('reading_positions')
          .select('volume, file, progress_pct, updated_at')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(20),
        supabase.from('synced_favorites')
          .select('volume, file, topic_title, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('user_highlights')
          .select('volume, file, text, color, updated_at')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(20),
        supabase.from('user_permissions')
          .select('volume, files')
          .eq('user_id', userId)
      ]);

      const totalViews = (logs || []).length;
      const uniqueTeachings = new Set((logs || []).map(l => `${l.volume}/${l.file}`)).size;

      let html = `
        <div class="stats-grid" style="margin-bottom:24px;">
          <div class="stat-card"><div class="stat-value">${totalViews}</div><div class="stat-label">Visualizações</div></div>
          <div class="stat-card"><div class="stat-value">${uniqueTeachings}</div><div class="stat-label">Ensinamentos</div></div>
          <div class="stat-card"><div class="stat-value">${(favs || []).length}</div><div class="stat-label">Favoritos</div></div>
          <div class="stat-card"><div class="stat-value">${(highlights || []).length}</div><div class="stat-label">Destaques</div></div>
        </div>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:16px;">
          <strong>Restrições:</strong> ${(perms || []).map(p => `${VOL_SHORT[p.volume] || p.volume}: ${p.files === null ? 'todos' : p.files.length + ' arquivos'}`).join(', ') || 'Nenhuma'}
        </p>
      `;

      if (positions && positions.length > 0) {
        html += `<h4 style="margin:16px 0 8px; font-size:0.85rem;">Progresso de Leitura</h4>`;
        html += `<table class="data-table"><thead><tr><th>Volume</th><th>Ensinamento</th><th>Progresso</th></tr></thead><tbody>`;
        positions.forEach(p => {
          html += `<tr><td>${VOL_SHORT[p.volume] || p.volume}</td><td style="font-size:0.82rem;" title="${_escHtml(p.file || '')}">${_escHtml(getFileTitle(p.volume, p.file))}</td><td>${p.progress_pct}%</td></tr>`;
        });
        html += `</tbody></table>`;
      }

      if (logs && logs.length > 0) {
        html += `<h4 style="margin:16px 0 8px; font-size:0.85rem;">Atividade Recente</h4>`;
        html += `<table class="data-table"><thead><tr><th>Ação</th><th>Volume</th><th>Data</th></tr></thead><tbody>`;
        logs.slice(0, 15).forEach(l => {
          const d = new Date(l.created_at).toLocaleDateString('pt-BR');
          html += `<tr><td>${l.action}</td><td>${VOL_SHORT[l.volume] || l.volume}</td><td style="font-size:0.8rem; color:var(--text-muted);">${d}</td></tr>`;
        });
        html += `</tbody></table>`;
      }

      document.getElementById('modal-user-content').innerHTML = html;
      document.getElementById('user-detail-modal').classList.add('open');
    };

    window.closeUserDetail = function() {
      document.getElementById('user-detail-modal').classList.remove('open');
    };

    // ── Select user & permission editor ───────────────────────────

    window.selectUser = async function(userId) {
      selectedUserId = userId;
      renderUserList();

      const title = document.getElementById('perm-editor-title');
      const user = allUsers.find(u => u.id === userId);
      title.textContent = `Restrições — ${user?.display_name || 'Usuário'}`;

      const { data: perms } = await supabase
        .from('user_permissions')
        .select('volume, files')
        .eq('user_id', userId);

      const permMap = {};
      for (const p of (perms || [])) {
        permMap[p.volume] = p.files === null ? 'all' : p.files;
      }

      const volumesDiv = document.getElementById('perm-volumes');
      volumesDiv.innerHTML = VOLUMES.map(vol => {
        const isBlocked = permMap[vol.key] !== undefined; // In blacklist, presence means blocked completely or partially
        const isAllBlocked = permMap[vol.key] === 'all';
        const blockedFiles = isAllBlocked ? new Set() : new Set(permMap[vol.key] || []);
        const categories = volumeCategories[vol.key] || {};

        const totalFiles = Object.values(categories).reduce((sum, files) => sum + files.length, 0);
        const blockedCount = isAllBlocked ? totalFiles : Object.values(categories).reduce((sum, files) => sum + files.filter(f => blockedFiles.has(f.file)).length, 0);

        const volKeyEsc = _escHtml(vol.key);
        return `
          <div class="vol-block" data-vol="${volKeyEsc}">
            <div class="vol-header" onclick="this.nextElementSibling.classList.toggle('open')">
              <input type="checkbox" ${isBlocked ? 'checked' : ''} onchange="toggleVolume('${volKeyEsc}', this.checked)">
              <span class="vol-title">${_escHtml(vol.name)}</span>
              <span style="font-size:0.75rem; color:var(--text-muted);">${isAllBlocked ? 'Todos bloqueados' : blockedCount + '/' + totalFiles + ' bloqueados'}</span>
            </div>
            <div class="vol-body">
              <div style="margin-bottom:12px;">
                <label style="font-size:0.82rem; cursor:pointer; color:#e05252; font-weight:600;">
                  <input type="checkbox" ${isAllBlocked ? 'checked' : ''} onchange="toggleAllFiles('${volKeyEsc}', this.checked)">
                  Bloquear todo o volume
                </label>
              </div>
              ${Object.entries(categories).map(([sectionName, files]) => {
                const sectionAllBlocked = isAllBlocked || files.every(f => blockedFiles.has(f.file));
                const sectionSomeBlocked = !sectionAllBlocked && files.some(f => blockedFiles.has(f.file));
                return `
                  <div class="vol-block" style="margin-bottom:8px;">
                    <div class="vol-header" onclick="this.nextElementSibling.classList.toggle('open')" style="padding:8px 12px; border-color:${sectionSomeBlocked || sectionAllBlocked ? 'rgba(224,82,82,0.3)' : 'var(--border)'}; background:${sectionSomeBlocked || sectionAllBlocked ? 'rgba(224,82,82,0.03)' : 'transparent'}">
                      <input type="checkbox" ${sectionAllBlocked ? 'checked' : ''} ${sectionSomeBlocked && !sectionAllBlocked ? 'style="opacity:0.5"' : ''} onchange="toggleSection('${volKeyEsc}', this.checked, this)">
                      <span class="vol-title" style="font-size:0.85rem; color:${sectionSomeBlocked || sectionAllBlocked ? '#e05252' : ''}">${_escHtml(sectionName)}</span>
                      <span style="font-size:0.7rem; color:var(--text-muted);">${files.length} itens</span>
                    </div>
                    <div class="vol-body" style="padding:8px 12px;">
                      <div class="file-list" id="files-${volKeyEsc}">
                        ${files.map(f => {
                          const isBlockedItem = blockedFiles.has(f.file) || isAllBlocked;
                          const fileEsc = _escHtml(f.file);
                          return `
                          <div class="file-item">
                            <input type="checkbox" id="file-${volKeyEsc}-${fileEsc}" value="${fileEsc}" data-vol="${volKeyEsc}" ${isBlockedItem ? 'checked' : ''}>
                            <label for="file-${volKeyEsc}-${fileEsc}" style="${isBlockedItem ? 'text-decoration:line-through; opacity:0.6; color:#e05252;' : ''}">${f.num != null ? `<span class="file-num">${_escHtml(f.num)}</span>` : ''}${_escHtml(f.title)}</label>
                          </div>
                        `}).join('')}
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('');

      editor.classList.add('open');
    };

    window.toggleVolume = function(vol, enabled) {
      const volBlock = document.querySelector(`.vol-block[data-vol="${vol}"]`);
      if (!volBlock) return;
      const body = volBlock.querySelector('.vol-body');
      body.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.checked = enabled;
        cb.disabled = false;
      });
    };

    window.toggleAllFiles = function(vol, all) {
      const volBlock = document.querySelector(`.vol-block[data-vol="${vol}"]`);
      if (!volBlock) return;
      const fileCheckboxes = volBlock.querySelectorAll('.file-list input[type=checkbox]');
      fileCheckboxes.forEach(cb => { cb.checked = all; });
    };

    window.toggleSection = function(vol, checked, headerCheckbox) {
      const volBlock = headerCheckbox.closest('.vol-block');
      if (!volBlock) return;
      const fileCheckboxes = volBlock.querySelectorAll('.file-list input[type=checkbox]');
      fileCheckboxes.forEach(cb => { cb.checked = checked; });
    };

    // ── Default Permissions Panel ─────────────────────────────────

    window.toggleDefaultPermPanel = function() {
      const body = document.getElementById('default-perm-body');
      const header = document.getElementById('default-perm-header');
      const chevron = document.getElementById('default-perm-chevron');
      const isOpen = body.classList.contains('open');
      body.classList.toggle('open', !isOpen);
      header.classList.toggle('open', !isOpen);
      chevron.classList.toggle('open', !isOpen);
    };

    // Legacy key — só lido uma vez para migrar o config antigo (por-navegador)
    // para o admin_settings compartilhado. Depois disso é ignorado.
    const DEFAULT_PERM_LEGACY_KEY = 'mioshie_admin_default_perms';
    const DEFAULT_PERM_SETTING_KEY = 'default_permissions';

    let _saveDefaultPermTimer = null;
    window.saveDefaultPermState = function() {
      // Debounce — os handlers inline disparam em cascata (toggleDefaultVolume
      // chama saveDefaultPermState para cada file cb). 150ms agrupa tudo em
      // um único upsert.
      clearTimeout(_saveDefaultPermTimer);
      _saveDefaultPermTimer = setTimeout(async () => {
        const panel = document.getElementById('default-perm-volumes');
        if (!panel) return;
        const state = {};
        panel.querySelectorAll(':scope > .vol-block').forEach(volBlock => {
          const volKey = volBlock.dataset.vol;
          const allCb = volBlock.querySelector(':scope > .vol-body > div:first-child input[type=checkbox]');
          const files = Array.from(volBlock.querySelectorAll('.file-list input[type=checkbox]:checked')).map(cb => cb.value);
          state[volKey] = { blockAll: allCb?.checked || false, files };
        });
        const { error } = await supabase.from('admin_settings').upsert({
          key: DEFAULT_PERM_SETTING_KEY,
          value: state,
          updated_at: new Date().toISOString(),
          updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        }, { onConflict: 'key' });
        if (error) console.error('[saveDefaultPermState] Supabase:', error.message);
      }, 150);
    };

    async function restoreDefaultPermState() {
      let state = null;

      const { data, error } = await supabase
        .from('admin_settings')
        .select('value')
        .eq('key', DEFAULT_PERM_SETTING_KEY)
        .maybeSingle();
      if (error) {
        console.error('[restoreDefaultPerm] Supabase:', error.message);
        return;
      }
      if (data?.value) {
        state = data.value;
      } else {
        // Fallback: se havia config legacy em localStorage (admin anterior à
        // migração), importa e persiste no Supabase para os outros admins.
        const legacy = localStorage.getItem(DEFAULT_PERM_LEGACY_KEY);
        if (legacy) {
          try {
            state = JSON.parse(legacy);
            await supabase.from('admin_settings').upsert({
              key: DEFAULT_PERM_SETTING_KEY,
              value: state,
              updated_at: new Date().toISOString(),
              updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
            }, { onConflict: 'key' });
            localStorage.removeItem(DEFAULT_PERM_LEGACY_KEY);
          } catch (e) {
            console.error('[restoreDefaultPerm] legacy parse:', e);
          }
        }
      }

      if (!state) return;

      try {
        const panel = document.getElementById('default-perm-volumes');
        if (!panel) return;
        Object.entries(state).forEach(([volKey, config]) => {
          const volBlock = panel.querySelector(`.vol-block[data-vol="${volKey}"]`);
          if (!volBlock) return;
          if (config.blockAll) {
            const allCb = volBlock.querySelector(':scope > .vol-body > div:first-child input[type=checkbox]');
            if (allCb) allCb.checked = true;
            volBlock.querySelectorAll('.file-list input[type=checkbox]').forEach(cb => { cb.checked = true; });
          } else if (config.files?.length > 0) {
            config.files.forEach(fileVal => {
              const cb = panel.querySelector(`.file-list input[data-vol="${volKey}"][value="${fileVal}"]`);
              if (cb) cb.checked = true;
            });
          }
          volBlock.querySelectorAll('.file-list input[type=checkbox]').forEach(cb => updateParentChecks(cb));
        });
      } catch(e) { console.error('[restoreDefaultPerm]', e); }
    }

    function renderDefaultPermVolumes() {
      const volumesDiv = document.getElementById('default-perm-volumes');
      if (!volumesDiv) return;

      volumesDiv.innerHTML = VOLUMES.map(vol => {
        const categories = volumeCategories[vol.key] || {};
        const totalFiles = Object.values(categories).reduce((sum, files) => sum + files.length, 0);

        const volKeyEsc = _escHtml(vol.key);
        return `
          <div class="vol-block" data-vol="${volKeyEsc}" data-context="default">
            <div class="vol-header" onclick="this.nextElementSibling.classList.toggle('open')">
              <input type="checkbox" onchange="toggleDefaultVolume('${volKeyEsc}', this.checked); saveDefaultPermState()">
              <span class="vol-title">${_escHtml(vol.name)}</span>
              <span style="font-size:0.75rem; color:var(--text-muted);">0/${totalFiles}</span>
            </div>
            <div class="vol-body">
              <div style="margin-bottom:12px;">
                <label style="font-size:0.82rem; cursor:pointer; color:#e05252; font-weight:600;">
                  <input type="checkbox" onchange="toggleDefaultAllFiles('${volKeyEsc}', this.checked); saveDefaultPermState()">
                  Bloquear todo o volume
                </label>
              </div>
              ${Object.entries(categories).map(([sectionName, files]) => `
                <div class="vol-block" style="margin-bottom:8px;">
                  <div class="vol-header" onclick="this.nextElementSibling.classList.toggle('open')" style="padding:8px 12px;">
                    <input type="checkbox" onchange="toggleDefaultSection('${volKeyEsc}', this.checked, this); saveDefaultPermState(); updateParentChecks(this)">
                    <span class="vol-title" style="font-size:0.85rem;">${_escHtml(sectionName)}</span>
                    <span style="font-size:0.7rem; color:var(--text-muted);">${files.length} itens</span>
                  </div>
                  <div class="vol-body" style="padding:8px 12px;">
                    <div class="file-list">
                      ${files.map(f => `
                        <div class="file-item">
                          <input type="checkbox" id="dpf-${volKeyEsc}-${_escHtml(f.file)}" value="${_escHtml(f.file)}" data-vol="${volKeyEsc}" data-ctx="default" onchange="saveDefaultPermState(); updateParentChecks(this)">
                          <label for="dpf-${volKeyEsc}-${_escHtml(f.file)}">${f.num != null ? `<span class="file-num">${_escHtml(f.num)}</span>` : ''}${_escHtml(f.title)}</label>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('');

      restoreDefaultPermState();
    }

    window.toggleDefaultVolume = function(vol, enabled) {
      const panel = document.getElementById('default-perm-volumes');
      const volBlock = panel?.querySelector(`.vol-block[data-vol="${vol}"]`);
      if (!volBlock) return;
      volBlock.querySelectorAll('.vol-body input[type=checkbox]').forEach(cb => { cb.checked = enabled; });
    };

    window.toggleDefaultAllFiles = function(vol, all) {
      const panel = document.getElementById('default-perm-volumes');
      const volBlock = panel?.querySelector(`.vol-block[data-vol="${vol}"]`);
      if (!volBlock) return;
      volBlock.querySelectorAll('.file-list input[type=checkbox]').forEach(cb => { cb.checked = all; });
    };

    window.toggleDefaultSection = function(vol, checked, headerCheckbox) {
      const sectionBlock = headerCheckbox.closest('.vol-block');
      if (!sectionBlock) return;
      const fileCbs = sectionBlock.querySelectorAll('.file-list input[type=checkbox]');
      fileCbs.forEach(cb => { cb.checked = checked; });
      // Sync the volume-level checkbox so parent state stays consistent
      if (fileCbs.length > 0) updateParentChecks(fileCbs[0]);
    };

    window.updateParentChecks = function(el) {
      // Sync section header checkbox
      const sectionBlock = el.closest('.vol-block:not([data-vol])');
      if (sectionBlock) {
        const sectionHeaderCb = sectionBlock.querySelector(':scope > .vol-header input[type=checkbox]');
        const fileCbs = sectionBlock.querySelectorAll('.file-list input[type=checkbox]');
        if (sectionHeaderCb && fileCbs.length > 0)
          sectionHeaderCb.checked = Array.from(fileCbs).every(cb => cb.checked);
      }
      // Sync volume header checkbox
      const volBlock = el.closest('.vol-block[data-vol]');
      if (volBlock) {
        const volHeaderCb = volBlock.querySelector(':scope > .vol-header input[type=checkbox]');
        const sectionCbs = volBlock.querySelectorAll(':scope > .vol-body > .vol-block > .vol-header input[type=checkbox]');
        if (volHeaderCb && sectionCbs.length > 0)
          volHeaderCb.checked = Array.from(sectionCbs).every(cb => cb.checked);
      }
    };

    function readDefaultPermConfig() {
      const panel = document.getElementById('default-perm-volumes');
      const perms = [];
      panel?.querySelectorAll(':scope > .vol-block').forEach(volBlock => {
        const volKey = volBlock.dataset.vol;

        const allCheckbox = volBlock.querySelector(':scope > .vol-body > div:first-child input[type=checkbox]');
        if (allCheckbox?.checked) {
          perms.push({ volume: volKey, files: null });
        } else {
          const checked = volBlock.querySelectorAll('.file-list input[type=checkbox]:checked');
          const files = Array.from(checked).map(cb => cb.value);
          if (files.length > 0) perms.push({ volume: volKey, files });
        }
      });
      return perms;
    }

    window.applyDefaultPermissions = async function() {
      const btn = document.getElementById('apply-all-btn');
      const msg = document.getElementById('apply-all-msg');
      const progressWrap = document.getElementById('apply-all-progress');
      const progressBar = document.getElementById('apply-all-bar');
      const progressLabel = document.getElementById('apply-all-label');

      const defaultPerms = readDefaultPermConfig();

      if (defaultPerms.length === 0) {
        msg.textContent = 'Configure ao menos uma restrição antes de aplicar.';
        msg.className = 'msg err';
        return;
      }

      const nonAdminUsers = allUsers.filter(u => u.role !== 'admin');
      if (nonAdminUsers.length === 0) {
        msg.textContent = 'Nenhum usuário (não-admin) encontrado.';
        msg.className = 'msg err';
        return;
      }

      const totalVols = defaultPerms.map(p => p.volume).join(', ');
      const confirmMsg = `Isso vai sobrescrever e APLICAR RESTRIÇÕES em ${nonAdminUsers.length} usuário(s). Volumes afetados:\n\n${totalVols || 'Nenhum bloqueio será adicionado (acesso total liberado)'}\n\nDeseja continuar?`;
      if (!confirm(confirmMsg)) return;

      btn.disabled = true;
      msg.className = 'msg';
      msg.textContent = '';
      progressWrap.style.display = 'block';

      let done = 0;
      let successes = 0;
      const failures = [];

      for (const user of nonAdminUsers) {
        const pct = Math.round((done / nonAdminUsers.length) * 100);
        progressBar.style.width = pct + '%';
        progressLabel.textContent = `Aplicando para ${user.display_name || user.email} (${done + 1}/${nonAdminUsers.length})...`;

        // Upsert-then-delete-stale — nunca deixa o usuário sem restrições
        // mesmo por uma janela curta. Exige UNIQUE(user_id, volume) — confirmado.
        try {
          if (defaultPerms.length > 0) {
            const rows = defaultPerms.map(p => ({ user_id: user.id, volume: p.volume, files: p.files }));
            const { error: upsertErr } = await supabase
              .from('user_permissions')
              .upsert(rows, { onConflict: 'user_id,volume' });
            if (upsertErr) throw upsertErr;
          }

          // Remove apenas volumes antigos que não estão no default atual.
          // Se defaultPerms estiver vazio, remove tudo (= acesso total intencional).
          const keepVolumes = defaultPerms.map(p => p.volume);
          let delQuery = supabase.from('user_permissions').delete().eq('user_id', user.id);
          if (keepVolumes.length > 0) {
            delQuery = delQuery.not('volume', 'in', `(${keepVolumes.map(v => `"${v}"`).join(',')})`);
          }
          const { error: delErr } = await delQuery;
          if (delErr) {
            // Upsert já funcionou: usuário tem as restrições novas, mas pode
            // ter restrições antigas extras. É um estado MAIS restritivo que o
            // esperado, não menos — não é crítico de segurança.
            throw new Error(`Restrições aplicadas, mas limpeza de antigas falhou: ${delErr.message}`);
          }

          successes++;
        } catch (e) {
          console.error(`[applyDefault] Falhou para ${user.id} (${user.email}):`, e.message);
          failures.push({ user: user.display_name || user.email, reason: e.message, critical: false });
        }

        done++;
      }

      progressBar.style.width = '100%';

      if (failures.length === 0) {
        progressLabel.textContent = `✅ Concluído — ${successes} usuário(s) atualizados.`;
        msg.textContent = `Restrições aplicadas com sucesso para ${successes} usuário(s)!`;
        msg.className = 'msg ok';
        logAdminAction('apply_default_permissions', { usuarios_afetados: successes, volumes: defaultPerms.map(p => p.volume).join(', ') || 'acesso total' });
      } else {
        const preview = failures.slice(0, 3).map(f => `${f.user}: ${f.reason}`).join(' | ');
        const more = failures.length > 3 ? ` (+${failures.length - 3} mais)` : '';
        progressLabel.textContent = `⚠ ${successes} aplicado(s), ${failures.length} falha(s). Verifique o console.`;
        msg.textContent = `${successes}/${done} aplicados. Falhas: ${preview}${more}`;
        msg.className = 'msg err';
      }

      btn.disabled = false;

      setTimeout(() => {
        progressWrap.style.display = 'none';
        progressBar.style.width = '0%';
      }, 5000);
    };

    window.savePermissions = async function() {
      if (!selectedUserId) return;

      const msg = document.getElementById('save-perm-msg');
      msg.className = 'msg';
      msg.style.display = 'none';

      const { error: delErr } = await supabase.from('user_permissions').delete().eq('user_id', selectedUserId);
      if (delErr) {
        msg.textContent = 'Erro ao limpar permissões: ' + delErr.message;
        msg.classList.add('err');
        msg.style.display = 'block';
        return;
      }

      const perms = [];
      const volBlocks = document.querySelectorAll('#perm-volumes > .vol-block');
      volBlocks.forEach(volBlock => {
        const volKey = volBlock.dataset.vol;
        const volCheckbox = volBlock.querySelector(':scope > .vol-header input[type=checkbox]');
        if (!volCheckbox?.checked) return;

        const allCheckbox = volBlock.querySelector(':scope > .vol-body > div:first-child input[type=checkbox]');
        if (allCheckbox?.checked) {
          perms.push({ user_id: selectedUserId, volume: volKey, files: null });
        } else {
          const fileCheckboxes = volBlock.querySelectorAll('.file-list input[type=checkbox]:checked');
          const files = Array.from(fileCheckboxes).map(cb => cb.value);
          if (files.length > 0) {
            perms.push({ user_id: selectedUserId, volume: volKey, files });
          }
        }
      });

      if (perms.length > 0) {
        const { error } = await supabase.from('user_permissions').insert(perms);
        if (error) {
          msg.textContent = 'Erro: ' + error.message;
          msg.classList.add('err');
          return;
        }
      }

      msg.textContent = 'Permissões salvas!';
      msg.classList.add('ok');
      const savedUser = allUsers.find(u => u.id === selectedUserId);
      logAdminAction('save_permissions', { email: savedUser?.email || selectedUserId, volumes_restritos: perms.length });
      document.getElementById('save-status').textContent = 'Permissões salvas!';
      document.getElementById('save-status').classList.add('saved');
      setTimeout(() => {
        document.getElementById('save-status').textContent = '';
        document.getElementById('save-status').classList.remove('saved');
      }, 3000);
    };

    window.closePermEditor = function() {
      document.getElementById('perm-editor').classList.remove('open');
      selectedUserId = null;
      renderUserList();
    };

    window.changeRole = async function(userId, role) {
      // Proteção: admin não pode remover o próprio acesso
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id === userId && role !== 'admin') {
        alert('Você não pode remover seu próprio acesso de administrador.');
        loadUsers(); // Restaura o select para o valor correto
        return;
      }

      const { data: existing, error: fetchError } = await supabase
        .from('user_profiles').select('role').eq('id', userId).single();
      if (fetchError) {
        alert('Erro ao buscar usuário: ' + fetchError.message);
        return;
      }
      if (existing?.role === role) return;
      if (role === 'admin' && !confirm('Dar permissão de ADMIN para este usuário?')) {
        loadUsers();
        return;
      }

      // Impede rebaixar o último admin do sistema (espelho do check da edge
      // function de delete). Sem isso, poderia ficar sem nenhum administrador.
      if (existing?.role === 'admin' && role !== 'admin') {
        const { count: adminCount, error: countErr } = await supabase
          .from('user_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin');
        if (countErr) {
          alert('Erro ao validar quantidade de admins: ' + countErr.message);
          loadUsers();
          return;
        }
        if ((adminCount ?? 0) <= 1) {
          alert('Não é possível rebaixar o último administrador do sistema.');
          loadUsers();
          return;
        }
      }

      const { error } = await supabase
        .from('user_profiles').update({ role }).eq('id', userId);
      if (error) {
        alert('Erro ao alterar função: ' + error.message);
      } else {
        const targetUser = allUsers.find(u => u.id === userId);
        logAdminAction('change_role', { email: targetUser?.email || userId, de: existing.role, para: role });
      }
      loadUsers();
    };

    window.deleteUser = async function(userId) {
      if (!confirm('Tem certeza que deseja remover este usuário? Esta ação não pode ser desfeita.')) return;

      const targetUser = allUsers.find(u => u.id === userId);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Sessão expirada. Faça login novamente.');

        // admin-delete-user remove de auth.users + todas as tabelas relacionadas
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/admin-delete-user`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': SUPABASE_ANON_KEY
          },
          body: JSON.stringify({ user_id: userId })
        });

        let result = {};
        try { result = await resp.json(); } catch {}
        if (!resp.ok && resp.status !== 207) throw new Error(result.error || `Erro ${resp.status} ao remover usuário`);
        if (resp.status === 207) console.warn('Remoção parcial:', result.error);
        logAdminAction('delete_user', { email: targetUser?.email || userId, nome: targetUser?.display_name || '—' });
      } catch (err) {
        alert('Erro ao remover usuário: ' + err.message);
        loadUsers();
        return;
      }

      if (selectedUserId === userId) closePermEditor();
      loadUsers();
    };

    window.resetPassword = async function(userId, email) {
      // Se o email já veio da RPC admin_get_users, não precisa de prompt
      const inputEmail = (email && email.trim())
        ? email
        : prompt('Email do usuário para enviar link de redefinição:', '');
      if (!inputEmail) return;

      const { error } = await supabase.auth.resetPasswordForEmail(inputEmail, {
        redirectTo: window.location.origin + '/mioshie_college_app/reset-password.html'
      });
      if (error) {
        alert('Erro ao enviar link: ' + error.message);
      } else {
        alert(`Link de redefinição enviado para ${inputEmail}.`);
      }
    };

    window.addUser = async function() {
      const name = document.getElementById('new-name').value.trim();
      const email = document.getElementById('new-email').value.trim().toLowerCase();
      const password = document.getElementById('new-password').value;
      const msg = document.getElementById('add-user-msg');
      const btn = document.getElementById('add-user-btn');

      if (!email || !password) {
        msg.textContent = 'Email e senha são obrigatórios.';
        msg.className = 'msg err';
        return;
      }

      if (password.length < 6) {
        msg.textContent = 'A senha deve ter pelo menos 6 caracteres.';
        msg.className = 'msg err';
        return;
      }

      btn.disabled = true;
      msg.className = 'msg';
      msg.style.display = 'none';

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Sessão expirada. Faça login novamente.');

        // Usa Edge Function para criar via Admin API — NÃO altera a sessão do admin logado
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/admin-create-user`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': SUPABASE_ANON_KEY
          },
          body: JSON.stringify({ email, password, display_name: name })
        });

        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || 'Erro ao criar usuário');

        msg.textContent = 'Usuário criado com sucesso!';
        msg.className = 'msg ok';
        logAdminAction('add_user', { email, nome: name || '—' });
        document.getElementById('new-name').value = '';
        document.getElementById('new-email').value = '';
        document.getElementById('new-password').value = '';
        loadUsers();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = 'msg err';
      }

      btn.disabled = false;
    };

    // ============================================================
    // Analytics
    // ============================================================

    function getPeriodDays() {
      return parseInt(document.getElementById('analytics-period')?.value || '30');
    }

    window.loadAnalytics = async function() {
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
        try { await loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
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

      const uniqueClicks = new Set(logs.map(r => `${r.user_id}|${r.volume}|${r.file}`)).size;

      if (uniqueClicks === 0) {
        container.innerHTML = '<div class="loading">Sem cliques no período.</div>';
        return;
      }

      const started = positions.filter(r => (r.time_spent_seconds || 0) > 0).length;
      const real    = positions.filter(r => (r.time_spent_seconds || 0) >= 60).length;
      const deep    = positions.filter(r => (r.time_spent_seconds || 0) >= 180).length;

      const bounce = Math.max(0, Math.round((1 - real / uniqueClicks) * 100));
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
            const count = segments[d.key].length;
            const pct = total > 0 ? Math.round(count / total * 100) : 0;
            return `
              <div class="stat-card" style="border-top:3px solid ${d.color};">
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
        try { await loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
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
        try { await loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
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
        try { await loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
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
        try { await loadVolumeFiles(); } catch (e) {}
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

      if (!data.length) {
        document.getElementById('daily-activity-chart').innerHTML = '<div class="loading">Sem dados.</div>';
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
      const chartH = 160;
      const padL = 40;
      const padR = 10;
      const padT = 10;
      const padB = 30;
      const svgW = 800;
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
        yLines += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="10">${val}</text>`;
      }

      const labelCount = Math.min(entries.length, 7);
      const labelStep = Math.max(Math.floor(entries.length / labelCount), 1);
      let xLabels = '';
      for (let i = 0; i < entries.length; i += labelStep) {
        const p = points[i];
        const label = entries[i][0].slice(5);
        xLabels += `<text x="${p.x}" y="${svgH - 4}" text-anchor="middle" fill="var(--text-muted)" font-size="9">${label}</text>`;
      }

      const dots = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="var(--accent)" opacity="0.8"><title>${p.date}: ${p.val} views</title></circle>`).join('');

      document.getElementById('daily-activity-chart').innerHTML = `
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
        try { await loadVolumeFiles(); } catch (e) { console.warn('loadVolumeFiles falhou:', e); }
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

      const allUsers = Object.values(userActivity);
      const activeInPeriod = allUsers.filter(u => u.inPeriod);
      const returningUsers = activeInPeriod.filter(u => u.beforeHalf && u.afterHalf);
      const newUsers = activeInPeriod.filter(u => !u.beforeHalf && u.afterHalf);
      const churnedUsers = allUsers.filter(u => u.beforeHalf && !u.afterHalf);

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
          Total de usuários que já acessaram: <strong>${allUsers.length}</strong> &nbsp;|&nbsp;
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


    // ============================================================
    // Find & Replace (bulk correction across Storage JSONs)
    // ============================================================
    let _frResults = [];   // array of per-file match objects
    let _frSearch = '';
    let _frReplace = '';

    function _frEsc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _frStripHtml(html) {
      const d = document.createElement('div');
      d.innerHTML = html;
      return (d.textContent || d.innerText || '').trim();
    }

    // Retorna [{startIdx, endIdx}] para todas as ocorrências literais de needle em haystack
    function _frFindAll(haystack, needle) {
      const out = [];
      if (!haystack || !needle) return out;
      let from = 0;
      while (true) {
        const i = haystack.indexOf(needle, from);
        if (i === -1) break;
        out.push({ startIdx: i, endIdx: i + needle.length });
        from = i + needle.length;
      }
      return out;
    }

    // Navega num objeto JSON por array de chaves/índices
    function _frGetByPath(obj, path) {
      let cur = obj;
      for (const key of path) cur = cur[key];
      return cur;
    }

    // Substitui apenas as ocorrências cujo índice (0-based) está em selectedSet
    function _frReplaceSelected(text, needle, replacement, selectedSet) {
      if (!selectedSet || !selectedSet.size) return { newText: text, count: 0 };
      let result = '';
      let from = 0;
      let occIdx = 0;
      let count = 0;
      while (true) {
        const i = text.indexOf(needle, from);
        if (i === -1) { result += text.slice(from); break; }
        result += text.slice(from, i);
        if (selectedSet.has(occIdx)) { result += replacement; count++; }
        else { result += needle; }
        from = i + needle.length;
        occIdx++;
      }
      return { newText: result, count };
    }

    // Produz um "diff line" com contexto (~40 chars) ao redor da ocorrência
    function _frDiffLine(fullText, match, needle, replacement) {
      const ctx = 45;
      const start = Math.max(0, match.startIdx - ctx);
      const end = Math.min(fullText.length, match.endIdx + ctx);
      const pre = (start > 0 ? '…' : '') + fullText.slice(start, match.startIdx);
      const post = fullText.slice(match.endIdx, end) + (end < fullText.length ? '…' : '');
      return {
        oldHtml: _frEsc(pre) + '<mark>' + _frEsc(needle) + '</mark>' + _frEsc(post),
        newHtml: _frEsc(pre) + '<mark>' + _frEsc(replacement) + '</mark>' + _frEsc(post),
      };
    }

    // Percorre recursivamente um nó (book) coletando matches em .content e .title
    function _frScanBookNode(node, parentPath, needle, out) {
      if (!node || typeof node !== 'object') return;
      const path = [...parentPath];
      if (typeof node.title === 'string') {
        const matches = _frFindAll(node.title, needle);
        if (matches.length) out.push({ field: 'title', text: node.title, path, matches });
      }
      if (typeof node.content === 'string') {
        const matches = _frFindAll(node.content, needle);
        if (matches.length) out.push({ field: 'content', text: node.content, path, matches });
      }
      if (Array.isArray(node.children)) {
        node.children.forEach((ch, i) => _frScanBookNode(ch, [...path, 'children', i], needle, out));
      }
    }

    // Escaneia o JSON de um arquivo e retorna lista de "campos" que contêm matches.
    // searchInJa=true: busca em title/content (JA) e expõe title_ptbr/content_ptbr como contexto.
    function _frScanJson(json, needle, isBook, searchInJa = false) {
      const hits = [];
      if (isBook) {
        // Livros têm só title/content (sem split JA/PT) — modo JA não se aplica
        if (searchInJa) return hits;
        if (Array.isArray(json.sections)) {
          json.sections.forEach((s, i) => _frScanBookNode(s, ['sections', i], needle, hits));
        }
      } else {
        if (!Array.isArray(json.themes)) return hits;
        // [campo a buscar, campo do outro idioma usado como contexto/edição]
        const fieldPairs = searchInJa
          ? [['title', 'title_ptbr'], ['content', 'content_ptbr']]
          : [['title_ptbr', 'title'], ['content_ptbr', 'content']];
        json.themes.forEach((theme, tIdx) => {
          if (!Array.isArray(theme.topics)) return;
          theme.topics.forEach((topic, pIdx) => {
            fieldPairs.forEach(([searchField, otherField]) => {
              const val = topic[searchField];
              if (typeof val !== 'string') return;
              const matches = _frFindAll(val, needle);
              if (matches.length) {
                hits.push({
                  field: searchField,
                  text: val,
                  jaText: typeof topic[otherField] === 'string' ? topic[otherField] : '',
                  path: ['themes', tIdx, 'topics', pIdx],
                  matches
                });
              }
            });
          });
        });
      }
      return hits;
    }

    async function _frListFiles(prefix) {
      try {
        const { data, error } = await supabase.storage.from('teachings').list(prefix, { limit: 1000 });
        if (error) throw error;
        return (data || [])
          .filter(f => f.name && f.name.endsWith('.json'))
          .map(f => f.name);
      } catch (e) {
        console.warn(`[fr] list ${prefix} falhou:`, e.message);
        return [];
      }
    }

    async function _frDownloadJson(path) {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData?.session?.access_token;
      if (!token) throw new Error('Não autenticado');
      const url = `${SUPABASE_URL}/storage/v1/object/authenticated/teachings/${path}`;
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY }
      });
      if (!res.ok) throw new Error(`Download falhou: ${res.status} — ${path}`);
      return res.json();
    }

    async function _frUploadJson(path, json) {
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const { error } = await supabase.storage.from('teachings')
        .upload(path, blob, { upsert: true, contentType: 'application/json', cacheControl: '0' });
      if (error) throw error;
    }

    // Mudar o texto a buscar invalida resultados antigos (precisa rodar nova busca)
    window.onFindReplaceSearchChange = function() {
      if (!_frResults.length) return;
      const s = document.getElementById('fr-search').value;
      if (s === _frSearch) return;
      _frResults = [];
      document.getElementById('fr-results-container').innerHTML =
        '<div class="fr-empty">Texto de busca alterado — clique em <strong>Buscar</strong> para atualizar os resultados.</div>';
      const sel = document.getElementById('fr-btn-apply-selected');
      const all = document.getElementById('fr-btn-apply-all');
      [sel, all].forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
      document.getElementById('fr-progress').textContent = '';
    };

    // Atualiza só as linhas "novo" do diff sem recriar o DOM (preserva checkboxes)
    function updateFindReplaceDiff() {
      _frReplace = document.getElementById('fr-replace').value;
      document.querySelectorAll('.fr-diff-item[data-fi]').forEach(item => {
        const fi = parseInt(item.dataset.fi, 10);
        const hi = parseInt(item.dataset.hi, 10);
        const mi = parseInt(item.dataset.mi, 10);
        const r = _frResults[fi];
        if (!r || r.applied) return;
        const hit = r.hits[hi];
        if (!hit) return;
        const m = hit.matches[mi];
        if (!m) return;
        const d = _frDiffLine(hit.text, m, _frSearch, _frReplace);
        const newLine = item.querySelector('.fr-diff-new');
        if (newLine) newLine.innerHTML = d.newHtml;
      });
    }

    // Mudar só a substituição atualiza o preview sem recriar o DOM (preserva checkboxes)
    window.onFindReplaceReplaceChange = function() {
      if (!_frResults.length) return;
      updateFindReplaceDiff();
    };

    // Alterna entre o modo PT (find/replace clássico) e o modo "Buscar no japonês"
    // (localiza termo JA e abre o editor para o admin corrigir o PT manualmente).
    window.onFindReplaceModeChange = function() {
      const ja = document.getElementById('fr-search-ja').checked;
      const replaceCol = document.getElementById('fr-replace-col');
      const grid       = document.getElementById('fr-search-grid');
      const searchEl   = document.getElementById('fr-search');
      const searchLbl  = document.getElementById('fr-search-label');
      const btnSel     = document.getElementById('fr-btn-apply-selected');
      const btnAll     = document.getElementById('fr-btn-apply-all');

      if (ja) {
        replaceCol.style.display = 'none';
        grid.style.gridTemplateColumns = '1fr';
        searchEl.placeholder = 'Termo japonês (ex: 善言讃詞)';
        searchLbl.textContent = 'Termo japonês a localizar';
        btnSel.style.display = 'none';
        btnAll.style.display = 'none';
        // Modo JA não se aplica a livros (sem split JA/PT)
        document.querySelectorAll('.fr-scope[value="books"]').forEach(c => {
          c.checked = false; c.disabled = true;
          const lbl = c.closest('label'); if (lbl) lbl.style.opacity = '0.4';
        });
      } else {
        replaceCol.style.display = '';
        grid.style.gridTemplateColumns = '1fr 1fr';
        searchEl.placeholder = 'Ex: a Imagem da Luz Divina (Komei Nyorai)';
        searchLbl.textContent = 'Texto a buscar';
        btnSel.style.display = '';
        btnAll.style.display = '';
        document.querySelectorAll('.fr-scope[value="books"]').forEach(c => {
          c.disabled = false;
          const lbl = c.closest('label'); if (lbl) lbl.style.opacity = '';
        });
      }

      // Limpa resultados anteriores — mudar de modo invalida o que estava na tela
      _frResults = [];
      document.getElementById('fr-results-container').innerHTML = '';
      document.getElementById('fr-progress').textContent = '';
    };

    window.runFindReplaceSearch = async function() {
      const search = document.getElementById('fr-search').value;
      const replace = document.getElementById('fr-replace').value;
      const searchInJa = document.getElementById('fr-search-ja').checked;
      const progress = document.getElementById('fr-progress');
      const container = document.getElementById('fr-results-container');
      const btnSearch = document.getElementById('fr-btn-search');

      if (!search) {
        container.innerHTML = '<div class="fr-empty">Informe o texto a buscar.</div>';
        return;
      }
      // Modo PT (replace ativo) precisa que search ≠ replace; modo JA não usa replace
      if (!searchInJa && search === replace) {
        container.innerHTML = '<div class="fr-empty">O texto a buscar é igual ao de substituição — nada a fazer.</div>';
        return;
      }

      const scopes = Array.from(document.querySelectorAll('.fr-scope:checked')).map(c => c.value);
      if (!scopes.length) {
        container.innerHTML = '<div class="fr-empty">Selecione ao menos um escopo.</div>';
        return;
      }

      _frSearch = search;
      _frReplace = replace;
      _frResults = [];

      btnSearch.disabled = true;
      btnSearch.textContent = 'Buscando…';
      container.innerHTML = '<div class="loading">Listando arquivos…</div>';
      progress.textContent = '';

      // Monta lista (prefix, file, isBook)
      const work = [];
      for (const scope of scopes) {
        const files = await _frListFiles(scope === 'books' ? 'books' : scope);
        for (const f of files) work.push({ vol: scope, file: f, path: `${scope === 'books' ? 'books' : scope}/${f}`, isBook: scope === 'books' });
      }

      if (!work.length) {
        container.innerHTML = '<div class="fr-empty">Nenhum arquivo encontrado no escopo selecionado.</div>';
        btnSearch.disabled = false;
        btnSearch.textContent = '🔎 Buscar';
        return;
      }

      let scanned = 0;
      const results = [];
      // Paraleliza em lotes de 8 para não saturar
      const BATCH = 8;
      for (let i = 0; i < work.length; i += BATCH) {
        const slice = work.slice(i, i + BATCH);
        await Promise.all(slice.map(async (w) => {
          try {
            const json = await _frDownloadJson(w.path);
            const hits = _frScanJson(json, _frSearch, w.isBook, searchInJa);
            if (hits.length) {
              const totalMatches = hits.reduce((s, h) => s + h.matches.length, 0);
              results.push({ ...w, hits, totalMatches, applied: false, searchInJa });
            }
          } catch (e) {
            console.warn(`[fr] scan ${w.path} falhou:`, e.message);
          }
          scanned++;
          progress.textContent = `Analisando ${scanned}/${work.length} arquivos…`;
        }));
      }

      results.sort((a, b) => a.path.localeCompare(b.path));
      _frResults = results;

      btnSearch.disabled = false;
      btnSearch.textContent = '🔎 Buscar';
      progress.textContent = `${results.length} arquivo(s) com ${results.reduce((s, r) => s + r.totalMatches, 0)} ocorrência(s).`;

      renderFindReplaceResults();
    };

    function renderFindReplaceResults() {
      const container = document.getElementById('fr-results-container');
      const btnSel = document.getElementById('fr-btn-apply-selected');
      const btnAll = document.getElementById('fr-btn-apply-all');

      const hasPending = _frResults.some(r => !r.applied);
      [btnSel, btnAll].forEach(b => {
        b.disabled = !hasPending;
        b.style.opacity = hasPending ? '1' : '0.5';
      });

      if (!_frResults.length) {
        container.innerHTML = '<div class="fr-empty">Nenhuma ocorrência encontrada.</div>';
        return;
      }

      container.innerHTML = _frResults.map((r, idx) => {
        const fieldBadges = [...new Set(r.hits.map(h => h.field))].map(f => `<span class="fr-file-field">${_frEsc(f)}</span>`).join('');

        // ── Modo "Buscar no japonês" ─────────────────────────────────
        // Não há diff/replace: só mostra o trecho JA com highlight + o PT
        // correspondente, e um botão pra abrir o editor estruturado.
        if (r.searchInJa) {
          const itemsHtml = r.hits.map(hit => {
            // Mostra o trecho JA com highlight em volta de cada match (só âncora — não vai ser editado/apagado)
            const jaSnippets = hit.matches.map(m => {
              const d = _frDiffLine(hit.text, m, _frSearch, _frSearch);
              return `<div class="fr-ja-anchor">${d.oldHtml}</div>`;
            }).join('');
            const ptText = (hit.jaText || '').trim();
            const ptHtml = ptText
              ? `<div style="margin-top:6px; padding:8px 10px; background:rgba(184,134,11,0.06); border-left:2px solid var(--accent); border-radius:0 6px 6px 0; font-size:0.85rem; line-height:1.6; color:var(--text);">
                  <div style="font-size:0.68rem; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">PT atual (${_frEsc(hit.field === 'title' ? 'title_ptbr' : 'content_ptbr')})</div>
                  ${_frEsc(_frStripHtml(ptText))}
                </div>`
              : `<div style="margin-top:6px; padding:8px 10px; background:rgba(255,80,80,0.08); border-left:2px solid #e05252; border-radius:0 6px 6px 0; font-size:0.82rem; color:var(--text-muted);">⚠ Sem tradução PT correspondente neste tópico.</div>`;
            return `<div class="fr-diff-item" style="align-items:flex-start;">
              <div class="fr-diff-item-body">
                <div style="font-size:0.7rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">JA (${_frEsc(hit.field)})</div>
                ${jaSnippets}
                ${ptHtml}
              </div>
            </div>`;
          }).join('');

          // Escapa os args pra inline onclick (search/file podem ter aspas)
          const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
          const editArg = `'${escAttr(r.vol)}', '${escAttr(r.file)}'`;
          return `<div class="fr-file-card" data-fr-idx="${idx}">
            <div class="fr-file-header">
              <span class="fr-file-path">${_frEsc(r.path)}</span>
              ${fieldBadges}
              <span class="fr-file-count">${r.totalMatches} ${r.totalMatches === 1 ? 'ocorrência' : 'ocorrências'}</span>
              <div class="fr-file-actions">
                <button class="fr-apply-btn" onclick="openFrJaEditor(${editArg})">✏️ Editar PT no editor</button>
              </div>
            </div>
            <div class="fr-diff-list">${itemsHtml}</div>
          </div>`;
        }

        // ── Modo PT (clássico find/replace) ──────────────────────────
        const diffHtml = r.hits.map((hit, hIdx) => {
          return hit.matches.map((m, mIdx) => {
            const d = _frDiffLine(hit.text, m, _frSearch, _frReplace);
            const checkHtml = r.applied ? '' :
              `<input type="checkbox" class="fr-occ-check fr-checkbox" data-fi="${idx}" data-hi="${hIdx}" data-mi="${mIdx}" checked style="margin-top:3px; flex-shrink:0;">`;
            const jaBtnHtml = (mIdx === 0 && hit.jaText)
              ? `<button class="fr-ja-btn" onclick="const p=this.nextElementSibling;p.hidden=!p.hidden;this.textContent=p.hidden?'日本語 ▸':'日本語 ▾'">日本語 ▸</button><div class="fr-ja-inline" hidden>${_frEsc(_frStripHtml(hit.jaText))}</div>`
              : '';
            return `<div class="fr-diff-item" data-fi="${idx}" data-hi="${hIdx}" data-mi="${mIdx}">
              ${checkHtml}
              <div class="fr-diff-item-body">
                <div class="fr-diff-line fr-diff-old">${d.oldHtml}</div>
                <div class="fr-diff-line fr-diff-new">${d.newHtml}</div>
                ${jaBtnHtml}
              </div>
            </div>`;
          }).join('');
        }).join('');

        return `<div class="fr-file-card ${r.applied ? 'applied' : ''}" data-fr-idx="${idx}">
          <div class="fr-file-header">
            ${r.applied ? '<span style="width:16px;text-align:center;">✅</span>' : ''}
            <span class="fr-file-path">${_frEsc(r.path)}</span>
            ${fieldBadges}
            <span class="fr-file-count">${r.totalMatches} ${r.totalMatches === 1 ? 'ocorrência' : 'ocorrências'}</span>
            <div class="fr-file-actions">
              ${r.applied
                ? '<button class="fr-apply-btn done" disabled>✓ Aplicado</button>'
                : `<button class="fr-apply-btn" onclick="applyFindReplaceRow(${idx})">Aplicar marcadas</button>`}
            </div>
          </div>
          <div class="fr-diff-list">${diffHtml}</div>
        </div>`;
      }).join('');
    }

    // Abre o editor estruturado do arquivo, com o termo JA destacado pra o
    // admin localizar visualmente o tópico e digitar a tradução PT correta.
    window.openFrJaEditor = function(vol, file) {
      window.openEditor(vol, file, { text: _frSearch || '', lang: 'ja' });
    };

    // forceAll=true → aplica todas as ocorrências ignorando checkboxes (usado por "Aplicar tudo")
    window.applyFindReplaceRow = async function(idx, forceAll) {
      const r = _frResults[idx];
      if (!r || r.applied) return;

      // Monta mapa hitIdx → Set<matchIdx> de ocorrências selecionadas
      let selMap;
      let totalSelected;
      if (forceAll) {
        selMap = new Map();
        r.hits.forEach((hit, hIdx) => {
          const s = new Set();
          hit.matches.forEach((_, mIdx) => s.add(mIdx));
          selMap.set(hIdx, s);
        });
        totalSelected = r.totalMatches;
      } else {
        const checked = Array.from(document.querySelectorAll(`.fr-occ-check[data-fi="${idx}"]:checked`));
        if (!checked.length) { alert('Nenhuma ocorrência marcada para aplicar.'); return; }
        selMap = new Map();
        checked.forEach(cb => {
          const hi = parseInt(cb.dataset.hi, 10);
          const mi = parseInt(cb.dataset.mi, 10);
          if (!selMap.has(hi)) selMap.set(hi, new Set());
          selMap.get(hi).add(mi);
        });
        totalSelected = checked.length;
      }

      const btns = document.querySelectorAll(`.fr-file-card[data-fr-idx="${idx}"] button`);
      btns.forEach(b => { b.disabled = true; b.textContent = 'Salvando…'; });

      try {
        const fresh = await _frDownloadJson(r.path);
        let totalReplaced = 0;

        r.hits.forEach((hit, hIdx) => {
          const selected = selMap.get(hIdx);
          if (!selected || !selected.size) return;
          const parent = _frGetByPath(fresh, hit.path);
          const currentText = parent[hit.field];
          const { newText, count } = _frReplaceSelected(currentText, _frSearch, _frReplace, selected);
          parent[hit.field] = newText;
          totalReplaced += count;
        });

        if (totalReplaced === 0) {
          alert(`O texto "${_frSearch}" não está mais presente em ${r.path}. Nada foi alterado.`);
        } else {
          await _frUploadJson(r.path, fresh);
          await logAdminAction('search_replace', {
            arquivo: r.path,
            ocorrencias: totalReplaced,
            de: _frSearch.slice(0, 80) + (_frSearch.length > 80 ? '…' : ''),
            para: _frReplace.slice(0, 80) + (_frReplace.length > 80 ? '…' : '')
          });
          if (totalReplaced !== totalSelected) {
            alert(`Aviso: esperado ${totalSelected} substituição(ões), mas ${totalReplaced} foram feitas. O arquivo pode ter sido editado entretanto.`);
          }
        }

        // Re-escaneia o JSON atualizado para mostrar ocorrências restantes
        const remaining = _frScanJson(fresh, _frSearch, r.isBook);
        r.hits = remaining;
        r.totalMatches = remaining.reduce((s, h) => s + h.matches.length, 0);
        if (!r.totalMatches) r.applied = true;

        renderFindReplaceResults();
      } catch (e) {
        console.error('[fr] apply falhou:', e);
        alert(`Falha ao aplicar em ${r.path}: ${e.message}`);
        renderFindReplaceResults();
      }
    };

    // Aplica apenas as ocorrências marcadas, em todos os arquivos que têm ao menos uma
    window.applyFindReplaceSelected = async function() {
      const pending = _frResults
        .map((r, i) => ({ r, i }))
        .filter(({ r, i }) => !r.applied && !!document.querySelector(`.fr-occ-check[data-fi="${i}"]:checked`));
      if (!pending.length) { alert('Nenhuma ocorrência marcada.'); return; }
      if (!confirm(`Aplicar substituições marcadas em ${pending.length} arquivo(s)?`)) return;
      const progress = document.getElementById('fr-progress');
      for (let n = 0; n < pending.length; n++) {
        progress.textContent = `Aplicando ${n + 1}/${pending.length}…`;
        await window.applyFindReplaceRow(pending[n].i, false);
      }
      progress.textContent = `Concluído. ${pending.length} arquivo(s) processado(s).`;
    };

    // Aplica TODAS as ocorrências em todos os arquivos pendentes (ignora checkboxes)
    window.applyFindReplaceAll = async function() {
      const pending = _frResults.map((r, i) => ({ r, i })).filter(x => !x.r.applied);
      if (!pending.length) return;
      if (!confirm(`Aplicar substituição em TODAS as ocorrências dos ${pending.length} arquivo(s) listado(s)?`)) return;
      const progress = document.getElementById('fr-progress');
      for (let n = 0; n < pending.length; n++) {
        progress.textContent = `Aplicando ${n + 1}/${pending.length}…`;
        await window.applyFindReplaceRow(pending[n].i, true);
      }
      progress.textContent = `Concluído. ${pending.length} arquivo(s) atualizado(s).`;
    };

    // ============================================================
    // Disciples Analytics — Publicações de Discípulos
    // Lê access_logs e reading_positions filtrados por volume='disciples'
    // ============================================================
    let _dcChart = null;

    window.loadSearchAnalytics = async function() {
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
          genAt.textContent = `Período: últimos ${days} dia(s) — desde ${since.toLocaleDateString('pt-BR')}`;
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
            const ago = last_seen ? new Date(last_seen).toLocaleDateString('pt-BR') : '';
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

          const { data: logs } = await supabase
            .from('search_logs')
            .select('user_id, query, results_count, created_at')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(2000);

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
            const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

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
                      <td style="padding:7px 0 7px 12px; border-bottom:1px solid var(--border); text-align:right; font-size:0.78rem; color:var(--text-muted); white-space:nowrap;">${new Date(r.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>`;
          }
        } catch (err) {
          if (searchersEl) searchersEl.innerHTML = `<div class="loading" style="color:#e05252;">Erro: ${_escHtml(err?.message || String(err))}</div>`;
        }
      }
    };

    window.loadDisciplesAnalytics = async function() {
      const dash = document.getElementById('dc-dashboard');
      const genAt = document.getElementById('dc-gen-at');
      const days = parseInt(document.getElementById('dc-range')?.value || '30', 10);
      if (!dash) return;
      dash.innerHTML = '<div class="loading">Carregando dados…</div>';

      const since = new Date(Date.now() - days * 86400000).toISOString();

      try {
        const [logsRes, posRes] = await Promise.all([
          supabase.from('access_logs')
            .select('user_id, file, action, created_at')
            .eq('volume', 'disciples')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(5000),
          supabase.from('reading_positions')
            .select('user_id, file, time_spent_seconds, topic_index, total_topics, progress_pct, updated_at')
            .eq('volume', 'disciples')
        ]);

        if (logsRes.error || posRes.error) {
          const e = logsRes.error || posRes.error;
          dash.innerHTML = `<div class="loading" style="color:#e05252;">Erro: ${_escHtml(e.message)}</div>`;
          return;
        }

        const logs = (logsRes.data || []).filter(l => !_adminIds.has(l.user_id));
        const positions = (posRes.data || []).filter(p => !_adminIds.has(p.user_id));

        if (genAt) genAt.textContent = `Atualizado em ${new Date().toLocaleString('pt-BR')}`;

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

        // ── Render helpers ──
        const fmtSecs = secs => {
          secs = Math.round(secs || 0);
          if (secs < 60) return `${secs}s`;
          if (secs < 3600) return `${Math.round(secs / 60)} min`;
          const h = Math.floor(secs / 3600);
          const m = Math.round((secs - h * 3600) / 60);
          return m ? `${h}h ${m}min` : `${h}h`;
        };
        const fmtDate = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
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

        const topReadersHtml = topReaders.length
          ? `<table><thead><tr><th>Usuário</th><th style="text-align:right;">Tempo</th><th>Livros</th><th>Última leitura</th></tr></thead><tbody>${
              topReaders.map(r => `<tr>
                <td>${_escHtml(nameMap[r.user_id] || 'Desconhecido')}</td>
                <td class="num">${fmtSecs(r.seconds)}</td>
                <td style="font-size:.78rem;">${[...r.books].map(bookTitle).map(_escHtml).join(', ') || '—'}</td>
                <td style="font-size:.78rem; color:var(--text-muted);">${fmtDate(r.lastAt)}</td>
              </tr>`).join('')
            }</tbody></table>`
          : '<div class="loading">Sem leitores com tempo registrado ainda.</div>';

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
        const progressHtml = progressRows.length
          ? `<table><thead><tr><th>Usuário</th><th>Livro</th><th>Capítulo</th><th>Progresso</th><th style="text-align:right;">Tempo</th><th>Última leitura</th></tr></thead><tbody>${
              progressRows.map(p => {
                const tot = p.total_topics || 0;
                const idx = (p.topic_index ?? 0);
                const chap = tot > 0 ? `${idx + 1} de ${tot}` : '—';
                const pct = (tot > 0) ? ((idx + 1) / tot) * 100 : (p.progress_pct || 0);
                return `<tr>
                  <td>${_escHtml(nameMap[p.user_id] || 'Desconhecido')}</td>
                  <td>${_escHtml(bookTitle(p.file))}</td>
                  <td style="font-size:.82rem; color:var(--text-muted);">${chap}</td>
                  <td>${progressBar(pct)}</td>
                  <td class="num">${fmtSecs(p.time_spent_seconds || 0)}</td>
                  <td style="font-size:.78rem; color:var(--text-muted);">${fmtDate(p.updated_at)}</td>
                </tr>`;
              }).join('')
            }</tbody></table>`
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
            <div class="dc-tbl"><h3>Top leitores (por tempo)</h3>${topReadersHtml}</div>
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
    };

    // ============================================================
    // Johrei Analytics
    // ============================================================
    let _jrChart = null;

    window.loadJohreiAnalytics = async function() {
      const dash = document.getElementById('jr-dashboard');
      const genAt = document.getElementById('jr-gen-at');
      const days = parseInt(document.getElementById('jr-range')?.value || '30', 10);
      if (!dash) return;
      dash.innerHTML = '<div class="loading">Carregando dados…</div>';

      const since = new Date(Date.now() - days * 86400000).toISOString();

      // Fetch RPC and extra raw data in parallel
      const [rpcRes, rawRes] = await Promise.all([
        supabase.rpc('admin_get_site_analytics', { p_site: 'johrei', days_back: days }),
        supabase.from('site_events').select('props,created_at').eq('site','johrei').eq('event_type','pageview').gte('created_at', since)
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
      const paths = data.top_paths || [];
      const eng = data.engagement || {};
      const clicks = data.top_clicks || [];
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

      const clicksTbl = clicks.length
        ? `<table><thead><tr><th>Rótulo</th><th style="text-align:right;">Cliques</th></tr></thead><tbody>${
            clicks.map(c => `<tr><td class="ell">${esc(c.label)}${c.kind === 'cta' ? ' <span style="font-size:.6rem;color:var(--text-muted);">CTA</span>' : ''}</td><td class="num">${(c.clicks??0).toLocaleString('pt-BR')}</td></tr>`).join('')
          }</tbody></table>`
        : '<div class="loading">Nenhum clique rastreado ainda.</div>';

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
        <div class="jr-chart-wrap">
          <h3>Visitas por dia (últimos ${data.days_back} dias)</h3>
          <canvas id="jr-chart"></canvas>
        </div>
        <div class="jr-tables" style="margin-bottom:16px;">
          <div class="jr-tbl"><h3>Top ensinamentos</h3>${itemsTbl}</div>
          <div class="jr-tbl"><h3>Top páginas</h3>${tbl(paths,'path','visits')}</div>
        </div>
        <div class="jr-tables" style="margin-bottom:16px;">
          <div class="jr-tbl"><h3>Top referrers</h3>${tbl(refs,'referrer','visits')}</div>
          <div class="jr-tbl"><h3>Top cliques</h3>${clicksTbl}</div>
        </div>
        <div class="jr-tables" style="margin-bottom:16px;">
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
    };

    // ============================================================
    // Landing Analytics
    // ============================================================
    let _lpChart = null;

    window.loadLandingAnalytics = async function() {
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
      const paths = data.top_paths || [];
      const eng = data.engagement || {};
      const clicks = data.top_clicks || [];

      if (genAt) genAt.textContent = `Atualizado em ${new Date(data.generated_at).toLocaleString('pt-BR')}`;

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
        hours[new Date(r.created_at).getHours()]++;
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

      const clicksTbl = clicks.length
        ? `<table><thead><tr><th>Rótulo</th><th style="text-align:right;">Cliques</th></tr></thead><tbody>${
            clicks.map(c => `<tr><td class="ell">${esc(c.label)}${c.kind === 'cta' ? ' <span style="font-size:.6rem;color:var(--text-muted);">CTA</span>' : ''}</td><td class="num">${(c.clicks??0).toLocaleString('pt-BR')}</td></tr>`).join('')
          }</tbody></table>`
        : '<div class="loading">Nenhum clique rastreado ainda.</div>';

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
          <div class="lp-tbl"><h3>Top páginas</h3>${tbl(paths,'path','visits')}</div>
        </div>
        <div class="lp-tables" style="margin-bottom:16px;">
          <div class="lp-tbl"><h3>Top cliques</h3>${clicksTbl}</div>
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
    };


    checkAdmin();
