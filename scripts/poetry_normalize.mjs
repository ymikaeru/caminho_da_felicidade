#!/usr/bin/env node
// ============================================================
// poetry_normalize.mjs — normaliza gosanka_<key>.json para o
// formato que js/poetry-akimaro.js espera (mesmo shape do
// akimaro_kineishu.json).
//
// Operações:
//   1. edition.total_declared → total_in_original, + translated_here
//   2. adiciona edition.author_jp / author_romaji (Okada Mokichi)
//   3. converte sections[].title_furigana (hiragana) em title_romaji
//   4. preserva campos extras (subtitle_jp, year_iso, date_jp,
//      source_jp, count_declared, etc.) — só ADICIONA, não remove
//   5. idempotente: rodar de novo não muda nada
//
// Backup automático antes de gravar.
//
// Uso:
//   node scripts/poetry_normalize.mjs                  # todos
//   node scripts/poetry_normalize.mjs --key=shoban     # só 1
// ============================================================

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const POETRY_DIR = join(ROOT, 'data', 'poetry');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const ONLY_KEY = args.key || null;

// ─── hiragana → romaji (Hepburn modificado) ──────────────────
// Tabela suficiente pros títulos das seções (nomes próprios, kotodama).
const HIRA_BASIC = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'wo', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
};

const HIRA_YOON = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
};

function hiraganaToRomaji(text) {
  if (!text) return '';
  let result = '';
  let i = 0;
  while (i < text.length) {
    // yōon: 2-char (kya, sho, etc.)
    const two = text.slice(i, i + 2);
    if (HIRA_YOON[two]) { result += HIRA_YOON[two]; i += 2; continue; }
    const ch = text[i];
    // っ → próxima consoante dobrada
    if (ch === 'っ') {
      const next = text[i + 1];
      const r = HIRA_BASIC[next] || HIRA_YOON[text.slice(i + 1, i + 3)];
      if (r) result += r[0]; // duplica primeira consoante
      i++;
      continue;
    }
    // ー → alongamento da vogal anterior
    if (ch === 'ー') {
      const lastChar = result[result.length - 1];
      if ('aeiou'.includes(lastChar)) result += lastChar;
      i++;
      continue;
    }
    if (HIRA_BASIC[ch]) { result += HIRA_BASIC[ch]; i++; continue; }
    // espaços ideográficos viram espaço normal
    if (ch === '　' || ch === ' ') { result += ' '; i++; continue; }
    // qualquer outra coisa (incluindo kanji que não devia estar aqui) — passa
    result += ch;
    i++;
  }
  // Capitalize cada palavra: "senju kannon" → "Senju Kannon"
  return result
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── normalize ───────────────────────────────────────────────
function normalizeOne(data) {
  // 1) edition
  const ed = data.edition || {};
  const totalCounted = (data.sections || []).reduce((acc, s) => acc + (s.poems || []).length, 0);
  if (ed.total_declared != null && ed.total_in_original == null) {
    ed.total_in_original = ed.total_declared;
  }
  if (ed.total_in_original == null) ed.total_in_original = totalCounted;
  if (ed.translated_here == null) ed.translated_here = totalCounted;
  if (!ed.author_jp) ed.author_jp = '岡田茂吉';
  if (!ed.author_romaji) ed.author_romaji = 'Okada Mokichi';
  data.edition = ed;

  // 2) sections
  for (const section of data.sections || []) {
    if (section.title_furigana && !section.title_romaji) {
      section.title_romaji = hiraganaToRomaji(section.title_furigana);
    }
    if (section.title_pt == null) section.title_pt = '';
  }

  // 3) preface — se faltar campos pt, deixa stubs (reader degrada bem)
  if (data.preface) {
    if (data.preface.title_pt == null) data.preface.title_pt = 'Prefácio';
    if (data.preface.content_pt == null) data.preface.content_pt = [];
  }

  return data;
}

// ─── execução ────────────────────────────────────────────────
const KEYS = ['shoban', 'kaitei', 'shikiten'];

for (const key of KEYS) {
  if (ONLY_KEY && key !== ONLY_KEY) continue;
  const path = join(POETRY_DIR, `gosanka_${key}.json`);
  if (!existsSync(path)) {
    console.log(`[${key}] não encontrado em ${path} — pular`);
    continue;
  }
  // backup
  const bak = path + '.pre-normalize.bak';
  copyFileSync(path, bak);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const before = JSON.stringify(data);
  const normalized = normalizeOne(data);
  const after = JSON.stringify(normalized);
  if (before === after) {
    console.log(`[${key}] já estava normalizado — nada a fazer`);
    continue;
  }
  writeFileSync(path, JSON.stringify(normalized, null, 2) + '\n', 'utf8');

  // Show sample
  const sec0 = normalized.sections[0];
  console.log(`[${key}] normalizado`);
  console.log(`  edition.total_in_original=${normalized.edition.total_in_original}, translated_here=${normalized.edition.translated_here}`);
  console.log(`  author: ${normalized.edition.author_romaji} (${normalized.edition.author_jp})`);
  console.log(`  seção 0: title_jp="${sec0.title_jp}" title_romaji="${sec0.title_romaji || '-'}"`);
  console.log(`  backup: ${bak}`);
}

console.log('\nDone.');
