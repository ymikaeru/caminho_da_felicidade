-- ============================================================
-- Remover o keep-warm da Edge Function search-semantic
-- ============================================================
-- Supersede: search_semantic_keepwarm.sql
--
-- Motivo: volume de buscas baixo + o modo Relacionados agora é SOB
-- DEMANDA (o Voyage só roda quando o usuário clica em "Buscar
-- relacionados" / aperta Enter, não a cada tecla no typeahead — ver
-- js/search.js _renderRelatedPrompt / runRelatedSearch). Manter um
-- container Deno quente 24/7 com ~360 embeds Voyage/dia deixou de
-- compensar. Aceitamos o cold-start (~1-3s) na primeira busca
-- semântica após ociosidade.
--
-- Idempotente: só desagenda se o job existir.
-- Reversível: reaplicar search_semantic_keepwarm.sql recria o cron.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'keepwarm-search-semantic') THEN
    PERFORM cron.unschedule('keepwarm-search-semantic');
    RAISE NOTICE 'keepwarm-search-semantic desagendado.';
  ELSE
    RAISE NOTICE 'keepwarm-search-semantic não existe — nada a fazer.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Verificação (rodar manualmente após aplicar):
--
--   SELECT jobid, jobname, schedule, active
--     FROM cron.job
--     WHERE jobname = 'keepwarm-search-semantic';
--   -- esperado: 0 linhas
-- ─────────────────────────────────────────────────────────────
