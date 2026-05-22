-- ==============================================================================
-- Site Events — estende event_type p/ incluir tracking do modal Essência
-- (modal de boas-vindas do guia_johrei).
--
-- Antes: o CHECK constraint rejeitava silenciosamente inserts com
-- essencia_shown / essencia_suppressed (o tracker usa Prefer: return=minimal
-- e só dá console.warn no catch — falha invisível). Resultado: card
-- "Essência — Modal de Boas-vindas" do admin sempre zerado.
--
-- Execute no SQL Editor do Supabase Dashboard.
-- ==============================================================================

ALTER TABLE public.site_events
  DROP CONSTRAINT IF EXISTS site_events_event_type_check;

ALTER TABLE public.site_events
  ADD CONSTRAINT site_events_event_type_check
  CHECK (event_type IN (
    'pageview', 'heartbeat', 'scroll', 'click', 'cta', 'search', 'section',
    'audio_play', 'audio_pause', 'audio_ended',
    'essencia_shown', 'essencia_suppressed', 'essencia_skipped'
  ));
