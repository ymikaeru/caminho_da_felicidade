// ============================================================
// build_johrei_points.mjs
// Gera site_data/johrei_points.js — a taxonomia do guia de consulta
// "Pontos Vitais do Johrei" (mioshiec2: O Método do Johrei, Princípio,
// Purificação, Três Venenos, Análise Corporal) para a interface de
// exploração guiada (pontos-vitais-johrei.html).
//
// Clone de build_disease_map.mjs. Mesma fonte da verdade de títulos
// (site_data/global_index_titles.js) e mesmo renderizador genérico.
//
// DISCIPLINA: este guia INDEXA os Ensinamentos e aponta para eles; nunca
// prescreve procedimento. Os rótulos são de ESTUDO, não de instrução clínica.
//
// Três eixos de GRUPO (regiao | sintoma | fundamento) + Descobertas (perguntas).
// NÃO usa "temas" transversais (tags) — no modelo, uma tag exige que o arquivo
// já esteja num grupo; aqui os três eixos de grupo já cobrem tudo.
//
// Corrigir a taxonomia = editar GROUPS/MAP/PERGUNTAS e rodar
//   `node scripts/build_johrei_points.mjs`
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VOL = 'mioshiec2';

// ---- 1. Carrega títulos PT/JA do índice global -------------------------------
const rawIdx = readFileSync(join(ROOT, 'site_data', 'global_index_titles.js'), 'utf8');
const IDX = JSON.parse(rawIdx.slice(rawIdx.indexOf('{'), rawIdx.lastIndexOf('}') + 1));

// ---- 2. Metadados dos grupos (três eixos) ------------------------------------
// axis: 'regiao' (onde no corpo) | 'sintoma' (qual condição) | 'fundamento' (o porquê).
// pergunta = cabeçalho provocativo (PT) + ja (mesma pergunta em JA). pt = rótulo curto.
// Sem ícones: tom sóbrio. Toda redação é de ESTUDO, não de prescrição.
const GROUPS = [
  // ----- EIXO: POR REGIÃO DO CORPO -----
  { id: 'R1', axis: 'regiao', pt: 'Cabeça, cérebro e nuca', ja: '頭部・延髄の急所について教えは何を説くか',
    pergunta: 'O que os Ensinamentos revelam sobre os pontos vitais da cabeça e da nuca?' },
  { id: 'R2', axis: 'regiao', pt: 'Olhos, ouvidos, nariz e face', ja: '感覚器官と顔について',
    pergunta: 'E sobre os órgãos dos sentidos e a face?' },
  { id: 'R3', axis: 'regiao', pt: 'Pescoço e ombros', ja: 'なぜ首と肩は重要な急所なのか',
    pergunta: 'Por que pescoço e ombros são pontos vitais tão frequentes?' },
  { id: 'R4', axis: 'regiao', pt: 'Tórax: coração e pulmões', ja: '胸部の急所について',
    pergunta: 'O que se ensina sobre os pontos vitais do tórax?' },
  { id: 'R5', axis: 'regiao', pt: 'Abdômen: estômago, fígado e intestinos', ja: '腹部・消化器について',
    pergunta: 'E sobre o ventre e os órgãos da digestão?' },
  { id: 'R6', axis: 'regiao', pt: 'Rins e lombar', ja: 'なぜ腎臓と腰が重視されるのか',
    pergunta: 'Por que rins e lombar recebem atenção especial?' },
  { id: 'R7', axis: 'regiao', pt: 'Baixo-ventre: bexiga, genitais e ânus', ja: '下腹部について',
    pergunta: 'O que dizem os Ensinamentos sobre o baixo-ventre?' },
  { id: 'R8', axis: 'regiao', pt: 'Nervos, articulações e membros', ja: '神経痛・リウマチ・手足について',
    pergunta: 'E sobre nevralgias, reumatismo e os membros?' },

  // ----- EIXO: POR CONDIÇÃO / SINTOMA -----
  { id: 'S1', axis: 'sintoma', pt: 'Tuberculose', ja: '結核とその浄化について',
    pergunta: 'Como os Ensinamentos tratam a tuberculose e sua purificação?' },
  { id: 'S2', axis: 'sintoma', pt: 'Mente e nervos', ja: '精神の病に対する急所',
    pergunta: 'Quais os pontos vitais para as doenças da mente?' },
  { id: 'S3', axis: 'sintoma', pt: 'Resfriado, febre e purificação', ja: '風邪と熱は病か、浄化か',
    pergunta: 'Resfriado e febre: doença, ou purificação em curso?' },
  { id: 'S4', axis: 'sintoma', pt: 'Germes e contágio', ja: '黴菌と伝染について',
    pergunta: 'O que os Ensinamentos dizem sobre germes e contágio?' },

  // ----- EIXO: FUNDAMENTOS -----
  { id: 'F1', axis: 'fundamento', pt: 'Por que o Johrei cura — o princípio', ja: '浄霊はなぜ治すのか — その原理',
    pergunta: 'Por que o Johrei cura? O princípio por trás da prática' },
  { id: 'F2', axis: 'fundamento', pt: 'Como ministrar — método e atitude', ja: '浄霊の方法・順序・心得',
    pergunta: 'Como ministrar o Johrei: método, ordem e atitude' },
  { id: 'F3', axis: 'fundamento', pt: 'Os pontos vitais do Johrei (急所)', ja: '本書の核心 — 明主様が説かれた浄霊の急所',
    pergunta: 'O coração deste guia: os pontos vitais ensinados por Meishu-Sama' },
  { id: 'F4', axis: 'fundamento', pt: 'Os três venenos e as toxinas', ja: '体を内から蝕むもの — 三毒・薬毒',
    pergunta: 'O que adoece o corpo por dentro: os três venenos' },
  { id: 'F5', axis: 'fundamento', pt: 'O processo de purificação', ja: '体が自らを清める働き — 浄化作用',
    pergunta: 'O que o corpo faz para se limpar: o processo de purificação' },
];

// ---- 3. Arquivo -> grupos ----------------------------------------------------
// Cada artigo aparece sob cada grupo listado (multi-eixo = aparece em mais de um).
// As referências cruzadas (xrefs) ligam um artigo aos seus grupos nos OUTROS eixos.
const MAP = {
  // ===== POR REGIÃO =====
  // R1 Cabeça, cérebro e nuca
  'zunou.html': ['R1'], 'enzui.html': ['R1'], 'BB1.html': ['R1'],
  // R2 Olhos, ouvidos, nariz e face (BB3 também toca a mente — epilepsia)
  'BB2.html': ['R2'], 'BB3.html': ['R2', 'S2'],
  // R3 Pescoço e ombros
  'kubi.html': ['R3'], 'kata1.html': ['R3'], 'kata2.html': ['R3'],
  // R4 Tórax: coração e pulmões (BB4 também é tuberculose; BB5 também abdômen)
  'sinzou.html': ['R4'], 'BB4.html': ['R4', 'S1'], 'BB5.html': ['R4', 'R5'],
  // R5 Abdômen (BB6 também rins/intestino)
  'BB6.html': ['R5', 'R6'],
  // R6 Rins e lombar
  'zinzou.html': ['R6'], 'kosi.html': ['R6'],
  // R7 Baixo-ventre: bexiga, genitais e ânus (BB9 doenças femininas)
  'BB7.html': ['R7'], 'BB9.html': ['R7'],
  // R8 Nervos, articulações e membros
  'BB8.html': ['R8'],

  // ===== POR CONDIÇÃO / SINTOMA =====
  // S1 Tuberculose
  'kaze1K.html': ['S1'], 'kaze2K.html': ['S1'], 'kaze3K.html': ['S1'],
  'KB1.html': ['S1'], 'KB2.html': ['S1'], 'KB3.html': ['S1'],
  'KB4.html': ['S1'], 'KB5.html': ['S1'], 'KB6.html': ['S1'], 'Kseisin.html': ['S1'],
  // S2 Mente e nervos
  'SJ1.html': ['S2'], 'SJ2.html': ['S2'], 'SJ3.html': ['S2'],
  // S3 Resfriado, febre e purificação (todos também no eixo fundamento F5)
  'kaze1.html': ['S3', 'F5'], 'kaze2.html': ['S3', 'F5'], 'binetu.html': ['S3', 'F5'],
  'heikin.html': ['S3', 'F5'], 'Bkansha.html': ['S3', 'F5'],
  // S4 Germes e contágio (também purificação F5)
  'baikin1.html': ['S4', 'F5'], 'baikin2.html': ['S4', 'F5'],
  'baikin3.html': ['S4', 'F5'], 'baikin4.html': ['S4', 'F5'], 'JS6.html': ['S4', 'F5'],

  // ===== FUNDAMENTOS =====
  // F1 Princípio do Johrei
  'konpon1.html': ['F1'], 'konpon2.html': ['F1'],
  'JG1.html': ['F1'], 'JG2.html': ['F1'], 'JG3.html': ['F1'], 'JG4.html': ['F1'],
  'JKG1.html': ['F1'], 'JKG2.html': ['F1'], 'JKG3.html': ['F1'], 'JKG4.html': ['F1'],
  'JKG5.html': ['F1'], 'JKG6.html': ['F1'], 'JKG7.html': ['F1'],
  'kannen1.html': ['F1'], 'kannen2.html': ['F1'], 'Jk.html': ['F1'], 'Jigi.html': ['F1'],
  // F2 Método e atitude
  'JH1.html': ['F2'], 'JH2.html': ['F2'], 'JH3.html': ['F2'], 'JH4.html': ['F2'],
  'JH5.html': ['F2'], 'JH6.html': ['F2'], 'JH7.html': ['F2'], 'Jkawaru.html': ['F2'],
  'Jkaisuu1.html': ['F2'], 'Jkaisuu2.html': ['F2'], 'Jkaisuu3.html': ['F2'],
  'Jga.html': ['F2'], 'Jsounen.html': ['F2'], 'Jzyunzyo.html': ['F2'],
  'Jnorito.html': ['F2'], 'Jsongen.html': ['F2'], 'Jziko.html': ['F2'],
  // F3 Os pontos vitais do Johrei (急所) — a série completa, em ordem
  'JK1.html': ['F3'], 'JK2.html': ['F3'], 'JK3.html': ['F3'], 'JK4.html': ['F3'],
  'JK5.html': ['F3'], 'JK6.html': ['F3'], 'JK7.html': ['F3'], 'JK8.html': ['F3'],
  'JK9.html': ['F3'], 'JK10.html': ['F3'], 'JK11.html': ['F3'], 'JK12.html': ['F3'],
  'JK13.html': ['F3'], 'JK14.html': ['F3'], 'JK15.html': ['F3'], 'JK16.html': ['F3'],
  'JK17.html': ['F3'], 'JK18.html': ['F3'], 'JK19.html': ['F3'], 'JK20.html': ['F3'],
  'JK21.html': ['F3'], 'JK22.html': ['F3'], 'JK23.html': ['F3'], 'JK24.html': ['F3'],
  'JK25.html': ['F3'], 'JK26.html': ['F3'], 'JKzyunzyo.html': ['F3'], 'JdokusoIDOU.html': ['F3'],
  // F4 Os três venenos e as toxinas
  '3doku.html': ['F4'], 'nendoku1.html': ['F4'], 'nendoku2.html': ['F4'], 'nendoku3.html': ['F4'],
  'yakudoku1.html': ['F4'], 'yakudoku2.html': ['F4'], 'yakudoku3.html': ['F4'],
  'shoudoku1.html': ['F4'], 'shoudoku2.html': ['F4'], 'shoudoku3.html': ['F4'],
  'kanpou1.html': ['F4'], 'kanpou2.html': ['F4'], 'kanpou3.html': ['F4'],
  'nyoudoku.html': ['F4'], 'dokukai1.html': ['F4'], 'dokukai2.html': ['F4'], 'dokukai3.html': ['F4'],
  'kusuriGYAKU.html': ['F4'], 'yakudokuTEISI.html': ['F4'],
  'shutou1.html': ['F4'], 'shutou2.html': ['F4'], 'shutou3.html': ['F4'],
  // F5 O processo de purificação (JS* exclusivos; kaze/baikin/etc. já vêm de S3/S4)
  'JS1.html': ['F5'], 'JS2.html': ['F5'], 'JS3.html': ['F5'],
  'JS4.html': ['F5'], 'JS5.html': ['F5'],
};

// ---- 3b. Temas transversais: NÃO USADOS neste guia ---------------------------
// (Os três eixos de grupo já cobrem a navegação. Mantido vazio para preservar a
//  forma de dados do renderizador genérico.)
const TAGS = [];
const TAG_FILES = {};

// Inverte: arquivo -> [temas]
const fileTags = {};
for (const [tagId, files] of Object.entries(TAG_FILES)) {
  for (const base of files) {
    const f = base.endsWith('.html') ? base : `${base}.html`;
    (fileTags[f] ||= []).push(tagId);
  }
}

// ---- 3c. Descobertas (eixo "perguntas": porta de entrada provocativa) ---------
// Para os MINISTRANTES do Johrei. Cada pergunta abre uma curiosidade legítima e
// aponta para o(s) Ensinamento(s) que a iluminam — a resposta vive no Ensinamento,
// nunca numa nota nossa. Todas as descobertas são 'iluminada' (apontam lições).
//   status 'iluminada' -> licoes:[arquivos que respondem]
//   (o renderizador também suporta status 'aberta' = convite sem lições, não usado aqui)
// teaser = provocação curta. licoes[] sem .html (normalizado abaixo).
const PERGUNTAS = [
  { id: 'ordem', status: 'iluminada', licoes: ['JKzyunzyo', 'Jzyunzyo'],
    pt: 'Existe uma ordem certa para ministrar o Johrei?', ja: '浄霊には正しい順序があるか',
    teaser: 'A sequência importa.' },
  { id: 'o-que-e-acupo', status: 'iluminada', licoes: ['JK1', 'JK2'],
    pt: "Afinal, o que é um 'ponto vital' do Johrei?", ja: 'そもそも浄霊の「急所」とは何か',
    teaser: 'O começo de tudo.' },
  { id: 'pensamentos', status: 'iluminada', licoes: ['Jsounen'],
    pt: 'O que os pensamentos do ministrante têm a ver com o Johrei?', ja: '浄霊と奉仕者の想念はどう関わるか',
    teaser: 'A atitude também ministra.' },
  { id: 'bulbo', status: 'iluminada', licoes: ['enzui'],
    pt: 'Por que o bulbo raquidiano é um ponto tão importante?', ja: 'なぜ延髄はこれほど重要な急所なのか',
    teaser: 'Um ponto pequeno, um alcance grande.' },
  { id: 'ombros', status: 'iluminada', licoes: ['kata1', 'kata2'],
    pt: 'Por que os ombros recebem tanta atenção no Johrei?', ja: 'なぜ浄霊で肩がこれほど重視されるのか',
    teaser: 'O acúmulo que quase todos carregam.' },
  { id: 'medicina', status: 'iluminada', licoes: ['JH5', 'JH6'],
    pt: 'Pode-se aplicar Johrei e tomar remédios ao mesmo tempo?', ja: '浄霊と薬を併用してよいか',
    teaser: 'Os Ensinamentos são claros.' },
  { id: 'resfriado', status: 'iluminada', licoes: ['kaze1', 'Bkansha'],
    pt: 'O resfriado é um mal a combater — ou uma limpeza a agradecer?', ja: '風邪は敵か、それとも感謝すべき浄化か',
    teaser: 'O que parece doença pode ser cura.' },
  { id: 'travar-purificacao', status: 'iluminada', licoes: ['yakudokuTEISI', 'yakudoku1'],
    pt: 'Por que os remédios podem travar a própria purificação?', ja: 'なぜ薬は浄化作用を止めてしまうのか',
    teaser: 'O alívio que adia.' },
  { id: 'cientifico', status: 'iluminada', licoes: ['JG4', 'JKG1'],
    pt: 'O Johrei é compatível com a ciência?', ja: '浄霊は科学と相容れるか',
    teaser: 'Não é fé cega.' },
  { id: 'mental', status: 'iluminada', licoes: ['kannen1', 'kannen2'],
    pt: 'O Johrei é uma forma de sugestão ou terapia mental?', ja: '浄霊は暗示・精神療法の一種か',
    teaser: 'Há quem confunda.' },
  { id: 'febre', status: 'iluminada', licoes: ['binetu', 'kaze2'],
    pt: 'Toda febre deve ser baixada?', ja: '熱はすべて下げるべきか',
    teaser: 'Nem todo calor é inimigo.' },
  { id: 'mente-pontos', status: 'iluminada', licoes: ['SJ2', 'SJ3'],
    pt: 'Quais os pontos vitais para quem sofre da mente?', ja: '精神を病む人への急所はどこか',
    teaser: 'Onde a luz alcança a aflição.' },
];
// Normaliza arquivos das perguntas (adiciona .html)
for (const q of PERGUNTAS) {
  if (q.licoes) q.licoes = q.licoes.map((f) => (f.endsWith('.html') ? f : `${f}.html`));
}

// ---- 4. Monta os artigos -----------------------------------------------------
const articles = [];
const missing = [];
for (const [file, groups] of Object.entries(MAP)) {
  const meta = IDX[`${VOL}/${file}`];
  if (!meta) { missing.push(file); continue; }
  articles.push({ f: file, pt: meta.pt, ja: meta.ja, n: meta.n, g: groups, tg: fileTags[file] || [] });
}
articles.sort((a, b) => Number(a.n) - Number(b.n));

// ---- 5. Validações -----------------------------------------------------------
if (missing.length) {
  console.error('⚠️  Arquivos sem título no índice global:', missing);
}
const knownGroupIds = new Set(GROUPS.map(g => g.id));
for (const a of articles) {
  for (const g of a.g) {
    if (!knownGroupIds.has(g)) console.error(`⚠️  ${a.f} referencia grupo inexistente: ${g}`);
  }
}
const usedGroups = new Set(articles.flatMap(a => a.g));
for (const g of GROUPS) {
  if (!usedGroups.has(g.id)) console.error(`⚠️  Grupo sem artigos: ${g.id} (${g.pt})`);
}

// Valida temas: arquivos inexistentes + contagem por tema
const knownFiles = new Set(articles.map(a => a.f));
const knownTagIds = new Set(TAGS.map(t => t.id));
for (const [tagId, files] of Object.entries(TAG_FILES)) {
  if (!knownTagIds.has(tagId)) console.error(`⚠️  TAG_FILES referencia tema sem metadado: ${tagId}`);
  for (const base of files) {
    const f = base.endsWith('.html') ? base : `${base}.html`;
    if (!knownFiles.has(f)) console.error(`⚠️  Tema "${tagId}" referencia arquivo inexistente: ${f}`);
  }
}
const tagCount = (id) => articles.filter(a => a.tg.includes(id)).length;
for (const t of TAGS) {
  if (tagCount(t.id) === 0) console.error(`⚠️  Tema sem artigos: ${t.id} (${t.pt})`);
}
const tagsSorted = [...TAGS].sort((a, b) => tagCount(b.id) - tagCount(a.id));

// Valida perguntas: cada lição apontada existe
for (const q of PERGUNTAS) {
  for (const f of (q.licoes || [])) {
    if (!knownFiles.has(f)) console.error(`⚠️  Pergunta "${q.id}" referencia arquivo inexistente: ${f}`);
  }
  if (q.status === 'iluminada' && !(q.licoes && q.licoes.length)) {
    console.error(`⚠️  Pergunta "${q.id}" é 'iluminada' mas sem lições.`);
  }
}

// ---- 6. Emite o arquivo ------------------------------------------------------
const out = `// GERADO por scripts/build_johrei_points.mjs — NÃO editar à mão.
// Pontos Vitais do Johrei (${VOL}): 3 eixos de grupo (região/sintoma/fundamento) + descobertas.
window.JOHREI_POINTS = ${JSON.stringify({ vol: VOL, groups: GROUPS, tags: tagsSorted, perguntas: PERGUNTAS, articles }, null, 1)};
`;
writeFileSync(join(ROOT, 'site_data', 'johrei_points.js'), out, 'utf8');
const abertas = PERGUNTAS.filter(q => q.status === 'aberta').length;
console.log(`✓ site_data/johrei_points.js — ${articles.length} artigos, ${GROUPS.length} grupos, ${PERGUNTAS.length} perguntas (${abertas} em aberto).`);
const byAxis = (ax) => GROUPS.filter(g => g.axis === ax).length;
console.log(`  Eixos: região(${byAxis('regiao')}), sintoma(${byAxis('sintoma')}), fundamento(${byAxis('fundamento')}).`);
