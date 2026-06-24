-- ============================================================
-- study_recommendations v17
-- ------------------------------------------------------------
-- admin_set_recommendation_archived(p_id, p_archived): permite o ADMIN
-- arquivar/desarquivar a recomendação de QUALQUER usuário (na aba
-- Recomendações do admin). O archive_my_recommendation do usuário é
-- scoped a auth.uid() (só as próprias), então não serve pro admin.
--
-- p_archived = true  -> archived_at = now()  (move pra Arquivadas do usuário)
-- p_archived = false -> archived_at = null   (volta pra lista ativa)
-- Idempotente.
-- ============================================================

create or replace function public.admin_set_recommendation_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.study_recommendations
     set archived_at = case when p_archived then now() else null end
   where id = p_id;
end;
$$;
revoke all on function public.admin_set_recommendation_archived(uuid, boolean) from public;
grant execute on function public.admin_set_recommendation_archived(uuid, boolean) to authenticated;
