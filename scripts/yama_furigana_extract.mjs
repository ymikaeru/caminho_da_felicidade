/**
 * yama_furigana_extract.mjs
 * Extrai ふりがな (leitura em hiragana) e as datas por seção de
 * Yama-to-Mizu a partir do HTML da fonte rattail.org (tmp_yamato_source.html)
 * e popula data/poetry/yama_to_mizu.json:
 *   - cada poema  → reading_hira
 *   - cada seção  → date_jp / year_iso (data de composição)
 *   - originais "kana-heavy" → kanji limpo do rattail (escolha do usuário)
 *
 * IMPORTANTE: casa por CONTEÚDO (alinhamento de sequência), não por número.
 * Os `number` do JSON derivaram da numeração do rattail (ex.: JSON nº1220
 * contém o poema 濠端 = nº1221 do rattail), então casar por número erra.
 *
 * Fonte (baixar antes de rodar — não versionada, ~664 KB):
 *   (New-Object System.Net.WebClient).DownloadFile(
 *     'https://www.rattail.org/gosanka/yamato.html', 'tmp_yamato_source.html')
 *
 * Uso:
 *   node scripts/yama_furigana_extract.mjs           (dry-run: só relatório)
 *   node scripts/yama_furigana_extract.mjs --write    (grava o JSON)
 *
 * Estrutura do HTML fonte (FrontPage, UTF-8), uma <tr> por elemento:
 *   título:   <font ... size="4"><strong>　　六月の空</strong></font>
 *   poema:    <td>...<font color="#800000" ...>1220</font></td>
 *             <td><font color="#008040" size="1">FURIGANA<br></font>
 *                 <font size="3">KANJI</font></td>
 *   data:     <p align="right"><font size="1">　…（昭和十年七月十八日）</font></p>
 */
import fs from 'fs';

const WRITE = process.argv.includes('--write');
const HTML_PATH = 'tmp_yamato_source.html';
const JSON_PATH = 'data/poetry/yama_to_mizu.json';
const SIM_GATE = 0.30; // similaridade mínima p/ confiar no par (escrever hira/data)

const html = fs.readFileSync(HTML_PATH, 'utf8');
const json = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

// strip todos os espaços (incl. 　) p/ comparação de igualdade
const norm = (s) => (s || '').replace(/[\s　]+/g, '');
const stripTags = (s) => (s || '').replace(/<[^>]*>/g, ''); // FrontPage abre/fecha <font> no meio
const decode = (s) =>
  (s || '')
    .replace(/&nbsp;/g, '　')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
const tidy = (s) => decode(stripTags(s)).replace(/[　\s]+$/g, '').replace(/^[　\s]+/g, '').trim();

// converte 昭和N年M月D日 → ano gregoriano (Showa 1 = 1926)
const KANJI_NUM = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function kanjiToInt(s) {
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let total = 0;
  if (s.includes('十')) {
    const [a, b] = s.split('十');
    const tens = a === '' ? 1 : (KANJI_NUM[a] ?? 0);
    const ones = b === '' ? 0 : (KANJI_NUM[b] ?? 0);
    total = tens * 10 + ones;
  } else {
    total = KANJI_NUM[s] ?? 0;
  }
  return total;
}
function showaToYear(dateStr) {
  const m = dateStr.match(/昭和([〇一二三四五六七八九十\d]+)年/);
  if (!m) return null;
  const y = kanjiToInt(m[1]);
  return y ? 1925 + y : null; // 昭和1 = 1926
}

// ── Parse: percorre as <tr> em ordem ───────────────────────────
const rows = html.split(/<tr[^>]*>/i).slice(1).map((r) => r.split(/<\/tr>/i)[0]);

const sections = []; // {title, poems:[{num,hira,kanji,date}]}
let cur = null;
const stats = { sectionTitles: 0, poems: 0, dates: 0, poemsNoHira: 0, poemsNoDate: 0 };
let pending = []; // poemas desde a última data (a data segue o grupo)

for (const row of rows) {
  const titleM = row.match(/size="4"[^>]*>\s*<strong>([\s\S]*?)<\/strong>/i);
  const numM = row.match(/color="#800000"[^>]*>\s*(\d+)\s*<\/font>/i);
  // data: varre a LINHA inteira por （昭和…日） — o td vazio do número
  // também tem align="right", então não dá pra ancorar nele.
  const dateM = row.match(/[（(]\s*(昭和[^（）()]*?日|[〇一二三四五六七八九十]+年[^（）()]*?日)\s*[）)]/);

  if (titleM && !numM) {
    const t = tidy(titleM[1]).replace(/[　\s]+/g, ' ');
    cur = { title: t, poems: [] };
    sections.push(cur);
    stats.sectionTitles++;
    continue;
  }
  if (numM) {
    const num = parseInt(numM[1], 10);
    const hiraM = row.match(/color="#008040"[^>]*>([\s\S]*?)<br\s*\/?>/i);
    const kanjiM = row.match(/<font size="3"[^>]*>([\s\S]*?)<\/font>/i);
    const hira = hiraM ? tidy(hiraM[1]) : '';
    const kanji = kanjiM ? tidy(kanjiM[1]) : '';
    if (!cur) { cur = { title: '(sem título)', poems: [] }; sections.push(cur); }
    const p = { num, hira, kanji, date: null };
    cur.poems.push(p);
    pending.push(p);
    stats.poems++;
    if (!hira) stats.poemsNoHira++;
    continue;
  }
  if (dateM) {
    const d = tidy(dateM[1]);
    for (const p of pending) p.date = d; // a data se aplica aos poemas que a precedem
    pending = [];
    stats.dates++;
    continue;
  }
}
for (const s of sections) for (const p of s.poems) if (!p.date) stats.poemsNoDate++;

// ── Similaridade textual (LCS-Dice) ────────────────────────────
function lcs(a, b) {
  const m = b.length;
  if (!a.length || !m) return 0;
  let prev = new Uint16Array(m + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint16Array(m + 1);
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      cur[j] = ai === b[j - 1] ? prev[j - 1] + 1 : (prev[j] >= cur[j - 1] ? prev[j] : cur[j - 1]);
    }
    prev = cur;
  }
  return prev[m];
}
const simStr = (a, b) => {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  return (2 * lcs(na, nb)) / (na.length + nb.length);
};
// original do JSON varia de kana-pesado a kanji-rico → testa contra os dois
const simBest = (jp, rp) => Math.max(simStr(jp.original, rp.kanji), simStr(jp.original, rp.hira));

// ── Alinhamento Needleman–Wunsch em banda ──────────────────────
const ratList = sections.flatMap((s) => s.poems);
const jsonList = json.sections.flatMap((s) => s.poems);
const N = jsonList.length, M = ratList.length, BAND = 10, GAP = -0.3, NEG = -1e9;
const dp = Array.from({ length: N + 1 }, () => new Float64Array(M + 1).fill(NEG));
const bt = Array.from({ length: N + 1 }, () => new Int8Array(M + 1)); // 0 diag, 1 skip-json, 2 skip-rat
dp[0][0] = 0;
for (let i = 0; i <= N; i++) {
  const lo = Math.max(0, i - BAND), hi = Math.min(M, i + BAND);
  for (let j = lo; j <= hi; j++) {
    if (i === 0 && j === 0) continue;
    let best = NEG, dir = 1;
    if (i > 0 && j > 0 && dp[i - 1][j - 1] > NEG) {
      const sc = dp[i - 1][j - 1] + simBest(jsonList[i - 1], ratList[j - 1]);
      if (sc > best) { best = sc; dir = 0; }
    }
    if (i > 0 && dp[i - 1][j] > NEG) {
      const sc = dp[i - 1][j] + GAP;
      if (sc > best) { best = sc; dir = 1; }
    }
    if (j > 0 && dp[i][j - 1] > NEG) {
      const sc = dp[i][j - 1] + GAP;
      if (sc > best) { best = sc; dir = 2; }
    }
    dp[i][j] = best; bt[i][j] = dir;
  }
}
// backtrack
const pairOf = new Map(); // jsonPoem -> {rp, sim}
const jsonUnpaired = [], ratUnpaired = [];
{
  let i = N, j = M;
  while (i > 0 || j > 0) {
    const dir = (i > 0 && j > 0) ? bt[i][j] : (i > 0 ? 1 : 2);
    if (dir === 0) {
      const jp = jsonList[i - 1], rp = ratList[j - 1];
      pairOf.set(jp, { rp, sim: simBest(jp, rp) });
      i--; j--;
    } else if (dir === 1) {
      jsonUnpaired.push(jsonList[i - 1]); i--;
    } else {
      ratUnpaired.push(ratList[j - 1]); j--;
    }
  }
}

// ── kanji ratio (p/ detectar originais kana-heavy) ─────────────
const isKanji = (c) => c >= '一' && c <= '鿿';
const kanjiRatio = (s) => {
  const chars = [...(s || '').replace(/[\s　]/g, '')];
  return chars.length ? chars.filter(isKanji).length / chars.length : 0;
};

// ── Diagnóstico ────────────────────────────────────────────────
const pairs = [...pairOf.entries()].map(([jp, v]) => ({ jp, rp: v.rp, sim: v.sim }));
const lowSim = pairs.filter((p) => p.sim < SIM_GATE).sort((a, b) => a.sim - b.sim);
const offsets = {};
pairs.forEach((p) => { const o = p.rp.num - p.jp.number; offsets[o] = (offsets[o] || 0) + 1; });
const dirtyHira = pairs.filter((p) => /[一-鿿]/.test(p.rp.hira || '') || /[A-Za-z]/.test(p.rp.hira || '') || /[<>]/.test(p.rp.hira || ''));
const kanaHeavy = pairs.filter((p) => kanjiRatio(p.jp.original) < 0.15 && p.sim >= SIM_GATE);
const kanaHeavyFix = kanaHeavy.filter((p) => kanjiRatio(p.rp.kanji) > kanjiRatio(p.jp.original));

console.log('=== RATTAIL ===');
console.log('events:', stats, '| ratList:', M);
console.log('=== JSON ===  poems:', N, '| sections:', json.sections.length);
console.log('\n=== ALINHAMENTO (por conteúdo) ===');
console.log('pares:', pairs.length, '| JSON sem par:', jsonUnpaired.length, '| rattail sem par:', ratUnpaired.length);
console.log('pares com sim < gate(' + SIM_GATE + '):', lowSim.length);
console.log('distribuição de offset (ratNum - jsonNumber):', JSON.stringify(offsets));
const weird = pairs.filter((p) => { const o = p.rp.num - p.jp.number; return o !== 0 && o !== 1; });
console.log('offset estranho (|o|>1):', JSON.stringify(weird.map((p) => ({ jn: p.jp.number, rn: p.rp.num, sim: +p.sim.toFixed(2), json: p.jp.original.slice(0, 26), ratK: p.rp.kanji.slice(0, 26), ratH: p.rp.hira.slice(0, 26) })), null, 1));
const empties = pairs.filter((p) => !norm(p.jp.original) || !norm(p.rp.hira));
console.log('pares com lado vazio:', JSON.stringify(empties.map((p) => ({ jn: p.jp.number, rn: p.rp.num, sim: +p.sim.toFixed(2), jsonO: p.jp.original, ratK: p.rp.kanji, ratH: p.rp.hira })), null, 1));
console.log('JSON sem par (amostra):', JSON.stringify(jsonUnpaired.slice(0, 5).map((p) => ({ n: p.number, o: p.original.slice(0, 20) }))));
console.log('rattail sem par (amostra):', JSON.stringify(ratUnpaired.slice(0, 5).map((p) => ({ n: p.num, k: p.kanji.slice(0, 20) }))));
if (lowSim.length) console.log('lowSim (amostra):', JSON.stringify(lowSim.slice(0, 6).map((p) => ({ sim: +p.sim.toFixed(2), json: p.jp.original.slice(0, 22), ratK: p.rp.kanji.slice(0, 22) })), null, 1));

console.log('\n=== AUDITORIA ===');
console.log('reading_hira c/ kanji/latin/<> (deve ser 0):', dirtyHira.length);
if (dirtyHira.length) console.log('  amostra suja:', JSON.stringify(dirtyHira.slice(0, 8).map((p) => ({ n: p.jp.number, h: p.rp.hira }))));
console.log('originais kana-heavy (a corrigir):', kanaHeavyFix.length, '/ kana-heavy total:', kanaHeavy.length);

// verificação dirigida: o poema que disparou o bug — JSON nº1220 deve casar
// com o 濠端 (青柳) do rattail nº1221, e receber a hira ほりばたの…, NÃO でぱーとの…
const p1220 = jsonList.find((p) => p.number === 1220);
if (p1220) {
  const v = pairOf.get(p1220);
  console.log('\n=== VERIFICAÇÃO JSON nº1220 (gatilho do bug) ===');
  console.log('json original:', p1220.original);
  console.log('par rattail nº', v?.rp.num, '| kanji:', v?.rp.kanji);
  console.log('reading_hira que receberá:', v?.rp.hira, '| sim:', v ? +v.sim.toFixed(2) : null);
}
// amostra geral
console.log('\namostra de pares (5):', JSON.stringify(pairs.slice(0, 5).map((p) => ({ jn: p.jp.number, rn: p.rp.num, sim: +p.sim.toFixed(2), hira: p.rp.hira.slice(0, 16) })), null, 0));

// datas por seção
let secWithDate = 0, secMixed = 0;
const perSection = json.sections.map((js) => {
  const ds = js.poems.map((p) => { const v = pairOf.get(p); return v && v.sim >= SIM_GATE ? v.rp.date : null; }).filter(Boolean);
  const freq = {}; ds.forEach((d) => (freq[d] = (freq[d] || 0) + 1));
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  if (sorted.length) secWithDate++;
  if (sorted.length > 1) secMixed++;
  return { t: js.title_jp, d: sorted.length ? sorted[0][0] : null, k: sorted.length };
});
console.log('\n=== DATAS ===');
console.log('date-rows rattail:', stats.dates, '| seções JSON c/ data:', secWithDate, '/', json.sections.length, '| mistas:', secMixed);
console.log('amostra:', JSON.stringify(perSection.slice(0, 6)));

// ── Gravação ───────────────────────────────────────────────────
if (WRITE) {
  let hiraWritten = 0, datesWritten = 0, origFixed = 0, filledEmpty = 0;
  for (const js of json.sections) {
    const sectionDates = [];
    for (const jp of js.poems) {
      const v = pairOf.get(jp);
      if (!v) continue;
      const wasEmpty = !norm(jp.original);
      // confia no par se similaridade ok OU se o original está vazio (poema
      // quebrado, alinhado posicionalmente — rattail pode repará-lo)
      if (v.sim < SIM_GATE && !wasEmpty) continue;
      if (v.rp.hira) { jp.reading_hira = v.rp.hira; hiraWritten++; }
      if (wasEmpty && v.rp.kanji) {
        jp.original = v.rp.kanji; filledEmpty++;
      } else if (v.rp.kanji && kanjiRatio(jp.original) < 0.15 && kanjiRatio(v.rp.kanji) > kanjiRatio(jp.original)) {
        jp.original = v.rp.kanji; origFixed++;
      }
      if (v.rp.date) sectionDates.push(v.rp.date);
    }
    if (sectionDates.length) {
      const freq = {}; sectionDates.forEach((d) => (freq[d] = (freq[d] || 0) + 1));
      const dominant = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
      js.date_jp = dominant;
      const yr = showaToYear(dominant);
      if (yr) js.year_iso = yr;
      datesWritten++;
    }
  }
  fs.writeFileSync(JSON_PATH, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`\n=== WROTE ===\nreading_hira: ${hiraWritten} | seções c/ data: ${datesWritten} | kana-heavy corrigidos: ${origFixed} | originais vazios preenchidos: ${filledEmpty}`);
} else {
  console.log('\n(dry-run — use --write para gravar)');
}
