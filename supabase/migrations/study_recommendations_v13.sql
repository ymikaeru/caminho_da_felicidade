-- ============================================================
-- Mioshie Zenshu — Recomendações v13: áudio reutilizável
-- ============================================================
-- Antes (v9/v10): cada áudio era "consumido" no envio — o cliente subia
-- o arquivo, enviava e, em seguida, apagava arquivo + linhas anteriores.
-- Pra recomendar o MESMO áudio de novo, o admin tinha que subir o
-- arquivo outra vez.
--
-- Agora: o áudio enviado fica GUARDADO e pode ser recomendado quantas
-- vezes quiser, sem re-upload. O admin só sobe um arquivo novo quando
-- quer TROCAR o áudio guardado — e aí o anterior é apagado (libera o
-- Storage), mantendo o "1 áudio por vez".
--
-- Não há tabela de "áudio atual": o guardado é simplesmente a
-- recomendação de áudio mais recente. O purge do v10
-- (admin_purge_other_audio_recommendations) garante que todas as linhas
-- de áudio compartilham o mesmo audio_path (o atual) — e mesmo que não,
-- "order by created_at desc limit 1" devolve o mais recente. O cliente
-- não consegue ler study_recommendations de outros usuários (RLS), por
-- isso a leitura é via RPC security definer, igual admin_get_user_recommendations.
--
-- Pré-requisito: study_recommendations_v8.sql + v9.sql (colunas de áudio).
-- Idempotente. Execute no SQL Editor do Supabase Dashboard.
-- ============================================================

create or replace function public.admin_get_current_audio()
returns table (
  audio_path  text,
  audio_title text,
  created_at  timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return query
    select sr.audio_path, sr.audio_title, sr.created_at
    from public.study_recommendations sr
    where sr.audio_path is not null
    order by sr.created_at desc
    limit 1;
end;
$$;

revoke all on function public.admin_get_current_audio() from public;
grant execute on function public.admin_get_current_audio() to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- -- qual é o áudio guardado hoje (path + título):
-- select * from admin_get_current_audio();
-- ------------------------------------------------------------
