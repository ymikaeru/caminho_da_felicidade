-- ============================================================
-- Mioshie Zenshu — Recomendações v2: expiração + broadcast
-- ============================================================
-- Adiciona:
--   - Coluna `expires_at` (nullable). Quando preenchida, a recomendação
--     some das listas/contadores após esse horário (filtro nas RPCs).
--     Não apaga do banco — admin pode auditar histórico.
--   - RPC `admin_create_recommendation_all`: cria uma cópia da rec para
--     cada usuário cadastrado AGORA. Novos usuários cadastrados depois
--     não vão receber.
--   - Versão v2 das RPCs read (`get_my_recommendations*`) filtrando por
--     `(expires_at is null or expires_at > now())`.
--
-- Idempotente.
-- ============================================================

alter table public.study_recommendations
  add column if not exists expires_at timestamptz;

-- Índice composto pra cobrir "minhas recs ordenadas". Sem predicado
-- WHERE — `now()` não é IMMUTABLE, então Postgres rejeita em partial
-- index. O filtro `expires_at is null or expires_at > now()` roda no
-- runtime das RPCs; o índice ainda ajuda no order by + user scan.
create index if not exists idx_sr_user_created_active
  on public.study_recommendations (user_id, created_at desc);

-- ------------------------------------------------------------
-- RPC: get_my_recommendations — agora filtra expiradas
-- ------------------------------------------------------------
-- Drop antes de recriar — Postgres não permite mudar return type
-- (adicionamos `expires_at` ao OUT) via CREATE OR REPLACE.
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
    and (r.expires_at is null or r.expires_at > now())
  order by (r.seen_at is null) desc, r.created_at desc;
end;
$$;

revoke all on function public.get_my_recommendations() from public;
grant execute on function public.get_my_recommendations() to authenticated;

-- ------------------------------------------------------------
-- RPC: get_my_recommendations_summary — exclui expiradas do count
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
    and (expires_at is null or expires_at > now());
end;
$$;

revoke all on function public.get_my_recommendations_summary() from public;
grant execute on function public.get_my_recommendations_summary() to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_get_user_recommendations — também filtra expiradas
-- (Mantemos histórico no banco, mas a UI vê só ativas)
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
    r.note, r.created_at, r.seen_at, r.expires_at,
    coalesce(p.display_name, '')::text as created_by_name
  from public.study_recommendations r
  left join public.teachings_topics t
    on t.vol = r.vol and t.file = r.file and t.topic_idx = r.topic_idx
  left join public.user_profiles p
    on p.id = r.created_by
  where r.user_id = p_user_id
    and (r.expires_at is null or r.expires_at > now())
  order by r.created_at desc;
end;
$$;

revoke all on function public.admin_get_user_recommendations(uuid) from public;
grant execute on function public.admin_get_user_recommendations(uuid) to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_create_recommendation — agora aceita expires_at
-- ------------------------------------------------------------
create or replace function public.admin_create_recommendation(
  p_user_id uuid,
  p_vol text,
  p_file text,
  p_topic_idx int default 0,
  p_note text default null,
  p_expires_at timestamptz default null
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
    (user_id, vol, file, topic_idx, note, created_by, expires_at)
  values
    (p_user_id, p_vol, p_file, coalesce(p_topic_idx, 0),
     nullif(trim(p_note), ''), auth.uid(), p_expires_at)
  returning id into v_id;
  return v_id;
end;
$$;

-- Versão antiga sem p_expires_at fica disponível pra back-compat. Drop
-- da nova com 6 args + recreate. Não há nada legacy chamando com 5.
revoke all on function public.admin_create_recommendation(uuid, text, text, int, text, timestamptz) from public;
grant execute on function public.admin_create_recommendation(uuid, text, text, int, text, timestamptz) to authenticated;

-- Remove a assinatura antiga (5 args) pra evitar ambiguidade — só a v2
-- com expires_at sobrevive. Idempotente.
drop function if exists public.admin_create_recommendation(uuid, text, text, int, text);

-- ------------------------------------------------------------
-- RPC: admin_create_recommendation_all — broadcast pra todos
-- usuários cadastrados no momento. Retorna a quantidade criada.
-- ------------------------------------------------------------
create or replace function public.admin_create_recommendation_all(
  p_vol text,
  p_file text,
  p_topic_idx int default 0,
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
  v_clean_note text := nullif(trim(p_note), '');
  v_topic int := coalesce(p_topic_idx, 0);
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_vol is null or p_file is null then
    raise exception 'vol, file required';
  end if;

  -- Insere uma linha por usuário existente em auth.users.
  -- Nota: usamos auth.users diretamente (não user_profiles) pra cobrir
  -- usuários que tenham auth mas sem profile registrado.
  insert into public.study_recommendations
    (user_id, vol, file, topic_idx, note, created_by, expires_at)
  select
    u.id, p_vol, p_file, v_topic, v_clean_note, v_admin, p_expires_at
  from auth.users u
  where u.deleted_at is null;

  get diagnostics n_created = row_count;
  return n_created;
end;
$$;

revoke all on function public.admin_create_recommendation_all(text, text, int, text, timestamptz) from public;
grant execute on function public.admin_create_recommendation_all(text, text, int, text, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select admin_create_recommendation_all('mioshiec1', 'zyobun.html', 0,
--   'avisos de fim de ano', (now() + interval '30 days'));
-- select * from get_my_recommendations();
-- ------------------------------------------------------------
