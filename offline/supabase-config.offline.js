// ============================================================
// Substituto OFFLINE do js/supabase-config.js.
// Copiado para js/supabase-config.js DENTRO do pacote offline pelo
// scripts/build_offline.mjs — o site online nunca carrega este arquivo.
//
// `url` aponta para a pasta _offline/ do próprio pacote: o código do site
// monta `${url}/storage/v1/object/authenticated/teachings/<arquivo>` e o
// servidor estático (python -m http.server) entrega o JSON direto do disco.
// ============================================================
import { supabase, OFFLINE_BASE } from './offline-client.js';

const SUPABASE_CONFIG = { url: OFFLINE_BASE, anonKey: 'offline' };

export { supabase };
export const SUPABASE_URL = SUPABASE_CONFIG.url;
export const SUPABASE_ANON_KEY = SUPABASE_CONFIG.anonKey;
export default SUPABASE_CONFIG;
