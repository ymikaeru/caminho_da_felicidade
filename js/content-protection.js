// ============================================================
// CONTENT PROTECTION — Mioshie College
// - Bloqueia copy/cut/contextmenu/dragstart dentro de .topic-content
// - Seleção continua permitida (necessária pros destaques)
// - printCurrentTeaching() abre um seletor de tópicos antes de imprimir
// - CSS @media print oculta chrome e deixa só o conteúdo escolhido
// - Loga 'copy_blocked' (1x por página/sessão) e 'print' em access_logs
// ============================================================

(function () {
  const PROTECTED_SELECTOR = '.topic-content';
  const INTERACTIVE_WHITELIST = 'input, textarea, .highlight-tooltip, .highlight-comment-popup, .highlight-mobile-bar';

  function _escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _inProtectedContent(target) {
    if (!target || !target.closest) return false;
    if (target.closest(INTERACTIVE_WHITELIST)) return false;
    return !!target.closest(PROTECTED_SELECTOR);
  }

  function _getPageRef() {
    const urlParams = new URLSearchParams(window.location.search);
    let volId = urlParams.get('vol') || urlParams.get('v');
    let filename = urlParams.get('file') || urlParams.get('f');
    if (volId && !volId.startsWith('mioshiec')) volId = `mioshiec${volId}`;
    return { volId, filename };
  }

  function _logAction(action) {
    try {
      const { volId, filename } = _getPageRef();
      if (window.supabaseAuth && typeof window.supabaseAuth.logAccess === 'function') {
        window.supabaseAuth.logAccess(volId || null, filename || null, action).catch(() => {});
      }
    } catch (e) { /* silencioso */ }
  }

  function _lang() {
    return localStorage.getItem('site_lang') || 'pt';
  }

  // ----------------------------------------------------------------
  // Copy / Cut / Context menu blocking
  // ----------------------------------------------------------------

  let _copyLoggedThisPage = false;

  function _blockCopy(e) {
    if (!_inProtectedContent(e.target)) return;
    e.preventDefault();
    if (e.clipboardData) {
      try { e.clipboardData.setData('text/plain', ''); } catch (_) {}
    }
    if (!_copyLoggedThisPage) {
      _copyLoggedThisPage = true;
      _logAction('copy_blocked');
    }
    _flashToast();
  }

  function _blockContextMenu(e) {
    if (!_inProtectedContent(e.target)) return;
    e.preventDefault();
  }

  function _blockKeyboardShortcuts(e) {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if (!document.querySelector(PROTECTED_SELECTOR)) return;

    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const k = (e.key || '').toLowerCase();
    if (k === 's' || k === 'p') {
      e.preventDefault();
      if (k === 'p') window.printCurrentTeaching();
    }
  }

  // ----------------------------------------------------------------
  // Toast feedback
  // ----------------------------------------------------------------

  let _toastEl = null;
  let _toastTimer = null;

  function _flashToast() {
    const msg = _lang() === 'ja' ? 'コピーは無効化されています' : 'Cópia de conteúdo desativada';
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.className = 'content-protection-toast';
      _toastEl.setAttribute('role', 'status');
      document.body.appendChild(_toastEl);
    }
    _toastEl.textContent = msg;
    _toastEl.classList.add('visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      if (_toastEl) _toastEl.classList.remove('visible');
    }, 2200);
  }

  // ----------------------------------------------------------------
  // Print flow with topic picker
  // ----------------------------------------------------------------

  function _extractTopicTitle(el) {
    const idx = parseInt((el.id || '').replace('topic-', ''), 10);
    if (!isNaN(idx) && window._currentTopics && window._currentTopics[idx]) {
      const lang = _lang();
      const t = window._currentTopics[idx];
      const raw = (lang === 'pt' ? (t.title_ptbr || t.title_pt || t.title) : (t.title_ja || t.title)) || '';
      const cleaned = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleaned) return cleaned;
    }
    const b = el.querySelector('b font') || el.querySelector('b') || el.querySelector('h1,h2,h3');
    if (b) {
      const txt = b.textContent.replace(/\s+/g, ' ').trim();
      if (txt) return txt;
    }
    return `Tópico ${isNaN(idx) ? '?' : idx + 1}`;
  }

  function _doPrint(excludedIds) {
    _logAction('print');
    const topics = Array.from(document.querySelectorAll(PROTECTED_SELECTOR));
    topics.forEach(el => el.classList.toggle('print-excluded', excludedIds.has(el.id)));
    setTimeout(() => {
      window.print();
      setTimeout(() => topics.forEach(el => el.classList.remove('print-excluded')), 800);
    }, 80);
  }

  window.printCurrentTeaching = function () {
    const topics = Array.from(document.querySelectorAll(PROTECTED_SELECTOR));
    if (topics.length === 0) return;
    if (topics.length === 1) { _doPrint(new Set()); return; }
    _openPrintPicker(topics);
  };

  function _openPrintPicker(topics) {
    const lang = _lang();
    const L = (lang === 'ja')
      ? { title: '印刷する項目を選択', all: 'すべて選択', none: 'すべて解除', cancel: 'キャンセル', print: '印刷', count: (n) => `${n} 項目` }
      : { title: 'O que imprimir?', all: 'Todos', none: 'Nenhum', cancel: 'Cancelar', print: 'Imprimir', count: (n) => `${n} de ${topics.length} selecionado(s)` };

    const existing = document.getElementById('print-picker-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'print-picker-modal';
    modal.className = 'print-picker-modal';
    modal.innerHTML = `
      <div class="print-picker-backdrop"></div>
      <div class="print-picker-dialog" role="dialog" aria-label="${L.title}">
        <div class="print-picker-header">
          <span>${L.title}</span>
          <span class="print-picker-count" id="printPickCount"></span>
        </div>
        <div class="print-picker-actions-top">
          <button type="button" class="print-picker-quick" data-action="all">${L.all}</button>
          <button type="button" class="print-picker-quick" data-action="none">${L.none}</button>
        </div>
        <ul class="print-picker-list">
          ${topics.map(el => {
            const title = _extractTopicTitle(el);
            return `<li><label class="print-picker-item">
              <input type="checkbox" data-topic="${_escHtml(el.id)}" checked>
              <span>${_escHtml(title)}</span>
            </label></li>`;
          }).join('')}
        </ul>
        <div class="print-picker-footer">
          <button type="button" class="print-picker-cancel">${L.cancel}</button>
          <button type="button" class="print-picker-go">🖨️ ${L.print}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const countEl = modal.querySelector('#printPickCount');
    const goBtn = modal.querySelector('.print-picker-go');
    const updateCount = () => {
      const checked = modal.querySelectorAll('input[type=checkbox]:checked').length;
      countEl.textContent = L.count(checked);
      goBtn.disabled = checked === 0;
    };
    modal.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', updateCount));
    updateCount();

    const close = () => {
      modal.remove();
      document.removeEventListener('keydown', onEsc);
    };
    function onEsc(e) { if (e.key === 'Escape') close(); }

    modal.querySelector('.print-picker-backdrop').addEventListener('click', close);
    modal.querySelector('.print-picker-cancel').addEventListener('click', close);
    modal.querySelectorAll('.print-picker-quick').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.action === 'all';
        modal.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = val);
        updateCount();
      });
    });
    goBtn.addEventListener('click', () => {
      const excluded = new Set();
      modal.querySelectorAll('input[type=checkbox]').forEach(cb => {
        if (!cb.checked) excluded.add(cb.dataset.topic);
      });
      if (excluded.size >= topics.length) return;
      close();
      _doPrint(excluded);
    });
    document.addEventListener('keydown', onEsc);
  }

  // ----------------------------------------------------------------
  // Inject styles (toast + print + picker modal)
  // ----------------------------------------------------------------

  function _injectStyles() {
    if (document.getElementById('content-protection-styles')) return;
    const style = document.createElement('style');
    style.id = 'content-protection-styles';
    style.textContent = `
      /* Toast */
      .content-protection-toast {
        position: fixed; bottom: 24px; left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(20,20,20,0.92); color: #fff;
        padding: 10px 18px; border-radius: 22px;
        font-size: 0.85rem; font-family: inherit;
        z-index: 9999; opacity: 0; pointer-events: none;
        transition: opacity 0.2s ease, transform 0.2s ease;
        box-shadow: 0 6px 20px rgba(0,0,0,0.25);
      }
      .content-protection-toast.visible {
        opacity: 1; transform: translateX(-50%) translateY(0);
      }
      [data-mode="dark"] .content-protection-toast {
        background: rgba(245,245,245,0.92); color: #111;
      }

      /* Print picker modal */
      .print-picker-modal {
        position: fixed; inset: 0; z-index: 10000;
        display: flex; align-items: center; justify-content: center;
      }
      .print-picker-backdrop {
        position: absolute; inset: 0; background: rgba(0,0,0,0.45);
      }
      .print-picker-dialog {
        position: relative;
        background: var(--surface, #fff);
        color: var(--text, #111);
        border-radius: 14px;
        width: min(460px, 92vw);
        max-height: 80vh;
        display: flex; flex-direction: column;
        box-shadow: 0 14px 40px rgba(0,0,0,0.35);
        overflow: hidden;
        border: 1px solid var(--border, rgba(0,0,0,0.1));
      }
      .print-picker-header {
        padding: 16px 18px 12px;
        font-weight: 600; font-size: 1rem;
        border-bottom: 1px solid var(--border, rgba(0,0,0,0.08));
        display: flex; justify-content: space-between; align-items: baseline;
      }
      .print-picker-count {
        font-size: 0.78rem; font-weight: 400;
        color: var(--text-muted, #777);
      }
      .print-picker-actions-top {
        display: flex; gap: 8px; padding: 10px 18px 0;
      }
      .print-picker-quick {
        padding: 5px 12px; font-size: 0.78rem;
        border: 1px solid var(--border, rgba(0,0,0,0.15));
        border-radius: 6px; background: transparent;
        color: var(--text-muted, #666); cursor: pointer;
      }
      .print-picker-quick:hover {
        background: var(--accent-soft, rgba(0,0,0,0.04));
      }
      .print-picker-list {
        list-style: none; margin: 0;
        padding: 8px 14px; overflow-y: auto; flex: 1;
      }
      .print-picker-list li { padding: 2px 0; }
      .print-picker-item {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 8px 10px; border-radius: 8px; cursor: pointer;
        font-size: 0.9rem; line-height: 1.4;
      }
      .print-picker-item:hover {
        background: var(--accent-soft, rgba(0,0,0,0.04));
      }
      .print-picker-item input { margin-top: 4px; flex-shrink: 0; cursor: pointer; }
      .print-picker-footer {
        display: flex; justify-content: flex-end; gap: 8px;
        padding: 14px 18px; border-top: 1px solid var(--border, rgba(0,0,0,0.08));
      }
      .print-picker-cancel, .print-picker-go {
        padding: 9px 18px; border-radius: 8px;
        font-size: 0.88rem; cursor: pointer; font-family: inherit;
        border: 1px solid var(--border, rgba(0,0,0,0.15));
        background: transparent; color: var(--text, #111);
      }
      .print-picker-go {
        background: var(--accent, #1a73e8); color: #fff;
        border-color: transparent; font-weight: 600;
      }
      .print-picker-go:disabled {
        opacity: 0.4; cursor: not-allowed;
      }
      [data-mode="dark"] .print-picker-dialog {
        background: #2a2a2a; color: #eee;
        border-color: rgba(255,255,255,0.08);
      }
      [data-mode="dark"] .print-picker-quick:hover,
      [data-mode="dark"] .print-picker-item:hover {
        background: rgba(255,255,255,0.06);
      }

      /* Print */
      @media print {
        .header, #reading-progress, #page-gate,
        .disciples-sidebar-panel, .mobile-nav, .save-tooltip,
        .highlight-tooltip, .highlight-comment-popup, .highlight-mobile-bar,
        .search-modal, .history-modal, .favorites-modal, .highlights-modal,
        .theme-modal, .side-drawer, .skip-link,
        .related-teachings-bar, .breadcrumbs,
        .reader-nav, .reader-nav-footer,
        .content-protection-toast, .print-picker-modal,
        .controls, #readerTopicSelect,
        #backToIndexBtn, .skip-link,
        .topic-content.print-excluded {
          display: none !important;
        }
        html, body {
          background: #fff !important;
          color: #111 !important;
          font-size: 12pt !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: visible !important;
          height: auto !important;
        }
        .main {
          padding: 0 !important; margin: 0 !important;
          display: block !important;
          overflow: visible !important;
        }
        .glass-pane {
          background: #fff !important;
          box-shadow: none !important;
          border: none !important;
          padding: 12px !important;
          margin: 0 !important;
          max-width: 100% !important;
          width: auto !important;
          position: static !important;
          overflow: visible !important;
          height: auto !important;
        }
        .topic-content {
          color: #111 !important;
          margin: 0 !important;
          padding: 0 !important;
          break-inside: auto;
          page-break-inside: auto;
        }
        .topic-content + .topic-content:not(.print-excluded) {
          margin-top: 28px !important;
          padding-top: 20px !important;
          border-top: 1px solid #bbb !important;
        }
        mark.user-highlight {
          background: transparent !important;
          border-bottom: 1px solid #555 !important;
          color: inherit !important;
        }
        a { color: #111 !important; text-decoration: none !important; }
        a[href]::after { content: '' !important; }
      }
    `;
    document.head.appendChild(style);
  }

  // ----------------------------------------------------------------
  // Init
  // ----------------------------------------------------------------

  function _init() {
    _injectStyles();
    document.addEventListener('copy', _blockCopy, true);
    document.addEventListener('cut', _blockCopy, true);
    document.addEventListener('contextmenu', _blockContextMenu, true);
    document.addEventListener('keydown', _blockKeyboardShortcuts);
    document.addEventListener('dragstart', (e) => {
      if (_inProtectedContent(e.target)) e.preventDefault();
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();
