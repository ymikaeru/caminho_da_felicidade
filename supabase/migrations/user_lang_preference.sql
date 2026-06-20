-- ============================================================
-- Mioshie Zenshu — Preferência de idioma por conta
-- Projeto Supabase: succhmnbajvbpmoqrktq
--
-- COMO APLICAR: cole TODO este arquivo no SQL Editor do Supabase Dashboard
-- e execute. Idempotente (pode rodar 2x).
--
-- Objetivo: dar uma "identidade de idioma" à conta. Hoje o idioma vive só no
-- localStorage.site_lang do navegador (nasce em 'pt', sem detecção). Com a
-- coluna preferred_lang, o idioma escolhido pelo usuário passa a valer em
-- qualquer aparelho/login — em especial garante que um japonês receba
-- interface e ensinamentos em japonês mesmo numa recomendação enviada em PT.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Coluna de preferência (nullable; null = nunca escolheu)
--
-- ESCRITA pelo próprio usuário: NÃO precisa de policy/RPC nova. A policy de
-- UPDATE de user_profiles já permite o usuário atualizar a própria linha
-- (USING auth.uid() = id) e o trigger protect_profile_privileged_cols
-- (security_fixes_2026_06.sql) só bloqueia mudanças em role/admin_pin_hash.
-- Logo `update user_profiles set preferred_lang=... where id=auth.uid()`
-- passa — exatamente como o heartbeat já faz com last_seen_at (login.js).
-- ------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS preferred_lang text;

-- Restringe aos dois idiomas suportados (idempotente: só cria se não existir).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_preferred_lang_chk'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_preferred_lang_chk
      CHECK (preferred_lang IN ('pt', 'ja'));
  END IF;
END$$;

-- ------------------------------------------------------------
-- 2) admin_get_users — expõe preferred_lang para o admin enxergar o idioma
--    do destinatário ao recomendar. (DROP+CREATE porque o RETURNS TABLE muda.)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_get_users();

CREATE OR REPLACE FUNCTION public.admin_get_users()
RETURNS TABLE(
  id            uuid,
  display_name  text,
  email         text,
  role          text,
  created_at    timestamptz,
  last_seen_at  timestamptz,
  preferred_lang text
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
    p.last_seen_at,
    p.preferred_lang
  FROM public.user_profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE public.is_admin()
  ORDER BY p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_users() TO authenticated;

COMMIT;
