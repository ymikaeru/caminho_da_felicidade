-- ============================================================
-- Mioshie Zenshu — Analytics de Áudio: progresso POR USUÁRIO
-- ============================================================
-- Drill-down da aba 🎧 Áudio: dado um áudio (audio_path), lista quem o
-- recebeu e quanto cada um ouviu (inclusive quem não ouviu → max 0).
--
-- Parte de quem RECEBEU (study_recommendations), left join com a escuta
-- (audio_listens), pra mostrar também os "não ouviu".
--
-- archived_at: reflete a recomendação MAIS RECENTE de cada usuário p/ este
-- áudio (distinct on user_id, created_at desc). Ou seja: "quem está com o
-- áudio arquivado AGORA" — se a pessoa arquivou e foi repassada de novo (nova
-- linha ativa), conta como não-arquivada.
--
-- Pré-requisitos: public.is_admin(), public.audio_listens (audio_listen_tracking.sql),
--                 public.study_recommendations, public.user_profiles.
-- Idempotente. (DROP necessário: a assinatura de retorno mudou.)
-- ============================================================

drop function if exists public.admin_get_audio_listeners(text);

create or replace function public.admin_get_audio_listeners(p_audio_path text)
returns table(
  user_id uuid,
  display_name text,
  max_percent smallint,
  completed boolean,
  updated_at timestamptz,
  archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return query
  with recipients as (
    select distinct on (sr.user_id)
           sr.user_id, sr.archived_at
    from public.study_recommendations sr
    left join public.user_profiles pr on pr.id = sr.user_id
    where sr.audio_path = p_audio_path
      and coalesce(pr.role, '') <> 'admin'   -- admins não são público
    order by sr.user_id, sr.created_at desc  -- linha mais recente por usuário
  )
  select
    r.user_id,
    coalesce(p.display_name, '')::text,
    coalesce(al.max_percent, 0)::smallint,
    coalesce(al.completed, false),
    al.updated_at,
    r.archived_at
  from recipients r
  left join public.audio_listens al
    on al.user_id = r.user_id and al.audio_path = p_audio_path
  left join public.user_profiles p
    on p.id = r.user_id
  order by coalesce(al.max_percent, 0) desc, coalesce(p.display_name, '');
end;
$$;

revoke all on function public.admin_get_audio_listeners(text) from public;
grant execute on function public.admin_get_audio_listeners(text) to authenticated;

-- Sanity:
-- select * from admin_get_audio_listeners('audio/db4b5728-a1a6-49ac-a448-4c2151fe1aec.mp3');
