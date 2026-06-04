// ============================================================
// build_disease_map.mjs
// Gera site_data/disease_map.js — a taxonomia de dois eixos da
// "Análise Espiritual das Doenças" (mioshiec2, seção 5) para a
// interface de exploração guiada (analise-espiritual.html).
//
// Fonte da verdade dos títulos: site_data/global_index_titles.js
// Fonte da verdade dos agrupamentos: GROUPS + MAP abaixo.
// Corrigir a taxonomia = editar MAP/GROUPS e rodar `node scripts/build_disease_map.mjs`.
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

// ---- 2. Metadados dos grupos (dois eixos) ------------------------------------
// axis: 'condicao' (o "quê" — porta de entrada pela vida) | 'causa' (o "porquê")
// Sem ícones: tom sóbrio, design nórdico — a tipografia carrega a hierarquia.
const GROUPS = [
  // ----- EIXO B: CONDIÇÕES / SINTOMAS -----
  { id: 'B1', axis: 'condicao', pt: 'Mente, nervos e sono', ja: '精神・神経・睡眠',
    pergunta: 'Por que a mente adoece — e por que o sono foge?' },
  { id: 'B2', axis: 'condicao', pt: 'Coração e circulação', ja: '心臓・循環',
    pergunta: 'O coração que dispara tem causa espiritual?' },
  { id: 'B3', axis: 'condicao', pt: 'Alimentação', ja: '食の異常',
    pergunta: 'Por que alguém come o que não devia — ou recusa o alimento?' },
  { id: 'B4', axis: 'condicao', pt: 'Ossos, movimento e paralisia', ja: '骨・運動・麻痺',
    pergunta: 'O que paralisa o corpo, do reumatismo à paralisia?' },
  { id: 'B5', axis: 'condicao', pt: 'Desenvolvimento e nascimento', ja: '発育・出生',
    pergunta: 'Por que uma criança não se desenvolve como deveria?' },
  { id: 'B6', axis: 'condicao', pt: 'Pulmão, debilidade e câncer', ja: '肺・衰弱・癌',
    pergunta: 'O que Meishu-Sama ensinou sobre o câncer e a debilidade?' },
  { id: 'B7', axis: 'condicao', pt: 'Olhos e visão', ja: '目・視覚',
    pergunta: 'Por que a visão se perde ou se altera?' },
  { id: 'B8', axis: 'condicao', pt: 'Ouvido, fala e voz', ja: '耳・言葉・声',
    pergunta: 'O que está por trás da surdez e dos distúrbios da fala?' },
  { id: 'B9', axis: 'condicao', pt: 'Pele e aparência', ja: '皮膚・容姿',
    pergunta: 'Por que a pele, o cabelo e o corpo mudam?' },

  // ----- EIXO A: CAUSAS ESPIRITUAIS -----
  { id: 'A1', axis: 'causa', pt: 'Fundamentos: Doença e Obsessão Espiritual', ja: '病気と憑霊（基礎）',
    pergunta: 'A base: o que é, afinal, a obsessão espiritual?' },
  { id: 'A2', axis: 'causa', pt: 'Possessão por espíritos humanos', ja: '人霊の憑依',
    pergunta: 'Como espíritos humanos influenciam a saúde?' },
  { id: 'A3', axis: 'causa', pt: 'Possessão por espíritos animais', ja: '動物霊の憑依',
    pergunta: 'Cobra, raposa, dragão: como espíritos animais agem no corpo?' },
  { id: 'A4', axis: 'causa', pt: 'Reencarnação e renascimento', ja: '再生',
    pergunta: 'O que trazemos de outras vidas para esta?' },
  { id: 'A5', axis: 'causa', pt: 'Pecado, carma e impureza', ja: '罪・業・穢れ',
    pergunta: 'Como o pecado e o carma se manifestam como doença?' },
  { id: 'A6', axis: 'causa', pt: 'Advertência dos ancestrais', ja: '先祖の戒告',
    pergunta: 'Quando a doença é um chamado dos antepassados?' },
  { id: 'A7', axis: 'causa', pt: 'Rancor, maldição e espíritos vivos', ja: '生霊・恨み・呪い',
    pergunta: 'Rancor, maldição, espíritos vivos: como adoecem?' },
  { id: 'A8', axis: 'causa', pt: 'Veneno de remédios e medicina', ja: '薬毒',
    pergunta: 'Como o veneno dos remédios abre porta ao espiritual?' },
  { id: 'A9', axis: 'causa', pt: 'Personalidade e constituição', ja: '性格・体質',
    pergunta: 'O caráter de uma pessoa influencia sua doença?' },
];

// ---- 3. Arquivo -> grupos ----------------------------------------------------
// Cada artigo aparece sob cada grupo listado (multi-eixo = aparece nos dois).
const MAP = {
  // A1 Fundamentos
  'BH1.html': ['A1'], 'BH2.html': ['A1'], 'BH3.html': ['A1'], 'BH4.html': ['A1'], 'BH5.html': ['A1'],
  // B1 Mente/nervos/sono (alguns também marcam a causa pelo título)
  'seisinbyou1.html': ['B1', 'A2'], 'seisinbyou2.html': ['B1', 'A3'],
  'seisinbyou3.html': ['B1', 'A2', 'A3'], 'seisinbyou4.html': ['B1'],
  'kyoubouS.html': ['B1'], 'warauS.html': ['B1'], 'bokuseki.html': ['B1'],
  'shokuziIZYOU.html': ['B1', 'B3'], 'yuuutu.html': ['B1'], 'hisu.html': ['B1'],
  'SK1.html': ['B1', 'A3'], 'SK2.html': ['B1', 'A3'], 'SK3.html': ['B1', 'A3'], 'SK4.html': ['B1', 'A3'],
  'nihonzinS.html': ['B1'], 'SJ1.html': ['B1'], 'SJ2.html': ['B1'], 'SJ3.html': ['B1'],
  'tenkan1.html': ['B1'], 'tenkan2.html': ['B1'], 'hikituke.html': ['B1'],
  'muyuu.html': ['B1'], 'humin.html': ['B1'], 'yonaki.html': ['B1'], 'negoto.html': ['B1'],
  // B2 Coração
  'sinzouS.html': ['B2'], 'sinzouKODOU.html': ['B2', 'A1'],
  // B3 Alimentação
  'getemono.html': ['B3'], 'henshoku.html': ['B3'],
  // B4 Ossos/movimento/paralisia
  'shounimahi.html': ['B4'], 'reiMAHI.html': ['B4'], 'honenasi.html': ['B4'], 'ryuumati.html': ['B4'],
  // B5 Desenvolvimento/nascimento/deformidade
  'titekishougai1.html': ['B5'], 'titekishougai2.html': ['B5'], '1sun.html': ['B5'],
  'kikei1.html': ['B5'], 'kikei2.html': ['B5'], 'kikei3.html': ['B5'], 'souseizi.html': ['B5'],
  // B6 Pulmão/debilidade/câncer
  'haibyouH.html': ['B6', 'A1'], 'Hsuizyaku.html': ['B6', 'A1'], 'reiGAN.html': ['B6'],
  // B7 Olhos
  'rei1ME.html': ['B7'], 'rei2ME.html': ['B7'], 'sokohi.html': ['B7'],
  'sikimou.html': ['B7'], 'sakamatuge.html': ['B7'],
  // B8 Ouvido/fala/voz
  'choukaku.html': ['B8'], 'kouon.html': ['B8'],
  // B9 Pele/aparência
  'hihu.html': ['B9'], 'wakiga.html': ['B9'], 'aza.html': ['B9'], 'hage.html': ['B9'],
  // A2 Espíritos humanos
  'zinrei1.html': ['A2'], 'zinrei2.html': ['A2'], 'zinrei3.html': ['A2'],
  'zinreiDOUBUTUREI.html': ['A2', 'A3'], 'mizuko1.html': ['A2'], 'mizuko2.html': ['A2'],
  'zisatu.html': ['A2'], 'dokusi.html': ['A2'], 'suisi.html': ['A2'], 'hensi.html': ['A2'],
  'sensi.html': ['A2'], 'kyuusi.html': ['A2'], 'chuuhuu.html': ['A2', 'B4'],
  'shuuchaku.html': ['A2'], 'zigoku.html': ['A2'],
  // A3 Espíritos animais
  'doubutuREI.html': ['A3'], 'doubutuREIkyoudou.html': ['A3'], 'doubutuREItatari.html': ['A3', 'A7'],
  'hebi1.html': ['A3'], 'hebi2.html': ['A3'], 'hebi3.html': ['A3'], 'hebiDOKU.html': ['A3'],
  'ryuuzin1.html': ['A3'], 'ryuuzin2.html': ['A3'], 'ryuuzin3.html': ['A3'], 'ryuuzin4.html': ['A3'],
  'kitune.html': ['A3'], 'tanuki.html': ['A3'], 'neko.html': ['A3'], 'inu.html': ['A3'],
  'usi.html': ['A3'], 'usagi.html': ['A3'], 'sakana.html': ['A3'], 'kaeru.html': ['A3'],
  'tori.html': ['A3'], 'musi.html': ['A3'], 'ryousi.html': ['A3'],
  // A4 Reencarnação
  'saisei1.html': ['A4'], 'saisei2.html': ['A4'], 'saisei3.html': ['A4'], 'saisei4.html': ['A4'],
  // A5 Pecado/carma/impureza
  'tumi1.html': ['A5'], 'tumi2.html': ['A5'], 'tumi3.html': ['A5'], 'tumi4.html': ['A5'],
  'tumi5.html': ['A5'], 'tumi6.html': ['A5'], 'tumi7.html': ['A5'], 'tumi8.html': ['A5'],
  'keibatu.html': ['A5'], 'matigaiSINKOU.html': ['A5'],
  // A6 Ancestrais
  'kaikoku1.html': ['A6'], 'kaikoku2.html': ['A6'], 'kaikoku3.html': ['A6'], 'kaikoku4.html': ['A6'],
  // A7 Rancor/maldição/espíritos vivos
  'ikiryou.html': ['A7'], 'urami1.html': ['A7'], 'urami2.html': ['A7'], 'urami3.html': ['A7'],
  'noroi.html': ['A7'], 'tatari.html': ['A7'],
  // A8 Veneno de remédios
  'yakudokuH.html': ['A8'],
  // A9 Personalidade
  'seikaku.html': ['A9'],
};

// ---- 3b. Temas transversais (3º eixo de navegação: "Por tema") ----------------
// Fios que ATRAVESSAM os dois eixos — entrada por concepção de vida, p/ descoberta.
// Curadoria proposta (revisar): editar TAG_FILES + TAGS e rodar de novo.
// (Intencionalmente SEM "possessão"/"animais"/"espíritos humanos": são amplos
//  demais — equivalem ao próprio eixo de causa. Aqui ficam os recortes finos.)
const TAGS = [
  { id: 'morte', pt: 'Morte', ja: '死' },
  { id: 'crianca', pt: 'Criança e bebê', ja: '子供・水子' },
  { id: 'antepassados', pt: 'Antepassados', ja: '先祖' },
  { id: 'pecado', pt: 'Pecado e carma', ja: '罪・業' },
  { id: 'reencarnacao', pt: 'Reencarnação', ja: '再生' },
  { id: 'agua', pt: 'Água', ja: '水' },
  { id: 'veneno', pt: 'Veneno', ja: '毒' },
  { id: 'sono', pt: 'Sono e noite', ja: '睡眠・夜' },
  { id: 'mente', pt: 'Mente e loucura', ja: '精神' },
  { id: 'raposa', pt: 'Raposa (Inari)', ja: '狐' },
  { id: 'cobra', pt: 'Cobra', ja: '蛇' },
  { id: 'dragao', pt: 'Dragão', ja: '龍神' },
  { id: 'rancor', pt: 'Rancor e maldição', ja: '恨み・呪い' },
  { id: 'paralisia', pt: 'Paralisia', ja: '麻痺' },
];
// tema -> arquivos (sem .html; o sufixo é adicionado abaixo)
const TAG_FILES = {
  morte: ['zisatu', 'dokusi', 'suisi', 'hensi', 'sensi', 'kyuusi', 'chuuhuu', 'shuuchaku', 'zigoku'],
  crianca: ['mizuko1', 'mizuko2', '1sun', 'shounimahi', 'yonaki', 'titekishougai1', 'titekishougai2', 'souseizi', 'kikei1', 'kikei2', 'kikei3'],
  antepassados: ['kaikoku1', 'kaikoku2', 'kaikoku3', 'kaikoku4', 'tumi1', 'tumi2'],
  pecado: ['tumi1', 'tumi2', 'tumi3', 'tumi4', 'tumi5', 'tumi6', 'tumi7', 'tumi8', 'keibatu', 'matigaiSINKOU'],
  reencarnacao: ['saisei1', 'saisei2', 'saisei3', 'saisei4', 'suisi', 'ryuuzin1', 'ryuuzin2', 'ryuuzin3', 'ryuuzin4', 'kaeru', 'tori', 'usagi'],
  agua: ['suisi', 'ryuuzin1', 'ryuuzin2', 'ryuuzin3', 'ryuuzin4', 'kaeru', 'sakana'],
  veneno: ['dokusi', 'hebiDOKU', 'yakudokuH'],
  sono: ['humin', 'muyuu', 'yonaki', 'negoto'],
  mente: ['seisinbyou1', 'seisinbyou2', 'seisinbyou3', 'seisinbyou4', 'kyoubouS', 'warauS', 'bokuseki', 'yuuutu', 'hisu', 'SK1', 'SK2', 'SK3', 'SK4', 'nihonzinS', 'shokuziIZYOU'],
  raposa: ['kitune', 'SK1', 'SK2', 'SK3', 'SK4'],
  cobra: ['hebi1', 'hebi2', 'hebi3', 'hebiDOKU'],
  dragao: ['ryuuzin1', 'ryuuzin2', 'ryuuzin3', 'ryuuzin4'],
  rancor: ['urami1', 'urami2', 'urami3', 'noroi', 'tatari', 'ikiryou'],
  paralisia: ['chuuhuu', 'reiMAHI', 'shounimahi', 'ryuumati'],
};

// Inverte: arquivo -> [temas]
const fileTags = {};
for (const [tagId, files] of Object.entries(TAG_FILES)) {
  for (const base of files) {
    const f = base.endsWith('.html') ? base : `${base}.html`;
    (fileTags[f] ||= []).push(tagId);
  }
}

// ---- 3c. Perguntas (4º modo: organização PROVOCATIVA — gera sede de estudo) ---
// Não prescreve caminho: provoca. Cada pergunta abre uma curiosidade (fenômenos
// estranhos cuja causa é espiritual e "ninguém parou para pensar") e aponta para
// o Ensinamento que a ilumina. Algumas ficam EM ABERTO — a fronteira do estudo.
//   status 'iluminada' -> licoes:[arquivos que respondem]
//   status 'aberta'    -> convite (sem licoes): pergunta de observação/reflexão
// teaser = provocação curta, SEM entregar a resposta. licoes[].f sem .html.
const PERGUNTAS = [
  { id: 'rir', status: 'iluminada', licoes: ['warauS'],
    pt: 'Por que alguém ri sem conseguir parar?', ja: '笑いが止まらないのはなぜか？',
    teaser: 'Uma alegria que não é alegria.' },
  { id: 'getemono', status: 'iluminada', licoes: ['getemono'],
    pt: 'Por que alguém deseja comer o que não é alimento?', ja: '食べ物でないものを食べたくなるのはなぜか？',
    teaser: 'Um apetite que não vem do corpo.' },
  { id: 'choro-noturno', status: 'iluminada', licoes: ['yonaki'],
    pt: 'Por que um bebê chora toda noite, sempre na mesma hora?', ja: '赤ちゃんが毎晩同じ時刻に泣くのはなぜか？',
    teaser: 'O choro tem um relógio — e uma razão.' },
  { id: 'sono', status: 'iluminada', licoes: ['negoto'],
    pt: 'O que se revela enquanto dormimos — falar, ranger os dentes, roncar?', ja: '眠っている間に現れるもの（寝言・歯ぎしり・いびき）は何を表すか？',
    teaser: 'O sono não cala o que está oculto.' },
  { id: 'medo-agua', status: 'iluminada', licoes: ['suisi'],
    pt: 'Um medo de água sem explicação pode vir de outra vida?', ja: '理由のない水への恐れは、前世から来るのか？',
    teaser: 'Há quem tema o que nunca viveu — nesta vida.' },
  { id: 'pele', status: 'iluminada', licoes: ['aza', 'hage'],
    pt: 'Manchas de nascença e calvície podem ter raiz espiritual?', ja: '生まれつきの痣や脱毛にも霊的な原因があるか？',
    teaser: 'Nem tudo na pele começa na pele.' },
  { id: 'odor', status: 'iluminada', licoes: ['wakiga'],
    pt: 'Existe causa espiritual até para o odor do corpo?', ja: '体臭にさえ霊的な原因があるか？',
    teaser: 'O corpo exala mais do que imaginamos.' },
  { id: 'cegueira-noturna', status: 'iluminada', licoes: ['sikimou'],
    pt: 'Por que alguém enxerga de dia, mas não ao anoitecer?', ja: '昼は見えても夕暮れに見えなくなるのはなぜか？',
    teaser: 'A visão que falha tem hora marcada.' },
  { id: 'petrificar', status: 'iluminada', licoes: ['bokuseki'],
    pt: "O que faz uma pessoa 'endurecer', como madeira ou pedra?", ja: '人が木や石のように「固まる」のは何によるのか？',
    teaser: 'Uma rigidez que não é do corpo.' },
  { id: 'purificacao', status: 'iluminada', licoes: ['BH1', 'BH5'],
    pt: 'E se aquela reação estranha do corpo for, na verdade, uma purificação?', ja: 'その奇妙な体の反応は、実は浄化ではないか？',
    teaser: 'O que parece doença pode ser limpeza.' },
  // ----- Respostas que revelam POSSESSÃO ESPIRITUAL (a presença de outro) -----
  { id: 'muda-personalidade', status: 'iluminada', licoes: ['seisinbyou1', 'zinrei1'],
    pt: 'Por que alguém muda de personalidade, como se fosse outra pessoa?', ja: '人が別人のように人格が変わるのはなぜか？',
    teaser: 'Quando o caráter muda sem aviso, pode não ser só ela ali.' },
  { id: 'age-como-animal', status: 'iluminada', licoes: ['seisinbyou2', 'doubutuREI'],
    pt: 'Por que uma pessoa passa a agir como um animal?', ja: '人が動物のように振る舞うのはなぜか？',
    teaser: 'O corpo é humano; o comportamento, de outro.' },
  { id: 'enfeiticado', status: 'iluminada', licoes: ['kitune', 'SK1'],
    pt: "O que há por trás de alguém que parece 'enfeitiçado'?", ja: '「憑かれた」ように見えるのは何によるのか？',
    teaser: 'A raposa tem fama antiga — e os Ensinamentos dizem por quê.' },
  { id: 'furia-subita', status: 'iluminada', licoes: ['kyoubouS', 'seisinbyou1'],
    pt: 'O que leva alguém pacífico a uma fúria súbita e incontrolável?', ja: '穏やかな人が突然、抑えられない怒りに駆られるのはなぜか？',
    teaser: 'Há fúrias que parecem vir de fora.' },
  { id: 'contorcoes-serpente', status: 'iluminada', licoes: ['hebi1', 'hebi2'],
    pt: 'Por que o corpo de alguém se retorce como uma serpente?', ja: '体が蛇のようにくねるのはなぜか？',
    teaser: 'Certos movimentos denunciam quem os move.' },
  // ----- Mais mistérios do cotidiano (resposta nos Ensinamentos) -----
  { id: 'sonambulo', status: 'iluminada', licoes: ['muyuu'],
    pt: 'Quem caminha dormindo — para onde, afinal, está indo?', ja: '夢遊病者は、いったいどこへ向かっているのか？',
    teaser: 'O corpo anda; e o resto?' },
  { id: 'gemeos', status: 'iluminada', licoes: ['souseizi'],
    pt: 'Por que gêmeos? Haveria algo espiritual em nascer em dois?', ja: 'なぜ双子なのか。二人で生まれることに霊的な意味があるのか？',
    teaser: 'Dois corpos — e uma pergunta antiga.' },
  { id: 'cacador', status: 'iluminada', licoes: ['ryousi', 'doubutuREItatari'],
    pt: 'Por que quem tira a vida de animais adoece de um modo próprio?', ja: '生き物の命を奪う者が、特有の病にかかるのはなぜか？',
    teaser: 'O que se faz a um ser vivo, retorna.' },
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
// Conta artigos por tema e ordena os temas por riqueza (mais populados primeiro)
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
const out = `// GERADO por scripts/build_disease_map.mjs — NÃO editar à mão.
// Análise Espiritual das Doenças (${VOL}): 2 eixos + temas transversais + perguntas.
window.DISEASE_MAP = ${JSON.stringify({ vol: VOL, groups: GROUPS, tags: tagsSorted, perguntas: PERGUNTAS, articles }, null, 1)};
`;
writeFileSync(join(ROOT, 'site_data', 'disease_map.js'), out, 'utf8');
const abertas = PERGUNTAS.filter(q => q.status === 'aberta').length;
console.log(`✓ site_data/disease_map.js — ${articles.length} artigos, ${GROUPS.length} grupos, ${TAGS.length} temas, ${PERGUNTAS.length} perguntas (${abertas} em aberto).`);
console.log('  Temas:', tagsSorted.map(t => `${t.pt}(${tagCount(t.id)})`).join(', '));
