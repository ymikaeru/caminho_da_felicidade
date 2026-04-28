-- ============================================================
-- Reconcile noturno — defesa em profundidade pra webhooks perdidos
-- ============================================================
-- Webhooks de storage.objects são best-effort. Se algum evento
-- falhar (cold start, blip de rede, erro silencioso), a tabela
-- teachings_topics fica defasada. Esse cron fecha o gap:
--
--   1. Compara storage.objects.updated_at vs teachings_topics.source_updated_at
--   2. Pra cada arquivo onde storage > db, dispara o webhook via pg_net
--   3. Apaga rows órfãs (sem objeto correspondente no Storage)
--
-- Pior caso, o índice fica até 24h atrás — mas converge sozinho.
-- ============================================================
--
-- IMPORTANTE — você precisa rodar UM comando SEPARADAMENTE antes
-- de aplicar este script: inserir o webhook secret na tabela
-- private.app_secrets. Há instruções no fim deste arquivo.
-- ============================================================

-- ------------------------------------------------------------
-- Schema privado para guardar o webhook secret.
-- Negada para anon/authenticated; só service_role e postgres lêem.
-- ------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to service_role;

create table if not exists private.app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

revoke all on private.app_secrets from public;
revoke all on private.app_secrets from anon;
revoke all on private.app_secrets from authenticated;
grant select, insert, update, delete on private.app_secrets to service_role;

-- ------------------------------------------------------------
-- Helper privado para ler o secret.
-- security definer roda como o owner (postgres), então o RPC pode
-- ler mesmo quando chamado por roles que não têm acesso direto.
-- ------------------------------------------------------------
create or replace function private._sync_webhook_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select value from private.app_secrets where key = 'sync_webhook_secret';
$$;

revoke all on function private._sync_webhook_secret() from public;
revoke all on function private._sync_webhook_secret() from anon;
revoke all on function private._sync_webhook_secret() from authenticated;
-- Apenas as próprias funções definer chamam essa.

-- ------------------------------------------------------------
-- RPC de reconcile.
-- Retorna um relatório do que fez (útil pra logs e debugging).
-- ------------------------------------------------------------
create or replace function public.reconcile_teachings_topics(
  vol_filter text default null
)
returns table(action text, vol text, file text, info text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  fn_url constant text := 'https://succhmnbajvbpmoqrktq.supabase.co/functions/v1/sync-teaching-topic';
  secret text;
  body jsonb;
  req_id bigint;
begin
  secret := private._sync_webhook_secret();
  if secret is null or length(secret) < 8 then
    raise exception 'sync_webhook_secret não configurado em private.app_secrets';
  end if;

  -- ── 1) Storage > DB: re-sincroniza via webhook ───────────────────────
  for rec in
    with objs as (
      select
        o.bucket_id,
        o.name,
        o.updated_at as obj_ts,
        regexp_replace(o.name, '^(mioshiec[1-9])/.+$', '\1') as v,
        regexp_replace(o.name, '^mioshiec[1-9]/(.+)\.json$', '\1') as f
      from storage.objects o
      where o.bucket_id = 'teachings'
        and o.name ~ '^mioshiec[1-9]/.+\.json$'
        -- Excluir páginas-índice da volume — não produzem topics, gerariam falso drift.
        and o.name !~ '^mioshiec[1-9]/index\.html\.json$'
    )
    select o.bucket_id, o.name, o.obj_ts, o.v, o.f,
           coalesce(max(t.source_updated_at), 'epoch'::timestamptz) as max_db_ts
    from objs o
    left join public.teachings_topics t on t.vol = o.v and t.file = o.f
    where (vol_filter is null or o.v = vol_filter)
    group by o.bucket_id, o.name, o.obj_ts, o.v, o.f
    -- Tolerância: ignora drift sub-milissegundo (Storage REST API trunca em ms
    -- ao listar arquivos, enquanto storage.objects.updated_at em Postgres tem
    -- microssegundos). Sem isso, o seeder geraria 1300+ falsos positivos.
    having date_trunc('milliseconds', o.obj_ts) > coalesce(max(t.source_updated_at), 'epoch'::timestamptz)
  loop
    body := jsonb_build_object(
      'type', 'UPDATE',
      'schema', 'storage',
      'table', 'objects',
      'record', jsonb_build_object(
        'bucket_id', rec.bucket_id,
        'name', rec.name,
        'updated_at', rec.obj_ts
      ),
      'old_record', null
    );

    select net.http_post(
      url := fn_url,
      body := body,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || secret
      ),
      timeout_milliseconds := 10000
    ) into req_id;

    action := 'resync';
    vol := rec.v;
    file := rec.f;
    info := 'storage_ts=' || rec.obj_ts || ' db_ts=' || rec.max_db_ts || ' req=' || req_id;
    return next;
  end loop;

  -- ── 2) DB > Storage: rows órfãs (objeto sumiu do Storage) ────────────
  for rec in
    select t.vol as v, t.file as f
    from public.teachings_topics t
    where (vol_filter is null or t.vol = vol_filter)
    group by t.vol, t.file
    having not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'teachings'
        and o.name = t.vol || '/' || t.file || '.json'
    )
  loop
    delete from public.teachings_topics
    where vol = rec.v and file = rec.f;

    action := 'delete_orphan';
    vol := rec.v;
    file := rec.f;
    info := 'no storage object';
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.reconcile_teachings_topics(text) from public;
revoke all on function public.reconcile_teachings_topics(text) from anon;
revoke all on function public.reconcile_teachings_topics(text) from authenticated;
grant execute on function public.reconcile_teachings_topics(text) to service_role;

-- ------------------------------------------------------------
-- Schedule com pg_cron — todo dia às 4h da manhã (UTC)
-- ------------------------------------------------------------
-- Remove agendamento prévio se existir (idempotente)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-teachings-topics') then
    perform cron.unschedule('reconcile-teachings-topics');
  end if;
end $$;

select cron.schedule(
  'reconcile-teachings-topics',
  '0 4 * * *',
  $$ select public.reconcile_teachings_topics(); $$
);

-- ============================================================
-- INSTRUÇÕES — rode UMA VEZ depois de aplicar este script:
-- ============================================================
--
-- 1) Insira o webhook secret (use o MESMO valor que está no
--    Supabase Edge Functions secret SYNC_WEBHOOK_SECRET):
--
--    insert into private.app_secrets (key, value)
--    values ('sync_webhook_secret', 'COLE-AQUI-O-SECRET-REAL')
--    on conflict (key) do update set value = excluded.value, updated_at = now();
--
-- 2) Teste manual do reconcile (deve retornar 0 linhas se webhook
--    está em dia, ou listar arquivos defasados que ele acabou de
--    re-sincronizar):
--
--    select * from public.reconcile_teachings_topics();
--
-- 3) Confirma que o cron está agendado:
--
--    select jobname, schedule, command, active
--    from cron.job
--    where jobname = 'reconcile-teachings-topics';
-- ============================================================
