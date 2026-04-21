-- ==============================================================================
-- Admin RPC Functions — Mioshie College
-- Execute no SQL Editor do Supabase Dashboard.
-- Requer que public.is_admin() já exista (restore_admin_and_rls.sql).
-- ==============================================================================

-- Retorna todos os usuários com email real (lê auth.users)
-- Só funciona para admins graças ao SECURITY DEFINER + verificação is_admin()
CREATE OR REPLACE FUNCTION public.admin_get_users()
RETURNS TABLE(
  id          uuid,
  display_name text,
  email       text,
  role        text,
  created_at  timestamptz,
  last_seen_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.display_name,
    u.email::text,
    p.role::text,
    p.created_at,
    p.last_seen_at
  FROM public.user_profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE public.is_admin()
  ORDER BY p.created_at DESC;
$$;

-- Garante que só admins podem chamar via RLS
REVOKE ALL ON FUNCTION public.admin_get_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_users() TO authenticated;
