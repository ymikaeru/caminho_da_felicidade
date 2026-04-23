-- ==============================================================================
-- Permite que admins leiam todas as linhas de reading_positions.
-- Necessário para o ranking de usuários mais ativos no admin panel
-- (loadTopUsersRanking em admin-supabase.html), que estava retornando vazio
-- porque a única policy de SELECT existente era `auth.uid() = user_id`.
-- ==============================================================================

DROP POLICY IF EXISTS "Admins leem todas as posicoes" ON public.reading_positions;

CREATE POLICY "Admins leem todas as posicoes"
ON public.reading_positions
FOR SELECT
USING ( public.is_admin() );
