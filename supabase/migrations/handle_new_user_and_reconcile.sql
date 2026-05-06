-- ==============================================================================
-- handle_new_user trigger + reconciliação de user_profiles faltantes
--
-- Snapshot da função/trigger que estava criada no Dashboard (fora do git) +
-- INSERT idempotente que recria user_profiles para qualquer auth.users sem
-- profile correspondente.
--
-- Motivação: descobrimos 1 caso (wfujii@gmail.com) onde o trigger falhou
-- silenciosamente ou o profile foi deletado depois, deixando 6 highlights
-- "órfãos" do ponto de vista da UI admin (que busca por user_profiles).
--
-- Idempotente:
--   - CREATE OR REPLACE FUNCTION
--   - DROP/CREATE TRIGGER
--   - INSERT ... WHERE NOT EXISTS
-- Pode ser re-executada com segurança.
-- ==============================================================================

-- 1. Função que cria user_profile no signup ----------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'Usuario'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  )
  ON CONFLICT (id) DO NOTHING;  -- defensivo: se um profile já existe (raro), não duplica
  RETURN NEW;
END;
$$;

-- 2. Trigger que dispara o handle_new_user em todo signup --------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 3. Reconciliação: cria profiles faltantes pra todo auth.users ativo --------
-- (cobre tanto o wfujii quanto qualquer caso futuro que escape do trigger)
INSERT INTO public.user_profiles (id, display_name, role)
SELECT
  au.id,
  COALESCE(au.raw_user_meta_data->>'display_name', 'Usuario'),
  COALESCE(au.raw_user_meta_data->>'role', 'user')
FROM auth.users au
WHERE au.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = au.id);

-- 4. Diagnóstico (executar manualmente quando suspeitar de drift) ------------
-- SELECT au.id, au.email, au.created_at
-- FROM auth.users au
-- WHERE au.deleted_at IS NULL
--   AND NOT EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = au.id);
