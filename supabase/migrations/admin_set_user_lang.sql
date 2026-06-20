-- ============================================================
-- Mioshie Zenshu — Admin define o idioma preferido de um usuário
-- Projeto Supabase: succhmnbajvbpmoqrktq
--
-- COMO APLICAR: cole TODO este arquivo no SQL Editor do Supabase Dashboard
-- e execute. Idempotente (pode rodar 2x).
--
-- Pré-requisito: user_lang_preference.sql (coluna preferred_lang).
--
-- Objetivo: permitir que o admin defina/troque o idioma (pt/ja) de QUALQUER
-- conta — pela aba Usuários e no cadastro. A policy de UPDATE de user_profiles
-- só libera o próprio dono (USING auth.uid() = id), então o admin não consegue
-- escrever na linha de outro usuário via update direto. Esta RPC SECURITY
-- DEFINER faz a escrita com checagem de is_admin(), no mesmo padrão de
-- admin_get_users(). Só toca preferred_lang — nunca role/admin_pin_hash.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_set_user_lang(
  p_user_id uuid,
  p_lang    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores.';
  END IF;

  -- null = "limpar" (volta a valer o default do navegador). pt/ja = fixar.
  IF p_lang IS NOT NULL AND p_lang NOT IN ('pt', 'ja') THEN
    RAISE EXCEPTION 'Idioma inválido: %. Use pt, ja ou null.', p_lang;
  END IF;

  UPDATE public.user_profiles
     SET preferred_lang = p_lang
   WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_lang(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_lang(uuid, text) TO authenticated;

COMMIT;
