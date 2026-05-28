#!/usr/bin/env node
// ============================================================
// poetry_translate_prefaces.mjs — limpa e traduz os prefaces das
// 3 coletâneas de 御讃歌. Faz 2 coisas:
//
//   1. Filtra content_jp pra remover ruído capturado pelo parser
//      (cabeçalho de publicação, nome do arquivo, linhas decorativas
//      de titulo, repetição da palavra "序文"/"はしがき").
//
//   2. Traduz o content_jp limpo pra PT via Gemini, em uma chamada
//      única. Para shikiten (que praticamente não tem preface),
//      escreve uma nota contextual em PT.
//
// Idempotente: só envia coleções com content_pt vazio.
//
// Uso:
//   GEMINI_API_KEY=... node scripts/poetry_translate_prefaces.mjs
//   node scripts/poetry_translate_prefaces.mjs --dry-run
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
const FORCE = !!args.force;
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

// ─── Limpa o content_jp ──────────────────────────────────────
function cleanContentJp(contentJp, titleJp) {
  return contentJp.filter((line) => {
    const t = line.trim();
    if (!t) return false;
    // Cabeçalho de publicação: "御讃歌集（初版）　昭和23年7月1日発行　309首収録"
    if (/^御讃歌集.*(発行|首収録)/.test(t)) return false;
    // Linhas que repetem o título do preface
    if (t === titleJp) return false;
    if (t === '序文' || t === '序　文' || t === 'はしがき') return false;
    // Filename markdown (shikiten capturou ".md")
    if (/\.md$/.test(t)) return false;
    // Linhas decorativas com ―
    if (/^[―\s]+岡.*師.*[―\s]+$/.test(t)) return false;
    if (/^[―\s]*$/.test(t)) return false;
    // Título standalone da coleção
    if (t === '各式典における御讃歌') return false;
    return true;
  });
}

// Notas contextuais em PT pra coleções sem prefácio real
const FALLBACK_NOTES = {
  shikiten: {
    title_pt: 'Sobre esta coletânea',
    content_pt: [
      'Esta coletânea reúne os cantos sagrados (御讃歌, Gosanka) recitados por Meishu-Sama em cada uma das cerimônias realizadas entre o 11º ano da Era Showa (1936) e o 29º ano da Era Showa (1954). Os poemas estão organizados cronologicamente por ocasião — Grande Culto de Primavera, Risshun Matsuri, Aniversário Sagrado, Grande Culto de Outono, e cerimônias especiais como a inauguração do Banshōden e do Nikkōden em Hakone.',
      'Cada seção indica a data original em era Showa, o nome da cerimônia e, quando disponível, a fonte do registro — Coletânea Completa de Okada Mokichi (岡田茂吉全集), Registros do Gokōwa (御光話録), Materiais do Kōhōkai (光宝会資料), entre outros. As datas convertidas ao calendário gregoriano constam ao lado de cada cabeçalho de seção.',
    ],
  },
};

// ─── Coleta de coleções pendentes ────────────────────────────
const dataByKey = {};
const toTranslate = [];
const toWrite = new Set(); // keys que foram modificadas (translation OU fallback)

for (const k of KEYS) {
  const j = JSON.parse(readFileSync(FILES[k], 'utf8'));
  dataByKey[k] = j;
  const hasContent = j.preface && j.preface.content_pt && j.preface.content_pt.length > 0;
  if (hasContent && !FORCE) {
    console.log(`[${k}] já tem content_pt (${j.preface.content_pt.length} parágrafos) — pular`);
    continue;
  }
  if (!j.preface) {
    j.preface = { title_jp: null, title_pt: 'Prefácio', content_jp: [], content_pt: [] };
  }
  const cleaned = cleanContentJp(j.preface.content_jp || [], j.preface.title_jp);
  j.preface.content_jp = cleaned;

  // Se não tem texto JP útil mas tem fallback PT, usa o fallback
  if (cleaned.length === 0 && FALLBACK_NOTES[k]) {
    j.preface.title_pt = FALLBACK_NOTES[k].title_pt;
    j.preface.content_pt = FALLBACK_NOTES[k].content_pt;
    toWrite.add(k);
    console.log(`[${k}] sem preface JP — usando nota contextual PT (${FALLBACK_NOTES[k].content_pt.length} parágrafos)`);
    continue;
  }
  if (cleaned.length === 0) {
    console.log(`[${k}] sem conteúdo — pular`);
    continue;
  }
  toTranslate.push({ key: k, paragraphs: cleaned });
  toWrite.add(k);
}

console.log(`\nColeções a traduzir via Gemini: ${toTranslate.length}`);
console.log(`Coleções a gravar (inclui fallback): ${toWrite.size}`);
for (const t of toTranslate) {
  console.log(`  [${t.key}] ${t.paragraphs.length} parágrafos limpos`);
  for (let i = 0; i < t.paragraphs.length; i++) {
    console.log(`    [${i}] ${t.paragraphs[i].slice(0, 80)}${t.paragraphs[i].length > 80 ? '...' : ''}`);
  }
}

if (toWrite.size === 0) {
  console.log('Nada a fazer.');
  process.exit(0);
}

// ─── Prompt sistêmico ────────────────────────────────────────
const SYSTEM_PROMPT = `Você é Tradutor Editorial Sênior e Especialista em Espiritualidade Oriental, autoridade na filosofia de Meishu-Sama (Mokichi Okada).

Tarefa: traduzir PREFÁCIOS de coletâneas poéticas de Meishu-Sama do japonês para o português, preservando o tom reverencial, a precisão histórica e a estética do Caminho Messiânico.

**Regras de tradução:**

1. **Português culto, fluido, reverencial.** O tom é de uma introdução autoral cuidadosa, não literal.

2. **Datas em era Showa → gregoriano:**
   - 昭和二十三年七月 → "Julho de 1948" (ou "Julho do 23º ano da Era Showa — 1948")
   - 昭和二十六年五月 → "Maio de 1951"
   - 昭和23年8月 → "Agosto de 1948"
   - 昭和29年10月25日 → "25 de outubro de 1954"

3. **Termos doutrinários e nomes próprios — em romaji:**
   - 日本観音会 → Nihon Kannon-kai (Sociedade Japonesa de Kannon, na época)
   - 世界救世教 → Sekai Kyūsei-kyō (Igreja Messiânica Mundial)
   - 言霊 → Kototama
   - 神歌 → cantos divinos / shinka
   - 道歌 → cantos do Caminho / dōka
   - 抒情歌 → cantos líricos
   - 叙景歌 → cantos descritivos da paisagem
   - 感想歌 → cantos de reflexão

4. **Convenções editoriais:**
   - 著者識 → "Pelo autor" (assinatura final)
   - ※ → manter como nota editorial: "Nota:" ou "Observação:" no início
   - 〔　〕 → manter os colchetes (são leituras alternativas entre versões)
   - * = modificação da 1ª ed; ** = re-publicação da 1ª ed (manter como nota se aparecer)

5. **Coletâneas referenciadas:**
   - "和歌" → "waka" (manter em romaji por ser gênero poético específico)
   - "三十一文字" → "trinta e uma sílabas" (estrutura do tanka 5-7-5-7-7)

**Formato da resposta — JSON estrito:**
Você recebe um array de coleções, cada uma com um array de parágrafos JP. Devolva um array com EXATAMENTE a mesma estrutura, na MESMA ordem, com cada parágrafo traduzido:
[
  {
    "key": "shoban",
    "paragraphs": ["tradução do parágrafo 1", "tradução do parágrafo 2", ...]
  }
]`;

// ─── Chamada Gemini ──────────────────────────────────────────
async function callGemini(items) {
  if (DRY_RUN) {
    return items.map((it) => ({
      key: it.key,
      paragraphs: it.paragraphs.map((p, i) => `[piloto §${i}] ${p.slice(0, 40)}...`),
    }));
  }

  const userMessage = JSON.stringify({ collections: items }, null, 2);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0.4,
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
console.log(`\nModelo: ${MODEL}  |  Dry-run: ${DRY_RUN}`);

let results = [];
if (toTranslate.length > 0) {
  console.log(`Enviando ${toTranslate.length} coleções em 1 lote...`);
  const t0 = Date.now();
  results = await callGemini(toTranslate);
  console.log(`Resposta em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} else {
  console.log('Sem coleções pra enviar ao Gemini (todos via fallback).');
}

// Indexar por key
const byKey = Object.fromEntries(results.map((r) => [r.key, r]));

for (const item of toTranslate) {
  const r = byKey[item.key];
  if (!r || !Array.isArray(r.paragraphs)) {
    console.warn(`[${item.key}] sem resultado válido — pular`);
    continue;
  }
  if (r.paragraphs.length !== item.paragraphs.length) {
    console.warn(`[${item.key}] mismatch: enviado ${item.paragraphs.length} parágrafos, recebido ${r.paragraphs.length}`);
  }
  dataByKey[item.key].preface.content_pt = r.paragraphs.map((p) => p.trim()).filter(Boolean);
}

// ─── Backup + write ─────────────────────────────────────────
if (DRY_RUN) {
  console.log('\n[DRY] mudanças NÃO foram gravadas.');
  for (const k of toWrite) {
    console.log(`\n[${k}] preview:`);
    for (const p of dataByKey[k].preface.content_pt.slice(0, 2)) {
      console.log('  • ' + p.slice(0, 100));
    }
  }
} else {
  for (const k of toWrite) {
    const path = FILES[k];
    copyFileSync(path, path + '.pre-preface.bak');
    writeFileSync(path, JSON.stringify(dataByKey[k], null, 2) + '\n', 'utf8');
    const n = dataByKey[k].preface.content_pt.length;
    console.log(`[${k}] ${n} parágrafos PT escritos`);
  }

  console.log('\nAmostra:');
  for (const k of toWrite) {
    console.log(`\n[${k}] título: ${dataByKey[k].preface.title_pt} (JP: ${dataByKey[k].preface.title_jp || '-'})`);
    for (let i = 0; i < dataByKey[k].preface.content_pt.length; i++) {
      console.log('  §' + (i + 1) + ': ' + dataByKey[k].preface.content_pt[i]);
    }
  }
}
