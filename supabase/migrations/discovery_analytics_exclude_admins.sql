-- ==============================================================================
-- admin_discovery_analytics — tira os admins da conta
-- ==============================================================================
-- Quem construiu o recurso é quem mais o abriu: testar o modal dezenas de vezes
-- deixa o painel com uma conversão que ninguém viveu de verdade. Com dois
-- admins e poucos usuários, o ruído é grande o bastante pra inverter a leitura
-- ("o hábito pegou?" vira "o hábito pegou EM MIM").
--
-- O corte é no BANCO, não no cliente: filtrar a tabela "por usuário" no
-- JavaScript deixaria os totais, a conversão e o "mais lidos" contaminados —
-- eles já vêm agregados daqui.
--
-- Quem é admin sai por role='admin' em user_profiles, não por uma lista de
-- UUIDs: assim isto continua certo quando o quadro de admins mudar.
--
-- Idempotente (CREATE OR REPLACE) e reversível — a versão anterior está em
-- discovery_events.sql.
--
-- Execute no SQL Editor do Supabase Dashboard.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_discovery_analytics(days_back int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since  timestamptz := now() - make_interval(days => greatest(1, days_back));
  v_out    jsonb;
  v_admins int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas admin';
  END IF;

  -- Quantos admins ficaram de fora no período. O painel mostra esse número
  -- pra ninguém achar que o registro parou de funcionar ao testar o recurso.
  SELECT count(DISTINCT e.user_id) INTO v_admins
    FROM discovery_events e
    JOIN user_profiles p ON p.id = e.user_id
   WHERE e.created_at >= v_since AND p.role = 'admin';

  WITH ev AS (
    SELECT e.*
      FROM discovery_events e
     WHERE e.created_at >= v_since
       AND NOT EXISTS (
             SELECT 1 FROM user_profiles p
              WHERE p.id = e.user_id AND p.role = 'admin'
           )
  )
  SELECT jsonb_build_object(
    'since', v_since,
    'admins_excluidos', v_admins,
    'totais', (
      SELECT coalesce(jsonb_object_agg(action, n), '{}'::jsonb)
        FROM (SELECT action, count(*) AS n FROM ev GROUP BY action) x
    ),
    'usuarios_distintos', (
      SELECT count(DISTINCT user_id) FROM ev
    ),
    -- Por usuário: quem usa e com que intensidade. Conversão = leituras
    -- abertas / cartas sorteadas.
    'por_usuario', (
      SELECT coalesce(jsonb_agg(u ORDER BY (u->>'sorteios')::int DESC), '[]'::jsonb)
        FROM (
          SELECT jsonb_build_object(
                   'user_id', user_id,
                   'aberturas', count(*) FILTER (WHERE action = 'open'),
                   'sorteios',  count(*) FILTER (WHERE action = 'draw'),
                   'leituras',  count(*) FILTER (WHERE action = 'read'),
                   'guardados', count(*) FILTER (WHERE action = 'save'),
                   'ultimo_uso', max(created_at)
                 ) AS u
            FROM ev
           GROUP BY user_id
        ) t
    ),
    -- Dia a dia, pra ver se o hábito pega ou esfria.
    'por_dia', (
      SELECT coalesce(jsonb_agg(d ORDER BY d->>'dia'), '[]'::jsonb)
        FROM (
          SELECT jsonb_build_object(
                   'dia', created_at::date,
                   'aberturas', count(*) FILTER (WHERE action = 'open'),
                   'sorteios',  count(*) FILTER (WHERE action = 'draw'),
                   'leituras',  count(*) FILTER (WHERE action = 'read')
                 ) AS d
            FROM ev
           GROUP BY created_at::date
        ) t
    ),
    -- O que a descoberta levou as pessoas a LER (não o que foi sorteado):
    -- é a resposta direta a "está abrindo portas pra fora do de sempre?".
    'mais_lidos', (
      SELECT coalesce(jsonb_agg(m ORDER BY (m->>'n')::int DESC), '[]'::jsonb)
        FROM (
          SELECT jsonb_build_object('vol', vol, 'file', file,
                                    'topic_index', topic_index, 'n', count(*)) AS m
            FROM ev
           WHERE action = 'read' AND vol IS NOT NULL
           GROUP BY vol, file, topic_index
           ORDER BY count(*) DESC
           LIMIT 20
        ) t
    ),
    -- Distribuição por volume do que foi aberto pra leitura.
    'por_volume', (
      SELECT coalesce(jsonb_object_agg(vol, n), '{}'::jsonb)
        FROM (SELECT vol, count(*) AS n FROM ev
               WHERE action = 'read' AND vol IS NOT NULL
               GROUP BY vol) x
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_discovery_analytics(int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.admin_discovery_analytics(int) TO authenticated;

-- Conferência rápida (rode como admin):
--   SELECT public.admin_discovery_analytics(30) -> 'usuarios_distintos';
--   SELECT public.admin_discovery_analytics(30) -> 'admins_excluidos';
