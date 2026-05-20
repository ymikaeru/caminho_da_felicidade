-- ============================================================
-- embedding_halfvec — encolhe embedding de float32 pra float16
-- ============================================================
-- pgvector >= 0.7 introduziu halfvec (float16). Storage e índice
-- HNSW caem pela metade com perda de recall <1% (documentado
-- nos benchmarks oficiais e papers IVF/HNSW com quantização).
--
-- Ganhos esperados:
--   embedding column: 67 MB  → ~34 MB  (-33 MB)
--   HNSW index:       135 MB → ~70 MB  (-65 MB)
--   Total:                              ~100 MB liberados
--
-- Reversível:
--   ALTER TABLE teachings_topics
--     ALTER COLUMN embedding TYPE vector(1024)
--     USING embedding::vector(1024);
--   DROP INDEX idx_tt_embedding_hnsw;
--   CREATE INDEX idx_tt_embedding_hnsw ON teachings_topics
--     USING hnsw (embedding vector_cosine_ops);
--   (e dropar o ::halfvec da RPC, voltando ao perf.sql)
--
-- Atenção: requer lock exclusivo na tabela durante ALTER + CREATE
-- INDEX (~1-3 min total). Busca fica indisponível nesse intervalo.
-- Fazer em horário de baixo uso.
-- ============================================================

BEGIN;

-- 1) Drop do índice atual (depende da coluna vector)
DROP INDEX IF EXISTS public.idx_tt_embedding_hnsw;

-- 2) Converte cada vector(1024) float32 → halfvec(1024) float16.
--    pgvector implementa o cast com saturação (valores fora do
--    range float16 [-65504, 65504] são clamped). Vetores normalizados
--    de Voyage estão muito longe disso, então loss real ≈ 0.
ALTER TABLE public.teachings_topics
  ALTER COLUMN embedding TYPE halfvec(1024)
  USING embedding::halfvec(1024);

-- 3) Recria HNSW com operator class de halfvec
CREATE INDEX idx_tt_embedding_hnsw ON public.teachings_topics
  USING hnsw (embedding halfvec_cosine_ops);

-- 4) Atualiza a RPC: cast q_embedding (vector) → halfvec inline.
--    Assinatura preservada (q_embedding vector) pra não quebrar
--    chamadas existentes. O cast é constante por call — otimizador
--    avalia uma vez e reusa em todas as rows.
CREATE OR REPLACE FUNCTION public.search_teachings_hybrid(
  q text,
  q_embedding vector,
  lang text DEFAULT 'pt'::text,
  max_results integer DEFAULT 50,
  scope text DEFAULT 'all'::text,
  use_fts boolean DEFAULT true
)
RETURNS TABLE(
  vol text, file text, topic_idx integer,
  title_pt text, title_ja text,
  nav_title_pt text, nav_title_ja text,
  snippet text, rank real,
  section_pt text, section_ja text,
  content_excerpt text
)
LANGUAGE plpgsql
STABLE
SET statement_timeout TO '30s'
AS $function$
#variable_conflict use_column
declare
  k_rrf constant int := 60;
  v_scope text := lower(coalesce(scope, 'all'));
  v_raw text := coalesce(nullif(trim(q), ''), '<<empty>>');
  v_ilike text := replace(replace(replace(coalesce(q, ''), '\', '\\'), '%', '\%'), '_', '\_');
  v_tsq tsquery := websearch_to_tsquery('pt_unaccent', v_raw);
  v_weights real[] := ARRAY[0.05, 0.1, 0.2, 1.0]::real[];
  v_candidates constant int := 50;
  -- Cast uma vez do parâmetro pra halfvec; reusado em vec_all.
  v_qh halfvec := CASE WHEN q_embedding IS NULL THEN NULL ELSE q_embedding::halfvec END;
begin
  if v_scope not in ('all', 'title', 'content') then
    v_scope := 'all';
  end if;

  return query
  with
  blocks as (select volume, files from _user_blocks()),
  fully_blocked as (select volume from blocks where files is null),
  -- ============== FTS path — PT ==============
  fts_pt_pool as MATERIALIZED (
    select t.vol, t.file, t.topic_idx
    from teachings_topics t
    where use_fts
      and lang <> 'ja'
      and t.tsv_pt @@ v_tsq
      and t.vol not in (select volume from fully_blocked)
      and not exists (
        select 1 from blocks b
        where b.volume = t.vol and b.files is not null and t.file = any(b.files)
      )
      and (
        v_scope = 'all'
        or (v_scope = 'title'   and to_tsvector('pt_unaccent',
              coalesce(t.title_pt, '') || ' ' ||
              coalesce(t.nav_title_pt, '') || ' ' ||
              coalesce(t.section_pt, '')) @@ v_tsq)
        or (v_scope = 'content' and to_tsvector('pt_unaccent', coalesce(t.content_pt, '')) @@ v_tsq)
      )
    limit v_candidates * 4
  ),
  fts_pt as (
    select
      p.vol, p.file, p.topic_idx,
      ts_rank_cd(v_weights, t.tsv_pt, v_tsq, 33) as r,
      row_number() over (order by ts_rank_cd(v_weights, t.tsv_pt, v_tsq, 33) desc) as rnk
    from fts_pt_pool p
    join teachings_topics t using (vol, file, topic_idx)
    order by r desc
    limit v_candidates
  ),
  -- ============== FTS path — JA ==============
  fts_ja_raw as (
    select
      t.vol, t.file, t.topic_idx,
      ((case when v_scope <> 'content' and (
          t.title_ja      ilike '%' || v_ilike || '%' escape '\'
          or t.nav_title_ja ilike '%' || v_ilike || '%' escape '\'
          or t.section_ja   ilike '%' || v_ilike || '%' escape '\'
        ) then 1.0 else 0 end) +
       (case when v_scope <> 'title' and t.content_ja ilike '%' || v_ilike || '%' escape '\' then 0.3 else 0 end))::real as r
    from teachings_topics t
    where use_fts
      and lang = 'ja'
      and t.vol not in (select volume from fully_blocked)
      and not exists (
        select 1 from blocks b
        where b.volume = t.vol and b.files is not null and t.file = any(b.files)
      )
      and (
        (v_scope <> 'content' and (
          t.title_ja      ilike '%' || v_ilike || '%' escape '\'
          or t.nav_title_ja ilike '%' || v_ilike || '%' escape '\'
          or t.section_ja   ilike '%' || v_ilike || '%' escape '\'
        ))
        or
        (v_scope <> 'title' and t.content_ja ilike '%' || v_ilike || '%' escape '\')
      )
    order by r desc
    limit v_candidates
  ),
  fts_ja as (
    select vol, file, topic_idx, r, row_number() over (order by r desc) as rnk
    from fts_ja_raw
  ),
  fts_all as (
    select vol, file, topic_idx, r, rnk from fts_pt
    union all
    select vol, file, topic_idx, r, rnk from fts_ja
  ),
  -- ============== Vector path ==============
  -- v_qh é o cast pra halfvec feito UMA vez no declare. O operador
  -- <=> entre halfvec usa o HNSW index halfvec_cosine_ops.
  vec_all as (
    select
      t.vol, t.file, t.topic_idx,
      (1 - (t.embedding <=> v_qh))::real as r,
      row_number() over (order by t.embedding <=> v_qh) as rnk
    from teachings_topics t
    where v_qh is not null
      and t.embedding is not null
      and t.vol not in (select volume from fully_blocked)
      and not exists (
        select 1 from blocks b
        where b.volume = t.vol and b.files is not null and t.file = any(b.files)
      )
    order by t.embedding <=> v_qh
    limit v_candidates
  ),
  -- ============== RRF fusion ==============
  fused as (
    select
      coalesce(f.vol, vc.vol) as vol,
      coalesce(f.file, vc.file) as file,
      coalesce(f.topic_idx, vc.topic_idx) as topic_idx,
      (coalesce(1.0 / (k_rrf + f.rnk), 0) + coalesce(1.0 / (k_rrf + vc.rnk), 0))::real as score
    from fts_all f
    full outer join vec_all vc
      on f.vol = vc.vol and f.file = vc.file and f.topic_idx = vc.topic_idx
  ),
  ranked as (
    select vol, file, topic_idx, score
    from fused
    order by score desc
    limit greatest(1, least(max_results, 100))
  )
  select
    t.vol, t.file, t.topic_idx, t.title_pt, t.title_ja,
    coalesce(t.nav_title_pt, t0.nav_title_pt) as nav_title_pt,
    coalesce(t.nav_title_ja, t0.nav_title_ja) as nav_title_ja,
    case
      when v_scope = 'title' then ''
      when lang = 'ja' then substring(
        coalesce(t.content_ja, ''),
        greatest(1, position(lower(v_raw) in lower(coalesce(t.content_ja, ''))) - 60),
        180
      )
      else ts_headline(
        'pt_unaccent',
        substring(coalesce(t.content_pt, '') from 1 for 4000),
        v_tsq,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=10, MaxFragments=1'
      )
    end as snippet,
    r.score as rank,
    coalesce(t.section_pt, t0.section_pt) as section_pt,
    coalesce(t.section_ja, t0.section_ja) as section_ja,
    substring(
      coalesce(
        case when lang = 'ja' then t.content_ja else t.content_pt end,
        t.content_pt,
        t.content_ja,
        ''
      )
      from 1 for 1500
    ) as content_excerpt
  from ranked r
  join teachings_topics t using (vol, file, topic_idx)
  left join teachings_topics t0
    on t0.vol = t.vol and t0.file = t.file and t0.topic_idx = 0
  order by r.score desc;
end;
$function$;

COMMIT;
