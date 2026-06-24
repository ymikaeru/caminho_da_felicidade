-- ==============================================================================
-- Adiciona o estado 'omitted' à tabela translation_reports.
--
-- Uso: triagem dos reportes em que o trecho parece ter sido OMITIDO da
-- tradução e precisa de pesquisa (verificar se o texto completo existe no
-- original). Esses itens saem da fila principal ("Relatórios") e passam a
-- aparecer na aba "Omitidos (em pesquisa)", separados das correções rápidas.
--
-- Fluxo: pending ⇄ omitted   (e de qualquer um → corrected → verified)
--   "omitted"  = movido para pesquisa (não corrigido ainda)
--   "pending"  = volta para a fila principal
--   "corrected"/"verified" = fluxo normal de correção/arquivamento
--
-- Execute no SQL Editor do Supabase Dashboard.
-- ==============================================================================

-- Substitui o CHECK constraint de status (descobre o nome dinamicamente,
-- como em translation_reports_corrected_status.sql).
DO $$
DECLARE
  c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'public.translation_reports'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.translation_reports DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE public.translation_reports
  ADD CONSTRAINT translation_reports_status_check
  CHECK (status IN ('pending', 'corrected', 'verified', 'omitted'));

-- A policy de UPDATE de admins (translation_reports_add_status.sql) já cobre
-- a mudança de status, então não precisa de policy nova.
