-- ============================================================
-- Mioshie Zenshu — Search FTS RPCs
-- ============================================================
-- Funções expostas ao cliente:
--   - search_teachings(q, lang, max_results)
--   - random_teaching(only_vol)
--
-- Permissões por volume/arquivo são lidas de `public.user_permissions`
-- via auth.uid() DENTRO da RPC. O cliente NÃO passa lista de volumes —
-- isso garante que tampering do client-side não burla bloqueios.
--
-- Segurança contra SQL injection:
--   - language sql (sem EXECUTE).
--   - Params bindam parametrizados (não há concatenação de SQL).
--   - websearch_to_tsquery sanitiza operadores (nunca usar to_tsquery direto).
--   - ILIKE no caminho JA escapa \, %, _ antes de concatenar.
--
-- Rode DEPOIS de search_fts_schema.sql.
-- ============================================================

-- ------------------------------------------------------------
-- Helper interno: lista de bloqueios do usuário corrente.
-- Cada row representa: (volume bloqueado, files bloqueados).
-- files = NULL  → o volume inteiro está bloqueado.
-- files != NULL → apenas os arquivos listados estão bloqueados.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Busca principal
-- ------------------------------------------------------------
create or replace function search_teachings(
  q text,
  lang text default 'pt',
  max_results int default 50
)
returns table(
  vol text,
  file text,
  topic_idx int,
  title_pt text,
  title_ja text,
  snippet text,
  rank real
)
language sql stable security invoker
-- O default da role authenticated é 8s, insuficiente para queries JA curtas
-- (2 chars como '浄霊' ou '神様') que não conseguem usar o GIN trigram e
-- precisam fazer seq scan no content_ja. 30s cobre o pior caso.
set statement_timeout to '30s'
as $$
  with
  q_clean as (
    select
      coalesce(nullif(trim(q), ''), '<<empty>>') as raw,
      -- Escapa \ % _ para o ESCAPE '\' no ILIKE.
      replace(replace(replace(coalesce(q, ''), '\', '\\'), '%', '\%'), '_', '\_') as ilike_safe
  ),
  blocks as (
    select volume, files from _user_blocks()
  ),
  fully_blocked as (
    select volume from blocks where files is null
  ),
  ts as (
    select websearch_to_tsquery('pt_unaccent', (select raw from q_clean)) as tsq
  )
  select
    t.vol,
    t.file,
    t.topic_idx,
    t.title_pt,
    t.title_ja,
    case
      when lang = 'ja' then
        substring(
          coalesce(t.content_ja, ''),
          greatest(1, position(lower((select raw from q_clean)) in lower(coalesce(t.content_ja, ''))) - 60),
          180
        )
      else
        ts_headline(
          'pt_unaccent',
          coalesce(t.content_pt, ''),
          (select tsq from ts),
          'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=10, MaxFragments=1'
        )
    end as snippet,
    case
      when lang = 'ja' then
        (case when t.title_ja   ilike '%' || (select ilike_safe from q_clean) || '%' escape '\' then 1.0 else 0 end) +
        (case when t.content_ja ilike '%' || (select ilike_safe from q_clean) || '%' escape '\' then 0.3 else 0 end)
      else
        ts_rank(t.tsv_pt, (select tsq from ts))
    end as rank
  from teachings_topics t
  where
    -- Bloqueio server-side: ignora qualquer param de volume vindo do cliente.
    t.vol not in (select volume from fully_blocked)
    and not exists (
      select 1 from blocks b
      where b.volume = t.vol
        and b.files is not null
        and t.file = any(b.files)
    )
    and (
      (lang = 'ja' and (
        t.title_ja   ilike '%' || (select ilike_safe from q_clean) || '%' escape '\'
        or
        t.content_ja ilike '%' || (select ilike_safe from q_clean) || '%' escape '\'
      ))
      or
      (lang <> 'ja' and t.tsv_pt @@ (select tsq from ts))
    )
  order by rank desc nulls last
  limit greatest(1, least(max_results, 100));
$$;

revoke all on function search_teachings(text, text, int) from public;
grant execute on function search_teachings(text, text, int) to authenticated;

-- ------------------------------------------------------------
-- Random teaching (respeitando bloqueios)
-- ------------------------------------------------------------
create or replace function random_teaching(only_vol text default null)
returns table(vol text, file text, topic_idx int)
language sql stable security invoker
as $$
  with
  blocks as (select volume, files from _user_blocks()),
  fully_blocked as (select volume from blocks where files is null)
  select t.vol, t.file, t.topic_idx
  from teachings_topics t
  where
    (only_vol is null or t.vol = only_vol)
    and t.vol not in (select volume from fully_blocked)
    and not exists (
      select 1 from blocks b
      where b.volume = t.vol
        and b.files is not null
        and t.file = any(b.files)
    )
  order by random()
  limit 1;
$$;

revoke all on function random_teaching(text) from public;
grant execute on function random_teaching(text) to authenticated;

-- ------------------------------------------------------------
-- "Você quis dizer...?" — sugestões para zero resultados
-- ------------------------------------------------------------
-- Usa pg_trgm.similarity em title_pt/title_ja para achar títulos
-- próximos. Chamada apenas quando search_teachings retorna 0 linhas,
-- para não pagar custo extra no caminho feliz.
--
-- Threshold 0.3 é empírico: catches "Johre" → "Johrei", "Meishu Sma"
-- → "Meishu-Sama"; rejeita matches genéricos. Ajustar se necessário.
--
-- Respeita _user_blocks() (mesma garantia da search_teachings).
-- ------------------------------------------------------------
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
as $$
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
$$;

revoke all on function suggest_teachings(text, text) from public;
grant execute on function suggest_teachings(text, text) to authenticated;

-- ------------------------------------------------------------
-- Analytics de busca para o admin
-- ------------------------------------------------------------
-- Retorna 3 datasets em uma chamada:
--   - top_queries:        as 30 buscas mais frequentes do período
--   - zero_result_queries: as 30 buscas com results_count=0 (gaps de conteúdo)
--   - latency:            p50, p95, p99 e contagem total
--
-- Filtra admins automaticamente via NOT IN (lista de admins). Reutiliza
-- a mesma lógica do dashboard atual em admin-supabase.html.
--
-- Requer: coluna search_logs.latency_ms (rode o ALTER TABLE abaixo antes).
-- ------------------------------------------------------------

-- Coluna latency_ms — tempo de resposta da RPC search_teachings em ms.
-- Idempotente: só adiciona se ainda não existir.
alter table public.search_logs
  add column if not exists latency_ms int;

create or replace function admin_search_analytics(
  days_back int default 30
)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(days_back, 365)));
  v_top json;
  v_zero json;
  v_latency json;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  -- Top 30 queries (excluindo admins)
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

  -- Top 30 queries com 0 resultados (gaps de conteúdo)
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

  -- Latência: p50/p95/p99 e total
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
$$;

revoke all on function admin_search_analytics(int) from public;
grant execute on function admin_search_analytics(int) to authenticated;

-- Helper: is_admin_user_id(uuid) — versão de is_admin() que aceita um
-- user_id arbitrário em vez de auth.uid(). Usado pra filtrar admins
-- nos aggregates do dashboard (sem conta a query do próprio admin).
create or replace function is_admin_user_id(uid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles where id = uid and role = 'admin'
  );
$$;

revoke all on function is_admin_user_id(uuid) from public;
grant execute on function is_admin_user_id(uuid) to authenticated;

-- ------------------------------------------------------------
-- Sanity check: rode estas queries depois de aplicar para confirmar.
-- ------------------------------------------------------------
-- select count(*), vol from teachings_topics group by vol order by vol;
-- select * from search_teachings('johrei', 'pt', 5);
-- select * from search_teachings('神様', 'ja', 5);
-- select * from random_teaching();
-- select * from suggest_teachings('johre', 'pt');           -- typo proposital
-- select * from suggest_teachings('meishu sma', 'pt');      -- typo proposital
-- select * from suggest_teachings('神様', 'ja');
