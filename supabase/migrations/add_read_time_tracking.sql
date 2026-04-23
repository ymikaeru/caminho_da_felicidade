-- Rastreamento de tempo real de leitura (estilo YouTube)
-- Um ensinamento só conta como "lido" quando o usuário passa ≥ 60 s ativo na página.
-- Usado para o ranking de leitores em admin-supabase.html (loadTopUsersRanking).

-- 1) Nova coluna acumuladora de segundos
ALTER TABLE public.reading_positions
  ADD COLUMN IF NOT EXISTS time_spent_seconds INTEGER NOT NULL DEFAULT 0;

-- Índice para acelerar o ranking por tempo
CREATE INDEX IF NOT EXISTS idx_reading_positions_time_spent
  ON public.reading_positions (time_spent_seconds)
  WHERE time_spent_seconds > 0;

-- 2) RPC que soma delta em vez de fazer upsert com sobrescrita.
--    Chamada a cada heartbeat do tracker (15 s) para evitar perda em corrida.
CREATE OR REPLACE FUNCTION public.increment_read_time(
  p_volume TEXT,
  p_file TEXT,
  p_delta INTEGER
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
  IF p_delta IS NULL OR p_delta <= 0 OR p_delta > 300 THEN
    -- Rejeita deltas ausentes, negativos, ou suspeitos (> 5 min por chamada)
    RETURN;
  END IF;

  INSERT INTO public.reading_positions (user_id, volume, file, time_spent_seconds, updated_at)
  VALUES (v_user, p_volume, p_file, p_delta, NOW())
  ON CONFLICT (user_id, volume, file)
  DO UPDATE SET
    time_spent_seconds = public.reading_positions.time_spent_seconds + EXCLUDED.time_spent_seconds,
    updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_read_time(TEXT, TEXT, INTEGER) TO authenticated;

-- Diagnóstico:
-- SELECT user_id, volume, file, time_spent_seconds
--   FROM public.reading_positions
--   WHERE time_spent_seconds > 0
--   ORDER BY time_spent_seconds DESC
--   LIMIT 20;
