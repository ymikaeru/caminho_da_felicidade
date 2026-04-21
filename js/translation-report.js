// ============================================================
// Translation Report — Mioshie College
// Permite ao usuário reportar erros de tradução via seleção de texto.
// Desktop/tablet only. Requer usuário autenticado.
// ============================================================

(function () {
  'use strict';

  // ── Estado ─────────────────────────────────────────────────
  let _modalEl = null;
  let _toastEl = null;
  let _pendingReport = null; // { text, vol, file, topicId, lang }

  const SUPABASE_URL = 'https://succhmnbajvbpmoqrktq.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1Y2NobW5iYWp2YnBtb3Fya3RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NjY3MDgsImV4cCI6MjA5MjA0MjcwOH0.humCcLYpnnnapkLtLOeb9ZVo5EZWoWw6ItNo0WVY3DY';

  function _lang() {
    return localStorage.getItem('site_lang') || 'pt';
  }

  function _getParams() {
    const urlParams = new URLSearchParams(window.location.search);
    let volId = urlParams.get('vol') || urlParams.get('v');
    let filename = urlParams.get('file') || urlParams.get('f');
    if (!volId || !filename) {
      const hash = window.location.hash.substring(1);
      const m = hash.match(/^v(\d+)\/(.+)$/i);
      if (m) {
        if (!volId) volId = `mioshiec${m[1]}`;
        if (!filename) filename = m[2];
      }
    }
    if (volId && !volId.startsWith('mioshiec')) volId = `mioshiec${volId}`;
    return { volId, filename };
  }

  // ── Supabase (via fetch para evitar import ESM em IIFE) ────
  async function _insertReport(payload) {
    // Get current session token from the shared supabase instance
    let token = SUPABASE_ANON_KEY;
    try {
      if (window._supabaseClient) {
        const { data: { session } } = await window._supabaseClient.auth.getSession();
        if (session?.access_token) token = session.access_token;
        if (!session) return { error: 'no_session' };
      }
    } catch (e) {}

    const res = await fetch(`${SUPABASE_URL}/rest/v1/translation_reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      return { error: err };
    }
    return { error: null };
  }

  async function _getUserId() {
    try {
      if (window._supabaseClient) {
        const { data: { session } } = await window._supabaseClient.auth.getSession();
        return session?.user?.id || null;
      }
    } catch (e) {}
    return null;
  }

  // ── Modal ──────────────────────────────────────────────────
  function _buildModal() {
    if (document.getElementById('translationReportModal')) return;

    const lang = _lang();
    const modal = document.createElement('div');
    modal.id = 'translationReportModal';
    modal.className = 'tr-modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'trModalTitle');

    modal.innerHTML = `
      <div class="tr-modal-panel">
        <div class="tr-modal-header">
          <span class="tr-modal-icon">⚠</span>
          <h2 id="trModalTitle" class="tr-modal-title">${lang === 'ja' ? '翻訳エラーを報告' : 'Reportar Erro de Tradução'}</h2>
          <button class="tr-modal-close" id="trModalClose" aria-label="Fechar">✕</button>
        </div>

        <div class="tr-modal-body">
          <label class="tr-label" for="trSelectedText">
            ${lang === 'ja' ? '選択したテキスト' : 'Trecho selecionado'}
          </label>
          <div class="tr-selected-text" id="trSelectedText" aria-readonly="true"></div>

          <label class="tr-label" for="trDescription">
            ${lang === 'ja' ? '何が問題ですか？（任意）' : 'O que parece errado? (opcional)'}
          </label>
          <textarea
            class="tr-textarea"
            id="trDescription"
            rows="3"
            placeholder="${lang === 'ja' ? '例：この言葉の翻訳が不自然に感じます...' : 'Ex: Esta palavra parece estranha neste contexto...'}"
            maxlength="500"
          ></textarea>
          <div class="tr-char-count"><span id="trCharCount">0</span>/500</div>
        </div>

        <div class="tr-modal-footer">
          <button class="tr-btn-cancel" id="trBtnCancel">
            ${lang === 'ja' ? 'キャンセル' : 'Cancelar'}
          </button>
          <button class="tr-btn-submit" id="trBtnSubmit">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            ${lang === 'ja' ? '送信' : 'Enviar Relatório'}
          </button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    _modalEl = modal;

    // Events
    modal.querySelector('#trModalClose').addEventListener('click', _closeModal);
    modal.querySelector('#trBtnCancel').addEventListener('click', _closeModal);
    modal.querySelector('#trBtnSubmit').addEventListener('click', _handleSubmit);
    modal.addEventListener('click', (e) => { if (e.target === modal) _closeModal(); });

    const textarea = modal.querySelector('#trDescription');
    textarea.addEventListener('input', () => {
      document.getElementById('trCharCount').textContent = textarea.value.length;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _modalEl?.classList.contains('tr-open')) _closeModal();
    });
  }

  function _openModal(text, context) {
    _buildModal();
    _pendingReport = context || {};
    _pendingReport.text = text || '';

    const textEl = document.getElementById('trSelectedText');
    const descEl = document.getElementById('trDescription');
    const countEl = document.getElementById('trCharCount');

    if (textEl) textEl.textContent = _pendingReport.text || '';
    if (descEl) { descEl.value = ''; }
    if (countEl) countEl.textContent = '0';

    _modalEl.classList.add('tr-open');
    setTimeout(() => { document.getElementById('trDescription')?.focus(); }, 50);
  }

  function _closeModal() {
    if (_modalEl) _modalEl.classList.remove('tr-open');
    _pendingReport = null;
  }

  async function _handleSubmit() {
    const btn = document.getElementById('trBtnSubmit');
    if (!btn || btn.disabled) return;

    const description = document.getElementById('trDescription')?.value.trim() || '';
    const lang = _lang();
    const { volId, filename } = _getParams();
    const userId = await _getUserId();

    if (!userId) {
      _showToast(lang === 'ja' ? 'ログインが必要です。' : 'Você precisa estar logado.', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = lang === 'ja' ? '送信中...' : 'Enviando...';

    const payload = {
      user_id: userId,
      vol: volId || (_pendingReport?.vol || ''),
      file: filename || (_pendingReport?.file || ''),
      topic_id: _pendingReport?.topicId || null,
      lang: lang,
      selected_text: (_pendingReport?.text || '').substring(0, 2000),
      description: description || null
    };

    const { error } = await _insertReport(payload);

    if (error && error !== null) {
      console.error('[translation-report] submit failed:', error);
      _showToast(
        lang === 'ja' ? '送信に失敗しました。後でもう一度お試しください。' : 'Falha ao enviar. Tente novamente.',
        'error'
      );
    } else {
      _closeModal();
      _showToast(
        lang === 'ja' ? 'ご報告ありがとうございます！' : 'Relatório enviado! Obrigado. 🙏',
        'success'
      );
    }

    btn.disabled = false;
    const submitLabel = lang === 'ja' ? '送信' : 'Enviar Relatório';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> ${submitLabel}`;
  }

  // ── Toast ──────────────────────────────────────────────────
  function _showToast(message, type = 'success') {
    if (_toastEl) _toastEl.remove();
    const toast = document.createElement('div');
    toast.className = `tr-toast tr-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    _toastEl = toast;

    requestAnimationFrame(() => toast.classList.add('tr-toast--visible'));
    setTimeout(() => {
      toast.classList.remove('tr-toast--visible');
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  // ── CSS Injection ──────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('tr-report-styles')) return;
    const style = document.createElement('style');
    style.id = 'tr-report-styles';
    style.textContent = `
      /* ── Report Button (inside highlight tooltip) ─────────── */
      .tr-report-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        width: 100%;
        padding: 6px 10px;
        margin-top: 6px;
        background: transparent;
        border: 1px solid var(--border-color, rgba(0,0,0,0.12));
        border-radius: 6px;
        color: var(--text-muted, #888);
        font-size: 11.5px;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
        white-space: nowrap;
      }
      .tr-report-btn:hover {
        background: rgba(255, 180, 0, 0.08);
        border-color: rgba(255, 160, 0, 0.4);
        color: var(--text-color, #333);
      }
      .tr-report-btn svg {
        flex-shrink: 0;
        opacity: 0.6;
      }

      /* ── Modal Overlay ────────────────────────────────────── */
      .tr-modal-overlay {
        position: fixed;
        inset: 0;
        z-index: 9800;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0);
        backdrop-filter: blur(0px);
        pointer-events: none;
        transition: background 0.22s ease, backdrop-filter 0.22s ease;
      }
      .tr-modal-overlay.tr-open {
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(4px);
        pointer-events: all;
      }

      /* ── Modal Panel ──────────────────────────────────────── */
      .tr-modal-panel {
        background: var(--bg-color, #fff);
        border: 1px solid var(--border-color, rgba(0,0,0,0.1));
        border-radius: 14px;
        box-shadow: 0 24px 64px rgba(0,0,0,0.18);
        width: min(480px, 92vw);
        max-height: 85vh;
        overflow-y: auto;
        opacity: 0;
        transform: translateY(12px) scale(0.97);
        transition: opacity 0.22s ease, transform 0.22s ease;
      }
      .tr-modal-overlay.tr-open .tr-modal-panel {
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      /* ── Header ───────────────────────────────────────────── */
      .tr-modal-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 18px 20px 14px;
        border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.08));
      }
      .tr-modal-icon {
        font-size: 18px;
        line-height: 1;
        opacity: 0.75;
      }
      .tr-modal-title {
        flex: 1;
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        font-family: inherit;
        color: var(--text-color, #333);
      }
      .tr-modal-close {
        background: none;
        border: none;
        padding: 4px 6px;
        cursor: pointer;
        color: var(--text-muted, #aaa);
        font-size: 14px;
        border-radius: 6px;
        transition: color 0.15s, background 0.15s;
        line-height: 1;
      }
      .tr-modal-close:hover {
        color: var(--text-color, #333);
        background: var(--hover-bg, rgba(0,0,0,0.06));
      }

      /* ── Body ─────────────────────────────────────────────── */
      .tr-modal-body {
        padding: 18px 20px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .tr-label {
        display: block;
        font-size: 11.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted, #888);
        margin-bottom: 4px;
      }
      .tr-selected-text {
        padding: 10px 12px;
        background: var(--hover-bg, rgba(0,0,0,0.04));
        border-left: 3px solid rgba(255, 160, 0, 0.5);
        border-radius: 0 6px 6px 0;
        font-size: 13px;
        line-height: 1.55;
        color: var(--text-color, #333);
        max-height: 100px;
        overflow-y: auto;
        word-break: break-word;
        white-space: pre-wrap;
        font-style: italic;
        opacity: 0.85;
      }
      .tr-textarea {
        width: 100%;
        resize: vertical;
        padding: 10px 12px;
        background: var(--bg-color, #fff);
        border: 1px solid var(--border-color, rgba(0,0,0,0.12));
        border-radius: 8px;
        font-family: inherit;
        font-size: 13.5px;
        line-height: 1.5;
        color: var(--text-color, #333);
        box-sizing: border-box;
        transition: border-color 0.15s;
        outline: none;
        min-height: 80px;
      }
      .tr-textarea:focus {
        border-color: rgba(255, 160, 0, 0.6);
        box-shadow: 0 0 0 3px rgba(255, 160, 0, 0.1);
      }
      .tr-char-count {
        text-align: right;
        font-size: 11px;
        color: var(--text-muted, #bbb);
      }

      /* ── Footer ───────────────────────────────────────────── */
      .tr-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 20px 18px;
        border-top: 1px solid var(--border-color, rgba(0,0,0,0.06));
      }
      .tr-btn-cancel {
        padding: 8px 16px;
        background: transparent;
        border: 1px solid var(--border-color, rgba(0,0,0,0.12));
        border-radius: 8px;
        font-family: inherit;
        font-size: 13px;
        color: var(--text-muted, #888);
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .tr-btn-cancel:hover {
        background: var(--hover-bg, rgba(0,0,0,0.06));
        color: var(--text-color, #333);
      }
      .tr-btn-submit {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 18px;
        background: var(--accent, #c8a96e);
        border: none;
        border-radius: 8px;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
        transition: opacity 0.15s, transform 0.15s;
      }
      .tr-btn-submit:hover:not(:disabled) {
        opacity: 0.88;
        transform: translateY(-1px);
      }
      .tr-btn-submit:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      /* ── Toast ────────────────────────────────────────────── */
      .tr-toast {
        position: fixed;
        bottom: 28px;
        left: 50%;
        transform: translateX(-50%) translateY(16px);
        z-index: 9900;
        padding: 10px 20px;
        border-radius: 24px;
        font-family: inherit;
        font-size: 13.5px;
        font-weight: 500;
        box-shadow: 0 8px 24px rgba(0,0,0,0.18);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
        white-space: nowrap;
      }
      .tr-toast--success {
        background: var(--accent, #c8a96e);
        color: #fff;
      }
      .tr-toast--error {
        background: #e05252;
        color: #fff;
      }
      .tr-toast--visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* Dark mode tweaks */
      [data-mode="dark"] .tr-modal-panel {
        box-shadow: 0 24px 64px rgba(0,0,0,0.48);
      }
      [data-mode="dark"] .tr-selected-text {
        background: rgba(255,255,255,0.05);
      }
      [data-mode="dark"] .tr-textarea {
        background: rgba(255,255,255,0.05);
      }

      /* Reduced motion */
      @media (prefers-reduced-motion: reduce) {
        .tr-modal-panel,
        .tr-modal-overlay,
        .tr-toast { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Called by highlights.js when "Reportar erro" button is clicked.
   * @param {string} text - Selected text
   * @param {object} context - { topicId, vol, file }
   */
  window.openTranslationReport = function (text, context) {
    _openModal(text, context);
  };

  // ── Init ───────────────────────────────────────────────────
  function _init() {
    // Desktop/tablet only — mirrors highlights.js detection
    const isMobile = /Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || window.innerWidth <= 768;
    if (isMobile) return;

    _injectStyles();
    _buildModal();

    // Expose supabase client reference (set by login.js / sync.js ESM module)
    // We poll briefly in case supabase-config loads after this IIFE
    if (!window._supabaseClient) {
      const tick = setInterval(() => {
        // sync.js exports supabase to window via module — access via _cloudSync
        if (window._cloudSync?.supabase) {
          window._supabaseClient = window._cloudSync.supabase;
          clearInterval(tick);
        }
      }, 200);
      setTimeout(() => clearInterval(tick), 5000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();
