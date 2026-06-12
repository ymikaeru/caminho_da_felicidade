// Remove as linhas de user_highlights que falharam no remapeamento do fix
// dos cabeçalhos por colisão de unique — TODAS verificadas (em
// _diag_dup_collisions.mjs) como duplicatas redundantes: existe um gêmeo
// do mesmo usuário, mesmo tópico, mesmo texto, já nos offsets corretos.
// Backup prévio: .local-edits/_backup_glued_fix/<ts>/user_highlights_before.json
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
const ids = process.argv.slice(3);

let deleted = 0, refused = 0;
for (const id of ids) {
  const p = plan.find(x => x.id === id);
  // re-verifica o gêmeo imediatamente antes de apagar
  const { data: rows } = await supa.from('user_highlights')
    .select('id,user_id,volume,file,topic_id,text').eq('id', id);
  const h = rows?.[0];
  if (!h || !p) { refused++; console.log('pulado (linha/plano ausente):', id); continue; }
  const { data: twins } = await supa.from('user_highlights')
    .select('id,text')
    .eq('user_id', h.user_id).eq('volume', h.volume).eq('file', h.file)
    .eq('topic_id', h.topic_id).eq('start_char', p.newStart).eq('end_char', p.newEnd)
    .neq('id', id);
  if (!twins?.length || wsNorm(twins[0].text || '') !== wsNorm(h.text || '')) {
    refused++; console.log('pulado (gêmeo não confirmado):', id); continue;
  }
  const { error } = await supa.from('user_highlights').delete().eq('id', id);
  if (error) { refused++; console.log('erro:', id, error.message); }
  else deleted++;
}
console.log(`\nduplicatas removidas: ${deleted}; puladas: ${refused}`);
