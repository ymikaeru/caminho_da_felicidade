-- ============================================================
-- Mioshie Zenshu — Recomendações v10: "1 áudio por vez"
-- ============================================================
-- A operação será: apenas 1 áudio ativo de cada vez. Ao enviar um
-- áudio novo, o admin (no cliente) chama este RPC pra apagar TODAS as
-- recomendações de áudio que NÃO sejam o áudio recém-enviado, e em
-- seguida remove os arquivos antigos do bucket (libera espaço).
--
-- Este RPC cuida só das LINHAS no banco. A remoção do arquivo no
-- Storage é feita pelo cliente (storage.remove), porque apagar a linha
-- de storage.objects via SQL não garante a liberação do objeto físico.
--
-- p_keep_path = path do áudio a PRESERVAR (o recém-enviado). Passar
-- null apaga todas as recomendações de áudio.
--
-- Só mexe em recomendações de áudio (audio_path not null) — recomenda-
-- ções de ensinamento ficam intactas. Inclui ativas E arquivadas.
--
-- Pré-requisito: study_recommendations_v8.sql.
-- Idempotente. Execute no SQL Editor do Supabase Dashboard.
-- ============================================================

create or replace function public.admin_purge_other_audio_recommendations(
  p_keep_path text default null
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  n_deleted int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  delete from public.study_recommendations
   where audio_path is not null
     and audio_path is distinct from p_keep_path;

  get diagnostics n_deleted = row_count;
  return n_deleted;
end;
$$;

revoke all on function public.admin_purge_other_audio_recommendations(text) from public;
grant execute on function public.admin_purge_other_audio_recommendations(text) to authenticated;

-- ------------------------------------------------------------
-- Sanity:
-- -- quantas recs de áudio existem hoje:
-- select count(*) from study_recommendations where audio_path is not null;
-- -- apaga todas (sem preservar nenhuma):
-- select admin_purge_other_audio_recommendations(null);
-- ------------------------------------------------------------
