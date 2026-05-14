-- ==============================================================================
-- Captura do diff antes/depois ao corrigir.
--
-- pt_before: snapshot do parágrafo PT no momento em que o editor foi aberto
--            pela primeira vez (preservado em re-edições).
-- pt_after:  versão corrigida do parágrafo (atualizada a cada save).
--
-- Populados automaticamente quando o admin abre o editor a partir de um report
-- (openEditorFromReport → saveEditor) e identifica qual segmento mudou.
--
-- Execute no SQL Editor do Supabase Dashboard.
-- ==============================================================================

ALTER TABLE public.translation_reports
  ADD COLUMN IF NOT EXISTS pt_before text,
  ADD COLUMN IF NOT EXISTS pt_after  text;
