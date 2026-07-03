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
let _currentQuery = '';
// true quando os resultados (seção Conteúdo) vieram por COBERTURA OR — as
// palavras casam em trechos diferentes da mesma publicação, não juntas num
// só trecho (ex.: "Vingança Ushitora alegria"). Banner explica.
let _orFallbackActive = false;
// A busca é UMA só (não há mais modos Literal/Relacionados): Título e
// Coleção respondem AO DIGITAR (índices locais, custo zero); Conteúdo (FTS)
// roda no Enter/botão da seção e chega de forma ASSÍNCRONA na própria seção;
// Relacionados (semântica) roda sozinho quando o Conteúdo volta vazio, ou
// sob demanda pelo chip. Os chips de filtro só mostram/escondem seções já
// buscadas — nunca disparam uma busca nova (exceto o chip Relacionados
// quando a semântica ainda não rodou).
const _FILTER_KEYS = ['all', 'titulo', 'colecao', 'conteudo', 'relacionados'];
let _activeFilter = 'all';
// Query efetivamente submetida (≠ texto digitado, que só gera preview local).
let _submittedQuery = '';

// ---------------------------------------------------------------
// Cache de RPC em memória — a mesma query re-buscada na sessão volta
// instantânea ("johrei" foi buscada 77× em 90 dias, cada uma pagando
// segundos de FTS no free tier). Só memória: sessionStorage estouraria
// a cota com os content_excerpt de 1500 chars.
// ---------------------------------------------------------------
const _RPC_CACHE_TTL = 10 * 60 * 1000;
const _RPC_CACHE_MAX = 24;
const _rpcCache = new Map(); // key → { value, ts }
function _cacheKey(kind, q, lang, exact) {
  return `${kind}|${lang}|${exact ? 1 : 0}|${_norm(q)}`;
}
function _cacheGet(key) {
  const e = _rpcCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > _RPC_CACHE_TTL) { _rpcCache.delete(key); return null; }
  return e.value;
}
function _cacheSet(key, value) {
  if (_rpcCache.size >= _RPC_CACHE_MAX) _rpcCache.delete(_rpcCache.keys().next().value);
  _rpcCache.set(key, { value, ts: Date.now() });
}
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
// Conteúdo/semântica têm timeout PRÓPRIO, mais folgado: desde que a seção
// carrega assíncrona (o resto da UI já está pintado), esperar um pico do
// free tier não trava nada — e o p90 medido era ~11,5s justamente porque
// buscas zeradas encadeavam fallbacks lentos.
const CONTENT_TIMEOUT_MS = 12000;
const SEMANTIC_TIMEOUT_MS = 12000;
// A RPC hybrid com embedding nulo devolve no máx. 50 linhas (v_candidates);
// 40 é o sweet spot medido (~516ms vs ~1100ms com 100 no termo "johrei").
const CONTENT_MAX_RESULTS = 40;

// Dicionário curado alias→consulta canônica, validado contra o corpus
// (07/2026): só entra par onde o alias retorna ~0 no FTS e o canônico
// retorna farto. A edge semântica tem a tabela search_aliases pra isso;
// aqui cobre o caminho FTS. Manter PEQUENO — o fallback semântico já
// resgata o resto.
const _SYNONYMS = {
  'artrose': 'artrite',
};

// Kanji/kana na query → o FTS pt_unaccent não tokeniza; só nesse caso vale
// pagar o ILIKE literal (seq scan de ~10s no free tier). Pra PT puro o
// resgate é a semântica, muito mais barata. Faixas: hiragana+katakana
// (3040-30FF), CJK ext.A+unificado (3400-9FFF), compat (F900-FAFF).
function _hasCJK(s) {
  return /[぀-ヿ㐀-鿿豈-﫿]/.test(s || '');
}

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

// Publicações onde o usuário TEM grifos (localStorage userHighlights) —
// badge "você grifou" nos resultados: reencontrar o que já marcou é um dos
// principais usos da busca. Cache lazy por busca (_hlPubs zerado no
// performSearch/preview).
let _hlPubs = null;
function _highlightedPubs() {
  if (_hlPubs) return _hlPubs;
  try {
    const hs = JSON.parse(localStorage.getItem('userHighlights') || '[]');
    _hlPubs = new Set(hs.map(h => `${h.vol}/${h.file}`));
  } catch (e) { _hlPubs = new Set(); }
  return _hlPubs;
}
function _hlBadge(vol, file, activeLang) {
  if (!_highlightedPubs().has(`${vol}/${file}`)) return '';
  return `<span class="search-badge search-badge--grifo">${activeLang === 'ja' ? 'ハイライトあり' : 'você grifou'}</span>`;
}

// "Só nos lidos": reencontrar algo que o usuário SABE que já leu, mas não
// lembra onde. Filtra os resultados JÁ trazidos (sem refazer a busca) contra
// o readMarks local — igual em espírito ao badge de grifo acima (_hlPubs),
// mas aqui por TÓPICO (vol/file/topic), não só por publicação, porque o
// read mark é por tópico (js/reader.js) e os resultados de busca também.
let _onlyReadFilter = false;
let _readMarks = null;
function _readMarksSet() {
  if (_readMarks) return _readMarks;
  try {
    const marks = JSON.parse(localStorage.getItem('readMarks') || '[]');
    _readMarks = new Set(marks.map(m => `${m.vol}/${m.file}/${m.topic || 0}`));
  } catch (e) { _readMarks = new Set(); }
  return _readMarks;
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
// contentFocused = renderiza com o TRECHO do corpo em destaque (seção Conteúdo
// do modo Literal); sem ele, mostra título + snippet (Relacionados).
function _renderHit(hit, g, basePath, highlightRegex, q, activeLang, contentFocused) {
  const href = _searchLink(basePath, g.vol, g.file, hit.topicIdx, q, activeLang);
  const ex = hit._extracted; // { title, body } | null
  let titleHtml = '';
  let snippetSrc = hit.snippet;

  if (contentFocused) {
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

function _renderGroup(g, basePath, highlightRegex, q, activeLang, contentFocused) {
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
  badge += _hlBadge(g.vol, g.file, activeLang);

  const hitsLabel = hits.length > 1
    ? (activeLang === 'ja' ? `${hits.length}件` : `${hits.length} ${isContainer ? 'ensinamentos' : 'trechos'}`)
    : '';
  const hitsHtml = hits.map(h => _renderHit(h, g, basePath, highlightRegex, q, activeLang, contentFocused)).join('');

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
// Chips de filtro (Tudo / Títulos / Coleções / Conteúdo / Relacionados)
// ---------------------------------------------------------------
// As chaves titulo/colecao/conteudo/relacionados também rotulam as SEÇÕES.
const _MODE_LABELS = {
  pt: { tudo: 'Tudo', titulo: 'Títulos', conteudo: 'Conteúdo', colecao: 'Coleções', relacionados: 'Relacionados' },
  ja: { tudo: 'すべて', titulo: 'タイトル', conteudo: '本文', colecao: '叢書', relacionados: '関連' },
};

// Chips refletem o estado de cada seção: contagem quando pronta, "…"
// desabilitado enquanto carrega. Só aparecem após uma busca completa
// (no preview de digitação a barra fica oculta — evita flicker).
function _renderFilterChips() {
  const bar = document.getElementById('searchModeSelector');
  if (!bar) return;
  if (!_literal || _literal.preview) {
    bar.innerHTML = '';
    bar.style.display = 'none';
    return;
  }
  const lang = _literal.lang;
  const labels = _MODE_LABELS[lang === 'ja' ? 'ja' : 'pt'];
  const chip = (key, label, count, disabled) => {
    const n = (count == null) ? '' : `<span class="search-chip-count">${count}</span>`;
    const active = _activeFilter === key;
    return `<button type="button" class="search-mode-btn${active ? ' is-active' : ''}"
      aria-pressed="${active}" data-filter="${key}"${disabled ? ' disabled' : ''}>${label}${n}</button>`;
  };
  const K = _literal.conteudo;
  const R = _literal.relacionados;
  let html = chip('all', labels.tudo, null);
  if (_literal.titulo.items.length || _activeFilter === 'titulo') html += chip('titulo', labels.titulo, _literal.titulo.items.length);
  if (_literal.colecao.items.length || _activeFilter === 'colecao') html += chip('colecao', labels.colecao, _literal.colecao.items.length);
  if (K.state === 'loading') html += chip('conteudo', labels.conteudo, '…', true);
  else if (K.groups.length || _activeFilter === 'conteudo') html += chip('conteudo', labels.conteudo, K.groups.length);
  // Relacionados sempre presente: quando a semântica ainda não rodou, o
  // chip DISPARA a busca (setSearchFilter cuida disso).
  if (R.state === 'loading') html += chip('relacionados', labels.relacionados, '…', true);
  else if (R.state === 'done') html += chip('relacionados', labels.relacionados, R.groups.length);
  else html += chip('relacionados', labels.relacionados, null);
  bar.innerHTML = html;
  bar.style.display = '';
}

// Gesto ativo dentro de #searchResults → adia o re-render assíncrono. A
// seção Conteúdo pode resolver até ~12s depois do submit; trocar o innerHTML
// no meio de um toque re-alveja o gesto e MATA o click num resultado que já
// estava visível (mesma família do bug do backdrop no mobile).
let _resultsPointerDown = false;
let _pendingRefresh = false;

// Re-renderiza resultados + chips + contador a partir do estado atual.
function _refreshResults() {
  if (_resultsPointerDown) { _pendingRefresh = true; return; }
  const resultsEl = document.getElementById('searchResults');
  if (resultsEl && _literal) resultsEl.innerHTML = _renderLiteral();
  _applyOnlyReadFilter();
  _renderFilterChips();
  if (_literal && !_literal.preview) {
    _combinedCount(_literal.titulo.items.length, _literal.colecao.items.length,
      _literal.conteudo.groups.length, _literal.relacionados, _literal.lang);
  }
  _focusedIndex = -1;
}

// Classes de <li> que NÃO são "item de dado" clicável — cabeçalhos, notas,
// spinners, banners e botões de paginação. Usado só pra decidir se uma
// seção/grupo esvaziou por completo depois do filtro "só nos lidos".
const _NON_DATA_LI_CLASSES = ['search-section-head', 'search-section-note', 'search-load-more',
  'search-section-loading', 'search-related-prompt', 'search-or-banner', 'search-empty', 'search-empty-state'];
function _isDataLi(li) {
  return !_NON_DATA_LI_CLASSES.some(c => li.classList.contains(c));
}

// Reaplica (ou desfaz) o filtro "só nos lidos" sobre o HTML JÁ renderizado —
// NÃO refaz a busca (é instantâneo, ao contrário de "Palavra exata"/"Texto
// literal", que mudam o que o servidor devolve). Esconde hits/itens que o
// usuário não marcou como lido; grupos e cabeçalhos de seção somem junto
// quando ficam sem nenhum item visível. Chamado a cada _refreshResults() e
// direto pelo próprio checkbox (mudar o toggle não deve custar um round-trip).
function _applyOnlyReadFilter() {
  const resultsEl = document.getElementById('searchResults');
  if (!resultsEl) return;
  if (!_onlyReadFilter) {
    resultsEl.querySelectorAll('[data-read-hidden]').forEach(li => {
      li.style.display = '';
      li.removeAttribute('data-read-hidden');
    });
    const oldNote = document.getElementById('searchOnlyReadEmptyNote');
    if (oldNote) oldNote.remove();
    return;
  }
  const readSet = _readMarksSet();
  const isRead = (a) => a && readSet.has(`${a.dataset.vol}/${a.dataset.file}/${a.dataset.topic || 0}`);

  // 1) Itens-folha: hits dentro de grupos (Conteúdo/Relacionados) e itens das
  //    listas planas (Título/Coleção). O cabeçalho de grupo (que também é um
  //    .search-nav-item, linkando pro tópico 0 ou o 1º hit) fica de fora
  //    aqui — sua visibilidade é decidida no passo 2, pelos hits abaixo dele.
  resultsEl.querySelectorAll('.search-nav-item').forEach(a => {
    const li = a.closest('li');
    if (!li || li.querySelector('.search-group-hits')) return; // é o cabeçalho de um grupo
    const visible = isRead(a);
    li.style.display = visible ? '' : 'none';
    li.toggleAttribute('data-read-hidden', !visible);
  });

  // 2) Grupos: o grupo inteiro (cabeçalho + lista) some se NENHUM hit dele
  //    sobreviveu ao passo 1.
  resultsEl.querySelectorAll('li.search-group').forEach(groupLi => {
    const hitsUl = groupLi.querySelector('.search-group-hits');
    const anyVisible = !!hitsUl && Array.from(hitsUl.children).some(li => li.style.display !== 'none');
    groupLi.style.display = anyVisible ? '' : 'none';
    groupLi.toggleAttribute('data-read-hidden', !anyVisible);
  });

  // 3) Cabeçalhos de seção (Títulos/Coleções/Conteúdo/Relacionados): somem
  //    SÓ quando a seção TINHA item(ns) e o filtro escondeu todos — uma
  //    seção que nunca teve item (prompt "Buscar no conteúdo", aviso de
  //    login, "nenhum trecho encontrado") não é filtrável por lido/não-lido
  //    e deve continuar visível, filtro ligado ou não. Percorre os <li> na
  //    ordem em que _renderLiteral() os escreveu, agrupando cada cabeçalho
  //    com tudo que vem depois dele até o próximo cabeçalho (ou o fim).
  // sectionExtras: botões "Carregar mais N" DA PRÓPRIA seção (só existem
  // quando a seção TEM itens) — precisam sumir junto com o cabeçalho, senão
  // sobra um "Carregar mais" órfão sem rótulo de seção acima dele.
  let currentHeader = null, hadAnyItem = false, sawVisibleData = false, sectionExtras = [];
  const closeSection = () => {
    if (!currentHeader) return;
    const shouldHide = hadAnyItem && !sawVisibleData;
    currentHeader.style.display = shouldHide ? 'none' : '';
    currentHeader.toggleAttribute('data-read-hidden', shouldHide);
    sectionExtras.forEach(li => {
      li.style.display = shouldHide ? 'none' : '';
      li.toggleAttribute('data-read-hidden', shouldHide);
    });
  };
  Array.from(resultsEl.children).forEach(li => {
    if (li.classList.contains('search-section-head')) {
      closeSection();
      currentHeader = li;
      hadAnyItem = false;
      sawVisibleData = false;
      sectionExtras = [];
      return;
    }
    if (li.classList.contains('search-load-more')) sectionExtras.push(li);
    if (_isDataLi(li)) {
      hadAnyItem = true;
      if (li.style.display !== 'none') sawVisibleData = true;
    }
  });
  closeSection();

  // Nota explicativa quando o filtro escondeu TUDO — sem isso, a lista fica
  // em branco e parece "busca sem resultado" (é o filtro, não a busca).
  const oldNote = document.getElementById('searchOnlyReadEmptyNote');
  if (oldNote) oldNote.remove();
  const totalNavItems = resultsEl.querySelectorAll('.search-nav-item').length;
  const anyVisibleOverall = Array.from(resultsEl.querySelectorAll('.search-nav-item'))
    .some(a => { const li = a.closest('li'); return li && li.style.display !== 'none'; });
  if (totalNavItems > 0 && !anyVisibleOverall) {
    const lang = (_literal && _literal.lang) || (localStorage.getItem('site_lang') || 'pt');
    const note = document.createElement('li');
    note.id = 'searchOnlyReadEmptyNote';
    note.className = 'search-empty';
    note.textContent = lang === 'ja'
      ? 'この検索結果の中に、既読の教えはありませんでした。'
      : 'Nenhum resultado desta busca está entre os Ensinamentos que você já marcou como lido.';
    resultsEl.prepend(note);
  }
}

// Persiste o HTML dos resultados pro back-restore — NUNCA no meio de um
// carregamento (restauraria um spinner morto, sem estado pra resolvê-lo) e
// SEMPRE a visão completa: o restore não reconstrói os chips, então uma
// visão filtrada persistida deixaria as outras seções irrecuperáveis.
function _persistResultsHtml() {
  if (!_literal || _literal.preview) return;
  if (_literal.conteudo.state === 'loading' || _literal.relacionados.state === 'loading') return;
  let html;
  if (_activeFilter === 'all') {
    const el = document.getElementById('searchResults');
    html = el ? el.innerHTML : '';
  } else {
    const prev = _activeFilter;
    _activeFilter = 'all';
    try { html = _renderLiteral(); } finally { _activeFilter = prev; }
  }
  if (html) sessionStorage.setItem('searchResultsHtml', html);
}

// Troca o filtro ativo. 'relacionados' com semântica ainda não rodada
// dispara a busca sob demanda (único chip que busca algo).
window.setSearchFilter = function(key) {
  if (!_FILTER_KEYS.includes(key) || !_literal || _literal.preview) return;
  _activeFilter = key;
  if (key === 'relacionados' && (_literal.relacionados.state === 'idle' || _literal.relacionados.state === 'error')) {
    _runSemantic(false, _searchSeq);
  }
  _refreshResults();
  _persistResultsHtml();
};

function _loadMoreLabel(nextN, activeLang) {
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
    const hlB = _hlBadge(it.vol, it.file, activeLang);
    const crumb = (it.crumb || hlB) ? `<div class="search-flat-crumb">${escHtml(it.crumb || '')}${hlB}</div>` : '';
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

// Toast efêmero do sorteio — reusa o visual .hl-toast (CSS global em
// _highlights.css, carregado em todas as páginas; z-index 9900 fica acima
// do overlay de login). Antes as falhas eram CALADAS: o botão girava e
// voltava sem explicação (sessão expirada no navegador = RPC como anon =
// lista vazia — "funciona num navegador, não funciona no outro").
function _randomToast(message) {
  try {
    const prev = document.getElementById('searchRandomToast');
    if (prev) prev.remove();
    const t = document.createElement('div');
    t.id = 'searchRandomToast';
    t.className = 'hl-toast';
    t.textContent = message;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('hl-toast--visible'));
    setTimeout(() => {
      t.classList.remove('hl-toast--visible');
      setTimeout(() => t.remove(), 300);
    }, 4200);
  } catch (_) { /* noop */ }
}

async function _pickRandomViaRpc(onlyVol, loader) {
  const lang = localStorage.getItem('site_lang') || 'pt';
  const supabase = _getSupabase();
  if (!supabase) { loader.restore(); return; }

  // Sessão ANTES da RPC: random_teaching só tem grant pra authenticated —
  // sem sessão ela devolve [] (sem erro!). getSession() ainda RENOVA um
  // access token vencido quando o refresh token vale (aba/navegador parado
  // há dias), consertando o caso "logado na tela, deslogado no banco".
  let hasSession = false;
  try {
    const { data: s } = await supabase.auth.getSession();
    hasSession = !!(s && s.session);
  } catch (_) { /* trata como sem sessão */ }
  if (!hasSession) {
    loader.restore();
    _randomToast(lang === 'ja'
      ? 'セッションが切れました。もう一度ログインしてください。'
      : 'Sua sessão expirou. Entre novamente para sortear um Ensinamento.');
    if (!document.getElementById('login-overlay')
        && window.supabaseAuth && typeof window.supabaseAuth.showLoginOverlay === 'function') {
      window.supabaseAuth.showLoginOverlay();
    }
    return;
  }

  const { data, error } = await supabase.rpc('random_teaching', { only_vol: onlyVol });
  if (error) {
    console.warn('random_teaching RPC error:', error);
    loader.restore();
    _randomToast(lang === 'ja'
      ? '抽選に失敗しました。もう一度お試しください。'
      : `Não foi possível sortear agora (${error.message || 'erro'}). Tente de novo.`);
    return;
  }
  if (!data || data.length === 0) {
    loader.restore();
    _randomToast(lang === 'ja'
      ? '御教えが見つかりませんでした。もう一度ログインしてみてください。'
      : 'Nenhum Ensinamento disponível para sortear. Tente entrar novamente.');
    return;
  }

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
  const clearBtn = document.getElementById('searchClear');
  if (input) {
    input.value = '';
    input.focus();
  }
  if (clearBtn) clearBtn.style.display = 'none';
  _updateSearchCount(0, 0, localStorage.getItem('site_lang') || 'pt');
  sessionStorage.removeItem('searchQuery');
  sessionStorage.removeItem('searchResultsHtml');
  _literal = null;
  _orFallbackActive = false;
  _activeFilter = 'all';
  _currentQuery = '';
  _submittedQuery = '';
  _focusedIndex = -1;
  _renderEmptyState();
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

      const resultsEl = document.getElementById('searchResults');
      if (!input.value.trim()) {
        // Vazio: empty state limpo (só se não há nada renderizado — não
        // sobrescreve o empty state que o clearSearch acabou de pintar).
        if (resultsEl && !resultsEl.querySelector('.search-empty-state')) _renderEmptyState();
      } else if (resultsEl && !resultsEl.querySelector('.search-nav-item') && !_literal) {
        // Query restaurada sem resultados renderizados: preview local
        // instantâneo (Título/Coleção) + convite pra buscar no conteúdo.
        // `!_literal` = só no restore de sessionStorage (estado em memória
        // nunca é restaurado); com _literal vivo, o DOM já reflete uma busca
        // em andamento — rodar o preview aqui CANCELARIA o FTS em voo.
        _performLocalPreview(input.value);
      }
    }
    _loadSectionMaps();
    _renderFilterChips();
    _prepSearchChrome();
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
          (lang === 'ja' ? ' 結果に戻る' : ' Resultados') +
        '</button>' +
        '<span class="search-preview-badge" id="searchPreviewBadge">' + quicklookLabel + '</span>' +
        '<button class="modal-close-btn search-preview-close" onclick="closeSearchPreview()" aria-label="' + (lang === 'ja' ? '\u30d7\u30ec\u30d3\u30e5\u30fc\u3092\u9589\u3058\u308b' : 'Fechar preview') + '">\u00d7</button>' +
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
    const msg = lang === 'ja' ? 'コンテンツを利用できません。' : 'Conteúdo indisponível.';
    renderCardContent('<p style="padding:2rem;text-align:center;color:var(--text-muted);">' + msg + '</p>');
  }

  const loadingMsg = lang === 'ja' ? '教えの全文を読み込んでいます…' : 'Carregando o ensinamento completo...';
  renderCardContent('<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.95rem;">' + loadingMsg + '</div>');

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
        // O estado interno (_literal) NÃO é restaurado — botões de paginação
        // no HTML restaurado re-rodam a busca (perda aceitável vs. serializar
        // os grupos). O essencial — items clicáveis com data-attrs — está no HTML.
        // Reescreve hrefs relativos salvos pro basePath da página atual.
        // Sem isto, quando o usuário busca no home (href = ./reader.html)
        // e depois navega pra mioshiec3/, o ./reader.html restaurado
        // resolve pra mioshiec3/reader.html (404). Vale o inverso também.
        const cur = getBasePath();
        resultsEl.querySelectorAll('a[href^="./"], a[href^="../"]').forEach(a => {
          a.setAttribute('href', a.getAttribute('href').replace(/^\.\.?\//, cur));
        });
        // HTML restaurado não passa por _refreshResults() — reaplica "só nos
        // lidos" aqui pra não perder o filtro num back/forward do navegador.
        _applyOnlyReadFilter();
      }
    }
  }

  const triggerSearch = () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value;
    const clearBtn = document.getElementById('searchClear');
    if (clearBtn) clearBtn.style.display = query.trim() ? 'flex' : 'none';

    const currentLang = localStorage.getItem('site_lang') || 'pt';
    _focusedIndex = -1;
    _updateSearchCount(0, 0, currentLang);

    if (!query.trim()) {
      _renderEmptyState();
      return;
    }

    // Digitar responde na hora com o que é LOCAL (Título/Coleção, custo
    // zero) + convite pra buscar no conteúdo. O FTS/semântica (servidor)
    // só roda no Enter/botão da seção Conteúdo — evita o enxame de buscas lentas
    // que travava no celular.
    searchTimeout = setTimeout(() => _performLocalPreview(query), 160);
  };

  if (searchInput) searchInput.addEventListener('input', triggerSearch);

  // Chips de filtro: mostram/escondem seções já buscadas (setSearchFilter).
  const modeSelector = document.getElementById('searchModeSelector');
  if (modeSelector) {
    modeSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.search-mode-btn');
      if (!btn || btn.disabled) return;
      setSearchFilter(btn.dataset.filter || 'all');
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

  // "Só nos lidos" — ao contrário de exact/literal, NÃO refaz a busca (o
  // servidor não sabe o que está marcado como lido; o filtro é 100%
  // client-side sobre o que já está na tela). Ver _applyOnlyReadFilter.
  const readOnlyToggle = document.getElementById('searchReadOnlyToggle');
  if (readOnlyToggle) {
    readOnlyToggle.checked = localStorage.getItem('search_only_read') === 'true';
    _onlyReadFilter = readOnlyToggle.checked;
    readOnlyToggle.addEventListener('change', () => {
      _onlyReadFilter = readOnlyToggle.checked;
      try { localStorage.setItem('search_only_read', _onlyReadFilter); } catch (e) { }
      // Relê o readMarks no próprio toque no checkbox — o cache (_readMarks)
      // só é zerado por padrão numa busca nova; sem isto, marcar algo como
      // lido no leitor numa aba e voltar pra uma busca já aberta noutra
      // mostraria o estado velho até o usuário redigitar a query.
      _readMarks = null;
      _applyOnlyReadFilter();
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

  // Clicar num resultado segue o <a href> nativo direto pro reader (que
  // cuida de highlight + auto-scroll). Aqui só delegamos os CHIPS do empty
  // state (recentes/temas): preenche o input e dispara a busca completa.
  const resultsContainer = document.getElementById('searchResults');
  if (resultsContainer) {
    // Rastreio do gesto pro _refreshResults adiado: pointerdown dentro dos
    // resultados segura o re-render; o click nativo do <a> dispara DEPOIS
    // do pointerup, então o swap adiado por um tick preserva a navegação.
    resultsContainer.addEventListener('pointerdown', () => { _resultsPointerDown = true; }, true);
    const _endGesture = () => {
      _resultsPointerDown = false;
      if (_pendingRefresh) {
        _pendingRefresh = false;
        setTimeout(() => { _refreshResults(); _persistResultsHtml(); }, 0);
      }
    };
    document.addEventListener('pointerup', _endGesture, true);
    document.addEventListener('pointercancel', _endGesture, true);

    resultsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-chip-q]');
      if (!chip) return;
      const input = document.getElementById('searchInput');
      if (input) {
        input.value = chip.dataset.chipQ || '';
        const clearBtn = document.getElementById('searchClear');
        if (clearBtn) clearBtn.style.display = input.value.trim() ? 'flex' : 'none';
      }
      runSearch();
    });
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
// PREVIEW LOCAL ao digitar + busca completa no Enter/Buscar.
// ---------------------------------------------------------------
// Decisão de UX (mobile): digitar NUNCA bate no servidor — só nos índices
// locais (Título/Coleção), que respondem em ~0ms. Isso dá feedback imediato
// sem o enxame de buscas FTS lentas que travava no celular. A busca completa
// (Conteúdo/Relacionados) roda no Enter, no botão da seção Conteúdo ou na
// tecla de busca do teclado (enterkeyhint="search").

// Preview de digitação: seções Título/Coleção reais + seção Conteúdo em
// estado "prompt" (convite pra apertar Buscar). Incrementa o seq — digitar
// de novo cancela qualquer busca completa em voo.
async function _performLocalPreview(query) {
  const _mySeq = ++_searchSeq;
  const q = (query || '').trim();
  const activeLang = localStorage.getItem('site_lang') || 'pt';
  const resultsEl = document.getElementById('searchResults');
  if (q.length < 2) {
    if (resultsEl) {
      const minCharsMsg = activeLang === 'ja' ? '2文字以上入力してください...' : 'Digite pelo menos 2 caracteres...';
      resultsEl.innerHTML = `<li class="search-empty">${minCharsMsg}</li>`;
    }
    // Sem estado órfão: <2 chars = "não há busca" (um _literal de preview
    // antigo aqui reapareceria com spinner morto ao reabrir o modal).
    _literal = null;
    _activeFilter = 'all';
    _renderFilterChipsHidden();
    return;
  }
  await _loadTitlesIndex();
  if (_mySeq !== _searchSeq) return;
  const titleItems = _searchTitlesIndex(q, activeLang);
  const collItems = _searchCollections(q, activeLang);
  _currentQuery = q;
  _orFallbackActive = false;
  _activeFilter = 'all';
  _hlPubs = null;
  _readMarks = null;
  _literal = {
    q, lang: activeLang, preview: true,
    titulo: { items: titleItems, shown: Math.min(LITERAL_PAGE, titleItems.length) },
    colecao: { items: collItems, shown: Math.min(LITERAL_PAGE, collItems.length) },
    conteudo: { groups: [], shown: 0, note: null, orActive: false, synonymUsed: '', state: 'prompt' },
    relacionados: { groups: [], shown: 0, note: null, state: 'idle' },
  };
  _refreshResults();
}

function _renderFilterChipsHidden() {
  const bar = document.getElementById('searchModeSelector');
  if (bar) { bar.innerHTML = ''; bar.style.display = 'none'; }
}

// ---------------------------------------------------------------
// EMPTY STATE — modal aberto sem query. As seções "Buscas recentes" e
// "Explorar temas" foram REMOVIDAS a pedido do dono (03/07): o modal abre
// limpo e o usuário digita pra buscar.
function _renderEmptyState() {
  // Invalida qualquer busca em voo ANTES de anular _literal: sem isto a
  // continuação pós-await do performSearch passava no guard de seq, dava
  // TypeError em _literal.conteudo e o catch pintava "Erro inesperado"
  // por cima do empty state recém-mostrado.
  ++_searchSeq;
  const resultsEl = document.getElementById('searchResults');
  const lang = localStorage.getItem('site_lang') || 'pt';
  _literal = null;
  _activeFilter = 'all';
  _renderFilterChipsHidden();
  _updateSearchCount(0, 0, lang);
  if (!resultsEl) return;
  // Sem "Buscas recentes"/"Explorar temas" — o modal abre limpo. Mantém o
  // <li.search-empty-state> vazio como marcador (o _searchOnLanguageChange e o
  // fluxo de re-render dependem dele existir quando não há query).
  resultsEl.innerHTML = '<li class="search-empty-state"></li>';
}

// Chamado pelo language.js na troca de idioma: re-pinta o que tem rótulo
// (empty state e chips). Resultados já buscados ficam no idioma da busca.
window._searchOnLanguageChange = function() {
  const resultsEl = document.getElementById('searchResults');
  if (resultsEl && resultsEl.querySelector('.search-empty-state')) _renderEmptyState();
};

// Dispara a busca COMPLETA — Enter/tecla de busca, chip do empty state ou
// botão da seção Conteúdo no preview.
window.runSearch = function() {
  // DESARMA o preview pendente do typeahead: Enter <160ms após a última
  // tecla deixava o timer disparar DEPOIS do submit — o preview incrementava
  // o seq e a resposta do FTS era descartada (busca "não funcionava").
  clearTimeout(searchTimeout);
  const input = document.getElementById('searchInput');
  if (!input) return;
  const q = input.value.trim();
  if (q.length < 2) { _performLocalPreview(input.value); return; }
  _submittedQuery = q;
  performSearch(input.value);
};

// Prepara o chrome do modal ao abrir (idempotente). O antigo botão "Buscar"
// do header FOI REMOVIDO: a busca completa dispara por Enter/tecla de busca
// do teclado, pelos chips do empty state e pelo botão da própria seção
// Conteúdo no preview — e sem ele o × de fechar volta ao canto (fechar por
// toque-fora/Esc nunca foi óbvio pro público mais idoso).
function _prepSearchChrome() {
  const modal = document.getElementById('searchModal');
  if (!modal) return;
  // "Texto literal" deixou de ser checkbox manual — virou fallback automático
  // (Conteúdo FTS volta zero → tenta ILIKE literal p/ CJK). Esconde + zera.
  const litTog = modal.querySelector('#searchLiteralToggle');
  if (litTog) {
    litTog.checked = false;
    try { localStorage.removeItem('search_literal'); } catch (e) {}
    const w = litTog.closest('label') || litTog.parentElement;
    if (w) w.style.display = 'none';
  }
}

// COMPAT: HTML restaurado de sessões antigas (sessionStorage) ainda pode ter
// botões onclick="switchSearchMode('relacionados', true)". Os modos não
// existem mais — mapeia pro equivalente novo.
window.switchSearchMode = function(mode) {
  if (mode === 'relacionados' && _literal && !_literal.preview) {
    window.setSearchFilter('relacionados');
    return;
  }
  runSearch();
};

// ---------------------------------------------------------------
// A BUSCA — seções Título + Coleção + Conteúdo (+ Relacionados)
// ---------------------------------------------------------------
// Os quatro motores empilham em SEÇÕES, cada uma com paginação PRÓPRIA.
// Título/Coleção são locais (instantâneos); Conteúdo (FTS) chega assíncrono
// na própria seção; Relacionados (semântica) roda sozinho quando o Conteúdo
// volta vazio, ou pelo chip.
const LITERAL_PAGE = 5; // itens iniciais e incremento por seção

// Estado da busca (paginação por seção; re-render lê o `shown` de cada).
//   { q, lang, preview,
//     titulo:{items,shown}, colecao:{items,shown},
//     conteudo:{groups,shown,note,orActive,synonymUsed,state},   state: prompt|loading|done
//     relacionados:{groups,shown,note,state} }                   state: idle|loading|done|error
let _literal = null;

// Nota explicativa sob o cabeçalho Conteúdo quando não há grupos pra mostrar.
//   'login' (deslogado — o FTS exige auth.uid()): sem ação (logar é fora daqui).
//   'unavailable' (erro/timeout): botão "Tentar de novo" (re-roda a busca).
//   'none' (logado, zero trechos): sem botão — a semântica já roda sozinha
//     nesse caso (seção Relacionados logo abaixo).
function _combinedContentNote(key, activeLang) {
  const ja = activeLang === 'ja';
  let msg, action = '';
  if (key === 'login') {
    msg = ja ? '本文検索にはログインが必要です。' : 'Entre na sua conta para buscar no conteúdo.';
  } else if (key === 'unavailable') {
    msg = ja ? '本文検索は現在利用できません。' : 'A busca no conteúdo está indisponível agora.';
    action = `<button type="button" class="btn-load-more" onclick="runSearch()">${ja ? '再試行' : 'Tentar de novo'}</button>`;
  } else {
    msg = ja ? '本文に該当する節は見つかりませんでした。' : 'Nenhum trecho encontrado no conteúdo.';
  }
  const actionHtml = action ? `<div class="search-section-note-action">${action}</div>` : '';
  return `<li class="search-section-note">${escHtml(msg)}${actionHtml}</li>`;
}

// Nota da seção Relacionados (estados sem grupos).
function _relatedNote(key, activeLang) {
  const ja = activeLang === 'ja';
  let msg, action = '';
  if (key === 'unavailable') {
    msg = ja ? '関連検索は現在利用できません。' : 'A busca por temas relacionados está indisponível agora.';
    action = `<button type="button" class="btn-load-more" onclick="retryRelatedSearch()">${ja ? '再試行' : 'Tentar de novo'}</button>`;
  } else if (key === 'login') {
    msg = ja ? '関連検索にはログインが必要です。' : 'Entre na sua conta para buscar temas relacionados.';
  } else {
    msg = ja ? '関連する教えは見つかりませんでした。' : 'Nenhum ensinamento relacionado encontrado.';
  }
  const actionHtml = action ? `<div class="search-section-note-action">${action}</div>` : '';
  return `<li class="search-section-note">${escHtml(msg)}${actionHtml}</li>`;
}

window.retryRelatedSearch = function() {
  // HTML restaurado do sessionStorage sem estado em memória: re-roda a
  // busca completa (mesmo padrão de auto-cura do loadMoreLiteralSection).
  if (!_literal || _literal.preview) { runSearch(); return; }
  _literal.relacionados.state = 'idle';
  _runSemantic(false, _searchSeq);
};

// Cabeçalho de seção: rótulo + contagem total (a paginação fica no rodapé da
// seção, via _literalMore). hint = sufixo discreto ("por semelhança de tema").
function _literalHead(label, total, activeLang, hint) {
  const cnt = total ? `<span class="search-section-count">${total}</span>` : '';
  const hintHtml = hint ? ` <span class="search-section-count">· ${hint}</span>` : '';
  return `<li class="search-section-head"><span class="search-section-title">${label}${hintHtml}</span>${cnt}</li>`;
}

// Botão "Carregar mais N" de UMA seção (kind = titulo|colecao|conteudo).
function _literalMore(kind, shown, total, activeLang) {
  if (shown >= total) return '';
  const remaining = total - shown;
  const nextN = Math.min(LITERAL_PAGE, remaining);
  const label = activeLang === 'ja' ? `さらに${nextN}件` : `Carregar mais ${nextN}`;
  const hint = activeLang === 'ja' ? `（残り${remaining}）` : `(${remaining} restantes)`;
  return `<li class="search-load-more search-load-more--section"><button class="btn-load-more" onclick="loadMoreLiteralSection('${kind}')">${label}</button><span class="load-more-hint">${hint}</span></li>`;
}

// Renderiza as seções a partir de _literal, respeitando o filtro ativo.
// Reusa _renderFlatList (com count = nº de itens já fatiados, pra o load-more
// interno sumir) e _renderGroup direto. A seção Conteúdo SEMPRE aparece no
// "Tudo" (com grupos, carregando, prompt OU explicando o estado via note);
// Relacionados aparece quando está carregando ou tem algo a dizer.
function _renderLiteral() {
  if (!_literal) return '';
  const { q, lang } = _literal;
  const K = _literal.conteudo;
  const R = _literal.relacionados;
  // Grifo inclui os termos do sinônimo aplicado (os <mark> do servidor vêm
  // do termo canônico — sem isso o grifo client-side não casaria).
  const hl = _buildHighlightRegex(K.synonymUsed ? `${q} ${K.synonymUsed}` : q, lang);
  const labels = _MODE_LABELS[lang === 'ja' ? 'ja' : 'pt'];
  const basePath = getBasePath();
  const show = (k) => _activeFilter === 'all' || _activeFilter === k;
  // O badge "todas as palavras" do _renderGroup lê o global — alinha ao estado
  // (importante no re-render do load-more, quando outra busca pode tê-lo zerado).
  _orFallbackActive = !!(K && K.orActive);
  let html = '';
  const T = _literal.titulo;
  if (show('titulo') && T.items.length) {
    html += _literalHead(labels.titulo, T.items.length, lang);
    html += _renderFlatList(T.items.slice(0, T.shown), T.shown, hl, q, lang, 'titulo');
    html += _literalMore('titulo', T.shown, T.items.length, lang);
  }
  const C = _literal.colecao;
  if (show('colecao') && C.items.length) {
    html += _literalHead(labels.colecao, C.items.length, lang);
    html += _renderFlatList(C.items.slice(0, C.shown), C.shown, hl, q, lang, 'colecao');
    html += _literalMore('colecao', C.shown, C.items.length, lang);
  }
  if (show('conteudo')) {
    if (K.state === 'prompt') {
      // Preview de digitação: convite pra rodar a busca de conteúdo.
      html += _literalHead(labels.conteudo, 0, lang);
      const label = lang === 'ja' ? '検索' : 'Buscar';
      const hint = lang === 'ja' ? 'Enter または「検索」で本文を検索' : 'Enter ou toque em Buscar para buscar no conteúdo.';
      html += `<li class="search-load-more search-related-prompt">` +
        `<button type="button" class="btn-load-more" onclick="runSearch()">${label}</button>` +
        `<span class="load-more-hint">${hint}</span></li>`;
    } else if (K.state === 'loading') {
      html += _literalHead(labels.conteudo, 0, lang);
      html += `<li class="search-section-loading"><span class="search-spinner" aria-hidden="true"></span>` +
        `<span data-slow-hint>${lang === 'ja' ? '本文を検索中…' : 'Buscando no conteúdo…'}</span></li>`;
    } else if (K.groups.length || K.note) {
      html += _literalHead(labels.conteudo, K.groups.length, lang);
      if (K.synonymUsed) {
        const synTxt = lang === 'ja'
          ? `「${escHtml(q)}」は見つかりませんでした — 「${escHtml(K.synonymUsed)}」の結果を表示しています。`
          : `Nada para “${escHtml(q)}” — mostrando resultados de “${escHtml(K.synonymUsed)}”.`;
        html += `<li class="search-or-banner">${synTxt}</li>`;
      }
      if (K.orActive && K.groups.length) {
        const bannerTxt = lang === 'ja'
          ? 'すべての語を含む一節は見つかりませんでした — 語が別々の節に現れる文献を表示しています。'
          : 'Nenhum trecho contém todas as palavras juntas — mostrando publicações onde elas aparecem em trechos separados.';
        html += `<li class="search-or-banner">${bannerTxt}</li>`;
      }
      if (K.groups.length) {
        const ordered = _orderGroups(K.groups, K.orActive);
        for (const g of ordered.slice(0, K.shown)) html += _renderGroup(g, basePath, hl, q, lang, true);
        html += _literalMore('conteudo', K.shown, K.groups.length, lang);
      } else {
        html += _combinedContentNote(K.note, lang);
      }
    }
  }
  if (show('relacionados')) {
    const rHint = lang === 'ja' ? '意味の近さ' : 'por semelhança de tema';
    if (R.state === 'loading') {
      html += _literalHead(labels.relacionados, 0, lang, rHint);
      html += `<li class="search-section-loading"><span class="search-spinner" aria-hidden="true"></span>` +
        `<span>${lang === 'ja' ? '関連する教えを探しています…' : 'Buscando ensinamentos relacionados…'}</span></li>`;
    } else if (R.state === 'done' && R.groups.length) {
      html += _literalHead(labels.relacionados, R.groups.length, lang, rHint);
      // Ordem de chegada = ranking semântico do servidor (não reordenar).
      const ordered = R.groups.slice().sort((a, b) => a.order - b.order);
      for (const g of ordered.slice(0, R.shown)) html += _renderGroup(g, basePath, hl, q, lang, false);
      html += _literalMore('relacionados', R.shown, R.groups.length, lang);
    } else if ((R.state === 'done' || R.state === 'error') &&
               (_activeFilter === 'relacionados' || (K.state === 'done' && !K.groups.length && K.note !== 'login'))) {
      // Sem grupos: só explica quando o usuário pediu (filtro) ou quando a
      // semântica era o resgate do Conteúdo vazio e não entregou.
      html += _literalHead(labels.relacionados, 0, lang, rHint);
      html += _relatedNote(R.note || (R.state === 'error' ? 'unavailable' : 'none'), lang);
    }
  }
  return html || `<li class="search-empty">${lang === 'ja' ? '結果が見つかりませんでした。' : 'Nenhum resultado.'}</li>`;
}

window.loadMoreLiteralSection = function(kind) {
  // HTML restaurado do sessionStorage sem estado em memória: re-roda a
  // busca (rápido — o conteúdo sai do cache de RPC se for a mesma query).
  if (!_literal) { runSearch(); return; }
  if (!_literal[kind]) return;
  const sec = _literal[kind];
  const total = sec.groups ? sec.groups.length : sec.items.length;
  sec.shown = Math.min(sec.shown + LITERAL_PAGE, total);
  const resultsEl = document.getElementById('searchResults');
  if (!resultsEl) return;
  resultsEl.innerHTML = _renderLiteral();
  _focusedIndex = -1;
  _persistResultsHtml();
};

// Busca o Conteúdo: FTS + fallbacks em cascata (sinônimo curado → cobertura
// OR multi-palavra → ILIKE literal SÓ para kanji/kana). Retorna
// { groups, note, orActive, synonymUsed }; note ∈ 'login'|'unavailable'|'none'|null.
// Resultado cacheado por query (10 min): repetir a busca volta instantâneo.
async function _fetchContentForLiteral(q, activeLang, mySeq) {
  const NIL = { groups: [], note: null, orActive: false, synonymUsed: '' };
  const supabase = _getSupabase();
  let loggedIn = false;
  if (supabase) {
    try {
      const s = await supabase.auth.getSession();
      loggedIn = !!(s && s.data && s.data.session);
    } catch (e) { /* trata como deslogado */ }
  }
  if (mySeq !== _searchSeq) return NIL;
  // Sem sessão o FTS (RLS) só volta 0 linhas — pula a RPC e explica.
  if (!loggedIn) return { groups: [], note: 'login', orActive: false, synonymUsed: '' };

  const exactToggle = document.getElementById('searchExactToggle');
  const useExactMatch = exactToggle ? exactToggle.checked : false;
  const serverQuery = _translateQuery(q, useExactMatch);
  if (!serverQuery) return { groups: [], note: 'none', orActive: false, synonymUsed: '' };

  const cacheKey = _cacheKey('fts', q, activeLang, useExactMatch);
  const cached = _cacheGet(cacheKey);
  if (cached) return cached;

  const terms = _splitTerms(q);
  // Orçamento AGREGADO da cascata (AND → sinônimo → OR → ILIKE): cada
  // chamada mantém timeout próprio (invariante iOS17: fetch sem teto
  // pendura), mas a SOMA nunca passa de ~20s — sem isto um servidor lento
  // encadeava 30-45s de spinner.
  const _deadline = Date.now() + 20000;
  const _left = () => _deadline - Date.now();
  const _budgetMs = () => Math.min(CONTENT_TIMEOUT_MS, Math.max(_left(), 1));
  let _skippedByBudget = false;
  const runFetch = async (sq) => {
    let r = await _withTimeout(supabase.rpc('search_teachings_hybrid', {
      q: sq, q_embedding: null, lang: activeLang, max_results: CONTENT_MAX_RESULTS, scope: 'content', use_fts: true,
    }), _budgetMs(), 'literal hybrid');
    if (r.error) {
      // Emergência apenas: a search_teachings pura re-tokeniza o corpus no
      // refine de scope e chega a 10-25× o custo da hybrid.
      r = await _withTimeout(supabase.rpc('search_teachings', {
        q: sq, lang: activeLang, max_results: CONTENT_MAX_RESULTS, scope: 'content',
      }), _budgetMs(), 'literal search_teachings');
    }
    return r;
  };

  try {
    let r = await runFetch(serverQuery);
    if (mySeq !== _searchSeq) return NIL;
    if (r.error) return { groups: [], note: 'unavailable', orActive: false, synonymUsed: '' };
    let results = r.data || [];
    let orActive = false;
    let synonymUsed = '';
    // Sinônimo curado: "artrose" não existe no corpus, "artrite" existe.
    // Roda ANTES do OR (o resultado canônico AND é mais preciso que a
    // cobertura espalhada do termo original).
    if (results.length === 0) {
      const canon = _SYNONYMS[_norm(q)];
      if (canon) {
        if (_left() < 1500) { _skippedByBudget = true; }
        else {
          const synRes = await runFetch(_translateQuery(canon, useExactMatch));
          if (mySeq !== _searchSeq) return NIL;
          if (!synRes.error && synRes.data && synRes.data.length) {
            results = synRes.data;
            synonymUsed = canon;
          }
        }
      }
    }
    // Multi-palavra: AND não achou trecho com TODAS → refaz com OR e ordena
    // por cobertura (quem reúne mais palavras vem antes).
    if (results.length === 0 && terms.length >= 2) {
      if (_left() < 1500) { _skippedByBudget = true; }
      else {
        const orQuery = useExactMatch ? terms.map(t => `"${t.replace(/"/g, '\\"')}"`).join(' or ') : terms.join(' or ');
        const orRes = await runFetch(orQuery);
        if (mySeq !== _searchSeq) return NIL;
        if (!orRes.error && orRes.data && orRes.data.length) { results = orRes.data; orActive = true; }
      }
    }
    // Ainda 0 e a query tem kanji/kana → ILIKE literal (o FTS pt não
    // tokeniza CJK). Para PT puro NÃO rodamos o ILIKE (custava ~10s de seq
    // scan em TODA busca zerada — era ele que estourava o timeout); o
    // resgate de PT é o fallback semântico automático (performSearch).
    if (results.length === 0 && _hasCJK(q)) {
      if (_left() < 1500) { _skippedByBudget = true; }
      else {
        try {
          const lit = await _withTimeout(supabase.rpc('search_teachings_literal', {
            q, lang: activeLang, max_results: CONTENT_MAX_RESULTS, scope: 'content',
          }), _budgetMs(), 'literal ilike');
          if (mySeq !== _searchSeq) return NIL;
          if (!lit.error && lit.data && lit.data.length) results = lit.data;
        } catch (e) { /* mantém 0 */ }
      }
    }
    if (results.length === 0) {
      if (_skippedByBudget) {
        // Zero "truncado" (fallback pulado por falta de orçamento) ≠ zero
        // real: não cacheia e reporta indisponível — retry pode achar.
        return { groups: [], note: 'unavailable', orActive: false, synonymUsed: '' };
      }
      const emptyOut = { groups: [], note: 'none', orActive: false, synonymUsed: '' };
      _cacheSet(cacheKey, emptyOut);
      return emptyOut;
    }
    // Agrupa pelo termo que REALMENTE casou (canônico quando via sinônimo) —
    // senão a classificação título/conteúdo e a cobertura zeram.
    const out = {
      groups: _groupResults(results, synonymUsed || q, activeLang),
      note: null, orActive, synonymUsed,
    };
    _cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    return { groups: [], note: 'unavailable', orActive: false, synonymUsed: '' }; // timeout/exceção
  }
}

// related = _literal.relacionados (objeto) ou null — só conta quando 'done'.
function _combinedCount(nT, nC, nG, related, activeLang) {
  const el = document.getElementById('searchCount');
  if (!el) return;
  const nR = (related && related.state === 'done') ? related.groups.length : 0;
  const parts = [];
  if (activeLang === 'ja') {
    if (nT) parts.push(`タイトル${nT}`);
    if (nC) parts.push(`叢書${nC}`);
    if (nG) parts.push(`本文${nG}件`);
    if (nR) parts.push(`関連${nR}件`);
  } else {
    if (nT) parts.push(`${nT} em título${nT !== 1 ? 's' : ''}`);
    if (nC) parts.push(`${nC} em coleç${nC !== 1 ? 'ões' : 'ão'}`);
    if (nG) parts.push(`${nG} no conteúdo`);
    if (nR) parts.push(`${nR} relacionado${nR !== 1 ? 's' : ''}`);
  }
  el.textContent = parts.join(' · ');
}

async function performSearch(query) {
  const _mySeq = ++_searchSeq;
  const resultsEl = document.getElementById('searchResults');
  const activeLang = localStorage.getItem('site_lang') || 'pt';

  if (!query || query.trim().length < 2) {
    if (!query || query.trim().length === 0) {
      _renderEmptyState();
    } else {
      const minCharsMsg = activeLang === 'ja' ? '2文字以上入力してください...' : 'Digite pelo menos 2 caracteres...';
      if (resultsEl) resultsEl.innerHTML = `<li class="search-empty">${minCharsMsg}</li>`;
      _updateSearchCount(0, 0, activeLang);
    }
    return;
  }

  const q = query.trim();
  _currentQuery = q;
  _orFallbackActive = false;
  _literal = null;
  _activeFilter = 'all';
  _focusedIndex = -1;
  _hlPubs = null; // re-lê os grifos do usuário (badge "você grifou")
  _readMarks = null; // re-lê o read marks (filtro "só nos lidos")

  const _t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  try {
    await _loadTitlesIndex();
    if (_mySeq !== _searchSeq) return;
    const titleItems = _searchTitlesIndex(q, activeLang);
    const collItems = _searchCollections(q, activeLang);

    // 1º paint IMEDIATO: seções locais prontas + Conteúdo "carregando".
    // Antes a UI esperava o FTS terminar pra mostrar até os títulos que
    // estavam prontos em 0ms — era a latência PERCEBIDA da busca inteira.
    _literal = {
      q, lang: activeLang, preview: false,
      titulo: { items: titleItems, shown: Math.min(LITERAL_PAGE, titleItems.length) },
      colecao: { items: collItems, shown: Math.min(LITERAL_PAGE, collItems.length) },
      conteudo: { groups: [], shown: 0, note: null, orActive: false, synonymUsed: '', state: 'loading' },
      relacionados: { groups: [], shown: 0, note: null, state: 'idle' },
    };
    _refreshResults();
    _scheduleSlowHint(_mySeq);

    const content = await _fetchContentForLiteral(q, activeLang, _mySeq);
    if (_mySeq !== _searchSeq || !_literal) return;
    _literal.conteudo = {
      groups: content.groups,
      shown: Math.min(LITERAL_PAGE, content.groups.length),
      note: content.note,
      orActive: content.orActive,
      synonymUsed: content.synonymUsed || '',
      state: 'done',
    };
    // O chip Relacionados pode ter resolvido ANTES do FTS (usuário clicou
    // durante o loading): re-aplica o dedup contra o Conteúdo recém-chegado,
    // senão a mesma publicação lista nas duas seções. O sentido inverso
    // (semântica depois do FTS) já deduplica dentro de _runSemantic.
    const Rsem = _literal.relacionados;
    if (Rsem.state === 'done' && Rsem.groups.length && content.groups.length) {
      const seen = new Set(content.groups.map(g => `${g.vol}/${g.file}`));
      Rsem.groups = Rsem.groups.filter(g => !seen.has(`${g.vol}/${g.file}`));
      Rsem.shown = Math.min(Rsem.shown, Rsem.groups.length);
      if (!Rsem.groups.length) Rsem.note = 'none';
    }

    const total = titleItems.length + collItems.length + content.groups.length;
    const _latencyMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0;
    // -1 = conteúdo indisponível (timeout/erro), distinto de zero real —
    // sem isso as análises de "zero resultados" misturam os dois casos.
    logSearch(q, content.note === 'unavailable' ? -1 : total, _latencyMs);

    // Resgate semântico AUTOMÁTICO: conteúdo vazio (e logado) → a seção
    // Relacionados roda sozinha. As queries em linguagem natural ("como
    // cuidar de alguém doente") só se salvam aqui.
    if (content.groups.length === 0 && content.note === 'none') {
      _refreshResults();
      await _runSemantic(true, _mySeq);
      if (_mySeq !== _searchSeq) return;
    }
    _refreshResults();

    // "Você quis dizer...?" quando nada casou em lugar nenhum.
    if (total === 0 && !_literal.relacionados.groups.length) {
      await _maybeSuggestDidYouMean(q, activeLang, resultsEl, 'prepend');
      if (_mySeq !== _searchSeq) return;
    }
    sessionStorage.setItem('searchQuery', q);
    _persistResultsHtml();
  } catch (err) {
    console.error('Search erro:', err);
    if (resultsEl) resultsEl.innerHTML = `<li class="search-error">${activeLang === 'ja' ? '検索でエラーが発生しました。' : 'Erro inesperado na busca.'}</li>`;
    _updateSearchCount(0, 0, activeLang);
  }
}

// Após 4s de seção Conteúdo carregando, troca a mensagem in-place — o free
// tier tem picos; dizer que continua trabalhando evita o abandono.
function _scheduleSlowHint(seq) {
  setTimeout(() => {
    if (seq !== _searchSeq || !_literal || _literal.conteudo.state !== 'loading') return;
    const el = document.querySelector('#searchResults [data-slow-hint]');
    if (el) {
      el.textContent = _literal.lang === 'ja'
        ? '本文をまだ検索しています — サーバーが混み合っています…'
        : 'Ainda buscando no conteúdo — o servidor está mais lento que o normal…';
    }
  }, 4000);
}

// Busca semântica (edge search-semantic) → seção Relacionados.
// auto=true quando rodou sozinha porque o Conteúdo voltou vazio.
async function _runSemantic(auto, mySeq) {
  if (!_literal || _literal.preview) return;
  const seq = (mySeq != null) ? mySeq : _searchSeq;
  const { q, lang } = _literal;
  const R = _literal.relacionados;
  if (R.state === 'loading' || R.state === 'done') return;
  const supabase = _getSupabase();
  if (!supabase) { R.state = 'done'; R.note = 'login'; _refreshResults(); return; }
  R.state = 'loading';
  R.note = null;
  _refreshResults();
  try {
    const cacheKeySem = _cacheKey('sem', q, lang, false);
    let rows = _cacheGet(cacheKeySem);
    if (!rows) {
      const { data, error } = await _withTimeout(
        supabase.functions.invoke('search-semantic', {
          body: { q, lang, max_results: CONTENT_MAX_RESULTS, scope: 'all' },
        }), SEMANTIC_TIMEOUT_MS, 'search-semantic');
      if (error) throw error;
      rows = (data && data.data) || [];
      _cacheSet(cacheKeySem, rows);
    }
    if (seq !== _searchSeq) return;
    // Dedup: publicações já listadas no Conteúdo não repetem aqui.
    const seen = new Set(_literal.conteudo.groups.map(g => `${g.vol}/${g.file}`));
    const groups = _groupResults(rows, q, lang).filter(g => !seen.has(`${g.vol}/${g.file}`));
    R.groups = groups;
    R.shown = Math.min(LITERAL_PAGE, groups.length);
    R.state = 'done';
    R.note = groups.length ? null : 'none';
  } catch (e) {
    if (seq !== _searchSeq) return;
    console.warn('search-semantic indisponível:', (e && e.message) || e);
    R.state = 'error';
    R.note = 'unavailable';
  }
  _refreshResults();
  _persistResultsHtml();
}

// COMPAT: HTML restaurado de sessões antigas pode ter onclick="loadMoreResults()"
// (paginação do extinto modo Relacionados). Re-roda a busca no formato novo.
window.loadMoreResults = function() {
  runSearch();
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

