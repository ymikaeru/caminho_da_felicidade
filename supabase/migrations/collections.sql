-- ============================================================
-- Mioshie Zenshu — Coleções (playlists do admin)
-- ============================================================
-- Admin monta playlists temáticas de ensinamentos pra:
--   1) curar conteúdo reutilizável ("Sobre o Daimiroku", "Iniciantes"...)
--   2) recomendar a playlist em lote (com cherry-pick por destinatário)
--   3) imprimir apostila física via pdf-booklet
--
-- Lado usuário ganha só agrupamento visual em recomendacoes.html
-- (via source_collection_name snapshot em study_recommendations).
-- Sem refit do modal de salvos, sem bandeja, sem card-tema ainda.
--
-- Pré-requisitos: public.is_admin() (restore_admin_and_rls.sql).
-- Idempotente.
-- Ref: docs/design/001-colecoes-ensinamentos-salvos.md
-- ============================================================

-- ------------------------------------------------------------
-- Tabela: collections (playlists do admin)
-- ------------------------------------------------------------
-- user_id existe pra suportar "playlists do usuário" no futuro;
-- por ora RLS gateia tudo via is_admin() e o owner é quem criou.
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_collections_user
  on public.collections (user_id, created_at desc);

alter table public.collections enable row level security;

-- Só admin enxerga/escreve nessa primeira versão.
drop policy if exists "col_admin_all" on public.collections;
create policy "col_admin_all"
  on public.collections for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- Tabela: collection_items (ensinamentos dentro da playlist)
-- ------------------------------------------------------------
-- Mesmo (vol, file, topic_idx) só pode aparecer 1× por coleção,
-- mas pode aparecer em N coleções diferentes (uma row por coleção).
create table if not exists public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  vol text not null,
  file text not null,
  topic_idx int not null default 0,
  pos int not null,
  added_at timestamptz not null default now(),
  primary key (collection_id, vol, file, topic_idx)
);

create index if not exists idx_collection_items_order
  on public.collection_items (collection_id, pos);

alter table public.collection_items enable row level security;

-- Mesma política da collections: só admin.
drop policy if exists "coli_admin_all" on public.collection_items;
create policy "coli_admin_all"
  on public.collection_items for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- Alter: study_recommendations ganha origem da playlist
-- ------------------------------------------------------------
-- source_collection_id   → FK pra navegação/filtro; SET NULL se admin
--                          apagar a playlist (recomendação sobrevive).
-- source_collection_name → snapshot do nome no envio. Mesmo se admin
--                          renomear/apagar a playlist depois, o
--                          cabeçalho do grupo no usuário não quebra.
alter table public.study_recommendations
  add column if not exists source_collection_id uuid
    references public.collections(id) on delete set null,
  add column if not exists source_collection_name text;

create index if not exists idx_sr_source_collection
  on public.study_recommendations (user_id, source_collection_id)
  where source_collection_id is not null;

-- ============================================================
-- RPCs — CRUD de playlists (admin)
-- ============================================================

-- ------------------------------------------------------------
-- create_collection(name) → uuid
-- ------------------------------------------------------------
create or replace function public.create_collection(p_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  v_name := nullif(trim(p_name), '');
  if v_name is null then
    raise exception 'name required';
  end if;
  insert into public.collections (user_id, name)
  values (auth.uid(), v_name)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_collection(text) from public;
grant execute on function public.create_collection(text) to authenticated;

-- ------------------------------------------------------------
-- rename_collection(id, new_name)
-- ------------------------------------------------------------
create or replace function public.rename_collection(p_id uuid, p_new_name text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  v_name := nullif(trim(p_new_name), '');
  if v_name is null then
    raise exception 'name required';
  end if;
  update public.collections
     set name = v_name, updated_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.rename_collection(uuid, text) from public;
grant execute on function public.rename_collection(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- delete_collection(id)
-- ------------------------------------------------------------
-- Hard delete. collection_items cai via cascade.
-- study_recommendations.source_collection_id vira NULL (SET NULL).
-- source_collection_name preservado (snapshot) — cabeçalho do grupo
-- no usuário continua funcionando.
create or replace function public.delete_collection(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  delete from public.collections where id = p_id;
end;
$$;

revoke all on function public.delete_collection(uuid) from public;
grant execute on function public.delete_collection(uuid) to authenticated;

-- ------------------------------------------------------------
-- list_my_collections() → playlists do admin atual + contagem
-- ------------------------------------------------------------
create or replace function public.list_my_collections()
returns table(
  id uuid,
  name text,
  created_at timestamptz,
  updated_at timestamptz,
  item_count int
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  return query
  select c.id, c.name, c.created_at, c.updated_at,
    (select count(*)::int from public.collection_items ci where ci.collection_id = c.id) as item_count
  from public.collections c
  where c.user_id = auth.uid()
  order by c.updated_at desc;
end;
$$;

revoke all on function public.list_my_collections() from public;
grant execute on function public.list_my_collections() to authenticated;

-- ------------------------------------------------------------
-- get_collection_with_items(id) → playlist + itens enriquecidos
-- ------------------------------------------------------------
-- Itens vêm com title_pt/title_ja de teachings_topics pra UI.
create or replace function public.get_collection_with_items(p_id uuid)
returns table(
  collection_id uuid,
  collection_name text,
  vol text,
  file text,
  topic_idx int,
  pos int,
  title_pt text,
  title_ja text,
  added_at timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  return query
  select c.id, c.name,
    ci.vol, ci.file, ci.topic_idx, ci.pos,
    t.title_pt, t.title_ja,
    ci.added_at
  from public.collections c
  join public.collection_items ci on ci.collection_id = c.id
  left join public.teachings_topics t
    on t.vol = ci.vol and t.file = ci.file and t.topic_idx = ci.topic_idx
  where c.id = p_id
  order by ci.pos asc, ci.added_at asc;
end;
$$;

revoke all on function public.get_collection_with_items(uuid) from public;
grant execute on function public.get_collection_with_items(uuid) to authenticated;

-- ============================================================
-- RPCs — Operações sobre itens
-- ============================================================

-- ------------------------------------------------------------
-- add_to_collection(collection_id, vol, file, topic_idx)
-- ------------------------------------------------------------
-- Append no final. Se já existe (PK conflito), ignora silenciosamente.
create or replace function public.add_to_collection(
  p_collection_id uuid,
  p_vol text,
  p_file text,
  p_topic_idx int default 0
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_next_pos int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_vol is null or p_file is null then
    raise exception 'vol, file required';
  end if;
  select coalesce(max(pos), 0) + 1
    into v_next_pos
    from public.collection_items
    where collection_id = p_collection_id;
  insert into public.collection_items (collection_id, vol, file, topic_idx, pos)
  values (p_collection_id, p_vol, p_file, coalesce(p_topic_idx, 0), v_next_pos)
  on conflict do nothing;
  update public.collections set updated_at = now() where id = p_collection_id;
end;
$$;

revoke all on function public.add_to_collection(uuid, text, text, int) from public;
grant execute on function public.add_to_collection(uuid, text, text, int) to authenticated;

-- ------------------------------------------------------------
-- remove_from_collection(collection_id, vol, file, topic_idx)
-- ------------------------------------------------------------
create or replace function public.remove_from_collection(
  p_collection_id uuid,
  p_vol text,
  p_file text,
  p_topic_idx int default 0
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  delete from public.collection_items
    where collection_id = p_collection_id
      and vol = p_vol
      and file = p_file
      and topic_idx = coalesce(p_topic_idx, 0);
  update public.collections set updated_at = now() where id = p_collection_id;
end;
$$;

revoke all on function public.remove_from_collection(uuid, text, text, int) from public;
grant execute on function public.remove_from_collection(uuid, text, text, int) to authenticated;

-- ------------------------------------------------------------
-- reorder_collection_items(collection_id, ordered_keys jsonb)
-- ------------------------------------------------------------
-- ordered_keys = [{"vol":"mioshiec1","file":"x.html","topic_idx":0}, ...]
-- na ordem desejada. Reescreve `pos` 1..N.
create or replace function public.reorder_collection_items(
  p_collection_id uuid,
  p_ordered_keys jsonb
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  rec jsonb;
  i int := 0;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  for rec in select * from jsonb_array_elements(p_ordered_keys)
  loop
    i := i + 1;
    update public.collection_items
       set pos = i
     where collection_id = p_collection_id
       and vol           = rec->>'vol'
       and file          = rec->>'file'
       and topic_idx     = coalesce((rec->>'topic_idx')::int, 0);
  end loop;
  update public.collections set updated_at = now() where id = p_collection_id;
end;
$$;

revoke all on function public.reorder_collection_items(uuid, jsonb) from public;
grant execute on function public.reorder_collection_items(uuid, jsonb) to authenticated;

-- ============================================================
-- RPC — Envio em lote
-- ============================================================

-- ------------------------------------------------------------
-- send_playlist_recommendations(collection_id, recipient_ids, item_keys)
-- ------------------------------------------------------------
-- Cria 1 study_recommendations por (item × destinatário) selecionado,
-- preenchendo source_collection_id e source_collection_name (snapshot).
--
-- Idempotente em "ativo": se já existe rec ATIVA do mesmo
-- (user_id, vol, file, topic_idx), pula (não duplica). "Ativa" =
-- archived_at IS NULL AND (expires_at IS NULL OR expires_at > now()).
--
-- Retorna número total de recomendações criadas.
--
-- p_item_keys = [{"vol":"mioshiec1","file":"x.html","topic_idx":0}, ...]
create or replace function public.send_playlist_recommendations(
  p_collection_id uuid,
  p_recipient_ids uuid[],
  p_item_keys jsonb,
  p_note text default null,
  p_expires_at timestamptz default null
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_collection_name text;
  v_recipient uuid;
  v_item jsonb;
  v_vol text;
  v_file text;
  v_topic_idx int;
  v_clean_note text;
  v_inserted int := 0;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_collection_id is null then
    raise exception 'collection_id required';
  end if;
  if p_recipient_ids is null or array_length(p_recipient_ids, 1) is null then
    raise exception 'recipient_ids required';
  end if;
  if p_item_keys is null or jsonb_array_length(p_item_keys) = 0 then
    raise exception 'item_keys required';
  end if;

  select name into v_collection_name
    from public.collections
   where id = p_collection_id;
  if v_collection_name is null then
    raise exception 'collection not found';
  end if;

  v_clean_note := nullif(trim(p_note), '');

  foreach v_recipient in array p_recipient_ids loop
    for v_item in select * from jsonb_array_elements(p_item_keys) loop
      v_vol       := v_item->>'vol';
      v_file      := v_item->>'file';
      v_topic_idx := coalesce((v_item->>'topic_idx')::int, 0);

      if v_vol is null or v_file is null then
        continue;
      end if;

      -- Idempotência: pula se já existe rec ativa do mesmo item pro mesmo user.
      if exists (
        select 1 from public.study_recommendations r
        where r.user_id     = v_recipient
          and r.vol         = v_vol
          and r.file        = v_file
          and r.topic_idx   = v_topic_idx
          and r.archived_at is null
          and (r.expires_at is null or r.expires_at > now())
      ) then
        continue;
      end if;

      insert into public.study_recommendations
        (user_id, vol, file, topic_idx, note, created_by, expires_at,
         source_collection_id, source_collection_name)
      values
        (v_recipient, v_vol, v_file, v_topic_idx, v_clean_note, v_admin, p_expires_at,
         p_collection_id, v_collection_name);

      v_inserted := v_inserted + 1;
    end loop;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.send_playlist_recommendations(uuid, uuid[], jsonb, text, timestamptz) from public;
grant execute on function public.send_playlist_recommendations(uuid, uuid[], jsonb, text, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select create_collection('Sobre o Daimiroku');
-- select add_to_collection('<col-id>', 'mioshiec1', 'zyobun.html', 0);
-- select * from list_my_collections();
-- select * from get_collection_with_items('<col-id>');
-- select send_playlist_recommendations(
--   '<col-id>',
--   array['<user-uuid>']::uuid[],
--   '[{"vol":"mioshiec1","file":"zyobun.html","topic_idx":0}]'::jsonb
-- );
-- ------------------------------------------------------------
