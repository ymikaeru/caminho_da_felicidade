-- ============================================================
-- Migração — Rótulos de navegação (nav_title / section) indexáveis
-- ============================================================
-- Cole no SQL Editor do Supabase. Idempotente.
-- Pré-requisitos: search_fts_schema.sql + search_fts_rpc.sql aplicados.
--
-- Motivação: os JSONs em Storage têm títulos doutrinários (ex.: "Os
-- Espíritos Antepassados e a Preparação para o Pós-Morte"), enquanto
-- os cards de navegação em mioshiec{N}/index.html (curados em
-- site_data/section_map.js) usam rótulos populares (ex.: "O Instante
-- da Morte"). A busca não conseguia encontrar o segundo. Esta migração
-- adiciona as colunas necessárias para que ambos sejam pesquisáveis.
--
-- Convenção: as 4 colunas novas são file-level — gravamos APENAS em
-- topic_idx=0 (uma vez por arquivo). Isso garante que um termo casado
-- por nav/section retorne 1 row por arquivo, não N (uma por tópico).
-- ============================================================

-- ---------------------------------------------------------------
-- Colunas novas — populadas apenas em topic_idx=0 (file-level)
-- ---------------------------------------------------------------
alter table teachings_topics
  add column if not exists nav_title_pt text;
alter table teachings_topics
  add column if not exists nav_title_ja text;
alter table teachings_topics
  add column if not exists section_pt text;
alter table teachings_topics
  add column if not exists section_ja text;

-- ---------------------------------------------------------------
-- Recria tsv_pt para incluir nav_title_pt + section_pt.
-- tsv_pt é generated stored — Postgres não permite ALTER da expressão,
-- precisa DROP + ADD. Drop também derruba idx_tt_tsv_pt; recriado abaixo.
-- ---------------------------------------------------------------
alter table teachings_topics drop column if exists tsv_pt;

alter table teachings_topics
  add column tsv_pt tsvector generated always as (
    setweight(to_tsvector('pt_unaccent', coalesce(nav_title_pt, '')), 'A') ||
    setweight(to_tsvector('pt_unaccent', coalesce(title_pt, '')),     'A') ||
    setweight(to_tsvector('pt_unaccent', coalesce(section_pt, '')),   'C') ||
    setweight(to_tsvector('pt_unaccent', coalesce(content_pt, '')),   'B')
  ) stored;

create index if not exists idx_tt_tsv_pt
  on teachings_topics using gin(tsv_pt);

-- ---------------------------------------------------------------
-- Trigram indexes para o caminho JA (ILIKE / word_similarity em
-- nav_title_ja / section_ja). Mesmo padrão dos índices em title_ja.
-- ---------------------------------------------------------------
create index if not exists idx_tt_nav_title_ja_trgm
  on teachings_topics using gin(nav_title_ja gin_trgm_ops);

create index if not exists idx_tt_section_ja_trgm
  on teachings_topics using gin(section_ja gin_trgm_ops);

-- ---------------------------------------------------------------
-- Sanity check
-- ---------------------------------------------------------------
-- select count(*) from teachings_topics where nav_title_pt is not null;
-- -- esperado: ~250 (1 por arquivo de mioshiec1..4) após rodar o seeder.
