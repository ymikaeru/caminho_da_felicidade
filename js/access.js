// ============================================================
// Access Control — Mioshie College
// Manages limited user access configuration
// Set by admin, applied for limited users.
// ============================================================

const ACCESS_KEY = 'mioshie_access_config';

function getAccessConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(ACCESS_KEY) || 'null');
    // Empty config {} = no restrictions configured → treat as null
    if (!c || Object.keys(c).length === 0) return null;
    return c;
  } catch (e) {
    return null;
  }
}

function isLimitedUser() {
  return localStorage.getItem('mioshie_auth') === 'limited';
}

function isAdminUser() {
  const auth = localStorage.getItem('mioshie_auth');
  return auth === 'admin' || auth === 'true'; // 'true' = legacy sessions
}

function isFullUser() {
  return localStorage.getItem('mioshie_auth') === 'full';
}

// Returns array of enabled volume keys ['mioshiec1', 'mioshiec2', ...]
function getEnabledVolumes(config) {
  if (!config) return ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'];
  // In blacklist mode, volume is disabled only if it is entirely blocked ('all')
  return ['mioshiec1', 'mioshiec2', 'mioshiec3', 'mioshiec4'].filter(v => config[v] !== 'all');
}

// Remove the page gate, revealing content — only if user is authenticated
function revealPage() {
  const auth = localStorage.getItem('mioshie_auth');
  if (!auth) return;
  const g = document.getElementById('page-gate');
  if (!g) return;
  g.style.transition = 'opacity 0.15s ease';
  g.style.opacity = '0';
  setTimeout(() => g.remove(), 150);
}

// Filter header and mobile nav links to disabled volumes — runs on any page
function _applyNavFilter(enabled) {
  document.querySelectorAll('.header__nav a').forEach(link => {
    const href = link.getAttribute('href') || '';
    const match = href.match(/mioshiec(\d)/);
    if (match && !enabled.includes('mioshiec' + match[1])) link.style.display = 'none';
  });

  const filterMobileNav = () => {
    document.querySelectorAll('.mobile-nav-body a').forEach(link => {
      const href = link.getAttribute('href') || '';
      const match = href.match(/mioshiec(\d)/);
      if (match && !enabled.includes('mioshiec' + match[1])) link.style.display = 'none';
    });
  };
  filterMobileNav();
  if (!document.querySelector('.mobile-nav-body')) {
    const observer = new MutationObserver(() => {
      filterMobileNav();
      if (document.querySelector('.mobile-nav-body')) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

// Smart home: filter volume cards or redirect if only 1 volume enabled
function initSmartHome() {
  if (!isLimitedUser()) return;
  const config = getAccessConfig();
  if (!config) { revealPage(); return; }

  const enabled = getEnabledVolumes(config);
  if (enabled.length === 0) { revealPage(); return; }

  if (enabled.length === 1) {
    // Only redirect if we're on the root index page, not inside a volume
    if (!window.location.pathname.includes('/mioshiec')) {
      const num = enabled[0].replace('mioshiec', '');
      window.location.replace('mioshiec' + num + '/index.html');
      return; // Redirecting — no reveal needed
    }
    revealPage();
    return;
  }

  // Hide volume cards not in enabled list
  document.querySelectorAll('a.topic-card').forEach(card => {
    const href = card.getAttribute('href') || '';
    const match = href.match(/mioshiec(\d)/);
    if (match) {
      const vol = 'mioshiec' + match[1];
      if (!enabled.includes(vol)) card.style.display = 'none';
    }
  });

  _applyNavFilter(enabled);
  revealPage();
}

// Filter theme cards in a volume index page
function initVolumeFilter(vol) {
  if (!isLimitedUser()) return;
  const config = getAccessConfig();
  if (!config) { revealPage(); return; }

  const volConfig = config[vol];

  // Volume not in config at all → NO restrictions for this volume!
  if (volConfig == null) {
    _applyNavFilter(getEnabledVolumes(config));
    revealPage();
    return;
  }

  // Always filter nav
  _applyNavFilter(getEnabledVolumes(config));

  // "all" → The whole volume is BLOCKED
  if (volConfig === 'all') { 
    window.location.replace('../index.html');
    return; 
  }

  // Reject unexpected config shapes — assume open
  if (!Array.isArray(volConfig)) {
    revealPage();
    return;
  }

  // Array of BLOCKED filenames
  {
    const blocked = new Set(volConfig);
    document.querySelectorAll('a.topic-card').forEach(card => {
      const href = card.getAttribute('href') || '';
      const match = href.match(/file=([^&]+)/);
      if (match) {
        const file = decodeURIComponent(match[1]);
        if (blocked.has(file)) card.style.display = 'none';
      }
    });
    hideEmptySections();

    // Remove hidden sections from the header <select> before toggle.js reads it
    // (toggle.js is deferred and runs after this DOMContentLoaded callback)
    const navSelect = document.querySelector('.header__nav select:not(#readerTopicSelect)');
    if (navSelect) {
      Array.from(navSelect.options).forEach(o => {
        if (!o.value) return;
        const sectionEl = document.getElementById(o.value.replace('#', ''));
        if (sectionEl && sectionEl.style.display === 'none') o.remove();
      });
    }
  }
  revealPage();
}

// Search is available for limited users — results are filtered in getSearchIndex()

// Hide all elements of sections that have no visible topic cards
// (group-spacers, hr separators, spacer divs etc. are also hidden)
function hideEmptySections() {
  const container = document.querySelector('.topic-list');
  if (!container) return;

  const sections = [];
  let current = null;

  for (const el of container.children) {
    if (el.classList.contains('section-header')) {
      current = { elements: [el], hasVisible: false };
      sections.push(current);
    } else if (current) {
      current.elements.push(el);
      if (el.tagName === 'A' && el.classList.contains('topic-card') && el.style.display !== 'none') {
        current.hasVisible = true;
      }
    }
  }

  sections.forEach(s => {
    if (!s.hasVisible) s.elements.forEach(el => { el.style.display = 'none'; });
  });
}
