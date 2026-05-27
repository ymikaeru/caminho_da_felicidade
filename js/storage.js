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

// Hard limit por fetch. iOS 17 Safari (pré-17.4) tem bug conhecido de
// HTTP/2 stream reuse onde a 2ª req ao mesmo origin pode pendurar
// indefinidamente após a 1ª completar. Sem timeout, o reader fica preso
// na tela de splash (page-gate) e a busca fica em "Buscando..." pra
// sempre. AbortController converte o hang em throw, que o caller
// (reader.js _getOrFetchArticle catch, poetry pages catch) trata como
// erro normal — mostra "Erro ao carregar" em vez de tela travada.
const FETCH_TIMEOUT_MS = 8000;

async function _fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Fetch timeout após ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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
    const res = await _fetchWithTimeout(`${baseUrl}/${path}`);
    if (!res.ok) throw new Error('Authentication required or file not found');
    data = await res.json();
  } else {
    const storageUrl = `${SUPABASE_CONFIG.url}/storage/v1/object/authenticated/${BUCKET}/${path}`;
    // Antes usávamos `cache: 'no-store'` (opção do RequestInit). Em iOS 17
    // pré-17.4 isso é um gatilho documentado pro bug de HTTP/2 stream stuck
    // — Safari trata 'no-store' por um caminho de código mais sensível.
    // Substituímos pelo header `Cache-Control: no-cache` que tem semântica
    // equivalente (sempre revalida) sem disparar o bug.
    const res = await _fetchWithTimeout(storageUrl, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_CONFIG.anonKey,
        'Cache-Control': 'no-cache'
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
