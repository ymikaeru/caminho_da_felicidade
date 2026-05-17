-- ==============================================================================
-- Site Events — analytics genérico para landing page e guia_johrei
-- Substitui (futuramente) johrei_visits / landing_visits por uma tabela única
-- de eventos, permitindo rastrear pageview + dwell time + scroll + cliques.
--
-- Execute no SQL Editor do Supabase Dashboard, na ordem deste arquivo.
-- Depende de: public.is_admin() (restore_admin_and_rls.sql).
-- Requer extensão pg_cron habilitada (Dashboard > Database > Extensions).
-- ==============================================================================

-- 1. Tabela bruta de eventos -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_events (
  id          bigserial    PRIMARY KEY,
  site        text         NOT NULL,
  event_type  text         NOT NULL,
  anon_id     uuid         NOT NULL,
  session_id  uuid         NOT NULL,
  path        text,
  props       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT site_events_site_check
    CHECK (site IN ('landing', 'johrei')),
  CONSTRAINT site_events_event_type_check
    CHECK (event_type IN (
      'pageview', 'heartbeat', 'scroll', 'click', 'cta', 'search', 'section',
      'audio_play', 'audio_pause', 'audio_ended'
    ))
);

CREATE INDEX IF NOT EXISTS site_events_site_created_idx
  ON public.site_events (site, created_at DESC);
CREATE INDEX IF NOT EXISTS site_events_type_created_idx
  ON public.site_events (site, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS site_events_anon_idx
  ON public.site_events (site, anon_id);
CREATE INDEX IF NOT EXISTS site_events_session_idx
  ON public.site_events (session_id);

-- 2. Tabela agregada diária (mantida indefinidamente) ------------------------
-- Convenção: contém SOMENTE dias > 90d (preenchida pela retention).
-- Dias 0–90 ficam apenas no raw (site_events). Sem overlap, sem dupla contagem.
CREATE TABLE IF NOT EXISTS public.site_events_daily (
  site         text   NOT NULL,
  event_type   text   NOT NULL,
  day          date   NOT NULL,
  events       bigint NOT NULL,
  uniques      bigint NOT NULL,
  sessions     bigint NOT NULL,
  PRIMARY KEY (site, event_type, day)
);

CREATE INDEX IF NOT EXISTS site_events_daily_day_idx
  ON public.site_events_daily (day DESC);

-- 3. RLS ---------------------------------------------------------------------
ALTER TABLE public.site_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_events_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can insert site_events" ON public.site_events;
CREATE POLICY "Public can insert site_events"
  ON public.site_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can read site_events" ON public.site_events;
CREATE POLICY "Admins can read site_events"
  ON public.site_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete site_events" ON public.site_events;
CREATE POLICY "Admins can delete site_events"
  ON public.site_events
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can read site_events_daily" ON public.site_events_daily;
CREATE POLICY "Admins can read site_events_daily"
  ON public.site_events_daily
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 4. RPC do dashboard --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_site_analytics(
  p_site      text,
  days_back   int DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _since         timestamptz := now() - make_interval(days => days_back);
  _today_start   timestamptz := date_trunc('day', now());
  _week_start    timestamptz := now() - interval '7 days';
  _totals        jsonb;
  _daily         jsonb;
  _top_paths     jsonb;
  _top_referrers jsonb;
  _engagement    jsonb;
  _top_clicks    jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_site NOT IN ('landing', 'johrei') THEN
    RAISE EXCEPTION 'Invalid site: %', p_site USING ERRCODE = '22023';
  END IF;

  -- Totais (pageview) - hoje / 7d / período / all-time
  SELECT jsonb_build_object(
    'today_visits',     (SELECT count(*)              FROM site_events WHERE site = p_site AND event_type = 'pageview' AND created_at >= _today_start),
    'today_uniques',    (SELECT count(DISTINCT anon_id) FROM site_events WHERE site = p_site AND event_type = 'pageview' AND created_at >= _today_start),
    'week_visits',      (SELECT count(*)              FROM site_events WHERE site = p_site AND event_type = 'pageview' AND created_at >= _week_start),
    'week_uniques',     (SELECT count(DISTINCT anon_id) FROM site_events WHERE site = p_site AND event_type = 'pageview' AND created_at >= _week_start),
    'period_visits',    (SELECT count(*)              FROM site_events WHERE site = p_site AND event_type = 'pageview' AND created_at >= _since),
    'period_uniques',   (SELECT count(DISTINCT anon_id) FROM site_events WHERE site = p_site AND event_type = 'pageview' AND created_at >= _since),
    'period_sessions',  (SELECT count(DISTINCT session_id) FROM site_events WHERE site = p_site AND created_at >= _since),
    'all_time_visits',  COALESCE((SELECT sum(events) FROM site_events_daily WHERE site = p_site AND event_type = 'pageview'), 0)
                        + (SELECT count(*) FROM site_events WHERE site = p_site AND event_type = 'pageview')
  ) INTO _totals;

  -- Série diária (pageview): rollup p/ dias > 90d, raw p/ dias <= 90d (sem overlap)
  SELECT coalesce(jsonb_agg(row ORDER BY (row->>'day')), '[]'::jsonb) INTO _daily
  FROM (
    SELECT jsonb_build_object(
      'day',     to_char(d.day, 'YYYY-MM-DD'),
      'visits',  coalesce(v.visits, 0),
      'uniques', coalesce(v.uniques, 0)
    ) AS row
    FROM generate_series(_since::date, current_date, interval '1 day') AS d(day)
    LEFT JOIN (
      SELECT day, events AS visits, uniques
        FROM site_events_daily
        WHERE site = p_site AND event_type = 'pageview' AND day >= _since::date
      UNION ALL
      SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
             count(*) AS visits,
             count(DISTINCT anon_id) AS uniques
        FROM site_events
        WHERE site = p_site AND event_type = 'pageview' AND created_at >= _since
        GROUP BY 1
    ) v ON v.day = d.day
  ) sub;

  -- Top referrers (de props->>'referrer' nos pageviews recentes)
  SELECT coalesce(jsonb_agg(jsonb_build_object('referrer', ref, 'visits', visits)), '[]'::jsonb)
  INTO _top_referrers
  FROM (
    SELECT
      coalesce(
        nullif(regexp_replace(props->>'referrer', '^https?://([^/]+).*$', '\1'), ''),
        '(direto)'
      ) AS ref,
      count(*) AS visits
    FROM site_events
    WHERE site = p_site AND event_type = 'pageview' AND created_at >= _since
    GROUP BY 1
    ORDER BY visits DESC
    LIMIT 10
  ) r;

  -- Top paths
  SELECT coalesce(jsonb_agg(jsonb_build_object('path', path, 'visits', visits)), '[]'::jsonb)
  INTO _top_paths
  FROM (
    SELECT path, count(*) AS visits
    FROM site_events
    WHERE site = p_site AND event_type = 'pageview' AND created_at >= _since
      AND path IS NOT NULL
    GROUP BY path
    ORDER BY visits DESC
    LIMIT 10
  ) p;

  -- Engajamento: tempo médio por sessão + scroll médio máximo + bounce rate
  -- (heartbeat envia delta_seconds em props; scroll envia max_pct em props)
  SELECT jsonb_build_object(
    'avg_session_seconds',  COALESCE((
      SELECT round(avg(total)::numeric, 1) FROM (
        SELECT sum((props->>'delta_seconds')::int) AS total
        FROM site_events
        WHERE site = p_site AND event_type = 'heartbeat' AND created_at >= _since
        GROUP BY session_id
      ) s
    ), 0),
    'avg_max_scroll_pct',   COALESCE((
      SELECT round(avg((props->>'max_pct')::numeric), 1)
      FROM site_events
      WHERE site = p_site AND event_type = 'scroll' AND created_at >= _since
    ), 0),
    'bounce_rate_pct',      COALESCE((
      SELECT round(100.0 * count(*) FILTER (WHERE pageviews = 1) / nullif(count(*), 0), 1)
      FROM (
        SELECT session_id, count(*) AS pageviews
        FROM site_events
        WHERE site = p_site AND event_type = 'pageview' AND created_at >= _since
        GROUP BY session_id
      ) s
    ), 0)
  ) INTO _engagement;

  -- Top cliques (event_type='click' ou 'cta', label em props->>'label')
  SELECT coalesce(jsonb_agg(jsonb_build_object('label', label, 'kind', kind, 'clicks', clicks)), '[]'::jsonb)
  INTO _top_clicks
  FROM (
    SELECT
      coalesce(props->>'label', props->>'href', '(sem rótulo)') AS label,
      event_type AS kind,
      count(*) AS clicks
    FROM site_events
    WHERE site = p_site AND event_type IN ('click', 'cta') AND created_at >= _since
    GROUP BY 1, 2
    ORDER BY clicks DESC
    LIMIT 10
  ) c;

  RETURN jsonb_build_object(
    'site',          p_site,
    'totals',        _totals,
    'daily',         _daily,
    'top_referrers', _top_referrers,
    'top_paths',     _top_paths,
    'engagement',    _engagement,
    'top_clicks',    _top_clicks,
    'days_back',     days_back,
    'generated_at',  now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_site_analytics(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_site_analytics(text, int) TO authenticated;

-- 5. Função de retenção (rollup + delete em uma só passada) ------------------
-- Único job de manutenção: pega tudo > 90d, agrega no daily, e apaga do raw.
-- Idempotente: ON CONFLICT DO UPDATE; DELETE só remove o que já foi agregado.
CREATE OR REPLACE FUNCTION public.site_events_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cutoff timestamptz := now() - interval '90 days';
BEGIN
  INSERT INTO site_events_daily (site, event_type, day, events, uniques, sessions)
  SELECT site,
         event_type,
         (created_at AT TIME ZONE 'UTC')::date AS day,
         count(*),
         count(DISTINCT anon_id),
         count(DISTINCT session_id)
  FROM site_events
  WHERE created_at < _cutoff
  GROUP BY 1, 2, 3
  -- Replace, não acumula: cada dia é processado uma vez (DELETE remove a fonte).
  -- Se a função for re-executada antes do DELETE concluir, último valor ganha.
  ON CONFLICT (site, event_type, day) DO UPDATE SET
    events   = EXCLUDED.events,
    uniques  = EXCLUDED.uniques,
    sessions = EXCLUDED.sessions;

  DELETE FROM site_events WHERE created_at < _cutoff;
END;
$$;

-- 6. Agendamento via pg_cron -------------------------------------------------
-- Pré-requisito: extensão pg_cron habilitada no projeto.
-- Habilitar (uma vez): Dashboard > Database > Extensions > pg_cron > Enable
-- ou: CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotente: remove agendamento anterior se existir
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'site_events_retention') THEN
      PERFORM cron.unschedule('site_events_retention');
    END IF;

    -- Retenção: roda diariamente às 03:30 UTC (~00:30 BRT)
    PERFORM cron.schedule(
      'site_events_retention',
      '30 3 * * *',
      $cron$ SELECT public.site_events_retention(); $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron não habilitado. Habilite em Dashboard > Database > Extensions e re-execute apenas a seção 6.';
  END IF;
END
$outer$;

-- 7. Diagnóstico (executar manualmente quando precisar) ----------------------
-- Volume bruto e tamanho:
--   SELECT count(*), pg_size_pretty(pg_total_relation_size('public.site_events')) FROM site_events;
-- Eventos por tipo nos últimos 7 dias:
--   SELECT event_type, count(*) FROM site_events WHERE created_at > now() - interval '7 days' GROUP BY 1;
-- Jobs do cron:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'site_events%';
-- Forçar retenção/rollup agora:
--   SELECT public.site_events_retention();
