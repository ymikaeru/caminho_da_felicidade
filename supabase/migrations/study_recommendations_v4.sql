-- ============================================================
-- Mioshie Zenshu — Recomendações v4: gate do menu sanduíche
-- ============================================================
-- Pequeno ajuste pra summary devolver tb a contagem total "lifetime"
-- (inclui arquivadas e expiradas) — usada pelo recommendations.js
-- pra decidir se mostra o item "Central de Recomendações" no menu
-- sanduíche. Quem nunca recebeu nenhuma rec não vê o item.
--
-- Idempotente.
-- ============================================================

drop function if exists public.get_my_recommendations_summary();

create or replace function public.get_my_recommendations_summary()
returns table(total int, unseen int, ever_received int)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return query select 0, 0, 0;
    return;
  end if;
  return query
  select
    -- "Ativas" no feed do usuário: não arquivadas e não expiradas
    count(*) filter (
      where archived_at is null
        and (expires_at is null or expires_at > now())
    )::int as total,
    count(*) filter (
      where archived_at is null
        and (expires_at is null or expires_at > now())
        and seen_at is null
    )::int as unseen,
    -- "Lifetime": qualquer linha que existe pra esse user, mesmo
    -- arquivada/expirada. Usado pelo gate do menu sanduíche.
    count(*)::int as ever_received
  from public.study_recommendations
  where user_id = v_user;
end;
$$;

revoke all on function public.get_my_recommendations_summary() from public;
grant execute on function public.get_my_recommendations_summary() to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select * from get_my_recommendations_summary();
--   total | unseen | ever_received
-- -------+--------+--------------
--      2 |      1 |             5
-- ------------------------------------------------------------
