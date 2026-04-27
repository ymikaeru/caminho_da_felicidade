-- caminho_da_felicidade/supabase/migrations/johrei_essencia.sql
-- Singleton table holding the current "Essência" featured teaching for guia_johrei.

create table if not exists public.johrei_essencia (
    id          smallint primary key default 1 check (id = 1),
    article_id  text not null,
    excerpt_pt  text not null,
    updated_at  timestamptz not null default now(),
    updated_by  uuid references auth.users(id)
);

alter table public.johrei_essencia enable row level security;

-- Leitura pública (anon role) para o site guia_johrei
drop policy if exists "anon read essencia" on public.johrei_essencia;
create policy "anon read essencia"
    on public.johrei_essencia
    for select
    to anon
    using (true);

-- Leitura também pra usuários autenticados (admin precisa ler pra editar)
drop policy if exists "auth read essencia" on public.johrei_essencia;
create policy "auth read essencia"
    on public.johrei_essencia
    for select
    to authenticated
    using (true);

-- Escrita só para admin (mesmo padrão das outras tabelas)
drop policy if exists "admin write essencia" on public.johrei_essencia;
create policy "admin write essencia"
    on public.johrei_essencia
    for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- Trigger para atualizar updated_at automaticamente
create or replace function public.touch_johrei_essencia()
returns trigger as $$
begin
    new.updated_at = now();
    new.updated_by = auth.uid();
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_touch_johrei_essencia on public.johrei_essencia;
create trigger trg_touch_johrei_essencia
    before insert or update on public.johrei_essencia
    for each row execute function public.touch_johrei_essencia();
