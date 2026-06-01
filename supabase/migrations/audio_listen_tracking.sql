-- ============================================================
-- Mioshie Zenshu — Analytics de Áudio (Recomendar Áudio)
-- ============================================================
-- Rastreia quem ouviu cada áudio recomendado e quanto ouviu.
-- Espelha o padrão de high-water mark do reader (add_max_scroll_pct.sql):
-- o cliente reporta o % máximo alcançado; o banco só sobe (GREATEST).
--
-- Decisões:
--   - Chave (user_id, audio_path): uma linha por usuário+áudio. Se o mesmo
--     áudio for recomendado de novo (re-poke), a leitura é a mesma — o que
--     importa é "essa pessoa ouviu esse áudio, e até onde".
--   - max_percent = ponto máximo alcançado (0-100), igual ao max_scroll_pct.
--   - completed = chegou ao fim (evento 'ended').
--   - Usuário NÃO escreve direto — log_audio_progress (security definer) é o
--     único caminho, igual mark_recommendations_seen.
--
-- Pré-requisitos: public.is_admin() helper (restore_admin_and_rls.sql),
--                 public.study_recommendations com audio_path/audio_title (v8).
-- Idempotente.
-- ============================================================

create table if not exists public.audio_listens (
  user_id uuid not null references auth.users(id) on delete cascade,
  audio_path text not null,
  max_percent smallint not null default 0 check (max_percent between 0 and 100),
  completed boolean not null default false,
  first_played_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, audio_path)
);

-- Acelera o agregado por áudio (group by audio_path).
create index if not exists idx_audio_listens_path
  on public.audio_listens (audio_path);

alter table public.audio_listens enable row level security;

-- Usuário lê só o seu; admin lê tudo.
drop policy if exists "al_read_own_or_admin" on public.audio_listens;
create policy "al_read_own_or_admin"
  on public.audio_listens for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Escrita direta só admin (na prática ninguém escreve direto — o cliente usa
-- a RPC security definer abaixo). Mantido por simetria com study_recommendations.
drop policy if exists "al_admin_write" on public.audio_listens;
create policy "al_admin_write"
  on public.audio_listens for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- RPC: log_audio_progress  (cliente — player do Recomendar Áudio)
-- ------------------------------------------------------------
-- Chamada barata no timeupdate (com throttle) e no 'ended'. Só sobe o
-- max_percent (high-water mark); completed vira true e nunca volta.
-- ------------------------------------------------------------
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

  insert into public.audio_listens (user_id, audio_path, max_percent, completed, first_played_at, updated_at)
  values (v_user, v_path, p_percent, coalesce(p_completed, false), now(), now())
  on conflict (user_id, audio_path)
  do update set
    max_percent = greatest(public.audio_listens.max_percent, excluded.max_percent),
    completed   = public.audio_listens.completed or excluded.completed,
    updated_at  = now();
end;
$$;

revoke all on function public.log_audio_progress(text, smallint, boolean) from public;
grant execute on function public.log_audio_progress(text, smallint, boolean) to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_get_audio_listens  (aba 🎧 Áudio — visão agregada)
-- ------------------------------------------------------------
-- Por áudio recomendado: quantos receberam, quantos ouviram (max>0),
-- % médio entre os que ouviram, e quantos completaram.
-- ------------------------------------------------------------
create or replace function public.admin_get_audio_listens()
returns table(
  audio_path text,
  audio_title text,
  recommended_to int,
  listeners int,
  avg_percent numeric,
  completed int
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
      and coalesce(p.role, '') <> 'admin'   -- admins não são público
    group by sr.audio_path
  ),
  listens as (
    select al.audio_path,
           count(*) filter (where al.max_percent > 0) as listeners,
           round(avg(al.max_percent) filter (where al.max_percent > 0), 0) as avg_percent,
           count(*) filter (where al.completed) as completed
    from public.audio_listens al
    left join public.user_profiles p on p.id = al.user_id
    where coalesce(p.role, '') <> 'admin'   -- admins não são público
    group by al.audio_path
  )
  select
    r.audio_path,
    r.audio_title,
    r.recommended_to::int,
    coalesce(l.listeners, 0)::int,
    coalesce(l.avg_percent, 0)::numeric,
    coalesce(l.completed, 0)::int
  from recs r
  left join listens l on l.audio_path = r.audio_path
  order by r.recommended_to desc, r.audio_path;
end;
$$;

revoke all on function public.admin_get_audio_listens() from public;
grant execute on function public.admin_get_audio_listens() to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_get_user_audio_listens(p_user_id)  (selo na aba Recomendações)
-- ------------------------------------------------------------
-- Todas as escutas de áudio de um usuário, pra casar com as recomendações
-- de áudio que ele recebeu (por audio_path) e mostrar "ouviu X%".
-- ------------------------------------------------------------
create or replace function public.admin_get_user_audio_listens(p_user_id uuid)
returns table(
  audio_path text,
  max_percent smallint,
  completed boolean,
  updated_at timestamptz
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
  select al.audio_path, al.max_percent, al.completed, al.updated_at
  from public.audio_listens al
  where al.user_id = p_user_id;
end;
$$;

revoke all on function public.admin_get_user_audio_listens(uuid) from public;
grant execute on function public.admin_get_user_audio_listens(uuid) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select log_audio_progress('rec-audio/exemplo.mp3', 42, false);
-- select * from admin_get_audio_listens();
-- select * from admin_get_user_audio_listens('<uuid>');
-- ------------------------------------------------------------
