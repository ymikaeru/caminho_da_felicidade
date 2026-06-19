#!/usr/bin/env node
// ============================================================
// poetry_translate_gemini.mjs — traduz poemas do skeleton JSON
// via Gemini API (gemini-3.1-pro-preview), aplicando o prompt
// completo do Akemaro Kineishu (tríade Kigo/Kototama/Profundidade).
//
// Lê:  data/poetry/gosanka_<key>_skeleton.json     (parser)
// Grava: data/poetry/gosanka_<key>.json             (incremental)
//
// Salva após CADA lote pra ser retomável.
// Pula poemas que já têm `translation` preenchida (resume automático).
//
// Uso:
//   GEMINI_API_KEY=AIza... node scripts/poetry_translate_gemini.mjs --key=shoban
//   GEMINI_API_KEY=AIza... node scripts/poetry_translate_gemini.mjs --key=shoban --limit=3   # piloto
//   node scripts/poetry_translate_gemini.mjs --key=shoban --dry-run                          # mostra payload sem chamar
// ============================================================

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── carga de .env.local manualmente ────────────────────────
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const txt = readFileSync(path, 'utf8');
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
}
loadDotEnv(join(ROOT, '.env.local'));

// ─── args ────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const KEY = args.key;
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const DRY_RUN = !!args['dry-run'];
const BATCH_SIZE = args.batch ? parseInt(args.batch, 10) : 3;
const MODEL = args.model || 'gemini-3.1-pro-preview';
const SECTION_ONLY = args.section ? parseInt(args.section, 10) : null;

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const API_KEY = process.env.GEMINI_API_KEY;

if (!KEY) {
  console.error('Uso: node scripts/poetry_translate_gemini.mjs --key=<shoban|kaitei|shikiten> [--limit=3] [--dry-run]');
  process.exit(1);
}
if (!DRY_RUN && !API_KEY) {
  console.error('Falta GEMINI_API_KEY no .env.local ou no ambiente.');
  process.exit(1);
}

const SKELETON_PATH = join(ROOT, 'data', 'poetry', `gosanka_${KEY}_skeleton.json`);
const OUTPUT_PATH = join(ROOT, 'data', 'poetry', `gosanka_${KEY}.json`);

if (!existsSync(SKELETON_PATH)) {
  console.error(`Esqueleto não encontrado: ${SKELETON_PATH}`);
  console.error('Rode antes: node scripts/poetry_parse.mjs');
  process.exit(1);
}

// ─── prompt sistêmico (replica fielmente o do Akemaro) ──────
const SYSTEM_PROMPT = `# Tradução de Poemas de Meishu-Sama (Mokichi Okada) — Modelo de Profundidade Máxima

## Role (Papel)
Atue como um Tradutor Editorial Sênior e Especialista em Espiritualidade Oriental, com autoridade suprema na filosofia de Meishu-Sama (Mokichi Okada) e na estética literária japonesa (Waka/Tanka).

## Objetivo
Traduzir poemas do japonês para o português (PT-BR) aplicando o "Modelo de Profundidade Máxima". O foco não é a tradução literal, mas a transmissão do *Kototama* (Alma da Palavra), do *Yugen* (Beleza Sutil) e da Lição Espiritual.

## Regras de Ouro (Estilo e Conteúdo)

- **Fluidez Nobre:** o português deve ser culto, rítmico e visual. Evite a ordem gramatical do japonês (SOV). Use vocabulário elevado (ex: "Gélido" em vez de "frio"; "Vasto" em vez de "grande"; "Crepúsculo" em vez de "fim de tarde").
- **Fidelidade Espiritual:** interprete cada poema sob a ótica da Verdade, Bem e Belo, da Lei da Natureza e da transição das Eras.
- **Vocabulário japonês — regras claras:**
  - **Sempre em romaji** (doutrinários e geográficos): Kannon, Johrei, Komyo, Kototama, Yuzuriha, Aware, Yugen, Izunome, Makoto, Mahikari no Mitama, Tariki, Kannongyo, Myochiriki, Misogi, Wakō Dōjin, Daikomyo Nyorai, Koyokai, Nyorai, Fuji, Tamagawa, Hakone, Atami, Ise, Moto-Ise, Tsujidō, Hiratsuka, Odawara, Manazuru, Hakkeien, Kanrei, Komagatake, Kamiyama, Yugyōji, Shinsenkyō, Sekirakuen.
  - **Sempre traduzir** (termos com tradução consagrada em PT-BR):
    - Kirisuto (基督) → **Cristo**
    - Shaka (釈迦) → **Buda** ou **Buda Shakyamuni**
    - Hotoke (仏) / Mihotoke (御仏) → **Buda** / **Precioso Buda**
    - Magakami (曲神) → **deuses sombrios** (plural minúsculo)
    - Ten / Ame (天) → **Céu**
    - Tengoku (天国) → **Paraíso** ou **Reino Celestial**
    - Mahito (真人) → **Homem Verdadeiro**
- **Volição em 1ª pessoa singular** (formas verbais -an/-mu/-n): quando o original tem o autor declarando intenção pessoal (吾/われ/ware sozinho ou em contraste com 汝/なれ/nare), traduzir em **1ª pessoa singular** ("provarei", "varrerei"), NUNCA em plural. A 1ª pessoa do plural só com われら/warera (nós) explícito.
- **Pontuação enxuta — proibido em-dash decorativo:** NÃO adicione travessão (—, –, --) onde o japonês não tem pausa explícita. Para pausas marcadas por kireji (や, かな, けり, ぞ, ね, よ) ou espaço wide-jp (　) entre estrofes 5-7-5-7-7, prefira **vírgula**, **ponto-final** ou **quebra de linha**. Travessão SÓ se há kireji dramático real (や/ぞ em pivô semântico).
- **Análise Tríade (Obrigatória):** Para cada poema, forneça:
  - 🍃 **Kigo (A Estação e o Clima):** análise sensorial da estação, luz, temperatura, paisagem e clima.
  - 🎵 **Kototama (A Sonoridade):** análise fonética — sons suaves vs duros, ritmo, repetições, matéria sonora.
  - 🏔️ **Profundidade (Lição Espiritual):** lição de vida, filosofia ou profecia oculta sob a ótica dos Ensinamentos de Meishu-Sama.
- **Tradução Literal** (translation_literal): versão palavra-por-palavra, espelhando a estrutura sintática do original. Segmentada nas cinco estrofes 5-7-5-7-7 separadas por " / ". Nomes próprios em romaji.
- **Contexto Histórico-Biográfico** (context): uma frase situando o momento da composição — vida de Meishu-Sama, Japão, ou a obra naquela data.
- **Tags Temáticas** (tags): 2 a 5 etiquetas curtas em PT. Vocabulário consistente: Natureza, Kannon, Era do Dia, Profecia, Lar, Viagem, Fuji, Tamagawa, Hakone, Ise, Salvação, Purificação, Saudade, Lirismo, Crítica social, Era da Noite, Messias, Beleza, Paz. Prefira reusar tags existentes.

## Pseudônimo do autor
東山明麿 (Higashiyama Akemaro) / 岡田自観 (Okada Jikan) — pseudônimos poéticos de Meishu-Sama (岡田茂吉 / Okada Mokichi).

## Formato da resposta — JSON estrito
Você recebe um array de poemas com {number, original, reading_hira} e devolve um array com EXATAMENTE a mesma quantidade de items, na MESMA ordem, com este shape:
[
  {
    "number": 1,
    "title": "Título em português (3-6 palavras, poético)",
    "reading": "Romanização em rōmaji segmentada nas 5 estrofes separadas por ' / '",
    "translation": "Tradução artística em português (2-4 linhas), respeitando todas as regras acima",
    "translation_literal": "Tradução literal segmentada nas 5 estrofes separadas por ' / '",
    "context": "Uma frase de contexto histórico-biográfico",
    "tags": ["Tag1", "Tag2", "Tag3"],
    "kigo": "Análise sensorial da estação e clima evocados",
    "kototama": "Análise fonética e ritmo sonoro",
    "profundidade": "Lição espiritual sob a ótica de Meishu-Sama"
  }
]`;

// ─── helpers ────────────────────────────────────────────────
function chunkArray(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function callGemini(payloadItems, sectionContext) {
  if (DRY_RUN) {
    console.log('[DRY] payload:', JSON.stringify(payloadItems, null, 2));
    return payloadItems.map((p) => ({
      number: p.number,
      title: `[piloto] título ${p.number}`,
      reading: '(piloto)',
      translation: '(piloto)',
      translation_literal: '(piloto)',
      context: '(piloto)',
      tags: ['Piloto'],
      kigo: '(piloto)',
      kototama: '(piloto)',
      profundidade: '(piloto)',
    }));
  }

  const userMessage = JSON.stringify(
    {
      section_context: sectionContext,
      poems: payloadItems.map((p) => ({
        number: p.number,
        original: p.original,
        reading_hira: p.reading_hira,
      })),
    },
    null,
    2
  );

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
    },
  };

  const url = `${GEMINI_URL}?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini API ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Gemini devolveu JSON inválido. Início: ${text.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Esperado array, recebido: ${typeof parsed}`);
  }
  if (parsed.length !== payloadItems.length) {
    throw new Error(`Lote tinha ${payloadItems.length}, recebido ${parsed.length}`);
  }
  return parsed;
}

function mergePoem(skeletonPoem, translated) {
  return {
    number: skeletonPoem.number,
    title: translated.title || '',
    original: skeletonPoem.original,
    reading_hira: skeletonPoem.reading_hira,
    reading: translated.reading || '',
    translation: translated.translation || '',
    translation_literal: translated.translation_literal || '',
    context: translated.context || '',
    tags: Array.isArray(translated.tags) ? translated.tags : [],
    kigo: translated.kigo || '',
    kototama: translated.kototama || '',
    profundidade: translated.profundidade || '',
    marker: skeletonPoem.marker || null,
    translation_source: DRY_RUN ? 'dry-run' : MODEL,
  };
}

function isPoemTranslated(p) {
  return p && p.translation && p.translation.length > 0 && p.translation !== '(piloto)';
}

// ─── load skeleton & existing output ─────────────────────────
const skeleton = JSON.parse(readFileSync(SKELETON_PATH, 'utf8'));
let output;
if (existsSync(OUTPUT_PATH)) {
  output = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
  console.log(`Retomando: ${OUTPUT_PATH}`);
} else {
  // clone skeleton structure but with translation_pending preserved
  output = JSON.parse(JSON.stringify(skeleton));
}

// ─── loop sobre seções/poemas ───────────────────────────────
let translatedThisRun = 0;
let totalTargets = 0;

const allBatches = [];
for (let si = 0; si < skeleton.sections.length; si++) {
  if (SECTION_ONLY !== null && si !== SECTION_ONLY) continue;
  const section = skeleton.sections[si];
  const sectionContext = {
    title_jp: section.title_jp,
    title_furigana: section.title_furigana,
    subtitle_jp: section.subtitle_jp || null,
    date_jp: section.date_jp || null,
    year_iso: section.year_iso || null,
    source_jp: section.source_jp || null,
  };
  // Identifica poemas pendentes neste output (não no skeleton — o output é o estado atual)
  const targets = [];
  for (let pi = 0; pi < section.poems.length; pi++) {
    const outPoem = output.sections[si].poems[pi];
    if (!isPoemTranslated(outPoem)) targets.push({ si, pi, poem: section.poems[pi] });
  }
  totalTargets += targets.length;
  for (const batch of chunkArray(targets, BATCH_SIZE)) {
    allBatches.push({ si, sectionContext, batch });
  }
}

console.log(`[${KEY}] Total a traduzir agora: ${totalTargets} poemas em ${allBatches.length} lotes de ${BATCH_SIZE}`);
console.log(`Modelo: ${MODEL}  |  Dry-run: ${DRY_RUN}  |  Limit: ${LIMIT === Infinity ? 'sem' : LIMIT}`);

if (totalTargets === 0) {
  console.log('Nada a fazer.');
  process.exit(0);
}

// ─── backup do output antes de começar (se já existir) ──────
if (existsSync(OUTPUT_PATH)) {
  const bak = OUTPUT_PATH + '.bak';
  copyFileSync(OUTPUT_PATH, bak);
  console.log(`Backup criado: ${bak}`);
}

let batchIdx = 0;
for (const { si, sectionContext, batch } of allBatches) {
  batchIdx++;
  if (translatedThisRun >= LIMIT) {
    console.log(`Limite (${LIMIT}) atingido — interrompendo.`);
    break;
  }

  const numbers = batch.map((b) => b.poem.number).join(',');
  const previewLength = LIMIT === Infinity ? '' : ` [${translatedThisRun + batch.length}/${LIMIT}]`;
  process.stdout.write(`[${batchIdx}/${allBatches.length}] seção "${sectionContext.title_jp}" poemas ${numbers}${previewLength}... `);

  try {
    const t0 = Date.now();
    const translated = await callGemini(
      batch.map((b) => b.poem),
      sectionContext
    );
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    // Mesclar no output e salvar.
    for (let i = 0; i < batch.length; i++) {
      const { pi } = batch[i];
      output.sections[si].poems[pi] = mergePoem(batch[i].poem, translated[i]);
    }
    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
    translatedThisRun += batch.length;
    console.log(`OK (${elapsed}s)`);
  } catch (e) {
    console.log(`FALHOU\n  Erro: ${e.message}`);
    console.log(`  Salvando estado atual e parando. Retome rodando o mesmo comando.`);
    break;
  }
}

console.log(`\nFeitos nesta execução: ${translatedThisRun}`);
console.log(`Output: ${OUTPUT_PATH}`);
