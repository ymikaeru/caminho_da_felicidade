-- Shared admin-scoped key/value store. Hoje guarda apenas o estado do painel
-- "Permissões padrão" (antes em localStorage, que era por-navegador/por-admin).
-- Pode crescer para outros settings compartilhados entre admins no futuro.

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_settings_select ON admin_settings;
CREATE POLICY admin_settings_select ON admin_settings
  FOR SELECT TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS admin_settings_insert ON admin_settings;
CREATE POLICY admin_settings_insert ON admin_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS admin_settings_update ON admin_settings;
CREATE POLICY admin_settings_update ON admin_settings
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS admin_settings_delete ON admin_settings;
CREATE POLICY admin_settings_delete ON admin_settings
  FOR DELETE TO authenticated
  USING (is_admin());
