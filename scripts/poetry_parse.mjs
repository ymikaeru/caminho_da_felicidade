#!/usr/bin/env node
// ============================================================
// poetry_parse.mjs — parse dos 3 markdowns em "Poemas markdown/"
// e geração de JSONs esqueleto em data/poetry/.
//
// Não chama API alguma — só extrai estrutura (seções, poemas,
// original em kanji, reading_hira em hiragana, marcadores * / **).
// Os campos de tradução ficam vazios e prontos pro próximo passo
// (poetry_translate_gemini.mjs).
//
// Uso:
//   node scripts/poetry_parse.mjs                 # todos os 3
//   node scripts/poetry_parse.mjs --only=shoban   # só 1
//   node scripts/poetry_parse.mjs --out=.../dir   # diretório alternativo
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const MD_DIR = join(ROOT, 'Poemas markdown');
const OUT_DIR_DEFAULT = join(ROOT, 'data', 'poetry');

const FILES = [
  {
    key: 'shikiten',
    file: '各式典における御讃歌.md',
    out: 'gosanka_shikiten_skeleton.json',
    type: 'ceremonies', // seções = cerimônias com data
    edition: {
      title_jp: '各式典における御讃歌',
      title_pt: 'Cantos Sagrados para Cada Cerimônia',
      author_jp: '岡田茂吉',
      author_romaji: 'Okada Mokichi',
      pen_name_jp: '岡田自観',
      pen_name_romaji: 'Okada Jikan',
    },
  },
  {
    key: 'shoban',
    file: '御讃歌集（初版）.md',
    out: 'gosanka_shoban_skeleton.json',
    type: 'thematic', // seções = temas
    edition: {
      title_jp: '御讃歌集（初版）',
      title_pt: 'Coletânea de Cantos Sagrados (Primeira Edição)',
      publication_date_jp: '昭和23年7月1日',
      publication_date_pt: '1 de julho de 1948',
      total_declared: 309,
    },
  },
  {
    key: 'kaitei',
    file: '御讃歌集（改訂版）.md',
    out: 'gosanka_kaitei_skeleton.json',
    type: 'thematic',
    edition: {
      title_jp: '御讃歌集（改訂版）',
      title_pt: 'Coletânea de Cantos Sagrados (Edição Revisada)',
      publication_date_jp: '昭和26年5月28日 / 昭和29年10月25日',
      publication_date_pt: '28 de maio de 1951 / 25 de outubro de 1954',
      total_declared: 462,
    },
  },
];

// ─── helpers ────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const onlyKey = args.only || null;
const OUT_DIR = args.out ? resolve(args.out) : OUT_DIR_DEFAULT;

// Linha contém só dígitos ASCII e quebra de linha? (caso poema 29 do kaitei)
function isStandaloneNumber(line) {
  return /^\d+$/.test(line.trim());
}

// Detecta linha que começa com "[número]\t" — typical poem-start line.
function startsWithNumberedTab(line) {
  return /^\d+\t/.test(line);
}

// Linha de marcador de ano (昭和11年, 昭和２３年 etc.) — não dentro de poema.
function isYearMarker(line) {
  const trimmed = line.trim();
  return /^昭和[０-９0-9一二三四五六七八九十]+年$/.test(trimmed);
}

// Section header line. Para shoban/kaitei vem como `　\t　　[name]\t　`.
// Para shikiten vem `　\t　　[ceremony+date+source]\t　`.
// Ambos compartilham o padrão: começa com "　\t" (espaço ideográfico + tab),
// e a coluna do meio (após segundo tab é "　") tem conteúdo > algumas chars.
function isSectionHeader(line) {
  if (!line.includes('\t')) return false;
  const cols = line.split('\t');
  if (cols.length < 2) return false;
  // primeiro col = "　" (espaço ideográfico); segundo col tem conteúdo real.
  if (cols[0] !== '　') return false;
  const middle = cols[1] || '';
  if (!middle.trim()) return false;
  // Excluir linhas de poema-kanji que começam com "　" mas tem kanji no início:
  // poema kanji começa com kanji direto, ex: "花笑ひ　百鳥歌ひ..." — não tem "　\t" prefix
  return true;
}

// Heurística: header de seção temática (shoban/kaitei) tem furigana entre () ou （）
// e às vezes "X首" no fim. Cerimônia (shikiten) tem data como 昭和11年 5月15日.
function parseSectionTitle(headerLine, type) {
  // cols: ["　", "　　千 手 観 音（せんじゅかんのん）", "　"]
  const cols = headerLine.split('\t');
  let middle = (cols[1] || '').trim();
  // Remove leading ideographic spaces.
  middle = middle.replace(/^[\s　]+/, '').trim();

  if (type === 'thematic') {
    // Try to capture: "千 手 観 音（せんじゅかんのん）　１０首"
    const countMatch = middle.match(/[　\s]+([０-９0-9]+)首\s*$/);
    let count_declared = null;
    if (countMatch) {
      const digits = countMatch[1].replace(/[０-９]/g, (d) => String('０１２３４５６７８９'.indexOf(d)));
      count_declared = parseInt(digits, 10);
      middle = middle.slice(0, countMatch.index).trim();
    }
    // Title + furigana.
    const furiMatch = middle.match(/^(.+?)[（(]([^）)]+)[）)]\s*$/);
    if (furiMatch) {
      return {
        title_jp: furiMatch[1].replace(/[　\s]+/g, ''),
        title_furigana: furiMatch[2].trim(),
        count_declared,
      };
    }
    return {
      title_jp: middle.replace(/[　\s]+/g, ' ').trim(),
      title_furigana: null,
      count_declared,
    };
  }

  // Ceremony header (shikiten): exs:
  //   "春の大御祭 　　　　　昭和11年 5月15日　　岡田茂吉全集"
  //   "万照殿仮地鎮祭 　三恵四恩　　昭和11年 6月23日　　岡田茂吉全集"
  //   "新年の御歌　　　　　昭和２３年１月１日　　御光話録（補）"
  //   "立春御歌　　　昭和２５年２月４日　　　岡田茂吉全集より"
  const segments = middle.split(/[　\s]{2,}/).map((s) => s.trim()).filter(Boolean);
  const ceremony = segments[0] || middle;
  const dateIdx = segments.findIndex((s) => /昭和/.test(s));
  const date_jp = dateIdx >= 0 ? segments[dateIdx] : null;
  // Source = último segmento DEPOIS da data (sempre vem por último no padrão original).
  const source = dateIdx >= 0 && dateIdx < segments.length - 1
    ? segments[segments.length - 1]
    : null;
  // Subtitle = qualquer segmento entre a cerimônia (índice 0) e a data.
  const subtitleSegs = dateIdx > 1 ? segments.slice(1, dateIdx) : [];
  const subtitle_jp = subtitleSegs.length ? subtitleSegs.join('　') : null;
  return {
    title_jp: ceremony,
    title_furigana: null,
    subtitle_jp,
    date_jp,
    source_jp: source,
    count_declared: null,
  };
}

// Detecta marcador de ano (yyyy) — armazenar para contexto histórico.
// "昭和１１年" → 1936; "昭和六年" → 1931; etc.
function parseYear(yearLine) {
  const trimmed = yearLine.trim();
  // Converte dígitos full-width pra ascii.
  let s = trimmed.replace(/[０-９]/g, (d) => String('０１２３４５６７８９'.indexOf(d)));
  // Converte kanji numerals básicos:
  const kanjiNum = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  s = s.replace(/[一二三四五六七八九]+十?[一二三四五六七八九]?|十[一二三四五六七八九]?/g, (m) => {
    // very rough; handles 11=十一, 21=二十一 etc.
    let n = 0;
    let cur = 0;
    for (const ch of m) {
      const v = kanjiNum[ch];
      if (v === 10) cur = (cur || 1) * 10;
      else cur += v;
    }
    n = cur;
    return String(n);
  });
  const match = s.match(/昭和(\d+)年/);
  if (!match) return { era_jp: trimmed, year_iso: null };
  const showaYear = parseInt(match[1], 10);
  const yearIso = 1925 + showaYear; // Showa começou em dez/1926; ano 1=1926; ajuste +1925 funciona pra ano marker (mes desconhecido).
  return { era_jp: trimmed, year_iso: yearIso };
}

// Normaliza dígitos full-width pra ASCII num número de poema (já sai assim, mas garantir).
function asciiDigits(s) {
  return s.replace(/[０-９]/g, (d) => String('０１２３４５６７８９'.indexOf(d)));
}

// ─── parser principal ─────────────────────────────────────────
function parseFile(spec) {
  const path = join(MD_DIR, spec.file);
  if (!existsSync(path)) {
    throw new Error(`Arquivo não encontrado: ${path}`);
  }
  const raw = readFileSync(path, 'utf8');
  // Remove BOM se houver.
  const text = raw.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);

  const out = {
    source_file: spec.file,
    edition: { ...spec.edition },
    preface: null,
    sections: [],
  };

  let currentSection = null;
  let currentYear = null;
  let prefaceLines = [];
  let inPreface = false;
  let prefaceDone = false;
  let i = 0;

  // 1) Skip cabeçalhos triviais até encontrar a primeira seção real.
  //    Coletamos qualquer texto antes da 1ª seção como preface.
  while (i < lines.length) {
    const line = lines[i];

    // 1a) marcador de ano (só no shikiten) — guardar.
    if (isYearMarker(line)) {
      currentYear = parseYear(line);
      i++;
      continue;
    }

    // 1b) cabeçalho de seção.
    if (isSectionHeader(line)) {
      if (!prefaceDone && prefaceLines.length) {
        out.preface = {
          title_jp: spec.type === 'ceremonies' ? null : (prefaceLines.find((l) => /[序はし]/.test(l) && l.length < 10) || null),
          content_jp: prefaceLines.filter((l) => l.trim().length > 0),
          content_pt: [],
        };
      }
      prefaceDone = true;

      // Fechar seção anterior.
      if (currentSection) out.sections.push(currentSection);

      const parsed = parseSectionTitle(line, spec.type);
      currentSection = {
        ...parsed,
        title_pt: '',
        year_jp: currentYear ? currentYear.era_jp : null,
        year_iso: currentYear ? currentYear.year_iso : null,
        notes_jp: [],
        poems: [],
      };
      i++;
      continue;
    }

    // 1c) linha em branco ou separador "　\t　\t　"
    if (!line.trim() || /^[　\s\t]+$/.test(line)) {
      i++;
      continue;
    }

    // 1d) poema — linha que começa com número+tab OU número solo.
    if (startsWithNumberedTab(line) || isStandaloneNumber(line)) {
      // Se ainda não temos seção (ex: shikiten — primeiro poema sob "春の大御祭"),
      // já entramos numa seção mais cedo. Mas defensivamente:
      if (!currentSection) {
        currentSection = {
          title_jp: '(sem seção)',
          title_furigana: null,
          title_pt: '',
          year_jp: currentYear?.era_jp || null,
          year_iso: currentYear?.year_iso || null,
          notes_jp: [],
          poems: [],
        };
      }

      // Caso normal: "1\thiragana"
      let number = null;
      let hiragana = null;

      if (startsWithNumberedTab(line)) {
        const tabIdx = line.indexOf('\t');
        number = parseInt(asciiDigits(line.slice(0, tabIdx)), 10);
        hiragana = line.slice(tabIdx + 1).trim();
      } else if (isStandaloneNumber(line)) {
        number = parseInt(asciiDigits(line.trim()), 10);
        // pular linhas em branco até achar hiragana
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length) {
          hiragana = lines[j].trim();
          i = j; // posicionar i no lugar do hiragana pra que i++ vá pro kanji
        }
      }

      // próxima linha não-vazia = kanji + (opcional) marker.
      let k = i + 1;
      while (k < lines.length && !lines[k].trim()) k++;
      let kanji = null;
      let marker = null;
      if (k < lines.length) {
        const kline = lines[k];
        const tabIdx2 = kline.indexOf('\t');
        if (tabIdx2 >= 0) {
          kanji = kline.slice(0, tabIdx2).trim();
          const after = kline.slice(tabIdx2 + 1).trim();
          if (after === '*' || after === '**') marker = after;
        } else {
          kanji = kline.trim();
        }
        i = k + 1;
      } else {
        i++;
      }

      currentSection.poems.push({
        number,
        original: kanji,
        reading_hira: hiragana,
        marker,
        translation_pending: true,
      });
      continue;
    }

    // 1e) Antes da 1ª seção: provavelmente preface ou metadado de capa.
    if (!prefaceDone) {
      // ignora linhas só com símbolos ―
      if (!/^[―\s　]+$/.test(line.trim())) {
        prefaceLines.push(line.trim());
      }
      i++;
      continue;
    }

    // 1f) Linha decorativa/nota dentro de uma seção.
    if (currentSection) {
      const trimmed = line.trim();
      if (trimmed && !/^[　\t]+$/.test(trimmed) && !/^[―]+$/.test(trimmed)) {
        currentSection.notes_jp.push(trimmed);
      }
    }
    i++;
  }

  if (currentSection) out.sections.push(currentSection);

  return out;
}

// ─── execução ─────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });

const totalPoemsByKey = {};

for (const spec of FILES) {
  if (onlyKey && spec.key !== onlyKey) continue;

  const parsed = parseFile(spec);
  const outPath = join(OUT_DIR, spec.out);
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');

  const poemCount = parsed.sections.reduce((acc, s) => acc + s.poems.length, 0);
  totalPoemsByKey[spec.key] = poemCount;

  console.log(`[${spec.key}] ${spec.file}`);
  console.log(`  → ${outPath}`);
  console.log(`  seções: ${parsed.sections.length}`);
  console.log(`  poemas: ${poemCount}`);
  if (spec.edition.total_declared) {
    const match = poemCount === spec.edition.total_declared ? '✓' : '✗ DIFERENTE';
    console.log(`  declarado: ${spec.edition.total_declared}  ${match}`);
  }
  // Mostrar amostra dos primeiros 3 poemas.
  const firstSection = parsed.sections[0];
  if (firstSection?.poems?.length) {
    console.log(`  amostra (primeira seção "${firstSection.title_jp}"):`);
    for (const p of firstSection.poems.slice(0, 2)) {
      console.log(`    ${p.number}: ${(p.original || '').slice(0, 30)}  /  ${(p.reading_hira || '').slice(0, 30)}`);
    }
  }
  console.log('');
}

console.log('Resumo:');
for (const [k, n] of Object.entries(totalPoemsByKey)) {
  console.log(`  ${k}: ${n} poemas`);
}
