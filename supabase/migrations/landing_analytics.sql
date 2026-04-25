-- ==============================================================================
-- Landing Analytics — CMU Landing Page (ymikaeru.github.io)
-- Tracks anonymous page visits from the landing page.
-- Execute no SQL Editor do Supabase Dashboard.
-- Depends on public.is_admin() (restore_admin_and_rls.sql).
-- ==============================================================================

-- 1. Tabela de visitas
CREATE TABLE IF NOT EXISTS public.landing_visits (
  id           bigserial PRIMARY KEY,
  anon_id      uuid        NOT NULL,
  path         text        NOT NULL,
  referrer     text,
  user_agent   text,
  lang         text,
  viewport     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS landing_visits_created_at_idx ON public.landing_visits (created_at DESC);
CREATE INDEX IF NOT EXISTS landing_visits_anon_id_idx    ON public.landing_visits (anon_id);

-- 2. RLS: INSERT público anônimo, SELECT/DELETE só admin
ALTER TABLE public.landing_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can insert landing_visits" ON public.landing_visits;
CREATE POLICY "Public can insert landing_visits"
  ON public.landing_visits
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can read landing_visits" ON public.landing_visits;
CREATE POLICY "Admins can read landing_visits"
  ON public.landing_visits
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete landing_visits" ON public.landing_visits;
CREATE POLICY "Admins can delete landing_visits"
  ON public.landing_visits
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 3. RPC agregada para o dashboard (SECURITY DEFINER + verificação is_admin)
CREATE OR REPLACE FUNCTION public.admin_get_landing_analytics(days_back int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _since timestamptz := now() - make_interval(days => days_back);
  _totals          jsonb;
  _daily           jsonb;
  _top_referrers   jsonb;
  _top_paths       jsonb;
  _today_start     timestamptz := date_trunc('day', now());
  _week_start      timestamptz := now() - interval '7 days';
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Totais hoje / 7d / período / all-time
  SELECT jsonb_build_object(
    'today_visits',     (SELECT count(*) FROM landing_visits WHERE created_at >= _today_start),
    'today_uniques',    (SELECT count(DISTINCT anon_id) FROM landing_visits WHERE created_at >= _today_start),
    'week_visits',      (SELECT count(*) FROM landing_visits WHERE created_at >= _week_start),
    'week_uniques',     (SELECT count(DISTINCT anon_id) FROM landing_visits WHERE created_at >= _week_start),
    'period_visits',    (SELECT count(*) FROM landing_visits WHERE created_at >= _since),
    'period_uniques',   (SELECT count(DISTINCT anon_id) FROM landing_visits WHERE created_at >= _since),
    'all_time_visits',  (SELECT count(*) FROM landing_visits),
    'all_time_uniques', (SELECT count(DISTINCT anon_id) FROM landing_visits)
  ) INTO _totals;

  -- Série diária
  SELECT coalesce(jsonb_agg(row), '[]'::jsonb) INTO _daily
  FROM (
    SELECT jsonb_build_object(
      'day',     to_char(d.day, 'YYYY-MM-DD'),
      'visits',  coalesce(v.visits, 0),
      'uniques', coalesce(v.uniques, 0)
    ) AS row
    FROM generate_series(_since::date, now()::date, interval '1 day') AS d(day)
    LEFT JOIN (
      SELECT date_trunc('day', created_at) AS day,
             count(*) AS visits,
             count(DISTINCT anon_id) AS uniques
      FROM landing_visits
      WHERE created_at >= _since
      GROUP BY 1
    ) v ON v.day = d.day
    ORDER BY d.day
  ) sub;

  -- Top referrers
  SELECT coalesce(jsonb_agg(jsonb_build_object('referrer', ref, 'visits', visits)), '[]'::jsonb)
  INTO _top_referrers
  FROM (
    SELECT
      coalesce(nullif(regexp_replace(referrer, '^https?://([^/]+).*$', '\1'), ''), '(direto)') AS ref,
      count(*) AS visits
    FROM landing_visits
    WHERE created_at >= _since
    GROUP BY 1
    ORDER BY visits DESC
    LIMIT 10
  ) r;

  -- Top paths
  SELECT coalesce(jsonb_agg(jsonb_build_object('path', path, 'visits', visits)), '[]'::jsonb)
  INTO _top_paths
  FROM (
    SELECT path, count(*) AS visits
    FROM landing_visits
    WHERE created_at >= _since
    GROUP BY path
    ORDER BY visits DESC
    LIMIT 10
  ) p;

  RETURN jsonb_build_object(
    'totals',        _totals,
    'daily',         _daily,
    'top_referrers', _top_referrers,
    'top_paths',     _top_paths,
    'days_back',     days_back,
    'generated_at',  now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_landing_analytics(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_landing_analytics(int) TO authenticated;
