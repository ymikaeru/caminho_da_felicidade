-- ==============================================================================
-- Admin PIN Gate — Mioshie College
-- Camada extra de autenticação ao entrar em admin-supabase.html.
-- O PIN é armazenado como hash bcrypt (pgcrypto) na coluna user_profiles.admin_pin_hash.
-- Apenas usuários com role='admin' podem definir ou verificar o próprio PIN.
-- Execute no SQL Editor do Supabase Dashboard.
-- ==============================================================================

-- 0. Extensão necessária para crypt()/gen_salt('bf').
--    No Supabase, pgcrypto vive no schema "extensions" (não em "public"),
--    por isso as RPCs abaixo qualificam as chamadas como extensions.crypt/gen_salt.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1. Coluna do hash (NULL = PIN ainda não configurado)
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS admin_pin_hash text;

-- 2. Define ou troca o PIN do admin logado.
--    Aceita PIN de 4 a 12 dígitos numéricos. Retorna true em caso de sucesso.
CREATE OR REPLACE FUNCTION public.set_admin_pin(new_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF new_pin IS NULL OR new_pin !~ '^[0-9]{4,12}$' THEN
    RAISE EXCEPTION 'invalid_pin_format';
  END IF;

  UPDATE public.user_profiles
     SET admin_pin_hash = extensions.crypt(new_pin, extensions.gen_salt('bf', 10))
   WHERE id = uid;

  RETURN true;
END;
$$;

-- 3. Verifica se o PIN bate com o hash armazenado para o admin logado.
--    Retorna true/false. Usa comparação constante via crypt().
CREATE OR REPLACE FUNCTION public.verify_admin_pin(pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  stored text;
BEGIN
  IF uid IS NULL OR NOT public.is_admin() THEN
    RETURN false;
  END IF;

  SELECT admin_pin_hash INTO stored
    FROM public.user_profiles
   WHERE id = uid;

  IF stored IS NULL OR pin IS NULL OR pin = '' THEN
    RETURN false;
  END IF;

  RETURN stored = extensions.crypt(pin, stored);
END;
$$;

-- 4. Indica se o admin logado já tem PIN configurado (para a UI decidir
--    entre "digite seu PIN" ou "defina um PIN").
CREATE OR REPLACE FUNCTION public.has_admin_pin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
     AND EXISTS (
       SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND admin_pin_hash IS NOT NULL
     );
$$;

-- 5. Permissões: só authenticated pode chamar; as funções já checam is_admin().
REVOKE ALL ON FUNCTION public.set_admin_pin(text)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_admin_pin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_admin_pin()        FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_admin_pin(text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_admin_pin()        TO authenticated;
