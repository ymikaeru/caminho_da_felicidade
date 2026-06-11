-- ============================================================
-- Mioshie Zenshu — Recomendações v15: trechos grifados na recomendação
-- ============================================================
-- Dois fluxos do admin, um mecanismo só:
--   • "Recomendar trecho" (Central de Destaques): 1 intervalo;
--   • "Recomendar este Ensinamento" COM os destaques do admin: N intervalos.
-- excerpt_ranges = jsonb [[start,end],...] (offsets de caractere do tópico,
-- os mesmos dos user_highlights). excerpt_text = citação exibida no card do
-- usuário (preenchida no fluxo de trecho único; null no multi). Ao abrir, o
-- leitor pinta os intervalos e scrolla até o primeiro (&excerpt=s:e,s:e na URL).
--
-- Pré-requisito: study_recommendations_v12.sql (poem_text) — as RPCs de
-- leitura abaixo são as do v12 + os 2 campos novos.
-- Idempotente.
-- ============================================================

alter table public.study_recommendations
  add column if not exists excerpt_ranges jsonb;
alter table public.study_recommendations
  add column if not exists excerpt_text text;

-- ------------------------------------------------------------
-- admin_create_recommendations_bulk — + trechos (params opcionais)
-- Recria (drop+create) porque a assinatura muda.
-- ------------------------------------------------------------
drop function if exists public.admin_create_recommendations_bulk(uuid[], text, text, int, text, timestamptz);
-- Rascunho intermediário desta v15 usava 2 colunas int em vez do jsonb;
-- se chegou a ser aplicado, derruba o overload (senão a RPC fica ambígua).
drop function if exists public.admin_create_recommendations_bulk(uuid[], text, text, int, text, timestamptz, int, int, text);

create or replace function public.admin_create_recommendations_bulk(
  p_user_ids uuid[],
  p_vol text,
  p_file text,
  p_topic_idx int default 0,
  p_note text default null,
  p_expires_at timestamptz default null,
  p_excerpt_ranges jsonb default null,
  p_excerpt_text text default null
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  n_created int;
  v_admin uuid := auth.uid();
  v_clean_note text := nullif(trim(p_note), '');
  v_topic int := coalesce(p_topic_idx, 0);
  v_ranges jsonb := p_excerpt_ranges;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_vol is null or p_file is null then
    raise exception 'vol, file required';
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;
  -- ranges precisa ser um array JSON não-vazio; qualquer outra coisa vira null
  if v_ranges is not null and (jsonb_typeof(v_ranges) <> 'array' or jsonb_array_length(v_ranges) = 0) then
    v_ranges := null;
  end if;

  insert into public.study_recommendations
    (user_id, vol, file, topic_idx, note, created_by, expires_at,
     excerpt_ranges, excerpt_text)
  select
    u.id, p_vol, p_file, v_topic, v_clean_note, v_admin, p_expires_at,
    v_ranges, nullif(trim(p_excerpt_text), '')
  from unnest(p_user_ids) as t(uid)
  join auth.users u on u.id = t.uid
  where u.deleted_at is null;

  get diagnostics n_created = row_count;
  return n_created;
end;
$$;

revoke all on function public.admin_create_recommendations_bulk(uuid[], text, text, int, text, timestamptz, jsonb, text) from public;
grant execute on function public.admin_create_recommendations_bulk(uuid[], text, text, int, text, timestamptz, jsonb, text) to authenticated;

-- ------------------------------------------------------------
-- get_my_recommendations — + excerpt_*
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
  excerpt_ranges jsonb, excerpt_text text,
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
    r.excerpt_ranges, r.excerpt_text,
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
-- get_my_recommendations_archived — + excerpt_*
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
  excerpt_ranges jsonb, excerpt_text text,
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
    r.excerpt_ranges, r.excerpt_text,
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
-- admin_get_user_recommendations — + excerpt_*
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
  excerpt_ranges jsonb, excerpt_text text,
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
    r.excerpt_ranges, r.excerpt_text,
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
