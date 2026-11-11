// ============================================================
// Cliente Supabase OFFLINE — Caminho da Felicidade
//
// Este arquivo NÃO é usado pelo site online. O scripts/build_offline.mjs
// o copia para dentro do pacote offline, onde ele ocupa o lugar do
// @supabase/supabase-js (via importmap) e do js/supabase-config.js.
//
// O que ele emula, sem servidor nenhum (só arquivos estáticos):
//   • auth     → login genérico por senha única (hash em offline-config.js)
//   • storage  → lê os JSON dos ensinamentos da pasta _offline/ do pacote
//   • from()   → mini banco em localStorage (grifos, favoritos, lidos,
//                posição de leitura ficam NESTE navegador)
//   • rpc()    → busca por texto e sorteio feitos no navegador, sobre os
//                índices gerados no build
// Tudo que depende de servidor (recomendações, mensagens, coletâneas,
// busca semântica) responde vazio ou "indisponível offline".
// ============================================================
import OFFLINE_CONFIG from './offline-config.js';

// Raiz dos dados: <pacote>/_offline  (este arquivo mora em <pacote>/js/)
export const OFFLINE_BASE = new URL('../_offline', import.meta.url).href.replace(/\/$/, '');
const STORAGE_BASE = `${OFFLINE_BASE}/storage/v1/object/authenticated`;
const VOLS = ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];

// Dois modos, escolhidos no build (offline-config.js):
//   'generica' → uma senha única para todos; dados no navegador.
//   'contas'   → email + senha de cada membro, conferidos pelo servidor.py;
//                grifos/salvos/lidos ficam guardados na máquina servidora.
const CONTAS = OFFLINE_CONFIG.mode === 'contas';
const GENERIC_USER_ID = '00000000-0000-4000-8000-0000000ff11e';
const SESSION_KEY = 'offline_session';
const REMOTE_TABLES = new Set(['user_highlights', 'synced_favorites', 'favorite_folders', 'read_marks', 'reading_positions']);
const REMOTE_RPCS = new Set(['register_reading', 'undo_reading']);

function _stored() {
  try { const v = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return v && v.token && v.user ? v : null; }
  catch (_) { return null; }
}
const uid = () => (CONTAS ? (_stored()?.user?.id || 'anon') : GENERIC_USER_ID);
// No modo contas cada pessoa tem seu próprio "banco" local (perfil, logs).
const dbKey = (table) => 'offline_db:' + (CONTAS ? uid() + ':' : '') + table;

async function _api(path, body) {
  let res;
  try {
    res = await fetch(`${location.origin}/api/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch (e) {
    return { data: null, error: { message: 'Servidor offline inacessível', code: 'NET' } };
  }
  if (res.status === 401) {          // sessão expirou ou o servidor foi trocado
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem('mioshie_auth'); } catch (_) {}
    setTimeout(() => location.reload(), 60);
  }
  try { return await res.json(); }
  catch (_) { return { data: null, error: { message: `Este recurso precisa do servidor.py (INICIAR) — resposta ${res.status}`, code: 'NOSERVER' } }; }
}

let _bcryptPromise = null;
function _loadBcrypt() {
  if (!_bcryptPromise) {
    _bcryptPromise = new Promise((resolve, reject) => {
      if (globalThis.dcodeIO && globalThis.dcodeIO.bcrypt) return resolve(globalThis.dcodeIO.bcrypt);
      const sc = document.createElement('script');
      sc.src = new URL('./vendor/bcrypt.min.js', import.meta.url).href;
      sc.onload = () => (globalThis.dcodeIO && globalThis.dcodeIO.bcrypt ? resolve(globalThis.dcodeIO.bcrypt) : reject(new Error('bcrypt não carregou')));
      sc.onerror = () => reject(new Error('bcrypt não carregou'));
      document.head.appendChild(sc);
    });
  }
  return _bcryptPromise;
}

const OFFLINE_ERR = (what) => ({ message: `Indisponível no modo offline${what ? ` (${what})` : ''}`, code: 'OFFLINE' });

// ------------------------------------------------------------
// SHA-256 em JS puro. crypto.subtle NÃO existe em http://192.168.x.x
// (só em contexto seguro: https ou localhost), então não dá pra usar.
// ------------------------------------------------------------
function sha256Hex(str) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const bytes = Array.from(new TextEncoder().encode(str));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
             (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h = [(h[0] + a) | 0, (h[1] + b) | 0, (h[2] + c) | 0, (h[3] + d) | 0,
         (h[4] + e) | 0, (h[5] + f) | 0, (h[6] + g) | 0, (h[7] + hh) | 0];
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

function uuid() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ------------------------------------------------------------
// auth — login genérico
// ------------------------------------------------------------
function _makeSession() {
  const st = CONTAS ? _stored() : null;
  const user = {
    id: uid(), email: st ? st.user.email : 'offline@local',
    role: 'authenticated', app_metadata: {}, user_metadata: {},
  };
  return { access_token: st ? st.token : 'offline', refresh_token: 'offline', token_type: 'bearer', expires_in: 3600, user };
}

function _hasSession() {
  if (CONTAS) return !!_stored();
  try { return localStorage.getItem(SESSION_KEY) === OFFLINE_CONFIG.passwordHash; } catch (_) { return false; }
}

async function _signInConta(email, password) {
  const bad = (message) => ({ data: { session: null, user: null }, error: { message } });
  const e = String(email || '').trim().toLowerCase();
  if (!e || !password) return bad('Invalid login credentials');
  const s = await _api('salt', { email: e });
  if (!s || !s.salt) return bad((s && s.error && s.error.message) || 'Servidor offline inacessível');
  let proof;
  try { proof = (await _loadBcrypt()).hashSync(String(password), s.salt); }
  catch (_) { return bad('Invalid login credentials'); }
  const r = await _api('login', { email: e, proof });
  if (!r || !r.token) return bad((r && r.error && r.error.message) || 'Invalid login credentials');
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token: r.token, user: r.user, perms: r.perms || [] })); } catch (_) {}
  // perfil e permissões vêm do servidor a cada login (fonte da verdade)
  try {
    localStorage.removeItem(dbKey('user_profiles'));
    localStorage.removeItem(dbKey('user_permissions'));
  } catch (_) {}
  if (typeof location !== 'undefined') setTimeout(() => location.reload(), 60);
  const session = _makeSession();
  return { data: { session, user: session.user }, error: null };
}

// O login.js mantém um flag legado (mioshie_auth) que, sozinho, libera a
// página mesmo sem sessão. Online isso é um fallback de rede; offline deixaria
// entrar quem logou com uma senha ANTIGA — e o leitor quebraria, porque sem
// sessão ele não busca o conteúdo em _offline/. Sem sessão válida, some o flag.
if (!_hasSession()) {
  try {
    localStorage.removeItem('mioshie_auth');
    localStorage.removeItem('mioshie_access_config');
  } catch (_) {}
}

const auth = {
  async getSession() {
    return { data: { session: _hasSession() ? _makeSession() : null }, error: null };
  },
  async getUser() {
    return { data: { user: _hasSession() ? _makeSession().user : null }, error: null };
  },
  async signInWithPassword({ email, password } = {}) {
    if (CONTAS) return _signInConta(email, password);
    const ok = sha256Hex(OFFLINE_CONFIG.salt + String(password || '')) === OFFLINE_CONFIG.passwordHash;
    if (!ok) return { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } };
    try { localStorage.setItem(SESSION_KEY, OFFLINE_CONFIG.passwordHash); } catch (_) {}
    // A página já tentou carregar o conteúdo ANTES do login (e falhou, sem
    // sessão). Recarregar dá um início limpo já autenticado — sem isto, quem
    // abre direto um link do leitor vê "Erro ao carregar o ensinamento".
    if (typeof location !== 'undefined') setTimeout(() => location.reload(), 60);
    const session = _makeSession();
    return { data: { session, user: session.user }, error: null };
  },
  async signOut() {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
    return { error: null };
  },
  onAuthStateChange() {
    return { data: { subscription: { unsubscribe() {} } } };
  },
  async signUp() { return { data: { user: null, session: null }, error: OFFLINE_ERR('cadastro') }; },
  async resetPasswordForEmail() { return { data: null, error: OFFLINE_ERR('redefinir senha') }; },
  async updateUser() { return { data: { user: null }, error: OFFLINE_ERR() }; },
};

// ------------------------------------------------------------
// from() — mini banco em localStorage
// ------------------------------------------------------------
const _SEED = {
  user_profiles: () => {
    const u = CONTAS ? _stored()?.user : null;
    return u
      ? [{ id: u.id, role: u.role || 'member', name: u.name || '', email: u.email, preferred_lang: u.preferred_lang || null }]
      : [{ id: uid(), role: 'member', name: 'Offline', email: 'offline@local', preferred_lang: null }];
  },
  user_permissions: () => (CONTAS ? (_stored()?.perms || []).map(p => ({ user_id: uid(), volume: p.volume, files: p.files })) : []),
};

function _load(table) {
  try {
    const raw = localStorage.getItem(dbKey(table));
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return _SEED[table] ? _SEED[table]() : [];
}

function _save(table, rows) {
  try { localStorage.setItem(dbKey(table), JSON.stringify(rows)); return null; }
  catch (e) { return { message: 'Armazenamento do navegador cheio — não foi possível salvar.', code: 'QUOTA' }; }
}

const _cmp = (a, b) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0);

const _OPS = {
  eq: (v, x) => v === x || (v != null && x != null && String(v) === String(x)),
  neq: (v, x) => !_OPS.eq(v, x),
  gt: (v, x) => v != null && v > x,
  gte: (v, x) => v != null && v >= x,
  lt: (v, x) => v != null && v < x,
  lte: (v, x) => v != null && v <= x,
  in: (v, x) => Array.isArray(x) && x.some(i => _OPS.eq(v, i)),
  is: (v, x) => (x === null ? v == null : v === x),
  like: (v, x) => _likeRe(x, '').test(String(v ?? '')),
  ilike: (v, x) => _likeRe(x, 'i').test(String(v ?? '')),
};
function _likeRe(pattern, flags) {
  const esc = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp('^' + esc + '$', flags);
}

class Query {
  constructor(table) {
    this.table = table; this.op = 'select'; this.filters = []; this.orders = [];
    this.from = null; this.to = null; this.lim = null; this.mode = null;
    this.payload = null; this.opts = {}; this.returning = false;
  }
  select(_cols, opts) {
    if (this.op === 'select') { this.opts = opts || {}; } else { this.returning = true; }
    return this;
  }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  upsert(rows, opts) { this.op = 'upsert'; this.payload = rows; this.opts = opts || {}; return this; }
  update(patch, opts) { this.op = 'update'; this.payload = patch; this.opts = opts || {}; return this; }
  delete(opts) { this.op = 'delete'; this.opts = opts || {}; return this; }
  filter(col, op, val) { this.filters.push([col, _OPS[op] ? op : 'eq', val]); return this; }
  eq(c, v) { return this.filter(c, 'eq', v); }
  neq(c, v) { return this.filter(c, 'neq', v); }
  gt(c, v) { return this.filter(c, 'gt', v); }
  gte(c, v) { return this.filter(c, 'gte', v); }
  lt(c, v) { return this.filter(c, 'lt', v); }
  lte(c, v) { return this.filter(c, 'lte', v); }
  in(c, v) { return this.filter(c, 'in', v); }
  is(c, v) { return this.filter(c, 'is', v); }
  like(c, v) { return this.filter(c, 'like', v); }
  ilike(c, v) { return this.filter(c, 'ilike', v); }
  match(obj) { for (const k in obj) this.eq(k, obj[k]); return this; }
  not() { return this; }          // não usado pelo site de membros; no-op seguro
  or() { return this; }
  contains() { return this; }
  order(col, o) { this.orders.push([col, !(o && o.ascending === false)]); return this; }
  range(a, b) { this.from = a; this.to = b; return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  abortSignal() { return this; }
  throwOnError() { return this; }
  returns() { return this; }

  _matches(row) { return this.filters.every(([c, op, v]) => _OPS[op](row[c], v)); }

  _shape(rows, count) {
    const out = { error: null, status: 200, statusText: 'OK' };
    if (this.opts && this.opts.count) out.count = count != null ? count : rows.length;
    if (this.mode === 'single') {
      if (rows.length !== 1) { out.data = null; out.error = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }; }
      else out.data = rows[0];
    } else if (this.mode === 'maybe') {
      out.data = rows[0] || null;
    } else {
      out.data = rows;
    }
    return out;
  }

  _run() {
    const now = new Date().toISOString();
    let rows = _load(this.table);

    if (this.op === 'select') {
      let res = rows.filter(r => this._matches(r));
      const total = res.length;
      for (const [col, asc] of [...this.orders].reverse()) {
        res = res.slice().sort((a, b) => (asc ? 1 : -1) * _cmp(a[col], b[col]));
      }
      if (this.from != null) res = res.slice(this.from, (this.to ?? Infinity) + 1);
      if (this.lim != null) res = res.slice(0, this.lim);
      if (this.opts && this.opts.head) { const o = this._shape([], total); o.data = null; o.error = null; return o; }
      return this._shape(res.map(r => ({ ...r })), total);
    }

    if (this.op === 'insert' || this.op === 'upsert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const keys = this.op === 'upsert'
        ? String(this.opts.onConflict || 'id').split(',').map(s => s.trim()).filter(Boolean)
        : null;
      const touched = [];
      for (const item of list) {
        let ex = null;
        if (keys && keys.every(k => item[k] !== undefined)) {
          ex = rows.find(r => keys.every(k => _OPS.eq(r[k], item[k])));
        }
        if (ex) {
          Object.assign(ex, item, { updated_at: item.updated_at || now });
          touched.push(ex);
        } else {
          const row = { id: uuid(), created_at: now, updated_at: now, ...item };
          rows.push(row); touched.push(row);
        }
      }
      const err = _save(this.table, rows);
      if (err) return { data: null, error: err };
      return this.returning ? this._shape(touched.map(r => ({ ...r }))) : { data: null, error: null, status: 201 };
    }

    if (this.op === 'update') {
      const touched = rows.filter(r => this._matches(r));
      for (const r of touched) Object.assign(r, this.payload, { updated_at: this.payload.updated_at || now });
      const err = _save(this.table, rows);
      if (err) return { data: null, error: err };
      const out = this.returning ? this._shape(touched.map(r => ({ ...r }))) : { data: null, error: null };
      if (this.opts.count) out.count = touched.length;
      return out;
    }

    if (this.op === 'delete') {
      const keep = [], gone = [];
      for (const r of rows) (this._matches(r) ? gone : keep).push(r);
      const err = _save(this.table, keep);
      if (err) return { data: null, error: err };
      const out = this.returning ? this._shape(gone) : { data: null, error: null };
      if (this.opts.count) out.count = gone.length;
      return out;
    }
    return { data: null, error: OFFLINE_ERR() };
  }

  then(resolve, reject) {
    if (CONTAS && REMOTE_TABLES.has(this.table)) {
      const q = { table: this.table, op: this.op, filters: this.filters, orders: this.orders,
        from: this.from, to: this.to, lim: this.lim, mode: this.mode,
        payload: this.payload, opts: this.opts, returning: this.returning };
      return _api('db', { token: _stored()?.token, q }).then(resolve, reject);
    }
    let out;
    try { out = this._run(); } catch (e) { out = { data: null, error: { message: String(e && e.message || e) } }; }
    return Promise.resolve(out).then(resolve, reject);
  }
  catch(fn) { return this.then(undefined, fn); }
  finally(fn) { return this.then().finally(fn); }
}

// ------------------------------------------------------------
// storage — arquivos estáticos do pacote
// ------------------------------------------------------------
let _listPromise = null;
function _allPaths() {
  if (!_listPromise) {
    _listPromise = fetch(`${OFFLINE_BASE}/storage-list.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  }
  return _listPromise;
}

function _bucket(bucket) {
  const urlOf = (p) => `${STORAGE_BASE}/${bucket}/${String(p).replace(/^\/+/, '')}`;
  return {
    async download(path) {
      try {
        const res = await fetch(urlOf(path));
        if (!res.ok) return { data: null, error: { message: 'Object not found', statusCode: String(res.status) } };
        return { data: await res.blob(), error: null };
      } catch (e) {
        return { data: null, error: { message: String(e && e.message || e) } };
      }
    },
    async list(prefix = '', opts = {}) {
      const all = (await _allPaths())[bucket] || [];
      const pre = String(prefix || '').replace(/^\/+|\/+$/g, '');
      const seen = new Map();
      for (const p of all) {
        if (pre && !p.startsWith(pre + '/')) continue;
        const rest = pre ? p.slice(pre.length + 1) : p;
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!seen.has(name)) seen.set(name, { name, id: slash === -1 ? name : null, metadata: slash === -1 ? {} : null });
      }
      let out = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
      const off = opts.offset || 0;
      out = out.slice(off, off + (opts.limit || out.length));
      return { data: out, error: null };
    },
    getPublicUrl(path) { return { data: { publicUrl: urlOf(path) } }; },
    async createSignedUrl(path) { return { data: { signedUrl: urlOf(path) }, error: null }; },
    async upload() { return { data: null, error: OFFLINE_ERR('envio de arquivo') }; },
    async remove() { return { data: null, error: OFFLINE_ERR() }; },
  };
}

// ------------------------------------------------------------
// Busca por texto — índices gerados no build: _offline/search/<vol>.<lang>.json
// Cada item: { f: arquivo, i: índice do tópico, t: título, c: texto puro }
// ------------------------------------------------------------
const _idxCache = new Map();
function _loadIndex(vol, lang) {
  const key = `${vol}.${lang}`;
  if (!_idxCache.has(key)) {
    _idxCache.set(key, fetch(`${OFFLINE_BASE}/search/${key}.json`)
      .then(r => (r.ok ? r.json() : []))
      .catch(() => { _idxCache.delete(key); return []; }));
  }
  return _idxCache.get(key);
}

const _ACCENTS = { a: 'aáàâãä', e: 'eéèêë', i: 'iíìîï', o: 'oóòôõö', u: 'uúùûü', c: 'cç', n: 'nñ' };
const _fold = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Termo → regex insensível a acento e caixa ("espirito" acha "Espírito").
function _termRegex(term) {
  let src = '';
  for (const ch of _fold(term)) {
    if (_ACCENTS[ch]) src += `[${_ACCENTS[ch]}]`;
    else if (/\s/.test(ch)) src += '\\s+';
    else src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(src, 'i');
}

// Sintaxe que o search.js envia: palavras (AND), "frases", e grupos
// separados por " or ".
function _parseQuery(q) {
  return String(q || '').split(/\s+or\s+/i).map(part => {
    const terms = [];
    const re = /"([^"]+)"|(\S+)/g;
    let m;
    while ((m = re.exec(part))) {
      const t = (m[1] || m[2] || '').replace(/^[-+]/, '').trim();
      if (t) terms.push(t);
    }
    return terms.map(_termRegex);
  }).filter(g => g.length);
}

const _escHtml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function _snippet(text, regs) {
  let pos = -1, len = 0;
  for (const re of regs) {
    const m = re.exec(text);
    if (m && (pos === -1 || m.index < pos)) { pos = m.index; len = m[0].length; }
  }
  if (pos === -1) return _escHtml(text.slice(0, 220)) + (text.length > 220 ? '…' : '');
  const start = Math.max(0, pos - 90);
  const end = Math.min(text.length, pos + len + 150);
  let chunk = text.slice(start, end);
  // marca todas as ocorrências dos termos dentro do trecho
  const marks = [];
  for (const re of regs) {
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(chunk))) { marks.push([m.index, m.index + m[0].length]); if (!m[0].length) g.lastIndex++; }
  }
  marks.sort((a, b) => a[0] - b[0]);
  let html = '', cur = 0;
  for (const [a, b] of marks) {
    if (a < cur) continue;
    html += _escHtml(chunk.slice(cur, a)) + '<mark>' + _escHtml(chunk.slice(a, b)) + '</mark>';
    cur = b;
  }
  html += _escHtml(chunk.slice(cur));
  return (start > 0 ? '…' : '') + html + (end < text.length ? '…' : '');
}

async function _search({ q, lang = 'pt', max_results = 60, scope = 'content' } = {}) {
  const groups = _parseQuery(q);
  if (!groups.length) return [];
  const L = lang === 'ja' ? 'ja' : 'pt';
  const allRegs = groups.flat();
  const out = [];
  for (const vol of VOLS) {
    const idx = await _loadIndex(vol, L);
    for (const it of idx) {
      const title = it.t || '';
      const body = scope === 'title' ? '' : (it.c || '');
      let hit = false, score = 0;
      for (const g of groups) {
        if (g.every(re => re.test(title) || re.test(body))) {
          hit = true;
          score = Math.max(score, g.length + (g.every(re => re.test(title)) ? 3 : 0));
        }
      }
      if (!hit) continue;
      out.push({
        vol, file: it.f, topic_idx: it.i,
        title_pt: L === 'pt' ? title : (it.tp || ''),
        title_ja: L === 'ja' ? title : (it.tj || ''),
        nav_title_pt: null, nav_title_ja: null,
        snippet: _snippet(it.c || title, allRegs),
        content_excerpt: (it.c || '').slice(0, 300),
        rank: score,
      });
    }
  }
  out.sort((a, b) => b.rank - a.rank);
  return out.slice(0, max_results || 60);
}

async function _randomTopic(onlyVol) {
  const vol = VOLS.includes(onlyVol) ? onlyVol : VOLS[Math.floor(Math.random() * VOLS.length)];
  const [pt, ja] = await Promise.all([_loadIndex(vol, 'pt'), _loadIndex(vol, 'ja')]);
  if (!pt.length) return null;
  const it = pt[Math.floor(Math.random() * pt.length)];
  const j = ja.find(x => x.f === it.f && x.i === it.i) || {};
  // O texto começa pelo próprio título; tira-o do início do trecho.
  const cut = (text, title) => {
    let s = String(text || '');
    if (title && s.startsWith(title)) s = s.slice(title.length);
    s = s.replace(/^[\s\-–—:：()（）\d\w,.º°de]{0,60}?\)\s*/, '').trim();
    return s.length > 420 ? s.slice(0, 420).replace(/\s+\S*$/, '') + '…' : s;
  };
  return {
    vol, file: it.f, topic_idx: it.i,
    title_pt: it.t || '', title_ja: j.t || it.tj || '',
    excerpt_pt: cut(it.c, it.t), excerpt_ja: cut(j.c, j.t),
    already_read: false,
  };
}

// ------------------------------------------------------------
// rpc()
// ------------------------------------------------------------
function _readMark(args) {
  const rows = _load('read_marks');
  const row = rows.find(r => r.user_id === uid() && r.volume === args.p_volume
    && r.file === args.p_file && Number(r.topic_index) === Number(args.p_topic_index));
  return { rows, row };
}

const _RPC = {
  search_teachings_hybrid: (a) => _search(a),
  search_teachings: (a) => _search(a),
  search_teachings_literal: (a) => _search({ ...a, q: `"${String(a.q || '').replace(/"/g, '')}"` }),
  suggest_teachings: () => [],
  random_teaching: async (a) => { const t = await _randomTopic(a && a.only_vol); return t ? [t] : []; },
  random_teaching_card: async (a) => { const t = await _randomTopic(a && a.only_vol); return t ? [t] : []; },

  register_reading: (a) => {
    const now = new Date().toISOString();
    const { rows, row } = _readMark(a);
    let n;
    if (row) { n = row.times_read = (Number(row.times_read) || 1) + 1; row.last_read_at = now; }
    else {
      n = 1;
      rows.push({ id: uuid(), user_id: uid(), volume: a.p_volume, file: a.p_file,
        topic_index: a.p_topic_index, topic_title: a.p_topic_title || null,
        created_at: now, times_read: 1, last_read_at: now });
    }
    _save('read_marks', rows);
    return n;
  },
  undo_reading: (a) => {
    const { rows, row } = _readMark(a);
    if (!row) return 0;
    const n = (Number(row.times_read) || 1) - 1;
    if (n <= 0) { _save('read_marks', rows.filter(r => r !== row)); return 0; }
    row.times_read = n; _save('read_marks', rows);
    return n;
  },

  // Recursos que dependem do servidor: respondem "nada a mostrar".
  get_my_recommendations: () => [],
  get_my_recommendations_archived: () => [],
  get_my_recommendations_summary: () => [{ total: 0, unseen: 0, ever_received: 0 }],
  get_my_messages: () => [],
  get_my_messages_summary: () => [{ total: 0, unread_replies: 0 }],
  list_my_collections: () => [],
  mark_recommendations_seen: () => null,
  mark_my_replies_seen: () => null,
  log_access_dedup: () => null,
  log_audio_progress: () => null,
  increment_read_time: () => null,
  update_max_scroll_pct: () => null,
};

async function rpc(name, args) {
  if (CONTAS && REMOTE_RPCS.has(name)) return _api('rpc', { token: _stored()?.token, name, args: args || {} });
  const fn = _RPC[name];
  if (!fn) return { data: null, error: OFFLINE_ERR(name) };
  try { return { data: await fn(args || {}), error: null }; }
  catch (e) { return { data: null, error: { message: String(e && e.message || e) } }; }
}

// rpc() precisa ser "thenable preguiçoso" como o builder real? Não: o site
// sempre faz await/then nele. Uma Promise comum serve.

// ------------------------------------------------------------
// Ajustes de interface do modo offline
// ------------------------------------------------------------
function _injectOfflineUi() {
  if (typeof document === 'undefined' || document.getElementById('offline-mode-style')) return;
  const st = document.createElement('style');
  st.id = 'offline-mode-style';
  st.textContent = `
    ${CONTAS ? '' : '#login-overlay #login-email { display: none !important; }'}
    #login-overlay a[href*="reset-password"] { display: none !important; }
    /* recursos que dependem do servidor */
    #headerRecommendationsBtn, #mobileNavLinkInstall,
    a[href$="recomendacoes.html"], a[href$="admin-supabase.html"],
    #admin-mobile-btn { display: none !important; }
  `;
  (document.head || document.documentElement).appendChild(st);
  document.documentElement.setAttribute('data-offline-mode', '1');
}
_injectOfflineUi();

// ------------------------------------------------------------
// API pública — mesma forma do @supabase/supabase-js
// ------------------------------------------------------------
const client = {
  auth,
  from: (table) => new Query(table),
  rpc,
  storage: { from: _bucket },
  functions: { invoke: async (name) => ({ data: null, error: OFFLINE_ERR(name) }) },
  channel: () => { const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} }; return ch; },
  removeChannel: () => {},
  removeAllChannels: () => {},
};

export function createClient() { return client; }
export const supabase = client;
export const OFFLINE_MODE = true;
export { sha256Hex };
