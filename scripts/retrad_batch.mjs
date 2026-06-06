// ============================================================
// retrad_batch.mjs — RETRADUÇÃO EM LOTE dos paredões (gera → valida → STAGING).
//
// NÃO escreve no Storage. Só baixa o vivo (service-role), retraduz via Gemini
// (payload IDÊNTICO à edge function gemini-retrad) e grava staging local com
// old_ptbr + new_ptbr + validação. A publicação é um passo separado, manual.
//
// Fonte da worklist: data/alignment_candidates.json (617 paredões).
// Prompts: extraídos em runtime dos arquivos da aba (zero divergência):
//   - TRANSLATION_GUIDELINES  (js/admin/tabs/translation-review.js)
//   - RETRAD_ADDENDUM         (js/admin/tabs/alignment.js)
//
// Rodar a partir da RAIZ do projeto:
//   node scripts/retrad_batch.mjs --limit=5            # piloto
//   node scripts/retrad_batch.mjs                      # lote completo
//   node scripts/retrad_batch.mjs --concurrency=3 --force
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEnv, makeClient, BUCKET, parseArgs } from './_storage_sync_lib.mjs';

const require = createRequire(import.meta.url);
const E = require('../js/align-engine.js'); // UMD → objeto puro em node

const ROOT = process.cwd();
const STAGING_DIR = path.join(ROOT, 'scripts', 'retrad_staging');
const CANDS_PATH = path.join(ROOT, 'data', 'alignment_candidates.json');

const GEMINI_MODEL = 'gemini-3.1-pro-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ---------------- extração dos prompts (eval do template literal) ----------------
// Avalia o literal real (resolve \\n → \n) p/ ficar idêntico ao que a aba envia.
// Seguro: ambas as constantes não têm ${} nem backtick interno (verificado).
async function extractTemplate(relFile, marker) {
  const txt = await fs.readFile(path.join(ROOT, relFile), 'utf8');
  const i = txt.indexOf(marker);
  if (i < 0) throw new Error(`marcador não encontrado em ${relFile}: ${marker}`);
  const s = txt.indexOf('`', i);
  const e = txt.indexOf('`', s + 1);
  if (s < 0 || e < 0) throw new Error(`template literal não delimitado em ${relFile}`);
  const raw = txt.slice(s, e + 1); // inclui as duas crases
  // eslint-disable-next-line no-eval
  const val = eval(raw);
  if (typeof val !== 'string' || !val.trim()) throw new Error(`template vazio em ${relFile}`);
  return val;
}

// ---------------- Gemini (idêntico à edge gemini-retrad) ----------------
function numberParagraphs(text) {
  const paras = (text || '').split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return { numbered: paras.map((p, i) => `¶${i + 1}\n${p}`).join('\n\n'), count: paras.length };
}

async function callGemini(systemPrompt, contentJp, titleJp) {
  const { numbered } = numberParagraphs(contentJp);
  const userMessage = JSON.stringify({
    items: [{ id: 'article', title_jp: (titleJp || '').trim(), title_pt_atual: '', content_jp_numbered: numbered }],
  }, null, 2);
  const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`Gemini ${res.status}: ${detail.slice(0, 240)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Gemini devolveu JSON inválido: ' + text.slice(0, 200)); }
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!item || !item.content_ptbr_numbered) throw new Error('Resposta inesperada do Gemini: ' + text.slice(0, 200));
  return item.content_ptbr_numbered;
}

async function withRetry(fn, tries = 4) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const retriable = !e.status || e.status === 429 || e.status >= 500;
      if (!retriable || attempt === tries - 1) break;
      const wait = Math.min(30000, 1500 * Math.pow(2, attempt)); // 1.5s,3s,6s…
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ---------------- Storage ----------------
async function downloadJson(supabase, bucketPath) {
  const { data, error } = await supabase.storage.from(BUCKET).download(bucketPath);
  if (error) throw new Error(`download ${bucketPath}: ${error.message}`);
  return JSON.parse(await data.text());
}

// ---------------- validação ----------------
const HAS_JP = /[぀-ヿ㐀-鿿豈-﫿]/; // hiragana/katakana/kanji
function validate(blocks, nJa, ptNew, oldPt) {
  const flags = [];
  if (blocks.length !== nJa) flags.push(`bijecao_${blocks.length}_de_${nJa}`);
  // echo só conta JP FORA de colchetes — o glossário manda anotar a 1ª menção
  // como "Kannon [観音]", "Shakuson [釈尊]" etc. (intencional, não é eco).
  if (HAS_JP.test(ptNew.replace(/\[[^\]]*\]/g, ''))) flags.push('echo_jp');
  if (!ptNew.trim()) flags.push('vazio');
  // sanidade de tamanho: o PT novo não deveria encolher/inchar absurdamente
  const ow = E.wordsOnly(oldPt).length, nw = E.wordsOnly(ptNew).length;
  if (ow > 0) {
    const ratio = nw / ow;
    if (ratio < 0.5 || ratio > 1.8) flags.push(`tamanho_${ratio.toFixed(2)}x`);
  }
  return flags;
}

// ---------------- runner ----------------
function safeName(c) {
  return `${c.vol}__${c.file.replace(/\.html\.json$/, '').replace(/[^\w.-]/g, '_')}__t${c.topic_idx}.json`;
}

// grava _summary.json + _backup_ptbr.json a partir de uma lista de records
async function writeSummary(results) {
  const by = (s) => results.filter((r) => r.status === s).length;
  const summary = {
    generatedAt: new Date().toISOString(), model: GEMINI_MODEL, total: results.length,
    ok: by('ok'), flagged: by('flagged'), skip: by('skip'), error: by('error'),
    flaggedItems: results.filter((r) => r.status === 'flagged').map((r) => ({ key: safeName(r), flags: r.flags })),
    errorItems: results.filter((r) => r.status === 'error').map((r) => ({ key: safeName(r), error: r.error })),
  };
  await fs.writeFile(path.join(STAGING_DIR, '_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  const backup = {};
  for (const r of results) if (r.old_ptbr != null && (r.status === 'ok' || r.status === 'flagged')) backup[`${r.vol}/${r.file}#${r.theme_idx}.${r.topic_idx}`] = r.old_ptbr;
  await fs.writeFile(path.join(STAGING_DIR, '_backup_ptbr.json'), JSON.stringify(backup, null, 2), 'utf8');
  return summary;
}

// recomputa flags/status de todos os staged (sem Gemini) — usar após mexer no validador
async function revalidateStaging() {
  const files = (await fs.readdir(STAGING_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  const results = [];
  for (const f of files) {
    const p = path.join(STAGING_DIR, f);
    const r = JSON.parse(await fs.readFile(p, 'utf8'));
    if (r.new_ptbr && (r.status === 'ok' || r.status === 'flagged')) {
      const blocks = r.new_ptbr.split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
      r.flags = validate(blocks, r.nJa, r.new_ptbr, r.old_ptbr || '');
      r.status = r.flags.length ? 'flagged' : 'ok';
      await fs.writeFile(p, JSON.stringify(r, null, 2), 'utf8');
    }
    results.push(r);
  }
  const s = await writeSummary(results);
  console.log(`[revalidate] ${results.length} staged · ok=${s.ok} flagged=${s.flagged} skip=${s.skip} error=${s.error}`);
  if (s.flagged) console.log('flagged:', JSON.stringify(s.flaggedItems, null, 2));
}

async function main() {
  await loadEnv();
  if (!process.env.GEMINI_API_KEY) { console.error('Falta GEMINI_API_KEY no .env.local'); process.exit(1); }
  const supabase = makeClient();
  const args = parseArgs(process.argv);
  const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
  const offset = args.offset ? parseInt(args.offset, 10) : 0;
  const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 3;
  const force = !!args.force;
  const volFilter = args.vol || null;

  // --revalidate: recomputa flags/status dos staged sem re-chamar o Gemini.
  if (args.revalidate) { await revalidateStaging(); return; }

  const SYSTEM_PROMPT =
    (await extractTemplate('js/admin/tabs/translation-review.js', 'export const TRANSLATION_GUIDELINES =')) +
    (await extractTemplate('js/admin/tabs/alignment.js', 'const RETRAD_ADDENDUM ='));
  console.log(`[prompt] system_prompt: ${SYSTEM_PROMPT.length} chars (TG+ADD extraídos da aba)`);

  await fs.mkdir(STAGING_DIR, { recursive: true });
  const cands0 = JSON.parse(await fs.readFile(CANDS_PATH, 'utf8')).candidates || [];
  let cands = volFilter ? cands0.filter((c) => c.vol === volFilter) : cands0;
  cands = cands.slice(offset, offset + (Number.isFinite(limit) ? limit : cands.length));
  console.log(`[lote] ${cands.length} candidatos (offset=${offset}, limit=${limit}, vol=${volFilter || 'todos'}, conc=${concurrency}, force=${force})`);
  console.log(`[lote] modelo=${GEMINI_MODEL} · saída=scripts/retrad_staging/ · NÃO publica\n`);

  const results = [];
  let i = 0, done = 0;
  const t0 = Date.now();
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= cands.length) return;
      const c = cands[idx];
      const outPath = path.join(STAGING_DIR, safeName(c));
      let rec;
      try {
        if (!force) {
          try { const prev = JSON.parse(await fs.readFile(outPath, 'utf8')); if (prev && prev.status) { rec = { ...prev, _cached: true }; } } catch (_) {}
        }
        if (!rec) {
          const live = await downloadJson(supabase, `${c.vol}/${c.file}`);
          const topic = live?.themes?.[c.theme_idx]?.topics?.[c.topic_idx];
          if (!topic) throw new Error('tópico não encontrado (índice mudou?)');
          const oldPt = topic.content_ptbr || '';
          if (!oldPt.trim()) {
            rec = { ...c, status: 'skip', reason: 'PT vazio' };
          } else {
            const jaBlocks = E.readerSegs(topic.content).map((b) => E.stripTags(b));
            const nJa = jaBlocks.length;
            const numbered = await withRetry(() => callGemini(SYSTEM_PROMPT, jaBlocks.join('\n\n'), E.stripTags(c.title || '')));
            const blocks = numbered.split(/¶\d+/).map((s) => s.trim()).filter(Boolean);
            const ptNew = blocks.join('<br/>');
            const flags = validate(blocks, nJa, ptNew, oldPt);
            rec = {
              vol: c.vol, file: c.file, theme_idx: c.theme_idx, topic_idx: c.topic_idx, title: c.title,
              nJa, ptBlocks: blocks.length, status: flags.length ? 'flagged' : 'ok', flags,
              old_ptbr: oldPt, new_ptbr: ptNew, model: GEMINI_MODEL, generatedAt: new Date().toISOString(),
            };
            await fs.writeFile(outPath, JSON.stringify(rec, null, 2), 'utf8');
          }
        }
      } catch (e) {
        rec = { ...c, status: 'error', error: e.message };
        try { await fs.writeFile(outPath, JSON.stringify(rec, null, 2), 'utf8'); } catch (_) {}
      }
      results.push(rec);
      done++;
      const el = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`\r[${done}/${cands.length}] ${el}s · ${rec.status}${rec.flags?.length ? ' ' + rec.flags.join(',') : ''}`.padEnd(90));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, cands.length) }, worker));
  process.stdout.write('\n');

  // sumário + backup consolidado
  const summary = await writeSummary(results);
  console.log(`\n[fim] ok=${summary.ok} flagged=${summary.flagged} skip=${summary.skip} error=${summary.error}`);
  if (summary.flagged) console.log(`[!] ${summary.flagged} flagged (rever): ver _summary.json → flaggedItems`);
  if (summary.error) console.log(`[x] ${summary.error} erros: ver _summary.json → errorItems`);
  console.log(`[out] ${STAGING_DIR}`);
}

main().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
