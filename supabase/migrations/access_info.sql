-- ============================================================
-- Access Info — difusões, casas de Johrei, regionais, sede
-- Tabela consumida pela landing pública e administrada via
-- admin-supabase.html (aba "Dados de Acesso").
-- Reusa helper public.is_admin() de restore_admin_and_rls.sql.
-- ============================================================

create table if not exists public.access_info (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  nome text not null,
  endereco text,
  dias text,
  horario text,
  telefone text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Atualiza o CHECK de categoria para incluir 'regional'.
-- A tabela original foi criada no dashboard apenas com
-- ('sede', 'difusao', 'johrei'); essa migração adiciona 'regional'.
alter table public.access_info
  drop constraint if exists access_info_category_check;

alter table public.access_info
  add constraint access_info_category_check
  check (category in ('sede', 'regional', 'difusao', 'johrei'));

create index if not exists access_info_active_sort_idx
  on public.access_info(is_active, sort_order);

alter table public.access_info enable row level security;

-- Leitura pública (anon) — landing consome sem login
drop policy if exists "access_info public read" on public.access_info;
create policy "access_info public read"
  on public.access_info for select
  using (is_active = true);

-- Escrita apenas admin
drop policy if exists "access_info admin write" on public.access_info;
create policy "access_info admin write"
  on public.access_info for all
  using (public.is_admin())
  with check (public.is_admin());
