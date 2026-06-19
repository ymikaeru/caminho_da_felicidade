-- ============================================================
-- Seed (rode UMA vez) — poema fixo do sino acima do calendário.
-- Pré-requisito: as colunas poema_* já existem (landing_config.sql).
-- Depois disto o poema é editável na aba "Calendário" do admin; NÃO re-rode,
-- senão sobrescreve qualquer edição feita por lá.
-- ============================================================

update public.landing_config set
  poema_ativo      = true,
  poema_autor      = 'Poemas de Meishu-Sama',
  poema_titulo     = '"Akimaro Kin''eishū" (明麿近詠集)',
  poema_original   = '諸人の　眼を醒す鐘うてど　耳を塞ぎて聞かむともせず',
  poema_romaji     = E'Morobito no / manako o samasu / kane utedo\nmimi o fusagite / kikan tomo sezu',
  poema_translation = 'Embora eu faça soar o sino para despertar a humanidade, as pessoas tapam os ouvidos e recusam-se a escutar.',
  updated_at       = now()
where id = 1;
