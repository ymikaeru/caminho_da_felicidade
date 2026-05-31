-- ============================================================
-- Mioshie Zenshu — Canal privado com o Reverendo (mensagens)
-- ============================================================
-- O inverso de study_recommendations: aqui o USUÁRIO envia, em
-- privado, uma reflexão/pergunta ao admin ("o Reverendo") a partir
-- de um ensinamento ou poema que está lendo. O Reverendo lê numa
-- caixa de entrada (admin), RESPONDE (o usuário vê a resposta + badge)
-- e, se for edificante, REPASSA — reaproveitando as RPCs de
-- recomendação que já existem (admin_create_recommendations_bulk / _all
-- e a variante de poesia). Esta migration NÃO cria nada de "repassar".
--
-- Canal 1:1 → SEM anonimato: o Reverendo vê quem enviou (precisa, pra
-- responder). O cliente não consegue ler mensagens de outros usuários
-- (RLS); admin lê todas via is_admin().
--
-- title_snapshot guarda o título exibível no momento do envio — assim
-- ensinamento E poema renderizam uniformemente sem depender de joins de
-- poesia. Pra ensinamento ainda fazemos left join teachings_topics
-- (título canônico/atualizado), com o snapshot como fallback (poema).
--
-- Pré-requisitos: public.is_admin() (restore_admin_and_rls.sql),
-- public.teachings_topics, public.user_profiles.
-- Idempotente. Execute no SQL Editor do Supabase Dashboard.
-- ============================================================

create table if not exists public.study_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vol text not null,
  file text not null,
  topic_idx int not null default 0,
  poem_topic_id text,                 -- só poema (vol='poetry')
  title_snapshot text,                -- título visto no envio (ensino ou poema)
  body text not null,                 -- a reflexão/pergunta do usuário
  created_at timestamptz not null default now(),
  admin_reply text,                   -- resposta do Reverendo (thread profundidade 1)
  replied_by uuid references auth.users(id) on delete set null,
  replied_at timestamptz,
  reply_seen_at timestamptz           -- quando o usuário viu a resposta (badge)
);

create index if not exists idx_sm_user_created
  on public.study_messages (user_id, created_at desc);

-- Inbox do admin: não-respondidas primeiro.
create index if not exists idx_sm_unanswered
  on public.study_messages (created_at desc)
  where admin_reply is null;

-- Badge do usuário: respostas ainda não vistas.
create index if not exists idx_sm_unseen_reply
  on public.study_messages (user_id)
  where admin_reply is not null and reply_seen_at is null;

alter table public.study_messages enable row level security;

-- Usuário lê as próprias; admin lê todas.
drop policy if exists "sm_read_own_or_admin" on public.study_messages;
create policy "sm_read_own_or_admin"
  on public.study_messages for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Escrita do usuário é SÓ via RPC security definer (send_study_message).
-- Admin pode escrever direto (resposta/curadoria também via RPC, mas a
-- policy cobre eventuais ações administrativas).
drop policy if exists "sm_admin_write" on public.study_messages;
create policy "sm_admin_write"
  on public.study_messages for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- RPC: send_study_message
-- ------------------------------------------------------------
-- O usuário envia uma mensagem ancorada num ensinamento/poema.
-- user_id = auth.uid(). Valida corpo não-vazio e ancoragem (vol/file).
-- Retorna o id criado.
-- ------------------------------------------------------------
create or replace function public.send_study_message(
  p_vol text,
  p_file text,
  p_topic_idx int default 0,
  p_poem_topic_id text default null,
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
    raise exception 'mensagem vazia';
  end if;
  if p_vol is null or p_file is null then
    raise exception 'vol e file são obrigatórios';
  end if;
  insert into public.study_messages
    (user_id, vol, file, topic_idx, poem_topic_id, title_snapshot, body)
  values
    (v_user, p_vol, p_file, coalesce(p_topic_idx, 0),
     nullif(trim(coalesce(p_poem_topic_id, '')), ''),
     nullif(trim(coalesce(p_title, '')), ''),
     trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.send_study_message(text, text, int, text, text, text) from public;
grant execute on function public.send_study_message(text, text, int, text, text, text) to authenticated;

-- ------------------------------------------------------------
-- RPC: get_my_messages
-- ------------------------------------------------------------
-- Mensagens do usuário corrente + a resposta do Reverendo. Título do
-- ensinamento via teachings_topics (poema cai no title_snapshot, no
-- cliente). replied_by_name pro cliente exibir "Reverendo ...".
-- ------------------------------------------------------------
create or replace function public.get_my_messages()
returns table(
  id uuid,
  vol text,
  file text,
  topic_idx int,
  poem_topic_id text,
  title_snapshot text,
  title_pt text,
  title_ja text,
  body text,
  created_at timestamptz,
  admin_reply text,
  replied_at timestamptz,
  replied_by_name text,
  reply_seen_at timestamptz
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
    m.id, m.vol, m.file, m.topic_idx, m.poem_topic_id,
    m.title_snapshot, t.title_pt, t.title_ja,
    m.body, m.created_at, m.admin_reply, m.replied_at,
    coalesce(p.display_name, '')::text as replied_by_name,
    m.reply_seen_at
  from public.study_messages m
  left join public.teachings_topics t
    on t.vol = m.vol and t.file = m.file and t.topic_idx = m.topic_idx
  left join public.user_profiles p
    on p.id = m.replied_by
  where m.user_id = v_user
  order by m.created_at desc;
end;
$$;

revoke all on function public.get_my_messages() from public;
grant execute on function public.get_my_messages() to authenticated;

-- ------------------------------------------------------------
-- RPC: get_my_messages_summary
-- ------------------------------------------------------------
-- Gate barato do badge. unread = respostas ainda não vistas.
-- ------------------------------------------------------------
create or replace function public.get_my_messages_summary()
returns table(total int, unread_replies int)
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
    count(*) filter (where admin_reply is not null and reply_seen_at is null)::int
  from public.study_messages
  where user_id = v_user;
end;
$$;

revoke all on function public.get_my_messages_summary() from public;
grant execute on function public.get_my_messages_summary() to authenticated;

-- ------------------------------------------------------------
-- RPC: mark_my_replies_seen
-- ------------------------------------------------------------
-- Chamado quando o usuário abre o modal de conversas. Marca as
-- respostas não-vistas como vistas. Idempotente.
-- ------------------------------------------------------------
create or replace function public.mark_my_replies_seen()
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
  update public.study_messages
     set reply_seen_at = now()
   where user_id = v_user
     and admin_reply is not null
     and reply_seen_at is null;
  get diagnostics n_updated = row_count;
  return n_updated;
end;
$$;

revoke all on function public.mark_my_replies_seen() from public;
grant execute on function public.mark_my_replies_seen() to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_get_messages
-- ------------------------------------------------------------
-- Inbox do admin: todas as mensagens, com remetente (nome + email) e
-- título do ensinamento. Não-respondidas primeiro, depois recentes.
-- ------------------------------------------------------------
create or replace function public.admin_get_messages()
returns table(
  id uuid,
  user_id uuid,
  sender_name text,
  sender_email text,
  vol text,
  file text,
  topic_idx int,
  poem_topic_id text,
  title_snapshot text,
  title_pt text,
  title_ja text,
  body text,
  created_at timestamptz,
  admin_reply text,
  replied_at timestamptz
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
    m.id, m.user_id,
    coalesce(p.display_name, '')::text as sender_name,
    coalesce(u.email, '')::text as sender_email,
    m.vol, m.file, m.topic_idx, m.poem_topic_id,
    m.title_snapshot, t.title_pt, t.title_ja,
    m.body, m.created_at, m.admin_reply, m.replied_at
  from public.study_messages m
  left join public.user_profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join public.teachings_topics t
    on t.vol = m.vol and t.file = m.file and t.topic_idx = m.topic_idx
  order by (m.admin_reply is null) desc, m.created_at desc;
end;
$$;

revoke all on function public.admin_get_messages() from public;
grant execute on function public.admin_get_messages() to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_reply_message
-- ------------------------------------------------------------
-- O Reverendo responde. replied_by = admin atual.
-- ------------------------------------------------------------
create or replace function public.admin_reply_message(p_id uuid, p_reply text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if nullif(trim(coalesce(p_reply, '')), '') is null then
    raise exception 'resposta vazia';
  end if;
  update public.study_messages
     set admin_reply = trim(p_reply),
         replied_by = auth.uid(),
         replied_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.admin_reply_message(uuid, text) from public;
grant execute on function public.admin_reply_message(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- RPC: admin_delete_message
-- ------------------------------------------------------------
create or replace function public.admin_delete_message(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  delete from public.study_messages where id = p_id;
end;
$$;

revoke all on function public.admin_delete_message(uuid) from public;
grant execute on function public.admin_delete_message(uuid) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select send_study_message('mioshiec1','zyobun.html',0,null,'Prefácio','Reverendo, achei lindo este trecho.');
-- select * from get_my_messages();
-- select * from get_my_messages_summary();
-- select * from admin_get_messages();              -- (como admin)
-- select admin_reply_message('<id>', 'Que bom! Reflita também sobre...');
-- select mark_my_replies_seen();                   -- (como o usuário dono)
-- ------------------------------------------------------------
