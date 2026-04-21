-- ==============================================================================
-- translation_reports — Mioshie College
-- Sistema de reporte de erros de tradução pelos usuários logados.
-- Execute no SQL Editor do Supabase Dashboard.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.translation_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vol          text NOT NULL,          -- ex: "mioshiec1"
  file         text NOT NULL,          -- ex: "espirito-precede-materia"
  topic_id     text,                   -- ex: "topic-3"
  lang         text NOT NULL DEFAULT 'pt', -- "pt" | "ja"
  selected_text text NOT NULL,         -- trecho grifado pelo usuário
  description  text,                   -- comentário opcional do usuário
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Índices para o painel admin (filtros por vol/file e ordem cronológica)
CREATE INDEX IF NOT EXISTS idx_translation_reports_vol_file
  ON public.translation_reports (vol, file);

CREATE INDEX IF NOT EXISTS idx_translation_reports_created_at
  ON public.translation_reports (created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.translation_reports ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados inserem apenas seus próprios reports
CREATE POLICY "Usuarios inserem proprios reports"
ON public.translation_reports
FOR INSERT
WITH CHECK ( auth.uid() = user_id );

-- Admins leem todos os reports
CREATE POLICY "Admins leem todos os reports"
ON public.translation_reports
FOR SELECT
USING ( public.is_admin() );
