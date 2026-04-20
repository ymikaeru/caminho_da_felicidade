// ============================================================
// Supabase Storage — Mioshie College
// Replaces direct fetch() calls with Supabase Storage downloads
// Uses the shared supabaseAuth session from login.js
// ============================================================
import SUPABASE_CONFIG, { supabase } from './supabase-config.js';
const BUCKET = 'teachings';

async function getSession() {
  // Try to get session from the shared auth instance first
  if (window.supabaseAuth && window.supabaseAuth.supabase) {
    const { data } = await window.supabaseAuth.supabase.auth.getSession();
    if (data?.session) return data.session;
  }
  // Fallback: check our own client
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
  const session = await getSession();

  if (!session) {
    const baseUrl = window.DATA_OUTPUT_DIR || 'site_data';
    const res = await fetch(`${baseUrl}/${path}`);
    if (!res.ok) {
      throw new Error('Authentication required or file not found');
    }
    return res.json();
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(path);

  if (error) {
    throw new Error(`Storage download failed: ${error.message}`);
  }

  return JSON.parse(await data.text());
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
