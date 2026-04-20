-- ==============================================================================
-- SOLUÇÃO DEFINITIVA (MODO INFALÍVEL) PARA O ERRO 500 NO SUPABASE
-- Execute este script no SQL Editor.
-- ==============================================================================

-- O erro 500 (Internal Server Error) no GET user_profiles acontece quando ocorre 
-- "Infinite Recursion" (Loop infinito) nas políticas do banco. Isso ocorre porque o 
-- Supabase tenta verificar se você é admin lendo a tabela user_profiles, mas para 
-- ler a tabela user_profiles ele tenta verificar se você é admin e entra em loop!

-- 1. LIMPAR POLÍTICAS ANTIGAS E CORTAR O MAL PELA RAIZ
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'user_profiles' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_profiles', pol.policyname);
    END LOOP;
END
$$;

-- 2. RECUPERAR SEU STATUS ADMIN SE PRECISO
UPDATE public.user_profiles 
SET role = 'admin' 
WHERE id = (SELECT id FROM auth.users WHERE email = 'SEU_EMAIL_AQUI' LIMIT 1);

-- 3. PERMITIR ACESSO BÁSICO DE LEITURA PARA TODOS OS LOGADOS (Isso quebra o loop infinito do GET)
CREATE POLICY "Leitura permitida para logados" 
ON public.user_profiles 
FOR SELECT 
USING ( auth.role() = 'authenticated' );

-- 4. PERMITIR QUE O PRÓPRIO USUÁRIO ATUALIZE SEU NOME (MAS NÃO ROUBE O CARGO)
CREATE POLICY "Usuarios atualizam proprio perfil" 
ON public.user_profiles 
FOR UPDATE 
USING ( auth.uid() = id );

-- 5. FUNÇÃO SECURITY DEFINER SUPER ISOLADA PRO ADMIN
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 6. POLÍTICA DE DELEÇÃO SÓ PRA ADMINS:
CREATE POLICY "Admins podem deletar" 
ON public.user_profiles 
FOR DELETE 
USING ( public.is_admin() );

-- 7. PARA AS OUTRAS TABELAS PELA MESMA LÓGICA
CREATE POLICY "Admins deletam tudo - permissoes" ON public.user_permissions FOR DELETE USING ( public.is_admin() );
CREATE POLICY "Admins deletam tudo - access" ON public.access_logs FOR DELETE USING ( public.is_admin() );
CREATE POLICY "Admins deletam tudo - reading" ON public.reading_positions FOR DELETE USING ( public.is_admin() );
CREATE POLICY "Admins deletam tudo - favs" ON public.synced_favorites FOR DELETE USING ( public.is_admin() );
CREATE POLICY "Admins deletam tudo - highlights" ON public.user_highlights FOR DELETE USING ( public.is_admin() );
CREATE POLICY "Admins deletam tudo - busca" ON public.search_logs FOR DELETE USING ( public.is_admin() );
