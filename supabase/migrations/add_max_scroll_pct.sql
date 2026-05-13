-- Rastreamento de scroll máximo por ensinamento.
-- Complementa time_spent_seconds: agora dá pra distinguir "ficou 13 min e
-- leu até o fim" de "ficou 13 min mas só viu o primeiro parágrafo".
-- Usado no admin (modal de detalhe do usuário) pra detectar dificuldade real.

-- 1) Coluna 0-100 (% do conteúdo do reader que ficou visível na maior leitura)
ALTER TABLE public.reading_positions
  ADD COLUMN IF NOT EXISTS max_scroll_pct SMALLINT NOT NULL DEFAULT 0
  CHECK (max_scroll_pct BETWEEN 0 AND 100);

-- 2) RPC: só sobe (high-water mark). Idempotente; chamada barata a cada
--    flush do reader (visibilitychange / beforeunload).
CREATE OR REPLACE FUNCTION public.update_max_scroll_pct(
  p_volume TEXT,
  p_file TEXT,
  p_pct SMALLINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_pct IS NULL OR p_pct < 0 OR p_pct > 100 THEN
    RETURN;
  END IF;

  INSERT INTO public.reading_positions (user_id, volume, file, max_scroll_pct, updated_at)
  VALUES (v_user, p_volume, p_file, p_pct, NOW())
  ON CONFLICT (user_id, volume, file)
  DO UPDATE SET
    max_scroll_pct = GREATEST(public.reading_positions.max_scroll_pct, EXCLUDED.max_scroll_pct),
    updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_max_scroll_pct(TEXT, TEXT, SMALLINT) TO authenticated;

-- Diagnóstico:
-- SELECT user_id, volume, file, time_spent_seconds, max_scroll_pct
--   FROM public.reading_positions
--   WHERE time_spent_seconds > 300 AND max_scroll_pct < 30
--   ORDER BY time_spent_seconds DESC
--   LIMIT 20;
