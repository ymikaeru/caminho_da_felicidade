-- ==============================================================================
-- Admin PIN — Allowlist de administradores autorizados
-- ==============================================================================
-- Contexto: o gate de PIN (admin_pin.sql) é por-usuário. Mesmo com o trigger
-- anti-autopromoção (security_fixes_2026_06.sql) já no ar, queremos uma camada
-- a mais: SÓ os administradores conhecidos podem DEFINIR ou VERIFICAR um PIN.
-- Assim, se por qualquer motivo uma conta inesperada chegar a role='admin',
-- ela NÃO consegue configurar um PIN para entrar no painel — nem pelo modal,
-- nem chamando set_admin_pin/verify_admin_pin direto pelo console.
--
-- COMO APLICAR:
--   1) Descubra os UUIDs dos 2 admins legítimos (rode no SQL Editor):
--        SELECT id, display_name, role FROM public.user_profiles WHERE role = 'admin';
--   2) Cole os 2 UUIDs no array de is_allowed_admin() abaixo (onde indicado).
--   3) Cole TODO este arquivo no SQL Editor do Supabase Dashboard e execute.
--      É transacional (tudo-ou-nada) e idempotente (pode rodar de novo).
-- ==============================================================================
BEGIN;

-- 1. Allowlist: retorna true só se o usuário logado for um dos admins permitidos.
--    SECURITY DEFINER + search_path fixo (mesmo padrão das outras RPCs de PIN).
CREATE OR REPLACE FUNCTION public.is_allowed_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = ANY (ARRAY[
    '93c85136-5a86-474b-8235-ceb6e7bd6212',  -- Walter Fujii
    '4d3fd723-0ab8-422b-a841-40f63b982127'   -- Michael
  ]::uuid[]);
$$;

REVOKE ALL  ON FUNCTION public.is_allowed_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_allowed_admin() TO authenticated;

-- 2. set_admin_pin: além de is_admin(), exige estar na allowlist.
--    Um admin fora da lista recebe 'admin_not_authorized' (o front trata isso).
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

  IF NOT public.is_allowed_admin() THEN
    RAISE EXCEPTION 'admin_not_authorized';
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

-- 3. verify_admin_pin: fora da allowlist nunca valida (retorna false).
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
  IF uid IS NULL OR NOT public.is_admin() OR NOT public.is_allowed_admin() THEN
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

-- 4. has_admin_pin: indica ao front se mostra "defina o PIN" ou "digite o PIN".
--    Fora da allowlist retorna NULL — sinal para o front barrar o acesso em vez
--    de oferecer a tela de definição de PIN.
CREATE OR REPLACE FUNCTION public.has_admin_pin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.is_admin() OR NOT public.is_allowed_admin() THEN NULL
    ELSE EXISTS (
      SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid() AND admin_pin_hash IS NOT NULL
    )
  END;
$$;

COMMIT;

-- ==============================================================================
-- DEPOIS DE APLICAR — teste rápido (rode separadamente):
--   -- logado como um dos 2 admins: deve retornar true
--   SELECT public.is_allowed_admin();
--   -- has_admin_pin deve voltar true/false (não NULL) para eles.
-- ==============================================================================
