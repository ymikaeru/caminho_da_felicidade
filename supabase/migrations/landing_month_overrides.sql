-- ============================================================
-- Landing CMU — poema fixado por MÊS (one-shot que reverte sozinho)
-- ------------------------------------------------------------
-- Diferente do poema fixo global (poema_*, fica até desligar), este fixa uma
-- poesia só num mês específico. A landing mostra o override do mês atual e, no
-- mês seguinte (sem entrada), volta sozinha à rotação por estação.
--
-- Formato (chave = "AAAA-MM"):
--   { "2026-07": { "title":..., "original":..., "romaji":..., "translation":...,
--                  "kigo":..., "meses":[...] }, ... }
--
-- Prioridade na landing: poema fixo global → poema do mês → rotação → fallback.
-- Rodar 1x no Supabase (SQL Editor). Idempotente.
-- ============================================================

alter table public.landing_config
  add column if not exists month_overrides jsonb not null default '{}'::jsonb;
