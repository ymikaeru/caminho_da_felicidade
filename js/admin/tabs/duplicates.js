// ============================================================
// Duplicates Tab — pares de tópicos com alta similaridade
// semântica via embeddings. Visualização lado-a-lado + dispensar.
// ============================================================
import { supabase, SUPABASE_URL } from '../../supabase-config.js';
import { VOL_SHORT } from '../shared/constants.js';

function _dupEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function _fetchTopicContent(vol, file, topicIdx) {
  // Lê o JSON do Storage e extrai o conteúdo PT do topic_idx pedido.
  // Mesmo padrão do search preview em js/search.js.
  try {
    let json;
    if (!window.supabaseStorageFetch) {
      const url = `${SUPABASE_URL}/storage/v1/object/teachings/${vol}/${file}.json`;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(url, { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} });
      if (!res.ok) throw new Error('storage fetch ' + res.status);
      json = await res.json();
    } else {
      json = await window.supabaseStorageFetch(`${vol}/${file}.json`);
    }
    const topics = [];
    (json?.themes || []).forEach(theme => (theme?.topics || []).forEach(t => topics.push(t)));
    const t = topics[topicIdx] || topics[0];
    if (!t) return '';
    const html = t.content_ptbr || t.content_pt || t.content || '';
    return String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ');
  } catch (e) {
    return `[erro ao carregar conteúdo: ${e.message}]`;
  }
}

async function loadDuplicates() {
  const container = document.getElementById('duplicates-container');
  const summary = document.getElementById('duplicates-summary');
  if (!container) return;
  container.innerHTML = '<div class="loading">Carregando...</div>';
  summary.textContent = '';

  const sliderVal = parseInt(document.getElementById('dup-threshold')?.value || '95', 10);
  const threshold = sliderVal / 100;

  const { data, error } = await supabase.rpc('find_duplicate_topics', {
    threshold,
    limit_n: 500,
  });
  if (error) {
    container.innerHTML = `<div class="msg err">Erro: ${_dupEsc(error.message)}</div>`;
    return;
  }
  window._dupPairsAll = data || [];
  window._dupThreshold = threshold;
  renderDuplicates();
}

function renderDuplicates() {
  const container = document.getElementById('duplicates-container');
  const summary = document.getElementById('duplicates-summary');
  if (!container) return;

  const all = window._dupPairsAll || [];
  const threshold = window._dupThreshold ?? 0.95;
  const sameFileOnly = !!document.getElementById('dup-same-file-only')?.checked;
  const pairs = sameFileOnly
    ? all.filter(p => p.vol_a === p.vol_b && p.file_a === p.file_b)
    : all;

  const filterNote = sameFileOnly ? ' · só mesmo arquivo' : '';
  summary.textContent = `${pairs.length} par${pairs.length === 1 ? '' : 'es'} ≥ ${threshold.toFixed(2)}${filterNote} (dispensados ocultos)`;

  // Badge sempre reflete o total (sem o filtro) pra ficar estável.
  const badge = document.getElementById('duplicatesTabBadge');
  if (badge) {
    badge.textContent = String(all.length);
    badge.classList.toggle('empty', all.length === 0);
  }

  if (pairs.length === 0) {
    const msg = sameFileOnly
      ? 'Nenhum par intra-arquivo neste threshold. Desmarque o toggle ou reduza o threshold.'
      : 'Nenhum par neste threshold. Tente reduzir ou rodar "Recalcular".';
    container.innerHTML = `<p style="color:var(--text-muted); font-size:0.9rem; padding:20px;">${msg}</p>`;
    window._dupPairs = pairs;
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:80px;">Sim.</th>
          <th>Tópico A</th>
          <th>Tópico B</th>
          <th style="width:140px;"></th>
        </tr>
      </thead>
      <tbody>
        ${pairs.map((p, i) => {
          const sameFile = p.vol_a === p.vol_b && p.file_a === p.file_b;
          const navA = `${VOL_SHORT[p.vol_a] || p.vol_a} · ${_dupEsc(p.file_a)}#${p.topic_idx_a}`;
          const navB = `${VOL_SHORT[p.vol_b] || p.vol_b} · ${_dupEsc(p.file_b)}#${p.topic_idx_b}`;
          const warnA = p.file_topic_count_a > 2 ? ` <span title="arquivo tem ${p.file_topic_count_a} tópicos — apagar inteiro perderia outros" style="color:var(--text-muted); font-size:0.7rem;">(${p.file_topic_count_a})</span>` : '';
          const warnB = p.file_topic_count_b > 2 ? ` <span title="arquivo tem ${p.file_topic_count_b} tópicos — apagar inteiro perderia outros" style="color:var(--text-muted); font-size:0.7rem;">(${p.file_topic_count_b})</span>` : '';
          const sameFileBadge = sameFile ? ` <span title="par dentro do mesmo arquivo" style="color:var(--accent); font-size:0.65rem; font-weight:600; padding:1px 5px; border:1px solid var(--accent); border-radius:3px; vertical-align:middle;">MESMO ARQUIVO</span>` : '';
          return `
            <tr data-pair-idx="${i}">
              <td style="font-variant-numeric:tabular-nums; font-weight:600; color:var(--accent);">${(p.similarity).toFixed(3)}${sameFileBadge}</td>
              <td>
                <div style="font-weight:500;">${_dupEsc(p.title_pt_a || '(sem título)')}</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">${navA}${warnA}</div>
              </td>
              <td>
                <div style="font-weight:500;">${_dupEsc(p.title_pt_b || '(sem título)')}</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">${navB}${warnB}</div>
              </td>
              <td>
                <button class="btn-secondary" style="font-size:0.75rem; padding:4px 10px;" onclick='openDuplicateCompare(${i})'>Comparar</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  window._dupPairs = pairs;
}

async function openDuplicateCompare(idx) {
  const pairs = window._dupPairs || [];
  const p = pairs[idx];
  if (!p) return;

  let modal = document.getElementById('duplicateCompareModal');
  if (!modal) {
    // Estilos injetados uma única vez. Hover/focus + tipografia melhor
    // pro modal de comparação. Usa as variáveis de tema já existentes
    // (--bg, --surface, --border, --text, --text-muted, --accent).
    const style = document.createElement('style');
    style.textContent = `
      /* Cores fixas dentro do modal pra leitura confortável independente
         de tema light/dark — admin precisa de contraste alto pra
         comparar textos lado a lado. */
      .dup-modal-overlay { position:fixed; inset:0; z-index:5000; background:rgba(0,0,0,0.78); display:flex; align-items:center; justify-content:center; padding:24px; backdrop-filter:blur(3px); }
      .dup-modal-card { background:#ffffff; color:#1a1a1a; border:1px solid #e2e2e2; border-radius:14px; max-width:1280px; width:100%; max-height:94vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 30px 80px rgba(0,0,0,0.45); }
      .dup-modal-header { padding:18px 24px; border-bottom:1px solid #e2e2e2; display:flex; align-items:center; gap:14px; flex-wrap:wrap; background:#f7f7f5; }
      .dup-modal-header h2 { margin:0; font-size:0.78rem; font-weight:600; letter-spacing:1.4px; text-transform:uppercase; color:#6a6a6a; }
      .dup-sim-badge { font-size:1.4rem; font-weight:700; color:#b8860b; font-variant-numeric:tabular-nums; line-height:1; }
      .dup-sim-label { font-size:0.7rem; color:#6a6a6a; letter-spacing:1px; text-transform:uppercase; }
      .dup-modal-body { flex:1; overflow:hidden; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:0; min-height:0; background:#ffffff; }
      .dup-side { display:flex; flex-direction:column; min-height:0; padding:22px 24px; background:#ffffff; }
      .dup-side + .dup-side { border-left:1px solid #e2e2e2; }
      .dup-side-label { font-size:0.7rem; font-weight:700; letter-spacing:1.4px; text-transform:uppercase; color:#b8860b; margin-bottom:10px; }
      .dup-side h3 { margin:0 0 10px; font-size:1.15rem; line-height:1.35; font-weight:600; color:#1a1a1a; }
      .dup-side-chips { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
      .dup-chip { font-size:0.7rem; padding:3px 10px; border-radius:999px; background:#f3f3f0; color:#555; border:1px solid #dcdcdc; font-variant-numeric:tabular-nums; }
      .dup-chip--link { cursor:pointer; transition:all 0.15s; text-decoration:none; color:#b8860b; border-color:#b8860b; background:#ffffff; }
      .dup-chip--link:hover { background:#b8860b; color:#ffffff; }
      .dup-content-box { font-size:0.95rem; line-height:1.72; white-space:pre-wrap; color:#222222; background:#fafaf7; padding:18px 20px; border-radius:10px; border:1px solid #e2e2e2; overflow:auto; flex:1; min-height:340px; font-family:'Crimson Pro', Georgia, serif; }
      .dup-modal-footer { padding:14px 24px; border-top:1px solid #e2e2e2; display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; background:#f7f7f5; }
      .dup-modal-footer .hint { font-size:0.75rem; color:#6a6a6a; }
      .dup-modal-footer button { padding:9px 18px; font-size:0.85rem; border-radius:8px; background:#ffffff; color:#1a1a1a; border:1px solid #cccccc; cursor:pointer; transition:all 0.15s; }
      .dup-modal-footer button:hover { background:#f0f0f0; border-color:#999; }
      .dup-modal-header button { background:#ffffff; color:#1a1a1a; border:1px solid #cccccc; cursor:pointer; transition:all 0.15s; border-radius:6px; }
      .dup-modal-header button:hover { background:#f0f0f0; }
      @media (max-width: 900px) {
        .dup-modal-body { grid-template-columns:1fr; overflow:auto; }
        .dup-side + .dup-side { border-left:none; border-top:1px solid var(--border); }
      }
    `;
    document.head.appendChild(style);

    modal = document.createElement('div');
    modal.id = 'duplicateCompareModal';
    modal.className = 'dup-modal-overlay';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="dup-modal-card" role="dialog" aria-modal="true" aria-labelledby="dup-modal-title">
        <div class="dup-modal-header">
          <div style="display:flex; flex-direction:column; gap:2px;">
            <span class="dup-sim-label">Similaridade</span>
            <span class="dup-sim-badge" id="dup-modal-sim"></span>
          </div>
          <h2 id="dup-modal-title">Comparação de tópicos</h2>
          <span id="dup-modal-meta" style="color:var(--text-muted); font-size:0.78rem;"></span>
          <button class="btn-secondary" style="margin-left:auto; padding:7px 14px; font-size:0.82rem;" onclick="closeDuplicateModal()" aria-label="Fechar">Fechar ✕</button>
        </div>
        <div id="dup-modal-body" class="dup-modal-body"></div>
        <div class="dup-modal-footer">
          <span class="hint">Dispensar marca o par como revisado e remove da lista (não apaga conteúdo).</span>
          <button class="btn-secondary" id="dup-modal-dismiss">Dispensar par (manter ambos)</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeDuplicateModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.style.display !== 'none') closeDuplicateModal();
    });
  }

  const renderSide = (sideLetter, vol, file, topicIdx, title, fileCount) => {
    const readerHref = `reader.html?vol=${encodeURIComponent(vol)}&file=${encodeURIComponent(file)}${topicIdx ? '&topic='+topicIdx : ''}`;
    const volLabel = VOL_SHORT[vol] || vol;
    return `
      <div class="dup-side">
        <span class="dup-side-label">Versão ${sideLetter}</span>
        <h3>${_dupEsc(title || '(sem título)')}</h3>
        <div class="dup-side-chips">
          <span class="dup-chip">${volLabel}</span>
          <span class="dup-chip">${_dupEsc(file)}</span>
          <span class="dup-chip">topic ${topicIdx}</span>
          <span class="dup-chip" title="Tópicos totais no arquivo">${fileCount} no arq.</span>
          <a class="dup-chip dup-chip--link" href="${readerHref}" target="_blank" rel="noopener">Abrir no reader ↗</a>
        </div>
        <div class="dup-content-box">Carregando…</div>
      </div>
    `;
  };

  document.getElementById('dup-modal-sim').textContent = (p.similarity).toFixed(3);
  const sameFile = p.vol_a === p.vol_b && p.file_a === p.file_b;
  document.getElementById('dup-modal-meta').textContent =
    sameFile ? '⚠ Mesmo arquivo — dois tópicos repetidos dentro do JSON' : `${p.file_topic_count_a} tópico(s) em A · ${p.file_topic_count_b} em B`;
  document.getElementById('dup-modal-body').innerHTML =
    renderSide('A', p.vol_a, p.file_a, p.topic_idx_a, p.title_pt_a, p.file_topic_count_a) +
    renderSide('B', p.vol_b, p.file_b, p.topic_idx_b, p.title_pt_b, p.file_topic_count_b);
  document.getElementById('dup-modal-dismiss').onclick = () => dismissDuplicate(idx);

  modal.style.display = 'flex';

  // Carrega conteúdos em paralelo.
  const boxes = modal.querySelectorAll('.dup-content-box');
  const [ca, cb] = await Promise.all([
    _fetchTopicContent(p.vol_a, p.file_a, p.topic_idx_a),
    _fetchTopicContent(p.vol_b, p.file_b, p.topic_idx_b),
  ]);
  boxes[0].textContent = ca || '(conteúdo vazio)';
  boxes[1].textContent = cb || '(conteúdo vazio)';
}

function closeDuplicateModal() {
  const m = document.getElementById('duplicateCompareModal');
  if (m) m.style.display = 'none';
}

async function dismissDuplicate(idx) {
  const pairs = window._dupPairs || [];
  const p = pairs[idx];
  if (!p) return;
  const { error } = await supabase.rpc('dismiss_duplicate_pair', {
    p_vol_a: p.vol_a, p_file_a: p.file_a, p_topic_idx_a: p.topic_idx_a,
    p_vol_b: p.vol_b, p_file_b: p.file_b, p_topic_idx_b: p.topic_idx_b,
  });
  if (error) { alert('Erro ao dispensar: ' + error.message); return; }
  closeDuplicateModal();
  loadDuplicates();
}

async function recomputeDuplicates() {
  const btn = document.getElementById('dup-recompute-btn');
  if (!btn) return;
  if (!confirm('Recalcular varre todos os ~17k tópicos. Pode levar 5-20 minutos. Continuar?')) return;
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '↻ Calculando...';
  // RPC tem statement_timeout de 30min, mas PostgREST/Cloudflare corta antes.
  // Em produção, recomendo rodar via SQL Editor do dashboard, ou agendar
  // por pg_cron. Aqui só tentamos uma vez.
  const { data, error } = await supabase.rpc('refresh_duplicate_candidates', {
    threshold_floor: 0.85,
    top_k: 3,
  });
  btn.disabled = false;
  btn.textContent = orig;
  if (error) {
    alert('Erro (provavelmente timeout do HTTP). Considere rodar o script de seed offline. Detalhe: ' + error.message);
    return;
  }
  alert(`Recalculado. ${data} pares inseridos.`);
  loadDuplicates();
}

Object.assign(window, {
  loadDuplicates,
  renderDuplicates,
  openDuplicateCompare,
  closeDuplicateModal,
  dismissDuplicate,
  recomputeDuplicates
});
