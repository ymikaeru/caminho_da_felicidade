-- ==============================================================================
-- Adiciona campo status à tabela translation_reports
-- Execute no SQL Editor do Supabase Dashboard.
-- ==============================================================================

ALTER TABLE public.translation_reports
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified'));

CREATE INDEX IF NOT EXISTS idx_translation_reports_status
  ON public.translation_reports (status);

-- Admins podem atualizar status dos reports
CREATE POLICY "Admins atualizam status dos reports"
ON public.translation_reports
FOR UPDATE
USING ( public.is_admin() )
WITH CHECK ( public.is_admin() );
