import fs from 'node:fs';
const cases = [
  ['mioshiec2/Jk.html.json', 9],
  ['mioshiec3/byouki3.html.json', 7],
  ['mioshiec3/hentai2.html.json', 5],
  ['mioshiec1/kuniIN.html.json', 7],   // duvidoso (参考)
  ['mioshiec2/JN2.html.json', 11],     // duvidoso (体験談)
];
const vis = s => (s||'').replace(/<[^>]+>/g,'');
for (const [rel,i] of cases) {
  const j = JSON.parse(fs.readFileSync('.local-edits/teachings/'+rel,'utf8'));
  const t = j.themes[0].topics;
  const p = t[i-1], c = t[i];
  console.log(`\n████ ${rel} [${i}]`);
  console.log(`  PREV[${i-1}] title: ${JSON.stringify(p.title)} / ${JSON.stringify(p.title_ptbr)}`);
  console.log(`  CUR [${i}]  title: ${JSON.stringify(c.title)} / ${JSON.stringify(c.title_ptbr)}`);
  console.log(`  JA prev-tail: ${JSON.stringify(vis(p.content).slice(-26))}`);
  console.log(`  JA cur-head:  ${JSON.stringify(vis(c.content).slice(0,26))}`);
  console.log(`  PT prev-tail: ${JSON.stringify(vis(p.content_ptbr).slice(-30))}`);
  console.log(`  PT cur-head:  ${JSON.stringify(vis(c.content_ptbr).slice(0,30))}`);
}
