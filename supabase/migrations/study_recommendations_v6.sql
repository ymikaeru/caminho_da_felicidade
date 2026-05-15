-- ============================================================
-- Mioshie Zenshu — Recomendações v6: indicador "lida"
-- ============================================================
-- Adiciona `read_at` ao retorno de admin_get_user_recommendations.
-- Cruza com public.access_logs pra detectar se o usuário acessou
-- o ensinamento recomendado DEPOIS da criação da rec.
--
-- Motivo: `seen_at` só registra que o usuário abriu o modal de
-- recomendações (não que clicou no link e leu o ensinamento). O
-- admin precisa distinguir "viu o título" de "leu o conteúdo".
--
-- `read_at` = MIN(access_logs.created_at) onde:
--   - user_id = recomendação.user_id
--   - volume   = recomendação.vol
--   - file     = recomendação.file
--   - action   = 'view'   (ignora 'copy'/'cut' do content-protection)
--   - created_at >= recomendação.created_at
--
-- NULL = ainda não acessou desde que a rec foi criada.
-- Idempotente.
-- ============================================================

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
-- Sanity:
-- select id, seen_at, read_at from admin_get_user_recommendations('<uid>');
--   seen_at  → quando o usuário abriu o modal de recs
--   read_at  → quando o usuário efetivamente acessou o reader do ensinamento
-- ------------------------------------------------------------
