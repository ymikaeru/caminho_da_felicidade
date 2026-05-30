-- ============================================================
-- Mioshie Zenshu — Recomendações v11: recomendar POEMA
-- ============================================================
-- Permite recomendar um poema das coletâneas (Yama to Mizu, Warai
-- no Izumi, Akimaro Kin'eishū, 3× Gosanka-shū). Reaproveita
-- study_recommendations com a MESMA convenção dos poemas salvos:
--   - vol  = 'poetry'
--   - file = slug da coletânea ('yama-to-mizu', 'gosanka-kaitei', …)
--   - topic_idx = número do poema (só pra exibição "№ N")
--
-- Como poema NÃO está em teachings_topics (o LEFT JOIN dá null),
-- guardamos o rótulo e a âncora do deep-link na própria linha:
--   - poem_title    = rótulo exibido (ex.: "Yama to Mizu · № 123")
--   - poem_topic_id = âncora EXATA do card (ex.: 'yama_n123',
--                     'waraino_0042', 'kaitei_n5') — usada no link
--                     <coletânea>.html?poem=<poem_topic_id>&hl_scroll=1
--                     que faz autoscroll + flash no poema.
--     Guardamos a string EXATA (não reconstruímos a partir do número)
--     porque warai-no-izumi pode ter ids customizados (p.id).
--
-- O CHECK existente (sr_teaching_or_audio_chk) já é satisfeito por
-- vol+file não-nulos. Só texto — áudio fica nulo.
--
-- Pré-requisito: study_recommendations_v8.sql (colunas/CHECK de áudio).
-- Idempotente. Execute no SQL Editor do Supabase Dashboard.
-- ============================================================

-- ------------------------------------------------------------
-- PARTE 1 — Schema: colunas do poema
-- ------------------------------------------------------------
alter table public.study_recommendations
  add column if not exists poem_topic_id text,
  add column if not exists poem_title    text;

-- ------------------------------------------------------------
-- RPC: get_my_recommendations — + poem_topic_id / poem_title
-- (corpo idêntico ao v8 + as 2 colunas novas)
-- ------------------------------------------------------------
drop function if exists public.get_my_recommendations();

create or replace function public.get_my_recommendations()
returns table(
  id uuid,
  vol text,
  file text,
  topic_idx int,
  title_pt text,
  title_ja text,
  note text,
  created_at timestamptz,
  seen_at timestamptz,
  expires_at timestamptz,
  source_collection_id uuid,
  source_collection_name text,
  audio_path text,
  audio_title text,
  poem_topic_id text,
  poem_title text,
  created_by_name text
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;

  return query
  select
    r.id, r.vol, r.file, r.topic_idx,
    t.title_pt, t.title_ja,
    r.note, r.created_at, r.seen_at, r.expires_at,
    r.source_collection_id, r.source_collection_name,
    r.audio_path, r.audio_title,
    r.poem_topic_id, r.poem_title,
    coalesce(p.display_name, '')::text as created_by_name
  from public.study_recommendations r
  left join public.teachings_topics t
    on t.vol = r.vol and t.file = r.file and t.topic_idx = r.topic_idx
  left join public.user_profiles p
    on p.id = r.created_by
  where r.user_id = v_user
    and r.archived_at is null
    and (r.expires_at is null or r.expires_at > now())
  order by (r.seen_at is null) desc, r.created_at desc;
end;
$$;

revoke all on function public.get_my_recommendations() from public;
grant execute on function public.get_my_recommendations() to authenticated;

-- ------------------------------------------------------------
-- RPC: get_my_recommendations_archived — + poem_topic_id / poem_title
-- ------------------------------------------------------------
drop function if exists public.get_my_recommendations_archived();

create or replace function public.get_my_recommendations_archived()
returns table(
  id uuid,
  vol text,
  file text,
  topic_idx int,
  title_pt text,
  title_ja text,
  note text,
  created_at timestamptz,
  seen_at timestamptz,
  archived_at timestamptz,
  expires_at timestamptz,
  source_collection_id uuid,
  source_collection_name text,
  audio_path text,
  audio_title text,
  poem_topic_id text,
  poem_title text,
  created_by_name text
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;

  return query
  select
    r.id, r.vol, r.file, r.topic_idx,
    t.title_pt, t.title_ja,
    r.note, r.created_at, r.seen_at, r.archived_at, r.expires_at,
    r.source_collection_id, r.source_collection_name,
    r.audio_path, r.audio_title,
    r.poem_topic_id, r.poem_title,
    coalesce(p.display_name, '')::text as created_by_name
  from public.study_recommendations r
  left join public.teachings_topics t
    on t.vol = r.vol and t.file = r.file and t.topic_idx = r.topic_idx
  left join public.user_profiles p
    on p.id = r.created_by
  where r.user_id = v_user
    and r.archived_at is not null
  order by r.archived_at desc;
end;
$$;

revoke all on function public.get_my_recommendations_archived() from public;
grant execute on function public.get_my_recommendations_archived() to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_get_user_recommendations — + poem_topic_id / poem_title
-- (preserva read_at via access_logs do v6 — funciona pra poesia também,
--  já que as páginas logam vol='poetry' + file=<slug>)
-- ------------------------------------------------------------
drop function if exists public.admin_get_user_recommendations(uuid);

create or replace function public.admin_get_user_recommendations(p_user_id uuid)
returns table(
  id uuid,
  vol text,
  file text,
  topic_idx int,
  title_pt text,
  title_ja text,
  note text,
  created_at timestamptz,
  seen_at timestamptz,
  expires_at timestamptz,
  archived_at timestamptz,
  read_at timestamptz,
  audio_path text,
  audio_title text,
  poem_topic_id text,
  poem_title text,
  created_by_name text
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return query
  select
    r.id, r.vol, r.file, r.topic_idx,
    t.title_pt, t.title_ja,
    r.note, r.created_at, r.seen_at, r.expires_at, r.archived_at,
    (
      select min(a.created_at)
      from public.access_logs a
      where a.user_id    = r.user_id
        and a.volume     = r.vol
        and a.file       = r.file
        and a.action     = 'view'
        and a.created_at >= r.created_at
    ) as read_at,
    r.audio_path, r.audio_title,
    r.poem_topic_id, r.poem_title,
    coalesce(p.display_name, '')::text as created_by_name
  from public.study_recommendations r
  left join public.teachings_topics t
    on t.vol = r.vol and t.file = r.file and t.topic_idx = r.topic_idx
  left join public.user_profiles p
    on p.id = r.created_by
  where r.user_id = p_user_id
  order by
    (r.archived_at is null
       and (r.expires_at is null or r.expires_at > now())) desc,
    r.created_at desc;
end;
$$;

revoke all on function public.admin_get_user_recommendations(uuid) from public;
grant execute on function public.admin_get_user_recommendations(uuid) to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_create_poetry_recommendations_bulk — envio em lote
-- Espelha admin_create_recommendations_bulk (v5), versão poesia.
-- Insere vol='poetry', file=<coletânea>, topic_idx=<número>,
-- poem_topic_id=<âncora exata>, poem_title=<rótulo>.
-- ------------------------------------------------------------
create or replace function public.admin_create_poetry_recommendations_bulk(
  p_user_ids uuid[],
  p_collection text,
  p_poem_number int,
  p_poem_topic_id text,
  p_poem_title text,
  p_note text default null,
  p_expires_at timestamptz default null
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  n_created int;
  v_admin uuid := auth.uid();
  v_coll  text := nullif(trim(p_collection), '');
  v_anchor text := nullif(trim(p_poem_topic_id), '');
  v_title text := nullif(trim(p_poem_title), '');
  v_note  text := nullif(trim(p_note), '');
  v_num   int  := coalesce(p_poem_number, 0);
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if v_coll is null or v_anchor is null then
    raise exception 'collection e poem_topic_id são obrigatórios';
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  -- INNER JOIN com auth.users: UUID inválido na lista é ignorado, não
  -- quebra o lote inteiro (mesmo padrão do bulk de ensinamento).
  insert into public.study_recommendations
    (user_id, vol, file, topic_idx, poem_topic_id, poem_title,
     note, created_by, expires_at)
  select
    u.id, 'poetry', v_coll, v_num, v_anchor, v_title,
    v_note, v_admin, p_expires_at
  from unnest(p_user_ids) as t(uid)
  join auth.users u on u.id = t.uid
  where u.deleted_at is null;

  get diagnostics n_created = row_count;
  return n_created;
end;
$$;

revoke all on function public.admin_create_poetry_recommendations_bulk(uuid[], text, int, text, text, text, timestamptz) from public;
grant execute on function public.admin_create_poetry_recommendations_bulk(uuid[], text, int, text, text, text, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select admin_create_poetry_recommendations_bulk(
--   array['<uuid1>','<uuid2>']::uuid[],
--   'yama-to-mizu', 123, 'yama_n123', 'Yama to Mizu · № 123',
--   'pra contemplar esta semana', null);
-- select id, vol, file, poem_topic_id, poem_title
--   from get_my_recommendations() where vol = 'poetry';
-- ------------------------------------------------------------
