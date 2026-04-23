// ============================================================
// Supabase Auth Module — Mioshie College
// Handles login, logout, session management, and permission checks
// ============================================================
import SUPABASE_CONFIG, { supabase } from './supabase-config.js';

// ============================================================
// Auth state
// ============================================================
let currentUser = null;
let userPermissions = null;
let authReady = false;
const authListeners = [];

function notifyListeners() {
  authListeners.forEach(fn => fn(currentUser, userPermissions, authReady));
}

// ============================================================
// Session management
// ============================================================
async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    await loadPermissions(session.user.id);
  }
  authReady = true;
  notifyListeners();

  // Listen for auth changes
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      await loadPermissions(session.user.id);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      userPermissions = null;
    }
    authReady = true;
    notifyListeners();
  });
}

async function loadPermissions(userId) {
  const { data, error } = await supabase
    .from('user_permissions')
    .select('volume, files')
    .eq('user_id', userId);

  if (error) {
    console.error('Failed to load permissions:', error);
    userPermissions = null;
    return;
  }

  userPermissions = {};
  for (const perm of data) {
    userPermissions[perm.volume] = perm.files === null ? 'all' : perm.files;
  }
}

// ============================================================
// Login / Logout
// ============================================================
async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password
  });

  if (error) throw error;

  currentUser = data.user;
  await loadPermissions(data.user.id);
  authReady = true;
  notifyListeners();

  return data.user;
}

async function logout() {
  await supabase.auth.signOut();
  currentUser = null;
  userPermissions = null;
  authReady = true;
  notifyListeners();

  // Clear legacy localStorage keys
  localStorage.removeItem('mioshie_auth');
  localStorage.removeItem('mioshie_access_config');
  // Clear user-specific data to prevent leakage to next logged-in user.
  // Preserve highlightDeletedKeys/favDeletedKeys tombstones: they represent
  // deletions that may not have reached the cloud yet.
  localStorage.removeItem('userHighlights');
  localStorage.removeItem('readHistory');
  localStorage.removeItem('savedFavorites');
  localStorage.removeItem('mioshieSyncQueue');
}

async function signup(email, password, displayName, authCode) {
  if (authCode) {
    const { data: codeData, error: codeError } = await supabase
      .from('auth_codes')
      .select('id, used_by')
      .eq('code', authCode)
      .eq('active', true)
      .single();

    if (codeError || !codeData) {
      throw new Error('Código de autorização inválido ou expirado.');
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          display_name: displayName || email.split('@')[0],
          role: 'user'
        }
      }
    });

    if (error) throw error;

    await supabase
      .from('auth_codes')
      .update({ used_by: email.trim().toLowerCase(), used_at: new Date().toISOString(), active: false })
      .eq('id', codeData.id);

    return data.user;
  } else {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          display_name: displayName || email.split('@')[0],
          role: 'user'
        }
      }
    });

    if (error) throw error;
    return data.user;
  }
}

// ============================================================
// Password reset
// ============================================================
async function resetPassword(email) {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes('@')) {
    throw new Error('Por favor, insira um email válido.');
  }

  const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
    redirectTo: window.location.origin + '/mioshie_college_app/reset-password.html'
  });

  if (error) {
    if (error.message.includes('not allowed') || error.message.includes('not found')) {
      throw new Error('Email não encontrado. Verifique se digitou corretamente.');
    }
    throw error;
  }
}

// ============================================================
// Permission checks
// ============================================================
function isLoggedIn() {
  return currentUser !== null;
}

async function isAdmin() {
  if (!currentUser) return false;
  const { data } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single();
  return data?.role === 'admin';
}

function hasVolumeAccess(volume) {
  if (!currentUser) return false;
  if (!userPermissions) return true; // Empty blacklist = full access
  return userPermissions[volume] !== 'all'; // Disabled if completely blocked
}

function hasFileAccess(volume, file) {
  if (!currentUser) return false;
  if (!userPermissions) return true;
  const volPerm = userPermissions[volume];
  if (volPerm === undefined) return true; // Not in blacklist = full access
  if (volPerm === 'all') return false; // Completely blocked
  return Array.isArray(volPerm) && !volPerm.includes(file);
}

function getAccessConfig() {
  if (!currentUser || !userPermissions) return null;
  return userPermissions;
}

function getEnabledVolumes() {
  if (!userPermissions) return [];
  return Object.keys(userPermissions);
}

// ============================================================
// Access logging
// ============================================================
async function logAccess(volume, file, action = 'view') {
  if (!currentUser) return;
  await supabase.from('access_logs').insert({
    user_id: currentUser.id,
    volume,
    file,
    action
  });
}

// ============================================================
// Legacy compatibility — maps Supabase auth to old localStorage keys
// ============================================================
function syncToLegacy() {
  if (!currentUser) {
    localStorage.removeItem('mioshie_auth');
    return;
  }
  if (userPermissions && Object.keys(userPermissions).length > 0) {
    localStorage.setItem('mioshie_auth', 'limited');
    localStorage.setItem('mioshie_access_config', JSON.stringify(userPermissions));
  } else {
    localStorage.setItem('mioshie_auth', 'full');
  }
}

// ============================================================
// Exports
// ============================================================
export {
  supabase,
  initAuth,
  login,
  logout,
  signup,
  resetPassword,
  isLoggedIn,
  isAdmin,
  hasVolumeAccess,
  hasFileAccess,
  getAccessConfig,
  getEnabledVolumes,
  logAccess,
  syncToLegacy,
  onAuthChange
};

function onAuthChange(fn) {
  authListeners.push(fn);
  // Immediately call with current state if ready
  if (authReady) {
    fn(currentUser, userPermissions, authReady);
  }
}
