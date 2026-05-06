-- ==============================================================================
-- Backfill site_events a partir de johrei_visits / landing_visits
--
-- Copia o histórico das tabelas legadas pra site_events (raw) + site_events_daily
-- (rollup), respeitando o cutoff de 90 dias da retention.
--
-- Idempotente:
--   - Raw: NOT EXISTS por (site, anon_id, created_at) evita duplicatas
--   - Rollup: ON CONFLICT DO NOTHING evita sobrescrever
-- Pode ser re-executado com segurança (vai inserir 0 linhas na 2ª vez).
--
-- Como rodar: copia/cola tudo no SQL Editor do Supabase.
-- Depois confirma com:
--   SELECT site, event_type, count(*) FROM site_events GROUP BY 1,2;
--   SELECT site, event_type, sum(events) FROM site_events_daily GROUP BY 1,2;
-- ==============================================================================

DO $mig$
DECLARE
  _cutoff      timestamptz := now() - interval '90 days';
  _johrei_raw  bigint := 0;
  _johrei_agg  bigint := 0;
  _landing_raw bigint := 0;
  _landing_agg bigint := 0;
BEGIN
  -- ── JOHREI ────────────────────────────────────────────────────────────────

  -- 1a. Raw < 90d → site_events (pageview)
  INSERT INTO public.site_events
    (site, event_type, anon_id, session_id, path, props, created_at)
  SELECT
    'johrei',
    'pageview',
    jv.anon_id,
    gen_random_uuid(),                  -- 1 sessão por visita: tracker antigo só
                                        -- registrava 1 visita por sessão de tab
    jv.path,
    jsonb_strip_nulls(jsonb_build_object(
      'referrer',   jv.referrer,
      'user_agent', jv.user_agent,
      'lang',       jv.lang,
      'viewport',   jv.viewport
    )),
    jv.created_at
  FROM public.johrei_visits jv
  WHERE jv.created_at >= _cutoff
    AND NOT EXISTS (
      SELECT 1 FROM public.site_events se
      WHERE se.site = 'johrei'
        AND se.event_type = 'pageview'
        AND se.anon_id = jv.anon_id
        AND se.created_at = jv.created_at
    );
  GET DIAGNOSTICS _johrei_raw = ROW_COUNT;

  -- 1b. >= 90d → site_events_daily (rollup)
  INSERT INTO public.site_events_daily (site, event_type, day, events, uniques, sessions)
  SELECT
    'johrei',
    'pageview',
    (created_at AT TIME ZONE 'UTC')::date AS day,
    count(*),
    count(DISTINCT anon_id),
    count(DISTINCT anon_id)              -- aproximação: 1 sessão por anon/dia
  FROM public.johrei_visits
  WHERE created_at < _cutoff
  GROUP BY 1, 2, 3
  ON CONFLICT (site, event_type, day) DO NOTHING;
  GET DIAGNOSTICS _johrei_agg = ROW_COUNT;

  -- ── LANDING ───────────────────────────────────────────────────────────────

  -- 2a. Raw < 90d → site_events (pageview)
  INSERT INTO public.site_events
    (site, event_type, anon_id, session_id, path, props, created_at)
  SELECT
    'landing',
    'pageview',
    lv.anon_id,
    gen_random_uuid(),                  -- registrava 1 visita por sessão de tab
    lv.path,
    jsonb_strip_nulls(jsonb_build_object(
      'referrer',   lv.referrer,
      'user_agent', lv.user_agent,
      'lang',       lv.lang,
      'viewport',   lv.viewport
    )),
    lv.created_at
  FROM public.landing_visits lv
  WHERE lv.created_at >= _cutoff
    AND NOT EXISTS (
      SELECT 1 FROM public.site_events se
      WHERE se.site = 'landing'
        AND se.event_type = 'pageview'
        AND se.anon_id = lv.anon_id
        AND se.created_at = lv.created_at
    );
  GET DIAGNOSTICS _landing_raw = ROW_COUNT;

  -- 2b. >= 90d → site_events_daily (rollup)
  INSERT INTO public.site_events_daily (site, event_type, day, events, uniques, sessions)
  SELECT
    'landing',
    'pageview',
    (created_at AT TIME ZONE 'UTC')::date AS day,
    count(*),
    count(DISTINCT anon_id),
    count(DISTINCT anon_id)
  FROM public.landing_visits
  WHERE created_at < _cutoff
  GROUP BY 1, 2, 3
  ON CONFLICT (site, event_type, day) DO NOTHING;
  GET DIAGNOSTICS _landing_agg = ROW_COUNT;

  RAISE NOTICE 'Backfill concluído. johrei: % raw + % daily | landing: % raw + % daily',
    _johrei_raw, _johrei_agg, _landing_raw, _landing_agg;
END
$mig$;
