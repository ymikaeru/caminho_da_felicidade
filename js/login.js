// ============================================================
// Unified Authentication — Mioshie College (Supabase)
// Three levels:
//   'admin'   → admin role in Supabase user_profiles
//   'full'    → user exists but has no volume restrictions
//   'limited' → user has specific volume/file permissions
// ============================================================
import SUPABASE_CONFIG, { supabase } from './supabase-config.js';

let supabaseSession = null;
let userPermissions = null;
let isAdminRole = false;

// ============================================================
// Session check
// ============================================================
async function checkSupabaseAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  supabaseSession = session;
  await loadUserPermissions(session.user.id);
  return true;
}

async function loadUserPermissions(userId) {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .single();

  isAdminRole = profile?.role === 'admin';

  const { data: perms } = await supabase
    .from('user_permissions')
    .select('volume, files')
    .eq('user_id', userId);

  if (perms && perms.length > 0) {
    userPermissions = {};
    for (const p of perms) {
      userPermissions[p.volume] = p.files === null ? 'all' : p.files;
    }
    localStorage.setItem('mioshie_auth', 'limited');
    localStorage.setItem('mioshie_access_config', JSON.stringify(userPermissions));
  } else {
    userPermissions = null;
    localStorage.setItem('mioshie_auth', isAdminRole ? 'admin' : 'full');
    localStorage.removeItem('mioshie_access_config');
  }
}

// ============================================================
// Legacy compatibility — check if already authenticated
// ============================================================
function checkAuth() {
  const auth = localStorage.getItem('mioshie_auth');
  return auth === 'admin' || auth === 'full' || auth === 'limited' || auth === 'true';
}

// ============================================================
// Login overlay
// ============================================================
function showLoginOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.style.zIndex = '5000';
  overlay.innerHTML = `
    <div class="login-card">
      <h2>Mioshie College</h2>
      <p style="color: var(--text-muted); margin-bottom: 24px;">Insira suas credenciais para acessar</p>
      <input type="email" id="login-email" class="login-input" placeholder="Email" autocomplete="email" style="margin-bottom:12px;">
      <input type="password" id="login-pass" class="login-input" placeholder="Senha" autocomplete="current-password">
      <button id="login-submit" class="login-button">Entrar</button>
      <p id="login-error" style="color: #ff3b30; margin-top: 16px; font-size: 0.9rem; display: none;"></p>
      <div style="margin-top:16px; text-align:center; font-size:0.85rem;">
        <a href="reset-password.html" style="color:var(--accent); text-decoration:none;">Esqueci minha senha</a>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const emailInput = document.getElementById('login-email');
  const passInput = document.getElementById('login-pass');
  const submitBtn = document.getElementById('login-submit');
  const errorMsg = document.getElementById('login-error');

  const attempt = async () => {
    if (submitBtn.disabled) return;
    const email = emailInput.value.trim().toLowerCase();
    const password = passInput.value;
    if (!email || !password) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando...';
    errorMsg.style.display = 'none';

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      supabaseSession = data.session;
      await loadUserPermissions(data.user.id);

      if (window._cloudSync) {
        try {
          await window._cloudSync.pullCloudToLocal();
          await window._cloudSync.syncLocalStorageToCloud();
          if (typeof renderFavorites === 'function') renderFavorites();
          if (typeof renderHistory === 'function') renderHistory();
        } catch (e) { console.warn('Cloud sync failed:', e); }
      }

      overlay.remove();
      injectLogoutButton();
      if (typeof revealPage === 'function') revealPage();

      // Apply access filters for the current page
      const volMatch = window.location.pathname.match(/mioshiec(\d)/);
      if (volMatch && typeof initVolumeFilter === 'function') {
        initVolumeFilter('mioshiec' + volMatch[1]);
      } else if (typeof initSmartHome === 'function') {
        initSmartHome();
      } else if (typeof revealPage === 'function') {
        revealPage();
      }
    } catch (err) {
      errorMsg.textContent = err.message === 'Invalid login credentials'
        ? 'Email ou senha incorretos'
        : 'Erro ao fazer login. Tente novamente.';
      errorMsg.style.display = 'block';
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Entrar';
  };

  submitBtn.onclick = attempt;
  passInput.onkeypress = (e) => { if (e.key === 'Enter') attempt(); };
  emailInput.onkeypress = (e) => { if (e.key === 'Enter') passInput.focus(); };
  emailInput.focus();
}

// ============================================================
// Logout
// ============================================================
async function logout() {
  await supabase.auth.signOut();
  supabaseSession = null;
  userPermissions = null;
  isAdminRole = false;
  localStorage.removeItem('mioshie_auth');
  localStorage.removeItem('mioshie_access_config');
  window.location.reload();
}

// ============================================================
// Logout button injection
// ============================================================
function injectLogoutButton() {
  const injectMobile = () => {
    if (document.getElementById('logout-mobile-btn')) return;
    const panel = document.querySelector('.mobile-nav-body');
    if (!panel) return;

    if (isAdminUser() && !window.location.pathname.includes('admin.html')) {
      const adminDivider = document.createElement('div');
      adminDivider.className = 'mobile-nav-divider';
      const adminBtn = document.createElement('a');
      adminBtn.id = 'admin-mobile-btn';
      adminBtn.className = 'mobile-nav-link';
      adminBtn.href = (window.location.pathname.includes('/mioshiec') ? '../' : '') + 'admin-supabase.html';
      adminBtn.innerHTML = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/><polyline points="16 11 18 13 22 9"/></svg><span class="link-text">Admin</span>`;
      panel.appendChild(adminDivider);
      panel.appendChild(adminBtn);
    }

    const divider = document.createElement('div');
    divider.className = 'mobile-nav-divider';
    const btn = document.createElement('button');
    btn.id = 'logout-mobile-btn';
    btn.className = 'mobile-nav-link';
    btn.innerHTML = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span class="link-text">Sair</span>`;
    btn.onclick = logout;
    panel.appendChild(divider);
    panel.appendChild(btn);
  };

  injectMobile();
  if (!document.getElementById('logout-mobile-btn')) {
    const observer = new MutationObserver(() => {
      injectMobile();
      if (document.getElementById('logout-mobile-btn')) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

// ============================================================
// Exports for use by other modules
// ============================================================
window.supabaseAuth = {
  supabase,
  checkAuth,
  checkSupabaseAuth,
  logout,
  isAdmin: () => isAdminRole,
  hasVolumeAccess: (vol) => userPermissions?.[vol] !== undefined,
  hasFileAccess: (vol, file) => {
    const perm = userPermissions?.[vol];
    if (perm === undefined) return false;
    if (perm === 'all') return true;
    return Array.isArray(perm) && perm.includes(file);
  },
  getPermissions: () => userPermissions,
  logAccess: async (volume, file, action = 'view') => {
    if (!supabaseSession) return;
    await supabase.from('access_logs').insert({
      user_id: supabaseSession.user.id,
      volume,
      file,
      action
    });
  }
};

// ============================================================
// Auto-run on page load
// ============================================================
(function () {
  const init = async () => {
    const authenticated = await checkSupabaseAuth();
    if (!authenticated && !checkAuth()) {
      showLoginOverlay();
    } else if (authenticated || checkAuth()) {
      injectLogoutButton();
      if (authenticated && window._cloudSync) {
        try {
          await window._cloudSync.pullCloudToLocal();
          window._cloudSync.syncLocalStorageToCloud();
          if (typeof renderFavorites === 'function') renderFavorites();
          if (typeof renderHistory === 'function') renderHistory();
        } catch (e) { console.warn('Cloud sync failed:', e); }
      }
      if (typeof revealPage === 'function') revealPage();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
