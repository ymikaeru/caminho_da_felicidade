-- ==============================================================================
-- Site Events — estende event_type p/ incluir download_zip (Culto Mensal:
-- botão "Baixar" que gera o ZIP com PDF + MP3) e apostila_print (impressão da
-- apostila no guia_johrei).
--
-- BUG QUE ISSO CORRIGE:
--   Esses dois tipos NUNCA estiveram no CHECK constraint (nem na base, nem nas
--   migrations de audio/essência). O guia_johrei já emite ambos há tempo, mas
--   cada insert era REJEITADO pelo banco (violação de CHECK, que o PostgREST
--   devolve como erro). O tracker usa `Prefer: return=minimal` + `.catch`
--   silencioso, então a falha era invisível e os cards "Download (ZIP)" e
--   "Apostila — Impressões" do admin ficavam SEMPRE zerados — mesmo com
--   downloads/impressões reais acontecendo.
--
--   (O commit "flush download_zip immediately to avoid loss" tentou resolver
--    como se fosse perda por timing — mas a linha estava sendo rejeitada, não
--    perdida. Esta migration é a correção de raiz.)
--
-- ATENÇÃO: é forward-only. Os eventos rejeitados no passado NÃO foram salvos
-- e não há como recuperá-los; a contagem passa a funcionar a partir de agora.
--
-- Execute no SQL Editor do Supabase Dashboard. Idempotente (DROP IF EXISTS +
-- ADD com a lista completa de tipos válidos).
-- ==============================================================================

ALTER TABLE public.site_events
  DROP CONSTRAINT IF EXISTS site_events_event_type_check;

ALTER TABLE public.site_events
  ADD CONSTRAINT site_events_event_type_check
  CHECK (event_type IN (
    'pageview', 'heartbeat', 'scroll', 'click', 'cta', 'search', 'section',
    'audio_play', 'audio_pause', 'audio_ended',
    'essencia_shown', 'essencia_suppressed', 'essencia_skipped',
    'download_zip', 'apostila_print'
  ));
