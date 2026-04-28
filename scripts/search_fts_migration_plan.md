# Migração da busca: índice estático → Postgres FTS

Plano self-contained para uma nova sessão do Claude Code executar. Você não precisa do contexto da conversa anterior — tudo que importa está aqui.

## Contexto do projeto

- **Repo:** `C:/Mioshie_Sites/caminho_da_felicidade` (site Mioshie Zenshu / Caminho da Felicidade).
- **Stack:** site estático + Supabase (Auth + Postgres + Storage). Bucket de Storage é `teachings`.
- **Conteúdo:** ensinamentos de Meishu-Sama em 4 volumes. Arquivos JSON em `teachings/mioshiec{1..4}/*.json` no Storage. Cada arquivo tem shape:
  ```
  { themes: [ { topics: [ { content_ptbr, content_ja, title_ptbr, title_ja, ... } ] } ] }
  ```
  Existe também um bucket `books` (Discípulos) com JSONs distintos — fora do escopo desta migração inicial.
- **Login:** obrigatório para usar a busca. Auth via `window.supabaseAuth` / `window.supabaseStorageFetch` (helpers no projeto).

## Problema que estamos resolvendo

Hoje a busca depende de 4 arquivos `search_index_mioshiec{1..4}.json` no mesmo bucket, gerados sob demanda pelo botão "⟳ Regenerar Índice" em `admin-supabase.html`. Esses arquivos:

1. Ficam stale toda vez que algum JSON fonte é editado e ninguém clica em "Regenerar".
2. Mesmo regenerados, são cacheados pelo CDN do Supabase Storage (o `cacheControl: '0'` no upload é ignorado pelo CDN), então usuários veem o índice velho por minutos/horas.
3. O índice em memória do cliente (`searchIndex` em `js/search.js`) só recarrega em F5.
4. Os ponteiros `(vol, file, topic_idx)` podem desalinhar quando JSONs são re-subidos com themes/topics reordenados.

**Solução escolhida:** mover a busca para uma tabela Postgres com Full-Text Search (`tsvector` + GIN), populada por webhook do Storage (drift estruturalmente impossível). Storage continua sendo a fonte da verdade dos JSONs — a tabela é só o espelho searchable.

## Arquivos relevantes

| Arquivo | O que tem |
|---|---|
| `js/search.js` | Cliente da busca. Funções principais: `getSearchIndex` (linha ~42), `performSearch` (~717), `openSearchPreview` (~413), `openRandomTeaching` / `openRandomFromVolume` (~211, ~243). |
| `admin-supabase.html` | Painel admin. Lógica do rebuild atual: ~5530-5634 (`rebuildSearchIndex`). Find & Replace: ~5119-5188 (`applyFindReplaceRow`, `applyFindReplaceSelected`, `applyFindReplaceAll`). Edição manual de tópico (aba Relatórios): `_currentEditVol`/`_currentEditFile` (~2228), upload do JSON editado (~2604). Helper `_frUploadJson` (~4910). |
| `js/access.js` | Se existir: lógica de `isLimitedUser` / `getAccessConfig` / `getEnabledVolumes` para permissão por volume. |
| `site_data/section_map.js`, `site_data/global_index_titles.js` | Mapas auxiliares de títulos de seção (continuam válidos após migração — o cliente continua usando). |

## Estrutura final da entrada de índice (referência)

Hoje o índice é array de:
```
{ v: 'mioshiec3', f: 'arquivo_sem_ext', i: 7, t: 'titulo PT', c: 'conteudo PT limpo',
  tj?: 'titulo JA', cj?: 'conteudo JA limpo' }
```
- `i` é o índice **flat** dos topics percorrendo `themes[].topics[]` em ordem.
- A migração precisa preservar essa semântica de `i` para os links do reader (`reader.html?vol=...&file=...&topic=N`) continuarem funcionando.
- Topic é pulado do índice se `content_ptbr/content_pt/content` resulta em texto vazio após strip de HTML, **mas `topicIdx` ainda é incrementado** (ver `admin-supabase.html` ~5594-5605). Replicar essa regra.

## ANTES DE COMEÇAR

Chame `advisor()` com a pergunta:
> Vou migrar a busca de `search_index_*.json` no Storage para Postgres FTS no Supabase. O plano está em `scripts/search_fts_migration_plan.md`. Antes de tocar em código, valide se o design da tabela, da RPC e do webhook está sólido, e aponte armadilhas que eu não considerei (especialmente em torno de: japonês com `pg_trgm`, RLS para usuários limitados, semântica de `topic_idx` ao re-popular, idempotência do seeder).

Não comece a implementar até o advisor responder.

---

## PR 1 — Backend (schema + seeder + webhook)

A busca antiga continua funcionando em paralelo. PR 1 não toca em nada que o usuário final usa.

### 1.1 Schema Postgres

Crie um novo arquivo `scripts/search_fts_schema.sql` com:

```sql
-- Extensions
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists pg_cron;  -- para reconcile noturno (PR 1.5)

-- Configuração de busca PT-BR com unaccent + stemming.
-- Necessário porque unaccent() é STABLE e Postgres rejeita STABLE em GENERATED STORED.
-- A configuração marca unaccent+stem como IMMUTABLE no nível do dicionário, OK.
do $$ begin
  if not exists (select 1 from pg_ts_config where cfgname = 'pt_unaccent') then
    create text search configuration pt_unaccent (copy = portuguese);
    alter text search configuration pt_unaccent
      alter mapping for hword, hword_part, word
      with unaccent, portuguese_stem;
  end if;
end $$;

-- Tabela espelho dos topics indexáveis
create table if not exists teachings_topics (
  vol text not null check (vol ~ '^mioshiec[1-9]$'),
  file text not null,
  topic_idx int not null,
  title_pt text,
  content_pt text,
  title_ja text,
  content_ja text,
  source_updated_at timestamptz,  -- updated_at do objeto no Storage (para reconcile)
  updated_at timestamptz not null default now(),
  tsv_pt tsvector generated always as (
    setweight(to_tsvector('pt_unaccent', coalesce(title_pt,'')), 'A') ||
    setweight(to_tsvector('pt_unaccent', coalesce(content_pt,'')), 'B')
  ) stored,
  primary key (vol, file, topic_idx)
);

create index if not exists idx_tt_tsv_pt on teachings_topics using gin(tsv_pt);
create index if not exists idx_tt_title_ja_trgm on teachings_topics using gin(title_ja gin_trgm_ops);
create index if not exists idx_tt_content_ja_trgm on teachings_topics using gin(content_ja gin_trgm_ops);
create index if not exists idx_tt_vol_file on teachings_topics(vol, file);

-- RLS: leitura para autenticados; permissões por volume/arquivo são aplicadas
-- DENTRO da RPC `search_teachings` lendo `user_permissions` por auth.uid().
-- Manter a policy ampla simplifica `random_teaching` etc; a RPC é o único caminho de leitura.
alter table teachings_topics enable row level security;

drop policy if exists "authenticated read" on teachings_topics;
create policy "authenticated read" on teachings_topics
  for select to authenticated using (true);

-- Apenas service_role escreve (seeder + webhook + reconcile)
drop policy if exists "service write" on teachings_topics;
create policy "service write" on teachings_topics
  for all to service_role using (true) with check (true);
```

E a RPC de busca em `scripts/search_fts_rpc.sql`:

```sql
-- Helper: lista de (vol, file_blocked|null) para o usuário corrente.
-- Se uma row tem file=null significa "volume inteiro bloqueado".
create or replace function _user_blocks()
returns table(volume text, files text[])
language sql stable security definer
set search_path = public
as $$
  select volume, files
  from public.user_permissions
  where user_id = auth.uid();
$$;

revoke all on function _user_blocks() from public;
grant execute on function _user_blocks() to authenticated;

create or replace function search_teachings(
  q text,
  lang text default 'pt',
  max_results int default 50
)
returns table(
  vol text, file text, topic_idx int,
  title_pt text, title_ja text,
  snippet text,
  rank real
)
language sql stable security invoker
as $$
  with
  q_clean as (
    -- Escapa wildcards de LIKE e backslash; normaliza nulos/vazio.
    select coalesce(nullif(trim(q), ''), '<<empty>>') as raw,
           replace(replace(replace(coalesce(q,''), '\', '\\'), '%', '\%'), '_', '\_') as ilike_safe
  ),
  blocks as (
    select volume, files from _user_blocks()
  ),
  fully_blocked as (
    select volume from blocks where files is null
  ),
  ts as (
    select websearch_to_tsquery('pt_unaccent', (select raw from q_clean)) as ts
  )
  select
    t.vol, t.file, t.topic_idx,
    t.title_pt, t.title_ja,
    case
      when lang = 'ja' then
        substring(t.content_ja,
          greatest(1, position(lower((select raw from q_clean)) in lower(coalesce(t.content_ja,''))) - 60),
          180)
      else
        ts_headline('pt_unaccent', coalesce(t.content_pt,''), (select ts from ts),
          'StartSel=<mark class=search-highlight>, StopSel=</mark>, MaxWords=30, MinWords=10, MaxFragments=1')
    end as snippet,
    case
      when lang = 'ja' then
        (case when t.title_ja   ilike '%'||(select ilike_safe from q_clean)||'%' escape '\' then 1.0 else 0 end) +
        (case when t.content_ja ilike '%'||(select ilike_safe from q_clean)||'%' escape '\' then 0.3 else 0 end)
      else
        ts_rank(t.tsv_pt, (select ts from ts))
    end as rank
  from teachings_topics t
  where
    -- Bloqueio server-side: ignora qualquer param de volume vindo do cliente.
    t.vol not in (select volume from fully_blocked)
    and not exists (
      select 1 from blocks b
      where b.volume = t.vol and b.files is not null and t.file = any(b.files)
    )
    and (
      (lang = 'ja' and (
        t.title_ja   ilike '%'||(select ilike_safe from q_clean)||'%' escape '\' or
        t.content_ja ilike '%'||(select ilike_safe from q_clean)||'%' escape '\'
      ))
      or
      (lang <> 'ja' and t.tsv_pt @@ (select ts from ts))
    )
  order by rank desc nulls last
  limit greatest(1, least(max_results, 100));
$$;

revoke all on function search_teachings(text, text, int) from public;
grant execute on function search_teachings(text, text, int) to authenticated;

-- Random teaching (respeitando bloqueios)
create or replace function random_teaching(only_vol text default null)
returns table(vol text, file text, topic_idx int)
language sql stable security invoker
as $$
  with blocks as (select volume, files from _user_blocks()),
       fully_blocked as (select volume from blocks where files is null)
  select t.vol, t.file, t.topic_idx
  from teachings_topics t
  where (only_vol is null or t.vol = only_vol)
    and t.vol not in (select volume from fully_blocked)
    and not exists (
      select 1 from blocks b
      where b.volume = t.vol and b.files is not null and t.file = any(b.files)
    )
  order by random()
  limit 1;
$$;

revoke all on function random_teaching(text) from public;
grant execute on function random_teaching(text) to authenticated;
```

> Rode os dois arquivos no SQL Editor do Supabase. Confirme com o usuário antes de aplicar (operação no banco de produção).

**Por que segurança contra SQL injection é estrutural aqui:**
- RPC chamada via `supabase.rpc(name, { params })` → params vão como JSON e bindam parametrizado, sem concatenação.
- `language sql` (não plpgsql) — sem `EXECUTE`, input nunca vira sintaxe SQL.
- `websearch_to_tsquery` engole operadores quietamente; nunca usar `to_tsquery(q)` direto.
- ILIKE no caminho JA escapa `\`, `%`, `_` antes de concatenar (impede match em tudo via `%`).
- Permissões aplicadas DENTRO da RPC via `auth.uid()` → cliente não consegue pular bloqueio.

### 1.2 Seeder one-shot

Crie `scripts/seed_teachings_topics.mjs` (Node, usa `@supabase/supabase-js` que já está em `package.json`):

- Lê `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do ambiente (NUNCA commitar — peça ao usuário).
- Para cada `vol in ['mioshiec1','mioshiec2','mioshiec3','mioshiec4']`:
  - Lista arquivos do Storage (`storage.from('teachings').list(vol)`).
  - Para cada arquivo: baixa, parseia, percorre `themes[].topics[]` mantendo `topicIdx` flat.
  - Para cada topic, monta `{ vol, file, topic_idx, title_pt, content_pt, title_ja, content_ja }` aplicando a mesma normalização que o rebuild atual usa em `admin-supabase.html` ~5541-5572 (`_idxStripHtml`, `_idxResolveTitle` — copie a lógica).
  - **Pula entradas com `content_pt` vazio mas incrementa `topic_idx`** (igual ao rebuild atual). Isso preserva os links do reader.
  - Faz upsert em batches de 100 linhas com `onConflict: 'vol,file,topic_idx'`.
- Imprime totais por volume — comparados com o **walk dos arquivos no Storage** (não com o índice antigo, que é justamente o que está bugado). Para cada vol: total de arquivos listados, total de topics percorridos, total de rows upserted, total de rows que ficaram com `content_pt` vazio (skipped). Divergência entre estes números requer revisão manual, NUNCA auto-aborto.
- Idempotente: rodar 2x produz o mesmo estado.

Após escrever o script, **chame advisor()** antes de rodá-lo em produção:
> Tenho o seeder em `scripts/seed_teachings_topics.mjs` pronto. Faça uma revisão estática focada em: idempotência, paridade da semântica de `topic_idx` com o rebuild atual em `admin-supabase.html` ~5541-5605, tratamento de erros (continuar em caso de JSON malformado), e segurança (não vazar service role).

### 1.3 Webhook do Storage → Edge Function

Crie `supabase/functions/sync-teaching-topic/index.ts`:

- Edge Function que recebe payload do Storage webhook (`INSERT`, `UPDATE`, `DELETE`).
- Filtra: só processa `bucket = 'teachings'` e `name` matching `^mioshiec[1-9]/.+\.json$`.
- Para `INSERT/UPDATE`: baixa o JSON, repete a lógica do seeder para um único arquivo, faz `delete from teachings_topics where vol=$1 and file=$2` seguido de `insert` em batch (transação) — assim removidos viram delete e renomeados ficam consistentes. Salva `source_updated_at = storage.objects.updated_at` em cada row para o reconcile poder detectar atrasos.
- Para `DELETE`: `delete from teachings_topics where vol=$1 and file=$2`.
- Use service role via env (Edge Functions têm acesso seguro).

**IMPORTANTE — paridade com seeder:** as funções `_idxStripHtml` e `_idxResolveTitle` (em `admin-supabase.html` ~5541-5572) precisam estar **idênticas** no seeder e na Edge Function. Extraia para um módulo compartilhado (`scripts/_topic_normalize.mjs` para o seeder + cópia exata em TS dentro da função, ou um arquivo `.ts` único importado por ambos via deno deploy). Divergência = drift a cada edição.

Configure o webhook no painel Supabase: Storage → Webhooks → Add → bucket `teachings`, eventos: object created/updated/deleted, target: a função.

**Não pule o teste:** edite um JSON pelo painel do Supabase e confirme que a tabela atualiza em segundos.

### 1.3b Reconcile noturno (defesa em profundidade)

Webhooks são best-effort: cold starts, blips de rede e erros silenciosos podem deixar a tabela atrasada. Adicione um job `pg_cron` que chama uma RPC `reconcile_teachings_topics()` que:

1. Lista objetos do bucket `teachings/mioshiec*` via `storage.objects` (já é uma tabela exposta a `service_role`).
2. Para cada objeto cujo `updated_at > coalesce(max(t.source_updated_at), 'epoch')` para aquele `(vol, file)`, dispara a Edge Function `sync-teaching-topic` (via `pg_net.http_post`) ou re-baixa e re-popula direto da função SQL.
3. Apaga rows órfãs (vol/file que não existe mais no Storage).

Schedule: `select cron.schedule('reconcile-teachings', '0 4 * * *', $$ select reconcile_teachings_topics(); $$);` (4h da manhã, baixo tráfego).

**Sem isso, "drift estruturalmente impossível" é hype.** Com isso, é verdade: pior caso o índice fica até 24h atrás, mas converge sozinho.

### 1.4 Validação do PR 1

Antes de declarar PR 1 pronto:

1. Rode `select count(*), vol from teachings_topics group by vol;` e compare com o **número de arquivos × topics médio caminhando o Storage** (não contra o índice antigo). Use o output do seeder para a referência.
2. Faça 5 buscas de teste via SQL: `select * from search_teachings('johrei', 'pt');`, idem para palavras conhecidas em japonês. Verifique que retorna resultados, snippet vem com `<mark>`, ranking faz sentido.
3. Faça uma edição via webhook (renomeie um JSON, ou edite um campo) e confirme que a tabela reflete em <30s.
4. Teste o `pg_cron` manualmente: `select reconcile_teachings_topics();` — deve ser no-op se webhook está em dia.
5. Teste como usuário limitado: faça login com um usuário que tem `user_permissions` para um volume bloqueado e rode `search_teachings('algo', 'pt')` — não deve retornar resultados desse volume. Esse é o teste mais importante de segurança.

**Chame advisor() de novo:**
> PR 1 está implementado e testado. Resultados: [colar contagens, exemplos de busca, teste de webhook]. Estou pronto para o PR 2 (cliente + hooks de save). Algum risco no cutover?

---

## PR 2 — Frontend + saves + cutover

### 2.1 Trocar o cliente em `js/search.js`

Substituir `getSearchIndex` + `performSearch` por chamadas à RPC. Pontos a preservar:

- Filtro por volume para `isLimitedUser`: passe `vols` array para a RPC com base em `getEnabledVolumes(getAccessConfig())`.
- Toggle "exact match": traduzir para `phraseto_tsquery` em vez de `websearch_to_tsquery` quando ativo (ou ajustar a RPC para aceitar um param `exact bool`).
- Suporte a múltiplos termos separados por `&`: `websearch_to_tsquery` já aceita `term1 AND term2` na sintaxe — converter `a & b` para `a AND b` antes de mandar.
- Manter `_allResults` / `_displayedCount` / paginação local (a RPC já limita a 50; cliente pagina os 50 em chunks de 10 como hoje).
- Preservar `escHtml`, lógica do `_renderResultItem` (snippet já vem com `<mark>`, então **não re-escapar** os `<mark>` retornados — mas escapar o resto). Cuidado com XSS: o `ts_headline` retorna texto mas o `content_pt` original pode ter aspas etc. Use uma whitelist: substitua `<mark class=search-highlight>` e `</mark>` por placeholders, escape, depois re-substitua.
- `openRandomTeaching` e `openRandomFromVolume`: usar uma RPC nova `random_teaching(vols text[])` ou um `select ... order by random() limit 1` simples. NÃO baixar o índice inteiro só pra escolher um aleatório.

### 2.2 Saves no admin-supabase.html

Como o webhook do PR 1 já cobre tudo, **idealmente o admin não precisa de mudança**. Mas valide:

1. Após uma rodada do botão "Aplicar todas" em Buscar & Substituir, confirme que a tabela `teachings_topics` reflete em <30s (webhook fired).
2. Após salvar uma edição manual de tópico (fluxo Relatórios, ~2604), idem.

Se houver delay perceptível ou inconsistência, adicione um upsert otimista no cliente logo após `_frUploadJson`: ler o JSON novo do Storage e popular as linhas via RPC (criar `upsert_teaching_file(vol, file, json)` no banco). Mas só faça isso se necessário — duplicação de lógica é dívida.

### 2.3 Remover o velho

- Remover botão "⟳ Regenerar Índice de Busca" da UI (~954-968 em `admin-supabase.html`).
- Remover função `rebuildSearchIndex` e helpers `_idxStripHtml` / `_idxResolveTitle` se não forem usados em outro lugar.
- Apagar `search_index_mioshiec{1..4}.json` do bucket `teachings`.
- Remover loading dinâmico de `section_map.js` / `global_index_titles.js` se não for mais necessário (verificar — eles ainda são usados pelo `_renderResultItem` para breadcrumb).

### 2.4 Validação final

Antes de fazer commit do PR 2:

1. Buscar 10 termos diferentes em PT, comparar resultados com a busca antiga (ainda em paralelo se possível). Diferenças aceitáveis: ranking levemente diferente. Inaceitáveis: resultado faltando ou link quebrado.
2. Buscar 5 termos em japonês.
3. Testar como usuário limitado (volume bloqueado): confirmar que ele NÃO vê resultados do volume bloqueado.
4. Testar `openRandomTeaching` e `openRandomFromVolume`.
5. Testar preview modal abrindo (que usa `supabaseStorageFetch` direto no JSON — não muda).

**Chame advisor()** com proof:
> PR 2 implementado. Validação: [resultados de cada teste]. Pronto para apagar os `search_index_*.json` e mergear?

Só apague os arquivos antigos do Storage **depois** do advisor confirmar.

---

## Checkpoints obrigatórios de advisor

1. **Antes de qualquer código:** validar o design (SQL, RPC, webhook).
2. **Após escrever o seeder, antes de rodar em prod:** revisão estática.
3. **Após PR 1 implementado e testado:** confirmação para seguir para PR 2.
4. **Antes de apagar os índices estáticos:** confirmação de que o cutover está sólido.

## O que NÃO mudar

- Os JSONs em `mioshiec{1..4}/*.json` continuam sendo a fonte da verdade. Não migrar conteúdo para o banco.
- O reader (`reader.html` + `js/reader.js`) continua lendo direto do Storage. Não tocar.
- `site_data/section_map.js` e `site_data/global_index_titles.js`: continuam sendo usados pelo cliente para breadcrumb.
- Permissão por volume continua expressa em `js/access.js` (metadata do user). RLS não substitui isso porque o filtro hoje também limita download e UI — RLS só seria mais um layer.

## Convenções deste repo

- Commits em português, formato dos commits recentes (rode `git log --oneline -10`).
- Não criar arquivos `.md` extras nem README sem necessidade.
- Não rodar `git push` sem confirmação do usuário.
- Ler `CLAUDE.md` na raiz se existir antes de começar.
