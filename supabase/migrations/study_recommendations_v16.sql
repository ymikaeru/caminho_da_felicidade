-- ============================================================
-- study_recommendations v16
-- ------------------------------------------------------------
-- admin_get_user_recommendations passa a retornar source_collection_id /
-- source_collection_name (colunas já existentes na tabela), para a aba
-- Recomendações do admin AGRUPAR os itens por playlist, como o site faz.
-- Só adiciona 2 colunas ao retorno; nada mais muda.
-- ============================================================

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
  created_by_name text,
  source_collection_id uuid, source_collection_name text
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
    coalesce(p.display_name, '')::text,
    r.source_collection_id, r.source_collection_name
  from public.study_recommendations r
  left join public.teachings_topics t on t.vol = r.vol and t.file = r.file and t.topic_idx = r.topic_idx
  left join public.user_profiles p on p.id = r.created_by
  where r.user_id = p_user_id
  order by (r.archived_at is null and (r.expires_at is null or r.expires_at > now())) desc, r.created_at desc;
end;
$$;
revoke all on function public.admin_get_user_recommendations(uuid) from public;
grant execute on function public.admin_get_user_recommendations(uuid) to authenticated;
