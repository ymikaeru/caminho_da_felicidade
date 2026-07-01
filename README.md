# Caminho da Felicidade — Mioshie College

Site estático para leitura, busca e estudo dos ensinamentos de Meishu-Sama (japonês + português-BR).
Hospedado no **GitHub Pages** e servido em produção em `https://www.cmu.org.br/caminho_da_felicidade/`.

> 📐 **Para entender como o projeto é montado, leia [ARCHITECTURE.md](ARCHITECTURE.md).**
> Este README é só o quickstart; o ARCHITECTURE.md é a referência completa (frontend, backend Supabase, pipeline de dados, admin).

---

## Estrutura (resumo)

```
caminho_da_felicidade/
├── *.html                  # Páginas (index, reader, poesia, destaques, admin-supabase, …)
├── mioshiec1..4/index.html # Índices de volume pré-renderizados
├── css/
│   ├── styles.css          # Fonte; edite aqui → build:css gera styles.min.css
│   ├── admin.css           # CSS do painel admin
│   └── modules/            # Módulos CSS (@import em styles.css)
├── js/                     # ~60 módulos (reader, search, highlights, sync, admin/, …)
├── site_data/              # Índices de navegação/título, taxonomias (commitados)
├── data/                   # Poesia, livros de discípulos, índices auxiliares
├── scripts/                # Pipeline: storage sync, build de índices, retradução, export
├── supabase/               # migrations/ + functions/ (Edge, Deno)
├── sw.js, manifest.json    # PWA (service worker = só Web Push)
└── package.json
```

---

## Backend

Todo o dinâmico fica no **Supabase** (projeto `succhmnbajvbpmoqrktq`):

- **Auth** (email/senha, roles admin/user) — a anon key no JS é pública por design; a segurança é RLS.
- **Postgres** — 71 migrations, RLS, ~50 RPCs.
- **Storage** — bucket `teachings` é a **fonte da verdade do conteúdo** dos ensinamentos (JSON). O leitor busca direto do Storage; há um espelho local editável em `.local-edits/` (gitignored).
- **Edge Functions** — busca semântica (Voyage AI), retradução (Gemini), Web Push, sync Storage→banco.

Detalhes em [ARCHITECTURE.md](ARCHITECTURE.md) §3–4.

---

## Build

```bash
npm install

npm run build:css        # css/styles.css → styles.min.css (PostCSS + cssnano)
npm run build:admin-css  # css/admin.css → admin.min.css
npm run build:js         # minifica os 5 JS grandes (playlists, highlights, disciples-reader, reader-render, search)
npm run build            # os três acima
npm run versions         # alinha/incrementa ?v=N (cache-bust) nos HTML
```

⚠️ **Ao editar um dos 5 JS minificados, rode `build:js` — senão o `.min.js` servido não muda.**
⚠️ **Ao editar qualquer JS/CSS compartilhado, faça o bump de `?v=N`** (`node scripts/bump-versions.mjs bump <asset>`) para evitar cache dividido entre páginas.

## Dados (Storage)

```bash
npm run storage:pull                 # baixa o bucket → .local-edits/ (espelho)
npm run storage:status               # o que mudou localmente
npm run storage:push -- --confirm    # sobe as mudanças (dry-run sem --confirm)
```

⚠️ **`storage:push` atualiza só o bucket, não as tabelas do banco** (a busca `teachings_topics` depende do webhook `sync-teaching-topic`). Ver [ARCHITECTURE.md](ARCHITECTURE.md) §4.3.

---

## Deploy

O site é servido da raiz da branch `main` (GitHub Pages). **Push para `main` publica.**
Configuração em **Settings → Pages** apontando para `main` / raiz.
