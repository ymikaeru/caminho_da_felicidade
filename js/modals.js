// ============================================================
// MODALS — shared modal HTML generation for index.html and reader.html
// ============================================================

function _escModal(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Guarda contra chamadas duplicadas. Algumas páginas (akimaro-kineishu,
// warai-no-izumi, yama-to-mizu) chamam buildSearchModal duas vezes via
// DOMContentLoaded inline em <head> + outro inline em <body> — sem essa
// guarda, ficavam 2 <div id="searchModal"> no DOM, o que em iOS Safari
// quebra focus trap e accessibility tree. Idempotente = safe pra
// chamar quantas vezes quiser.
function _modalExists(id) {
  return !!document.getElementById(id);
}

function buildSearchModal() {
  if (_modalExists('searchModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const placeholder = lang === 'ja' ? '教えを検索...' : 'Buscar nos ensinamentos...';
  const clearLabel = lang === 'ja' ? 'クリア' : 'Limpar busca';
  const clearText = lang === 'ja' ? '消す' : 'Apagar';
  const exactLabel = lang === 'ja' ? '完全一致' : 'Palavra exata';
  const exactTitle = lang === 'ja' ? '単語全体のみを検索' : 'Busca somente palavras inteiras. Ex: \'luz\' não encontrará \'reluz\'';
  const literalLabel = lang === 'ja' ? 'リテラル検索' : 'Texto literal';
  const literalTitle = lang === 'ja' ? '部分一致のみで検索（FTS・意味検索を無効化）' : 'Busca apenas por substring exata (sem FTS nem busca semântica). Útil para termos em japonês ou trechos exatos.';
  const readOnlyLabel = lang === 'ja' ? '既読のみ' : 'Só nos lidos';
  const readOnlyTitle = lang === 'ja'
    ? '「既読」にした教えの中だけを表示（既に検索したものを再検索）'
    : 'Mostra só resultados de Ensinamentos que você já marcou como lido — útil pra reencontrar algo que sabe que já leu.';
  const advancedLabel = lang === 'ja' ? '詳細検索' : 'Avançada';

  const advancedOpen = localStorage.getItem('search_advanced_open') === 'true';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'searchModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', lang === 'ja' ? '教えを検索' : 'Buscar nos ensinamentos');
  el.innerHTML =
    '<div class="search-modal">' +
    '<button class="modal-close-btn" onclick="closeSearch()">&times;</button>' +
    '<div class="search-header">' +
    // Linha única: input + Apagar + Avançada (+ "Selecionar" injetado
    // pelo playlists.js, que ancora na classe .search-advanced-row).
    // Era 2 linhas — header mais baixo = mais espaço pros resultados.
    '<div class="search-input-row search-advanced-row">' +
    '<input type="text" class="search-input" id="searchInput" placeholder="' + placeholder + '" autocomplete="off" inputmode="search" enterkeyhint="search">' +
    '<button id="searchClear" onclick="clearSearch()" style="display: none;" title="' + clearLabel + '">' +
    '<span id="searchClearText">' + clearText + '</span>' +
    '</button>' +
    '<button type="button" id="searchAdvancedToggle" class="search-advanced-btn" aria-expanded="' + (advancedOpen ? 'true' : 'false') + '" aria-controls="searchAdvancedPanel">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>' +
    '</svg>' +
    '<span>' + advancedLabel + '</span>' +
    '<svg class="search-advanced-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="6 9 12 15 18 9"></polyline>' +
    '</svg>' +
    '</button>' +
    '</div>' +
    // Avançada = só modos de match (Palavra exata / Texto literal),
    // que afinam o modo Conteúdo.
    '<div id="searchAdvancedPanel" class="search-filters search-advanced-panel' + (advancedOpen ? ' is-open' : '') + '">' +
    '<label class="filter-label filter-label--toggle" title="' + exactTitle + '">' +
    '<input type="checkbox" id="searchExactToggle">' +
    '<span id="searchExactLabel">' + exactLabel + '</span>' +
    '</label>' +
    '<label class="filter-label filter-label--toggle" title="' + literalTitle + '">' +
    '<input type="checkbox" id="searchLiteralToggle">' +
    '<span id="searchLiteralLabel">' + literalLabel + '</span>' +
    '</label>' +
    // "Só nos lidos": filtra os resultados JÁ trazidos (sem refazer a busca)
    // pra Ensinamentos que o usuário marcou como lido — reencontrar algo que
    // sabe que já leu, mas não lembra onde. Ver search.js (_applyOnlyReadFilter).
    '<label class="filter-label filter-label--toggle" title="' + readOnlyTitle + '">' +
    '<input type="checkbox" id="searchReadOnlyToggle">' +
    '<span id="searchReadOnlyLabel">' + readOnlyLabel + '</span>' +
    '</label>' +
    '</div>' +
    '</div>' +
    // Chips de FILTRO dos resultados (Tudo / Títulos / Coleções / Conteúdo /
    // Relacionados). A busca é uma só; os chips filtram as seções já
    // buscadas. Populado pelo search.js (_renderFilterChips) após cada busca.
    '<div id="searchModeSelector" class="search-mode-selector" role="group" aria-label="' + (lang === 'ja' ? '結果を絞り込む' : 'Filtrar resultados') + '"></div>' +
    '<div id="searchCount" class="search-count"></div>' +
    '<ul class="search-results" id="searchResults" aria-live="polite"></ul>' +
    '</div>';
  document.body.appendChild(el);
}

function buildHistoryModal() {
  if (_modalExists('historyModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? '閲覧履歴' : 'Histórico de Navegação';
  const clearLabel = lang === 'ja' ? 'すべて削除' : 'Limpar Tudo';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'historyModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'historyModalTitle');
  el.innerHTML =
    '<div class="search-modal">' +
    '<button class="modal-close-btn" onclick="closeHistory()">&times;</button>' +
    '<div class="search-header">' +
    '<div style="display: flex; justify-content: space-between; align-items: center;">' +
    '<h2 id="historyModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
    '<button class="btn-zen" id="historyClearAll" onclick="clearAllHistory()" style="padding: 4px 12px; font-size: 0.85rem; display: none;">' + clearLabel + '</button>' +
    '</div>' +
    '</div>' +
    '<ul class="search-results" id="historyResults" aria-live="polite"></ul>' +
    '</div>';
  document.body.appendChild(el);
}

function buildFavoritesModal() {
  if (_modalExists('favoritesModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? '保存した教え' : 'Ensinamentos Salvos';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'favoritesModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'favoritesModalTitle');
  el.innerHTML =
    '<div class="search-modal">' +
    '<button class="modal-close-btn" onclick="closeFavorites()">&times;</button>' +
    '<div class="search-header">' +
    '<h2 id="favoritesModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
    '</div>' +
    '<ul class="search-results" id="favoritesResults" aria-live="polite"></ul>' +
    '</div>';
  document.body.appendChild(el);
}

function buildRecommendationsModal() {
  if (_modalExists('recommendationsModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? '学習のおすすめ' : 'Recomendações para Estudo';
  const manageLabel = lang === 'ja' ? 'すべて管理 →' : 'Gerenciar todas →';
  // Caminho relativo pra recomendacoes.html — sob /mioshiec*/ precisa ../
  const basePath = window.location.pathname.includes('/mioshiec') ? '../' : '';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'recommendationsModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'recommendationsModalTitle');
  el.innerHTML =
    '<div class="search-modal">' +
    '<button class="modal-close-btn" onclick="closeRecommendations()">&times;</button>' +
    '<div class="search-header">' +
    '<h2 id="recommendationsModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
    '</div>' +
    '<ul class="search-results" id="recommendationsResults" aria-live="polite"></ul>' +
    '<div id="rec-audio-footer" style="display:none;"></div>' +
    '<div style="padding: 14px 18px; border-top: 1px solid var(--border); text-align: right;">' +
    '<a href="' + basePath + 'recomendacoes.html" style="font-size: 0.85rem; color: var(--accent); text-decoration: none; font-weight: 500;">' + manageLabel + '</a>' +
    '</div>' +
    '</div>';
  document.body.appendChild(el);
}

function buildHighlightsModal() {
  if (_modalExists('highlightsModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? 'ハイライト一覧' : 'Meus Destaques';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'highlightsModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'highlightsModalTitle');
  el.innerHTML =
    '<div class="search-modal">' +
    '<button class="modal-close-btn" onclick="closeHighlights()">&times;</button>' +
    '<div class="search-header">' +
    '<h2 id="highlightsModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
    '</div>' +
    '<ul class="search-results highlights-modal-list" id="highlightsResults" aria-live="polite"></ul>' +
    '</div>';
  document.body.appendChild(el);
}

// Compositor "Compartilhar com o Reverendo" — usado por study-messages.js.
// Lazy-built no primeiro openShareWithReverendo(). O título do ensinamento
// (#shareTeachingTitle) é preenchido via textContent pelo JS.
function buildShareModal() {
  if (_modalExists('shareModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? 'ご住職に共有' : 'Compartilhar com o Reverendo';
  const aboutLabel = lang === 'ja' ? 'この御教えについて' : 'Sobre este Ensinamento';
  const placeholder = lang === 'ja'
    ? 'ご住職へのご感想やご質問をお書きください...'
    : 'Escreva sua reflexão ou pergunta ao Reverendo...';
  const guideline = lang === 'ja'
    ? 'メッセージは非公開です（ご住職のみが見ます）。敬意と向上の心で書いてください。'
    : 'Sua mensagem é privada — só o Reverendo vê. Escreva com respeito e espírito de edificação.';
  const cancelLabel = lang === 'ja' ? 'キャンセル' : 'Cancelar';
  const sendLabel = lang === 'ja' ? '送信' : 'Enviar';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'shareModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'shareModalTitle');
  el.innerHTML =
    '<div class="search-modal" style="max-width:560px;">' +
    '<button class="modal-close-btn" onclick="closeShareModal()">&times;</button>' +
    '<div class="search-header">' +
    '<h2 id="shareModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
    '</div>' +
    '<div style="padding: 4px 24px 24px;">' +
    '<div style="font-size:0.66rem; text-transform:uppercase; letter-spacing:.1em; color:var(--text-muted); font-weight:600; margin-bottom:6px; font-family:var(--font-ui);">' + aboutLabel + '</div>' +
    '<div id="shareTeachingTitle" style="font-family:\'Crimson Pro\',Georgia,serif; font-size:1.1rem; font-weight:600; color:var(--text-main); line-height:1.3; margin-bottom:16px;"></div>' +
    '<textarea id="shareBody" rows="5" placeholder="' + placeholder + '" style="width:100%; padding:12px 14px; font-size:0.95rem; border:1px solid var(--border); border-radius:6px; resize:vertical; font-family:inherit; background:var(--bg,#fff); color:inherit; box-sizing:border-box;"></textarea>' +
    '<div style="font-size:0.72rem; color:var(--text-muted); margin-top:8px; line-height:1.5;">' + guideline + '</div>' +
    '<div id="shareMsg" style="font-size:0.82rem; min-height:1.2em; margin-top:8px;"></div>' +
    '<div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px;">' +
    '<button onclick="closeShareModal()" style="padding:8px 16px; font-size:0.85rem; background:none; border:1px solid var(--border); border-radius:6px; cursor:pointer; color:inherit;">' + cancelLabel + '</button>' +
    '<button id="shareSubmit" onclick="submitShareWithReverendo()" style="padding:8px 20px; font-size:0.85rem; background:var(--accent); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">' + sendLabel + '</button>' +
    '</div>' +
    '</div>' +
    '</div>';
  document.body.appendChild(el);
}

// "Minhas conversas com o Reverendo" — lista enviadas + respostas.
// Lazy-built no primeiro openMyConversations(); preenchido por study-messages.js.
function buildMyConversationsModal() {
  if (_modalExists('myConversationsModal')) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const title = lang === 'ja' ? 'ご住職との会話' : 'Minhas conversas com o Reverendo';

  const el = document.createElement('div');
  el.className = 'search-modal-overlay';
  el.id = 'myConversationsModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'myConversationsModalTitle');
  el.innerHTML =
    '<div class="search-modal">' +
    '<button class="modal-close-btn" onclick="closeMyConversations()">&times;</button>' +
    '<div class="search-header">' +
    '<h2 id="myConversationsModalTitle" style="font-size: 1.2rem; margin:0; color: var(--accent);">' + title + '</h2>' +
    '</div>' +
    '<ul class="search-results" id="myConversationsResults" aria-live="polite"></ul>' +
    '</div>';
  document.body.appendChild(el);
}

window.buildSearchModal = buildSearchModal;
window.buildHistoryModal = buildHistoryModal;
window.buildFavoritesModal = buildFavoritesModal;
window.buildHighlightsModal = buildHighlightsModal;
window.buildRecommendationsModal = buildRecommendationsModal;
window.buildShareModal = buildShareModal;
window.buildMyConversationsModal = buildMyConversationsModal;

// ============================================================
// Modal de Descoberta — "Descobrir um Ensinamento"
// ============================================================
// Antes, o botão de descoberta NAVEGAVA: saía da página, carregava o leitor
// inteiro e largava a pessoa num Ensinamento. Se não era o que ela queria,
// pagou uma navegação completa pra descobrir — e ninguém repete isso três
// vezes. Aqui ela espia e fecha; o custo de tentar cai a quase zero, que é o
// que permite virar hábito.
//
// Base: "é bom ler repetidas vezes até que seja assimilado no íntimo"
// (大いに神書を読むべし, 29/11/1950). Daí o filtro "só os que já li" e o
// convite a reler em vez de aviso pra pular.
//
// Próximo/Anterior percorrem os SORTEIOS, não os vizinhos do livro — o leitor
// já navega a publicação no rodapé. Sobre os sorteios não havia nada: um
// Ensinamento interessante que passava sumia pra sempre.
(function () {
  let _dHist = [];   // cartas já sorteadas nesta abertura
  let _dPos = -1;    // posição atual dentro de _dHist
  let _dVol = null;  // filtro de volume (null = acervo inteiro)
  // Geração do sorteio em vez de um "ocupado" que descarta cliques: trocar de
  // filtro no meio de uma consulta ANTES não fazia nada (a guarda engolia o
  // pedido e a pessoa continuava vendo o resultado velho, achando que quebrou).
  // Agora o pedido novo sempre vale, e a resposta atrasada do anterior é
  // descartada por não ser mais a geração corrente.
  let _dGen = 0;

  const _dLang = () => localStorage.getItem('site_lang') || 'pt';
  const _dSupa = () => (window.supabaseAuth && window.supabaseAuth.supabase)
      || window._supabaseClient || null;
  const _dBase = () => (window.location.pathname.includes('/mioshiec') ? '../' : './');

  // Telemetria do recurso. Sem isto não há como saber se ele mudou algum
  // comportamento: o clique vira um pageview de leitor indistinguível de quem
  // veio pela busca. Fire-and-forget — falhar aqui NUNCA pode atrapalhar quem
  // está lendo.
  let _dAuth = null; // { url, key, token, userId } — resolvido ao abrir o modal

  async function _dPrimeAuth() {
    try {
      const supa = _dSupa();
      if (!supa) { _dAuth = null; return; }
      const { data } = await supa.auth.getSession();
      if (!data || !data.session) { _dAuth = null; return; }
      _dAuth = {
        url: supa.supabaseUrl, key: supa.supabaseKey,
        token: data.session.access_token, userId: data.session.user.id
      };
    } catch (_) { _dAuth = null; }
  }

  function _dLog(action, c) {
    if (!_dAuth || !_dAuth.url) return;
    const row = { user_id: _dAuth.userId, action, only_vol: _dVol };
    if (c) { row.vol = _dVolOf(c); row.file = _dFileOf(c); row.topic_index = _dTopicOf(c); }
    try {
      // keepalive: o 'read' dispara junto com a navegação pro leitor; sem isto
      // o navegador aborta a requisição no unload e o evento se perde —
      // justamente o que mede se a descoberta virou leitura.
      fetch(_dAuth.url + '/rest/v1/discovery_events', {
        method: 'POST', keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: _dAuth.key,
          Authorization: 'Bearer ' + _dAuth.token,
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(row)
      }).catch(() => {});
    } catch (_) {}
  }

  const D = {
    pt: {
      title: 'Descobrir um Ensinamento', prev: '← Anterior', next: 'Próximo →',
      open: 'Abrir o Ensinamento', save: 'Guardar pra depois', saved: '✓ Guardado',
      reread: 'você já leu — vale reler', from: 'Descobrir em:', all: 'Todo o acervo',
      loading: 'Um momento…', poetry: 'Poesia',
      openPoem: 'Ler no leitor',
      // Na ponta do histórico o botão traz um Ensinamento novo; só no meio ele
      // avança pelo que já passou. "Próximo" nos dois casos escondia a ação
      // principal do recurso atrás de um rótulo de paginação.
      //
      // "Descobrir outro", e não "Sortear outro": o verbo é o mesmo do nome do
      // recurso e do título do modal, e o que está do outro lado do toque é um
      // Ensinamento de Meishu-Sama — sorteio é palavra de rifa.
      drawNext: 'Descobrir outro',
      hintPrev: 'Atalho: seta ←', hintNext: 'Atalho: seta →',
      savedIn: (p) => '✓ Guardado em Salvos › ' + p,
      savedNoFolder: '✓ Guardado em Salvos', folderName: 'Para ler depois',
      savedHint: 'Guardado — toque para remover',
      showPath: 'toque para ver onde fica',
      empty: 'Nenhum Ensinamento encontrado com esse filtro.',
      noSession: 'Sua sessão expirou. Entre novamente para descobrir um Ensinamento.',
      // Mesma razão do rótulo do botão: quem falhou aqui não estava sorteando.
      failed: 'Não foi possível carregar agora. Tente de novo.'
    },
    ja: {
      title: '御縁の御教え', prev: '← 前へ', next: '次へ →',
      open: '御教えを開く', save: 'あとで読む', saved: '✓ 保存しました',
      reread: '拝読済み — 繰り返し拝読を', from: '範囲:', all: '全巻',
      loading: 'お待ちください…', poetry: '御歌',
      openPoem: '読む',
      // 引く é o verbo de tirar omikuji — mesmo problema do "sortear". 御縁
      // ecoa o título do modal (御縁の御教え).
      drawNext: 'もう一つの御縁',
      hintPrev: 'ショートカット: ←キー', hintNext: 'ショートカット: →キー',
      savedIn: (p) => '✓ 保存したもの › ' + p,
      savedNoFolder: '✓ 保存しました', folderName: 'あとで読む',
      savedHint: '保存済み — タップで削除',
      showPath: 'タップで場所を確認',
      empty: 'この条件では御教えが見つかりませんでした。',
      noSession: 'セッションが切れました。もう一度ログインしてください。',
      failed: '選べませんでした。もう一度お試しください。'
    }
  };
  const _dT = () => D[_dLang()] || D.pt;

  // Só o Vol. 4 encurta: "Ensinamentos Diversos" quebrava a barra de filtros
  // pra uma segunda linha sozinho. Os demais já cabem.
  const CHIP_CURTO = { pt: { 4: 'Diversos' }, ja: { 4: 'その他' } };

  // Subtítulos dos cards de volume da home (.topic-card__tagline). No título
  // do chip eles dizem o QUE se vai encontrar ali — "Mundo Espiritual" nomeia,
  // "Revelações Sagradas" descreve. Vale sobretudo pro Vol. 4, cujo chip
  // aparece encurtado.
  const VOL_TAGLINE = {
    pt: { 1: 'Revelações Sagradas', 2: 'Em Serviço ao Próximo',
          3: 'Polimento da Alma',   4: 'Estudo Complementar' },
    ja: { 1: '神聖な啓示', 2: '隣人への奉仕',
          3: '魂の研磨', 4: '補足の学び' }
  };

  // Corta no último espaço pra não partir palavra ao meio.
  function _dTrim(s, max) {
    s = String(s || '').trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + '…';
  }

  // Volume sempre; seção só onde GLOBAL_INDEX_TITLES está carregado (reader).
  function _dOrigin(card) {
    const ja = _dLang() === 'ja';
    if (_dIsPoem(card)) return card.col || (ja ? '御歌' : 'Poesia');
    const n = parseInt(String(card.vol).replace('mioshiec', ''), 10);
    const subs = window.VOL_SUBTITLES || { pt: {}, ja: {} };
    const volName = (ja ? subs.ja : subs.pt)[n] || card.vol;
    const parts = [ja ? ('第' + n + '巻') : ('Vol. ' + n), volName];
    const gi = window.GLOBAL_INDEX_TITLES && window.GLOBAL_INDEX_TITLES[card.vol + '/' + card.file];
    const sec = gi && (ja ? gi.sectionJa : gi.section);
    if (sec) parts.push(sec);
    return parts.join(' · ');
  }

  function buildDiscoveryModal() {
    if (_modalExists('discoveryModal')) return;
    const t = _dT();
    const el = document.createElement('div');
    el.className = 'search-modal-overlay';
    el.id = 'discoveryModal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'discoveryModalTitle');
    el.innerHTML =
      '<div class="search-modal disc-modal">' +
      '<button class="modal-close-btn" onclick="closeDiscovery()" aria-label="Fechar">&times;</button>' +
      '<div class="search-header">' +
      '<h2 id="discoveryModalTitle" class="disc-kicker">' + _escModal(t.title) + '</h2>' +
      '</div>' +
      '<div class="disc-filters" id="discFilters"></div>' +
      '<div class="disc-card" id="discCard" aria-live="polite"></div>' +
      '<div class="disc-actions" id="discActions"></div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) window.closeDiscovery(); });
  }

  function _dRenderFilters() {
    const box = document.getElementById('discFilters');
    if (!box) return;
    const t = _dT(), ja = _dLang() === 'ja';
    const subs = window.VOL_SUBTITLES || { pt: {}, ja: {} };
    let html = '<span class="disc-filters__label">' + _escModal(t.from) + '</span>';
    html += '<button type="button" class="disc-chip' + (_dVol === null ? ' is-on' : '') +
            '" data-vol="">' + _escModal(t.all) + '</button>';
    for (let n = 1; n <= 4; n++) {
      const v = 'mioshiec' + n;
      // Nome curto só no chip, pra a barra caber numa linha. O nome completo
      // continua na linha de origem do cartão, logo acima do título — e o
      // title= dá o inteiro a quem passar o mouse.
      const nmCheio = (ja ? subs.ja : subs.pt)[n] || v;
      const nm = CHIP_CURTO[ja ? 'ja' : 'pt'][n] || nmCheio;
      // Só o subtítulo: o nome do volume já está escrito no próprio chip,
      // repeti-lo na dica seria eco. A exceção é o Vol. 4, que aparece
      // encurtado — por isso a dica dele traz o nome inteiro também.
      const tag = VOL_TAGLINE[ja ? 'ja' : 'pt'][n];
      const encurtado = !!CHIP_CURTO[ja ? 'ja' : 'pt'][n];
      const dica = !tag ? nmCheio
                 : (encurtado ? nmCheio + (ja ? '―' : ' — ') + tag : tag);
      html += '<button type="button" class="disc-chip' + (_dVol === v ? ' is-on' : '') +
              '" data-vol="' + v + '" title="' + _escModal(dica) + '">' +
              _escModal(nm) + '</button>';
    }
    // Chip de Poesia retirado por ora. O caminho continua INTEIRO e testado
    // (pool, sorteio, render do waka, identidade do favorito) — openDiscovery('poetry')
    // funciona; falta só o botão. Pra reativar, devolva esta linha:
    //   html += '<button type="button" class="disc-chip' + (_dVol === 'poetry' ? ' is-on' : '') +
    //           '" data-vol="poetry">' + _escModal(t.poetry) + '</button>';
    box.innerHTML = html;
    box.querySelectorAll('[data-vol]').forEach(b => b.addEventListener('click', () => {
      _dVol = b.dataset.vol || null;
      _dRenderFilters();
      _dDraw(true);
    }));
  }

  let _dPoolPromise = null;
  let _dLastPoem = -1;

  function _dPoems() {
    if (!_dPoolPromise) {
      // Mesmo arquivo que o "Poema do Momento" da home já usa — nada novo pra
      // manter, e o navegador provavelmente já tem em cache.
      _dPoolPromise = fetch(_dBase() + 'data/poetry/poetry_pool.json?v=2')
        .then(r => r.json())
        .then(j => (j && j.poems) || [])
        .catch(() => []);
    }
    return _dPoolPromise;
  }

  async function _dPickPoem() {
    const poems = await _dPoems();
    if (!poems.length) return null;
    let i;
    do { i = Math.floor(Math.random() * poems.length); }
    while (poems.length > 1 && i === _dLastPoem);
    _dLastPoem = i;
    return Object.assign({ kind: 'poetry' }, poems[i]);
  }

  // Navegar pelos sorteios. Mesmas funções pro clique e pras setas do teclado —
  // duplicar a regra do "na ponta sorteia" nos dois lugares é como ela sai de
  // sincronia.
  const _dNaPonta = () => _dPos >= _dHist.length - 1;

  function _dGoPrev() {
    if (_dPos > 0) { _dPos--; _dRender(); }
  }

  function _dGoNext() {
    if (!_dNaPonta()) { _dPos++; _dRender(); } else { _dDraw(false); }
  }

  function _dMessage(msg) {
    const card = document.getElementById('discCard');
    const acts = document.getElementById('discActions');
    if (card) card.innerHTML = '<p class="disc-msg">' + _escModal(msg) + '</p>';
    if (acts) acts.innerHTML = '';
  }

  function _dRender() {
    const card = document.getElementById('discCard');
    const acts = document.getElementById('discActions');
    if (!card || !acts) return;
    const t = _dT(), ja = _dLang() === 'ja';
    const c = _dHist[_dPos];
    if (!c) return;

    let href;
    if (_dIsPoem(c)) {
      // O poema é curto: cabe INTEIRO. Cortá-lo em "trecho" seria mutilar a
      // forma — waka não tem primeiras linhas, tem cinco versos.
      card.innerHTML =
        '<p class="disc-origin">' + _escModal(_dOrigin(c)) + '</p>' +
        (c.t ? '<h3 class="disc-title">' + _escModal(c.t) + '</h3>' : '') +
        '<p class="disc-poem-jp">' + _escModal(c.jp || '') + '</p>' +
        (c.rj ? '<p class="disc-poem-rj">' + _escModal(c.rj) + '</p>' : '') +
        '<p class="disc-poem-pt">' + _escModal(c.pt || '') + '</p>';
      href = _dBase() + String(c.u || 'poesia.html') + '?poem=' + encodeURIComponent(c.id || '');
    } else {
      const title = _escModal((ja ? (c.title_ja || c.title_pt) : (c.title_pt || c.title_ja)) || '');
      const raw = ja ? (c.excerpt_ja || c.excerpt_pt) : (c.excerpt_pt || c.excerpt_ja);
      // A RPC devolve até 900 (PT) / 400 (JA); cortamos abaixo disso pra sobrar
      // margem pro "…". O cartão tem piso de altura pra não pular de tamanho a
      // cada "Próximo" — com o trecho neste tamanho, o piso quase nunca manda.
      const excerpt = _escModal(_dTrim(raw, ja ? 340 : 780));

      card.innerHTML =
        '<p class="disc-origin">' + _escModal(_dOrigin(c)) + '</p>' +
        '<h3 class="disc-title">' + title + '</h3>' +
        (c.already_read ? '<p class="disc-reread">' + _escModal(t.reread) + '</p>' : '') +
        '<p class="disc-excerpt">' + excerpt + '</p>';

      const topic = c.topic_idx != null ? c.topic_idx : 0;
      href = _dBase() + 'reader.html?vol=' + encodeURIComponent(c.vol) +
             '&file=' + encodeURIComponent(c.file);
      if (topic > 0) href += '&topic=' + topic;
      if (ja) href += '&lang=ja';
    }

    acts.innerHTML =
      '<div class="disc-actions__main">' +
      '<a class="disc-btn disc-btn--primary" href="' + _escModal(href) + '">' +
        _escModal(_dIsPoem(c) ? t.openPoem : t.open) + '</a>' +
      '<button type="button" class="disc-btn disc-btn--ghost" id="discSave">' + _escModal(t.save) + '</button>' +
      '</div>' +
      '<div class="disc-actions__nav">' +
      '<button type="button" class="disc-nav" id="discPrev" title="' + _escModal(t.hintPrev) + '"' +
        (_dPos <= 0 ? ' disabled' : '') + '>' + _escModal(t.prev) + '</button>' +
      // O rótulo diz o que o botão FAZ agora: na ponta ele sorteia, no meio do
      // histórico só avança pelo que já passou.
      '<button type="button" class="disc-nav" id="discNext" title="' + _escModal(t.hintNext) + '">' +
        _escModal(_dNaPonta() ? t.drawNext + ' →' : t.next) + '</button>' +
      '</div>';

    document.getElementById('discPrev').addEventListener('click', _dGoPrev);
    document.getElementById('discNext').addEventListener('click', _dGoNext);
    const openLink = acts.querySelector('.disc-btn--primary');
    if (openLink) openLink.addEventListener('click', () => _dLog('read', c));

    const saveBtn = document.getElementById('discSave');
    _dPaintSaveBtn(saveBtn, _dIsSaved(c));
    saveBtn.addEventListener('click', (e) => _dSave(e.currentTarget, c));
    // (a confirmação de "guardado" morre junto com o innerHTML de #discActions
    //  a cada re-render, então não precisa de limpeza explícita)
  }

  // Pasta "Para ler depois": o que sai da descoberta é material que a pessoa
  // AINDA NÃO leu — misturar com os salvos temáticos (que ela escolheu por
  // importância) apagaria essa diferença. Criada sob demanda, uma vez só.
  const DISC_FOLDER = { pt: 'Para ler depois', ja: 'あとで読む' };
  const DISC_FOLDER_COLOR = '#3a6ea5';

  async function _dFolderId() {
    const cs = window._cloudSync;
    if (!cs || !cs.loadFolders || !cs.upsertFolder) return null;
    try {
      const folders = await cs.loadFolders();
      // Procura pelos DOIS nomes: quem alterna PT/JA não pode acabar com duas
      // pastas de mesma função.
      const alvos = [DISC_FOLDER.pt, DISC_FOLDER.ja].map(n => n.toLowerCase());
      const achada = (folders || []).find(
        f => alvos.includes(String(f.name || '').trim().toLowerCase()));
      if (achada) return achada.id;

      const nova = {
        id: (crypto.randomUUID ? crypto.randomUUID()
             : 'f-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
        name: DISC_FOLDER[_dLang()] || DISC_FOLDER.pt,
        color: DISC_FOLDER_COLOR,
        pos: (folders || []).length
      };
      await cs.upsertFolder(nova);
      // Espelha no cache local, senão a pasta só apareceria na Central depois
      // do próximo pull da nuvem.
      try {
        const locais = JSON.parse(localStorage.getItem('favoriteFolders') || '[]');
        if (!locais.some(f => f.id === nova.id)) {
          locais.push({ ...nova, time: Date.now() });
          localStorage.setItem('favoriteFolders', JSON.stringify(locais));
        }
      } catch (_) {}
      return nova.id;
    } catch (e) {
      console.warn('[descobrir] pasta "Para ler depois":', e);
      return null; // guardar não pode falhar por causa da pasta
    }
  }

  // Poesia entra no mesmo baralho, mas tem identidade própria: os favoritos
  // de poema usam vol='poetry', file=SLUG da coletânea e topic=número do poema
  // (é assim que salvos.html remonta o deep-link ?poem=). Sem respeitar isso,
  // o poema guardado aqui não apareceria direito na Central.
  const _dIsPoem = (c) => !!(c && c.kind === 'poetry');
  const _dPoemNum = (c) => { const m = /(\d+)\s*$/.exec(String(c.id || '')); return m ? parseInt(m[1], 10) : 0; };
  const _dVolOf  = (c) => (_dIsPoem(c) ? 'poetry' : c.vol);
  const _dFileOf = (c) => (_dIsPoem(c) ? String(c.u || '').replace(/\.html$/, '') : c.file);
  const _dTopicOf = (c) => (_dIsPoem(c) ? _dPoemNum(c) : (c.topic_idx != null ? c.topic_idx : 0));

  function _dIsSaved(c) {
    try {
      const topic = _dTopicOf(c);
      const vol = _dVolOf(c), file = _dFileOf(c);
      return JSON.parse(localStorage.getItem('savedFavorites') || '[]')
        .some(f => f.vol === vol && f.file === file && (f.topic || 0) === topic);
    } catch (_) { return false; }
  }

  // Reflete o estado real do botão. Chamado no render também, senão voltar pelo
  // "Anterior" a um Ensinamento já guardado mostraria "Guardar pra depois" —
  // e um segundo toque criaria a impressão de que não tinha salvado.
  function _dPaintSaveBtn(btn, saved) {
    const t = _dT();
    btn.textContent = saved ? t.saved : t.save;
    btn.title = saved ? t.savedHint : '';
    btn.classList.toggle('is-saved', saved);
  }

  function _dClearSavedMsg() {
    const msg = document.querySelector('#discActions .disc-saved');
    if (msg) msg.remove();
  }

  // Desfazer: tira dos Salvos o que acabou de entrar (toque errado, ou mudou
  // de ideia). Mesmo botão, sem esconder nada — quem guardou sem querer não
  // precisa ir até a Central pra corrigir.
  function _dUnsave(btn, c) {
    const topic = _dTopicOf(c);
    try {
      const favs = JSON.parse(localStorage.getItem('savedFavorites') || '[]')
        .filter(f => !(f.vol === c.vol && f.file === c.file && (f.topic || 0) === topic));
      localStorage.setItem('savedFavorites', JSON.stringify(favs));
    } catch (_) {}
    if (window._cloudSync && window._cloudSync.removeFavorite) {
      Promise.resolve(window._cloudSync.removeFavorite(c.vol, c.file, topic))
        .catch(err => console.warn('[descobrir] remover falhou:', err));
    }
    _dClearSavedMsg();
    _dPaintSaveBtn(btn, false);
    _dLog('unsave', c);
  }

  // Mostrar o CAMINHO, não levar até lá: para quem tem dificuldade de navegar,
  // aprender que "Salvos" fica no menu vale mais do que ser transportado uma
  // vez. Fecha o modal antes por necessidade real — ele é a camada mais alta
  // da página (z-index 99999 contra 9000 do menu), então o menu abriria ATRÁS
  // e ninguém veria nada.
  function _dShowWhere() {
    window.closeDiscovery();
    if (typeof window.openMobileNav !== 'function') return;
    window.openMobileNav();
    setTimeout(() => {
      const alvo = document.getElementById('mobileNavLinkFavorites');
      if (!alvo) return;
      alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
      alvo.classList.add('nav-pulse-hint');
      setTimeout(() => alvo.classList.remove('nav-pulse-hint'), 3200);
    }, 260); // espera a animação de abertura do menu assentar
  }

  async function _dSave(btn, c) {
    const t = _dT();
    if (_dIsSaved(c)) { _dUnsave(btn, c); return; }
    _dPaintSaveBtn(btn, true);
    const title = (_dLang() === 'ja' ? (c.title_ja || c.title_pt) : (c.title_pt || c.title_ja)) || '';
    const topic = _dTopicOf(c);
    const snippet = _dTrim(c.excerpt_pt || c.excerpt_ja || '', 120);
    // MESMO formato que o botão de salvar do leitor grava (js/reader.js), senão
    // o card sai diferente na Central de Salvos e no modal de Favoritos.
    // `title` lá é o título da PUBLICAÇÃO; aqui só temos o do Ensinamento, que
    // é a melhor aproximação disponível. `totalTopics` a RPC não devolve.
    const folderId = await _dFolderId();
    try {
      const favs = JSON.parse(localStorage.getItem('savedFavorites') || '[]');
      if (!favs.some(f => f.vol === c.vol && f.file === c.file && (f.topic || 0) === topic)) {
        favs.unshift({
          title, vol: c.vol, file: c.file, time: Date.now(),
          topic, topicTitle: title, snippet, totalTopics: null, folderId
        });
        localStorage.setItem('savedFavorites', JSON.stringify(favs));
      }
    } catch (_) {}
    if (window._cloudSync && window._cloudSync.saveFavorite) {
      // Assinatura: (volume, file, topicIndex, topicTitle, snippet, totalTopics, folderId)
      Promise.resolve(window._cloudSync.saveFavorite(
          c.vol, c.file, topic, title, snippet, null, folderId))
        .catch(err => console.warn('[descobrir] guardar falhou:', err));
    }

    // Dizer ONDE foi guardado, com caminho até lá. Sem isto, "✓ Guardado" deixa
    // a pessoa sem saber onde procurar depois — e o link vai direto pra pasta,
    // não pra lista geral.
    const acts = document.getElementById('discActions');
    if (acts && !acts.querySelector('.disc-saved')) {
      const p = document.createElement('p');
      p.className = 'disc-saved';
      p.setAttribute('role', 'status');
      // Sem link: seguir um levaria a pessoa PRA FORA do modal, que é
      // exatamente o que ele existe pra evitar. A mensagem só ensina o
      // caminho; ela vai lá quando quiser, pelo menu.
      p.innerHTML = '<span>' + _escModal(folderId ? t.savedIn(t.folderName) : t.savedNoFolder) + '</span>' +
                    '<button type="button" class="disc-saved__where">' + _escModal(t.showPath) + '</button>';
      p.querySelector('.disc-saved__where').addEventListener('click', _dShowWhere);
      acts.appendChild(p);
    }
    _dLog('save', c);
  }

  // reset=true recomeça o histórico (mudou o filtro); false empilha.
  async function _dDraw(reset) {
    const gen = ++_dGen;
    const t = _dT();
    if (reset) { _dHist = []; _dPos = -1; }
    _dMessage(t.loading);

    // Poesia não passa pelo banco: o pool é um JSON estático que a home já
    // carrega. Sem RPC e sem sessão — mais rápido e sem custo no Supabase.
    if (_dVol === 'poetry') {
      try {
        const poema = await _dPickPoem();
        if (gen !== _dGen) return;                    // filtro mudou no meio
        if (!poema) { _dMessage(t.empty); return; }
        _dHist.push(poema);
        _dPos = _dHist.length - 1;
        _dLog('draw', poema);
        _dRender();
      } catch (err) {
        if (gen !== _dGen) return;
        console.warn('[descobrir] poesia:', err);
        _dMessage(t.failed);
      }
      return;
    }

    try {
      const supabase = _dSupa();
      if (!supabase) { _dMessage(t.noSession); return; }

      // Sessão ANTES da RPC: o grant é só pra authenticated, e sem sessão ela
      // devolve [] SEM erro. getSession() ainda renova access token vencido.
      let hasSession = false;
      try {
        const { data: s } = await supabase.auth.getSession();
        hasSession = !!(s && s.session);
      } catch (_) {}
      if (!hasSession) {
        _dMessage(t.noSession);
        if (!document.getElementById('login-overlay')
            && window.supabaseAuth && typeof window.supabaseAuth.showLoginOverlay === 'function') {
          window.supabaseAuth.showLoginOverlay();
        }
        return;
      }

      // only_read continua existindo na RPC (preferência pelo não lido +
      // modo releitura), só não tem controle na tela.
      const { data, error } = await supabase.rpc('random_teaching_card', {
        only_vol: _dVol, only_read: false
      });
      if (gen !== _dGen) return;                      // filtro mudou no meio
      if (error) { console.warn('random_teaching_card:', error); _dMessage(t.failed); return; }
      if (!data || !data.length) { _dMessage(t.empty); return; }

      _dHist.push(data[0]);
      _dPos = _dHist.length - 1;
      _dLog('draw', data[0]);
      _dRender();
    } catch (err) {
      if (gen !== _dGen) return;
      console.warn('[descobrir] falhou:', err);
      _dMessage(_dT().failed);
    }
  }

  window.openDiscovery = function (vol) {
    buildDiscoveryModal();
    const modal = document.getElementById('discoveryModal');
    if (!modal) return;
    _dVol = vol || null;
    // O título é escrito na CONSTRUÇÃO, que acontece uma vez só: sem isto ele
    // congela no idioma daquele momento e não acompanha o toggle PT/JA (o
    // resto re-renderiza a cada sorteio, por isso só ele ficava para trás).
    const titleEl = document.getElementById('discoveryModalTitle');
    if (titleEl) titleEl.textContent = _dT().title;
    if (!modal.classList.contains('active') && window.__lockBodyScroll) window.__lockBodyScroll();
    modal.classList.add('active');
    _dRenderFilters();
    _dPrimeAuth().then(() => _dLog('open', null));
    _dDraw(true);
  };

  window.closeDiscovery = function () {
    const modal = document.getElementById('discoveryModal');
    if (!modal) return;
    const wasOpen = modal.classList.contains('active');
    modal.classList.remove('active');
    if (wasOpen && window.__unlockBodyScroll) window.__unlockBodyScroll();
  };

  // Teclado: Esc fecha; ←/→ percorrem os sorteios. No desktop a mão já está no
  // teclado e passar de um Ensinamento a outro é o gesto que mais se repete —
  // obrigar a mirar num botão a cada carta é o que faz o recurso cansar antes
  // de virar hábito.
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('discoveryModal');
    if (!modal || !modal.classList.contains('active')) return;
    if (e.key === 'Escape') { window.closeDiscovery(); return; }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Não sequestra as setas de quem está digitando (o modal não tem campo,
    // mas o handler é global e outra caixa pode estar por cima).
    const alvo = e.target;
    if (alvo && (/^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName) || alvo.isContentEditable)) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); _dGoPrev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); _dGoNext(); }
  });

  window.buildDiscoveryModal = buildDiscoveryModal;
})();

// ============================================================
// Novidades — aviso único sobre as mudanças recentes
// ============================================================
// Aparece UMA vez, na home, e some pra sempre. Existe porque duas coisas que
// as pessoas já usavam mudaram de comportamento: o botão de descoberta deixou
// de navegar e passou a abrir um cartão, e "marcar como lido" virou contador
// de leituras. Mudança silenciosa em gesto conhecido confunde mais do que
// recurso novo.
//
// A flag tem VERSÃO no nome: a próxima leva de novidades usa outra chave e
// aparece de novo, sem precisar limpar nada de ninguém.
(function () {
  const FLAG = 'cdf_novidades_v1';

  const N = {
    pt: {
      kicker: 'Duas mudanças recentes',
      itens: [
        ['Descobrir um Ensinamento',
         'O botão do topo passou a apresentar o Ensinamento aqui mesmo — título e ' +
         'primeiras linhas — de modo que se possa conhecê-lo antes de abri-lo. ' +
         'As Obras Poéticas também podem vir na descoberta.'],
        ['Registrar leitura',
         '“Marcar como lido” deu lugar a “Registrar leitura”, e agora cada leitura é ' +
         'contada. A releitura é parte do caminho: “convém ler repetidas e repetidas vezes, ' +
         'até que o Ensinamento penetre no íntimo”.']
      ],
      ok: 'Entendi'
    },
    ja: {
      kicker: '変わったこと',
      itens: [
        ['御縁の御教え',
         '上部のボタンは、ページを離れずにその場で御教えのカードを開くようになりました。' +
         '目を通してから、読みたいときだけ開けます。'],
        ['拝読を記録',
         '「読了として記録」に代わるものです。各御教えを何回拝読したかを数えます。' +
         '「繰り返し繰り返し肚にはいるまで読むのがよい」からです。']
      ],
      ok: 'わかりました'
    }
  };

  function jaVisto() {
    try { return !!localStorage.getItem(FLAG); } catch (_) { return true; }
  }
  function marcarVisto() {
    try { localStorage.setItem(FLAG, '1'); } catch (_) {}
  }

  // forcar=true ignora a flag: e' o caminho de quem quer VER o aviso de novo
  // (conferir o texto, mostrar pra alguem). O disparo automatico continua
  // respeitando a flag.
  function mostrar(forcar) {
    if (!forcar && jaVisto()) return;
    if (_modalExists('novidadesModal')) return;
    // Só pra quem já entrou: o #page-gate cobre a tela dos deslogados, e o
    // aviso apareceria atrás dele, gasto sem ninguém ver.
    try { if (!localStorage.getItem('mioshie_auth')) return; } catch (_) { return; }

    const lang = localStorage.getItem('site_lang') || 'pt';
    const t = N[lang] || N.pt;

    const el = document.createElement('div');
    el.className = 'search-modal-overlay';
    el.id = 'novidadesModal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'novidadesTitle');
    el.innerHTML =
      '<div class="search-modal nov-modal">' +
      '<button class="modal-close-btn" onclick="closeNovidades()" aria-label="Fechar">&times;</button>' +
      '<div class="search-header">' +
      '<h2 id="novidadesTitle" class="nov-kicker">' + _escModal(t.kicker) + '</h2>' +
      '</div>' +
      '<div class="nov-body">' +
      t.itens.map(function (it) {
        return '<div class="nov-item">' +
               '<h3 class="nov-item__title">' + _escModal(it[0]) + '</h3>' +
               '<p class="nov-item__text">' + _escModal(it[1]) + '</p>' +
               '</div>';
      }).join('') +
      '</div>' +
      '<div class="nov-actions">' +
      '<button type="button" class="disc-btn disc-btn--primary" onclick="closeNovidades()">' +
        _escModal(t.ok) + '</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target === el) window.closeNovidades(); });

    if (window.__lockBodyScroll) window.__lockBodyScroll();
    el.classList.add('active');
    // Marca como visto na EXIBIÇÃO, não no fechamento: se a pessoa recarregar
    // a página no meio, o aviso não volta a perseguí-la.
    marcarVisto();
  }

  window.closeNovidades = function () {
    const el = document.getElementById('novidadesModal');
    if (!el) return;
    const estavaAberto = el.classList.contains('active');
    el.classList.remove('active');
    if (estavaAberto && window.__unlockBodyScroll) window.__unlockBodyScroll();
    setTimeout(function () { el.remove(); }, 300);
  };

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const el = document.getElementById('novidadesModal');
    if (el && el.classList.contains('active')) window.closeNovidades();
  });

  // Só na home, e depois do conteúdo assentar — competir com o carregamento
  // faria o aviso aparecer sobre uma página ainda em branco.
  function agendar() {
    if (!document.body.classList.contains('home-page')) return;
    setTimeout(mostrar, 1200);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', agendar);
  } else {
    agendar();
  }

  // No console: showNovidades() mostra na hora, sem mexer na flag.
  //              showNovidades(true) tambem "esquece" que voce ja viu, pra
  //              testar o disparo automatico no proximo carregamento.
  window.showNovidades = function (esquecer) {
    if (esquecer) { try { localStorage.removeItem(FLAG); } catch (_) {} }
    mostrar(true);
  };
})();
