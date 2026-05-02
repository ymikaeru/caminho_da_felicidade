-- ============================================================
-- Migrações pós-FTS — features #2 (Você quis dizer) e #3 (Analytics)
-- ============================================================
-- Cole isto inteiro no Supabase SQL Editor.
-- Idempotente (CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS).
-- Requer: search_fts_schema.sql + search_fts_rpc.sql já aplicados.
-- ============================================================

-- ============================================================
-- #2 — RPC suggest_teachings (pg_trgm "Você quis dizer...")
-- ============================================================
-- Usa word_similarity (não similarity) porque títulos são longos e o
-- similarity penaliza muito o tamanho extra. word_similarity acha a
-- melhor janela do título que casa com a query — robusto pra typos
-- curtos contra títulos longos do tipo "Ensinamento de Meishu-Sama:...".
create or replace function suggest_teachings(
  q text,
  lang text default 'pt'
)
returns table(
  vol text,
  file text,
  topic_idx int,
  title_pt text,
  title_ja text,
  similarity real
)
language sql stable security invoker
as $func$
  with
  q_clean as (
    select coalesce(trim(q), '') as raw
  ),
  blocks as (select volume, files from _user_blocks()),
  fully_blocked as (select volume from blocks where files is null),
  scored as (
    select
      t.vol, t.file, t.topic_idx, t.title_pt, t.title_ja,
      case
        when lang = 'ja' then word_similarity((select raw from q_clean), coalesce(t.title_ja, ''))
        else word_similarity(unaccent((select raw from q_clean)), unaccent(coalesce(t.title_pt, '')))
      end as sim
    from teachings_topics t
    where
      t.vol not in (select volume from fully_blocked)
      and not exists (
        select 1 from blocks b
        where b.volume = t.vol
          and b.files is not null
          and t.file = any(b.files)
      )
      and length((select raw from q_clean)) >= 3
  )
  select vol, file, topic_idx, title_pt, title_ja, sim as similarity
  from scored
  where sim > 0.5
  order by sim desc
  limit 3;
$func$;

revoke all on function suggest_teachings(text, text) from public;
grant execute on function suggest_teachings(text, text) to authenticated;


-- ============================================================
-- #3 — Coluna latency_ms + RPCs de analytics
-- ============================================================

-- Coluna nova
alter table public.search_logs
  add column if not exists latency_ms int;

-- Helper: is_admin para um user_id arbitrário (não só auth.uid())
create or replace function is_admin_user_id(uid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $func$
  select exists (
    select 1 from public.user_profiles where id = uid and role = 'admin'
  );
$func$;

revoke all on function is_admin_user_id(uuid) from public;
grant execute on function is_admin_user_id(uuid) to authenticated;

-- Dashboard de analytics de busca
create or replace function admin_search_analytics(
  days_back int default 30
)
returns json
language plpgsql stable security definer
set search_path = public
as $func$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(days_back, 365)));
  v_top json;
  v_zero json;
  v_latency json;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  with q as (
    select lower(trim(query)) as q, count(*) as n
    from public.search_logs
    where created_at >= v_since
      and not public.is_admin_user_id(user_id)
      and length(trim(query)) > 1
    group by lower(trim(query))
    order by n desc
    limit 30
  )
  select coalesce(json_agg(json_build_object('query', q, 'count', n)), '[]'::json)
  into v_top from q;

  with q as (
    select lower(trim(query)) as q, count(*) as n, max(created_at) as last_seen
    from public.search_logs
    where created_at >= v_since
      and not public.is_admin_user_id(user_id)
      and results_count = 0
      and length(trim(query)) > 1
    group by lower(trim(query))
    order by n desc, last_seen desc
    limit 30
  )
  select coalesce(json_agg(json_build_object('query', q, 'count', n, 'last_seen', last_seen)), '[]'::json)
  into v_zero from q;

  select json_build_object(
    'count', count(latency_ms),
    'p50',   percentile_cont(0.5) within group (order by latency_ms),
    'p95',   percentile_cont(0.95) within group (order by latency_ms),
    'p99',   percentile_cont(0.99) within group (order by latency_ms),
    'avg',   round(avg(latency_ms))
  )
  into v_latency
  from public.search_logs
  where created_at >= v_since
    and latency_ms is not null
    and not public.is_admin_user_id(user_id);

  return json_build_object(
    'days_back', days_back,
    'since', v_since,
    'top_queries', v_top,
    'zero_result_queries', v_zero,
    'latency', v_latency
  );
end;
$func$;

revoke all on function admin_search_analytics(int) from public;
grant execute on function admin_search_analytics(int) to authenticated;

-- ============================================================
-- Sanity check
-- ============================================================
-- select * from suggest_teachings('johre', 'pt');
-- select * from suggest_teachings('mishu sma', 'pt');
-- select admin_search_analytics(30);
