-- ==============================================================================
-- Pastas nos Ensinamentos Salvos — Mioshie College
-- Execute no SQL Editor do Supabase Dashboard.
--
-- Cria a tabela `favorite_folders` (pastas pessoais do usuário) e adiciona a
-- coluna `folder_id` em `synced_favorites`. RLS por dono, no mesmo padrão de
-- rls_user_tables.sql (auth.uid() = user_id, com WITH CHECK).
--
-- Idempotente: pode ser re-executado sem erro.
-- ==============================================================================

-- ── favorite_folders ──────────────────────────────────────────────────────────
-- `id` é gerado no CLIENTE (crypto.randomUUID) para ter identidade estável entre
-- aparelhos no merge; o default só cobre inserts que não passem id.
create table if not exists public.favorite_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  color      text,
  pos        int  not null default 0,
  created_at timestamptz not null default now()
);

alter table public.favorite_folders enable row level security;

drop policy if exists "Usuarios gerenciam proprias pastas" on public.favorite_folders;
create policy "Usuarios gerenciam proprias pastas"
  on public.favorite_folders
  for all
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

create index if not exists favorite_folders_user_idx
  on public.favorite_folders (user_id);

-- ── synced_favorites.folder_id ────────────────────────────────────────────────
-- ON DELETE SET NULL: apagar uma pasta apenas "desarquiva" os favoritos
-- (folder_id volta a NULL); NUNCA apaga o Ensinamento salvo.
alter table public.synced_favorites
  add column if not exists folder_id uuid
  references public.favorite_folders(id) on delete set null;

create index if not exists synced_favorites_folder_idx
  on public.synced_favorites (folder_id);

-- ── Admin lê todas as pastas (painel "Salvos") ────────────────────────────────
-- Policies permissivas somam com OR: dono (policy FOR ALL acima) OU admin podem
-- ler. Mesmo padrão de admin_select_favs_highlights.sql para synced_favorites.
drop policy if exists "Admins leem todas as pastas" on public.favorite_folders;
create policy "Admins leem todas as pastas"
  on public.favorite_folders
  for select
  to authenticated
  using ( public.is_admin() );
