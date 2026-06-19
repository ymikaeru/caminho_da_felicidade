-- ============================================================
-- Correções de segurança — A1 (vetor Storage) — 19/06/2026
-- Projeto Supabase: succhmnbajvbpmoqrktq
--
-- Complemento de security_fixes_2026_06.sql. Fecha o bypass do bloqueio por
-- volume pelo BUCKET `teachings` (o leitor baixa direto do Storage).
--
-- Estado anterior do bucket `teachings` (auditado via pg_policies):
--   - "Allow authenticated users to read"  → USING (true)  [todos os buckets!]
--   - "Allow public read on teachings bucket" → USING (bucket_id='teachings')
--   - "Users can read permitted teachings" → lógica INVERTIDA (concedia o que
--     deveria bloquear) + formato de arquivo divergente
--   => qualquer logado lia qualquer volume, mesmo bloqueado.
--
-- COMO APLICAR: SQL Editor do Supabase. Transacional e idempotente.
-- Já aplicado em produção em 19/06/2026 (este arquivo é o registro versionado).
-- ============================================================
BEGIN;

-- 1) Remove os grants escancarados de LEITURA do bucket teachings.
DROP POLICY IF EXISTS "Allow public read on teachings bucket" ON storage.objects;
DROP POLICY IF EXISTS "Users can read permitted teachings"   ON storage.objects;

-- 2) Tira o bucket teachings do grant global "true" — os DEMAIS buckets
--    (rec-audio, etc.) continuam lendo por este mesmo policy, intactos.
ALTER POLICY "Allow authenticated users to read" ON storage.objects
  USING ( bucket_id <> 'teachings' );

-- 3) Leitura de teachings = admin OU (logado E NÃO bloqueado em user_permissions).
--    Modelo blacklist: sem linha de bloqueio → lê; com bloqueio (volume inteiro
--    via files IS NULL, ou arquivo específico) → nega. Aceita os dois formatos
--    de nome de arquivo ('x.html' e 'x.html.json') porque há duas convenções no
--    código e a tabela está vazia hoje.
DROP POLICY IF EXISTS "teachings_user_scoped_read" ON storage.objects;
CREATE POLICY "teachings_user_scoped_read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'teachings'
  AND (
    public.is_admin()
    OR NOT EXISTS (
      SELECT 1 FROM public.user_permissions p
      WHERE p.user_id = auth.uid()
        AND split_part(name, '/', 1) = p.volume
        AND (
          p.files IS NULL
          OR p.files @> ARRAY[ split_part(name, '/', 2) ]
          OR p.files @> ARRAY[ regexp_replace(split_part(name, '/', 2), '\.json$', '') ]
        )
    )
  )
);

COMMIT;

-- ============================================================
-- Mantidas (corretas): "Admins can read all teachings",
--   "Admins can manage teachings", "Service role full access *".
--
-- PENDÊNCIA SEPARADA (escrita) — avaliar e versionar à parte:
--   "Allow authenticated users to upload" (INSERT) e
--   "Allow authenticated users to update" (UPDATE, USING true) deixam qualquer
--   logado escrever/sobrescrever objetos. Escritas legítimas são do service_role.
--   Remover após confirmar que nenhum fluxo do site faz upload como usuário comum:
--     DROP POLICY IF EXISTS "Allow authenticated users to upload" ON storage.objects;
--     DROP POLICY IF EXISTS "Allow authenticated users to update" ON storage.objects;
--
-- TESTE: usuário sem bloqueio lê normal; com INSERT em user_permissions
--   (volume, files=NULL) → 403 no ensinamento daquele volume; rec-audio intacto.
-- ============================================================
