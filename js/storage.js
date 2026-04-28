// ============================================================
// Supabase Storage — Mioshie College
// Replaces direct fetch() calls with Supabase Storage downloads
// Uses the shared supabaseAuth session from login.js
// ============================================================
import SUPABASE_CONFIG, { supabase } from './supabase-config.js';
const BUCKET = 'teachings';

// In-memory cache: evita re-download do mesmo arquivo na mesma sessão.
// TTL de 30 min — conteúdo dos ensinamentos raramente muda.
const _cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

async function getSession() {
  // Usa apenas o singleton compartilhado de supabase-config.js
  // (window.supabaseAuth era um padrão legado que criava um segundo cliente)
  const { data } = await supabase.auth.getSession();
  return data?.session;
}

/**
 * Download a file from Supabase Storage.
 * Falls back to fetch() if the user is not authenticated (for public content).
 *
 * @param {string} path - Storage path, e.g. 'mioshiec1/zyobun.html.json'
 * @returns {Promise<object>} Parsed JSON
 */
export async function storageFetch(path) {
  const hit = _cache.get(path);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  const session = await getSession();

  let data;
  if (!session) {
    const baseUrl = window.DATA_OUTPUT_DIR || 'site_data';
    const res = await fetch(`${baseUrl}/${path}`);
    if (!res.ok) throw new Error('Authentication required or file not found');
    data = await res.json();
  } else {
    const storageUrl = `${SUPABASE_CONFIG.url}/storage/v1/object/authenticated/${BUCKET}/${path}`;
    const res = await fetch(storageUrl, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_CONFIG.anonKey
      }
    });
    if (!res.ok) throw new Error(`Storage download failed: ${res.status}`);
    data = await res.json();
  }

  _cache.set(path, { data, ts: Date.now() });
  return data;
}

/**
 * List files in a storage folder.
 *
 * @param {string} prefix - e.g. 'mioshiec1/'
 * @returns {Promise<string[]>} Array of filenames
 */
export async function storageList(prefix) {
  const session = await getSession();

  if (!session) {
    return [];
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(prefix);

  if (error) {
    console.warn('Storage list failed:', error.message);
    return [];
  }

  return data ? data.map(f => f.name) : [];
}
