-- ============================================================
-- Landing CMU — configuração global (singleton)
-- Guarda o "skin" dos comunicados (a/b/c) que vale pra TODOS.
-- Lido pela landing pública (anon) e editado no admin (is_admin()).
-- Reusa helper public.is_admin() (restore_admin_and_rls.sql).
-- Rodar 1x no Supabase (SQL Editor).
-- ============================================================

create table if not exists public.landing_config (
  id int primary key default 1,
  comunicados_skin text not null default 'c'
    check (comunicados_skin in ('a', 'b', 'c')),
  updated_at timestamptz not null default now(),
  constraint landing_config_singleton check (id = 1)
);

-- Garante a linha única.
insert into public.landing_config (id) values (1)
  on conflict (id) do nothing;

alter table public.landing_config enable row level security;

-- Leitura pública (anon) — landing consome sem login.
drop policy if exists "landing_config public read" on public.landing_config;
create policy "landing_config public read"
  on public.landing_config for select
  using (true);

-- Escrita apenas admin.
drop policy if exists "landing_config admin write" on public.landing_config;
create policy "landing_config admin write"
  on public.landing_config for all
  using (public.is_admin())
  with check (public.is_admin());
