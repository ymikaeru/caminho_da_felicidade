-- ============================================================
-- Mioshie Zenshu — Analytics de Áudio: contador de REPETIÇÕES (conclusões)
-- ============================================================
-- Conta quantas vezes cada pessoa ouviu um áudio recomendado ATÉ O FIM.
-- Até aqui o modelo era high-water mark (audio_listen_tracking.sql): uma linha
-- por user+áudio com max_percent + completed (bool). Aqui só somamos um
-- contador a cada conclusão.
--
-- Como conta: o player (recommendations.js) já chama log_audio_progress com
-- p_completed=true UMA vez por escuta-até-o-fim (trava flushedDone por sessão
-- do player). Incrementamos completions nesse sinal. Repetir DENTRO da mesma
-- sessão (sem fechar a cartinha) não conta de novo; fechar e ouvir de novo
-- conta +1. Não precisou mexer no player.
--
-- ⚠️ Conta só A PARTIR do deploy desta migration — não há histórico de
-- repetições anteriores. O backfill abaixo dá baseline 1 a quem já consta
-- como 'completed' (sabemos que completou ao menos 1×).
--
-- Idempotente. Execute no SQL Editor do Supabase Dashboard.
-- Pré-requisitos: audio_listen_tracking.sql + audio_listen_listeners.sql.
-- ============================================================

-- 1) Coluna contadora ----------------------------------------------------------
alter table public.audio_listens
  add column if not exists completions int not null default 0;

-- Backfill: quem já está 'completed' conta como ao menos 1 conclusão.
update public.audio_listens
   set completions = 1
 where completed = true and completions = 0;

-- 2) RPC do player: incrementa completions a cada p_completed=true -------------
create or replace function public.log_audio_progress(
  p_audio_path text,
  p_percent smallint,
  p_completed boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_path text := nullif(trim(p_audio_path), '');
  v_done boolean := coalesce(p_completed, false);
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if v_path is null then
    return;
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    return;
  end if;

  insert into public.audio_listens (user_id, audio_path, max_percent, completed, completions, first_played_at, updated_at)
  values (v_user, v_path, p_percent, v_done, (case when v_done then 1 else 0 end), now(), now())
  on conflict (user_id, audio_path)
  do update set
    max_percent = greatest(public.audio_listens.max_percent, excluded.max_percent),
    completed   = public.audio_listens.completed or excluded.completed,
    completions = public.audio_listens.completions + (case when excluded.completed then 1 else 0 end),
    updated_at  = now();
end;
$$;

revoke all on function public.log_audio_progress(text, smallint, boolean) from public;
grant execute on function public.log_audio_progress(text, smallint, boolean) to authenticated;

-- 3) Agregado por áudio: + total de conclusões (soma) -------------------------
create or replace function public.admin_get_audio_listens()
returns table(
  audio_path text,
  audio_title text,
  recommended_to int,
  listeners int,
  avg_percent numeric,
  completed int,
  total_completions int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return query
  with recs as (
    select sr.audio_path,
           max(sr.audio_title) as audio_title,
           count(distinct sr.user_id) as recommended_to
    from public.study_recommendations sr
    left join public.user_profiles p on p.id = sr.user_id
    where sr.audio_path is not null
      and coalesce(p.role, '') <> 'admin'
    group by sr.audio_path
  ),
  listens as (
    select al.audio_path,
           count(*) filter (where al.max_percent > 0) as listeners,
           round(avg(al.max_percent) filter (where al.max_percent > 0), 0) as avg_percent,
           count(*) filter (where al.completed) as completed,
           coalesce(sum(al.completions), 0) as total_completions
    from public.audio_listens al
    left join public.user_profiles p on p.id = al.user_id
    where coalesce(p.role, '') <> 'admin'
    group by al.audio_path
  )
  select
    r.audio_path,
    r.audio_title,
    r.recommended_to::int,
    coalesce(l.listeners, 0)::int,
    coalesce(l.avg_percent, 0)::numeric,
    coalesce(l.completed, 0)::int,
    coalesce(l.total_completions, 0)::int
  from recs r
  left join listens l on l.audio_path = r.audio_path
  order by r.recommended_to desc, r.audio_path;
end;
$$;

revoke all on function public.admin_get_audio_listens() from public;
grant execute on function public.admin_get_audio_listens() to authenticated;

-- 4) Por pessoa (drill-down): + completions -----------------------------------
drop function if exists public.admin_get_audio_listeners(text);

create or replace function public.admin_get_audio_listeners(p_audio_path text)
returns table(
  user_id uuid,
  display_name text,
  max_percent smallint,
  completed boolean,
  completions int,
  updated_at timestamptz,
  archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return query
  with recipients as (
    select distinct on (sr.user_id)
           sr.user_id, sr.archived_at
    from public.study_recommendations sr
    left join public.user_profiles pr on pr.id = sr.user_id
    where sr.audio_path = p_audio_path
      and coalesce(pr.role, '') <> 'admin'
    order by sr.user_id, sr.created_at desc
  )
  select
    r.user_id,
    coalesce(p.display_name, '')::text,
    coalesce(al.max_percent, 0)::smallint,
    coalesce(al.completed, false),
    coalesce(al.completions, 0)::int,
    al.updated_at,
    r.archived_at
  from recipients r
  left join public.audio_listens al
    on al.user_id = r.user_id and al.audio_path = p_audio_path
  left join public.user_profiles p
    on p.id = r.user_id
  order by coalesce(al.max_percent, 0) desc, coalesce(p.display_name, '');
end;
$$;

revoke all on function public.admin_get_audio_listeners(text) from public;
grant execute on function public.admin_get_audio_listeners(text) to authenticated;

-- Sanity:
-- select * from admin_get_audio_listens();
-- select * from admin_get_audio_listeners('audio/<uuid>.mp3');
-- ============================================================
