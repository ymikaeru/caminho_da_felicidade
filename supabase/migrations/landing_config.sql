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
  -- Poema fixo acima do calendário (escolhido no admin). Quando poema_ativo =
  -- true e há texto, a landing mostra este poema no lugar da rotação por mês.
  poema_ativo boolean not null default false,
  poema_autor text,         -- linha de cima (kicker dourado), ex.: Poemas de Meishu-Sama. Vazio = eyebrow discreto
  poema_titulo text,        -- título da coleção, ex.: "Akimaro Kin'eishū" (明麿近詠集). Vazio = padrão Yama to Mizu
  poema_original text,      -- waka em japonês (separe os versos com espaço　p/ a coluna vertical)
  poema_romaji text,
  poema_translation text,
  updated_at timestamptz not null default now(),
  constraint landing_config_singleton check (id = 1)
);

-- Idempotente: adiciona as colunas do poema em bancos que já tinham a tabela
-- antes desta funcionalidade. Seguro re-rodar.
alter table public.landing_config
  add column if not exists poema_ativo boolean not null default false,
  add column if not exists poema_autor text,
  add column if not exists poema_titulo text,
  add column if not exists poema_original text,
  add column if not exists poema_romaji text,
  add column if not exists poema_translation text;

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
