-- ==============================================================================
-- Adiciona política RLS de SELECT pra admin em synced_favorites e user_highlights.
--
-- Problema: rls_user_tables.sql só tem "Usuarios gerenciam proprios favoritos/
-- destaques" (USING auth.uid() = user_id). Admin via painel só consegue ler os
-- próprios favoritos/destaques, então o widget "Favoritos & Destaques Populares"
-- (loadPopularFavorites em admin-supabase.html) sempre retorna vazio depois
-- do filtro `!_adminIds.has(user_id)`.
--
-- Já existem políticas de DELETE pra admin em restore_admin_and_rls.sql:65-66 —
-- só faltava SELECT. Aplicar via SQL Editor do Supabase.
-- ==============================================================================

DROP POLICY IF EXISTS "Admins leem todos os favoritos" ON public.synced_favorites;
CREATE POLICY "Admins leem todos os favoritos"
  ON public.synced_favorites
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

DROP POLICY IF EXISTS "Admins leem todos os destaques" ON public.user_highlights;
CREATE POLICY "Admins leem todos os destaques"
  ON public.user_highlights
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );
