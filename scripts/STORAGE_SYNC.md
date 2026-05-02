# Sincronização local ↔ Supabase Storage

Espelha o bucket `teachings` localmente em `.local-edits/teachings/` (gitignored)
para edição em massa de muitos arquivos com o seu editor preferido.

## Setup (uma vez)

Crie um arquivo `.env.local` na raiz do repo (já está no `.gitignore`):

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
```

A `SERVICE_ROLE_KEY` está no Supabase Studio → **Project Settings** → **API** →
**service_role** (Reveal). **Não commite isso.** Ela bypassa RLS.

## Fluxo de trabalho

```bash
# 1. Baixa tudo do bucket pra .local-edits/teachings/
npm run storage:pull

# (Edita à vontade no VS Code, sed, jq, scripts, etc.)

# 2. Vê o que mudou
npm run storage:status

# 3. Dry-run (não sobe nada — só mostra o plano)
npm run storage:push

# 4. Sobe de verdade
npm run storage:push -- --confirm
```

## Filtros

Todos os scripts aceitam `--prefix` para limitar a um volume ou pasta:

```bash
npm run storage:pull -- --prefix=mioshiec1
npm run storage:pull -- --prefix=mioshiec1,mioshiec2
npm run storage:status -- --prefix=mioshiec1
npm run storage:push -- --prefix=mioshiec1 --confirm
```

`storage:pull` aceita também `--only-json` para ignorar `.js`/outros (útil se
você só edita ensinamentos e não quer baixar `section_map.js`/`search_index_*.json`).

## Apagar arquivos

Por padrão `storage:push` **NUNCA** apaga remoto, mesmo se você deletar
arquivos local. Para apagar:

```bash
npm run storage:push -- --confirm --delete-missing
```

## Como funciona a detecção de mudanças

O `storage-pull` grava `.local-edits/.manifest.json` com SHA-256 de cada
arquivo baixado. O `storage-push` recalcula o SHA local de cada arquivo e
sobe **apenas os que mudaram** desde o último pull. Isso evita uploads
desnecessários e atualiza o manifest após o push.

**Limitação:** se alguém alterar um arquivo no Storage (via admin web)
**depois** do seu pull, o push não detecta — a comparação é local-vs-manifest,
não local-vs-remoto. Para garantir, faça `npm run storage:pull` antes de
começar a editar.

## Estrutura local

```
.local-edits/                    ← gitignored
├── .manifest.json               ← SHA-256 + timestamp do último pull/push
└── teachings/                   ← espelho do bucket
    ├── mioshiec1/*.html.json
    ├── mioshiec2/*.html.json
    ├── mioshiec3/*.html.json
    ├── mioshiec4/*.html.json
    ├── books/*.json
    └── section_map.js
```
