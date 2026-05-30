-- ============================================================
-- Mioshie Zenshu — Recomendações v12: trecho do poema na cartinha
-- ============================================================
-- Adiciona poem_text (original JP + tradução PT, separados por \n)
-- guardado no momento da recomendação — exibido inline no card do
-- usuário pra deixar claro que é um poema e dar gosto de ler.
--
-- Pré-requisito: study_recommendations_v11.sql.
-- Idempotente.
-- ============================================================

alter table public.study_recommendations
  add column if not exists poem_text text;

-- ------------------------------------------------------------
-- get_my_recommendations — + poem_text
-- ------------------------------------------------------------
drop function if exists public.get_my_recommendations();

create or replace function public.get_my_recommendations()
returns table(
  id uuid, vol text, file text, topic_idx int,
  title_pt text, title_ja text, note text,
  created_at timestamptz, seen_at timestamptz, expires_at timestamptz,
  source_collection_id uuid, source_collection_name text,
  audio_path text, audio_title text,
  poem_topic_id text, poem_title text, poem_text text,
  created_by_name text
)
language plpgsql stable security definer set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  return query
  select r.id, r.vol, r.file, r.topic_idx,
    t.title_pt, t.title_ja,
    r.note, r.created_at, r.seen_at, r.expires_at,
    r.source_collection_id, r.source_collection_name,
    r.audio_path, r.audio_title,
    r.poem_topic_id, r.poem_title, r.poem_text,
    coalesce(p.display_name, '')::text
  from public.study_recommendations r
  left join public.teachings_topics t on t.vol = r.vol and t.file = r.file and t.topic_idx = r.topic_idx
  left join public.user_profiles p on p.id = r.created_by
  where r.user_id = v_user
    and r.archived_at is null
    and (r.expires_at is null or r.expires_at > now())
  order by (r.seen_at is null) desc, r.created_at desc;
end;
$$;
revoke all on function public.get_my_recommendations() from public;
grant execute on function public.get_my_recommendations() to authenticated;

-- ------------------------------------------------------------
-- get_my_recommendations_archived — + poem_text
-- ------------------------------------------------------------
drop function if exists public.get_my_recommendations_archived();

create or replace function public.get_my_recommendations_archived()
returns table(
  id uuid, vol text, file text, topic_idx int,
  title_pt text, title_ja text, note text,
  created_at timestamptz, seen_at timestamptz, archived_at timestamptz,
  expires_at timestamptz, source_collection_id uuid, source_collection_name text,
  audio_path text, audio_title text,
  poem_topic_id text, poem_title text, poem_text text,
  created_by_name text
)
language plpgsql stable security definer set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  return query
  select r.id, r.vol, r.file, r.topic_idx,
    t.title_pt, t.title_ja,
    r.note, r.created_at, r.seen_at, r.archived_at, r.expires_at,
    r.source_collection_id, r.source_collection_name,
    r.audio_path, r.audio_title,
    r.poem_topic_id, r.poem_title, r.poem_text,
    coalesce(p.display_name, '')::text
  from public.study_recommendations r
  left join public.teachings_topics t on t.vol = r.vol and t.file = r.file and t.topic_idx = r.topic_idx
  left join public.user_profiles p on p.id = r.created_by
  where r.user_id = v_user and r.archived_at is not null
  order by r.archived_at desc;
end;
$$;
revoke all on function public.get_my_recommendations_archived() from public;
grant execute on function public.get_my_recommendations_archived() to authenticated;

-- ------------------------------------------------------------
-- admin_get_user_recommendations — + poem_text
-- ------------------------------------------------------------
drop function if exists public.admin_get_user_recommendations(uuid);

create or replace function public.admin_get_user_recommendations(p_user_id uuid)
returns table(
  id uuid, vol text, file text, topic_idx int,
  title_pt text, title_ja text, note text,
  created_at timestamptz, seen_at timestamptz, expires_at timestamptz,
  archived_at timestamptz, read_at timestamptz,
  audio_path text, audio_title text,
  poem_topic_id text, poem_title text, poem_text text,
  created_by_name text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
  select r.id, r.vol, r.file, r.topic_idx,
    t.title_pt, t.title_ja,
    r.note, r.created_at, r.seen_at, r.expires_at, r.archived_at,
    (select min(a.created_at) from public.access_logs a
     where a.user_id = r.user_id and a.volume = r.vol and a.file = r.file
       and a.action = 'view' and a.created_at >= r.created_at) as read_at,
    r.audio_path, r.audio_title,
    r.poem_topic_id, r.poem_title, r.poem_text,
    coalesce(p.display_name, '')::text
  from public.study_recommendations r
  left join public.teachings_topics t on t.vol = r.vol and t.file = r.file and t.topic_idx = r.topic_idx
  left join public.user_profiles p on p.id = r.created_by
  where r.user_id = p_user_id
  order by (r.archived_at is null and (r.expires_at is null or r.expires_at > now())) desc, r.created_at desc;
end;
$$;
revoke all on function public.admin_get_user_recommendations(uuid) from public;
grant execute on function public.admin_get_user_recommendations(uuid) to authenticated;

-- ------------------------------------------------------------
-- admin_create_poetry_recommendations_bulk — + p_poem_text
-- Recria (drop+create) porque adicionamos parâmetro no meio.
-- ------------------------------------------------------------
drop function if exists public.admin_create_poetry_recommendations_bulk(uuid[], text, int, text, text, text, timestamptz);

create or replace function public.admin_create_poetry_recommendations_bulk(
  p_user_ids    uuid[],
  p_collection  text,
  p_poem_number int,
  p_poem_topic_id text,
  p_poem_title  text,
  p_poem_text   text    default null,
  p_note        text    default null,
  p_expires_at  timestamptz default null
)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  n_created int;
  v_admin   uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if nullif(trim(p_collection), '') is null or nullif(trim(p_poem_topic_id), '') is null then
    raise exception 'collection e poem_topic_id são obrigatórios';
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then return 0; end if;

  insert into public.study_recommendations
    (user_id, vol, file, topic_idx, poem_topic_id, poem_title, poem_text,
     note, created_by, expires_at)
  select
    u.id,
    'poetry', trim(p_collection), coalesce(p_poem_number, 0),
    trim(p_poem_topic_id), nullif(trim(p_poem_title), ''), nullif(trim(p_poem_text), ''),
    nullif(trim(p_note), ''), v_admin, p_expires_at
  from unnest(p_user_ids) as t(uid)
  join auth.users u on u.id = t.uid
  where u.deleted_at is null;

  get diagnostics n_created = row_count;
  return n_created;
end;
$$;
revoke all on function public.admin_create_poetry_recommendations_bulk(uuid[], text, int, text, text, text, text, timestamptz) from public;
grant execute on function public.admin_create_poetry_recommendations_bulk(uuid[], text, int, text, text, text, text, timestamptz) to authenticated;
