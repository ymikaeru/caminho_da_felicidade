-- ============================================================
-- Web Push v2 — admin: quem ativou os avisos
-- ============================================================
-- RPC pro cartão "Avisos Ativados" do Analytics: lista as inscrições
-- de push com nome/email do usuário. RLS da tabela só deixa cada um
-- ver as próprias — daí o SECURITY DEFINER + is_admin(), no padrão
-- de admin_rpc_functions.sql. Idempotente.
-- Pré-requisito: push_notifications_v1.sql.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_get_push_subscriptions()
RETURNS TABLE(
  user_id      uuid,
  display_name text,
  email        text,
  ua           text,
  created_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.user_id,
    p.display_name,
    u.email::text,
    s.ua,
    s.created_at
  FROM public.push_subscriptions s
  JOIN auth.users u ON u.id = s.user_id
  LEFT JOIN public.user_profiles p ON p.id = s.user_id
  WHERE public.is_admin()
  ORDER BY s.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_push_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_push_subscriptions() TO authenticated;
