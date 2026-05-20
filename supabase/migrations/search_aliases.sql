-- ============================================================
-- search_aliases — mapeamentos alias → forma canônica
-- ============================================================
-- Objetivo: reduzir o "zero results" mapeando variações de
-- transliteração e typos comuns pra a forma usada no corpus.
--
-- Como funciona: a Edge Function search-semantic busca essa tabela
-- (cache em memória com TTL de 60s) e substitui tokens da query
-- antes de mandar pra FTS e embed Voyage. Substituição é word-level
-- e case-insensitive.
--
-- Exemplo:
--   user digita "kyodoshin" → expandido pra "kyōdōshin"
--   FTS encontra; embed Voyage entende; resultado aparece.
--
-- Manutenção: admin adiciona/edita linhas via Supabase Studio.
-- Mudanças propagam em até 60s sem precisar redeploy.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.search_aliases (
  id BIGSERIAL PRIMARY KEY,
  alias TEXT NOT NULL,
  canonical TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'any' CHECK (lang IN ('pt', 'ja', 'any')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique por (alias, lang) — admite o mesmo alias com canônicos diferentes
-- entre PT e JA. lower() pra case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS search_aliases_alias_lang_idx
  ON public.search_aliases (lower(alias), lang);

-- RLS: leitura livre (auth users) — a Edge Function lê via JWT do
-- usuário. Escrita só pra admin.
ALTER TABLE public.search_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone reads search_aliases" ON public.search_aliases;
CREATE POLICY "anyone reads search_aliases" ON public.search_aliases
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "admins write search_aliases" ON public.search_aliases;
CREATE POLICY "admins write search_aliases" ON public.search_aliases
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Trigger pra updated_at automático
CREATE OR REPLACE FUNCTION public.search_aliases_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS search_aliases_updated_at ON public.search_aliases;
CREATE TRIGGER search_aliases_updated_at
  BEFORE UPDATE ON public.search_aliases
  FOR EACH ROW EXECUTE FUNCTION public.search_aliases_touch_updated_at();

-- ============================================================
-- Seed inicial — conservadora.
-- Adicione mais conforme observar zero-results no admin.
-- ============================================================

INSERT INTO public.search_aliases (alias, canonical, lang, notes) VALUES
  -- Variações de transliteração de "Johrei"
  ('johre',    'johrei', 'any', 'typo comum sem o "i" final'),
  ('jorei',    'johrei', 'any', 'sem o "h"'),
  ('jōrei',    'johrei', 'any', 'com macron'),
  -- Meishu-Sama
  ('meishusama',  'meishu-sama', 'any', 'sem hífen'),
  ('meishu sama', 'meishu-sama', 'any', 'com espaço'),
  -- Kannon
  ('kanon',    'kannon', 'any', 'sem o segundo "n"'),
  ('kwannon',  'kannon', 'any', 'transliteração antiga'),
  -- Ohikari
  ('o-hikari', 'ohikari', 'any', 'com hífen'),
  ('o hikari', 'ohikari', 'any', 'com espaço'),
  -- Outros
  ('mioshi',   'mioshie', 'any', 'sem o "e" final')
ON CONFLICT (lower(alias), lang) DO NOTHING;
