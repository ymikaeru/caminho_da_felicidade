import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['mioshiec1','mioshiec2','mioshiec3','mioshiec4'];
const BASE = '.local-edits/teachings';

const strip = s => (s||'').replace(/<[^>]+>/g,'').replace(/[\s　]+/g,'').trim();
const TERMINAL = /[。．.！？!?」』）)】〉》…―]$/;  // fim "completo"

// tópico seguinte "parece artigo real"? (cabeçalho 明主様… / 御教え / 戯文 / 発行 etc.)
const looksLikeArticle = (raw, title) => {
  const head = (raw||'').slice(0, 120);
  if (/明主様(御教え|御論文|戯文|御垂示|御教示|御文章|御著書)/.test(head)) return true;
  if (/<font size="\+2">/.test(head) && /明主様|御教え|戯文/.test(head)) return true;
  if (/(発行|白光生|寸鉄)/.test(title||'')) return true;
  if (/^<b><font size="\+2">/.test((raw||'').trim())) return true; // header padrão
  return false;
};

let total = 0, alreadyFlagged = 0;
const results = [];

for (const root of ROOTS) {
  const dir = path.join(BASE, root);
  let files;
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
  for (const f of files) {
    const fp = path.join(dir, f);
    let j;
    try { j = JSON.parse(fs.readFileSync(fp,'utf8')); } catch { continue; }
    const themes = j.themes || [];
    for (const th of themes) {
      const topics = th.topics || [];
      for (let i = 1; i < topics.length; i++) {
        const cur = topics[i], prev = topics[i-1];
        if (cur.continues_previous) { alreadyFlagged++; continue; }
        const prevJa = prev.content || '';
        const prevTail = strip(prevJa);
        if (!prevTail) continue;
        // prev termina completo? então cur NÃO é continuação
        const prevComplete = TERMINAL.test(prevTail);
        if (prevComplete) continue;
        // candidato!
        total++;
        const curArticle = looksLikeArticle(cur.content, cur.title);
        results.push({
          file: `${root}/${f}`, i,
          prevTitle: prev.title, curTitle: cur.title,
          prevTail: prevTail.slice(-14),
          curHead: strip(cur.content).slice(0,16),
          conf: curArticle ? 'REVISAR(parece artigo)' : 'ALTA'
        });
      }
    }
  }
}

console.log(`Já marcados (continues_previous): ${alreadyFlagged}`);
console.log(`Candidatos NOVOS encontrados: ${total}\n`);
const high = results.filter(r=>r.conf==='ALTA');
const rev  = results.filter(r=>r.conf!=='ALTA');
console.log(`── ALTA confiança (${high.length}) ──`);
for (const r of high) console.log(`  ${r.file} [${r.i}] "${r.curTitle}"  | prev…"${r.prevTail}" → cur"${r.curHead}…"`);
console.log(`\n── REVISAR / pode ser artigo real (${rev.length}) ──`);
for (const r of rev) console.log(`  ${r.file} [${r.i}] "${r.curTitle}"  | prev…"${r.prevTail}" → cur"${r.curHead}…"`);
