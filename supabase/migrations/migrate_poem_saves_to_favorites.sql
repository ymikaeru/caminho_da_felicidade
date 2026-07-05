-- ============================================================
-- Migração: "Poemas Salvos" (grifos) → Favoritos (synced_favorites)
-- ============================================================
-- Contexto (07/2026): o "salvar poema" das páginas de poesia era, na prática,
-- um FAVORITO (poema inteiro, 1 clique), mas ficava guardado na tabela de
-- grifos `user_highlights` com start_char=0/end_char=0 (ver o cabeçalho antigo
-- de js/poetry-highlights.js). A partir de agora o poema é um favorito de
-- verdade (mesmo sistema dos Ensinamentos Salvos, com PASTAS), então esta
-- migração converte os saves existentes para `synced_favorites` — assim
-- ninguém perde o que já salvou e tudo aparece junto na Central de Salvos.
--
-- SEGURO: idempotente (ON CONFLICT DO NOTHING) e NÃO apaga nada no passo 1.
-- Rode o passo 1, confira as contagens, e SÓ ENTÃO rode o passo 3 (delete).
-- ============================================================

-- ── Passo 0 — Backup das linhas que serão migradas ──────────────────────────
-- (Descartável depois de confirmar que a migração deu certo.)
create table if not exists public._backup_poem_saves_20260705 as
  select * from public.user_highlights
  where volume = 'poetry'
    and coalesce(start_char, 0) = 0
    and coalesce(end_char, 0) = 0
    and topic_index is not null;

-- Quantos serão migrados (referência):
-- select count(*) as a_migrar from public._backup_poem_saves_20260705;

-- ── Passo 1 — Converter grifos-de-poema em favoritos ────────────────────────
-- snippet = verso (até 200 chars). total_topics = 0 (poema não tem "N de M").
-- folder_id = null ("Sem pasta"); o usuário organiza depois.
insert into public.synced_favorites
  (user_id, volume, file, topic_index, topic_title, snippet, total_topics, folder_id, created_at)
select
  h.user_id,
  'poetry',
  h.file,
  h.topic_index,
  h.topic_title,
  left(coalesce(h.text, ''), 200),
  0,
  null,
  coalesce(h.updated_at, now())
from public.user_highlights h
where h.volume = 'poetry'
  and coalesce(h.start_char, 0) = 0
  and coalesce(h.end_char, 0) = 0
  and h.topic_index is not null
on conflict (user_id, volume, file, topic_index) do nothing;

-- ── Passo 2 — Verificação (rodar e conferir ANTES do delete) ────────────────
-- Favoritos de poesia agora existentes por usuário:
--   select user_id, count(*) from public.synced_favorites
--   where volume = 'poetry' group by user_id order by 2 desc;
-- Deve bater (ou ser >=) com o backup do passo 0.

-- ── Passo 3 — Apagar os grifos-de-poema já migrados ─────────────────────────
-- ⚠ SÓ rode depois de confirmar o passo 2. Remove APENAS os saves de poema
-- inteiro (start=end=0); grifos de trecho de poema (se existirem, start≠0)
-- são preservados. O backup do passo 0 permite reverter.
--
-- delete from public.user_highlights
-- where volume = 'poetry'
--   and coalesce(start_char, 0) = 0
--   and coalesce(end_char, 0) = 0
--   and topic_index is not null;

-- ── Reversão (se necessário) ────────────────────────────────────────────────
-- Reverter o passo 1 (apaga os favoritos de poesia recém-criados):
--   delete from public.synced_favorites where volume = 'poetry';
-- Restaurar os grifos do backup (se o passo 3 já rodou):
--   insert into public.user_highlights select * from public._backup_poem_saves_20260705
--   on conflict do nothing;
