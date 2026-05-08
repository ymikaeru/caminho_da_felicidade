-- ==============================================================================
-- Site Events — adiciona ranking de ensinamentos (top_items) à RPC
-- de analytics e refina top_referrers para filtrar pageviews SPA.
--
-- Contexto:
--   - O tracker do guia agora dispara pageview em cada navegação SPA
--     (history.pushState/replaceState/popstate). Pageviews "de entrada"
--     da sessão carregam props.referrer/user_agent; pageviews SPA não.
--   - O ranking por path fragmenta resultados (mesmo item com mode=ensinamentos
--     vs. apostila vira duas linhas). top_items extrai o slug do ?item=...
--     e agrega independente de mode/outros params.
--
-- Execute no SQL Editor do Supabase Dashboard (idempotente — só substitui
-- a função existente, não toca em tabelas/policies/cron).
-- ==============================================================================

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
  _top_items     jsonb;
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

  -- Top referrers: somente pageviews "de entrada" (props contém 'referrer').
  -- Pageviews SPA omitem essa key — assim www.cmu.org.br não é diluído por
  -- auto-referências e (direto) reflete entradas reais sem referrer.
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
      AND props ? 'referrer'
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

  -- Top ensinamentos (extraído do ?item=<slug> do path)
  -- Combina visualizações independente do `mode` (ensinamentos/apostila/…),
  -- dando a popularidade real do conteúdo. Decoda %20/+ para legibilidade.
  SELECT coalesce(jsonb_agg(jsonb_build_object('item', item, 'visits', visits)), '[]'::jsonb)
  INTO _top_items
  FROM (
    SELECT
      replace(
        replace(
          substring(path FROM '[?&]item=([^&]+)'),
          '+', ' '
        ),
        '%20', ' '
      ) AS item,
      count(*) AS visits
    FROM site_events
    WHERE site = p_site AND event_type = 'pageview' AND created_at >= _since
      AND path ~ '[?&]item='
    GROUP BY 1
    ORDER BY visits DESC
    LIMIT 20
  ) i
  WHERE item IS NOT NULL;

  -- Engajamento: tempo médio por sessão + scroll médio máximo + bounce rate
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
    'top_items',     _top_items,
    'engagement',    _engagement,
    'top_clicks',    _top_clicks,
    'days_back',     days_back,
    'generated_at',  now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_site_analytics(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_site_analytics(text, int) TO authenticated;
