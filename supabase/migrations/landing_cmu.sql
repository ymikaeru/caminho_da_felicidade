-- ============================================================
-- Landing CMU — calendar_events + announcements
-- Tabelas consumidas pela landing pública em ymikaeru.github.io
-- e administradas via admin-supabase.html.
-- Reusa helper public.is_admin() definido em restore_admin_and_rls.sql.
-- ============================================================

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists calendar_events_date_idx
  on public.calendar_events(date);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  published_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists announcements_active_published_idx
  on public.announcements(is_active, published_at desc);

alter table public.calendar_events enable row level security;
alter table public.announcements  enable row level security;

-- Leitura pública (anon) — landing consome sem login
drop policy if exists "calendar_events public read" on public.calendar_events;
create policy "calendar_events public read"
  on public.calendar_events for select
  using (true);

drop policy if exists "announcements public read" on public.announcements;
create policy "announcements public read"
  on public.announcements for select
  using (is_active = true);

-- Escrita apenas admin — reusa helper existente
drop policy if exists "calendar_events admin write" on public.calendar_events;
create policy "calendar_events admin write"
  on public.calendar_events for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "announcements admin write" on public.announcements;
create policy "announcements admin write"
  on public.announcements for all
  using (public.is_admin())
  with check (public.is_admin());
