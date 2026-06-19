-- ============================================================
-- Correções de segurança — auditoria de 19/06/2026
-- Projeto Supabase: succhmnbajvbpmoqrktq
--
-- COMO APLICAR: cole TODO este arquivo no SQL Editor do Supabase Dashboard
-- e execute. É transacional (tudo-ou-nada) e idempotente (pode rodar 2x).
--
-- Cobre: C1 (crítico), A1 (alto, vetor tabela), M1 e M2 (médios).
-- O vetor de Storage do A1 NÃO entra aqui (ver nota no fim) — é ajuste manual
-- no Dashboard, pois a policy do bucket não está versionada e um erro
-- quebraria o carregamento de TODO o conteúdo.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- C1 [CRÍTICO] — impedir auto-promoção a admin
--
-- A policy de UPDATE de user_profiles tem só "USING (auth.uid() = id)" e
-- NENHUM "WITH CHECK", então qualquer logado consegue trocar o próprio
-- `role` para 'admin' (is_admin() = role='admin'). Em vez de reescrever as
-- policies (risco de quebrar fluxos atuais), adicionamos um trigger ADITIVO
-- que bloqueia qualquer mudança de `role`/`admin_pin_hash` feita por quem
-- NÃO é admin. Admins seguem podendo (is_admin() = true). Atualizações
-- normais (last_seen_at, display_name) não tocam essas colunas → passam.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_cols()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.admin_pin_hash IS DISTINCT FROM OLD.admin_pin_hash)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Alteração de cargo ou PIN não é permitida.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileged_cols ON public.user_profiles;
CREATE TRIGGER trg_protect_profile_privileged_cols
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileged_cols();

-- ------------------------------------------------------------
-- M1 [MÉDIO] — não vazar o hash do PIN nem a lista de membros
--
-- A policy de SELECT liberava todas as linhas/colunas a qualquer logado
-- (RLS filtra LINHA, não COLUNA), expondo admin_pin_hash (bcrypt de PIN de
-- 4-12 dígitos, bruteforce offline) + nome/cargo de todos. Nenhum fluxo de
-- não-admin lê o perfil de OUTRO usuário (login/auth leem só o próprio via
-- eq('id', ownId); analytics/users-permissions rodam como admin). Logo é
-- seguro restringir a leitura ao próprio perfil OU admin.
-- (is_admin() é SECURITY DEFINER e ignora RLS → sem recursão.)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Leitura permitida para logados" ON public.user_profiles;
CREATE POLICY "Leitura permitida para logados"
  ON public.user_profiles
  FOR SELECT
  USING ( auth.uid() = id OR public.is_admin() );

-- ------------------------------------------------------------
-- A1 [ALTO] — fechar leitura direta de teachings_topics por não-admin
--
-- O bloqueio por volume era só na UI (access.js) e dentro da RPC de busca.
-- A tabela espelho tinha SELECT liberado (using true) a qualquer logado, então
-- um usuário 'limited' lia content_pt/content_ja de um volume bloqueado via
-- select direto. Só o admin lê esta tabela diretamente (aba de tradução); o
-- leitor usa Storage e a busca usa RPC SECURITY DEFINER (ignora RLS e aplica o
-- filtro por user_permissions internamente). Restringir o SELECT direto a
-- admins fecha o vetor sem quebrar busca, leitor ou a aba de tradução.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "tt_authenticated_read" ON public.teachings_topics;
DROP POLICY IF EXISTS "tt_admin_read" ON public.teachings_topics;
CREATE POLICY "tt_admin_read"
  ON public.teachings_topics
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

-- ------------------------------------------------------------
-- M2 [MÉDIO] — signup não pode definir o próprio cargo
--
-- O trigger de criação de perfil copiava `role` do raw_user_meta_data (100%
-- controlado pelo cliente no signUp). Se "Enable email signups" estiver ligado
-- no Dashboard, daria pra nascer admin. Fixamos 'user'. Promoção a admin só
-- por SQL (ver bootstrap em restore_admin_and_rls.sql) ou por um admin.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'Usuario'),
    'user'   -- NUNCA confiar no metadata do cliente para o cargo
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
-- O trigger on_auth_user_created já aponta para esta função — não recriar.

COMMIT;

-- ============================================================
-- DEPOIS DE APLICAR — verificações (rode separadamente):
--
-- 1) Já houve auto-promoção? (contas admin que não deveriam existir)
--      SELECT id, display_name, role FROM public.user_profiles WHERE role = 'admin';
--    Se aparecer uma conta indevida:  UPDATE public.user_profiles SET role='user' WHERE id='<id>';
--
-- 2) Teste do C1 (logado como conta COMUM, no console do site):
--      await supabase.from('user_profiles').update({role:'admin'}).eq('id','<seu_uid>')
--    Esperado: erro "Alteração de cargo ou PIN não é permitida."
--
-- 3) Sanidade: o site continua normal? (login, leitura, busca, painel admin).
--
-- ------------------------------------------------------------
-- A1 — VETOR STORAGE (ajuste MANUAL no Dashboard, NÃO incluído acima):
--   O leitor baixa /storage/v1/object/authenticated/teachings/{vol}/{file}.
--   Se a policy do bucket `teachings` (em Storage > Policies) liberar tudo p/
--   'authenticated', um 'limited' baixa o volume bloqueado direto pela URL.
--   Recomendado: trocar a policy de SELECT do bucket por uma que negue volumes
--   bloqueados, resolvendo o volume por (storage.foldername(name))[1] e cruzando
--   com user_permissions — OU servir o conteúdo por RPC SECURITY DEFINER.
--   Teste o carregamento de um ensinamento depois de mexer (essa policy afeta
--   TODO o conteúdo). Depois, versione-a aqui em supabase/migrations/.
-- ============================================================
