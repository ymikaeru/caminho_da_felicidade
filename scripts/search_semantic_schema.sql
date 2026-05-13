-- ============================================================
-- Mioshie Zenshu — Semantic search (pgvector + Voyage embeddings)
-- ============================================================
-- Adiciona busca semântica à infraestrutura FTS existente.
-- Embeddings são gerados pelo Voyage AI (voyage-3, 1024 dim,
-- multilíngue PT+JA).
--
-- Pré-requisitos: search_fts_schema.sql + search_fts_rpc.sql aplicados.
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================

create extension if not exists vector;

-- ------------------------------------------------------------
-- Coluna de embedding
-- ------------------------------------------------------------
-- voyage-3 retorna vetor de 1024 dimensões.
-- Multilíngue: um único embedding cobre PT + JA do mesmo tópico
-- (input do embedder é "title_pt\n\ncontent_pt\n\ntitle_ja\n\ncontent_ja").
alter table teachings_topics
  add column if not exists embedding vector(1024);

alter table teachings_topics
  add column if not exists embedding_updated_at timestamptz;

-- Índice HNSW pra cosine distance. Parâmetros default são bons
-- para ~17k rows; aumentar m se recall ficar baixo.
create index if not exists idx_tt_embedding_hnsw
  on teachings_topics using hnsw (embedding vector_cosine_ops);

comment on column teachings_topics.embedding is
  'Vetor 1024-dim do Voyage AI voyage-3, multilíngue. Input combina '
  'title_pt + content_pt + title_ja + content_ja. NULL = ainda não embeddado.';
