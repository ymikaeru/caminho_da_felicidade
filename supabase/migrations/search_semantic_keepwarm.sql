-- ============================================================
-- keep-warm da Edge Function search-semantic
-- ============================================================
-- Problema observado nas analytics de busca:
--   - latência mediana: ~3-6s
--   - P95: ~18-20s
--   - P99: ~31-51s
-- O cliente já loga "~provável cold start" no breakdown de timings
-- quando rede+edge passa de 2s. Edge Functions Supabase dormem
-- após poucos minutos sem tráfego, e o spin-up Deno custa 1-3s.
--
-- Solução: cron a cada 4min que invoca a função com uma query
-- trivial ("warmup"). Mantém o container quente e exercita o
-- pipeline (Voyage embed + RPC). O rerank Voyage não dispara
-- porque results.length será ≤1.
--
-- Auth: anon key (já pública no client). A função roda com
-- auth.uid()=null; a RPC search_teachings_hybrid retorna 0 linhas
-- via _user_blocks — irrelevante pro propósito de keep-warm.
--
-- Custo estimado: ~360 invocações/dia ≈ $0.001/dia em Voyage.
--
-- Como remover: SELECT cron.unschedule('keepwarm-search-semantic');
-- Como pausar:  UPDATE cron.job SET active = false
--                 WHERE jobname = 'keepwarm-search-semantic';
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- cron.schedule por nome (pg_cron >= 1.4) substitui job existente
-- com mesmo nome, então rodar essa migration de novo é idempotente.
SELECT cron.schedule(
  'keepwarm-search-semantic',
  '*/4 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://succhmnbajvbpmoqrktq.supabase.co/functions/v1/search-semantic',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1Y2NobW5iYWp2YnBtb3Fya3RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NjY3MDgsImV4cCI6MjA5MjA0MjcwOH0.humCcLYpnnnapkLtLOeb9ZVo5EZWoWw6ItNo0WVY3DY'
    ),
    body := jsonb_build_object(
      'q', 'warmup',
      'lang', 'pt',
      'max_results', 1
    )
  ) AS request_id;
  $$
);

-- ─────────────────────────────────────────────────────────────
-- Verificação (rodar manualmente):
--
--   -- 1. Job registrado?
--   SELECT jobid, jobname, schedule, active
--     FROM cron.job
--     WHERE jobname = 'keepwarm-search-semantic';
--
--   -- 2. Últimas execuções (esperar ~5min após aplicar)
--   SELECT start_time, status, return_message
--     FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job
--                    WHERE jobname = 'keepwarm-search-semantic')
--     ORDER BY start_time DESC
--     LIMIT 10;
--
--   -- 3. Response status da última invocação HTTP
--   SELECT status_code, content::jsonb, created
--     FROM net._http_response
--     ORDER BY created DESC
--     LIMIT 5;
-- ─────────────────────────────────────────────────────────────
