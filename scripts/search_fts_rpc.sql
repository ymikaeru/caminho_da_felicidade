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
-- Sanity check: rode estas queries depois de aplicar para confirmar.
-- ------------------------------------------------------------
-- select count(*), vol from teachings_topics group by vol order by vol;
-- select * from search_teachings('johrei', 'pt', 5);
-- select * from search_teachings('神様', 'ja', 5);
-- select * from random_teaching();
