// Teste da lógica de busca agrupada (grupos/cobertura/grifo/abas).
// Roda: node scripts/_diag_search_grouping.cjs
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// stubs de browser
global.document = { addEventListener: () => {}, getElementById: () => null, querySelectorAll: () => [], createElement: () => ({ style: {} }), head: { appendChild: () => {} } };
global.window = { location: { pathname: '/index.html' }, innerWidth: 1200 };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.sessionStorage = global.localStorage;
global.performance = { now: () => 0 };

const src = readFileSync(join(__dirname, '..', 'js', 'search.js'), 'utf8');
eval(src + '\nmodule.exports = { _splitTerms, _buildHighlightRegex, _groupResults, _orderGroups, _renderGroupsList, _renderFlatList, _extractTeaching, _searchTitlesIndex, _searchCollections, _setOr: v => { _orFallbackActive = v; }, _setTitlesIndex: v => { _titlesIndex = v; }, _setMode: v => { _searchMode = v; } };');
const M = module.exports;

let fail = 0;
function check(name, cond, extra) {
  if (cond) console.log('PASS', name);
  else { fail++; console.log('FAIL', name, extra ?? ''); }
}

// 1. split de termos: espaço E '&'
check('split espaço', JSON.stringify(M._splitTerms('vinganca alegria')) === '["vinganca","alegria"]', M._splitTerms('vinganca alegria'));
check('split &', JSON.stringify(M._splitTerms('vinganca & alegria')) === '["vinganca","alegria"]', M._splitTerms('vinganca & alegria'));

// 2. grifo insensível a acento, multi-termo
const re = M._buildHighlightRegex('vinganca alegria', 'pt');
check('grifo casa acentuado e palavra inteira', 'gera vinganças e Alegrias'.replace(re, '<m>$1</m>') === 'gera <m>vinganças</m> e <m>Alegrias</m>', 'gera vinganças e Alegrias'.replace(re, '<m>$1</m>'));
const re2 = M._buildHighlightRegex('vingança', 'pt');
check('query acentuada casa', re2.test('a vinganca dele'), re2);

// 3. agrupamento + cobertura (caso kunitokotachi vinganca, modo OR)
window.SECTION_MAP = { mioshiec3: { 'make2.html': { pt: 'Perder é ganhar 2' }, 'sinbatu.html': { pt: 'Punição divina' } } };
const rows = [
  { vol: 'mioshiec3', file: 'make2.html', topic_idx: 1, title_pt: 'Ao perder não se guarda rancor', snippet: 'como forma de <mark>vingança</mark>, o efeito será maior', rank: 0.5 },
  { vol: 'mioshiec3', file: 'make2.html', topic_idx: 3, title_pt: 'O Deus do Julgamento', snippet: '<mark>Kunitokotachi</mark>-no-Mikoto é o Deus do Julgamento', rank: 0.4 },
  { vol: 'mioshiec3', file: 'sinbatu.html', topic_idx: 2, title_pt: 'Pergunta sobre o demônio', snippet: 'esse Deus, que é <mark>Kunitokotachi</mark>-no-Mikoto, disse', rank: 0.3 },
  { vol: 'mioshiec3', file: 'outro.html', topic_idx: 0, title_pt: 'Amor altruísta', snippet: 'O Meu Ser e a felicidade', rank: 0.2 },
];
const groups = M._groupResults(rows, 'kunitokotachi vinganca', 'pt');
check('3 grupos', groups.length === 3, groups.length);
const gMake2 = groups.find(g => g.file === 'make2.html');
check('make2 cobre 2 termos', gMake2.coverage === 2, gMake2.coverage);
check('make2 kind content', gMake2.kind === 'content', gMake2.kind);
check('pubLabel via SECTION_MAP', gMake2.pubLabel === 'Perder é ganhar 2', gMake2.pubLabel);
const gOutro = groups.find(g => g.file === 'outro.html');
check('semântico vira related', gOutro.kind === 'related', gOutro.kind);
const gSin = groups.find(g => g.file === 'sinbatu.html');
check('sinbatu cobre 1 termo', gSin.coverage === 1, gSin.coverage);

// 4. ordenação OR: cobertura maior primeiro
const ordered = M._orderGroups(groups, true);
check('OR: make2 primeiro', ordered[0].file === 'make2.html', ordered.map(g => g.file));

// 5. match no título → kind title e seção primeiro no modo normal
const rowsT = [
  { vol: 'mioshiec3', file: 'outro.html', topic_idx: 0, title_pt: 'Amor altruísta', snippet: 'texto sem termo', rank: 0.9 },
  { vol: 'mioshiec3', file: 'sinbatu.html', topic_idx: 0, title_pt: 'Punição divina', snippet: 'sobre a <mark>punição</mark>', rank: 0.5 },
];
const groupsT = M._groupResults(rowsT, 'punição divina', 'pt');
const gT = groupsT.find(g => g.file === 'sinbatu.html');
check('título casa → kind title', gT.kind === 'title', gT.kind);
const orderedT = M._orderGroups(groupsT, false);
check('seção título primeiro', orderedT[0].file === 'sinbatu.html', orderedT.map(g => g.file));

// 6. render: badges, banner OR, grifo no título da publicação normal
M._setOr(false);
let html = M._renderGroupsList(groupsT, 8, M._buildHighlightRegex('punição divina', 'pt'), 'punição divina', 'pt');
check('badge relacionado', html.includes('>relacionado<'), '');
check('grifo no título do grupo', /search-group-title[^<]*<mark/.test(html.replace(/\n/g, '')), '');
M._setOr(true);
html = M._renderGroupsList(groups, 8, M._buildHighlightRegex('kunitokotachi vinganca', 'pt'), 'kunitokotachi vinganca', 'pt');
check('banner OR', html.includes('search-or-banner'), '');
check('badge todas as palavras', html.includes('todas as palavras'), '');
check('hits aninhados', html.includes('search-group-hits') && html.includes('search-hit-snippet'), '');
check('link com topic', html.includes('&topic=3'), '');

// 7. MODO TÍTULO: busca local no índice de títulos reais (inclui contêiner)
M._setOr(false);
M._setMode('titulo');
M._setTitlesIndex({
  mioshiec2: [
    { f: 'ID5', i: 1, t: 'O Johrei é a Verdadeira Medicina' },
    { f: 'ID5', i: 3, t: 'Ah, Quão Grandiosa é a Obra do Johrei' },
    { f: 'binetu', i: 0, t: 'Febre Baixa' },
  ],
  mioshiec3: [{ f: 'make2', i: 0, t: 'Perder é ganhar 2' }],
});
const ti = M._searchTitlesIndex('johrei', 'pt');
check('título: acha títulos reais de contêiner', ti.length === 2 && ti.every(r => /Johrei/.test(r.label)), ti.map(r => r.label));
check('título: file ganha .html e topicIdx', ti[0].file === 'ID5.html' && Number.isInteger(ti[0].topicIdx), JSON.stringify(ti[0]));
const tiAcc = M._searchTitlesIndex('johrei verdadeira', 'pt'); // AND multi-termo
check('título: AND multi-termo', tiAcc.length === 1 && /Verdadeira/.test(tiAcc[0].label), tiAcc.map(r => r.label));
const flatHtml = M._renderFlatList(ti, 8, M._buildHighlightRegex('johrei', 'pt'), 'johrei', 'pt', 'titulo');
check('título: render flat-item + grifo', flatHtml.includes('search-flat-item') && /search-flat-name[\s\S]*?<mark[^>]*>Johrei/i.test(flatHtml), '');
check('título: link com file e topic', /href="[^"]*file=ID5\.html[^"]*&topic=/.test(flatHtml), '');

// 8. MODO COLEÇÃO: casa no nome da publicação (SECTION_MAP)
M._setMode('colecao');
window.SECTION_MAP.mioshiec2 = {
  'ID5': { pt: 'Coletânea de fragmentos sobre medicina 5', section: 'Crítica à Medicina Moderna', n: '5' },
  'ID6': { pt: 'Coletânea de fragmentos sobre medicina 6', section: 'Crítica à Medicina Moderna', n: '6' },
  'binetu': { pt: 'Febre Baixa', section: 'Sintomas', n: '1' },
};
const cols = M._searchCollections('medicina', 'pt');
check('coleção: casa nome de publicação', cols.length === 2 && cols.every(c => /medicina/i.test(c.label)), cols.map(c => c.label));
const colHtml = M._renderFlatList(cols, 8, M._buildHighlightRegex('medicina', 'pt'), 'medicina', 'pt', 'colecao');
check('coleção: render + grifo + crumb', colHtml.includes('search-flat-item') && /<mark[^>]*>medicina/i.test(colHtml) && colHtml.includes('search-flat-crumb'), '');
M._setMode('conteudo');

// 8. extração do título real embutido (contêineres)
const ex = M._extractTeaching('Ensinamento de Meishu-Sama : "O <mark>Johrei</mark> é a Verdadeira Medicina" (1953) "Este paciente tentou a medicina."');
check('extrai título real', ex && ex.title === 'O <mark>Johrei</mark> é a Verdadeira Medicina', ex && ex.title);
check('extrai corpo sem cabeçalho', ex && ex.body.startsWith('"Este paciente'), ex && ex.body.slice(0, 20));
check('sem cabeçalho → null', M._extractTeaching('o espírito se eleva pela prática diária') === null, '');

// 9. render contêiner (modo Relacionados/título): rótulo de coleção +
//    títulos reais como hit-title. (No modo Conteúdo o trecho é mostrado
//    inteiro, sem extrair título — testado na seção 10.)
M._setMode('relacionados');
window.SECTION_MAP.mioshiec2 = { 'ID5': { pt: 'Coletânea de fragmentos sobre medicina 5' } };
const rowsCont = [
  { vol: 'mioshiec2', file: 'ID5', topic_idx: 1, title_pt: 'Coletânea de fragmentos sobre medicina 5', snippet: 'Ensinamento de Meishu-Sama : "O <mark>Johrei</mark> é a Verdadeira Medicina" (1953) "Este paciente tentou a medicina."', rank: 0.8 },
  { vol: 'mioshiec2', file: 'ID5', topic_idx: 3, title_pt: 'Coletânea de fragmentos sobre medicina 5', snippet: 'Ensinamento de Meishu-Sama: "Ah, Quão Grandiosa é a Obra do <mark>Johrei</mark>" (1953) "A diferença gritante."', rank: 0.7 },
];
const groupsCont = M._groupResults(rowsCont, 'johrei', 'pt');
const htmlCont = M._renderGroupsList(groupsCont, 8, M._buildHighlightRegex('johrei', 'pt'), 'johrei', 'pt');
check('contêiner: classe collection', htmlCont.includes('search-group--collection'), '');
check('contêiner: rótulo de coleção', htmlCont.includes('search-group-collection'), '');
check('contêiner: cabeçalho clicável (link p/ file)', /search-group-collection[^>]*href="[^"]*file=ID5[^"]*&topic=0/.test(htmlCont.replace(/\n/g,' ')) || /href="[^"]*file=ID5[^"]*"[^>]*class="search-group-collection/.test(htmlCont.replace(/\n/g,' ')), '');
check('contêiner: link da coleção é search-nav-item', /class="search-group-collection search-nav-item"/.test(htmlCont), '');
check('contêiner: título real como hit-title', /search-hit-title[^>]*>O <mark[^>]*>Johrei/.test(htmlCont), '');
check('contêiner: SEM manchete da publicação', !htmlCont.includes('search-group-title'), '');
check('contêiner: corpo sem "Ensinamento de Meishu-Sama"', !/search-hit-snippet[^>]*>[^<]*Ensinamento de Meishu/.test(htmlCont), '');
// nome da coleção grifado quando o termo casa nele
const groupsContName = M._groupResults(rowsCont, 'medicina', 'pt');
const htmlContName = M._renderGroupsList(groupsContName, 8, M._buildHighlightRegex('medicina', 'pt'), 'medicina', 'pt');
check('contêiner: grifa termo no nome da coleção', /search-group-collection-name[\s\S]*?<mark[^>]*>medicina/i.test(htmlContName), '');

// 10. modo CONTEÚDO: fragmento inteiro centrado no match (com grifo),
//     sem extrair título; só remove o rótulo "...Meishu-Sama:".
M._setMode('conteudo');
const htmlContent = M._renderGroupsList(groupsCont, 8, M._buildHighlightRegex('johrei', 'pt'), 'johrei', 'pt');
check('conteúdo: match grifado no snippet (não no título)', /search-hit-snippet[^>]*>[\s\S]*?<mark[^>]*>Johrei/i.test(htmlContent), '');
check('conteúdo: sem hit-title separado', !htmlContent.includes('search-hit-title'), '');
check('conteúdo: rótulo "Meishu-Sama:" removido do snippet', !/search-hit-snippet[^>]*>\s*Ensinamento de Meishu/i.test(htmlContent), '');
check('conteúdo: título entre aspas preservado no snippet', /search-hit-snippet[^>]*>[\s\S]*?Verdadeira Medicina/i.test(htmlContent), '');

// 10b. modo Conteúdo com content_excerpt: janela do CORPO em volta do match
const rowsBody = [{
  vol: 'mioshiec2', file: 'ID5', topic_idx: 5, title_pt: 'Coletânea de fragmentos sobre medicina 5',
  // o título embutido NÃO tem 'remédios'; o corpo tem.
  snippet: 'Ensinamento de Meishu-Sama: "Sobre a Cura" (1953) introdução',
  content_excerpt: 'Ensinamento de Meishu-Sama: "Sobre a Cura" (1953) Quando a pessoa toma remédios em excesso, acumula toxinas e o Johrei tem o papel de dissolvê-las gradualmente ao longo do tempo.',
  rank: 0.5,
}];
const groupsBody = M._groupResults(rowsBody, 'toxinas', 'pt');
const htmlBody = M._renderGroupsList(groupsBody, 8, M._buildHighlightRegex('toxinas', 'pt'), 'toxinas', 'pt');
check('conteúdo: janela do corpo (não do título)', /search-hit-snippet[^>]*>[\s\S]*?<mark[^>]*>toxinas/i.test(htmlBody), htmlBody.match(/search-hit-snippet[^>]*>([\s\S]{0,80})/)?.[1]);
check('conteúdo: corpo sem o título "Sobre a Cura"', !/search-hit-snippet[^>]*>[\s\S]*?Sobre a Cura/i.test(htmlBody), '');

// 10c. corpo quando o título embutido NÃO tem prefixo "Meishu-Sama:" e o
// match (Johrei) está no TÍTULO — a janela deve pular pro Johrei do corpo.
const rowsNoPrefix = [{
  vol: 'mioshiec2', file: 'ID7', topic_idx: 0, title_pt: 'Coletânea de fragmentos sobre medicina 7',
  snippet: '"O <mark>Johrei</mark> é Transfusão de Sangue" (1953) introdução',
  content_excerpt: '"O Johrei é Transfusão de Sangue" (Escrito em 1953) Hoje a medicina considera a transfusão indispensável; porém, pela fé, o Johrei dissolve as impurezas do sangue sem agredir o corpo.',
  rank: 0.5,
}];
const htmlNoPrefix = M._renderGroupsList(M._groupResults(rowsNoPrefix, 'johrei', 'pt'), 8, M._buildHighlightRegex('johrei', 'pt'), 'johrei', 'pt');
check('conteúdo: pula título sem prefixo, grifa Johrei do corpo', /search-hit-snippet[^>]*>[\s\S]*?<mark[^>]*>Johrei[\s\S]*?dissolve/i.test(htmlNoPrefix), htmlNoPrefix.match(/search-hit-snippet[^>]*>([\s\S]{0,90})/)?.[1]);
check('conteúdo: corpo sem "Transfusão de Sangue" (título)', !/search-hit-snippet[^>]*>[\s\S]*?é Transfusão de Sangue/i.test(htmlNoPrefix), '');

// 10d. título SEM aspas + "- Coleção... (Publicado em ANO)": corta pela data
const rowsDash = [{
  vol: 'mioshiec2', file: 'ID2', topic_idx: 0, title_pt: 'Coletânea de fragmentos sobre medicina 2',
  snippet: 'O Ponto Vital do <mark>Johrei</mark> - Coleção de Fragmentos (1952) introdução',
  content_excerpt: 'O Ponto Vital do Johrei - Coleção de Fragmentos de Medicina Espiritual 1 (Publicado em 17 de fevereiro de 1952) No caso de doença pulmonar, ao ministrar o Johrei deve-se atentar ao ponto vital das costas para dissolver as toxinas.',
  rank: 0.5,
}];
const htmlDash = M._renderGroupsList(M._groupResults(rowsDash, 'johrei', 'pt'), 8, M._buildHighlightRegex('johrei', 'pt'), 'johrei', 'pt');
check('conteúdo: corta header sem aspas pela data', !/search-hit-snippet[^>]*>[\s\S]*?Coleção de Fragmentos de Medicina/i.test(htmlDash), htmlDash.match(/search-hit-snippet[^>]*>([\s\S]{0,70})/)?.[1]);
check('conteúdo: grifa Johrei do corpo (caso dash)', /search-hit-snippet[^>]*>[\s\S]*?<mark[^>]*>Johrei[\s\S]*?ponto vital das costas/i.test(htmlDash), '');
M._setMode('titulo');

process.exit(fail ? 1 : 0);
