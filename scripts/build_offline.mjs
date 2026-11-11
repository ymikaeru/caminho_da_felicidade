#!/usr/bin/env node
// ============================================================
// build_offline — monta o PACOTE OFFLINE do Caminho da Felicidade.
//
// Gera uma pasta autossuficiente (padrão: dist-offline/) que roda em
// qualquer máquina só com Python:  INICIAR.bat  →  python servidor.py
// Sem Docker, sem banco, sem internet.
//
// O site online NÃO é alterado: o pacote é uma cópia em que
//   • js/supabase-config.js  vira o cliente offline (offline/offline-client.js)
//   • o importmap do @supabase/supabase-js aponta pro mesmo cliente
//   • os ensinamentos (bucket `teachings`) vão embutidos em _offline/
//   • as fontes do Google são baixadas pra dentro do pacote
//   • o login por usuário vira login genérico (uma senha só)
//
// Uso:
//   node scripts/build_offline.mjs --senha="..."     # 1ª vez (define a senha)
//   node scripts/build_offline.mjs                   # reaproveita a senha anterior
//   node scripts/build_offline.mjs --pull            # antes, atualiza o espelho do Storage
//   node scripts/build_offline.mjs --out=E:/caminho  # outra pasta de saída
//   node scripts/build_offline.mjs --no-fonts        # não baixa fontes (usa as do sistema)
//   node scripts/build_offline.mjs --contas --pull   # login por CONTA de cada membro (ver abaixo)
//
// A senha também pode vir de OFFLINE_PASSWORD (env ou .env.local).
// No pacote só vai o hash (SHA-256 com sal), nunca a senha.
//
// MODO CONTAS (--contas): cada membro entra com o email e a senha do site e
// encontra os grifos, salvos e lidos que tinha até o último --pull. O que
// fizer offline fica só na máquina servidora (_dados/local/) e não sobe.
// Exige o servidor.py (o `python -m http.server` puro não faz login) e leva
// para o pacote os hashes de senha dos membros — ver offline_export_contas.mjs.
// ============================================================

import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportContas, CONTAS_DIR } from './offline_export_contas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const OUT = path.resolve(args.out || 'dist-offline');
const MIRROR = path.join(ROOT, '.local-edits', 'teachings');
const FONT_CACHE = path.join(ROOT, '.local-edits', '.offline-font-cache');
const MARKER = '.pacote-offline';
// --contas: login com email e senha de cada membro + dados pessoais deles.
// Sem a flag: login genérico (uma senha para todos, dados no navegador).
const CONTAS = !!args.contas;
const VOLS = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];
const STORAGE_REL = '_offline/storage/v1/object/authenticated/teachings';

// O que entra no pacote (arquivos versionados no git) …
const INCLUDE_DIRS = ['js/', 'css/', 'assets/', 'data/', 'site_data/', 'mioshiec1/', 'mioshiec2/', 'mioshiec3/', 'mioshiec4/'];
const INCLUDE_ROOT_EXT = ['.html', '.svg', '.json'];
// … e o que fica de fora (admin, redefinição de senha, service worker de push).
const EXCLUDE = [
  /^js\/admin/, /^css\/admin/, /^css\/_admin/, /^data\/poetry\/markdown\//,
  /^admin-supabase\.html$/, /^analytics-johrei\.html$/, /^reset-password\.html$/, /^login\.html$/,
  /^package(-lock)?\.json$/, /^sw\.js$/,
];

const log = (...a) => console.log(...a);
const die = (msg) => { console.error('\n✖ ' + msg + '\n'); process.exit(1); };
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function walk(dir, base = dir, out = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

async function copyFile(src, dst) {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
}

// ------------------------------------------------------------
// 0. Senha
// ------------------------------------------------------------
async function readEnvLocal(key) {
  try {
    const txt = await fs.readFile('.env.local', 'utf8');
    const m = txt.match(new RegExp('^' + key + '\\s*=\\s*(.*)$', 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}

async function resolveAuthConfig() {
  if (CONTAS) return { salt: '', passwordHash: '', reused: false };
  const senha = (typeof args.senha === 'string' && args.senha) || process.env.OFFLINE_PASSWORD || await readEnvLocal('OFFLINE_PASSWORD');
  if (senha) {
    const salt = crypto.randomBytes(12).toString('hex');
    const passwordHash = crypto.createHash('sha256').update(salt + senha, 'utf8').digest('hex');
    return { salt, passwordHash, reused: false };
  }
  // Sem senha nova: reaproveita o hash do pacote anterior, se houver.
  try {
    const prev = await fs.readFile(path.join(OUT, 'js', 'offline-config.js'), 'utf8');
    const salt = prev.match(/salt:\s*'([0-9a-f]+)'/)?.[1];
    const passwordHash = prev.match(/passwordHash:\s*'([0-9a-f]{64})'/)?.[1];
    if (salt && passwordHash) return { salt, passwordHash, reused: true };
  } catch { /* sem pacote anterior */ }
  die('Defina a senha do login genérico:\n    node scripts/build_offline.mjs --senha="SUA_SENHA"\n  (ou OFFLINE_PASSWORD no .env.local). Nas próximas vezes ela é reaproveitada.');
}

// ------------------------------------------------------------
// 1. Espelho do Storage
// ------------------------------------------------------------
async function ensureMirror() {
  if (args.pull) {
    log('📥 Atualizando o espelho do Storage (storage-pull)…');
    const r = spawnSync(process.execPath, ['scripts/storage-pull.mjs'], { stdio: 'inherit' });
    if (r.status !== 0) log('⚠  storage-pull falhou (sem internet ou sem chave) — sigo com o espelho que já existe.');
  }
  if (!await exists(MIRROR)) {
    die('Não achei o espelho do Storage em .local-edits/teachings/.\n  Rode antes:  npm run storage:pull   (precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local)');
  }
  let when = null;
  try { when = JSON.parse(await fs.readFile(path.join(ROOT, '.local-edits', '.manifest.json'), 'utf8')).generatedAt; } catch {}
  return when;
}

// ------------------------------------------------------------
// 2. Copia o site
// ------------------------------------------------------------
async function copySite() {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0').filter(Boolean);
  let n = 0;
  for (const f of tracked) {
    if (EXCLUDE.some(re => re.test(f))) continue;
    const inDir = INCLUDE_DIRS.some(d => f.startsWith(d));
    const inRoot = !f.includes('/') && INCLUDE_ROOT_EXT.includes(path.extname(f));
    if (!inDir && !inRoot) continue;
    if (!await exists(f)) continue;       // removido no working tree
    await copyFile(f, path.join(OUT, f));
    n++;
  }
  return n;
}

// ------------------------------------------------------------
// 3. Conteúdo (bucket teachings) + listagem
// ------------------------------------------------------------
async function copyStorage() {
  const files = await walk(MIRROR);
  let bytes = 0;
  for (const rel of files) {
    const src = path.join(MIRROR, rel);
    await copyFile(src, path.join(OUT, STORAGE_REL, rel));
    bytes += (await fs.stat(src)).size;
  }
  await fs.writeFile(path.join(OUT, '_offline', 'storage-list.json'), JSON.stringify({ teachings: files.sort() }));
  return { count: files.length, bytes };
}

// ------------------------------------------------------------
// 4. Índices de busca por texto (PT e JA, por volume)
// ------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? ' ';
    })
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

async function buildSearchIndexes() {
  const outDir = path.join(OUT, '_offline', 'search');
  await fs.mkdir(outDir, { recursive: true });
  const stats = [];
  for (const vol of VOLS) {
    const dir = path.join(MIRROR, vol);
    if (!await exists(dir)) continue;
    const pt = [], ja = [];
    const names = (await fs.readdir(dir)).filter(n => n.endsWith('.json')).sort();
    for (const name of names) {
      let json;
      try { json = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')); }
      catch { log(`   ⚠ JSON inválido, pulado: ${vol}/${name}`); continue; }
      const file = name.replace(/\.html\.json$/, '').replace(/\.json$/, '');
      let i = 0;   // índice PLANO do tópico (mesma numeração do leitor: ?topic=N)
      for (const theme of json.themes || []) {
        for (const t of theme.topics || []) {
          // Mesma ordem de fallback do leitor (reader-render.js): o Vol. 2
          // guarda o português em content_pt/title_pt, os demais em *_ptbr.
          const tPt = htmlToText(t.topic_title_br || t.title_ptbr || t.title_pt || '');
          const tJa = htmlToText(t.title_ja || t.title || '');
          const cPt = htmlToText(t.content_ptbr || t.content_pt);
          const cJa = htmlToText(t.content);
          if (cPt || tPt) pt.push({ f: file, i, t: tPt, tj: tJa, c: cPt });
          if (cJa || tJa) ja.push({ f: file, i, t: tJa, tp: tPt, c: cJa });
          i++;
        }
      }
    }
    const sPt = JSON.stringify(pt), sJa = JSON.stringify(ja);
    await fs.writeFile(path.join(outDir, `${vol}.pt.json`), sPt);
    await fs.writeFile(path.join(outDir, `${vol}.ja.json`), sJa);
    stats.push(`${vol}: ${pt.length} tópicos (pt ${mb(Buffer.byteLength(sPt))}, ja ${mb(Buffer.byteLength(sJa))})`);
  }
  return stats;
}

// ------------------------------------------------------------
// 5. Cliente offline + login genérico
// ------------------------------------------------------------
async function installOfflineClient(auth) {
  await copyFile('offline/offline-client.js', path.join(OUT, 'js', 'offline-client.js'));
  await copyFile('offline/supabase-config.offline.js', path.join(OUT, 'js', 'supabase-config.js'));
  await fs.writeFile(path.join(OUT, 'js', 'offline-config.js'),
    `// Gerado por scripts/build_offline.mjs — não editar à mão.\n` +
    `export default {\n  mode: '${CONTAS ? 'contas' : 'generica'}',\n  salt: '${auth.salt}',\n  passwordHash: '${auth.passwordHash}',\n  builtAt: '${new Date().toISOString()}',\n};\n`);
}

// Troca pontual de texto que FALHA ALTO se o trecho sumir do fonte — assim
// uma mudança futura no login.js não gera um pacote quebrado em silêncio.
function mustReplace(src, from, to, what) {
  if (!src.includes(from)) die(`build_offline: não achei em ${what} o trecho:\n    ${from}\n  O arquivo mudou — ajuste scripts/build_offline.mjs.`);
  return src.split(from).join(to);
}

async function patchLogin() {
  if (CONTAS) return;   // modo contas usa a tela de login original (email + senha)
  const p = path.join(OUT, 'js', 'login.js');
  let s = await fs.readFile(p, 'utf8');
  s = mustReplace(s, 'if (!email || !password) return;', 'if (!password) return;', 'js/login.js');
  s = mustReplace(s, 'Insira suas credenciais para acessar', 'Digite a senha para acessar', 'js/login.js');
  s = mustReplace(s, "'Email ou senha incorretos'", "'Senha incorreta'", 'js/login.js');
  if (!/emailInput\.focus\(\);\r?\n\}/.test(s)) die('build_offline: não achei "emailInput.focus();" no fim de showLoginOverlay (js/login.js).');
  s = s.replace(/emailInput\.focus\(\);(\r?\n\})/, 'passInput.focus();$1');
  await fs.writeFile(p, s);
}

// ------------------------------------------------------------
// 6. HTML: importmap local + fontes locais
// ------------------------------------------------------------
const SUPA_CDN = /https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"']+/g;
const FONT_LINK = /<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"[^>]*>/g;
const PRECONNECT = /[ \t]*<link[^>]+rel="preconnect"[^>]+href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>\r?\n?/g;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function cachedFetch(url, name, asText) {
  const file = path.join(FONT_CACHE, name);
  if (await exists(file)) return asText ? fs.readFile(file, 'utf8') : fs.readFile(file);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(FONT_CACHE, { recursive: true });
  await fs.writeFile(file, buf);
  return asText ? buf.toString('utf8') : buf;
}

// Baixa um CSS do Google Fonts + todos os .woff2 que ele cita; devolve o
// nome do CSS local (em css/), já apontando pros arquivos em assets/fonts-offline/.
async function localizeFontCss(url) {
  const id = crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
  let css = await cachedFetch(url, `css-${id}.css`, true);
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]))];
  const fontDir = path.join(OUT, 'assets', 'fonts-offline');
  await fs.mkdir(fontDir, { recursive: true });
  let done = 0;
  const queue = urls.slice();
  await Promise.all(Array.from({ length: 12 }, async () => {
    for (let u; (u = queue.shift());) {
      const name = crypto.createHash('sha1').update(u).digest('hex').slice(0, 16) + (path.extname(new URL(u).pathname) || '.woff2');
      const buf = await cachedFetch(u, name, false);
      await fs.writeFile(path.join(fontDir, name), buf);
      css = css.split(u).join(`../assets/fonts-offline/${name}`);
      done++;
    }
  }));
  const cssName = `offline-fonts-${id}.css`;
  await fs.writeFile(path.join(OUT, 'css', cssName), css);
  return { cssName, fonts: done };
}

async function rewriteHtml() {
  const htmls = (await walk(OUT)).filter(f => f.endsWith('.html') && !f.startsWith('_offline/'));
  const fontMap = new Map();     // url do Google → css local (ou null se falhou)
  let fontFiles = 0, fontsFailed = false;

  for (const rel of htmls) {
    const p = path.join(OUT, rel);
    let s = await fs.readFile(p, 'utf8');
    const up = '../'.repeat(rel.split('/').length - 1) || './';

    s = s.replace(SUPA_CDN, `${up}js/offline-client.js`);

    for (const m of [...s.matchAll(FONT_LINK)]) {
      const url = m[1].replace(/&amp;/g, '&');
      if (!fontMap.has(url)) {
        if (args['no-fonts']) fontMap.set(url, null);
        else {
          try { const r = await localizeFontCss(url); fontMap.set(url, r.cssName); fontFiles += r.fonts; }
          catch (e) { fontsFailed = true; fontMap.set(url, null); log(`   ⚠ fontes: ${e.message}`); }
        }
      }
      const local = fontMap.get(url);
      s = s.replace(m[0], local ? `<link rel="stylesheet" href="${up}css/${local}">` : '');
    }
    s = s.replace(PRECONNECT, '');
    await fs.writeFile(p, s);
  }
  return { pages: htmls.length, fontFiles, fontsFailed };
}

// ------------------------------------------------------------
// 7. Lançadores + LEIA-ME
// ------------------------------------------------------------
const INICIAR_BAT = `@echo off
chcp 65001 > nul
title Caminho da Felicidade - modo offline
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Python nao foi encontrado neste computador.
    echo.
    echo Instale o Python 3:  https://www.python.org/downloads/
    echo IMPORTANTE: na instalacao, marque "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

REM Busca atualizacoes do pacote, se esta pasta veio de "git clone".
REM Sem git, sem internet ou sem novidades: segue com a versao que ja esta aqui.
where git >nul 2>nul
if not errorlevel 1 if exist ".git" (
    echo Verificando atualizacoes...
    git pull --ff-only
    if errorlevel 1 (
        echo [AVISO] Nao foi possivel atualizar - sem internet? Usando a versao atual.
    )
    echo.
)

REM Abre o navegador 2 segundos depois, para dar tempo do servidor subir
start "" cmd /c "timeout /t 2 /nobreak > nul && start http://localhost:8000/"

python servidor.py 8000
pause
`;

const INICIAR_COMMAND = `#!/bin/bash
cd "$(dirname "$0")"
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "Verificando atualizacoes..."
  git pull --ff-only || echo "[AVISO] Nao foi possivel atualizar - sem internet? Usando a versao atual."
fi
( sleep 2; (open http://localhost:8000/ 2>/dev/null || xdg-open http://localhost:8000/ 2>/dev/null) ) &
python3 servidor.py 8000
`;

function leiaMe(mirrorDate) {
  return `CAMINHO DA FELICIDADE — PACOTE OFFLINE
======================================

Esta pasta é uma cópia de leitura do site, para usar quando não houver
internet. Ela roda sozinha: não precisa de internet, banco de dados nem
instalação, só do Python 3.

COMO USAR
---------
1. Copie esta pasta inteira para o computador (pendrive, HD externo…).
2. Windows: dê dois cliques em INICIAR.bat
   Mac/Linux: INICIAR.command  (ou: python3 servidor.py)
3. O navegador abre em http://localhost:8000 e pede ${CONTAS ? `o email e a senha
   (os mesmos do site online)` : 'a senha'}.
4. Para outras pessoas na MESMA rede/Wi-Fi: a janela preta mostra um
   endereço do tipo http://192.168.x.x:8000 — é só digitar no celular
   ou em outro computador.
   Na primeira vez o Windows pergunta se o Python pode usar a rede:
   responda "Permitir".

ATUALIZAÇÃO: se a pasta veio de "git clone", o INICIAR busca sozinho a
versão mais nova quando há internet. Sem internet, abre a que já está aqui.

${CONTAS ? `IMPORTANTE: use sempre o INICIAR (servidor.py). O "python -m http.server"
puro mostra as páginas, mas não faz o login das contas.
` : `Também funciona com o servidor padrão do Python:
    python -m http.server 8000
(o servidor.py só acrescenta alguns cuidados e mostra o endereço da rede).
`}
O QUE FUNCIONA
--------------
• Leitura de todos os Ensinamentos (português e japonês), poesia e livros
• Navegação, índices e busca por título e por texto
${CONTAS ? `• Cada membro entra com a própria conta e encontra os grifos, salvos,
  pastas e lidos que tinha no site online até a data do pacote
• O que for grifado ou salvo aqui fica guardado NESTA máquina (pasta
  _dados/local) e aparece em qualquer aparelho da rede; NÃO sobe para a
  conta online quando a internet voltar
• Imprimir: pelo navegador (Ctrl+P) na página do Ensinamento
` : `• Grifos, favoritos, "lido" e posição de leitura — ficam guardados NO
  NAVEGADOR de cada aparelho (não vão para a conta online e não passam
  de um aparelho para outro)
`}
O QUE NÃO FUNCIONA OFFLINE
--------------------------
${CONTAS ? `• Criar conta ou redefinir senha (vale a senha que o membro tinha no
  site na data do pacote)
` : `• Contas individuais (o login é uma senha única para todos)
`}• Recomendações, mensagens ao Reverendo, coletâneas, painel admin
• Busca semântica ("relacionados"), notificações, instalar como aplicativo

${CONTAS ? `CUIDADO COM ESTA PASTA
----------------------
A pasta _dados/ contém as contas dos membros (emails, senhas em forma
cifrada e grifos pessoais). O servidor nunca entrega esses arquivos pela
rede, mas quem copiar a PASTA leva tudo. Guarde-a como material reservado
e faça cópia de segurança de _dados/local de tempos em tempos.
` : `SOBRE A SENHA
-------------
A senha é uma porta de entrada, não um cofre: quem tiver acesso à pasta
consegue abrir os arquivos direto. Não deixe o pacote em local público.
`}
Conteúdo dos Ensinamentos atualizado em: ${mirrorDate || 'data desconhecida'}
Pacote gerado em: ${new Date().toISOString().slice(0, 10)}
`;
}

// ------------------------------------------------------------
// main
// ------------------------------------------------------------
const t0 = Date.now();
log(`\n📦 Pacote offline → ${OUT}\n`);

const auth = await resolveAuthConfig();   // antes de apagar a pasta (lê o hash antigo)
const mirrorDate = await ensureMirror();

if (await exists(OUT)) {
  const entries = await fs.readdir(OUT);
  if (entries.length && !entries.includes(MARKER)) {
    die(`A pasta ${OUT} já existe e não é um pacote offline (falta ${MARKER}).\n  Não vou apagar. Escolha outra pasta com --out=...`);
  }
  // Preserva o .git: o pacote pode ser um repositório próprio (privado), para
  // as outras máquinas atualizarem com "git pull". Todo o resto é recriado.
  for (const e of entries) {
    if (e === '.git') continue;
    if (e === '_dados') {     // _dados/local = o que os membros fizeram NESTA máquina: nunca apagar
      for (const d of await fs.readdir(path.join(OUT, e))) {
        if (d !== 'local') await fs.rm(path.join(OUT, e, d), { recursive: true, force: true });
      }
      continue;
    }
    await fs.rm(path.join(OUT, e), { recursive: true, force: true });
  }
}
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, MARKER), 'Pasta gerada por scripts/build_offline.mjs. É apagada e recriada a cada build.\n');

log('1/6  Copiando o site…');
log(`     ${await copySite()} arquivos`);

log('2/6  Embutindo os Ensinamentos…');
const st = await copyStorage();
log(`     ${st.count} arquivos, ${mb(st.bytes)}${mirrorDate ? ` (espelho de ${mirrorDate.slice(0, 10)})` : ''}`);

log('3/6  Gerando índices de busca…');
for (const line of await buildSearchIndexes()) log('     ' + line);

log('4/6  Instalando cliente offline e login genérico…');
await installOfflineClient(auth);
await patchLogin();
log(CONTAS ? '     login por conta de cada membro' : `     senha ${auth.reused ? 'reaproveitada do pacote anterior' : 'definida agora'}`);

if (CONTAS) {
  log('     Contas dos membros…');
  if (args.pull || !await exists(path.join(CONTAS_DIR, 'contas.json'))) {
    try { await exportContas({ log }); }
    catch (e) {
      if (!await exists(path.join(CONTAS_DIR, 'contas.json'))) die('Não consegui exportar as contas: ' + e.message.split('\n')[0]);
      log('     ⚠ exportação falhou (sem internet?) — uso a última cópia das contas.');
    }
  }
  for (const rel of await walk(CONTAS_DIR)) {
    if (rel === 'info.json') continue;
    await copyFile(path.join(CONTAS_DIR, rel), path.join(OUT, '_dados', rel));
  }
  await copyFile('node_modules/bcryptjs/dist/bcrypt.min.js', path.join(OUT, 'js', 'vendor', 'bcrypt.min.js'));
  // O que os membros fizerem offline fica na máquina servidora, fora do git.
  await fs.writeFile(path.join(OUT, '.gitignore'), '_dados/local/\n__pycache__/\n');
}

log('5/6  Ajustando páginas e baixando fontes…');
const hr = await rewriteHtml();
log(`     ${hr.pages} páginas; ${hr.fontFiles} arquivos de fonte${hr.fontsFailed ? ' (algumas falharam: usará fontes do sistema)' : ''}`);

log('6/6  Lançadores…');
await copyFile('offline/servidor.py', path.join(OUT, 'servidor.py'));
await fs.writeFile(path.join(OUT, 'INICIAR.bat'), INICIAR_BAT.replace(/\r?\n/g, '\r\n'));
await fs.writeFile(path.join(OUT, 'INICIAR.command'), INICIAR_COMMAND, { mode: 0o755 });
await fs.writeFile(path.join(OUT, 'LEIA-ME.txt'), leiaMe(mirrorDate?.slice(0, 10)));
// O Windows não guarda o "bit de execução": sem isto o git registra o
// INICIAR.command como arquivo comum e o Mac recusa o duplo clique
// ("não tem privilégios"). Marca direto no índice do git do pacote.
if (await exists(path.join(OUT, '.git'))) {
  try {
    execFileSync('git', ['-C', OUT, 'add', 'INICIAR.command'], { stdio: 'ignore' });
    execFileSync('git', ['-C', OUT, 'update-index', '--chmod=+x', 'INICIAR.command'], { stdio: 'ignore' });
  } catch { log('     ⚠ não consegui marcar INICIAR.command como executável no git'); }
}

// Sobrou alguma referência externa que quebraria offline?
const leftovers = [];
for (const rel of (await walk(OUT)).filter(f => /\.(html|css)$/.test(f) && !f.startsWith('_offline/'))) {
  const s = fssync.readFileSync(path.join(OUT, rel), 'utf8');
  if (/fonts\.googleapis\.com|supabase-js@/.test(s)) leftovers.push(rel);
}
if (leftovers.length) log(`\n⚠  Ainda citam CDN (não impede o uso, mas confira): ${leftovers.join(', ')}`);

let total = 0;
for (const rel of await walk(OUT)) total += fssync.statSync(path.join(OUT, rel)).size;
log(`\n✔ Pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s — ${mb(total)}`);
log(`  Para testar:  python "${path.join(OUT, 'servidor.py')}"\n`);
