// Re-abençoa o registro de hashes dos arquivos que carregam CÓPIAS da lógica
// de normalização do leitor. Rode SOMENTE depois de: (1) revisar se as cópias
// acompanham a mudança e (2) npm run test:render com T4=0.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from '../scripts/_glued_fix_lib.mjs';

const WATCHED = [
    'js/reader-content.js',                              // fonte da verdade
    'js/align-engine.js',                                // SPEAKER_LABELS + _stripHeader/splitRaw verbatim
    'js/reader-render.js',                               // split do modo comparação + header
    'scripts/_glued_fix_lib.mjs',                        // porte verbatim p/ node
    'supabase/functions/_shared/topic_normalize.mjs',    // 5ª cópia (webhook FTS)
];

const files = {};
for (const rel of WATCHED) {
    files[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
}
const out = { _comment: 'Gerado por tests/update_sync_registry.mjs — NÃO editar à mão. Ver tests/sync.test.mjs.', blessedAt: new Date().toISOString(), files };
fs.writeFileSync(path.join(ROOT, 'tests', 'sync.hashes.json'), JSON.stringify(out, null, 2) + '\n');
console.log('Registro re-abençoado:');
for (const [k, v] of Object.entries(files)) console.log(' ', v.slice(0, 12), k);
