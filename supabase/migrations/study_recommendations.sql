-- ============================================================
-- Mioshie Zenshu — Recomendações para Estudo
-- ============================================================
-- Admin cria recomendações de ensinamentos (vol/file/topic_idx) pra
-- usuários individuais, com nota livre opcional. Usuário vê um botão
-- na home + sandwich menu APENAS quando tem ≥1 recomendação ativa.
--
-- Decisões:
--   - Sem UNIQUE em (user_id, vol, file, topic_idx) — admin pode
--     "re-poke" o mesmo ensinamento numa semana diferente com nova nota.
--   - seen_at por linha (não por (user, teaching)) — re-poke gera nova
--     linha que volta a ser "não vista", mesmo que o ensinamento seja
--     familiar.
--   - Hard delete: admin pode remover recomendação. Sem soft delete.
--
-- Pré-requisitos: public.is_admin() helper (restore_admin_and_rls.sql).
-- Idempotente.
-- ============================================================

create table if not exists public.study_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vol text not null,
  file text not null,
  topic_idx int not null default 0,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

create index if not exists idx_sr_user_unseen
  on public.study_recommendations (user_id, seen_at)
  where seen_at is null;

create index if not exists idx_sr_user_created
  on public.study_recommendations (user_id, created_at desc);

alter table public.study_recommendations enable row level security;

-- Usuário lê suas próprias recomendações; admin lê todas.
drop policy if exists "sr_read_own_or_admin" on public.study_recommendations;
create policy "sr_read_own_or_admin"
  on public.study_recommendations for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Só admin pode inserir/atualizar/deletar.
-- Usuário NÃO escreve diretamente — `mark_recommendations_seen` (RPC
-- security definer) é o único caminho dele atualizar `seen_at`.
drop policy if exists "sr_admin_write" on public.study_recommendations;
create policy "sr_admin_write"
  on public.study_recommendations for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- RPC: get_my_recommendations
-- ------------------------------------------------------------
-- Retorna recomendações do usuário corrente, enriquecidas com título
-- atual do tópico (PT/JA) lido de teachings_topics. Ordena por
-- não-vista primeiro (created_at desc), depois vistas (seen_at desc).
-- ------------------------------------------------------------
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
    r.note, r.created_at, r.seen_at,
    coalesce(p.display_name, '')::text as created_by_name
  from public.study_recommendations r
  left join public.teachings_topics t
    on t.vol = r.vol and t.file = r.file and t.topic_idx = r.topic_idx
  left join public.user_profiles p
    on p.id = r.created_by
  where r.user_id = v_user
  order by (r.seen_at is null) desc, r.created_at desc;
end;
$$;

revoke all on function public.get_my_recommendations() from public;
grant execute on function public.get_my_recommendations() to authenticated;

-- ------------------------------------------------------------
-- RPC: get_my_recommendations_unseen_count
-- ------------------------------------------------------------
-- Bagatela barata pro gate inicial (badge). Dois round-trips
-- (count + lista no clique) é mais leve do que carregar a lista
-- inteira em todo page load só pra saber se mostra o botão.
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
  where user_id = v_user;
end;
$$;

revoke all on function public.get_my_recommendations_summary() from public;
grant execute on function public.get_my_recommendations_summary() to authenticated;

-- ------------------------------------------------------------
-- RPC: mark_recommendations_seen
-- ------------------------------------------------------------
-- Chamado quando o usuário abre o modal. Marca todas as não-vistas
-- como vistas agora. Idempotente — re-chamar não muda nada se já
-- estão todas vistas.
-- ------------------------------------------------------------
create or replace function public.mark_recommendations_seen()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  n_updated int;
begin
  if v_user is null then
    return 0;
  end if;
  update public.study_recommendations
     set seen_at = now()
   where user_id = v_user and seen_at is null;
  get diagnostics n_updated = row_count;
  return n_updated;
end;
$$;

revoke all on function public.mark_recommendations_seen() from public;
grant execute on function public.mark_recommendations_seen() to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_get_user_recommendations(p_user_id)
-- ------------------------------------------------------------
-- Admin lista as recomendações de um usuário específico (pra UI
-- de gestão). Retorna mesmo shape que get_my_recommendations
-- pra reaproveitar a função de render.
-- ------------------------------------------------------------
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
    r.note, r.created_at, r.seen_at,
    coalesce(p.display_name, '')::text as created_by_name
  from public.study_recommendations r
  left join public.teachings_topics t
    on t.vol = r.vol and t.file = r.file and t.topic_idx = r.topic_idx
  left join public.user_profiles p
    on p.id = r.created_by
  where r.user_id = p_user_id
  order by r.created_at desc;
end;
$$;

revoke all on function public.admin_get_user_recommendations(uuid) from public;
grant execute on function public.admin_get_user_recommendations(uuid) to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_create_recommendation
-- ------------------------------------------------------------
-- Cria uma recomendação. created_by = admin atual. Retorna o id.
-- ------------------------------------------------------------
create or replace function public.admin_create_recommendation(
  p_user_id uuid,
  p_vol text,
  p_file text,
  p_topic_idx int default 0,
  p_note text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_user_id is null or p_vol is null or p_file is null then
    raise exception 'user_id, vol, file required';
  end if;
  insert into public.study_recommendations
    (user_id, vol, file, topic_idx, note, created_by)
  values
    (p_user_id, p_vol, p_file, coalesce(p_topic_idx, 0), nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.admin_create_recommendation(uuid, text, text, int, text) from public;
grant execute on function public.admin_create_recommendation(uuid, text, text, int, text) to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_delete_recommendation
-- ------------------------------------------------------------
create or replace function public.admin_delete_recommendation(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  delete from public.study_recommendations where id = p_id;
end;
$$;

revoke all on function public.admin_delete_recommendation(uuid) from public;
grant execute on function public.admin_delete_recommendation(uuid) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select * from get_my_recommendations_summary();
-- select * from get_my_recommendations();
-- select admin_create_recommendation('<uuid>', 'mioshiec1', 'zyobun.html', 0, 'pra refletir');
-- ------------------------------------------------------------
