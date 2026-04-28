-- ============================================================
-- Mioshie Zenshu — Search FTS Schema
-- ============================================================
-- Cria a tabela `teachings_topics` (espelho searchable dos JSONs em Storage),
-- a configuração de busca PT-BR com unaccent + stemming, índices GIN, e RLS.
-- Ler em conjunto com search_fts_rpc.sql.
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================

-- Extensions
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------------------------------------------------
-- Configuração de busca PT-BR com unaccent + portuguese_stem.
-- Necessário porque unaccent() é STABLE; Postgres rejeita STABLE
-- em colunas GENERATED STORED. A configuração marca o pipeline
-- inteiro como IMMUTABLE no nível do dicionário.
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'pt_unaccent') then
    create text search configuration pt_unaccent (copy = portuguese);
    alter text search configuration pt_unaccent
      alter mapping for hword, hword_part, word
      with unaccent, portuguese_stem;
  end if;
end $$;

-- ------------------------------------------------------------
-- Tabela espelho dos topics indexáveis
-- ------------------------------------------------------------
create table if not exists teachings_topics (
  vol text not null check (vol ~ '^mioshiec[1-9]$'),
  file text not null,
  topic_idx int not null,
  title_pt text,
  content_pt text,
  title_ja text,
  content_ja text,
  -- updated_at do objeto no Storage; usado pelo reconcile noturno
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  tsv_pt tsvector generated always as (
    setweight(to_tsvector('pt_unaccent', coalesce(title_pt, '')), 'A') ||
    setweight(to_tsvector('pt_unaccent', coalesce(content_pt, '')), 'B')
  ) stored,
  primary key (vol, file, topic_idx)
);

-- Índices
create index if not exists idx_tt_tsv_pt
  on teachings_topics using gin(tsv_pt);

create index if not exists idx_tt_title_ja_trgm
  on teachings_topics using gin(title_ja gin_trgm_ops);

create index if not exists idx_tt_content_ja_trgm
  on teachings_topics using gin(content_ja gin_trgm_ops);

create index if not exists idx_tt_vol_file
  on teachings_topics(vol, file);

-- ------------------------------------------------------------
-- RLS
--
-- Leitura: qualquer usuário autenticado (a RPC search_teachings
-- aplica o filtro por user_permissions internamente).
--
-- Escrita: apenas service_role (seeder + webhook + reconcile).
-- ------------------------------------------------------------
alter table teachings_topics enable row level security;

drop policy if exists "tt_authenticated_read" on teachings_topics;
create policy "tt_authenticated_read"
  on teachings_topics
  for select
  to authenticated
  using (true);

drop policy if exists "tt_service_write" on teachings_topics;
create policy "tt_service_write"
  on teachings_topics
  for all
  to service_role
  using (true)
  with check (true);

-- ------------------------------------------------------------
-- Comentários para documentação
-- ------------------------------------------------------------
comment on table teachings_topics is
  'Espelho searchable dos JSONs em storage://teachings/mioshiecN/*.json. '
  'Populado pelo seeder one-shot e mantido por webhook do Storage + reconcile pg_cron.';

comment on column teachings_topics.topic_idx is
  'Índice flat dos topics percorrendo themes[].topics[] em ordem. '
  'Topics com content_pt vazio são pulados mas topic_idx ainda é incrementado, '
  'para preservar links do reader (reader.html?topic=N).';

comment on column teachings_topics.source_updated_at is
  'updated_at do objeto correspondente em storage.objects. Usado pelo reconcile.';
