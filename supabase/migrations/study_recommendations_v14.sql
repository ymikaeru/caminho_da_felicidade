-- ============================================================
-- Mioshie Zenshu — Recomendações v14: renomear o áudio guardado
-- ============================================================
-- Até a v13, o título do áudio (audio_title) só era definido no upload.
-- Para corrigir/renomear era preciso re-subir o arquivo — o que dispara o
-- purge (apaga as recomendações de áudio anteriores). Destrutivo só pra
-- ajustar um texto.
--
-- Esta RPC renomeia o áudio GUARDADO (a recomendação de áudio mais recente)
-- atualizando o audio_title de TODAS as linhas que apontam pro mesmo
-- audio_path — então o título corrige na hora também para quem já recebeu a
-- recomendação. NÃO toca no arquivo do Storage nem reenvia nada.
--
-- Pré-requisitos: study_recommendations_v8/v9 (colunas de áudio) + is_admin().
-- Idempotente. Execute no SQL Editor do Supabase Dashboard.
-- ============================================================

create or replace function public.admin_rename_current_audio(p_title text)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_path  text;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  n_updated int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if v_title is null then
    raise exception 'título vazio';
  end if;

  -- Path do áudio guardado (= recomendação de áudio mais recente).
  select sr.audio_path into v_path
  from public.study_recommendations sr
  where sr.audio_path is not null
  order by sr.created_at desc
  limit 1;

  if v_path is null then
    raise exception 'nenhum áudio guardado';
  end if;

  update public.study_recommendations
     set audio_title = v_title
   where audio_path = v_path;

  get diagnostics n_updated = row_count;
  return n_updated;
end;
$$;

revoke all on function public.admin_rename_current_audio(text) from public;
grant execute on function public.admin_rename_current_audio(text) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- select admin_rename_current_audio('Orientação Dirigente Espiritual 14/04/1983');
-- select * from admin_get_current_audio();
-- ------------------------------------------------------------
