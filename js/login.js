// ============================================================
// Unified Authentication — Mioshie College (Supabase)
// Three levels:
//   'admin'   → admin role in Supabase user_profiles
//   'full'    → user exists but has no volume restrictions
//   'limited' → user has specific volume/file permissions
// ============================================================
import SUPABASE_CONFIG, { supabase } from './supabase-config.js';

// Detecta o tipo de dispositivo a partir do user-agent (+ touch points para
// pegar iPad/iPadOS 13+, que se anuncia como "Macintosh"). Sem chamadas
// externas, sem permissão. Resultado vai pro metadata de cada access_log.
function _detectDevice() {
  try {
    const ua = navigator.userAgent || '';
    const touch = navigator.maxTouchPoints || 0;
    // Tablet: iPad explícito, Android sem "Mobile", ou Mac com touch (iPadOS).
    if (/\bipad\b/i.test(ua) ||
        (/android/i.test(ua) && !/mobile/i.test(ua)) ||
        (/macintosh/i.test(ua) && touch > 1)) {
      return 'tablet';
    }
    if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini|windows phone/i.test(ua)) {
      return 'mobile';
    }
    return 'desktop';
  } catch (_) {
    return 'desconhecido';
  }
}

// Sistema operacional + versão a partir do user-agent. Windows NT 10.0 cobre
// tanto Win 10 quanto 11 (o UA não distingue) → "10/11". iOS/macOS usam "_"
// como separador de versão; normaliza pra ".".
function _detectOS(ua, touch) {
  if (/windows nt/i.test(ua)) {
    const v = (ua.match(/Windows NT ([\d.]+)/i) || [])[1] || '';
    const map = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7', '6.0': 'Vista', '5.1': 'XP' };
    return { os: 'Windows', os_version: map[v] || v };
  }
  if (/android/i.test(ua)) {
    return { os: 'Android', os_version: (ua.match(/Android ([\d.]+)/i) || [])[1] || '' };
  }
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && touch > 1)) {
    const v = (ua.match(/OS (\d+[_\d]*)/) || [])[1] || '';
    return { os: 'iOS', os_version: v.replace(/_/g, '.') };
  }
  if (/cros/i.test(ua)) return { os: 'ChromeOS', os_version: '' };
  if (/mac os x/i.test(ua)) {
    const v = (ua.match(/Mac OS X (\d+[_.\d]*)/) || [])[1] || '';
    return { os: 'macOS', os_version: v.replace(/_/g, '.') };
  }
  if (/linux/i.test(ua)) return { os: 'Linux', os_version: '' };
  return { os: '', os_version: '' };
}

// Navegador + versão. Ordem importa: Edge/Samsung/Opera embutem "Chrome" e
// "Safari" no UA, então precisam ser testados ANTES dos genéricos. CriOS/FxiOS
// são Chrome/Firefox no iOS (rodam sobre WebKit, mas mantêm a marca).
function _detectBrowser(ua) {
  let m;
  if (m = ua.match(/Edg(?:A|iOS)?\/([\d.]+)/)) return { browser: 'Edge', browser_version: m[1] };
  if (m = ua.match(/SamsungBrowser\/([\d.]+)/)) return { browser: 'Samsung Internet', browser_version: m[1] };
  if (m = ua.match(/OPR\/([\d.]+)/)) return { browser: 'Opera', browser_version: m[1] };
  if (m = ua.match(/CriOS\/([\d.]+)/)) return { browser: 'Chrome', browser_version: m[1] };
  if (m = ua.match(/FxiOS\/([\d.]+)/)) return { browser: 'Firefox', browser_version: m[1] };
  if (m = ua.match(/Firefox\/([\d.]+)/)) return { browser: 'Firefox', browser_version: m[1] };
  if (m = ua.match(/Chrome\/([\d.]+)/)) return { browser: 'Chrome', browser_version: m[1] };
  if (/Safari/i.test(ua) && (m = ua.match(/Version\/([\d.]+)/))) return { browser: 'Safari', browser_version: m[1] };
  return { browser: '', browser_version: '' };
}

// Coleta tudo: tipo + SO + navegador + modelo. Async porque o modelo do
// aparelho no Chrome com "User-Agent Reduction" some do UA (vira "K") e só
// volta via Client Hints de alta entropia (navigator.userAgentData). iOS NUNCA
// expõe o modelo (Apple oculta por privacidade) — fica vazio nesses casos.
async function _detectDeviceInfo() {
  try {
    const ua = navigator.userAgent || '';
    const touch = navigator.maxTouchPoints || 0;
    const info = {
      device: _detectDevice(),
      ..._detectOS(ua, touch),
      ..._detectBrowser(ua)
    };
    // Modelo (só Android): token após a versão do Android, antes de ")"/"Build".
    let model = '';
    const m = ua.match(/Android [\d.]+; ?([^;)]+?)(?: Build\/[^)]*)?\)/i);
    if (m) model = m[1].trim().replace(/\s+wv$/i, '');
    // UA reduzido anonimiza o modelo p/ "K" → tenta Client Hints de alta entropia.
    // Só no Android: desktop nunca tem modelo e iOS nunca expõe via CH, então
    // evita um hop async inútil antes da RPC em todo logAccess de desktop.
    if (/android/i.test(ua) && (!model || model === 'K') && navigator.userAgentData?.getHighEntropyValues) {
      try {
        const h = await navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion']);
        if (h.model) model = h.model;
        // platformVersion do CH é mais preciso que o UA p/ Windows/Android.
        if (h.platformVersion && !info.os_version) info.os_version = h.platformVersion;
      } catch (_) { /* CH indisponível: segue com o que tem */ }
    }
    if (model) info.model = model;
    return info;
  } catch (_) {
    return { device: 'desconhecido' };
  }
}

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
  try {
    await loadUserPermissions(session.user.id);
  } catch (e) {
    // Fail-closed: preserva o estado anterior em localStorage e retorna false
    // para que o fluxo caia no checkAuth() legado (usa o último estado
    // conhecido) em vez de rebaixar o usuário para 'full'.
    console.warn('[checkSupabaseAuth] Permissões não puderam ser carregadas — mantendo estado anterior.');
    return false;
  }

  // Same cross-user guard as login flow: if the browser still has data tagged
  // with a different user_id, wipe it before any sync happens.
  const storedUid = localStorage.getItem('mioshie_user_id');
  if (storedUid && storedUid !== session.user.id) {
    localStorage.removeItem('userHighlights');
    localStorage.removeItem('readHistory');
    localStorage.removeItem('savedFavorites');
    localStorage.removeItem('highlightDeletedKeys');
    localStorage.removeItem('favDeletedKeys');
    localStorage.removeItem('mioshieSyncQueue');
  }
  localStorage.setItem('mioshie_user_id', session.user.id);

  return true;
}

async function loadUserPermissions(userId) {
  const { data: profile, error: profileErr } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .single();

  // Fail-closed: se a leitura do perfil falhar, NÃO sobrescrevemos o estado
  // local. Isso evita que uma falha transitória (RLS, rede, token) rebaixe
  // um usuário 'limited' para 'full' silenciosamente.
  if (profileErr) {
    console.error('[loadUserPermissions] Falha ao carregar perfil:', profileErr);
    throw profileErr;
  }

  isAdminRole = profile?.role === 'admin';

  const { data: perms, error: permsErr } = await supabase
    .from('user_permissions')
    .select('volume, files')
    .eq('user_id', userId);

  if (permsErr) {
    console.error('[loadUserPermissions] Falha ao carregar permissões:', permsErr);
    throw permsErr;
  }

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
      <h2>Caminho da Felicidade</h2>
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

      // Prevent cross-user contamination: if localStorage holds data from a
      // different user (session crashed, shared device, expired token), wipe
      // it BEFORE syncing so we don't push foreign highlights to this cloud.
      const storedUid = localStorage.getItem('mioshie_user_id');
      if (storedUid && storedUid !== data.user.id) {
        localStorage.removeItem('userHighlights');
        localStorage.removeItem('readHistory');
        localStorage.removeItem('savedFavorites');
        localStorage.removeItem('readMarks');
        localStorage.removeItem('highlightDeletedKeys');
        localStorage.removeItem('favDeletedKeys');
        localStorage.removeItem('mioshieSyncQueue');
      }
      localStorage.setItem('mioshie_user_id', data.user.id);

      if (window._cloudSync) {
        try {
          await window._cloudSync.pullCloudToLocal();
          await window._cloudSync.syncLocalStorageToCloud();
          if (typeof renderFavorites === 'function') renderFavorites();
          if (typeof renderHistory === 'function') renderHistory();
          if (typeof window.updateFavIndicators === 'function') window.updateFavIndicators();
          if (typeof window.updateReadIndicators === 'function') window.updateReadIndicators();
        } catch (e) {
          console.warn('Cloud sync failed:', e);
          // Non-fatal: login proceeds with local data, but warn the user so
          // they know highlights/history may be stale until connectivity returns
          errorMsg.textContent = 'Logado, mas sincronização com a nuvem falhou. Seus destaques podem estar desatualizados.';
          errorMsg.style.color = '#c88a00';
          errorMsg.style.display = 'block';
          setTimeout(() => { errorMsg.style.display = 'none'; errorMsg.style.color = ''; }, 4000);
        }
      }

      overlay.remove();
      injectLogoutButton();
      startHeartbeat();
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
  localStorage.removeItem('mioshie_user_id');
  // Clear user-specific data to prevent leakage to next logged-in user.
  // Preserve highlightDeletedKeys/favDeletedKeys tombstones: they represent
  // deletions that may not have reached the cloud yet. Clearing them would
  // let pullCloudToLocal re-hydrate highlights the user already removed.
  localStorage.removeItem('userHighlights');
  localStorage.removeItem('readHistory');
  localStorage.removeItem('savedFavorites');
  localStorage.removeItem('mioshieSyncQueue');
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
      adminBtn.innerHTML = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg><span class="link-text">Admin</span>`;
      panel.appendChild(adminDivider);
      panel.appendChild(adminBtn);
    }

    const divider = document.createElement('div');
    divider.className = 'mobile-nav-divider';
    const btn = document.createElement('button');
    btn.id = 'logout-mobile-btn';
    btn.className = 'mobile-nav-link';
    // Bilíngue: lang-pt/lang-ja deixam o setLanguage alternar o idioma; o
    // display inicial cobre o estado no momento da injeção (que ocorre após
    // o boot do idioma, então o botão não passa pela 1ª varredura).
    const _lang = localStorage.getItem('site_lang') || 'pt';
    btn.innerHTML = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span class="link-text"><span class="lang-pt"${_lang === 'ja' ? ' style="display:none"' : ''}>Sair</span><span class="lang-ja"${_lang === 'ja' ? '' : ' style="display:none"'}>ログアウト</span></span>`;
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
  logAccess: async (volume, file, action = 'view', metadata = null) => {
    if (!supabaseSession) return;
    // Server-side dedupe via RPC: pula o INSERT se já existe um log com
    // mesmo (user, volume, file, action) nos últimos 60s. A RPC sempre
    // atualiza last_seen_at independente do dedupe. Sobrevive a refresh
    // de página e abas separadas (in-memory dedupe não cobre).
    // metadata: só inclui no payload quando não-nulo. PostgREST resolve o
    // overload da RPC pelo número de args nomeados — 3 args usa a versão
    // antiga (sem metadata), 4 args exige a versão nova (CREATE OR REPLACE
    // FUNCTION log_access_dedup(text, text, text, jsonb)). Assim deploy
    // do cliente NÃO depende da RPC nova estar aplicada (view/print
    // continuam funcionando) — só copies precisam da RPC atualizada.
    // Sempre anexa o device ao metadata (a RPC de 4 args com p_metadata jsonb
    // já está deployada e persiste isto em access_logs.metadata). Preserva
    // qualquer metadata existente (ex.: texto copiado em content-protection).
    const meta = (metadata != null) ? { ...metadata } : {};
    // Anexa device (string, p/ compat) + os/os_version/browser/browser_version/
    // model. Campos novos a partir de 06/06/2026; logs anteriores só têm device.
    Object.assign(meta, await _detectDeviceInfo());
    const params = { p_volume: volume, p_file: file, p_action: action, p_metadata: meta };
    const { error } = await supabase.rpc('log_access_dedup', params);
    if (error) console.warn('[logAccess] Falha ao registrar acesso:', error.message);
  }
};

// ============================================================
// Presence heartbeat — keeps user_profiles.last_seen_at fresh
// ============================================================
let _heartbeatInterval = null;

async function updateLastSeen() {
  if (!supabaseSession) return;
  const { error } = await supabase.from('user_profiles').update({
    last_seen_at: new Date().toISOString()
  }).eq('id', supabaseSession.user.id);
  if (error) console.warn('[heartbeat] Falha ao atualizar presença:', error.message, '— verifique a RLS policy de UPDATE em user_profiles');
}

function startHeartbeat() {
  if (_heartbeatInterval) return;
  updateLastSeen();
  _heartbeatInterval = setInterval(updateLastSeen, 5 * 60 * 1000); // every 5 minutes
}

function stopHeartbeat() {
  if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
}

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
      startHeartbeat();
      if (authenticated && window._cloudSync) {
        try {
          await window._cloudSync.pullCloudToLocal();
          window._cloudSync.syncLocalStorageToCloud();
          if (typeof renderFavorites === 'function') renderFavorites();
          if (typeof renderHistory === 'function') renderHistory();
          if (typeof window.updateFavIndicators === 'function') window.updateFavIndicators();
          if (typeof window.updateReadIndicators === 'function') window.updateReadIndicators();
        } catch (e) { console.warn('Cloud sync failed:', e); }
      }
      if (typeof revealPage === 'function') revealPage();
    }
  };

  // Update last_seen when page becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && supabaseSession) updateLastSeen();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
