-- ============================================================
-- Mioshie Zenshu — Recomendações v3: usuário pode arquivar
-- ============================================================
-- Adiciona:
--   - Coluna `archived_at` (nullable). Usuário pode marcar uma
--     recomendação como "arquivada" — some das listas dele, mas
--     a linha continua no banco (admin vê no histórico).
--   - RPC `archive_my_recommendation(p_id)`: usuário arquiva uma
--     das próprias recs.
--   - RPC `unarchive_my_recommendation(p_id)`: caso usuário queira
--     desarquivar (mostra de novo na lista ativa).
--   - Atualiza read RPCs (get_my_*) pra filtrar arquivadas do feed
--     ativo. Admin RPC (admin_get_user_recommendations) NÃO filtra —
--     mostra tudo, incluindo arquivadas, pra dar visibilidade do
--     histórico (sem notificação ativa).
--
-- Filosofia (decisão do produto): admin não é notificado sobre
-- arquivamento. Vê só passivamente no histórico se for olhar.
-- Idempotente.
-- ============================================================

alter table public.study_recommendations
  add column if not exists archived_at timestamptz;

-- ------------------------------------------------------------
-- RPC: archive_my_recommendation / unarchive_my_recommendation
-- ------------------------------------------------------------
create or replace function public.archive_my_recommendation(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  update public.study_recommendations
     set archived_at = now()
   where id = p_id
     and user_id = v_user;
end;
$$;

revoke all on function public.archive_my_recommendation(uuid) from public;
grant execute on function public.archive_my_recommendation(uuid) to authenticated;

create or replace function public.unarchive_my_recommendation(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  update public.study_recommendations
     set archived_at = null
   where id = p_id
     and user_id = v_user;
end;
$$;

revoke all on function public.unarchive_my_recommendation(uuid) from public;
grant execute on function public.unarchive_my_recommendation(uuid) to authenticated;

-- ------------------------------------------------------------
-- RPC: get_my_recommendations — filtra arquivadas
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
-- RPC: get_my_recommendations_summary — exclui arquivadas
-- ------------------------------------------------------------
create or replace function public.get_my_recommendations_summary()
returns table(total int, unseen int)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return query select 0, 0;
    return;
  end if;
  return query
  select
    count(*)::int,
    count(*) filter (where seen_at is null)::int
  from public.study_recommendations
  where user_id = v_user
    and archived_at is null
    and (expires_at is null or expires_at > now());
end;
$$;

revoke all on function public.get_my_recommendations_summary() from public;
grant execute on function public.get_my_recommendations_summary() to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_get_user_recommendations — NÃO filtra nada.
-- Retorna TUDO (ativas, arquivadas pelo usuário, e expiradas pelo
-- prazo). Admin tem histórico completo. UI distingue os 3 estados
-- por (archived_at, expires_at).
--
-- Decisão de produto: expiração não apaga, só arquiva pro usuário.
-- "Arquivada" e "expirada" são dois caminhos pro mesmo destino —
-- some do feed do usuário, fica no histórico do admin.
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
    coalesce(p.display_name, '')::text as created_by_name
  from public.study_recommendations r
  left join public.teachings_topics t
    on t.vol = r.vol and t.file = r.file and t.topic_idx = r.topic_idx
  left join public.user_profiles p
    on p.id = r.created_by
  where r.user_id = p_user_id
  order by
    -- Ativas primeiro, depois arquivadas/expiradas por data desc
    (r.archived_at is null
       and (r.expires_at is null or r.expires_at > now())) desc,
    r.created_at desc;
end;
$$;

revoke all on function public.admin_get_user_recommendations(uuid) from public;
grant execute on function public.admin_get_user_recommendations(uuid) to authenticated;

-- ------------------------------------------------------------
-- RPC: get_my_recommendations_archived — só as arquivadas pelo
-- usuário (não inclui expiradas). Consumida pela página
-- recomendacoes.html (aba "Arquivadas").
-- ------------------------------------------------------------
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
-- select archive_my_recommendation('<id>');
-- select * from get_my_recommendations(); -- arquivada some
-- select * from get_my_recommendations_archived(); -- só arquivadas
-- select * from admin_get_user_recommendations('<uid>'); -- todas
-- ------------------------------------------------------------
