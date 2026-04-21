-- ==============================================================================
-- RLS Policies para access_logs e tabelas relacionadas — Mioshie College
-- Execute no SQL Editor do Supabase Dashboard.
-- Estas policies garantem que usuários logados possam INSERT nos próprios logs
-- e que admins possam SELECT todos os dados de analytics.
-- ==============================================================================

-- ── access_logs ───────────────────────────────────────────────────────────────

-- Habilita RLS caso não esteja (idempotente)
ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;

-- Remove policies antigas para recriar limpas
DROP POLICY IF EXISTS "Usuarios inserem proprios logs" ON public.access_logs;
DROP POLICY IF EXISTS "Leitura de logs autenticados" ON public.access_logs;
DROP POLICY IF EXISTS "Admins leem todos os logs" ON public.access_logs;

-- Usuários autenticados podem inserir APENAS seus próprios logs
CREATE POLICY "Usuarios inserem proprios logs"
ON public.access_logs
FOR INSERT
WITH CHECK ( auth.uid() = user_id );

-- Admins podem ler todos os logs (necessário para analytics)
-- Usuários comuns podem ver apenas os próprios (para sync)
CREATE POLICY "Leitura de logs"
ON public.access_logs
FOR SELECT
USING ( auth.uid() = user_id OR public.is_admin() );

-- ── search_logs ───────────────────────────────────────────────────────────────

ALTER TABLE public.search_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios inserem proprias buscas" ON public.search_logs;
DROP POLICY IF EXISTS "Admins leem buscas" ON public.search_logs;

CREATE POLICY "Usuarios inserem proprias buscas"
ON public.search_logs
FOR INSERT
WITH CHECK ( auth.uid() = user_id );

CREATE POLICY "Admins leem buscas"
ON public.search_logs
FOR SELECT
USING ( public.is_admin() );

-- ── reading_positions ─────────────────────────────────────────────────────────

ALTER TABLE public.reading_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios gerenciam proprias posicoes" ON public.reading_positions;

CREATE POLICY "Usuarios gerenciam proprias posicoes"
ON public.reading_positions
FOR ALL
USING ( auth.uid() = user_id )
WITH CHECK ( auth.uid() = user_id );

-- ── synced_favorites ──────────────────────────────────────────────────────────

ALTER TABLE public.synced_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios gerenciam proprios favoritos" ON public.synced_favorites;

CREATE POLICY "Usuarios gerenciam proprios favoritos"
ON public.synced_favorites
FOR ALL
USING ( auth.uid() = user_id )
WITH CHECK ( auth.uid() = user_id );

-- ── user_highlights ───────────────────────────────────────────────────────────

ALTER TABLE public.user_highlights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios gerenciam proprios destaques" ON public.user_highlights;

CREATE POLICY "Usuarios gerenciam proprios destaques"
ON public.user_highlights
FOR ALL
USING ( auth.uid() = user_id )
WITH CHECK ( auth.uid() = user_id );

-- ── user_permissions (leitura pelo próprio usuário) ──────────────────────────

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios leem proprias permissoes" ON public.user_permissions;

CREATE POLICY "Usuarios leem proprias permissoes"
ON public.user_permissions
FOR SELECT
USING ( auth.uid() = user_id );
