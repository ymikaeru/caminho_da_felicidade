-- ============================================================
-- FIX 03/07/2026 — busca/sorteio vazios para membros não-admin
-- ============================================================
-- Desde a auditoria de segurança (06/2026), teachings_topics tem RLS
-- admin-only (tt_admin_read using is_admin()). As 5 RPCs de leitura que o
-- cliente chama (random_teaching, search_teachings, search_teachings_hybrid,
-- search_teachings_literal, suggest_teachings) eram SECURITY INVOKER →
-- rodavam com os direitos do usuário → membro não-admin via ZERO linhas e
-- recebia [] SEM erro (sintoma: "Luz do Momento" girava e não fazia nada;
-- FTS de conteúdo zerado, mascarado pelo índice local de títulos + semântica
-- via Edge Function).
--
-- Correção: promover as 5 a SECURITY DEFINER — viram o caminho ÚNICO e
-- CONTROLADO de leitura (como o plano de migração previa: "a RPC é o único
-- caminho de leitura"). É seguro: todas filtram _user_blocks() por dentro
-- (verificado via pg_get_functiondef em 03/07/2026).
--
-- Segurança: DEFINER + anon com EXECUTE = vazamento de conteúdo → revogamos
-- anon/public e mantemos só authenticated (+service_role). O site exige
-- login de qualquer forma; anon passa a receber "permission denied" (o
-- cliente já trata como erro visível — toast do sorteio, v=51).

begin;

alter function public.random_teaching(text) security definer;
alter function public.random_teaching(text) set search_path = public;

alter function public.search_teachings(text, text, integer, text) security definer;
alter function public.search_teachings(text, text, integer, text) set search_path = public;

alter function public.search_teachings_hybrid(text, vector, text, integer, text, boolean) security definer;
alter function public.search_teachings_hybrid(text, vector, text, integer, text, boolean) set search_path = public;

alter function public.search_teachings_literal(text, text, integer, text) security definer;
alter function public.search_teachings_literal(text, text, integer, text) set search_path = public;

alter function public.suggest_teachings(text, text) security definer;
alter function public.suggest_teachings(text, text) set search_path = public;

revoke execute on function public.random_teaching(text) from public, anon;
revoke execute on function public.search_teachings(text, text, integer, text) from public, anon;
revoke execute on function public.search_teachings_hybrid(text, vector, text, integer, text, boolean) from public, anon;
revoke execute on function public.search_teachings_literal(text, text, integer, text) from public, anon;
revoke execute on function public.suggest_teachings(text, text) from public, anon;

grant execute on function public.random_teaching(text) to authenticated, service_role;
grant execute on function public.search_teachings(text, text, integer, text) to authenticated, service_role;
grant execute on function public.search_teachings_hybrid(text, vector, text, integer, text, boolean) to authenticated, service_role;
grant execute on function public.search_teachings_literal(text, text, integer, text) to authenticated, service_role;
grant execute on function public.suggest_teachings(text, text) to authenticated, service_role;

commit;

-- Verificação: todas devem sair DEFINER.
select proname,
       case when prosecdef then 'DEFINER' else 'INVOKER' end as modo
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('random_teaching','search_teachings','search_teachings_hybrid',
                  'search_teachings_literal','suggest_teachings')
order by 1;
