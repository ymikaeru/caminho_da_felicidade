-- ============================================================
-- Mioshie Zenshu — Recomendações v5: envio em lote (multi-user)
-- ============================================================
-- Substitui o loop client-side de N chamadas a admin_create_recommendation
-- (uma por usuário selecionado) por uma única chamada a
-- admin_create_recommendations_bulk(uuid[], ...).
--
-- Motivo: o modal do reader agora permite multi-select. Pra 50 usuários
-- selecionados o loop antigo fazia 50 round-trips HTTPS sequenciais
-- (~15s). Esta RPC faz 1 round-trip + 1 INSERT...SELECT unnest() — sub-
-- segundo e atômico (se falhar pra um, falha pra todos; sem estado
-- parcial confuso).
--
-- Filtra silenciosamente os UUIDs que não existem em auth.users (ou
-- foram deletados) — admin pode passar uma lista vinda de um cache
-- desatualizado sem quebrar o envio inteiro.
--
-- Idempotente.
-- ============================================================

create or replace function public.admin_create_recommendations_bulk(
  p_user_ids uuid[],
  p_vol text,
  p_file text,
  p_topic_idx int default 0,
  p_note text default null,
  p_expires_at timestamptz default null
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  n_created int;
  v_admin uuid := auth.uid();
  v_clean_note text := nullif(trim(p_note), '');
  v_topic int := coalesce(p_topic_idx, 0);
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_vol is null or p_file is null then
    raise exception 'vol, file required';
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  -- INNER JOIN com auth.users garante que só inserimos pra usuários
  -- válidos e ativos — UUID estranho na lista é ignorado, não quebra
  -- o lote inteiro.
  insert into public.study_recommendations
    (user_id, vol, file, topic_idx, note, created_by, expires_at)
  select
    u.id, p_vol, p_file, v_topic, v_clean_note, v_admin, p_expires_at
  from unnest(p_user_ids) as t(uid)
  join auth.users u on u.id = t.uid
  where u.deleted_at is null;

  get diagnostics n_created = row_count;
  return n_created;
end;
$$;

revoke all on function public.admin_create_recommendations_bulk(uuid[], text, text, int, text, timestamptz) from public;
grant execute on function public.admin_create_recommendations_bulk(uuid[], text, text, int, text, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select admin_create_recommendations_bulk(
--   array[uuid_1, uuid_2, uuid_3],
--   'mioshiec1', 'zyobun.html', 0,
--   'pra refletir esta semana',
--   (now() + interval '30 days')
-- );
-- ------------------------------------------------------------
