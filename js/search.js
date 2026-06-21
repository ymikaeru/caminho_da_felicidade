// ============================================================
// SEARCH — bilingual full-text search via Postgres FTS RPC
// ============================================================
// Cliente usa supabase.rpc('search_teachings'). Permissões por
// volume/arquivo são aplicadas server-side via auth.uid() na RPC,
// então o cliente NÃO precisa filtrar por user_permissions.

// ---------------------------------------------------------------
// PROVISIONAL — gating da busca por role
// ---------------------------------------------------------------
// Motivo: usuários estavam pegando o "atalho" da busca e perdendo a
// descoberta orgânica pelo índice. Esconder a busca pra não-admin
// força browsing manual.
//
// Pra religar a busca pra TODOS: mude SEARCH_ADMIN_ONLY para false
// abaixo (uma única linha). Nenhuma outra mudança necessária.
//
// Nota de segurança: a checagem é client-side (localStorage). Um
// usuário determinado pode forjar 'admin' no localStorage, mas isso
// só revela o modal — o RPC search_teachings ainda funciona pra
// qualquer authed user pelas RLS normais. O objetivo aqui é UX
// (nudge), não controle de acesso.
const SEARCH_ADMIN_ONLY = false;

function _searchEnabled() {
  if (!SEARCH_ADMIN_ONLY) return true;
  try { return localStorage.getItem('mioshie_auth') === 'admin'; }
  catch (e) { return false; }
}
window._searchEnabled = _searchEnabled;

let searchTimeout = null;
let _allResults = [];
// Resultados agrupados por publicação (vol/file). A paginação agora é
// por GRUPO, não por trecho — _displayedCount conta grupos exibidos.
let _allGroups = [];
let _displayedCount = 0;
let _currentQuery = '';
// true quando os resultados (modo Conteúdo) vieram por COBERTURA OR — as
// palavras casam em trechos diferentes da mesma publicação, não juntas num
// só trecho (ex.: "Vingança Ushitora alegria"). Banner explica.
let _orFallbackActive = false;
// Modo de busca (escolha explícita do usuário, persistida): cada modo busca
// e mostra SÓ o seu tipo, de forma determinística. Acabou o "busca tudo e
// despeja semântica" — ver _MODES e performSearch.
//   'titulo'      → índice local de títulos reais por-tópico
//   'conteudo'    → FTS no corpo + cobertura por publicação (multi-palavra)
//   'colecao'     → nome das publicações (SECTION_MAP)
//   'relacionados'→ busca semântica (Edge search-semantic)
const _MODES = ['titulo', 'conteudo', 'colecao', 'relacionados'];
let _searchMode = 'titulo';
try { const m = localStorage.getItem('search_mode'); if (_MODES.includes(m)) _searchMode = m; } catch (e) {}
// Query efetivamente buscada (≠ texto digitado ainda não submetido). A busca
// é SOB DEMANDA: nenhum modo busca ao digitar; só roda no botão "Buscar" /
// Enter (ver runSearch). Usado pra decidir se trocar de modo re-roda.
let _submittedQuery = '';
// Cache do índice de títulos (modo Título): { vol: [{f,i,t,tj}, ...] }.
let _titlesIndex = null;
let _titlesIndexLoading = null;
// Sequence ID: cada performSearch incrementa, e o handler de resposta só
// renderiza se o seq ainda for o último — descarta respostas de buscas
// que o usuário já abandonou (typeahead burst).
let _searchSeq = 0;
const GROUPS_PER_PAGE = 8;
// 100 (era 50): com agrupamento por publicação, 50 trechos viravam ~30
// publicações e termos frequentes (Johrei) estouravam o teto só com
// matches de título — o conteúdo quase não aparecia.
const MAX_RESULTS = 100;
let _focusedIndex = -1;

// Hard limit por chamada de busca. iOS 17 Safari (pré-17.4) pendura fetch
// na 2ª req ao mesmo origin via HTTP/2 stream reuse — sem timeout, o
// spinner "Buscando..." nunca some e o usuário precisa dar reload.
// Promise.race força um throw após N ms; o catch do performSearch já
// trata erro mostrando msg ou caindo no fallback FTS.
const SEARCH_TIMEOUT_MS = 8000;
function _withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout após ${ms}ms`)), ms)
    ),
  ]);
}

function getBasePath() {
  return window.location.pathname.includes('/mioshiec') ? '../' : './';
}

function _norm(s) {
  return s.toLowerCase().replace(/[\s\u3000\u00A0]+/g, ' ').trim();
}

// ---------------------------------------------------------------
// Termos da query \u2014 split por espa\u00E7o E por '&' (sintaxe antiga).
// Antes o split era S\u00D3 por '&': "vinganca alegria" virava um termo
// \u00FAnico que nunca casava com nada \u2192 zero grifo no cliente.
// ---------------------------------------------------------------
function _splitTerms(query) {
  const parts = (query || '').toLowerCase().split(/[&\s\u3000]+/)
    .map(p => p.trim()).filter(p => p.length >= 2);
  return [...new Set(parts)];
}

function _escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Padr\u00E3o insens\u00EDvel a acento: "vinganca" casa "vingan\u00E7a" e vice-versa.
// Cada letra vira uma classe com as variantes acentuadas \u2014 o corpus PT
// \u00E9 acentuado mas ningu\u00E9m digita acento na busca (o FTS unaccent j\u00E1
// resolve no servidor; isto resolve o GRIFO no cliente).
const _ACCENT_CLASSES = {
  a: 'a\u00E1\u00E0\u00E2\u00E3\u00E4', e: 'e\u00E9\u00E8\u00EA\u00EB', i: 'i\u00ED\u00EC\u00EE\u00EF', o: 'o\u00F3\u00F2\u00F4\u00F5\u00F6', u: 'u\u00FA\u00F9\u00FB\u00FC', c: 'c\u00E7', n: 'n\u00F1',
};
function _termPattern(term) {
  return term.split('').map(ch => {
    const base = ch.normalize('NFD').replace(/[\u0300-\u036F]/g, '').toLowerCase();
    const cls = _ACCENT_CLASSES[base];
    return cls ? `[${cls}]` : _escapeRe(ch);
  }).join('');
}

// Um RegExp por termo (pra classificar resultados e medir cobertura).
function _termRegexes(terms, activeLang) {
  return terms.map(t => activeLang === 'ja'
    ? new RegExp(_escapeRe(t), 'i')
    : new RegExp(`\\b${_termPattern(t)}`, 'i'));
}

function _stripMarks(s) {
  return String(s || '').replace(/<\/?mark[^>]*>/gi, '');
}

// Publicações-contêiner ("Coletânea de fragmentos sobre medicina N" etc.)
// guardam vários ensinamentos num só arquivo; o título_pt é o nome do
// contêiner e o título REAL de cada tópico fica embutido no começo do
// conteúdo: 'Ensinamento de Meishu-Sama: "TÍTULO" (data) corpo...'.
// Extrai { title, body } preservando os <mark>. Retorna null quando o
// padrão não está no início (trecho recortado de um match fundo no corpo).
const _TEACH_HEAD_RE = /^[\s\S]{0,60}?Meishu-Sama\s*[:：]?\s*[«"“”„]([\s\S]*?)[»"“”]\s*(?:[（(][^)）]*[)）])?\s*/;
function _extractTeaching(snippet) {
  if (!snippet) return null;
  const m = snippet.match(_TEACH_HEAD_RE);
  if (!m) return null;
  const title = m[1].trim();
  // Guarda: título plausível (não vazio, não a string toda por falta de
  // aspas de fechamento perto).
  if (!title || _stripMarks(title).length < 2 || _stripMarks(title).length > 120) return null;
  const body = snippet.slice(m[0].length).trim();
  return { title, body };
}

// ---------------------------------------------------------------
// Agrupamento por publicação + seções por tipo de match.
// Cada resultado da RPC é um TRECHO (tópico). Antes cada trecho era um
// card solto — a mesma publicação aparecia N vezes e resultados
// semânticos (sem termo grifado) se misturavam sem explicação.
// ---------------------------------------------------------------

// Rótulo da publicação (o nome que o usuário reconhece da navegação).
// Mesma cadeia de lookup que o render antigo usava pro breadcrumb.
function _pubLabel(vol, file, activeLang) {
  const volMap = window.SECTION_MAP ? window.SECTION_MAP[vol] : null;
  const sectObj = volMap ? volMap[file] : null;
  let label = sectObj ? (activeLang === 'ja' ? (sectObj.ja || sectObj.pt) : sectObj.pt) : '';
  if (!label) {
    const pubTitles = window.GLOBAL_INDEX_TITLES ? window.GLOBAL_INDEX_TITLES[vol] : null;
    label = pubTitles ? (pubTitles[file] || '') : '';
  }
  return label;
}

// Agrupa os trechos por vol/file e classifica cada grupo:
//   'title'   — algum termo casa no título (da publicação ou do trecho)
//   'content' — termo casa no corpo (mark do servidor ou regex local)
//   'related' — nada visível casou: veio do ranking semântico
// coverage = quantos termos distintos da query aparecem em algum lugar
// do grupo (usado pra ordenar o fallback OR: quem tem todas vem antes).
function _groupResults(results, q, activeLang) {
  const terms = _splitTerms(q);
  const regs = _termRegexes(terms, activeLang);
  const groups = new Map();
  results.forEach((r, i) => {
    const key = `${r.vol}/${r.file}`;
    let g = groups.get(key);
    if (!g) {
      g = { vol: r.vol, file: r.file, order: i, hits: [], navTitle: '', bestRank: 0 };
      groups.set(key, g);
    }
    const doctrinal = (activeLang === 'ja' && r.title_ja) ? r.title_ja : (r.title_pt || '');
    const nav = (activeLang === 'ja' && r.nav_title_ja) ? r.nav_title_ja : (r.nav_title_pt || '');
    if (nav && !g.navTitle) g.navTitle = nav;
    const snippetPlain = _stripMarks(r.snippet);
    const titleHit = regs.some(re => re.test(doctrinal) || (nav && re.test(nav)));
    const contentHit = /<mark>/i.test(r.snippet || '') || regs.some(re => re.test(snippetPlain));
    g.hits.push({
      topicIdx: r.topic_idx != null ? r.topic_idx : 0,
      title: doctrinal,
      snippet: r.snippet || '',
      content_excerpt: r.content_excerpt || '',
      rank: Number(r.rank) || 0,
      titleHit,
      contentHit,
    });
    g.bestRank = Math.max(g.bestRank, Number(r.rank) || 0);
  });
  const list = Array.from(groups.values());
  for (const g of list) {
    g.pubLabel = _pubLabel(g.vol, g.file, activeLang) || g.navTitle || (g.hits[0] ? g.hits[0].title : '');
    const pubTitleHit = regs.some(re => re.test(g.pubLabel));
    // Flags NÃO-exclusivas: a mesma publicação pode casar no título E no
    // corpo (o filtro "No conteúdo" deve listá-la nas duas categorias).
    g.hasTitle = pubTitleHit || g.hits.some(h => h.titleHit);
    g.hasContent = g.hits.some(h => h.contentHit);
    // kind exclusivo continua pra ordenação + rótulos de seção no modo "Tudo".
    g.kind = g.hasTitle ? 'title' : (g.hasContent ? 'content' : 'related');
    g.coverage = terms.filter((t, idx) => {
      const re = regs[idx];
      return re.test(g.pubLabel) || g.hits.some(h => re.test(h.title) || re.test(_stripMarks(h.snippet)));
    }).length;
    g.termsTotal = terms.length;
  }
  return list;
}

// Ordena os grupos pras seções: títulos → conteúdo → relacionados.
// Dentro da seção, preserva a ordem de chegada (rank do servidor).
// No fallback OR, cobertura maior primeiro (quem tem TODAS as palavras
// espalhadas pelos trechos é exatamente o que o usuário procura).
function _orderGroups(groups, orMode) {
  const kindOrder = { title: 0, content: 1, related: 2 };
  return groups.slice().sort((a, b) => {
    if (orMode && a.coverage !== b.coverage) return b.coverage - a.coverage;
    if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind];
    return a.order - b.order;
  });
}

function _searchLink(basePath, vol, file, topicIdx, q, activeLang) {
  let href = `${basePath}reader.html?vol=${vol}&file=${file}&search=${encodeURIComponent(q)}`;
  if (topicIdx > 0) href += `&topic=${topicIdx}`;
  if (activeLang === 'ja') href += `&lang=ja`;
  return href;
}

// PT: garante grifo mesmo quando o servidor não mandou <mark> (linhas
// vindas do ranking semântico) — aplica o regex local no texto escapado.
function _styleSnippetSmart(rawSnippet, activeLang, highlightRegex) {
  if (!rawSnippet) return '';
  if (activeLang !== 'ja' && !/<mark>/i.test(rawSnippet)) {
    const escaped = escHtml(rawSnippet);
    return highlightRegex
      ? escaped.replace(highlightRegex, '<mark class="search-highlight">$1</mark>')
      : escaped;
  }
  return _styleSnippet(rawSnippet, activeLang, highlightRegex);
}

// Remove só o RÓTULO do orador ("Ensinamento de Meishu-Sama:") do começo,
// preservando título + corpo. Fallback final do modo Conteúdo.
function _cleanContentSnippet(s) {
  return String(s || '').replace(/^[\s\S]{0,40}?Meishu-Sama\s*[:：\-–—]\s*/, '');
}

// Extrai o CORPO do trecho, cortando o título embutido. Os conteúdos
// começam de várias formas: 'Ensinamento de Meishu-Sama: "TÍTULO" (data)…',
// '"TÍTULO" (data)…', ou 'Contribuição de um dedicante: "TÍTULO" (data)…'.
// Corta o 1º "título entre aspas" (+ data) perto do começo e devolve o
// resto. Tira <mark> (o corpo é re-grifado depois). Sem aspas no começo,
// só remove o rótulo do orador.
function _contentBody(text) {
  const s = _stripMarks(String(text || ''));
  // 1) Divisor mais confiável: o 1º parêntese com ANO (data de publicação)
  //    encerra o cabeçalho em todos os formatos ('"Título" (1953)…',
  //    'Título - Coleção… (Publicado em 1952)…', 'Relato… (… 1950)…').
  let m = s.match(/^[\s\S]{0,250}?[（(][^)）]*(?:19|20)\d{2}[^)）]*[)）]\s*/);
  if (m && m[0].length < s.length - 8) return s.slice(m[0].length).trim();
  // 2) Ou o 1º título entre aspas (+ data opcional) perto do começo.
  m = s.match(/^[\s\S]{0,120}?["“”«][^"“”»]{2,160}["“”»]\s*(?:[（(][^)）]{0,45}[)）])?\s*/);
  if (m && m[0].length < s.length - 8) return s.slice(m[0].length).trim();
  // 3) Ou só o rótulo do orador.
  return s.replace(/^[\s\S]{0,40}?Meishu-Sama\s*[:：\-–—]\s*/, '').trim();
}

// Janela do CORPO em volta da 1ª ocorrência de um termo (modo Conteúdo).
// O ts_headline do servidor costuma centrar no título embutido (a palavra
// aparece primeiro ali); aqui pegamos o content_excerpt (corpo cru, 1500
// chars), pulamos o cabeçalho/título e recortamos ~200 chars ao redor do
// match NO CORPO — o trecho que o usuário realmente quer ver.
function _bodyWindow(body, q, activeLang) {
  if (!body) return null;
  const regs = _termRegexes(_splitTerms(q), activeLang);
  let best = -1;
  for (const re of regs) {
    const m = re.exec(body);
    if (m && (best < 0 || m.index < best)) best = m.index;
  }
  if (best < 0) return null; // termo não está no corpo (match era só no título)
  let start = Math.max(0, best - 70);
  let end = Math.min(body.length, best + 170);
  if (start > 0) { const sp = body.indexOf(' ', start); if (sp >= 0 && sp < best) start = sp + 1; }
  if (end < body.length) { const sp = body.lastIndexOf(' ', end); if (sp > best) end = sp; }
  let frag = body.slice(start, end).trim();
  if (start > 0) frag = '… ' + frag;
  if (end < body.length) frag = frag + ' …';
  return frag;
}

// Cada hit conhece seu título real (extraído do conteúdo embutido, quando
// é tópico de contêiner) calculado uma vez em _renderGroup e passado aqui.
function _renderHit(hit, g, basePath, highlightRegex, q, activeLang) {
  const href = _searchLink(basePath, g.vol, g.file, hit.topicIdx, q, activeLang);
  const ex = hit._extracted; // { title, body } | null
  let titleHtml = '';
  let snippetSrc = hit.snippet;

  if (_searchMode === 'conteudo') {
    // Conteúdo é o protagonista: pega um trecho do CORPO em volta do match,
    // pulando o título embutido. Prioridade:
    //   1) janela em volta do termo no corpo (content_excerpt, 1500 chars);
    //   2) se o termo não está no corpo (Johrei só no título), o INÍCIO do
    //      corpo — ainda conteúdo, nunca o título entre aspas;
    //   3) sem corpo disponível, o fragmento do servidor limpo.
    const body = hit.content_excerpt ? _contentBody(hit.content_excerpt) : '';
    if (body) {
      snippetSrc = _bodyWindow(body, q, activeLang)
        || (body.length > 220 ? body.slice(0, 220).trim() + ' …' : body);
    } else {
      snippetSrc = _bodyWindow(_contentBody(hit.snippet), q, activeLang) || _cleanContentSnippet(hit.snippet);
    }
  } else if (ex) {
    // Título real embutido: vira a manchete do trecho (com grifo), e o
    // corpo (sem o cabeçalho "Ensinamento de Meishu-Sama:") vira o snippet.
    titleHtml = `<div class="search-hit-title">${_styleSnippetSmart(ex.title, activeLang, highlightRegex)}</div>`;
    snippetSrc = ex.body || hit.snippet;
  } else {
    // Sem extração (publicação normal): mostra o título doutrinário só se
    // ele não for o nome da publicação nem já estiver repetido no snippet.
    const tNorm = _norm(_stripMarks(hit.title || ''));
    const sNorm = _norm(_stripMarks(hit.snippet || '')).replace(/^[^a-zà-ÿ0-9一-龯ぁ-んァ-ン]+/i, '');
    const dupInSnippet = tNorm.length >= 12 && sNorm.includes(tNorm.slice(0, 25));
    const sameAsPub = tNorm && tNorm === _norm(g.pubLabel);
    if (tNorm && !sameAsPub && !dupInSnippet) {
      titleHtml = `<div class="search-hit-title">${escHtml(hit.title)}</div>`;
    }
  }

  const snippetHtml = _styleSnippetSmart(snippetSrc, activeLang, highlightRegex);
  const dataTitle = ex ? _stripMarks(ex.title) : (hit.title || g.pubLabel);
  return `<li><a href="${href}" class="search-hit search-nav-item"
      data-vol="${escHtml(g.vol)}" data-file="${escHtml(g.file)}"
      data-query="${escHtml(q)}" data-topic="${hit.topicIdx}"
      data-title="${escHtml(dataTitle)}">
      ${titleHtml}
      <div class="search-hit-snippet">${snippetHtml}</div>
    </a></li>`;
}

function _renderGroup(g, basePath, highlightRegex, q, activeLang) {
  const volNum = g.vol.slice(-1);
  const volLabel = activeLang === 'ja' ? `第${volNum}巻` : `Volume ${volNum}`;
  const hits = g.hits.slice().sort((a, b) => a.topicIdx - b.topicIdx);
  const headHref = _searchLink(basePath, g.vol, g.file, hits[0].topicIdx, q, activeLang);

  // Extrai o título real de cada hit (tópicos de contêiner). Se TODOS os
  // hits têm título próprio ≠ nome da publicação, é um contêiner: a
  // manchete da publicação vira só um rótulo de coleção (pequeno), e cada
  // ensinamento aparece com seu título real — o usuário pediu pra NÃO ver
  // "Coletânea de fragmentos..." como informação principal.
  hits.forEach(h => {
    const ex = activeLang === 'ja' ? null : _extractTeaching(h.snippet);
    h._extracted = (ex && _norm(_stripMarks(ex.title)) !== _norm(g.pubLabel)) ? ex : null;
  });
  const isContainer = hits.length > 0 && hits.every(h => h._extracted);

  let badge = '';
  if (g.kind === 'related') {
    badge = `<span class="search-badge search-badge--related">${activeLang === 'ja' ? '関連' : 'relacionado'}</span>`;
  }
  // Fallback OR: marca quem cobre todas as palavras da busca.
  if (_orFallbackActive && g.termsTotal >= 2 && g.coverage >= g.termsTotal) {
    badge += `<span class="search-badge search-badge--full">${activeLang === 'ja' ? 'すべての語' : 'todas as palavras'}</span>`;
  }

  const hitsLabel = hits.length > 1
    ? (activeLang === 'ja' ? `${hits.length}件` : `${hits.length} ${isContainer ? 'ensinamentos' : 'trechos'}`)
    : '';
  const hitsHtml = hits.map(h => _renderHit(h, g, basePath, highlightRegex, q, activeLang)).join('');

  if (isContainer) {
    // Contêiner: cabeçalho = link clicável pra publicação inteira (desde o
    // início), pois às vezes o usuário quer a COLEÇÃO toda, não um trecho.
    // Os ensinamentos individuais ficam abaixo, cada um com seu link.
    const collHref = _searchLink(basePath, g.vol, g.file, 0, q, activeLang);
    const collName = highlightRegex
      ? escHtml(g.pubLabel).replace(highlightRegex, '<mark class="search-highlight">$1</mark>')
      : escHtml(g.pubLabel);
    const meta = [volLabel, hitsLabel].filter(Boolean).join(' · ');
    return `<li class="search-group search-group--collection">
        <a href="${collHref}" class="search-group-collection search-nav-item"
          data-vol="${escHtml(g.vol)}" data-file="${escHtml(g.file)}"
          data-query="${escHtml(q)}" data-topic="0"
          data-title="${escHtml(g.pubLabel)}">
          <span class="search-group-collection-name">${collName}${badge}</span>
          <span class="search-group-collection-meta">${meta}</span>
        </a>
        <ul class="search-group-hits">${hitsHtml}</ul>
      </li>`;
  }

  // Publicação normal: manchete = título da publicação (com grifo).
  const pubTitleHtml = highlightRegex
    ? escHtml(g.pubLabel).replace(highlightRegex, '<mark class="search-highlight">$1</mark>')
    : escHtml(g.pubLabel);
  const crumbLabel = hitsLabel ? `${volLabel} · ${hitsLabel}` : volLabel;
  return `<li class="search-group">
      <a href="${headHref}" class="search-group-head search-nav-item"
        data-vol="${escHtml(g.vol)}" data-file="${escHtml(g.file)}"
        data-query="${escHtml(q)}" data-topic="${hits[0].topicIdx}"
        data-title="${escHtml(g.pubLabel)}">
        <div class="search-group-title">${pubTitleHtml}${badge}</div>
        <div class="search-group-crumb">${crumbLabel}</div>
      </a>
      <ul class="search-group-hits">${hitsHtml}</ul>
    </li>`;
}

// ---------------------------------------------------------------
// Seletor de modo (Título / Conteúdo / Coleção / Relacionados)
// ---------------------------------------------------------------
const _MODE_LABELS = {
  pt: { titulo: 'Título', conteudo: 'Conteúdo', colecao: 'Coleção', relacionados: 'Relacionados' },
  ja: { titulo: 'タイトル', conteudo: '本文', colecao: '叢書', relacionados: '関連' },
};

function _renderModeSelector(activeLang) {
  const bar = document.getElementById('searchModeSelector');
  if (!bar) return;
  const labels = _MODE_LABELS[activeLang === 'ja' ? 'ja' : 'pt'];
  bar.innerHTML = _MODES.map(m =>
    `<button type="button" role="tab" class="search-mode-btn${_searchMode === m ? ' is-active' : ''}"
      aria-selected="${_searchMode === m}" data-mode="${m}">${labels[m]}</button>`
  ).join('');
  bar.style.display = '';
}

// Resultados de paginação são GENÉRICOS por modo: grupos (conteúdo/
// relacionados) ou itens planos (título/coleção). _displayedCount conta a
// unidade visível do modo. _renderActive despacha pra renderização certa.
let _flatItems = [];

function _renderActive(count, highlightRegex, q, activeLang) {
  if (_searchMode === 'titulo') return _renderFlatList(_flatItems, count, highlightRegex, q, activeLang, 'titulo');
  if (_searchMode === 'colecao') return _renderFlatList(_flatItems, count, highlightRegex, q, activeLang, 'colecao');
  return _renderGroupsList(_allGroups, count, highlightRegex, q, activeLang);
}

function _activeTotal() {
  return (_searchMode === 'titulo' || _searchMode === 'colecao') ? _flatItems.length : _allGroups.length;
}

function _loadMoreLabel(nextN, activeLang) {
  if (_searchMode === 'colecao')
    return activeLang === 'ja' ? `さらに${nextN}件` : `Carregar mais ${nextN} publicaç${nextN === 1 ? 'ão' : 'ões'}`;
  if (_searchMode === 'titulo')
    return activeLang === 'ja' ? `さらに${nextN}件` : `Carregar mais ${nextN} ensinamento${nextN === 1 ? '' : 's'}`;
  return activeLang === 'ja' ? `さらに${nextN}件の文献を表示` : `Carregar mais ${nextN} publicaç${nextN === 1 ? 'ão' : 'ões'}`;
}

function _loadMoreHtml(remaining, activeLang) {
  if (remaining <= 0) return '';
  const nextN = Math.min(GROUPS_PER_PAGE, remaining);
  return `<li class="search-load-more"><button class="btn-load-more" onclick="loadMoreResults()">${_loadMoreLabel(nextN, activeLang)}</button><span class="load-more-hint">${activeLang === 'ja' ? `（残り${remaining}件）` : `(${remaining} restantes)`}</span></li>`;
}

// Lista plana: modo Título (ensinamentos) ou Coleção (publicações).
function _renderFlatList(items, count, highlightRegex, q, activeLang, kind) {
  const basePath = getBasePath();
  const visible = items.slice(0, count);
  let html = '';
  for (const it of visible) {
    const href = _searchLink(basePath, it.vol, it.file, it.topicIdx || 0, q, activeLang);
    const nameHtml = _styleSnippetSmart(it.label, activeLang, highlightRegex);
    const crumb = it.crumb ? `<div class="search-flat-crumb">${escHtml(it.crumb)}</div>` : '';
    html += `<li><a href="${href}" class="search-flat-item search-nav-item"
        data-vol="${escHtml(it.vol)}" data-file="${escHtml(it.file)}"
        data-query="${escHtml(q)}" data-topic="${it.topicIdx || 0}"
        data-title="${escHtml(_stripMarks(it.label))}">
        <div class="search-flat-name search-flat-name--${kind}">${nameHtml}</div>
        ${crumb}
      </a></li>`;
  }
  return html + _loadMoreHtml(items.length - visible.length, activeLang);
}

// Lista agrupada por publicação: modo Conteúdo (+ cobertura OR) e Relacionados.
function _renderGroupsList(groups, count, highlightRegex, q, activeLang) {
  const basePath = getBasePath();
  const ordered = _orderGroups(groups, _orFallbackActive);
  const visible = ordered.slice(0, count);
  let html = '';
  if (_orFallbackActive) {
    const bannerTxt = activeLang === 'ja'
      ? 'すべての語を含む一節は見つかりませんでした — 語が別々の節に現れる文献を表示しています。'
      : 'Nenhum trecho contém todas as palavras juntas — mostrando publicações onde elas aparecem em trechos separados.';
    html += `<li class="search-or-banner">${bannerTxt}</li>`;
  }
  for (const g of visible) html += _renderGroup(g, basePath, highlightRegex, q, activeLang);
  return html + _loadMoreHtml(ordered.length - visible.length, activeLang);
}

// ---------------------------------------------------------------
// Modo Título — busca local no índice enxuto de títulos reais
// ---------------------------------------------------------------
// Busca UM volume do índice de títulos com timeout próprio. AbortController
// força o fetch a abortar após SEARCH_TIMEOUT_MS — sem isso, um fetch
// pendurado (iOS17 Safari pré-17.4 reusa stream HTTP/2 e a 2ª req nunca
// resolve nem rejeita) trava o Promise.all e o spinner "Buscando..." fica
// preso até o reload. Em falha/timeout o volume degrada para [] (a busca de
// título perde aquele volume em vez de pendurar a página inteira).
function _fetchTitlesVol(base, v) {
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS) : null;
  return fetch(`${base}site_data/titles_index_${v}.json?v=1`, ctrl ? { signal: ctrl.signal } : undefined)
    .then(r => r.ok ? r.json() : [])
    .then(rows => [v, rows])
    .catch(() => [v, []])
    .finally(() => { if (timer) clearTimeout(timer); });
}

async function _loadTitlesIndex() {
  if (_titlesIndex) return _titlesIndex;
  if (_titlesIndexLoading) return _titlesIndexLoading;
  const base = getBasePath();
  const vols = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];
  _titlesIndexLoading = Promise.all(vols.map(v => _fetchTitlesVol(base, v)))
    .then(pairs => {
      const idx = {};
      for (const [v, rows] of pairs) idx[v] = rows;
      // Se NENHUM volume carregou (rede/timeout), NÃO cacheia o índice vazio:
      // zera o estado para a próxima busca poder tentar de novo (senão um
      // tropeço de rede deixaria a busca de título morta até o reload).
      const anyLoaded = Object.values(idx).some(rows => rows && rows.length > 0);
      _titlesIndex = anyLoaded ? idx : null;
      _titlesIndexLoading = null;
      return idx;
    })
    .catch(() => {
      _titlesIndex = null;
      _titlesIndexLoading = null;
      return {};
    });
  return _titlesIndexLoading;
}

function _searchTitlesIndex(q, activeLang) {
  const terms = _splitTerms(q);
  if (!terms.length || !_titlesIndex) return [];
  const regs = _termRegexes(terms, activeLang);
  const qn = _norm(q);
  const out = [];
  for (const vol of Object.keys(_titlesIndex)) {
    for (const r of _titlesIndex[vol]) {
      const title = (activeLang === 'ja' && r.tj) ? r.tj : (r.t || '');
      if (!title) continue;
      if (!regs.every(re => re.test(title))) continue; // AND: todos os termos
      const tn = _norm(title);
      const score = tn === qn ? 3 : (tn.startsWith(qn) ? 2 : 1);
      const file = r.f + '.html';
      const pub = _pubLabel(vol, file, activeLang);
      const volNum = vol.slice(-1);
      // Breadcrumb: Volume + nome da publicação (quando difere do título).
      const crumb = (activeLang === 'ja' ? `第${volNum}巻` : `Volume ${volNum}`) +
        (pub && _norm(pub) !== tn ? ` · ${pub}` : '');
      out.push({ vol, file, topicIdx: r.i, label: title, crumb, score, len: title.length });
    }
  }
  // Melhor match primeiro: exato > prefixo > contém; depois título mais curto.
  out.sort((a, b) => b.score - a.score || a.len - b.len);
  return out.slice(0, MAX_RESULTS);
}

// ---------------------------------------------------------------
// Modo Coleção — busca no nome das publicações (SECTION_MAP)
// ---------------------------------------------------------------
function _searchCollections(q, activeLang) {
  const terms = _splitTerms(q);
  const map = window.SECTION_MAP;
  if (!terms.length || !map) return [];
  const regs = _termRegexes(terms, activeLang);
  const qn = _norm(q);
  const out = [];
  for (const vol of Object.keys(map)) {
    const files = map[vol];
    for (const file of Object.keys(files)) {
      const o = files[file];
      const label = (activeLang === 'ja' && o.ja) ? o.ja : (o.pt || '');
      if (!label) continue;
      if (!regs.every(re => re.test(label))) continue;
      const ln = _norm(label);
      const score = ln === qn ? 3 : (ln.startsWith(qn) ? 2 : 1);
      const volNum = vol.slice(-1);
      const crumb = (activeLang === 'ja' ? `第${volNum}巻` : `Volume ${volNum}`) +
        (o.section ? ` · ${activeLang === 'ja' ? (o.sectionJa || o.section) : o.section}` : '');
      out.push({ vol, file, topicIdx: 0, label, crumb, score, len: label.length, n: Number(o.n) || 0 });
    }
  }
  out.sort((a, b) => b.score - a.score || a.n - b.n || a.len - b.len);
  return out.slice(0, MAX_RESULTS);
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Carrega os scripts de breadcrumb (section_map.js / global_index_titles.js).
// Usados por _renderResultItem para gerar a trilha "Início / Volume X / Seção".
function _loadSectionMaps() {
  const basePath = getBasePath();
  if (!window.SECTION_MAP && !document.getElementById('sectionMapScript')) {
    const script = document.createElement('script');
    script.id = 'sectionMapScript';
    script.src = `${basePath}site_data/section_map.js?v=1`;
    document.head.appendChild(script);
  }
  if (!window.GLOBAL_INDEX_TITLES && !document.getElementById('globalIndexTitlesScript')) {
    const script = document.createElement('script');
    script.id = 'globalIndexTitlesScript';
    script.src = `${basePath}site_data/global_index_titles.js?v=1`;
    document.head.appendChild(script);
  }
}

function _getSupabase() {
  return window.supabaseAuth?.supabase || null;
}

function _setRandomLoading(btn) {
  if (!btn || btn.disabled) return { restore: () => {} };
  const origHtml = btn.innerHTML;
  const isIconOnly = btn.classList.contains('vol-random-btn');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  if (isIconOnly) {
    btn.innerHTML = `<span class="search-spinner search-spinner--icon" aria-hidden="true"></span>`;
  } else {
    const origWidth = btn.offsetWidth;
    const lang = localStorage.getItem('site_lang') || 'pt';
    const txt = lang === 'ja' ? '読み込み中...' : 'Carregando...';
    btn.style.minWidth = origWidth + 'px';
    btn.innerHTML = `<span class="search-spinner" aria-hidden="true"></span><span>${txt}</span>`;
  }
  return {
    restore: () => {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.style.minWidth = '';
      btn.innerHTML = origHtml;
    }
  };
}

async function _pickRandomViaRpc(onlyVol, loader) {
  const lang = localStorage.getItem('site_lang') || 'pt';
  const supabase = _getSupabase();
  if (!supabase) { loader.restore(); return; }

  const { data, error } = await supabase.rpc('random_teaching', { only_vol: onlyVol });
  if (error) {
    console.warn('random_teaching RPC error:', error);
    loader.restore();
    return;
  }
  if (!data || data.length === 0) { loader.restore(); return; }

  const item = data[0];
  const topicIdx = item.topic_idx != null ? item.topic_idx : 0;
  let href = `${getBasePath()}reader.html?vol=${item.vol}&file=${item.file}`;
  if (topicIdx > 0) href += `&topic=${topicIdx}`;
  if (lang === 'ja') href += `&lang=ja`;
  window.location.href = href;
}

window.openRandomFromVolume = async function(vol, evt) {
  const loader = _setRandomLoading(evt?.currentTarget);
  try {
    await _pickRandomViaRpc(vol, loader);
  } catch (err) {
    console.error('Random volume teaching failed:', err);
    loader.restore();
  }
};

window.openRandomTeaching = async function(evt) {
  const loader = _setRandomLoading(evt?.currentTarget);
  try {
    await _pickRandomViaRpc(null, loader);
  } catch (err) {
    console.error('Random teaching failed:', err);
    loader.restore();
  }
};

window.clearSearch = function () {
  const input = document.getElementById('searchInput');
  const resultsEl = document.getElementById('searchResults');
  const clearBtn = document.getElementById('searchClear');
  if (input) {
    input.value = '';
    input.focus();
  }
  if (resultsEl) resultsEl.innerHTML = '';
  if (clearBtn) clearBtn.style.display = 'none';
  _updateSearchCount(0, 0, localStorage.getItem('site_lang') || 'pt');
  sessionStorage.removeItem('searchQuery');
  sessionStorage.removeItem('searchResultsHtml');
  _allResults = [];
  _allGroups = [];
  _flatItems = [];
  _orFallbackActive = false;
  _displayedCount = 0;
  _currentQuery = '';
  _submittedQuery = '';
  _focusedIndex = -1;
}

window.openSearch = function () {
  // Single chokepoint pra todos os entrypoints (botão + Ctrl+K + "/").
  // Se a busca está provisoriamente gated, no-op silencioso.
  if (!_searchEnabled()) return;
  const modal = document.getElementById('searchModal');
  const input = document.getElementById('searchInput');
  if (modal) {
    modal.classList.add('active');
    _trapFocus(modal);
    if (input) {
      input.focus();
      const clearBtn = document.getElementById('searchClear');
      if (clearBtn) clearBtn.style.display = input.value.trim() ? 'flex' : 'none';

      // Restaurando estado após reload: se tem query salva mas nenhum resultado
      // renderizado, re-roda a busca pra gerar items com os data-attrs corretos.
      const resultsEl = document.getElementById('searchResults');
      if (input.value.trim() && resultsEl && !resultsEl.querySelector('.search-nav-item')) {
        if (typeof _runOrPrompt === 'function') _runOrPrompt(input.value);
      }
    }
    _loadSectionMaps();
    _renderModeSelector(localStorage.getItem('site_lang') || 'pt');
    _injectSearchButton();
  }
}

// preserveQuery default = true: fechar o modal NÃO deve limpar input nem
// resultados. Reabrir mostra exatamente o que estava antes — sem refazer
// a busca. Pra limpar de verdade, usuário usa o botão "Apagar" (clearSearch).
window.closeSearch = function (preserveQuery = true) {
  const modal = document.getElementById('searchModal');
  if (!modal) return;
  modal.classList.remove('active');
  _releaseFocus(modal);
  if (!preserveQuery) {
    sessionStorage.removeItem('searchQuery');
    sessionStorage.removeItem('searchResultsHtml');
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    const clearBtn = document.getElementById('searchClear');
    if (clearBtn) clearBtn.style.display = 'none';
    const resultsEl = document.getElementById('searchResults');
    if (resultsEl) resultsEl.innerHTML = '';
  }
}

// --- Search Preview Modal (iframe) ---

function _iframeCall(fnName, ...args) {
  const iframe = document.getElementById('searchPreviewIframe');
  if (!iframe || !iframe.contentWindow) return;
  try {
    if (typeof iframe.contentWindow[fnName] === 'function') iframe.contentWindow[fnName](...args);
  } catch (e) { }
}

function _syncSpmFavorite() {
  const iframe = document.getElementById('searchPreviewIframe');
  const btn = document.getElementById('spmFavorite');
  if (!btn || !iframe) return;
  try {
    const favs = JSON.parse(localStorage.getItem('savedFavorites') || '[]');
    const isSaved = favs.some(f => f.vol === iframe.dataset.vol && f.file === iframe.dataset.file);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isSaved ? 'currentColor' : 'none');
    btn.classList.toggle('spm-btn--active', isSaved);
  } catch (e) { }
}

function _syncSpmLang() {
  const btn = document.getElementById('spmLang');
  if (!btn) return;
  btn.textContent = (localStorage.getItem('site_lang') || 'pt') === 'ja' ? 'PT' : '日本語';
}

document.addEventListener('DOMContentLoaded', function _initSearchPreviewModal() {
  const isMobile = window.innerWidth <= 767;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const openPubLabel = lang === 'ja' ? '教えを開く' : 'Abrir Ensinamento';
  const quicklookLabel = lang === 'ja' ? '検索プレビュー' : 'Prévia da busca';

  const overlay = document.createElement('div');
  overlay.className = 'search-preview-overlay';
  overlay.id = 'searchPreviewModal';
  overlay.innerHTML =
    '<div class="search-preview-panel" id="searchPreviewPanel">' +
      // Linha 1: controles/estado \u2014 back \u00e0 esquerda, badge centralizado, close \u00e0 direita.
      // Cada item flex-1 pra alinhar sim\u00e9trico mesmo com texto de tamanho vari\u00e1vel.
      '<div class="search-preview-header">' +
        '<button class="search-preview-back" id="searchPreviewBack" onclick="closeSearchPreview()">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
          ' Resultados' +
        '</button>' +
        '<span class="search-preview-badge" id="searchPreviewBadge">' + quicklookLabel + '</span>' +
        '<button class="modal-close-btn search-preview-close" onclick="closeSearchPreview()" aria-label="Fechar preview">\u00d7</button>' +
      '</div>' +
      // Linha 2: contexto/conte\u00fado \u2014 breadcrumb pequeno em cima, t\u00edtulo do t\u00f3pico
      // em destaque embaixo. Centralizado, com truncamento ellipsis se exceder.
      '<div class="search-preview-context">' +
        '<div class="search-preview-breadcrumb" id="searchPreviewBreadcrumb"></div>' +
        '<div class="search-preview-title" id="searchPreviewTitle"></div>' +
      '</div>' +
      '<div class="search-preview-body">' +
        '<div class="search-preview-card" id="searchPreviewCard">' +
          '<div class="search-preview-card-content" id="searchPreviewCardContent"></div>' +
          '<div class="search-preview-card-fade" aria-hidden="true"></div>' +
        '</div>' +
      '</div>' +
      '<div class="search-preview-footer">' +
        '<button class="search-preview-cta" id="spmOpenPub" title="' + openPubLabel + '">' +
          '<span>' + openPubLabel + '</span>' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeSearchPreview();
  });

  const openPubBtn = document.getElementById('spmOpenPub');
  if (openPubBtn) {
    openPubBtn.addEventListener('click', () => {
      const iframe = document.getElementById('searchPreviewIframe');
      const card = document.getElementById('searchPreviewCard');
      const vol = iframe?.dataset.vol || card?.dataset.vol || '';
      const file = iframe?.dataset.file || card?.dataset.file || '';
      // Abre no MESMO topic_idx que o usuário está previsualizando — o
      // preview vira um quick look coerente (vê o tópico X, abre no X).
      // Antes ficava fixo em topic=0, o que pulava pro início da
      // publicação e confundia.
      const topicIdx = parseInt(card?.dataset.topic ?? '0', 10) || 0;
      const query = card?.dataset.query || '';
      const lang = localStorage.getItem('site_lang') || 'pt';
      let href = `${getBasePath()}reader.html?vol=${vol}&file=${file}`;
      if (query) href += `&search=${encodeURIComponent(query)}`;
      if (topicIdx > 0) href += `&topic=${topicIdx}`;
      if (lang === 'ja') href += `&lang=ja`;
      window.location.href = href;
    });
  }
});

window.openSearchPreview = function (vol, file, search, displayTitle, topicIdx, sectionLabel) {
  const overlay = document.getElementById('searchPreviewModal');
  const iframe = document.getElementById('searchPreviewIframe');
  const card = document.getElementById('searchPreviewCard');
  const titleEl = document.getElementById('searchPreviewTitle');
  const breadcrumbEl = document.getElementById('searchPreviewBreadcrumb');
  const cardContentEl = document.getElementById('searchPreviewCardContent');
  if (!overlay) return;

  const basePath = getBasePath();
  const lang = localStorage.getItem('site_lang') || 'pt';
  const isMobile = window.innerWidth <= 767;

  if (titleEl) titleEl.textContent = displayTitle || '';
  if (breadcrumbEl) breadcrumbEl.textContent = sectionLabel || '';

  if (card) {
    card.dataset.vol = vol;
    card.dataset.file = file;
    card.dataset.topic = String(topicIdx != null ? topicIdx : 0);
    // Guardamos a query no card pra que o botão "Abrir Ensinamento"
    // monte a URL com &search=, permitindo highlight + scroll pra marca
    // no reader. Sem isto, abrir do preview ia pro tópico sem rolar
    // pra palavra — usuário ficava perdido em ensinamentos longos.
    card.dataset.query = search || '';
  }

  const renderCardContent = (contentHtml) => {
    if (cardContentEl) cardContentEl.innerHTML = contentHtml;
    // Detecta overflow real medindo conteúdo vs área disponível do card
    // (clientHeight menos paddings vertical). Slack de 8px absorve
    // arredondamentos de line-height. Sem isso o fade aparecia mesmo
    // quando o texto cabia, cobrindo a última linha e parecendo corte.
    if (card && cardContentEl) {
      requestAnimationFrame(() => {
        const s = getComputedStyle(card);
        const padTop = parseFloat(s.paddingTop) || 0;
        const padBottom = parseFloat(s.paddingBottom) || 0;
        const available = card.clientHeight - padTop - padBottom;
        const overflow = cardContentEl.scrollHeight > available + 8;
        card.classList.toggle('has-overflow', overflow);
      });
    }
  };

  const _applyHighlight = (text) => {
    if (!search || !search.trim()) return text;
    const highlightRegex = _buildHighlightRegex(search, lang);
    if (!highlightRegex) return text;
    return text.replace(highlightRegex, '<mark class="search-highlight">$1</mark>');
  };

  function _renderFallback() {
    // O conteúdo canônico vem do JSON em Storage. Quando o download falha,
    // simplesmente avisamos o usuário — não há mais índice em memória pra ler.
    renderCardContent('<p style="padding:2rem;text-align:center;color:var(--text-muted);">Conteúdo indisponível.</p>');
  }

  renderCardContent('<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.95rem;">Carregando o ensinamento completo...</div>');

  if (window.supabaseStorageFetch) {
    const fileNameStr = file.endsWith('.json') ? file : `${file}.json`;
    window.supabaseStorageFetch(`${vol}/${fileNameStr}`).then(json => {
      let topicsFound = [];
      if (json && json.themes) {
          json.themes.forEach(theme => {
              if (theme.topics) theme.topics.forEach(topic => topicsFound.push(topic));
          });
      }
      
      let fullContent = '';
      if (topicsFound.length > 0) {
          const targetTopic = topicsFound[topicIdx || 0] || topicsFound[0];
          if (targetTopic) {
              fullContent = lang === 'ja' 
                  ? (targetTopic.content_ja || targetTopic.content || '') 
                  : (targetTopic.content_ptbr || targetTopic.content_pt || targetTopic.content || '');
          }
      }

      if (fullContent) {
        let safeContent = String(fullContent)
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/gi, ' ');
          
        safeContent = escHtml(safeContent);
        safeContent = safeContent.split(/\n+/).filter(line => line.trim()).map(line => `<p>${line}</p>`).join('');
        renderCardContent(_applyHighlight(safeContent));
      } else {
        _renderFallback();
      }
    }).catch(err => {
       console.warn('Erro ao carregar do Storage para preview:', err);
       _renderFallback();
    });
  } else {
    _renderFallback();
  }

  overlay.classList.add('active');
  _trapFocus(overlay);
};

window.closeSearchPreview = function () {
  const overlay = document.getElementById('searchPreviewModal');
  const iframe = document.getElementById('searchPreviewIframe');
  const card = document.getElementById('searchPreviewCard');
  if (!overlay) return;
  overlay.classList.remove('active');
  _releaseFocus(overlay);
  if (iframe) setTimeout(() => { if (!overlay.classList.contains('active')) iframe.src = ''; }, 300);
  if (card) {
    const contentEl = document.getElementById('searchPreviewCardContent');
    if (contentEl) contentEl.innerHTML = '';
    delete card.dataset.vol;
    delete card.dataset.file;
  }
};

// --- Search DOM listeners ---

document.addEventListener('DOMContentLoaded', () => {
  const searchModal = document.getElementById('searchModal');
  const searchInput = document.getElementById('searchInput');

  // Fechar ao tocar no backdrop — mas SÓ se o gesto começou E terminou no
  // overlay. Sem a guarda do pointerdown, um re-render do typeahead (ou uma
  // rolagem que vira tap) trocava o nó sob o dedo e o browser re-alvejava o
  // `click` pro overlay → a busca fechava sozinha enquanto o usuário digitava
  // (principalmente no celular).
  if (searchModal) {
    let _downOnBackdrop = false;
    searchModal.addEventListener('pointerdown', (e) => {
      _downOnBackdrop = (e.target === searchModal);
    });
    searchModal.addEventListener('click', (e) => {
      if (e.target === searchModal && _downOnBackdrop) closeSearch();
      _downOnBackdrop = false;
    });
  }

  // Restore search query + results HTML from sessionStorage. Sem a parte
  // do HTML, voltar pra index após abrir um ensinamento disparava re-busca
  // automaticamente (input com valor + resultados vazios). Restaurando o
  // HTML, a busca anterior aparece intacta e o openSearch não precisa
  // chamar performSearch.
  const savedQuery = sessionStorage.getItem('searchQuery');
  const savedResultsHtml = sessionStorage.getItem('searchResultsHtml');
  if (savedQuery && searchInput) {
    searchInput.value = savedQuery;
    const clearBtn = document.getElementById('searchClear');
    if (clearBtn) clearBtn.style.display = 'flex';
    if (savedResultsHtml) {
      const resultsEl = document.getElementById('searchResults');
      if (resultsEl) {
        resultsEl.innerHTML = savedResultsHtml;
        // Reconstrói _allResults vazio: loadMoreResults vai precisar do
        // server de novo (perda aceitável vs. serializar 50 objetos).
        // O essencial — items clicáveis com data-attrs — está no HTML.
        // Reescreve hrefs relativos salvos pro basePath da página atual.
        // Sem isto, quando o usuário busca no home (href = ./reader.html)
        // e depois navega pra mioshiec3/, o ./reader.html restaurado
        // resolve pra mioshiec3/reader.html (404). Vale o inverso também.
        const cur = getBasePath();
        resultsEl.querySelectorAll('a[href^="./"], a[href^="../"]').forEach(a => {
          a.setAttribute('href', a.getAttribute('href').replace(/^\.\.?\//, cur));
        });
      }
    }
  }

  const triggerSearch = () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value;
    const clearBtn = document.getElementById('searchClear');
    if (clearBtn) clearBtn.style.display = query.trim() ? 'flex' : 'none';

    const resultsEl = document.getElementById('searchResults');
    const currentLang = localStorage.getItem('site_lang') || 'pt';
    _focusedIndex = -1;
    _updateSearchCount(0, 0, currentLang);

    if (!query.trim()) {
      if (resultsEl) resultsEl.innerHTML = '';
      return;
    }

    // Local (Título/Coleção) = instantâneo ao digitar (índices locais, sem
    // rede, sem o travamento do typeahead). Servidor (Conteúdo/Relacionados)
    // = SOB DEMANDA: mostra o botão "Buscar"; só dispara no clique/Enter
    // (evita o enxame de buscas lentas que travava no celular).
    if (_isOnDemandMode()) {
      _renderSearchPrompt(query);
    } else {
      searchTimeout = setTimeout(() => performSearch(query), 160);
    }
  };

  if (searchInput) searchInput.addEventListener('input', triggerSearch);

  // Seletor de modo (Título / Conteúdo / Coleção / Relacionados): trocar o
  // modo re-busca a query atual no motor daquele modo (ver switchSearchMode).
  const modeSelector = document.getElementById('searchModeSelector');
  if (modeSelector) {
    modeSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.search-mode-btn');
      if (!btn) return;
      switchSearchMode(btn.dataset.mode || 'titulo');
    });
  }

  // Exact word matching toggle
  const exactToggle = document.getElementById('searchExactToggle');
  if (exactToggle) {
    exactToggle.checked = localStorage.getItem('search_exact') === 'true';
    exactToggle.addEventListener('change', () => {
      try { localStorage.setItem('search_exact', exactToggle.checked); } catch (e) { }
      if (_submittedQuery) runSearch();
    });
  }

  // Literal substring toggle — ILIKE puro nos campos PT+JA, sem FTS/semântico.
  // Resolve o caso de termos JA (kanji) que o tokenizer pt_unaccent não acha.
  const literalToggle = document.getElementById('searchLiteralToggle');
  if (literalToggle) {
    literalToggle.checked = localStorage.getItem('search_literal') === 'true';
    literalToggle.addEventListener('change', () => {
      try { localStorage.setItem('search_literal', literalToggle.checked); } catch (e) { }
      if (_submittedQuery) runSearch();
    });
  }

  // Advanced panel toggle — esconde os filtros atrás de um botão pra reduzir
  // ruído visual no modal de busca. Estado persistido em localStorage.
  const advBtn = document.getElementById('searchAdvancedToggle');
  const advPanel = document.getElementById('searchAdvancedPanel');
  if (advBtn && advPanel) {
    advBtn.addEventListener('click', () => {
      const isOpen = advPanel.classList.toggle('is-open');
      advBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      try { localStorage.setItem('search_advanced_open', isOpen); } catch (e) { }
    });
  }

  // Fallback close button for volume pages (uses id="searchClose" without onclick)
  const searchCloseBtn = document.getElementById('searchClose');
  if (searchCloseBtn) {
    searchCloseBtn.addEventListener('click', closeSearch);
  }

  // Arrow key navigation within search results
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      // Sob demanda: Enter (ou a tecla "Buscar" do teclado mobile) dispara a
      // busca do modo atual quando não há item de resultado em foco.
      if (e.key === 'Enter' && _focusedIndex < 0) {
        e.preventDefault();
        runSearch();
        return;
      }
      const items = document.querySelectorAll('#searchResults .search-nav-item');
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _focusedIndex = Math.min(_focusedIndex + 1, items.length - 1);
        _updateFocusedItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _focusedIndex = Math.max(_focusedIndex - 1, -1);
        _updateFocusedItem(items);
      } else if (e.key === 'Enter' && _focusedIndex >= 0) {
        e.preventDefault();
        items[_focusedIndex]?.click();
      }
    });
  }

  // Global keyboard shortcuts: Ctrl+K / Cmd+K / '/' opens search; Escape closes
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
      return;
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !document.activeElement?.isContentEditable) {
        e.preventDefault();
        openSearch();
        return;
      }
    }
    if (e.key === 'Escape') {
      const previewModal = document.getElementById('searchPreviewModal');
      if (previewModal?.classList.contains('active')) { closeSearchPreview(); return; }
      if (searchModal?.classList.contains('active')) { closeSearch(); return; }
    }
  });

  // ── #1: XSS fix — event delegation instead of inline onclick per result ──
  const resultsContainer = document.getElementById('searchResults');
  if (resultsContainer) {
    // Clicar num resultado segue o <a href> nativo direto pro reader.
    // O reader já cuida de highlight + auto-scroll pra marca, então o
    // preview modal vira etapa extra desnecessária. (Preview ainda existe
    // como função window.openSearchPreview pra possível reuso futuro.)
  }

});

let _supabaseLogTimer = null;

function logSearch(query, count, latencyMs) {
  try {
    const key = 'mioshie_search_log';
    const log = JSON.parse(localStorage.getItem(key) || '[]');
    log.push({ q: query.trim(), n: count, ts: Math.floor(Date.now() / 1000) });
    if (log.length > 200) log.splice(0, log.length - 200);
    localStorage.setItem(key, JSON.stringify(log));
  } catch (e) { }

  // Log to Supabase with debounce — only logs the final settled query
  clearTimeout(_supabaseLogTimer);
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 3) return; // ignore very short partial queries
  _supabaseLogTimer = setTimeout(() => {
    try {
      const supabase = window.supabaseAuth?.supabase;
      if (supabase) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) {
            const row = {
              user_id: session.user.id,
              query: trimmed.substring(0, 200),
              results_count: count
            };
            if (Number.isFinite(latencyMs) && latencyMs >= 0) row.latency_ms = Math.round(latencyMs);
            supabase.from('search_logs').insert(row).then(() => {}).catch(() => {});
          }
        });
      }
    } catch (e) { }
  }, 2000);
}

function _updateFocusedItem(items) {
  items.forEach((item, i) => item.classList.toggle('is-focused', i === _focusedIndex));
  if (_focusedIndex >= 0) items[_focusedIndex]?.scrollIntoView({ block: 'nearest' });
}

// totalGroups/shownGroups: publicações; total/shown: trechos.
function _updateSearchCount(total, shown, lang, hitLimit = false, totalGroups = 0, shownGroups = 0) {
  const el = document.getElementById('searchCount');
  const set = (text) => { if (el) el.textContent = text; };
  if (total === 0) { set(''); return; }
  let text;
  if (lang === 'ja') {
    text = totalGroups
      ? `${totalGroups}件の文献・${total}節`
      : `${total}件中${shown}件を表示`;
    if (totalGroups && shownGroups < totalGroups) text = `${shownGroups}件を表示中 / ${text}`;
    if (hitLimit) text += ' — 検索を絞り込むとより正確な結果が得られます';
  } else {
    text = totalGroups
      ? `${totalGroups} publicaç${totalGroups === 1 ? 'ão' : 'ões'} · ${total} trecho${total !== 1 ? 's' : ''}`
      : `Exibindo ${shown} de ${total} resultado${total !== 1 ? 's' : ''}`;
    if (totalGroups && shownGroups < totalGroups) text = `Exibindo ${shownGroups} de ${text}`;
    if (hitLimit) text += ' — refine a busca para mais precisão';
  }
  set(text);
}

// Constrói um RegExp pra highlight client-side a partir do que o usuário digitou.
// Multi-termo (split por espaço/&) e insensível a acento — ver _splitTerms/_termPattern.
// PT: estende até o fim da palavra ("vinganca" grifa "vinganças" inteiro,
// espelhando o <mark> do ts_headline do servidor).
function _buildHighlightRegex(query, activeLang) {
  const parts = _splitTerms(query);
  if (parts.length === 0) return null;
  // Sem word boundary em JA (kanji não tem \b).
  if (activeLang === 'ja') return new RegExp(`(${parts.map(_escapeRe).join('|')})`, 'gi');
  return new RegExp(`\\b(${parts.map(p => `${_termPattern(p)}[a-zà-öø-ÿ0-9]*`).join('|')})`, 'gi');
}

// Traduz o input do usuário para a sintaxe do websearch_to_tsquery.
//   - "a & b"  → "a b"          (AND é o default)
//   - exact on → wrap em aspas  ("a" "b")
function _translateQuery(rawQuery, useExact) {
  const trimmed = (rawQuery || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split('&').map(p => p.trim()).filter(p => p.length >= 2);
  if (parts.length === 0) return trimmed;
  return useExact
    ? parts.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' ')
    : parts.join(' ');
}

// "Você quis dizer...?" — chama suggest_teachings (pg_trgm) e renderiza
// links acima dos resultados (ou da mensagem "Nenhum resultado").
// Falhas silenciosas: se a RPC não existir ou der erro, o usuário só vê
// a mensagem normal.
//
// mode:
//   'replace' (default): zero resultados — substitui o innerHTML por
//                        [suggest + "Nenhum resultado"].
//   'prepend':           tem resultados mas poucos/fracos — insere o
//                        bloco de sugestão ANTES dos resultados.
async function _maybeSuggestDidYouMean(rawQuery, activeLang, resultsEl, mode = 'replace') {
  if (!resultsEl) return;
  if (!rawQuery || rawQuery.trim().length < 3) return;
  const supabase = _getSupabase();
  if (!supabase) return;
  try {
    const { data, error } = await supabase.rpc('suggest_teachings', {
      q: rawQuery.trim(),
      lang: activeLang,
    });
    if (error || !data || data.length === 0) return;
    // Se o user já editou a query e disparou outra busca, abortamos
    // para não sobrescrever resultados novos com sugestão antiga.
    const inputNow = document.getElementById('searchInput')?.value?.trim() || '';
    if (inputNow !== rawQuery.trim()) return;
    const basePath = getBasePath();
    const labelTxt = activeLang === 'ja' ? 'もしかして:' : 'Você quis dizer:';
    const linksHtml = data.map(s => {
      const title = (activeLang === 'ja' && s.title_ja) ? s.title_ja : (s.title_pt || '');
      const topicIdx = s.topic_idx != null ? s.topic_idx : 0;
      let href = `${basePath}reader.html?vol=${s.vol}&file=${s.file}`;
      if (topicIdx > 0) href += `&topic=${topicIdx}`;
      if (activeLang === 'ja') href += `&lang=ja`;
      return `<a href="${href}"
          class="search-suggest-link"
          data-vol="${escHtml(s.vol)}"
          data-file="${escHtml(s.file)}"
          data-topic="${topicIdx}"
          data-title="${escHtml(title)}">${escHtml(title)}</a>`;
    }).join('<span class="search-suggest-sep"> · </span>');
    const suggestLi =
      `<li class="search-suggest"><span class="search-suggest-label">${labelTxt}</span> ${linksHtml}</li>`;
    if (mode === 'prepend') {
      // Evita duplicar se a sugestão já está no topo.
      if (resultsEl.querySelector('.search-suggest')) return;
      resultsEl.insertAdjacentHTML('afterbegin', suggestLi);
    } else {
      const noResultsMsg = activeLang === 'ja' ? '結果が見つかりませんでした。' : 'Nenhum resultado.';
      resultsEl.innerHTML = suggestLi + `<li class="search-empty">${noResultsMsg}</li>`;
    }
  } catch (e) {
    // RPC ausente ou erro de rede — mantém a mensagem normal.
  }
}

// Heurística do "few-results trigger":
//   - sempre se results.length === 0 (já tratado fora desta função)
//   - se results.length < 3
//   - se results.length < 5 E o top rank for fraco (< 0.1 em PT, < 1.0 em JA).
//     Em PT, ts_rank_cd com normalization 33 retorna [0,1); empiricamente
//     matches relevantes ficam acima de 0.1. Em JA, rank=1.0 indica match
//     em título; abaixo disso só matched no corpo (sinal fraco).
function _shouldTriggerDidYouMean(results, activeLang) {
  if (!results || !results.length) return false;
  if (results.length < 3) return true;
  if (results.length < 5) {
    const topRank = Number(results[0]?.rank) || 0;
    const weakThreshold = activeLang === 'ja' ? 1.0 : 0.1;
    if (topRank < weakThreshold) return true;
  }
  return false;
}

// ---------------------------------------------------------------
// Busca SOB DEMANDA — nenhum modo busca enquanto digita.
// ---------------------------------------------------------------
// Decisão de UX (mobile): em vez de buscar a cada tecla (typeahead), TODOS
// os modos esperam o usuário apertar "Buscar" (botão no header) ou Enter /
// a tecla de busca do teclado (enterkeyhint="search"). Isso elimina o enxame
// de buscas lentas (Conteúdo/Relacionados) que travava no celular e estourava
// o timeout de 8s, e remove o re-render no meio da digitação que fechava o
// modal sozinho.

// Modos de SERVIDOR (FTS/Voyage pesado) buscam SOB DEMANDA; os LOCAIS
// (Título/Coleção) buscam instantâneo ao digitar.
function _isOnDemandMode() { return _searchMode === 'conteudo' || _searchMode === 'relacionados'; }

// Mostra/esconde o botão "Buscar" do header conforme o modo: só aparece nos
// modos sob demanda (nos locais a busca é instantânea, o botão seria inútil).
function _updateSearchButtonVisibility() {
  const btn = document.getElementById('searchSubmitBtn');
  if (btn) btn.style.display = _isOnDemandMode() ? '' : 'none';
}

// Roteia entre busca instantânea (local) e prompt sob demanda (servidor).
function _runOrPrompt(query) {
  if (_isOnDemandMode()) _renderSearchPrompt(query);
  else performSearch(query);
}

// Estado "aperte Buscar": some os resultados velhos e mostra o botão. O hint
// avisa que Relacionados (Voyage) pode demorar.
function _renderSearchPrompt(query) {
  const resultsEl = document.getElementById('searchResults');
  const activeLang = localStorage.getItem('site_lang') || 'pt';
  const q = (query || '').trim();
  _focusedIndex = -1;
  _updateSearchCount(0, 0, activeLang);
  if (!resultsEl) return;
  resultsEl.classList.remove('search-results--content');
  if (q.length < 2) { resultsEl.innerHTML = ''; return; }
  const label = activeLang === 'ja' ? '検索' : 'Buscar';
  const hint = _searchMode === 'relacionados'
    ? (activeLang === 'ja' ? '意味的検索 — 数秒かかることがあります' : 'Busca semântica — pode levar alguns segundos.')
    : (activeLang === 'ja' ? 'Enter または「検索」で実行' : 'Toque em Buscar ou aperte Enter.');
  resultsEl.innerHTML =
    `<li class="search-load-more search-related-prompt">` +
      `<button type="button" class="btn-load-more" onclick="runSearch()">${label}</button>` +
      `<span class="load-more-hint">${hint}</span>` +
    `</li>`;
}

// Dispara a busca do modo atual sob demanda — botão "Buscar" ou Enter.
window.runSearch = function() {
  const input = document.getElementById('searchInput');
  if (!input) return;
  const q = input.value.trim();
  if (q.length < 2) { _renderSearchPrompt(input.value); return; }
  _submittedQuery = q;
  performSearch(input.value);
};

// Injeta o botão "Buscar" no header do modal (idempotente). Feito em JS pra
// não duplicar markup no modals.js + nos 4 index inline dos volumes. Reusa
// .btn-load-more (botão accent já theme-aware) — sem build de CSS.
function _injectSearchButton() {
  const modal = document.getElementById('searchModal');
  if (!modal) return;
  // Esconde o × do modal de busca: ele é absoluto no canto e caía EM CIMA do
  // botão "Buscar". Dois markups: .modal-close-btn (modal dinâmico do
  // modals.js) e .search-close/#searchClose (index inline dos volumes).
  // Fechar segue por toque fora do painel ou tecla Esc.
  modal.querySelectorAll('.modal-close-btn, .search-close').forEach(b => { b.style.display = 'none'; });
  // "Texto literal" deixou de ser checkbox manual — virou fallback automático
  // (Conteúdo FTS volta zero → tenta ILIKE literal). Esconde + zera o estado.
  const litTog = modal.querySelector('#searchLiteralToggle');
  if (litTog) {
    litTog.checked = false;
    try { localStorage.removeItem('search_literal'); } catch (e) {}
    const w = litTog.closest('label') || litTog.parentElement;
    if (w) w.style.display = 'none';
  }
  if (modal.querySelector('#searchSubmitBtn')) { _updateSearchButtonVisibility(); return; }
  const input = modal.querySelector('#searchInput');
  if (!input) return;
  const lang = localStorage.getItem('site_lang') || 'pt';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'searchSubmitBtn';
  btn.className = 'btn-load-more search-submit-btn';
  btn.textContent = lang === 'ja' ? '検索' : 'Buscar';
  btn.addEventListener('click', () => window.runSearch());
  input.insertAdjacentElement('afterend', btn);
  _updateSearchButtonVisibility();
}

// Troca o modo de busca (clique no seletor ou no nudge). Se a query atual já
// foi buscada, re-roda no novo modo; senão mostra o prompt "Buscar".
window.switchSearchMode = function(mode, forceRun) {
  if (!_MODES.includes(mode)) return;
  _searchMode = mode;
  try { localStorage.setItem('search_mode', mode); } catch (e) {}
  const activeLang = localStorage.getItem('site_lang') || 'pt';
  _renderModeSelector(activeLang);
  _updateSearchButtonVisibility();
  const input = document.getElementById('searchInput');
  const q = input ? input.value.trim() : '';
  if (!q) {
    const resultsEl = document.getElementById('searchResults');
    if (resultsEl) resultsEl.innerHTML = '';
    _updateSearchCount(0, 0, activeLang);
    return;
  }
  if (!_isOnDemandMode()) { performSearch(input.value); return; } // local = instantâneo
  if (forceRun) performSearch(input.value);                       // nudge/explícito
  else _renderSearchPrompt(input.value);                          // servidor → prompt
};

// Render + contagem + sessão para os modos de LISTA PLANA (título/coleção).
function _finishFlat(resultsEl, q, activeLang, mySeq, nudgeContent) {
  if (mySeq !== _searchSeq) return;
  if (_flatItems.length === 0) {
    const none = activeLang === 'ja' ? '結果が見つかりませんでした。' : 'Nenhum resultado.';
    let extra = '';
    if (nudgeContent) {
      const t = activeLang === 'ja' ? '本文で検索しますか？' : 'Buscar essas palavras no Conteúdo?';
      extra = `<li class="search-mode-nudge"><button type="button" class="btn-load-more" onclick="switchSearchMode('conteudo', true)">${t}</button></li>`;
    }
    if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${none}</li>` + extra;
    _updateSearchCount(0, 0, activeLang);
    _displayedCount = 0;
    return;
  }
  _displayedCount = Math.min(GROUPS_PER_PAGE, _flatItems.length);
  const hl = _buildHighlightRegex(q, activeLang);
  if (resultsEl) resultsEl.innerHTML = _renderActive(_displayedCount, hl, q, activeLang);
  _updateSearchCount(_flatItems.length, _displayedCount, activeLang, _flatItems.length >= MAX_RESULTS);
  sessionStorage.setItem('searchQuery', q);
  if (resultsEl) sessionStorage.setItem('searchResultsHtml', resultsEl.innerHTML);
}

async function performSearch(query) {
  const _mySeq = ++_searchSeq;
  const resultsEl = document.getElementById('searchResults');
  const activeLang = localStorage.getItem('site_lang') || 'pt';

  if (!query || query.trim().length < 2) {
    if (!query || query.trim().length === 0) {
      if (resultsEl) resultsEl.innerHTML = '';
    } else {
      const minCharsMsg = activeLang === 'ja' ? '2文字以上入力してください...' : 'Digite pelo menos 2 caracteres...';
      if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${minCharsMsg}</li>`;
    }
    _updateSearchCount(0, 0, activeLang);
    return;
  }

  const q = query.trim();
  _currentQuery = q;
  _orFallbackActive = false;
  _allResults = []; _allGroups = []; _flatItems = []; _focusedIndex = -1;

  // Modo Conteúdo: o TRECHO é o protagonista — uma classe no container faz
  // o CSS rebaixar título/coletânea a contexto e destacar o snippet.
  if (resultsEl) resultsEl.classList.toggle('search-results--content', _searchMode === 'conteudo');

  const searchingMsg = activeLang === 'ja' ? '検索中...' : 'Buscando...';
  if (resultsEl) resultsEl.innerHTML = `<li class="search-loading"><span class="search-spinner"></span>${searchingMsg}</li>`;

  // ---- Modo TÍTULO: índice local de títulos reais (determinístico) ----
  if (_searchMode === 'titulo') {
    try {
      await _loadTitlesIndex();
      if (_mySeq !== _searchSeq) return;
      _flatItems = _searchTitlesIndex(q, activeLang);
      _finishFlat(resultsEl, q, activeLang, _mySeq, true); // nudge → Conteúdo
      logSearch(q, _flatItems.length, 0);
    } catch (err) {
      console.error('Título search erro:', err);
      if (resultsEl) resultsEl.innerHTML = `<li class="search-error">${activeLang === 'ja' ? 'エラー' : 'Erro na busca.'}</li>`;
    }
    return;
  }

  // ---- Modo COLEÇÃO: nome das publicações (SECTION_MAP, já carregado) ----
  if (_searchMode === 'colecao') {
    try {
      _flatItems = _searchCollections(q, activeLang);
      _finishFlat(resultsEl, q, activeLang, _mySeq, false);
      logSearch(q, _flatItems.length, 0);
    } catch (err) {
      console.error('Coleção search erro:', err);
      if (resultsEl) resultsEl.innerHTML = `<li class="search-error">${activeLang === 'ja' ? 'エラー' : 'Erro na busca.'}</li>`;
    }
    return;
  }

  // ---- Modos de SERVIDOR: Conteúdo (FTS) e Relacionados (semântico) ----
  const supabase = _getSupabase();
  if (!supabase) {
    const errMsg = activeLang === 'ja' ? 'ログインが必要です。' : 'Login necessário.';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-error">${errMsg}</li>`;
    return;
  }

  const exactToggle = document.getElementById('searchExactToggle');
  const useExactMatch = exactToggle ? exactToggle.checked : false;
  const literalToggle = document.getElementById('searchLiteralToggle');
  const useLiteralMode = literalToggle ? literalToggle.checked : false;
  const serverQuery = useLiteralMode ? q : _translateQuery(q, useExactMatch);
  if (!serverQuery) {
    const invalidMsg = activeLang === 'ja' ? '有効な検索ワードを入力してください...' : 'Digite termos de busca válidos...';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${invalidMsg}</li>`;
    return;
  }

  const isContentMode = _searchMode === 'conteudo';
  // Conteúdo: FTS no corpo (sem semântica). Relacionados: edge semântica.
  let scope = isContentMode ? 'content' : 'all';
  if (activeLang === 'ja' && q.length < 3 && scope !== 'content') scope = 'title';

  const _t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  try {
    // FTS-only (search_teachings) no modo Conteúdo — nada de embedding, pra
    // não despejar vizinhos semânticos. Relacionados usa a edge semântica.
    const runFetch = async (sq) => {
      if (useLiteralMode) {
        const r = await _withTimeout(supabase.rpc('search_teachings_literal', {
          q: sq, lang: activeLang, max_results: MAX_RESULTS, scope,
        }), SEARCH_TIMEOUT_MS, 'search_teachings_literal');
        return { data: r.data, error: r.error };
      }
      if (isContentMode) {
        // FTS puro via hybrid com embedding NULO (vector branch é pulado).
        // Vantagem sobre search_teachings: devolve content_excerpt (corpo
        // 1500 chars), que o _bodyWindow usa pra mostrar o trecho do corpo.
        // Fallback pra search_teachings se a hybrid não estiver acessível.
        const r = await _withTimeout(supabase.rpc('search_teachings_hybrid', {
          q: sq, q_embedding: null, lang: activeLang, max_results: MAX_RESULTS, scope, use_fts: true,
        }), SEARCH_TIMEOUT_MS, 'search_teachings_hybrid (conteúdo)');
        if (r.error) {
          console.warn('hybrid(conteúdo) falhou, fallback search_teachings:', r.error?.message || r.error);
          const f = await _withTimeout(supabase.rpc('search_teachings', {
            q: sq, lang: activeLang, max_results: MAX_RESULTS, scope,
          }), SEARCH_TIMEOUT_MS, 'search_teachings (conteúdo fallback)');
          return { data: f.data, error: f.error };
        }
        return { data: r.data, error: r.error };
      }
      // Relacionados: híbrida semântica (fallback FTS se a edge cair).
      try {
        const { data: edgeData, error: edgeError } = await _withTimeout(
          supabase.functions.invoke('search-semantic', { body: { q: sq, lang: activeLang, max_results: MAX_RESULTS, scope } }),
          SEARCH_TIMEOUT_MS, 'search-semantic');
        if (edgeError) throw edgeError;
        return { data: edgeData?.data ?? [], error: null };
      } catch (edgeErr) {
        console.warn('search-semantic indisponível, fallback FTS:', edgeErr?.message || edgeErr);
        const r = await _withTimeout(supabase.rpc('search_teachings', {
          q: sq, lang: activeLang, max_results: MAX_RESULTS, scope,
        }), SEARCH_TIMEOUT_MS, 'search_teachings (fallback)');
        return { data: r.data, error: r.error };
      }
    };

    let { data, error } = await runFetch(serverQuery);
    const _latencyMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0;
    if (_mySeq !== _searchSeq) return;

    if (error) {
      console.error('search RPC error:', error);
      const errMsg = activeLang === 'ja' ? '検索に失敗しました。' : 'Erro ao buscar. Tente novamente.';
      if (resultsEl) resultsEl.innerHTML = `<li class="search-error">${errMsg}</li>`;
      _updateSearchCount(0, 0, activeLang);
      return;
    }

    let results = data || [];

    // Conteúdo multi-palavra: a unidade indexada é o TRECHO; quando AND não
    // acha nenhum trecho com TODAS as palavras (ex.: "Vingança Ushitora
    // alegria"), refaz com OR e agrupa por publicação — a cobertura (quantos
    // termos a publicação reúne) ordena, trazendo quem tem todas ao topo.
    const terms = _splitTerms(q);
    if (isContentMode && results.length === 0 && !useLiteralMode && terms.length >= 2) {
      const orQuery = useExactMatch ? terms.map(t => `"${t.replace(/"/g, '\\"')}"`).join(' or ') : terms.join(' or ');
      const orRes = await runFetch(orQuery);
      if (_mySeq !== _searchSeq) return;
      if (!orRes.error && orRes.data && orRes.data.length > 0) { results = orRes.data; _orFallbackActive = true; }
    }

    // Fallback automático: o FTS não achou (kanji que o pt_unaccent não
    // tokeniza, ou frase/substring exata) → tenta o ILIKE literal por baixo,
    // que casa substring crua em todos os campos PT+JA. Substitui o antigo
    // checkbox "Texto literal".
    if (isContentMode && results.length === 0 && !useLiteralMode) {
      try {
        const lit = await _withTimeout(supabase.rpc('search_teachings_literal', {
          q, lang: activeLang, max_results: MAX_RESULTS, scope: 'content',
        }), SEARCH_TIMEOUT_MS, 'search_teachings_literal (auto)');
        if (_mySeq !== _searchSeq) return;
        if (!lit.error && lit.data && lit.data.length > 0) results = lit.data;
      } catch (e) { /* mantém 0 → mensagem normal */ }
    }

    if (results.length === 0) {
      const noResultsMsg = activeLang === 'ja' ? '結果が見つかりませんでした。' : 'Nenhum resultado.';
      let extra = '';
      if (isContentMode) {
        const t = activeLang === 'ja' ? '関連で検索しますか？' : 'Tentar em Relacionados?';
        extra = `<li class="search-mode-nudge"><button type="button" class="btn-load-more" onclick="switchSearchMode('relacionados', true)">${t}</button></li>`;
      }
      if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${noResultsMsg}</li>` + extra;
      _updateSearchCount(0, 0, activeLang);
      logSearch(q, 0, _latencyMs);
      sessionStorage.removeItem('searchQuery'); sessionStorage.removeItem('searchResultsHtml');
      _displayedCount = 0;
      return;
    }

    const highlightRegex = _buildHighlightRegex(q, activeLang);
    _allResults = results;
    _allGroups = _groupResults(results, q, activeLang);
    _displayedCount = Math.min(GROUPS_PER_PAGE, _allGroups.length);
    resultsEl.innerHTML = _renderActive(_displayedCount, highlightRegex, q, activeLang);
    const ordered = _orderGroups(_allGroups, _orFallbackActive);
    const shownHits = ordered.slice(0, _displayedCount).reduce((n, g) => n + g.hits.length, 0);
    _updateSearchCount(results.length, shownHits, activeLang, results.length >= MAX_RESULTS, _allGroups.length, _displayedCount);
    logSearch(q, results.length, _latencyMs);

    sessionStorage.setItem('searchQuery', query);
    sessionStorage.setItem('searchResultsHtml', resultsEl.innerHTML);
  } catch (err) {
    console.error('Search exception:', err);
    const errMsg = activeLang === 'ja' ? 'エラーが発生しました。' : 'Erro inesperado na busca.';
    if (resultsEl) resultsEl.innerHTML = `<li class="search-error">${errMsg}</li>`;
  }
}

window.loadMoreResults = function() {
  const total = _activeTotal();
  if (!total) return;
  _displayedCount = Math.min(_displayedCount + GROUPS_PER_PAGE, total);
  const resultsEl = document.getElementById('searchResults');
  if (!resultsEl) return;
  const activeLang = localStorage.getItem('site_lang') || 'pt';
  const highlightRegex = _buildHighlightRegex(_currentQuery, activeLang);
  resultsEl.innerHTML = _renderActive(_displayedCount, highlightRegex, _currentQuery, activeLang);
  if (_searchMode === 'titulo' || _searchMode === 'colecao') {
    _updateSearchCount(total, _displayedCount, activeLang);
  } else {
    const ordered = _orderGroups(_allGroups, _orFallbackActive);
    const shownHits = ordered.slice(0, _displayedCount).reduce((n, g) => n + g.hits.length, 0);
    const totalHits = ordered.reduce((n, g) => n + g.hits.length, 0);
    _updateSearchCount(totalHits, shownHits, activeLang, false, total, _displayedCount);
  }
  _focusedIndex = -1;
  sessionStorage.setItem('searchResultsHtml', resultsEl.innerHTML);
};

// PT: snippet vem da RPC com <mark> (sem class). Escapa todo o resto, preserva
// os marks e injeta a classe pro CSS de highlight pegar.
// JA: snippet vem como substring puro (sem mark). Escapa e aplica regex client-side.
function _styleSnippet(rawSnippet, activeLang, highlightRegex) {
  if (!rawSnippet) return '';
  if (activeLang === 'ja') {
    const escaped = escHtml(rawSnippet);
    return highlightRegex
      ? escaped.replace(highlightRegex, '<mark class="search-highlight">$1</mark>')
      : escaped;
  }
  // PT: split mantendo os tokens <mark>/</mark>; escapa só o texto entre eles.
  return rawSnippet.split(/(<mark>|<\/mark>)/g).map(part => {
    if (part === '<mark>') return '<mark class="search-highlight">';
    if (part === '</mark>') return '</mark>';
    return escHtml(part);
  }).join('');
}

