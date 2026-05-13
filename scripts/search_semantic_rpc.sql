-- ============================================================
-- Mioshie Zenshu — Hybrid search RPC (FTS + vector via RRF)
-- ============================================================
-- search_teachings_hybrid: drop-in com mesmo shape de search_teachings,
-- mas combina FTS (lexical) + embedding (semântico) via Reciprocal
-- Rank Fusion. Edge Function `search-semantic` é quem chama essa RPC
-- depois de embeddar a query do usuário via Voyage AI.
--
-- Pré-requisitos: search_semantic_schema.sql aplicado.
-- Idempotente.
-- ============================================================

drop function if exists search_teachings_hybrid(text, vector, text, int, text);

create or replace function search_teachings_hybrid(
  q text,
  q_embedding vector(1024),
  lang text default 'pt',
  max_results int default 50,
  scope text default 'all'
)
returns table(
  vol text,
  file text,
  topic_idx int,
  title_pt text,
  title_ja text,
  nav_title_pt text,
  nav_title_ja text,
  snippet text,
  rank real
)
language plpgsql stable security invoker
set statement_timeout to '30s'
as $$
-- RRF constant. k=60 é o valor canônico (Cormack et al. 2009) — penaliza
-- ranks tardios o suficiente pra que top 1-3 dominem, sem zerar o sinal
-- dos top 10-20. Valores menores (k=10) tornam top-1 quase ditatorial;
-- maiores (k=200) achatam demais.
declare
  k_rrf constant int := 60;
  v_scope text := lower(coalesce(scope, 'all'));
  v_raw text := coalesce(nullif(trim(q), ''), '<<empty>>');
  v_ilike text := replace(replace(replace(coalesce(q, ''), '\', '\\'), '%', '\%'), '_', '\_');
  v_tsq tsquery := websearch_to_tsquery('pt_unaccent', v_raw);
  v_weights real[] := ARRAY[0.05, 0.1, 0.2, 1.0]::real[];
  v_candidates constant int := 50;  -- top N de cada caminho antes do RRF
begin
  if v_scope not in ('all', 'title', 'content') then
    v_scope := 'all';
  end if;

  return query
  with
  blocks as (select volume, files from _user_blocks()),
  fully_blocked as (select volume from blocks where files is null),
  visible as (
    -- Conjunto base já filtrado por permissões. Reduz custo dos paths
    -- FTS/vec porque ambos passam por aqui antes de ordenar.
    select t.*
    from teachings_topics t
    where t.vol not in (select volume from fully_blocked)
      and not exists (
        select 1 from blocks b
        where b.volume = t.vol and b.files is not null and t.file = any(b.files)
      )
  ),
  -- ============== FTS path ==============
  fts_pt as (
    select
      v.vol, v.file, v.topic_idx,
      ts_rank_cd(v_weights, v.tsv_pt, v_tsq, 33) as r,
      row_number() over (order by ts_rank_cd(v_weights, v.tsv_pt, v_tsq, 33) desc) as rnk
    from visible v
    where lang <> 'ja'
      and v.tsv_pt @@ v_tsq
      and (
        v_scope = 'all'
        or (v_scope = 'title'   and to_tsvector('pt_unaccent',
              coalesce(v.title_pt, '') || ' ' ||
              coalesce(v.nav_title_pt, '') || ' ' ||
              coalesce(v.section_pt, '')) @@ v_tsq)
        or (v_scope = 'content' and to_tsvector('pt_unaccent', coalesce(v.content_pt, '')) @@ v_tsq)
      )
    order by r desc
    limit v_candidates
  ),
  fts_ja as (
    select
      v.vol, v.file, v.topic_idx,
      ((case when v_scope <> 'content' and (
          v.title_ja      ilike '%' || v_ilike || '%' escape '\'
          or v.nav_title_ja ilike '%' || v_ilike || '%' escape '\'
          or v.section_ja   ilike '%' || v_ilike || '%' escape '\'
        ) then 1.0 else 0 end) +
       (case when v_scope <> 'title' and v.content_ja ilike '%' || v_ilike || '%' escape '\' then 0.3 else 0 end))::real as r,
      row_number() over (order by
        ((case when v_scope <> 'content' and (
            v.title_ja      ilike '%' || v_ilike || '%' escape '\'
            or v.nav_title_ja ilike '%' || v_ilike || '%' escape '\'
            or v.section_ja   ilike '%' || v_ilike || '%' escape '\'
          ) then 1.0 else 0 end) +
         (case when v_scope <> 'title' and v.content_ja ilike '%' || v_ilike || '%' escape '\' then 0.3 else 0 end)) desc
      ) as rnk
    from visible v
    where lang = 'ja'
      and (
        (v_scope <> 'content' and (
          v.title_ja      ilike '%' || v_ilike || '%' escape '\'
          or v.nav_title_ja ilike '%' || v_ilike || '%' escape '\'
          or v.section_ja   ilike '%' || v_ilike || '%' escape '\'
        ))
        or
        (v_scope <> 'title' and v.content_ja ilike '%' || v_ilike || '%' escape '\')
      )
    order by r desc
    limit v_candidates
  ),
  fts_all as (
    select vol, file, topic_idx, r, rnk from fts_pt
    union all
    select vol, file, topic_idx, r, rnk from fts_ja
  ),
  -- ============== Vector path ==============
  -- Só roda se q_embedding foi fornecido. Sem embedding, o RRF degrada
  -- pra FTS puro (mesma behavior do search_teachings antigo).
  --
  -- Importante: filtros de permissão são INLINE (não usam o CTE 'visible')
  -- pra que o planner consiga aplicar o HNSW index na ORDER BY ... <=>.
  -- Materializar 'visible' antes forçava seq scan + sort, ignorando o índice.
  -- Scope é ignorado aqui — semântico sempre considera o doc inteiro.
  vec_all as (
    select
      t.vol, t.file, t.topic_idx,
      (1 - (t.embedding <=> q_embedding))::real as r,
      row_number() over (order by t.embedding <=> q_embedding) as rnk
    from teachings_topics t
    where q_embedding is not null
      and t.embedding is not null
      and t.vol not in (select volume from fully_blocked)
      and not exists (
        select 1 from blocks b
        where b.volume = t.vol and b.files is not null and t.file = any(b.files)
      )
    order by t.embedding <=> q_embedding
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
    t.nav_title_pt, t.nav_title_ja,
    case
      when v_scope = 'title' then ''
      when lang = 'ja' then substring(
        coalesce(t.content_ja, ''),
        greatest(1, position(lower(v_raw) in lower(coalesce(t.content_ja, ''))) - 60),
        180
      )
      else ts_headline(
        'pt_unaccent',
        coalesce(t.content_pt, ''),
        v_tsq,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=10, MaxFragments=1'
      )
    end as snippet,
    r.score as rank
  from ranked r
  join teachings_topics t using (vol, file, topic_idx)
  order by r.score desc;
end;
$$;

revoke all on function search_teachings_hybrid(text, vector, text, int, text) from public;
grant execute on function search_teachings_hybrid(text, vector, text, int, text) to authenticated;

-- Sanity:
-- select * from search_teachings_hybrid('johrei', null, 'pt', 5);  -- FTS-only path
