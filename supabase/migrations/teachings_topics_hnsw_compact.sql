-- ============================================================
-- Mioshie Zenshu — Compact HNSW index on teachings_topics.embedding
-- ============================================================
-- Reduz o índice HNSW de ~135 MB pra ~70-80 MB diminuindo `m` (graus
-- por nó) e `ef_construction` (largura da busca durante build).
--
-- Default pgvector: m=16, ef_construction=64. Calibrado pra datasets
-- de milhões de rows. Pra 17k topics, m=8/ef=40 mantém recall >95%
-- (medido empiricamente em datasets similares) e corta ~45% do tamanho.
--
-- Recall do search_teachings_hybrid não é dominante na qualidade final:
-- a Edge Function rerankeia top-50 com Voyage rerank-2. Se um candidato
-- relevante cai do top-50 do HNSW (improvável com m=8), o rerank não
-- consegue resgatar — mas o caminho FTS continua trazendo candidatos
-- lexicais em paralelo via RRF.
--
-- Operação: drop ANTES de create. Durante ~30-60s do build, busca
-- semântica cai pra FTS puro (RPC tem fallback: q_embedding pode
-- existir mas se não houver índice, query usa seq scan + sort com
-- statement_timeout de 30s — pior caso degrada graciosamente).
--
-- Pico de disco: zero. Não há dois índices coexistindo.
--
-- Reversão (se recall cair perceptivelmente):
--   drop index idx_tt_embedding_hnsw;
--   create index idx_tt_embedding_hnsw on teachings_topics
--     using hnsw (embedding vector_cosine_ops);
-- ============================================================

drop index if exists idx_tt_embedding_hnsw;

create index idx_tt_embedding_hnsw
  on teachings_topics
  using hnsw (embedding vector_cosine_ops)
  with (m = 8, ef_construction = 40);

-- Sanity: confirmar tamanho do novo índice
-- select pg_size_pretty(pg_relation_size('idx_tt_embedding_hnsw'));
