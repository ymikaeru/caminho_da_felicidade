#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Servidor local do Caminho da Felicidade (modo offline).

So usa a biblioteca padrao do Python 3 - nao precisa instalar nada.
Uso:  python servidor.py [porta]      (padrao: 8000)

Faz duas coisas:
  1. Entrega os arquivos do site (como "python -m http.server"), forcando o
     tipo correto de .js/.json e pedindo ao navegador que revalide o cache.
  2. Se o pacote tiver a pasta _dados/ (contas dos membros), oferece login
     por conta e guarda grifos, salvos e lidos de cada pessoa NESTA maquina:
        _dados/contas.json      contas (nunca e entregue pela rede)
        _dados/nuvem/<id>.json  copia do que cada um tinha no site online
        _dados/local/<id>.json  o que foi feito aqui, offline (nao sobe)
"""
import hashlib
import hmac
import http.server
import json
import os
import secrets
import socket
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

DADOS = os.path.join(ROOT, '_dados')
CONTAS_FILE = os.path.join(DADOS, 'contas.json')
NUVEM = os.path.join(DADOS, 'nuvem')
LOCAL = os.path.join(DADOS, 'local')
TOKEN_DAYS = 60
MAX_BODY = 4 * 1024 * 1024

# Chave natural de cada tabela (sem o user_id): identifica "a mesma linha"
# entre a copia da nuvem e o que foi alterado aqui.
TABLES = {
    'user_highlights': ('volume', 'file', 'topic_id', 'start_char', 'end_char'),
    'synced_favorites': ('volume', 'file', 'topic_index'),
    'favorite_folders': ('id',),
    'read_marks': ('volume', 'file', 'topic_index'),
    'reading_positions': ('volume', 'file'),
}

_lock = threading.Lock()
_fails = {}          # ip -> [timestamps de tentativas erradas]


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def read_json(path, default):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def load_contas():
    return read_json(CONTAS_FILE, {})


def get_secret():
    path = os.path.join(LOCAL, 'segredo.txt')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            s = f.read().strip()
            if s:
                return s
    except OSError:
        pass
    s = secrets.token_hex(32)
    os.makedirs(LOCAL, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(s)
    return s


# ---------------------------------------------------------------- sessao
def make_token(uid):
    exp = str(int(time.time()) + TOKEN_DAYS * 86400)
    sig = hmac.new(SECRET.encode(), (uid + '.' + exp).encode(), hashlib.sha256).hexdigest()
    return '%s.%s.%s' % (uid, exp, sig)


def check_token(token):
    try:
        uid, exp, sig = str(token).split('.')
        good = hmac.new(SECRET.encode(), (uid + '.' + exp).encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(sig, good) and int(exp) > time.time():
            return uid
    except (ValueError, AttributeError):
        pass
    return None


def fake_salt(email):
    # Email desconhecido recebe um sal estavel e plausivel, para a resposta
    # nao revelar quais emails tem conta.
    alphabet = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    digest = hmac.new(SECRET.encode(), email.encode(), hashlib.sha256).digest()
    return '$2a$10$' + ''.join(alphabet[b % 64] for b in digest[:22])


# ---------------------------------------------------------------- dados
def row_key(table, row):
    return '|'.join(str(row.get(c)) for c in TABLES[table])


def load_rows(uid, table):
    """Linhas efetivas = copia da nuvem + alteracoes locais - remocoes locais."""
    cloud = read_json(os.path.join(NUVEM, uid + '.json'), {}).get(table, [])
    local = read_json(os.path.join(LOCAL, uid + '.json'), {}).get(table, {})
    up, gone = local.get('up', {}), set(local.get('del', []))
    out, seen = [], set()
    for row in cloud:
        k = row_key(table, row)
        if k in gone or k in seen:
            continue
        seen.add(k)
        out.append(dict(up[k]) if k in up else dict(row))
    for k, row in up.items():
        if k not in seen and k not in gone:
            out.append(dict(row))
    return out


def save_changes(uid, table, upserts, deletes):
    path = os.path.join(LOCAL, uid + '.json')
    data = read_json(path, {})
    t = data.setdefault(table, {})
    up, gone = t.setdefault('up', {}), set(t.get('del', []))
    for row in upserts:
        k = row_key(table, row)
        up[k] = row
        gone.discard(k)
    for row in deletes:
        k = row_key(table, row)
        up.pop(k, None)
        gone.add(k)
    t['del'] = sorted(gone)
    write_json(path, data)


def _eq(a, b):
    return a == b or (a is not None and b is not None and str(a) == str(b))


def _cmp(op):
    def f(v, x):
        if v is None:
            return False
        try:
            return op(v, x)
        except TypeError:
            return op(str(v), str(x))
    return f


OPS = {
    'eq': _eq,
    'neq': lambda v, x: not _eq(v, x),
    'gt': _cmp(lambda a, b: a > b),
    'gte': _cmp(lambda a, b: a >= b),
    'lt': _cmp(lambda a, b: a < b),
    'lte': _cmp(lambda a, b: a <= b),
    'in': lambda v, x: isinstance(x, list) and any(_eq(v, i) for i in x),
    'is': lambda v, x: v is None if x is None else v == x,
}


def _sort_key(col):
    def key(row):
        v = row.get(col)
        return (v is None, v if isinstance(v, (int, float)) and not isinstance(v, bool) else str(v))
    return key


def shape(q, rows, count=None):
    out = {'error': None}
    if (q.get('opts') or {}).get('count'):
        out['count'] = len(rows) if count is None else count
    mode = q.get('mode')
    if mode == 'single':
        if len(rows) == 1:
            out['data'] = rows[0]
        else:
            out['data'] = None
            out['error'] = {'code': 'PGRST116', 'message': 'JSON object requested, multiple (or no) rows returned'}
    elif mode == 'maybe':
        out['data'] = rows[0] if rows else None
    else:
        out['data'] = rows
    return out


def run_query(uid, q):
    table = q.get('table')
    if table not in TABLES:
        return {'data': None, 'error': {'message': 'Tabela indisponivel no modo offline', 'code': 'OFFLINE'}}
    op = q.get('op', 'select')
    opts = q.get('opts') or {}
    filters = [f for f in (q.get('filters') or []) if f[0] != 'user_id']
    rows = load_rows(uid, table)

    def match(row):
        return all(OPS.get(f[1], _eq)(row.get(f[0]), f[2]) for f in filters)

    now = now_iso()

    if op == 'select':
        res = [r for r in rows if match(r)]
        total = len(res)
        for col, asc in reversed(q.get('orders') or []):
            res.sort(key=_sort_key(col), reverse=not asc)
        if q.get('from') is not None:
            to = q.get('to')
            res = res[q['from']:(to + 1 if to is not None else None)]
        if q.get('lim') is not None:
            res = res[:q['lim']]
        if opts.get('head'):
            return {'data': None, 'error': None, 'count': total}
        return shape(q, res, total)

    if op in ('insert', 'upsert'):
        payload = q.get('payload')
        items = payload if isinstance(payload, list) else [payload]
        keys = None
        if op == 'upsert':
            keys = [k.strip() for k in str(opts.get('onConflict') or 'id').split(',') if k.strip() and k.strip() != 'user_id']
        touched = []
        for item in items:
            if not isinstance(item, dict):
                continue
            item = dict(item)
            item['user_id'] = uid
            ex = None
            if keys and all(k in item for k in keys):
                ex = next((r for r in rows if all(_eq(r.get(k), item[k]) for k in keys)), None)
            if ex is not None:
                ex.update(item)
                ex['updated_at'] = item.get('updated_at') or now
                touched.append(ex)
            else:
                row = {'id': str(uuid.uuid4()), 'created_at': now, 'updated_at': now}
                row.update(item)
                rows.append(row)
                touched.append(row)
        save_changes(uid, table, touched, [])
        return shape(q, touched) if q.get('returning') else {'data': None, 'error': None}

    if op == 'update':
        payload = q.get('payload') or {}
        payload.pop('user_id', None)
        touched = [r for r in rows if match(r)]
        olds = [dict(r) for r in touched]
        for r in touched:
            r.update(payload)
            r['updated_at'] = payload.get('updated_at') or now
        # se a chave natural mudou, a linha antiga some
        moved = [o for o, n in zip(olds, touched) if row_key(table, o) != row_key(table, n)]
        save_changes(uid, table, [], moved)
        save_changes(uid, table, touched, [])
        out = shape(q, touched) if q.get('returning') else {'data': None, 'error': None}
        if opts.get('count'):
            out['count'] = len(touched)
        return out

    if op == 'delete':
        gone = [r for r in rows if match(r)]
        save_changes(uid, table, [], gone)
        out = shape(q, gone) if q.get('returning') else {'data': None, 'error': None}
        if opts.get('count'):
            out['count'] = len(gone)
        return out

    return {'data': None, 'error': {'message': 'Operacao desconhecida'}}


def run_rpc(uid, name, args):
    if name not in ('register_reading', 'undo_reading'):
        return {'data': None, 'error': {'message': 'Indisponivel no modo offline', 'code': 'OFFLINE'}}
    rows = load_rows(uid, 'read_marks')
    probe = {'volume': args.get('p_volume'), 'file': args.get('p_file'), 'topic_index': args.get('p_topic_index')}
    key = row_key('read_marks', probe)
    row = next((r for r in rows if row_key('read_marks', r) == key), None)
    now = now_iso()
    if name == 'register_reading':
        if row:
            row['times_read'] = int(row.get('times_read') or 1) + 1
            row['last_read_at'] = now
        else:
            row = dict(probe, id=str(uuid.uuid4()), user_id=uid, topic_title=args.get('p_topic_title'),
                       created_at=now, times_read=1, last_read_at=now)
        save_changes(uid, 'read_marks', [row], [])
        return {'data': row['times_read'], 'error': None}
    if not row:
        return {'data': 0, 'error': None}
    n = int(row.get('times_read') or 1) - 1
    if n <= 0:
        save_changes(uid, 'read_marks', [], [row])
        return {'data': 0, 'error': None}
    row['times_read'] = n
    save_changes(uid, 'read_marks', [row], [])
    return {'data': n, 'error': None}


# ---------------------------------------------------------------- http
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.webmanifest': 'application/manifest+json',
    })

    def end_headers(self):
        # no-store (e nao no-cache): a revalidacao por data falha quando um
        # arquivo e trocado por outro com data mais ANTIGA (acontece ao
        # regerar o pacote) e o navegador ficaria preso na versao velha.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _private(self):
        # Contas, dados pessoais e o historico do git nunca saem pela rede.
        p = self.path.split('?', 1)[0].replace('\\', '/').lower()
        p = '/' + p.lstrip('/')
        return p.startswith('/_dados') or p.startswith('/.git') or p == '/servidor.py'

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?', 1)[0] == '/api/status':
            return self.send_json({'servidor': True, 'contas': bool(CONTAS)})
        if self._private():
            return self.send_error(404, 'File not found')
        # Nunca responder "304 nao mudou": ver o comentario em end_headers.
        del self.headers['If-Modified-Since']
        del self.headers['If-None-Match']
        return super().do_GET()

    def do_HEAD(self):
        if self._private():
            return self.send_error(404, 'File not found')
        return super().do_HEAD()

    def do_POST(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_BODY:
            return self.send_json({'error': {'message': 'Pedido grande demais'}}, 413)
        raw = self.rfile.read(length) if length else b''
        path = self.path.split('?', 1)[0]
        if not path.startswith('/api/'):
            # O site tenta registrar estatisticas; offline nao ha para onde mandar.
            self.send_response(204)
            self.end_headers()
            return
        try:
            body = json.loads(raw.decode('utf-8') or '{}')
        except ValueError:
            return self.send_json({'error': {'message': 'JSON invalido'}}, 400)
        try:
            self.api(path, body)
        except Exception as e:      # nunca derruba o servidor por um pedido ruim
            self.send_json({'data': None, 'error': {'message': 'Erro interno: %s' % e}}, 500)

    def api(self, path, body):
        ip = self.client_address[0]
        if path == '/api/salt':
            email = str(body.get('email') or '').strip().lower()
            acc = CONTAS.get(email)
            return self.send_json({'salt': acc['hash'][:29] if acc else fake_salt(email)})

        if path == '/api/login':
            recent = [t for t in _fails.get(ip, []) if time.time() - t < 600]
            if len(recent) >= 10:
                return self.send_json({'error': {'message': 'Muitas tentativas. Aguarde alguns minutos.'}}, 429)
            email = str(body.get('email') or '').strip().lower()
            proof = str(body.get('proof') or '')
            acc = CONTAS.get(email)
            ok = bool(acc) and hmac.compare_digest(proof.encode(), acc['hash'].encode())
            if not ok:
                _fails[ip] = recent + [time.time()]
                time.sleep(0.8)
                return self.send_json({'error': {'message': 'Invalid login credentials'}}, 400)
            _fails.pop(ip, None)
            return self.send_json({
                'token': make_token(acc['id']),
                'user': {'id': acc['id'], 'email': email, 'role': acc.get('role') or 'member',
                         'preferred_lang': acc.get('lang'), 'name': acc.get('name') or ''},
                'perms': acc.get('perms') or [],
            })

        uid = check_token(body.get('token'))
        if not uid:
            return self.send_json({'data': None, 'error': {'message': 'Sessao expirada', 'code': 'AUTH'}}, 401)
        with _lock:
            if path == '/api/db':
                return self.send_json(run_query(uid, body.get('q') or {}))
            if path == '/api/rpc':
                return self.send_json(run_rpc(uid, body.get('name'), body.get('args') or {}))
        return self.send_json({'error': {'message': 'Nao encontrado'}}, 404)

    def log_message(self, fmt, *args):
        pass  # silencioso: a janela mostra so o endereco


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))   # nao envia nada; so descobre a interface
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


CONTAS = load_contas()
SECRET = get_secret() if CONTAS else secrets.token_hex(32)

if __name__ == '__main__':
    server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    ip = lan_ip()
    print('=' * 60)
    print('  CAMINHO DA FELICIDADE - modo offline')
    print('=' * 60)
    print()
    print('  Neste computador:      http://localhost:%d' % PORT)
    if ip and not ip.startswith('127.'):
        print('  Outros aparelhos')
        print('  na mesma rede/Wi-Fi:   http://%s:%d' % (ip, PORT))
    print()
    if CONTAS:
        print('  Login: email e senha de cada membro (%d contas).' % len(CONTAS))
        print('  O que for grifado ou salvo aqui fica nesta maquina.')
        print()
    print('  Para encerrar, feche esta janela (ou Ctrl+C).')
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
