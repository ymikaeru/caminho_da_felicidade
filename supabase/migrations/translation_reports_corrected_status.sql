-- ==============================================================================
-- Adiciona o estado intermediário 'corrected' + colunas de auditoria
-- (quem corrigiu, quem arquivou e quando) à tabela translation_reports.
--
-- Fluxo: pending → corrected → verified (arquivado).
-- "Corrigido" significa que a correção foi aplicada e espera segundo par de olhos.
-- "Verified" continua sendo o estado final/arquivado (mantemos o valor pra
-- evitar migração de dados).
--
-- Execute no SQL Editor do Supabase Dashboard.
-- ==============================================================================

-- 1. Substitui o CHECK constraint existente. Descobre o nome dinamicamente
--    porque Postgres pode tê-lo gerado com sufixo diferente do esperado.
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
  CHECK (status IN ('pending', 'corrected', 'verified'));

-- 2. Colunas de auditoria
ALTER TABLE public.translation_reports
  ADD COLUMN IF NOT EXISTS corrected_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS corrected_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by  uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS verified_at  timestamptz;

-- A policy "Admins atualizam status dos reports" (criada em
-- translation_reports_add_status.sql) já cobre UPDATE em qualquer coluna
-- com is_admin(), então não precisa de policy nova pros campos de auditoria.
