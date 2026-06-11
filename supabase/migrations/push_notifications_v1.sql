-- ============================================================
-- Mioshie Zenshu — Web Push v1: avisos de recomendação de estudo
-- ============================================================
-- Peças:
--   1. push_subscriptions — inscrições de push por usuário/aparelho
--      (endpoint + chaves do navegador; RLS: cada um gerencia as suas).
--   2. study_recommendations.push_notified_at — carimbo de "já avisado"
--      (idempotência: a função só notifica recomendações sem carimbo).
--   3. Trigger AFTER INSERT em study_recommendations → pg_net chama a
--      Edge Function send-push (fire-and-forget). Pega TODOS os fluxos
--      de criação (Recomendar Ensinamento, trecho grifado, áudio) sem
--      mexer em código cliente.
--
-- Pré-requisito de deploy (fora deste SQL):
--   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=...
--   supabase functions deploy send-push
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Inscrições
-- ------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subs_select_own" on public.push_subscriptions;
create policy "push_subs_select_own" on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists "push_subs_insert_own" on public.push_subscriptions;
create policy "push_subs_insert_own" on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists "push_subs_update_own" on public.push_subscriptions;
create policy "push_subs_update_own" on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "push_subs_delete_own" on public.push_subscriptions;
create policy "push_subs_delete_own" on public.push_subscriptions
  for delete using (user_id = auth.uid());

create index if not exists push_subs_user_idx on public.push_subscriptions(user_id);

-- ------------------------------------------------------------
-- 2. Carimbo de notificação na recomendação
-- ------------------------------------------------------------
alter table public.study_recommendations
  add column if not exists push_notified_at timestamptz;

create index if not exists study_recs_push_pending_idx
  on public.study_recommendations(created_at)
  where push_notified_at is null;

-- ------------------------------------------------------------
-- 3. Trigger → Edge Function (pg_net, assíncrono)
-- ------------------------------------------------------------
-- A anon key abaixo é PÚBLICA por design (mesma do site); a função
-- send-push não aceita payload de conteúdo — ela mesma lê do banco o
-- que está pendente, então não dá pra usá-la pra mandar texto arbitrário.
create extension if not exists pg_net;

create or replace function public.notify_push_on_recommend()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://succhmnbajvbpmoqrktq.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1Y2NobW5iYWp2YnBtb3Fya3RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NjY3MDgsImV4cCI6MjA5MjA0MjcwOH0.humCcLYpnnnapkLtLOeb9ZVo5EZWoWw6ItNo0WVY3DY'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  -- aviso é melhor-esforço: nunca pode derrubar a criação da recomendação
  return null;
end;
$$;

drop trigger if exists trg_push_on_recommend on public.study_recommendations;
create trigger trg_push_on_recommend
  after insert on public.study_recommendations
  for each statement
  execute function public.notify_push_on_recommend();
