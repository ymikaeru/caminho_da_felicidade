-- ─────────────────────────────────────────────────────────────────────────────
-- Atualiza get_user_highlights_for_admin para devolver TODOS os campos da
-- tabela user_highlights (incluindo `id`, `topic_id`, `start_char`, `end_char`).
--
-- Motivo: o admin precisa do `id` para apagar destaques individuais (botão
-- 🗑 Apagar na aba Destaques do admin). A versão anterior do RPC selecionava
-- apenas um subconjunto de colunas e omitia o id, deixando o front-end sem
-- identificador único pra usar no DELETE.
--
-- Como aplicar: rode este SQL no Supabase Studio → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop necessário porque mudamos o RETURN TYPE (Postgres não permite trocar via
-- CREATE OR REPLACE quando o tipo de retorno muda).
DROP FUNCTION IF EXISTS public.get_user_highlights_for_admin(uuid);

CREATE FUNCTION public.get_user_highlights_for_admin(target_user_id uuid)
RETURNS SETOF public.user_highlights
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Apenas admins podem invocar. RLS continua em vigor pra usos não-admin.
  SELECT *
    FROM public.user_highlights
   WHERE user_id = target_user_id
     AND public.is_admin()
   ORDER BY updated_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_user_highlights_for_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_highlights_for_admin(uuid) TO authenticated;
