import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';
import Chart from 'chart.js/auto';
// Defaults do Chart.js a partir do tema atual (modo noturno do admin)
import './admin/chart-theme.js?v=2';
// Estado compartilhado entre admin.js e abas extraídas
import {
  allUsers, setAllUsers,
  _adminIds, setAdminIds,
  selectedUserId, setSelectedUserId,
  volumeCategories,
  _myUid, setMyUid
} from './admin/shared/state.js';
import { _loadAdminIds, _escHtml, logAdminAction } from './admin/shared/helpers.js';
// Abas extraídas — registram suas funções em window.*
import './admin/tabs/admin-logs.js?v=2';
import './admin/tabs/calendar.js?v=8';
import './admin/tabs/announcements.js?v=7';
import './admin/tabs/access-info.js?v=2';
import './admin/tabs/find-replace.js';
import './admin/tabs/duplicates.js';
import './admin/tabs/analytics-search.js?v=2';
import './admin/tabs/analytics-disciples.js?v=2';
import './admin/tabs/analytics-poetry.js?v=2';
import './admin/tabs/analytics-johrei.js?v=12';
import './admin/tabs/analytics-landing.js?v=2';
import './admin/tabs/analytics-audio.js?v=8';
import './admin/tabs/highlights-saved.js?v=4';
import './admin/tabs/users-permissions.js?v=7';
import './admin/tabs/analytics.js?v=27';
import './admin/tabs/translation-review.js?v=9';
import './admin/tabs/translation-review-guia.js';
import './admin/tabs/disciples-reports.js?v=2';
import './admin/tabs/partial-citations.js?v=24';
import './admin/tabs/recommendations.js?v=17';
import './admin/tabs/inbox.js?v=3';
import './admin/tabs/poetry-versions.js?v=3';
import './admin/tabs/alignment.js?v=19';

// Expõe o client no window pra scripts não-módulo (ex.: reader-recommend.js,
// o modal do aviãozinho reusado em "Repassar a todos" na Caixa de Entrada).
window.supabase = supabase;

const VOLUMES = [
  { key: 'mioshiec1', name: 'Volume 1 — Mundo Espiritual' },
  { key: 'mioshiec2', name: 'Volume 2 — Método Divino de Saúde' },
  { key: 'mioshiec3', name: 'Volume 3 — A Verdadeira Fé' },
  { key: 'mioshiec4', name: 'Volume 4 — Ensinamentos Complementares' }
];

const VOL_SHORT = {
  mioshiec1: 'V1', mioshiec2: 'V2', mioshiec3: 'V3', mioshiec4: 'V4',
  shumeic1: 'V1', shumeic2: 'V2', shumeic3: 'V3', shumeic4: 'V4',
  disciples: 'Disc',
  poetry: 'Poesia'
};

// allUsers, _adminIds, selectedUserId, volumeCategories vêm do shared/state.js (imports acima).
// _loadAdminIds, _escHtml, logAdminAction vêm do shared/helpers.js (imports acima).
// _myUid vem do shared/state.js (importado acima); usado por checkAdmin
// e pelo módulo translation-review (reports + editor).
let _onlineRefreshInterval = null;

// Admin Logs Tab: extraído para ./admin/tabs/admin-logs.js
// (importado no topo deste arquivo)

// ── Catálogo de títulos (livros de discípulos, poesia, especiais) ──
// Usado por Reports/Editor (ainda neste arquivo) e exposto via shared/constants.js
// para os módulos extraídos. Manter aqui evita import cíclico durante a transição.
const DISCIPLES_BOOK_TITLES = {
  keigyou: 'Keigyou',
  'ashita-no-ijitsu-wo-ikiru': 'Ashita No Ijitsu Wo Ikiru'
};

const POETRY_BOOK_TITLES = {
  'akimaro-kineishu': "明麿近詠集 — Akemaro Kin'eishū",
  'yama-to-mizu': '山と水 — Yama to Mizu',
  'warai-no-izumi': '笑の泉 — Warai no Izumi'
};

// Arquivos especiais (prefácios etc.) que não estão em section_map.js
const SPECIAL_FILE_TITLES = {
  'mioshiec1/zyobun.html': 'Prefácio — O Objetivo da Fundação da Igreja'
};

function getFileTitle(volume, file) {
  if (volume === 'disciples') return DISCIPLES_BOOK_TITLES[file] || file;
  if (volume === 'poetry') return POETRY_BOOK_TITLES[file] || file;
  const special = SPECIAL_FILE_TITLES[`${volume}/${file}`];
  if (special) return special;
  const cats = volumeCategories?.[volume];
  if (cats) {
    for (const arr of Object.values(cats)) {
      const hit = arr.find(x => x.file === file);
      if (hit?.title) return hit.title;
    }
  }
  return file.replace(/\.html\.json$/, '').replace(/\.json$/, '').replace(/\.html$/, '');
}

// Destaques + Salvos + openHlReader: extraído para ./admin/tabs/highlights-saved.js
// (importado no topo deste arquivo)

window.switchAdminSection = function (section) {
  document.querySelectorAll('.admin-nav-section[data-section]').forEach(g => {
    g.style.display = g.dataset.section === section ? '' : 'none';
  });
  try { localStorage.setItem('admin_section', section); } catch (e) { }
  const firstTab = { 'landing': 'calendar', 'caminho': 'users', 'johrei': 'analytics-johrei' }[section];
  // keepDrawerOpen=true: trocar de setor NÃO fecha a gaveta no mobile — o
  // usuário continua no menu até escolher de fato uma seção (aba).
  if (firstTab && window.switchTab) window.switchTab(firstTab, true);
};

(function _restoreAdminSection() {
  try {
    const saved = localStorage.getItem('admin_section') || 'caminho';
    const sel = document.getElementById('adminSectionSel');
    if (sel) sel.value = saved;
    // Defer so switchTab is already defined when this runs
    setTimeout(() => window.switchAdminSection(saved), 0);
  } catch (e) { setTimeout(() => window.switchAdminSection('caminho'), 0); }
})();

// Menu lateral: sempre visível no desktop; vira gaveta no mobile.
window.openAdminDrawer = function () {
  const sb = document.getElementById('adminSidebar');
  const sc = document.getElementById('adminScrim');
  if (sb) sb.classList.add('is-open');
  if (sc) sc.classList.add('show');
};
window.closeAdminDrawer = function () {
  const sb = document.getElementById('adminSidebar');
  const sc = document.getElementById('adminScrim');
  if (sb) sb.classList.remove('is-open');
  if (sc) sc.classList.remove('show');
};
(function _wireAdminDrawer() {
  const h = document.getElementById('adminHamburger');
  const sc = document.getElementById('adminScrim');
  if (h) h.addEventListener('click', window.openAdminDrawer);
  if (sc) sc.addEventListener('click', window.closeAdminDrawer);
})();

// A11y do menu lateral: os itens eram <div onclick> só-mouse (sem role,
// sem tabindex, sem teclado). Aqui viram focáveis e operáveis por teclado
// (Enter/Espaço ativam), com role=button e marcação do ativo via
// aria-current. Os itens são estáticos no HTML, e admin.js é módulo
// (deferido), então a DOM já existe quando isto roda. (WCAG 2.1.1/4.1.2)
(function initNavA11y() {
  const items = document.querySelectorAll('.admin-nav-item');
  items.forEach(el => {
    el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (el.classList.contains('active')) el.setAttribute('aria-current', 'page');
  });
  const nav = document.querySelector('.admin-nav');
  if (nav) nav.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const item = e.target.closest('.admin-nav-item');
    if (!item) return;
    e.preventDefault();
    item.click();
  });
})();

window.switchTab = function (tab, keepDrawerOpen, force) {
  document.querySelectorAll('.admin-nav-item').forEach(t => { t.classList.remove('active'); t.removeAttribute('aria-current'); });
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  // Acha a aba ativa pelo data-tab (antes era um índice posicional frágil).
  const navItem = document.querySelector('.admin-nav-item[data-tab="' + tab + '"]');
  if (navItem) { navItem.classList.add('active'); navItem.setAttribute('aria-current', 'page'); }
  const pane = document.getElementById('tab-' + tab);
  if (pane) pane.classList.add('active');
  // Só fecha a gaveta quando o usuário escolhe uma aba de verdade (não ao
  // trocar de setor, que passa keepDrawerOpen=true).
  if (!keepDrawerOpen && window.closeAdminDrawer) window.closeAdminDrawer();
  if (tab === 'analytics') {
    loadAnalytics(force);
    if (_onlineRefreshInterval) clearInterval(_onlineRefreshInterval);
    _onlineRefreshInterval = setInterval(loadOnlineUsers, 60000);
  } else {
    if (_onlineRefreshInterval) { clearInterval(_onlineRefreshInterval); _onlineRefreshInterval = null; }
  }
  if (tab === 'reports') loadReports();
  if (tab === 'reports-omitted') loadOmitidos();
  if (tab === 'reports-disc') loadDisciplesReports();
  if (tab === 'destaques') initHlTab();
  if (tab === 'saved') initSavedTab();
  if (tab === 'calendar') loadCalendarEvents();
  if (tab === 'announcements') loadAnnouncements();
  if (tab === 'access') loadAccessInfo();
  if (tab === 'logs') loadAdminLogs();
  if (tab === 'duplicates') loadDuplicates();
  if (tab === 'recommendations') loadRecommendationsTab();
  if (tab === 'recommend-audio') loadRecommendAudioTab();
  if (tab === 'inbox') loadInboxTab();
  if (tab === 'poetry-versions') loadPoetryVersions();
  if (tab === 'partial-citations') loadPartialCitations();
  if (tab === 'alignment') loadAlignment();
  if (tab === 'analytics-johrei') loadJohreiAnalytics();
  if (tab === 'reports-guia') loadGuiaReports();
  if (tab === 'analytics-landing') loadLandingAnalytics();
  if (tab === 'analytics-disciples') loadDisciplesAnalytics();
  if (tab === 'analytics-poetry') loadPoetryAnalytics();
  if (tab === 'analytics-search') loadSearchAnalytics();
  if (tab === 'audio') loadAudioAnalytics();
};

// Botão "Atualizar" da save-bar (canto inferior direito): recarrega os dados
// da ABA ATIVA. Antes era hardcoded `loadUsers()`, então só fazia algo na aba
// Usuários — nas demais (analytics, johrei, etc.) parecia "não funcionar".
// Reusa o dispatch do switchTab pra recarregar a aba atual; a aba "users" é
// carregada fora do switchTab (no bootstrap), então tratamos o caso à parte.
window.refreshActiveTab = function () {
  const active =
    document.querySelector('.admin-nav-item.active')?.dataset.tab ||
    document.querySelector('.tab-content.active')?.id?.replace(/^tab-/, '');
  if (!active || active === 'users') { if (window.loadUsers) window.loadUsers(); return; }
  if (window.switchTab) window.switchTab(active, true, true);
  else if (window.loadUsers) window.loadUsers();
};

// Calendar Events: extraído para ./admin/tabs/calendar.js
// (importado no topo deste arquivo)

// Announcements: extraído para ./admin/tabs/announcements.js
// (importado no topo deste arquivo)

// Access Info: extraído para ./admin/tabs/access-info.js
// (importado no topo deste arquivo)

// Reports + Editor (Translation Review): extraído para ./admin/tabs/translation-review.js
// (importado no topo deste arquivo)
async function checkAdmin() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  setMyUid(session.user.id);

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();

  if (profile?.role !== 'admin') {
    alert('Acesso restrito a administradores.');
    window.location.href = 'index.html';
    return;
  }

  const unlocked = await runAdminPinGate();
  if (!unlocked) return; // gate fechou a sessão / redirecionou

  document.body.classList.remove('admin-locked');

  // Badge da Caixa de Entrada já no boot (sem precisar abrir a aba) e
  // re-checado a cada 5 min enquanto a página fica aberta (head-count barato).
  if (window.refreshInboxBadge) {
    window.refreshInboxBadge();
    setInterval(window.refreshInboxBadge, 5 * 60 * 1000);
  }

  window.loadUsers();
  const ok = await window.loadVolumeFiles();
  if (!ok) {
    const volumesDiv = document.getElementById('default-perm-volumes');
    if (volumesDiv) {
      volumesDiv.innerHTML = `<div class="msg err" style="display:block;">⚠ Falha ao carregar lista de volumes. Verifique sua conexão e <a href="#" onclick="location.reload(); return false;" style="color:inherit; text-decoration:underline;">recarregue a página</a>.</div>`;
    }
  } else {
    window.renderDefaultPermVolumes();
  }
}

// ── Admin PIN gate ─────────────────────────────────────────────
// Camada extra ao entrar no painel. PIN fica como hash bcrypt no Supabase
// (RPCs has_admin_pin / set_admin_pin / verify_admin_pin). O PIN é pedido
// a cada carregamento da página — não há cache de sessão.
async function runAdminPinGate() {
  const { data: hasPin, error: hasErr } = await supabase.rpc('has_admin_pin');
  if (hasErr) {
    console.warn('[adminPinGate] has_admin_pin falhou:', hasErr);
    alert('Não foi possível validar o gate de administrador. Tente novamente.');
    return false;
  }

  // has_admin_pin retorna NULL quando o admin NÃO está na allowlist de
  // administradores autorizados (admin_pin_allowlist.sql). Nesse caso barramos
  // o acesso em vez de oferecer a tela de definição de PIN.
  if (hasPin === null) {
    alert('Este usuário não está autorizado a acessar o painel administrativo.');
    await supabase.auth.signOut().catch(() => { });
    window.location.href = 'index.html';
    return false;
  }

  const isFirstTime = !hasPin;
  const modal = document.getElementById('adminPinModal');
  const input = document.getElementById('adminPinInput');
  const desc = document.getElementById('adminPinDesc');
  const title = document.getElementById('adminPinTitle');
  const msg = document.getElementById('adminPinMsg');
  const submit = document.getElementById('adminPinSubmit');
  const cancel = document.getElementById('adminPinCancel');

  title.textContent = isFirstTime ? 'Definir PIN de Administrador' : 'Acesso Administrativo';
  desc.textContent = isFirstTime
    ? 'Crie um PIN numérico (4 a 12 dígitos) que será exigido sempre que você entrar no painel.'
    : 'Digite seu PIN para continuar.';
  input.value = '';
  msg.textContent = '';
  msg.className = 'admin-pin-msg';
  modal.classList.add('open');
  setTimeout(() => input.focus(), 50);

  return new Promise((resolve) => {
    const setBusy = (b) => { submit.disabled = b; cancel.disabled = b; input.disabled = b; };

    const tryValidate = async () => {
      const pin = (input.value || '').trim();
      msg.className = 'admin-pin-msg';
      if (!/^[0-9]{4,12}$/.test(pin)) {
        msg.textContent = 'PIN deve ter de 4 a 12 dígitos numéricos.';
        msg.classList.add('err');
        return;
      }
      setBusy(true);
      try {
        if (isFirstTime) {
          const { error } = await supabase.rpc('set_admin_pin', { new_pin: pin });
          if (error) throw error;
          msg.textContent = 'PIN definido. Liberando painel…';
          msg.classList.add('ok');
          setTimeout(() => { modal.classList.remove('open'); resolve(true); }, 600);
        } else {
          const { data: ok, error } = await supabase.rpc('verify_admin_pin', { pin });
          if (error) throw error;
          if (!ok) {
            msg.textContent = 'PIN incorreto.';
            msg.classList.add('err');
            input.value = '';
            input.focus();
            setBusy(false);
            return;
          }
          modal.classList.remove('open');
          resolve(true);
        }
      } catch (err) {
        console.error('[adminPinGate] erro:', err);
        // Admin fora da allowlist tentando definir/verificar PIN: barra e desloga.
        if (String(err?.message || err).includes('admin_not_authorized')) {
          msg.textContent = 'Usuário não autorizado a acessar o painel.';
          msg.classList.add('err');
          setTimeout(onCancel, 1200);
          return;
        }
        msg.textContent = 'Falha: ' + (err.message || err);
        msg.classList.add('err');
        setBusy(false);
      }
    };

    const onCancel = async () => {
      await supabase.auth.signOut().catch(() => { });
      window.location.href = 'login.html';
      resolve(false);
    };

    submit.onclick = tryValidate;
    cancel.onclick = onCancel;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); tryValidate(); } };
  });
}
window.runAdminPinGate = runAdminPinGate;

// Sair do painel sempre desloga (evita esquecer o logout aberto).
window.adminLeave = async function adminLeave(ev, dest) {
  if (ev && ev.preventDefault) ev.preventDefault();
  try { await supabase.auth.signOut(); } catch (_) { }
  window.location.href = dest || 'index.html';
};

// Auto-saída do painel admin por inatividade (10 minutos sem mexer).
// NÃO faz signOut — só redireciona para fora do admin. A sessão da conta
// continua válida; voltar ao painel exige o PIN novamente (gate em cada load).
(function setupAdminIdleLogout() {
  const IDLE_MS = 10 * 60 * 1000;
  const WARN_MS = 30 * 1000; // pinta de vermelho nos últimos 30s
  let endsAt = Date.now() + IDLE_MS;
  let tickHandle = null;

  const badge = document.createElement('div');
  badge.className = 'admin-idle-timer';
  badge.title = 'Sai do painel automaticamente por inatividade';
  document.body.appendChild(badge);

  const doLeave = () => {
    if (tickHandle) clearInterval(tickHandle);
    window.location.href = 'index.html';
  };

  const tick = () => {
    const left = endsAt - Date.now();
    if (left <= 0) { doLeave(); return; }
    const s = Math.ceil(left / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    badge.textContent = `⏱ ${mm}:${ss}`;
    badge.classList.toggle('warn', left <= WARN_MS);
  };

  const reset = () => { endsAt = Date.now() + IDLE_MS; tick(); };

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach((evt) => {
    window.addEventListener(evt, reset, { passive: true });
  });

  tick();
  tickHandle = setInterval(tick, 1000);
})();

// Trocar PIN a partir do painel (chamado pela UI da aba Usuários).
window.changeAdminPin = async function changeAdminPin() {
  const cur = prompt('PIN atual (deixe em branco se ainda não definiu):') || '';
  if (cur) {
    const { data: ok, error } = await supabase.rpc('verify_admin_pin', { pin: cur });
    if (error) { alert('Erro: ' + error.message); return; }
    if (!ok) { alert('PIN atual incorreto.'); return; }
  }
  const nv = prompt('Novo PIN (4 a 12 dígitos):') || '';
  if (!/^[0-9]{4,12}$/.test(nv)) { alert('PIN inválido (4 a 12 dígitos numéricos).'); return; }
  const { error } = await supabase.rpc('set_admin_pin', { new_pin: nv });
  if (error) { alert('Erro: ' + error.message); return; }
  alert('PIN atualizado.');
};

// Users + Permissions + Volume files: extraído para ./admin/tabs/users-permissions.js
// (importado no topo deste arquivo)
// Analytics central: extraído para ./admin/tabs/analytics.js
// (importado no topo deste arquivo)


// Find & Replace: extraído para ./admin/tabs/find-replace.js
// (importado no topo deste arquivo)

// Disciples Analytics: extraído para ./admin/tabs/analytics-disciples.js
// (importado no topo deste arquivo)

// Poetry Analytics: extraído para ./admin/tabs/analytics-poetry.js
// (importado no topo deste arquivo)

// Johrei Analytics: extraído para ./admin/tabs/analytics-johrei.js
// (importado no topo deste arquivo)

// Landing Analytics: extraído para ./admin/tabs/analytics-landing.js
// (importado no topo deste arquivo)


// Duplicates Tab: extraído para ./admin/tabs/duplicates.js
// (importado no topo deste arquivo)

// Recommendations Tab: extraído para ./admin/tabs/recommendations.js
// (importado no topo deste arquivo)

// Expõe getFileTitle pra módulos que precisam dele via window lookup
// (a função local ainda vive aqui porque é usada pelo bootstrap
// imediato). loadVolumeFiles e _wrapAllMatchesInElement são registrados
// pelos respectivos módulos extraídos (users-permissions / translation-review).
Object.assign(window, {
  getFileTitle
});

checkAdmin();
