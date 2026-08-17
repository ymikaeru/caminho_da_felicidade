-- ==============================================================================
-- read_marks — de "lido" (binário) para CONTAGEM DE LEITURAS
-- ==============================================================================
-- Motivo: o rótulo "Marcar como lido" ensinava "concluí, não preciso voltar" —
-- o oposto do ensinamento que fundamenta o acervo ("é bom ler repetidas vezes
-- até que seja assimilado no íntimo", 大いに神書を読むべし, 29/11/1950).
-- A marcação passa a ser um CONTADOR: registro da relação com aquele
-- Ensinamento, sem meta e sem total.
--
-- As linhas existentes viram times_read = 1 — o que é verdade: sempre foram
-- registros de contato, apenas mal rotulados. Nenhum dado se perde.
--
-- Execute no SQL Editor do Supabase Dashboard (ou via psql com SUPABASE_DB_URL).
-- ==============================================================================

ALTER TABLE public.read_marks
  ADD COLUMN IF NOT EXISTS times_read   integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_read_at timestamptz;

UPDATE public.read_marks
   SET last_read_at = created_at
 WHERE last_read_at IS NULL;

-- ------------------------------------------------------------------
-- register_reading — incremento ATÔMICO
-- ------------------------------------------------------------------
-- saveReadMark (js/sync.js) faz upsert SOBRESCREVENDO; somar pelo cliente
-- (ler → +1 → gravar) abriria corrida entre abas/dispositivos. O incremento
-- tem que acontecer no banco, num comando só.
--
-- security invoker: a RLS de dono (auth.uid() = user_id) já cobre INSERT e
-- UPDATE — não há motivo para elevar privilégio aqui.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_reading(
  p_volume      text,
  p_file        text,
  p_topic_index integer,
  p_topic_title text DEFAULT NULL
) RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.read_marks
    (user_id, volume, file, topic_index, topic_title, times_read, last_read_at)
  VALUES
    (auth.uid(), p_volume, p_file, p_topic_index, p_topic_title, 1, now())
  ON CONFLICT (user_id, volume, file, topic_index) DO UPDATE
    SET times_read   = read_marks.times_read + 1,
        last_read_at = now(),
        -- não apaga um título já gravado se a chamada vier sem ele
        topic_title  = COALESCE(EXCLUDED.topic_title, read_marks.topic_title)
  RETURNING times_read;
$$;

-- ------------------------------------------------------------------
-- undo_reading — desfazer imediato (engano de toque)
-- ------------------------------------------------------------------
-- Devolve a contagem resultante; 0 = a linha foi removida.
-- Nota: last_read_at NÃO é restaurado ao valor anterior (não guardamos
-- histórico de leituras, só o contador) — fica com o horário da última
-- chamada. Aceitável para um desfazer de segundos.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_reading(
  p_volume      text,
  p_file        text,
  p_topic_index integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_left integer;
BEGIN
  SELECT times_read INTO v_left
    FROM public.read_marks
   WHERE user_id = auth.uid()
     AND volume = p_volume AND file = p_file AND topic_index = p_topic_index;

  IF v_left IS NULL THEN
    RETURN 0;
  END IF;

  IF v_left <= 1 THEN
    DELETE FROM public.read_marks
     WHERE user_id = auth.uid()
       AND volume = p_volume AND file = p_file AND topic_index = p_topic_index;
    RETURN 0;
  END IF;

  UPDATE public.read_marks
     SET times_read = times_read - 1
   WHERE user_id = auth.uid()
     AND volume = p_volume AND file = p_file AND topic_index = p_topic_index
  RETURNING times_read INTO v_left;

  RETURN v_left;
END;
$$;

-- Mesmo endurecimento das demais RPCs (fix_search_rpcs_security_definer.sql):
-- nada de anônimo.
REVOKE EXECUTE ON FUNCTION public.register_reading(text, text, integer, text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.undo_reading(text, text, integer)           FROM public, anon;

GRANT EXECUTE ON FUNCTION public.register_reading(text, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_reading(text, text, integer)           TO authenticated;
