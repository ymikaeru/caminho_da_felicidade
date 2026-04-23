-- Remove todas as referências a aho1.html, aho2.html e aho3.html (Vol. 4 — "Literatura Tola")
-- das tabelas de dados de usuário. Esses arquivos foram removidos da visualização do site
-- mas continuavam aparecendo porque usuários tinham leituras/favoritos/destaques registrados.

-- Execute este script no SQL Editor do Supabase (service role).

BEGIN;

DELETE FROM public.reading_positions
WHERE volume = 'mioshiec4'
  AND file IN ('aho1.html', 'aho2.html', 'aho3.html');

DELETE FROM public.user_highlights
WHERE volume = 'mioshiec4'
  AND file IN ('aho1.html', 'aho2.html', 'aho3.html');

DELETE FROM public.synced_favorites
WHERE volume = 'mioshiec4'
  AND file IN ('aho1.html', 'aho2.html', 'aho3.html');

DELETE FROM public.access_logs
WHERE volume = 'mioshiec4'
  AND file IN ('aho1.html', 'aho2.html', 'aho3.html');

-- translation_reports usa coluna "vol" em vez de "volume"
DELETE FROM public.translation_reports
WHERE vol = 'mioshiec4'
  AND file IN ('aho1.html', 'aho2.html', 'aho3.html');

COMMIT;

-- Diagnóstico pós-execução (opcional):
-- SELECT 'reading_positions' AS tabela, count(*) FROM public.reading_positions WHERE volume='mioshiec4' AND file IN ('aho1.html','aho2.html','aho3.html')
-- UNION ALL SELECT 'user_highlights', count(*) FROM public.user_highlights WHERE volume='mioshiec4' AND file IN ('aho1.html','aho2.html','aho3.html')
-- UNION ALL SELECT 'synced_favorites', count(*) FROM public.synced_favorites WHERE volume='mioshiec4' AND file IN ('aho1.html','aho2.html','aho3.html')
-- UNION ALL SELECT 'access_logs', count(*) FROM public.access_logs WHERE volume='mioshiec4' AND file IN ('aho1.html','aho2.html','aho3.html')
-- UNION ALL SELECT 'translation_reports', count(*) FROM public.translation_reports WHERE vol='mioshiec4' AND file IN ('aho1.html','aho2.html','aho3.html');
