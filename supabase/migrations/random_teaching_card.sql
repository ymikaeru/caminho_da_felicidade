-- ==============================================================================
-- random_teaching_card — sorteio COM conteúdo, para o modal de descoberta
-- ==============================================================================
-- A random_teaching (scripts/search_fts_rpc.sql) devolve só (vol, file,
-- topic_idx): três identificadores, nenhum texto. Serve para NAVEGAR direto,
-- que é o que ela sempre fez. O modal precisa decidir ANTES de navegar — título
-- e primeiras linhas — senão mostra um link e não resolve nada.
--
-- FUNÇÃO NOVA, não alteração: mudar o `returns table` da random_teaching
-- exigiria DROP + CREATE, e ela tem chamador em produção (js/search.js).
--
-- ------------------------------------------------------------------
-- POR QUE plpgsql E NÃO UMA QUERY SÓ
-- ------------------------------------------------------------------
-- A primeira versão fazia tudo num SELECT: `exists(... read_marks ...)` dentro
-- do ORDER BY e `regexp_replace(content_pt)` na projeção. Resultado em
-- produção: 57014, "canceling statement due to statement timeout" — o exists
-- correlacionado era avaliado para cada uma das 17.225 linhas, e o
-- regexp_replace varria o conteúdo inteiro de muitas delas.
--
-- Aqui o trabalho é dividido:
--   1. ESCOLHE a linha (barato: anti-join contra read_marks, que tem no máximo
--      algumas centenas de linhas por usuário e índice único próprio);
--   2. só então MONTA o card, para UMA linha.
--
-- A preferência pelo não lido virou uma tentativa separada, em vez de chave de
-- ordenação: tenta um não lido; se não houver (pessoa já leu tudo do filtro),
-- cai para qualquer um. Mesmo efeito, sem custo por linha.
--
-- Parâmetros:
--   only_vol  — restringe a um volume ('mioshiec2'); null = acervo inteiro.
--   only_read — true traz SÓ o que a pessoa já leu (releitura). O ensinamento
--               que fundamenta o recurso pede exatamente isso: "é bom ler
--               repetidas vezes até que seja assimilado no íntimo".
--
-- Execute no SQL Editor do Supabase Dashboard.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.random_teaching_card(
  only_vol  text    DEFAULT NULL,
  only_read boolean DEFAULT false
)
RETURNS TABLE(
  vol text, file text, topic_idx int,
  title_pt text, title_ja text,
  excerpt_pt text, excerpt_ja text,
  already_read boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_blocked_vols text[];
  v_blocked_keys text[];   -- 'vol/file' bloqueados individualmente
  v_vol  text;
  v_file text;
  v_idx  int;
BEGIN
  -- Permissões materializadas UMA vez. Chamar _user_blocks() dentro do WHERE
  -- arriscava reexecução por linha; aqui viram dois arrays pequenos.
  -- Mantido mesmo sem usuários `limited` hoje: "bypass de volume" foi achado
  -- crítico da auditoria de 06/2026, e uma RPC sem isto vira falha silenciosa
  -- no dia em que alguém voltar a restringir acesso.
  SELECT coalesce(array_agg(b.volume), '{}')
    INTO v_blocked_vols
    FROM _user_blocks() b WHERE b.files IS NULL;

  SELECT coalesce(array_agg(b.volume || '/' || f), '{}')
    INTO v_blocked_keys
    FROM _user_blocks() b, unnest(b.files) f WHERE b.files IS NOT NULL;

  -- 1) Prefere o NÃO lido (só quando não está no modo releitura).
  IF NOT only_read THEN
    SELECT t.vol, t.file, t.topic_idx INTO v_vol, v_file, v_idx
      FROM teachings_topics t
     WHERE (only_vol IS NULL OR t.vol = only_vol)
       AND NOT (t.vol = ANY(v_blocked_vols))
       AND NOT ((t.vol || '/' || t.file) = ANY(v_blocked_keys))
       AND NOT EXISTS (
             SELECT 1 FROM read_marks r
              WHERE r.user_id = v_uid AND r.volume = t.vol
                AND r.file = t.file AND r.topic_index = t.topic_idx)
     ORDER BY random()
     LIMIT 1;
  END IF;

  -- 2) Sem não lido disponível (ou modo releitura): qualquer um do filtro.
  --    O já lido NUNCA é escondido — o ensinamento prescreve a releitura.
  IF v_vol IS NULL THEN
    SELECT t.vol, t.file, t.topic_idx INTO v_vol, v_file, v_idx
      FROM teachings_topics t
     WHERE (only_vol IS NULL OR t.vol = only_vol)
       AND NOT (t.vol = ANY(v_blocked_vols))
       AND NOT ((t.vol || '/' || t.file) = ANY(v_blocked_keys))
       AND (NOT only_read OR EXISTS (
             SELECT 1 FROM read_marks r
              WHERE r.user_id = v_uid AND r.volume = t.vol
                AND r.file = t.file AND r.topic_index = t.topic_idx))
     ORDER BY random()
     LIMIT 1;
  END IF;

  IF v_vol IS NULL THEN
    RETURN;  -- nada casa com o filtro (ex.: "só os que já li" sem leitura ainda)
  END IF;

  -- 3) Só agora o trabalho caro, e para UMA linha.
  RETURN QUERY
  SELECT
    t.vol, t.file, t.topic_idx,
    t.title_pt, t.title_ja,
    -- tags fora e espaços normalizados; o corte final (na última palavra) fica
    -- no cliente, que sabe o espaço que tem na tela
    left(regexp_replace(regexp_replace(coalesce(t.content_pt, ''), '<[^>]*>', ' ', 'g'),
                        '\s+', ' ', 'g'), 900),
    left(regexp_replace(regexp_replace(coalesce(t.content_ja, ''), '<[^>]*>', ' ', 'g'),
                        '\s+', ' ', 'g'), 400),
    EXISTS (SELECT 1 FROM read_marks r
             WHERE r.user_id = v_uid AND r.volume = t.vol
               AND r.file = t.file AND r.topic_index = t.topic_idx)
  FROM teachings_topics t
  WHERE t.vol = v_vol AND t.file = v_file AND t.topic_idx = v_idx;
END;
$$;

-- Mesmo endurecimento das demais RPCs de busca
-- (scripts/fix_search_rpcs_security_definer.sql).
REVOKE EXECUTE ON FUNCTION public.random_teaching_card(text, boolean) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.random_teaching_card(text, boolean) TO authenticated, service_role;
