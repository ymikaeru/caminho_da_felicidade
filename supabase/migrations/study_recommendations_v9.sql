-- ============================================================
-- Mioshie Zenshu — Recomendações v9: áudio em lote (destinatários)
-- ============================================================
-- A aba "Recomendar Áudio" do admin agora tem multi-seleção de
-- destinatários (Selecionar todos + desmarcar quem não deve receber).
-- Este RPC cria uma cópia da recomendação de áudio pra cada usuário
-- da lista. Espelha admin_create_recommendations_bulk (v5), versão áudio.
--
-- Pré-requisito: study_recommendations_v8.sql (colunas audio_path/
-- audio_title + bucket rec-audio).
--
-- Idempotente. Execute no SQL Editor do Supabase Dashboard.
-- ============================================================

create or replace function public.admin_create_audio_recommendations_bulk(
  p_user_ids uuid[],
  p_audio_path text,
  p_audio_title text,
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
  v_path  text := trim(p_audio_path);
  v_title text := nullif(trim(p_audio_title), '');
  v_note  text := nullif(trim(p_note), '');
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if nullif(v_path, '') is null then
    raise exception 'audio_path é obrigatório';
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  -- INNER JOIN com auth.users garante que só inserimos pra usuários
  -- válidos e ativos — UUID estranho na lista é ignorado, não quebra
  -- o lote inteiro.
  insert into public.study_recommendations
    (user_id, audio_path, audio_title, note, created_by, expires_at)
  select
    u.id, v_path, v_title, v_note, v_admin, p_expires_at
  from unnest(p_user_ids) as t(uid)
  join auth.users u on u.id = t.uid
  where u.deleted_at is null;

  get diagnostics n_created = row_count;
  return n_created;
end;
$$;

revoke all on function public.admin_create_audio_recommendations_bulk(uuid[], text, text, text, timestamptz) from public;
grant execute on function public.admin_create_audio_recommendations_bulk(uuid[], text, text, text, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select admin_create_audio_recommendations_bulk(
--   array['<uuid1>','<uuid2>']::uuid[],
--   'audio/<uuid>.mp3', 'Mensagem do Reverendo', 'pra ouvir esta semana', null);
-- ------------------------------------------------------------
