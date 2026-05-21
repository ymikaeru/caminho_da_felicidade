-- ============================================================
-- Mioshie Zenshu — Recomendações v7: source_collection no retorno
-- ============================================================
-- Bumpa get_my_recommendations + get_my_recommendations_archived pra
-- incluir source_collection_id e source_collection_name. Isso permite
-- agrupar visualmente as recomendações vindas de uma mesma playlist
-- em recomendacoes.html ("📂 Sobre o Daimiroku — 8 ensinamentos").
--
-- Snapshot do nome em source_collection_name foi preenchido em
-- send_playlist_recommendations (collections.sql). Sobrevive a admin
-- renomear/apagar a playlist depois.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- RPC: get_my_recommendations — agora retorna source_collection_*
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
-- RPC: get_my_recommendations_archived — idem pra aba "Arquivadas"
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
-- Sanity:
-- select id, source_collection_name from get_my_recommendations();
-- ------------------------------------------------------------
