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
eval(src + '\nmodule.exports = { _splitTerms, _buildHighlightRegex, _groupResults, _orderGroups, _renderResultsList, _kindCounts, _extractTeaching, _setOr: v => { _orFallbackActive = v; }, _setKindFilter: v => { _kindFilter = v; } };');
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
let html = M._renderResultsList(groupsT, 8, M._buildHighlightRegex('punição divina', 'pt'), 'punição divina', 'pt');
check('badge relacionado', html.includes('>relacionado<'), '');
check('grifo no título do grupo', /search-group-title[^<]*<mark/.test(html.replace(/\n/g, '')), '');
M._setOr(true);
html = M._renderResultsList(groups, 8, M._buildHighlightRegex('kunitokotachi vinganca', 'pt'), 'kunitokotachi vinganca', 'pt');
check('banner OR', html.includes('search-or-banner'), '');
check('badge todas as palavras', html.includes('todas as palavras'), '');
check('hits aninhados', html.includes('search-group-hits') && html.includes('search-hit-snippet'), '');
check('link com topic', html.includes('&topic=3'), '');

// 7. filtro Tudo + Relacionados (não mais título/conteúdo)
M._setOr(false);
const counts = M._kindCounts(groupsT);
check('counts: all = direct + related', counts.all === counts.direct + counts.related, JSON.stringify(counts));
check('counts: 1 related (Amor altruísta)', counts.related === 1, counts.related);
M._setKindFilter('related');
const htmlR = M._renderResultsList(groupsT, 8, M._buildHighlightRegex('punição divina', 'pt'), 'punição divina', 'pt');
check('filtro relacionados: só related', htmlR.includes('Amor altruísta') && !htmlR.includes('Punição divina'), '');
M._setKindFilter('all');
const htmlAll = M._renderResultsList(groupsT, 8, M._buildHighlightRegex('punição divina', 'pt'), 'punição divina', 'pt');
check('Tudo inclui ambos', htmlAll.includes('Amor altruísta') && htmlAll.includes('Punição divina'), '');

// 8. extração do título real embutido (contêineres)
const ex = M._extractTeaching('Ensinamento de Meishu-Sama : "O <mark>Johrei</mark> é a Verdadeira Medicina" (1953) "Este paciente tentou a medicina."');
check('extrai título real', ex && ex.title === 'O <mark>Johrei</mark> é a Verdadeira Medicina', ex && ex.title);
check('extrai corpo sem cabeçalho', ex && ex.body.startsWith('"Este paciente'), ex && ex.body.slice(0, 20));
check('sem cabeçalho → null', M._extractTeaching('o espírito se eleva pela prática diária') === null, '');

// 9. render contêiner: rótulo de coleção + títulos reais, sem manchete da pub
window.SECTION_MAP.mioshiec2 = { 'ID5': { pt: 'Coletânea de fragmentos sobre medicina 5' } };
const rowsCont = [
  { vol: 'mioshiec2', file: 'ID5', topic_idx: 1, title_pt: 'Coletânea de fragmentos sobre medicina 5', snippet: 'Ensinamento de Meishu-Sama : "O <mark>Johrei</mark> é a Verdadeira Medicina" (1953) "Este paciente tentou a medicina."', rank: 0.8 },
  { vol: 'mioshiec2', file: 'ID5', topic_idx: 3, title_pt: 'Coletânea de fragmentos sobre medicina 5', snippet: 'Ensinamento de Meishu-Sama: "Ah, Quão Grandiosa é a Obra do <mark>Johrei</mark>" (1953) "A diferença gritante."', rank: 0.7 },
];
const groupsCont = M._groupResults(rowsCont, 'johrei', 'pt');
const htmlCont = M._renderResultsList(groupsCont, 8, M._buildHighlightRegex('johrei', 'pt'), 'johrei', 'pt');
check('contêiner: classe collection', htmlCont.includes('search-group--collection'), '');
check('contêiner: rótulo de coleção', htmlCont.includes('search-group-collection'), '');
check('contêiner: título real como hit-title', /search-hit-title[^>]*>O <mark[^>]*>Johrei/.test(htmlCont), '');
check('contêiner: SEM manchete da publicação', !htmlCont.includes('search-group-title'), '');
check('contêiner: corpo sem "Ensinamento de Meishu-Sama"', !/search-hit-snippet[^>]*>[^<]*Ensinamento de Meishu/.test(htmlCont), '');

process.exit(fail ? 1 : 0);
