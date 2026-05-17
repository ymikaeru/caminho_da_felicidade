-- ==============================================================================
-- Site Events — estende event_type p/ incluir tracking de áudio
-- (Culto Mensal do guia_johrei).
--
-- Antes: erro 42501 "new row violates row-level security policy" ao inserir
-- audio_play/audio_pause/audio_ended — o PostgREST surface da CHECK
-- constraint violation aparece como erro de RLS no cliente.
--
-- Execute no SQL Editor do Supabase Dashboard.
-- ==============================================================================

ALTER TABLE public.site_events
  DROP CONSTRAINT IF EXISTS site_events_event_type_check;

ALTER TABLE public.site_events
  ADD CONSTRAINT site_events_event_type_check
  CHECK (event_type IN (
    'pageview', 'heartbeat', 'scroll', 'click', 'cta', 'search', 'section',
    'audio_play', 'audio_pause', 'audio_ended'
  ));
