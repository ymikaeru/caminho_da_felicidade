-- ==============================================================================
-- Admin: dias ativos por usuário — Mioshie College
-- Conta dias distintos com pelo menos 1 access_log (action='view') por usuário.
-- Usado pelo painel admin para mostrar "Dias ativos" em cada card de usuário.
-- Depende de public.is_admin() (restore_admin_and_rls.sql).
-- Execute no SQL Editor do Supabase Dashboard.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_user_visit_days()
RETURNS TABLE(
  user_id      uuid,
  active_days  bigint,
  last_visit   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.user_id,
    count(DISTINCT (a.created_at AT TIME ZONE 'UTC')::date) AS active_days,
    max(a.created_at)                                       AS last_visit
  FROM public.access_logs a
  WHERE public.is_admin()
    AND a.action = 'view'
  GROUP BY a.user_id;
$$;

REVOKE ALL ON FUNCTION public.admin_get_user_visit_days() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_visit_days() TO authenticated;
