-- ============================================================
-- Mioshie Zenshu — Mural de Descobertas (feed anônimo entre usuários)
-- ============================================================
-- Feed GLOBAL e ANÔNIMO: qualquer membro logado publica uma "descoberta"
-- (percepção ancorada a um ensinamento ou poema); os outros leem e reagem
-- com um toque (🙏). Pré-moderação: o post entra 'pending' e só aparece
-- depois que o admin aprova.
--
-- ANONIMATO POR CONSTRUÇÃO — leitura é RPC-only:
-- RLS gateia LINHAS, não colunas. Uma policy de SELECT permissiva + PostgREST
-- deixaria o cliente ler author_id de todo post. Por isso study_posts NÃO
-- tem SELECT para 'authenticated' (só admin); o feed sai por get_study_feed
-- (security definer) que OMITE author_id. study_post_reactions idem: sem
-- SELECT direto (senão "fulano reagiu ao post X" vaza) — RLS habilitado e
-- SEM policy = só as funções security-definer acessam. (Anônimo AOS PARES;
-- o admin sempre vê o autor, para moderar.)
--
-- excerpt = conteúdo a exibir INLINE no card: o POEMA inteiro (poemas, que
-- são curtos → aparecem abertos no feed) ou, no fast-follow, o trecho grifado
-- de um ensinamento. Ensinamento sem excerpt mostra só título + link "abrir".
--
-- Pré-requisitos: public.is_admin(), public.teachings_topics, user_profiles.
-- Idempotente. Execute no SQL Editor do Supabase Dashboard.
-- ============================================================

create table if not exists public.study_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,  -- nunca exposto a não-admin
  vol text not null,
  file text not null,
  topic_idx int not null default 0,
  poem_topic_id text,                 -- só poema (vol='poetry')
  excerpt text,                       -- conteúdo inline (poema inteiro; ou trecho grifado)
  title_snapshot text,                -- título exibível (ensino ou "Coletânea · № N — Título")
  body text not null,                 -- a descoberta
  status text not null default 'pending' check (status in ('pending','approved','hidden')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_sp_feed
  on public.study_posts (status, created_at desc);
create index if not exists idx_sp_pending
  on public.study_posts (created_at desc) where status = 'pending';

create table if not exists public.study_post_reactions (
  post_id uuid not null references public.study_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.study_posts enable row level security;
alter table public.study_post_reactions enable row level security;

-- study_posts: leitura direta só admin (o resto via RPC anônima).
drop policy if exists "sp_read_admin" on public.study_posts;
create policy "sp_read_admin"
  on public.study_posts for select to authenticated
  using (public.is_admin());

drop policy if exists "sp_admin_write" on public.study_posts;
create policy "sp_admin_write"
  on public.study_posts for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- study_post_reactions: RLS habilitado e SEM policy → nenhum acesso direto
-- (nem admin). Tudo passa pelas funções security-definer abaixo.

-- ------------------------------------------------------------
-- RPC: create_study_post  (usuário publica → entra 'pending')
-- ------------------------------------------------------------
create or replace function public.create_study_post(
  p_vol text,
  p_file text,
  p_topic_idx int default 0,
  p_poem_topic_id text default null,
  p_excerpt text default null,
  p_title text default null,
  p_body text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'auth required';
  end if;
  if nullif(trim(coalesce(p_body, '')), '') is null then
    raise exception 'descoberta vazia';
  end if;
  if p_vol is null or p_file is null then
    raise exception 'vol e file são obrigatórios';
  end if;
  insert into public.study_posts
    (author_id, vol, file, topic_idx, poem_topic_id, excerpt, title_snapshot, body, status)
  values
    (v_user, p_vol, p_file, coalesce(p_topic_idx, 0),
     nullif(trim(coalesce(p_poem_topic_id, '')), ''),
     nullif(trim(coalesce(p_excerpt, '')), ''),
     nullif(trim(coalesce(p_title, '')), ''),
     trim(p_body), 'pending')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_study_post(text, text, int, text, text, text, text) from public;
grant execute on function public.create_study_post(text, text, int, text, text, text, text) to authenticated;

-- ------------------------------------------------------------
-- RPC: get_study_feed  (anônimo — SEM author_id; keyset paginado)
-- ------------------------------------------------------------
-- Só posts aprovados. reaction_count + i_reacted computados no servidor,
-- então identidade de quem reagiu nunca chega aos pares.
-- ------------------------------------------------------------
create or replace function public.get_study_feed(
  p_limit int default 20,
  p_before timestamptz default null
)
returns table(
  id uuid,
  vol text,
  file text,
  topic_idx int,
  poem_topic_id text,
  excerpt text,
  title_snapshot text,
  body text,
  approved_at timestamptz,
  reaction_count int,
  i_reacted boolean
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
  -- Ordena/pagina por approved_at: com pré-moderação, o "momento de
  -- publicação" é a aprovação, não a submissão. Assim um post aprovado
  -- agora entra no TOPO do feed (não enterrado pela data de escrita).
  return query
  select
    p.id, p.vol, p.file, p.topic_idx, p.poem_topic_id,
    p.excerpt, p.title_snapshot, p.body, p.approved_at,
    (select count(*) from public.study_post_reactions r where r.post_id = p.id)::int,
    exists(select 1 from public.study_post_reactions r where r.post_id = p.id and r.user_id = v_user)
  from public.study_posts p
  where p.status = 'approved'
    and (p_before is null or p.approved_at < p_before)
  order by p.approved_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

revoke all on function public.get_study_feed(int, timestamptz) from public;
grant execute on function public.get_study_feed(int, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- RPC: toggle_post_reaction  → (reacted, count) atual
-- ------------------------------------------------------------
create or replace function public.toggle_post_reaction(p_post_id uuid)
returns table(reacted boolean, count int)
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_status text;
  v_exists boolean;
begin
  if v_user is null then
    raise exception 'auth required';
  end if;
  select status into v_status from public.study_posts where id = p_post_id;
  if v_status is null then
    raise exception 'post não encontrado';
  end if;
  if v_status <> 'approved' then
    raise exception 'post não disponível';
  end if;
  select exists(
    select 1 from public.study_post_reactions
    where post_id = p_post_id and user_id = v_user
  ) into v_exists;
  if v_exists then
    delete from public.study_post_reactions where post_id = p_post_id and user_id = v_user;
  else
    insert into public.study_post_reactions (post_id, user_id)
    values (p_post_id, v_user) on conflict do nothing;
  end if;
  return query
  select (not v_exists),
         (select count(*) from public.study_post_reactions where post_id = p_post_id)::int;
end;
$$;

revoke all on function public.toggle_post_reaction(uuid) from public;
grant execute on function public.toggle_post_reaction(uuid) to authenticated;

-- ------------------------------------------------------------
-- RPC: get_mural_summary  → badge "novas descobertas"
-- ------------------------------------------------------------
-- Cliente compara `newest` com o last_seen guardado no localStorage.
-- ------------------------------------------------------------
create or replace function public.get_mural_summary()
returns table(newest timestamptz, total int)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return query select null::timestamptz, 0;
    return;
  end if;
  -- newest por approved_at (quando entrou no mural), p/ o badge de novidade.
  return query
  select max(p.approved_at), count(*)::int
  from public.study_posts p
  where p.status = 'approved';
end;
$$;

revoke all on function public.get_mural_summary() from public;
grant execute on function public.get_mural_summary() to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_get_posts  (fila de moderação — COM autor; pending primeiro)
-- ------------------------------------------------------------
create or replace function public.admin_get_posts(p_status text default null)
returns table(
  id uuid,
  author_name text,
  author_email text,
  vol text,
  file text,
  topic_idx int,
  poem_topic_id text,
  excerpt text,
  title_snapshot text,
  body text,
  status text,
  created_at timestamptz,
  reaction_count int
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
    p.id,
    coalesce(up.display_name, '')::text,
    coalesce(u.email, '')::text,
    p.vol, p.file, p.topic_idx, p.poem_topic_id,
    p.excerpt, p.title_snapshot, p.body, p.status, p.created_at,
    (select count(*) from public.study_post_reactions r where r.post_id = p.id)::int
  from public.study_posts p
  left join public.user_profiles up on up.id = p.author_id
  left join auth.users u on u.id = p.author_id
  where (p_status is null or p.status = p_status)
  order by (p.status = 'pending') desc, p.created_at desc;
end;
$$;

revoke all on function public.admin_get_posts(text) from public;
grant execute on function public.admin_get_posts(text) to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_approve_post / admin_set_post_status / admin_delete_post
-- ------------------------------------------------------------
create or replace function public.admin_approve_post(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  update public.study_posts
     set status = 'approved', approved_at = now(), approved_by = auth.uid()
   where id = p_id;
end;
$$;

revoke all on function public.admin_approve_post(uuid) from public;
grant execute on function public.admin_approve_post(uuid) to authenticated;

create or replace function public.admin_set_post_status(p_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_status not in ('pending','approved','hidden') then
    raise exception 'status inválido';
  end if;
  update public.study_posts set status = p_status where id = p_id;
end;
$$;

revoke all on function public.admin_set_post_status(uuid, text) from public;
grant execute on function public.admin_set_post_status(uuid, text) to authenticated;

create or replace function public.admin_delete_post(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  delete from public.study_posts where id = p_id;
end;
$$;

revoke all on function public.admin_delete_post(uuid) from public;
grant execute on function public.admin_delete_post(uuid) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select create_study_post('poetry','yama-to-mizu',0,'poema-12',E'verso 1\nverso 2','Yama to Mizu · № 12','Esse verso me lembrou da gratidão.');
-- select * from get_study_feed();              -- vazio até aprovar
-- select * from admin_get_posts('pending');    -- (como admin)
-- select admin_approve_post('<id>');
-- select * from get_study_feed();              -- agora aparece, sem author
-- select * from toggle_post_reaction('<id>');  -- (reacted, count)
-- ------------------------------------------------------------
