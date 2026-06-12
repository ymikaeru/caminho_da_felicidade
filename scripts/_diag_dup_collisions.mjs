// READ-ONLY: investiga os updates de user_highlights que falharam por
// violação da unique (user,vol,file,topic,start,end) no fix dos cabeçalhos.
// Hipótese: o destino já tem um "gêmeo" (mesma marcação, linha duplicada
// de eras diferentes do DOM). Confirma gêmeo + compara textos.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, wsNorm } from './_glued_fix_lib.mjs';

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const backupDir = process.argv[2];
const { plan } = JSON.parse(fs.readFileSync(path.join(backupDir, 'plan.json'), 'utf8'));
const failedIds = process.argv.slice(3);

let twinOk = 0, twinDiffText = 0, noTwin = 0;
for (const id of failedIds) {
  const p = plan.find(x => x.id === id);
  if (!p) { console.log('plano não achado p/', id); continue; }
  const { data: rows } = await supa.from('user_highlights')
    .select('id,user_id,volume,file,topic_id,start_char,end_char,text').eq('id', id);
  const h = rows?.[0];
  if (!h) { console.log('linha sumiu:', id); continue; }
  const { data: twins } = await supa.from('user_highlights')
    .select('id,text')
    .eq('user_id', h.user_id).eq('volume', h.volume).eq('file', h.file)
    .eq('topic_id', h.topic_id).eq('start_char', p.newStart).eq('end_char', p.newEnd)
    .neq('id', id);
  if (!twins?.length) { noTwin++; console.log('SEM GÊMEO:', id, h.volume, h.file, h.topic_id, `[${p.newStart},${p.newEnd}]`); continue; }
  const same = wsNorm(twins[0].text || '') === wsNorm(h.text || '');
  if (same) twinOk++; else { twinDiffText++; console.log('GÊMEO COM TEXTO DIFERENTE:', id, '→', twins[0].id, JSON.stringify((h.text||'').slice(0,40)), 'vs', JSON.stringify((twins[0].text||'').slice(0,40))); }
}
console.log(`\ngêmeo idêntico (linha redundante): ${twinOk}`);
console.log(`gêmeo com texto diferente: ${twinDiffText}`);
console.log(`sem gêmeo: ${noTwin}`);
