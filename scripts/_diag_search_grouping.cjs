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
eval(src + '\nmodule.exports = { _splitTerms, _buildHighlightRegex, _groupResults, _orderGroups, _renderResultsList, _setOr: v => { _orFallbackActive = v; }, _setKindFilter: v => { _kindFilter = v; } };');
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

// 6. render: seções, badges, banner OR, dedup
M._setOr(false);
let html = M._renderResultsList(groupsT, 8, M._buildHighlightRegex('punição divina', 'pt'), 'punição divina', 'pt');
check('section label título', html.includes('Títulos correspondentes'), '');
check('badge no título', html.includes('>no título<'), '');
check('badge relacionado', html.includes('>relacionado<'), '');
check('grifo no título do grupo', /search-group-title[^<]*<mark/.test(html.replace(/\n/g, '')), '');
M._setOr(true);
html = M._renderResultsList(groups, 8, M._buildHighlightRegex('kunitokotachi vinganca', 'pt'), 'kunitokotachi vinganca', 'pt');
check('banner OR', html.includes('search-or-banner'), '');
check('badge todas as palavras', html.includes('todas as palavras'), '');
check('hits aninhados', html.includes('search-group-hits') && html.includes('search-hit-snippet'), '');
check('link com topic', html.includes('&topic=3'), '');

// 7. dedup título×snippet: snippet que começa com o título esconde a linha de título
const rowsD = [{ vol: 'mioshiec3', file: 'make2.html', topic_idx: 1, title_pt: 'Ao Perder, Não Se É Guardado Rancor, Portanto, a Sorte é Boa', snippet: 'Ensinamento de Meishu-Sama: "Ao Perder, Não Se É Guardado <mark>Rancor</mark>', rank: 0.5 }];
const groupsD = M._groupResults(rowsD, 'rancor', 'pt');
M._setOr(false);
const htmlD = M._renderResultsList(groupsD, 8, M._buildHighlightRegex('rancor', 'pt'), 'rancor', 'pt');
check('dedup título duplicado no snippet', !htmlD.includes('search-hit-title'), '');

// 8. abas: filtro por kind remove os outros grupos e os rótulos de seção
M._setOr(false);
M._setKindFilter('title');
const htmlF = M._renderResultsList(groupsT, 8, M._buildHighlightRegex('punição divina', 'pt'), 'punição divina', 'pt');
check('aba título: só grupos de título', htmlF.includes('Punição divina') && !htmlF.includes('Amor altruísta'), '');
check('aba ativa: sem rótulo de seção', !htmlF.includes('search-section-label'), '');
M._setKindFilter('related');
const htmlR = M._renderResultsList(groupsT, 8, M._buildHighlightRegex('punição divina', 'pt'), 'punição divina', 'pt');
check('aba relacionados: só related', htmlR.includes('Amor altruísta') && !htmlR.includes('Punição divina'), '');
// não-exclusivo: grupo com match no título E no conteúdo aparece na aba conteúdo
M._setKindFilter('content');
const htmlC = M._renderResultsList(groupsT, 8, M._buildHighlightRegex('punição divina', 'pt'), 'punição divina', 'pt');
check('aba conteúdo inclui grupo título+conteúdo', htmlC.includes('Punição divina'), '');
const gFlags = groupsT.find(g => g.file === 'sinbatu.html');
check('flags não-exclusivas', gFlags.hasTitle === true && gFlags.hasContent === true, JSON.stringify({ t: gFlags.hasTitle, c: gFlags.hasContent }));
M._setKindFilter('all');

process.exit(fail ? 1 : 0);
