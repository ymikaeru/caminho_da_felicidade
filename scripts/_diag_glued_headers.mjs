// Diagnóstico: cabeçalhos de papel (信者の質問 / 明主様御垂示 e suas traduções)
// colados no fim da linha anterior (sem <br> antes) nos JSONs do mioshiec2.
// Uso: node scripts/_diag_glued_headers.mjs [pasta]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || '.local-edits/teachings/mioshiec2';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

// Um "cabeçalho de papel" = bloco <b>/<font> com color (#0000ff azul, #990000 vermelho).
// Captura as duas ordens de aninhamento: <b><font color..> e <font color..><b>.
const HDR = /(?:<b[^>]*>\s*<font[^>]*color="?#(?:0000ff|990000)"?[^>]*>|<font[^>]*color="?#(?:0000ff|990000)"?[^>]*>\s*<b[^>]*>)/gi;

const colorCounts = {};
let gluedJa = 0, gluedPt = 0, topicsAffected = 0, filesAffected = 0;
const mismatches = [];
const samples = [];

function countGlued(html) {
    if (!html) return 0;
    let n = 0;
    HDR.lastIndex = 0;
    let m;
    while ((m = HDR.exec(html)) !== null) {
        const before = html.slice(0, m.index);
        // precedido (ignorando whitespace) por <br>, ou é o começo do conteúdo?
        const tail = before.replace(/[\s　]+$/, '');
        if (tail === '' || /<br\s*\/?>$/i.test(tail)) continue;
        n++;
    }
    return n;
}

for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    let fileHit = false;
    const topics = (j.themes || []).flatMap(t => t.topics || []);
    for (let i = 0; i < topics.length; i++) {
        const t = topics[i];
        for (const c of (t.content || '').matchAll(/<font[^>]*color="?(#?[\w]+)"?/gi)) {
            const k = c[1].toLowerCase();
            colorCounts[k] = (colorCounts[k] || 0) + 1;
        }
        const gJa = countGlued(t.content || '');
        const gPt = countGlued(t.content_ptbr || t.content_pt || '');
        if (gJa || gPt) { topicsAffected++; fileHit = true; }
        gluedJa += gJa; gluedPt += gPt;
        if (gJa !== gPt) mismatches.push(`${f} topic#${i} ja=${gJa} pt=${gPt}`);
        if (gJa && samples.length < 3) {
            HDR.lastIndex = 0;
            const m = HDR.exec(t.content);
            samples.push(`${f}#${i}: …${t.content.slice(Math.max(0, m.index - 60), m.index + 60)}…`);
        }
    }
    if (fileHit) filesAffected++;
}

console.log('files scanned:', files.length);
console.log('files affected:', filesAffected);
console.log('topics affected:', topicsAffected);
console.log('glued headers JA:', gluedJa, '| PT:', gluedPt);
console.log('ja/pt count mismatches:', mismatches.length);
mismatches.slice(0, 20).forEach(s => console.log('  MISMATCH', s));
console.log('\nfont colors seen:', JSON.stringify(colorCounts));
console.log('\nsamples:');
samples.forEach(s => console.log(' ', s.replace(/\n/g, '\\n')));
