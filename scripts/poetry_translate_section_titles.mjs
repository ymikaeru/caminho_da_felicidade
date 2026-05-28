#!/usr/bin/env node
// ============================================================
// poetry_translate_section_titles.mjs — traduz section.title_jp
// (e subtitle_jp quando existe) das 3 coletâneas para PT, em uma
// chamada única ao Gemini. Aplica as mesmas regras de vocabulário
// do prompt principal: nomes de deuses, conceitos doutrinários e
// topônimos sagrados ficam em romaji.
//
// Idempotente: só envia títulos com title_pt vazio.
//
// Uso:
//   GEMINI_API_KEY=... node scripts/poetry_translate_section_titles.mjs
//   node scripts/poetry_translate_section_titles.mjs --dry-run
// ============================================================

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
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

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const DRY_RUN = !!args['dry-run'];
const MODEL = args.model || 'gemini-3.1-pro-preview';
const API_KEY = process.env.GEMINI_API_KEY;

if (!DRY_RUN && !API_KEY) {
  console.error('Falta GEMINI_API_KEY no .env.local');
  process.exit(1);
}

const KEYS = ['shoban', 'kaitei', 'shikiten'];
const FILES = Object.fromEntries(
  KEYS.map((k) => [k, join(ROOT, 'data', 'poetry', `gosanka_${k}.json`)]),
);

// ─── Coleta de títulos pendentes ─────────────────────────────
const dataByKey = {};
const items = []; // { id, key, sectionIdx, title_jp, title_furigana?, subtitle_jp?, kind }

for (const k of KEYS) {
  const j = JSON.parse(readFileSync(FILES[k], 'utf8'));
  dataByKey[k] = j;
  for (let i = 0; i < j.sections.length; i++) {
    const s = j.sections[i];
    if (!s.title_pt || !s.title_pt.trim()) {
      items.push({
        id: `${k}:${i}:title`,
        key: k,
        sectionIdx: i,
        field: 'title_pt',
        title_jp: s.title_jp,
        title_furigana: s.title_furigana || null,
        subtitle_jp: s.subtitle_jp || null,
        date_jp: s.date_jp || null,
        year_iso: s.year_iso || null,
        kind: k === 'shikiten' ? 'ceremony' : 'theme',
      });
    }
    // Subtitle (só shikiten tem)
    if (s.subtitle_jp && !s.subtitle_pt) {
      items.push({
        id: `${k}:${i}:subtitle`,
        key: k,
        sectionIdx: i,
        field: 'subtitle_pt',
        title_jp: s.subtitle_jp,
        parent_title_jp: s.title_jp,
        kind: 'subtitle',
      });
    }
  }
}

console.log(`Total pendente: ${items.length}`);
if (items.length === 0) {
  console.log('Nada a traduzir.');
  process.exit(0);
}

// ─── Prompt sistêmico ────────────────────────────────────────
const SYSTEM_PROMPT = `Você é Tradutor Editorial Sênior e Especialista em Espiritualidade Oriental, autoridade na filosofia de Meishu-Sama (Mokichi Okada).

Tarefa: traduzir TÍTULOS de seções de coletâneas poéticas (御讃歌集) do japonês para o português, mantendo o tom reverencial e a estética do Caminho Messiânico.

Regras de vocabulário (CRÍTICAS):

**Nomes próprios — SEMPRE em romaji (não traduzir):**
- Deidades: Kannon, Senju Kannon (千手観音), Kanzeon Bosatsu, Kinryūjin (金龍神), Kinryū (金龍), Miroku Ōkami (五六七大神 / 弥勒大神), Izunome no Kami (伊都能売神), Daikōmyō Nyorai (大光明如来), Kōmyō Nyorai (光明如来), Amaterasu, Tsukiyomi, Takemusubi
- Conceitos doutrinários: Kannon, Johrei, Komyo (光明), Kannongyō (観音行), Myōchiriki (妙智力), Kannon Myōchiriki (観音妙智力), Kannon-riki (観音力), Kannongesho/Kannon Gesho (観音下生), Gesho/Geshō (下生), Tenchi Kaimei (天地開明), Engi Gusoku (圓満具足), Sanzon no Mida (三尊の彌陀), Kongō Taizō (金剛胎蔵), Suishō Sekai (水晶世界), Miroku Geshō (彌勒下生), Misogi, Wakō Dōjin, Mahikari, Reihō (霊峰), Reimei (黎明 — "alvorada", pode traduzir OU manter), Aware, Yugen
- Topônimos: Fuji, Tamagawa, Hakone, Atami, Ise, Moto-Ise, Manazuru, Hakkeien, Shinsenkyō, Sekirakuen, Banshōden (万照殿), Nikkōden (日光殿), Komagatake, Kamiyama, Hiratsuka, Odawara, Tsujidō, Yugyōji

**SEMPRE traduzir** (têm equivalente consagrado):
- 基督 (Kirisuto) → Cristo
- 釈迦 (Shaka) → Buda / Buda Shakyamuni
- 仏 / 御仏 (Hotoke / Mihotoke) → Buda / Precioso Buda
- 曲神 (Magakami) → deuses sombrios (minúsculo, plural)
- 天 (Ten) → Céu
- 天国 (Tengoku) → Paraíso / Reino Celestial
- 神 (Kami) → Deus / Divindade (conforme contexto)
- 真人 (Mahito) → Homem Verdadeiro

**Cerimônias (shikiten) — formato padrão:**
- 春の大御祭 → Grande Culto de Primavera (Haru no Ōmimatsuri)
- 秋季大祭 → Grande Culto de Outono (Shūki Taisai)
- 春季大祭 → Grande Culto de Primavera (Shunki Taisai)
- 立春祭 → Risshun Matsuri (não "festival do início da primavera" — mantém Risshun em romaji por ser dia astronômico/cultural específico)
- 御生誕祭 → Aniversário Sagrado (Goseitansai)
- 新年御歌 → Cantos de Ano Novo
- 御歌 → Cantos / Cantos Sagrados (quando sufixo de cerimônia)
- 御詠 → Cantos / Composições (quando sufixo de cerimônia)
- 落成記念祭 → Cerimônia Comemorativa da Inauguração
- 完成記念祭 → Cerimônia Comemorativa da Conclusão
- 地鎮祭 → Cerimônia de Bênção do Terreno
- 仮 → Provisório / Temporário

**Tom:**
- Português culto e reverencial. Maiúsculas em conceitos sagrados quando apropriado (Luz, Verdade, Caminho).
- Curto e direto — são títulos de seção, não frases.
- Quando o JP usa kotodama compactos (ex: 救世之光 = Luz que Salva o Mundo), prefira tradução conceitual elegante sobre literal.

**Formato da resposta — JSON estrito:**
Você recebe um array de itens \`{id, title_jp, ...contexto}\` e devolve um array com EXATAMENTE o mesmo número de items na MESMA ordem, no formato:
[
  { "id": "...", "title_pt": "..." }
]
Apenas o id e o title_pt, nada mais.`;

// ─── Chamada Gemini ──────────────────────────────────────────
async function callGemini(items) {
  if (DRY_RUN) {
    console.log('[DRY] payload tem', items.length, 'items. Amostra (3 primeiros):');
    for (const it of items.slice(0, 3)) console.log('  ', JSON.stringify(it));
    return items.map((it) => ({ id: it.id, title_pt: `[piloto] ${it.title_jp}` }));
  }

  const userMessage = JSON.stringify({ items }, null, 2);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
  };

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
  } catch {
    throw new Error(`JSON inválido. Início: ${text.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`Esperado array, recebido: ${typeof parsed}`);
  return parsed;
}

// ─── Executar ───────────────────────────────────────────────
console.log(`Modelo: ${MODEL}  |  Dry-run: ${DRY_RUN}`);
console.log(`Enviando ${items.length} títulos em 1 lote...`);

const t0 = Date.now();
const results = await callGemini(items);
console.log(`Resposta em ${((Date.now() - t0) / 1000).toFixed(1)}s — ${results.length} items`);

if (results.length !== items.length) {
  console.error(`MISMATCH: enviado ${items.length}, recebido ${results.length}`);
  process.exit(1);
}

// Indexar resultados por id
const byId = Object.fromEntries(results.map((r) => [r.id, r]));

// Aplicar nos JSONs
for (const item of items) {
  const r = byId[item.id];
  if (!r || !r.title_pt) {
    console.warn(`Sem resultado para ${item.id}`);
    continue;
  }
  const j = dataByKey[item.key];
  const s = j.sections[item.sectionIdx];
  s[item.field] = r.title_pt.trim();
}

// Backup + write (só se não for dry-run)
if (DRY_RUN) {
  console.log('\n[DRY] Mudanças NÃO foram gravadas. Rode sem --dry-run pra aplicar.');
} else {
  for (const k of KEYS) {
    const path = FILES[k];
    copyFileSync(path, path + '.pre-titles.bak');
    writeFileSync(path, JSON.stringify(dataByKey[k], null, 2) + '\n', 'utf8');
    const updated = dataByKey[k].sections.filter((s) => s.title_pt).length;
    console.log(`[${k}] ${updated}/${dataByKey[k].sections.length} seções com title_pt`);
  }
}

// Show some samples
console.log('\nAmostra:');
for (const k of KEYS) {
  const j = dataByKey[k];
  console.log(`  [${k}]`);
  for (const s of j.sections.slice(0, 3)) {
    const sub = s.subtitle_pt ? ` (${s.subtitle_pt})` : '';
    console.log(`    ${s.title_jp}  →  ${s.title_pt}${sub}`);
  }
}
