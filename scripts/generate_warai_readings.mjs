/**
 * generate_warai_readings.mjs
 *
 * Lê data/poetry/warai_no_izumi.json e preenche o campo `reading` (romaji Hepburn)
 * de cada verso usando kuroshiro + kuromoji. Mantém entradas que já têm reading.
 *
 * Uso: node scripts/generate_warai_readings.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import KuroshiroPkg from 'kuroshiro';
import KuromojiPkg from 'kuroshiro-analyzer-kuromoji';
const Kuroshiro = KuroshiroPkg.default || KuroshiroPkg;
const KuromojiAnalyzer = KuromojiPkg.default || KuromojiPkg;

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.resolve(__dirname, '../data/poetry/warai_no_izumi.json');

const HAS_JP = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

async function main() {
  console.log('[warai-readings] Carregando dicionário kuromoji…');
  const kuroshiro = new Kuroshiro();
  await kuroshiro.init(new KuromojiAnalyzer());

  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const poems = JSON.parse(raw);
  console.log(`[warai-readings] ${poems.length} versos carregados.`);

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < poems.length; i++) {
    const p = poems[i];
    if (p.reading && p.reading.trim().length > 0) { skipped++; continue; }
    const src = (p.original || '').trim();
    if (!src || !HAS_JP.test(src)) { skipped++; continue; }

    try {
      // Romaniza linha-a-linha preservando quebras; converte espaços japoneses (　) em " / ".
      const lines = src.split(/\r?\n/);
      const out = [];
      for (const line of lines) {
        // Pré-substitui 　 por marcador único pra detectar fronteira de frase
        const marked = line.replace(/[　]/g, ' ◇ ');
        const r = await kuroshiro.convert(marked, {
          mode: 'spaced',
          to: 'romaji',
          romajiSystem: 'hepburn',
        });
        // Normaliza: trim, colapsa espaços, troca marker por " / "
        const normalized = r
          .replace(/\s+/g, ' ')
          .replace(/\s*◇\s*/g, ' / ')
          .trim();
        out.push(normalized);
      }
      p.reading = out.join('\n');
      generated++;
      if (generated % 50 === 0) {
        console.log(`  ${generated}/${poems.length} versos romanizados…`);
      }
    } catch (e) {
      errors++;
      console.warn(`[warai-readings] Falha no № ${p.num || i}: ${e.message}`);
    }
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(poems, null, 2) + '\n', 'utf8');
  console.log(`\n[warai-readings] Concluído.`);
  console.log(`  gerados: ${generated}`);
  console.log(`  pulados: ${skipped}`);
  console.log(`  erros:   ${errors}`);
  console.log(`  arquivo: ${DATA_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
