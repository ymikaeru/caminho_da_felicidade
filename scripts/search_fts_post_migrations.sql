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
--
-- Perf: o caminho PT precisa de unaccent (caso "purificacao" → "Purificação"),
-- mas unaccent() default é STABLE — Postgres não indexa STABLE. f_unaccent é
-- um wrapper IMMUTABLE pra poder ser usado em expressão de índice GIN trigram.
-- O operador <% (word similarity) acionado contra o índice transforma o que
-- antes era seq scan da tabela inteira em lookup indexado.

-- Wrapper IMMUTABLE de unaccent — pré-requisito do índice trigram em title_pt.
create or replace function f_unaccent(text)
returns text language sql immutable parallel safe as
$$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Índice trigram em title_pt (unaccented) — acelera suggest_teachings.
-- O título JA já tem idx_tt_title_ja_trgm no schema base.
create index if not exists idx_tt_title_pt_unaccent_trgm
  on teachings_topics using gin (f_unaccent(title_pt) gin_trgm_ops);

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
language plpgsql stable security invoker
-- Configura o threshold do operador <% para 0.5 dentro da função.
-- Tem que casar com o WHERE sim > 0.5 abaixo: <% filtra via índice GIN
-- com este threshold, depois recomputamos pra ranquear/expor.
set pg_trgm.word_similarity_threshold = 0.5
as $func$
declare
  v_raw text := coalesce(trim(q), '');
  v_raw_unacc text := f_unaccent(v_raw);
begin
  if length(v_raw) < 3 then
    return;
  end if;

  if lang = 'ja' then
    return query
    with
      blocks as (select volume, files from _user_blocks()),
      fully_blocked as (select volume from blocks where files is null),
      scored as (
        select
          t.vol, t.file, t.topic_idx, t.title_pt, t.title_ja,
          word_similarity(v_raw, t.title_ja) as sim
        from teachings_topics t
        where
          t.title_ja is not null
          -- <% usa idx_tt_title_ja_trgm para pré-filtrar candidatos.
          and v_raw <% t.title_ja
          and t.vol not in (select volume from fully_blocked)
          and not exists (
            select 1 from blocks b
            where b.volume = t.vol
              and b.files is not null
              and t.file = any(b.files)
          )
      )
    select s.vol, s.file, s.topic_idx, s.title_pt, s.title_ja, s.sim
    from scored s
    where s.sim > 0.5
    order by s.sim desc
    limit 3;
  else
    return query
    with
      blocks as (select volume, files from _user_blocks()),
      fully_blocked as (select volume from blocks where files is null),
      scored as (
        select
          t.vol, t.file, t.topic_idx, t.title_pt, t.title_ja,
          word_similarity(v_raw_unacc, f_unaccent(t.title_pt)) as sim
        from teachings_topics t
        where
          t.title_pt is not null
          -- <% usa idx_tt_title_pt_unaccent_trgm. A expressão à direita TEM
          -- que casar com a expressão indexada (f_unaccent(title_pt)).
          and v_raw_unacc <% f_unaccent(t.title_pt)
          and t.vol not in (select volume from fully_blocked)
          and not exists (
            select 1 from blocks b
            where b.volume = t.vol
              and b.files is not null
              and t.file = any(b.files)
          )
      )
    select s.vol, s.file, s.topic_idx, s.title_pt, s.title_ja, s.sim
    from scored s
    where s.sim > 0.5
    order by s.sim desc
    limit 3;
  end if;
end;
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
-- Dedupe de access_logs no servidor (v2 com metadata)
-- ============================================================
-- Substitui o INSERT direto em access_logs por uma RPC que:
--   - Checa se já existe row com mesmo (user, volume, file, action) nos
--     últimos 60s. Se sim, pula o insert. EXCETO p_action='copy': cada
--     cópia é um trecho diferente, então nunca dedupa.
--   - Insere a row caso contrário.
--   - Aceita p_metadata jsonb (default null): usado por content-protection.js
--     pra registrar texto copiado em access_logs.metadata.
--   - Sempre atualiza user_profiles.last_seen_at (mantém presença).
--
-- Por que servidor: o dedupe in-memory do client perde estado em refresh
-- e em abas separadas. O servidor garante "next records" idempotentes
-- mesmo com double-fire de popstate, navegação cruzada ou refresh.
-- ============================================================

-- Remove a versão antiga (3 args) — substituída pela nova com p_metadata default.
drop function if exists log_access_dedup(text, text, text);

create or replace function log_access_dedup(
  p_volume text,
  p_file text,
  p_action text default 'view',
  p_metadata jsonb default null
)
returns void
language plpgsql security definer
set search_path = public
as $func$
declare
  v_user uuid := auth.uid();
  v_dup boolean := false;
begin
  if v_user is null then return; end if;

  -- Cada evento de 'copy' é um trecho distinto — não dedupa.
  if p_action <> 'copy' then
    select exists (
      select 1 from public.access_logs
      where user_id = v_user
        and volume = p_volume
        and file = p_file
        and action = p_action
        and created_at >= now() - interval '60 seconds'
    ) into v_dup;
  end if;

  if not v_dup then
    insert into public.access_logs (user_id, volume, file, action, metadata)
    values (v_user, p_volume, p_file, p_action, p_metadata);
  end if;

  -- Sempre atualiza presença, mesmo no caso dedupado.
  update public.user_profiles set last_seen_at = now() where id = v_user;
end;
$func$;

revoke all on function log_access_dedup(text, text, text, jsonb) from public;
grant execute on function log_access_dedup(text, text, text, jsonb) to authenticated;

-- ============================================================
-- Posição de leitura granular por parágrafo
-- ============================================================
-- Coluna nova em reading_positions. NULL pra rows antigas (fallback
-- pro scroll-to-topic). saveReadingPosition + getLastPosition no
-- client passam a ler/escrever isto junto com topic_index.
-- ============================================================
alter table public.reading_positions
  add column if not exists paragraph_index integer;

-- ============================================================
-- Sanity check
-- ============================================================
-- select * from suggest_teachings('johre', 'pt');
-- select * from suggest_teachings('mishu sma', 'pt');
-- select admin_search_analytics(30);
-- select log_access_dedup('mioshiec1', 'test.html', 'view');
