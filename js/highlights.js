// ============================================================
// HIGHLIGHTS — CSS Custom Highlight API, no DOM mutation
// Uses character offsets + CSS Custom Highlight API for rendering
// Mobile-friendly floating action bar, offline queue support
// ============================================================

(function () {
  const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'];
  const DEFAULT_COLOR = 'yellow';

  const COLOR_MAP = {
    yellow: '#fff3a1', green: '#a8e6cf', blue: '#a0c4ff',
    pink: '#ffb3c6', purple: '#d4a5f5', orange: '#ffd6a5'
  };

  const DARK_COLOR_MAP = {
    yellow: '#6b5f00', green: '#1a5c3a', blue: '#1a3a6b',
    pink: '#6b1a3a', purple: '#4a1a6b', orange: '#6b4a00'
  };

  let _tooltipEl = null;
  let _commentPopupEl = null;
  let _mobileBarEl = null;
  let _currentSelection = null;
  let _selectedColor = DEFAULT_COLOR;
  let _highlights = [];
  let _highlightRegistry = null;
  let _isMobile = false;
  let _savedRange = null;
  // No Android/Samsung, ao limpar a seleção nativa (pra dispensar a barra do
  // sistema) o navegador ainda dispara um mouseup sintético logo depois. Esse
  // flag faz _handleSelection ignorar esse evento fantasma por uns ms, senão
  // ele veria a seleção já colapsada e fecharia nossa barra na hora.
  let _justCaptured = false;

  // ── Instrumentação on-device (gated por ?hldebug=1) ────────────────────────
  // Console do Android é impraticável; este overlay registra eventos de seleção
  // pra diagnosticar por que a barra nativa do OS aparece em vez da nossa.
  // Inerte (no-op) sem o parâmetro. Remover quando o bug do destaque fechar.
  let _hlDebugEl = null;
  const _HL_DEBUG = (() => {
    try { return /[?&]hldebug=1\b/.test(window.location.search); } catch (_) { return false; }
  })();
  function _dbg(msg) {
    if (!_HL_DEBUG) return;
    try {
      if (!_hlDebugEl) {
        _hlDebugEl = document.createElement('div');
        _hlDebugEl.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:42vh;overflow:auto;background:rgba(0,0,0,.86);color:#7CFC00;font:11px/1.35 monospace;padding:6px 8px;white-space:pre-wrap;border-top:2px solid #7CFC00;';
        document.body.appendChild(_hlDebugEl);
      }
      const sel = window.getSelection();
      const selLen = sel && !sel.isCollapsed ? String(sel.toString().trim().length) : '0';
      const line = document.createElement('div');
      line.textContent = `${msg}  [sel=${selLen}]`;
      _hlDebugEl.insertBefore(line, _hlDebugEl.firstChild);
      while (_hlDebugEl.childNodes.length > 40) _hlDebugEl.removeChild(_hlDebugEl.lastChild);
    } catch (_) { /* noop */ }
  }

  function _lang() {
    return localStorage.getItem('site_lang') || 'pt';
  }

  function _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _isDisciplesMode() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('pub') === 'disciples';
  }

  function _getParams() {
    const urlParams = new URLSearchParams(window.location.search);

    // Disciples mode: vol = 'disciples', file = book id
    if (_isDisciplesMode()) {
      const bookId = urlParams.get('book') || '';
      return { volId: 'disciples', filename: bookId };
    }

    let volId = urlParams.get('vol') || urlParams.get('v');
    let filename = urlParams.get('file') || urlParams.get('f');

    if (!volId || !filename) {
      const hash = window.location.hash.substring(1).replace(/^#/, '');
      const hashMatch = hash.match(/^v(\d+)\/(.+)$/i);
      if (hashMatch) {
        if (!volId) volId = `mioshiec${hashMatch[1]}`;
        if (!filename) filename = hashMatch[2];
      }
    }

    if (volId && !volId.startsWith('mioshiec')) volId = `mioshiec${volId}`;
    return { volId, filename };
  }

  function _loadHighlights() {
    try {
      _highlights = JSON.parse(localStorage.getItem('userHighlights') || '[]');
    } catch (e) {
      _highlights = [];
    }
  }

  function _saveHighlights() {
    try {
      localStorage.setItem('userHighlights', JSON.stringify(_highlights));
    } catch (e) {}
  }

  function _getDeletedTombstones() {
    try {
      return JSON.parse(localStorage.getItem('highlightDeletedKeys') || '[]');
    } catch (e) {
      return [];
    }
  }

  function _addDeletedTombstone(key) {
    try {
      const tombstones = _getDeletedTombstones();
      tombstones.push(key);
      if (tombstones.length > 2000) tombstones.splice(0, tombstones.length - 2000);
      localStorage.setItem('highlightDeletedKeys', JSON.stringify(tombstones));
    } catch (e) {}
  }

  function _getTopicIdFromNode(node) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    while (el) {
      if (el.classList) {
        if (el.classList.contains('topic-content')) {
          return el.id;
        }
        // Disciples mode: each section has id="sec-xxx" and content under .disciples-section-content
        if ((el.classList.contains('disciples-section') || el.classList.contains('disciples-part-divider'))
            && el.id) {
          return el.id;
        }
      }
      el = el.parentNode;
    }
    return null;
  }

  function _collectTextNodes(root) {
    const result = [];
    let charOffset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while (node = walker.nextNode()) {
      const len = node.textContent.length;
      result.push({ node, startChar: charOffset, endChar: charOffset + len });
      charOffset += len;
    }
    return result;
  }

  function _getCharOffsetsFromSelection(range, topicEl) {
    const textNodes = _collectTextNodes(topicEl);
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    let startChar = -1;
    let endChar = -1;

    for (const tn of textNodes) {
      if (tn.node === startContainer) {
        startChar = tn.startChar + range.startOffset;
      }
      if (tn.node === endContainer) {
        endChar = tn.startChar + range.endOffset;
      }
    }

    return { startChar, endChar };
  }

  // ============================================================
  // CSS Custom Highlight API — no DOM mutation
  // ============================================================

  function _initHighlightRegistry() {
    // CSS Custom Highlight API is not widely supported yet.
    // We use traditional <mark> elements which work in all browsers.
  }

  function _buildHighlightRanges(topicEl, highlights) {
    const textNodes = _collectTextNodes(topicEl);
    if (textNodes.length === 0) return [];

    const totalChars = textNodes[textNodes.length - 1].endChar;
    const ranges = [];

    highlights.forEach(h => {
      const startChar = h.startChar;
      const endChar = h.endChar;
      if (startChar < 0 || endChar < 0 || startChar >= endChar || endChar > totalChars + 1) return;

      for (const tn of textNodes) {
        const overlapStart = Math.max(tn.startChar, startChar);
        const overlapEnd = Math.min(tn.endChar, endChar);

        if (overlapStart < overlapEnd) {
          const range = new Range();
          range.setStart(tn.node, overlapStart - tn.startChar);
          range.setEnd(tn.node, overlapEnd - tn.startChar);
          ranges.push({ range, highlight: h });
        }
      }
    });

    return ranges;
  }

  function _applyHighlightsToPage() {
    _initHighlightRegistry();
    const { volId, filename } = _getParams();
    const pageHighlights = _highlights.filter(h => h.vol === volId && h.file === filename);

    const byTopic = {};
    pageHighlights.forEach(h => {
      if (!byTopic[h.topicId]) byTopic[h.topicId] = [];
      byTopic[h.topicId].push(h);
    });

    for (const topicId in byTopic) {
      const topicEl = document.getElementById(topicId);
      if (!topicEl) continue;

      // Collect all text nodes ONCE, then apply all highlights for this topic.
      // We iterate highlights in reverse-document-order so that wrapping a
      // later node doesn't shift offsets for earlier ones.
      const textNodes = _collectTextNodes(topicEl);
      if (textNodes.length === 0) continue;
      const totalChars = textNodes[textNodes.length - 1].endChar;

      // Build per-highlight segment lists (each segment = one text-node slice)
      const hlSegments = [];
      byTopic[topicId].forEach(h => {
        if (h.startChar < 0 || h.endChar < 0 || h.startChar >= h.endChar || h.endChar > totalChars + 1) return;
        const existing = document.querySelector(`mark.user-highlight[data-highlight-id="${h.id}"]`);
        if (existing) existing.remove();

        const segs = [];
        for (const tn of textNodes) {
          const overlapStart = Math.max(tn.startChar, h.startChar);
          const overlapEnd = Math.min(tn.endChar, h.endChar);
          if (overlapStart < overlapEnd) {
            // Fatia só de espaço/quebra (nós ENTRE blocos <p>/<li> — comum no
            // Markdown dos livros de discípulos) não vira <mark>: o mark
            // embrulhando "\n" aparece como barrinha colorida solta e estica
            // a entrelinha. Pular não mexe nos offsets (a régua é a mesma).
            if (!tn.node.textContent.slice(overlapStart - tn.startChar, overlapEnd - tn.startChar).trim()) continue;
            segs.push({
              node: tn.node,
              offsetStart: overlapStart - tn.startChar,
              offsetEnd: overlapEnd - tn.startChar,
            });
          }
        }
        if (segs.length > 0) hlSegments.push({ highlight: h, segs });
      });

      // Apply in reverse order so earlier node offsets stay valid
      hlSegments.reverse();
      for (const { highlight, segs } of hlSegments) {
        // Wrap each text-node segment individually — never crosses element
        // boundaries, so surroundContents always succeeds.
        const isFirst = { value: true };
        for (let i = segs.length - 1; i >= 0; i--) {
          const seg = segs[i];
          try {
            const r = document.createRange();
            r.setStart(seg.node, seg.offsetStart);
            r.setEnd(seg.node, seg.offsetEnd);
            const mark = document.createElement('mark');
            mark.className = `user-highlight highlight-${highlight.color}`;
            // Only the first mark gets the data-highlight-id (for scroll-to queries)
            if (isFirst.value) {
              mark.dataset.highlightId = highlight.id;
              isFirst.value = false;
            } else {
              mark.dataset.highlightGroup = highlight.id;
            }
            if (highlight.comment) mark.title = highlight.comment;
            r.surroundContents(mark);
            mark.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              const h = _highlights.find(x => x.id === highlight.id);
              if (h) _showCommentPopup(h, mark);
            });
          } catch (e) {
            // Absolute fallback: split the text node manually
            _applyWithSplit(seg.node, seg.offsetStart, seg.offsetEnd, highlight);
          }
        }
      }
    }
  }

  function _unwrapMarks() {
    document.querySelectorAll('mark.user-highlight').forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
    if (_highlightRegistry) {
      _highlightRegistry.clear();
    }
  }

  // ============================================================
  // Tooltip (desktop)
  // ============================================================

  function _showTooltip(range) {
    if (_tooltipEl) _tooltipEl.remove();

    const lang = _lang();
    const commentPlaceholder = lang === 'ja' ? 'コメントを追加...' : 'Adicionar comentário...';
    const saveLabel = lang === 'ja' ? '保存' : 'Salvar';
    const cancelLabel = lang === 'ja' ? 'キャンセル' : 'Cancelar';

    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'highlight-tooltip';
    _tooltipEl.id = 'highlightTooltip';

    let colorBtnsHTML = COLORS.map(c =>
      `<button class="highlight-color-btn color-${c}" data-color="${c}" title="${c}"></button>`
    ).join('');

    const reportLabel = lang === 'ja' ? '翻訳エラーを報告' : 'Reportar erro de tradução';

    _tooltipEl.innerHTML =
      `<div class="highlight-colors">${colorBtnsHTML}</div>` +
      `<div class="highlight-tooltip-divider"></div>` +
      `<div class="highlight-comment-section">` +
        `<textarea class="highlight-comment-input" id="highlightCommentInput" placeholder="${commentPlaceholder}"></textarea>` +
        `<div class="highlight-comment-actions">` +
          `<button class="highlight-cancel-btn" id="highlightCancelBtn">${cancelLabel}</button>` +
          `<button class="highlight-save-btn" id="highlightSaveBtn">${saveLabel}</button>` +
        `</div>` +
      `</div>` +
      `<div class="highlight-tooltip-divider" style="margin-top:4px"></div>` +
      `<button class="tr-report-btn" id="highlightReportBtn">` +
        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>` +
        `${reportLabel}` +
      `</button>`;


    document.body.appendChild(_tooltipEl);

    const rect = range.getBoundingClientRect();
    const tooltipRect = _tooltipEl.getBoundingClientRect();

    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    let top = rect.top - tooltipRect.height - 10 + window.scrollY;

    if (left < 8) left = 8;
    if (left + tooltipRect.width > window.innerWidth - 8) left = window.innerWidth - tooltipRect.width - 8;
    if (top < window.scrollY + 8) top = rect.bottom + 10 + window.scrollY;

    _tooltipEl.style.left = `${left}px`;
    _tooltipEl.style.top = `${top}px`;
    _tooltipEl.classList.add('visible');

    _savedRange = range.cloneRange();

    _tooltipEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    _tooltipEl.addEventListener('mouseup', (e) => {
      e.stopPropagation();
      const tag = e.target.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'BUTTON') return;
      if (_savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(_savedRange);
      }
    });
    _tooltipEl.addEventListener('touchend', (e) => {
      e.stopPropagation();
    });

    _tooltipEl.querySelectorAll('.highlight-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _tooltipEl.querySelectorAll('.highlight-color-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        _selectedColor = btn.dataset.color;
      });
    });

    const firstColorBtn = _tooltipEl.querySelector('.highlight-color-btn');
    if (firstColorBtn) {
      firstColorBtn.classList.add('selected');
      _selectedColor = firstColorBtn.dataset.color;
    }

    document.getElementById('highlightCancelBtn').addEventListener('click', _hideTooltip);
    document.getElementById('highlightSaveBtn').addEventListener('click', _saveSelection);

    const reportBtn = document.getElementById('highlightReportBtn');
    if (reportBtn) {
      reportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sel = _currentSelection;
        if (sel && typeof window.openTranslationReport === 'function') {
          _hideTooltip();
          window.openTranslationReport(sel.text, {
            topicId: sel.topicId,
            vol: _getParams().volId,
            file: _getParams().filename
          });
        }
      });
    }
  }

  function _hideTooltip() {
    _savedRange = null;
    if (_tooltipEl) {
      _tooltipEl.remove();
      _tooltipEl = null;
    }
    _currentSelection = null;
  }

  // ============================================================
  // Mobile Floating Action Bar
  // ============================================================

  function _showMobileBar() {
    if (_mobileBarEl) _mobileBarEl.remove();

    const lang = _lang();
    const highlightLabel = lang === 'ja' ? 'ハイライト' : 'Destacar';
    const cancelLabel = lang === 'ja' ? 'キャンセル' : 'Cancelar';
    const copyLabel = lang === 'ja' ? 'コピー' : 'Copiar';

    _mobileBarEl = document.createElement('div');
    _mobileBarEl.className = 'highlight-mobile-bar';
    _mobileBarEl.id = 'highlightMobileBar';

    let colorBtnsHTML = COLORS.map(c =>
      `<button class="highlight-color-btn color-${c}" data-color="${c}"></button>`
    ).join('');

    const commentPlaceholder = lang === 'ja' ? 'コメントを追加...' : 'Adicionar comentário...';
    const reportLabel = lang === 'ja' ? '翻訳エラーを報告' : 'Reportar erro de tradução';

    _mobileBarEl.innerHTML =
      `<div class="highlight-mobile-bar-content">` +
        `<div class="highlight-colors">${colorBtnsHTML}</div>` +
        `<div class="highlight-comment-section">` +
          `<textarea class="highlight-comment-input highlight-mobile-comment" id="highlightMobileCommentInput" placeholder="${commentPlaceholder}"></textarea>` +
        `</div>` +
        `<div class="highlight-mobile-bar-actions">` +
          `<button class="highlight-cancel-btn" id="highlightMobileCancelBtn">${cancelLabel}</button>` +
          `<button class="highlight-copy-btn" id="highlightMobileCopyBtn">${copyLabel}</button>` +
          `<button class="highlight-save-btn" id="highlightMobileSaveBtn">${highlightLabel}</button>` +
        `</div>` +
        `<div class="highlight-tooltip-divider" style="margin: 2px 0"></div>` +
        `<button class="tr-report-btn tr-report-btn--mobile" id="highlightMobileReportBtn">` +
          `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>` +
          `${reportLabel}` +
        `</button>` +
      `</div>`;

    document.body.appendChild(_mobileBarEl);

    _mobileBarEl.querySelectorAll('.highlight-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _mobileBarEl.querySelectorAll('.highlight-color-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        _selectedColor = btn.dataset.color;
      });
    });

    const firstColorBtn = _mobileBarEl.querySelector('.highlight-color-btn');
    if (firstColorBtn) {
      firstColorBtn.classList.add('selected');
      _selectedColor = firstColorBtn.dataset.color;
    }

    document.getElementById('highlightMobileCancelBtn').addEventListener('click', _hideMobileBar);
    document.getElementById('highlightMobileSaveBtn').addEventListener('click', _saveSelection);

    // Botão "Copiar": no mobile a barra de seleção nativa do OS (que tinha o
    // Copiar) foi derrubada pra liberar nossa barra de destaque — ver
    // _showMobileBarAndClear. Este botão devolve a cópia e loga o evento no
    // audit trail via window.logManualCopy (content-protection.js), já que o
    // evento `copy` nativo não dispara com a seleção limpa.
    const mobileCopyBtn = document.getElementById('highlightMobileCopyBtn');
    if (mobileCopyBtn) {
      mobileCopyBtn.addEventListener('click', () => {
        const text = _currentSelection && _currentSelection.text;
        if (!text) { _hideMobileBar(); return; }
        const copiedMsg = lang === 'ja' ? 'コピーしました' : 'Texto copiado';
        // Não loga cópia de admin (paridade com o evento `copy` nativo, que
        // pula admins via _inProtectedContent em content-protection.js).
        const isAdmin = (typeof isAdminUser === 'function' && isAdminUser());
        _copyToClipboard(text).then(() => {
          if (!isAdmin && typeof window.logManualCopy === 'function') window.logManualCopy(text, 'copy');
          _showHlToast(copiedMsg);
          _hideMobileBar();
        });
      });
    }

    const mobileReportBtn = document.getElementById('highlightMobileReportBtn');
    if (mobileReportBtn) {
      mobileReportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sel = _currentSelection;
        if (sel && typeof window.openTranslationReport === 'function') {
          _hideMobileBar();
          window.openTranslationReport(sel.text, {
            topicId: sel.topicId,
            vol: _getParams().volId,
            file: _getParams().filename
          });
        }
      });
    }
  }

  function _hideMobileBar() {
    if (_mobileBarEl) {
      _mobileBarEl.remove();
      _mobileBarEl = null;
    }
    _currentSelection = null;
  }

  // Copia texto pro clipboard. Usa a Clipboard API (suportada no iOS 13.4+ e
  // Android Chrome) com fallback execCommand pra navegadores antigos. Chamado
  // dentro do gesto de toque do botão, então tem ativação do usuário.
  function _copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => _legacyCopy(text));
    }
    return Promise.resolve(_legacyCopy(text));
  }

  function _legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { /* noop */ }
  }

  // Toast efêmero de confirmação ("Texto copiado"). Self-contained pra não
  // depender de outro módulo; CSS em _highlights.css (.hl-toast).
  let _hlToastEl = null;
  let _hlToastTimer = null;
  function _showHlToast(message) {
    if (_hlToastEl) _hlToastEl.remove();
    const toast = document.createElement('div');
    toast.className = 'hl-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    _hlToastEl = toast;
    requestAnimationFrame(() => toast.classList.add('hl-toast--visible'));
    clearTimeout(_hlToastTimer);
    _hlToastTimer = setTimeout(() => {
      toast.classList.remove('hl-toast--visible');
      setTimeout(() => { toast.remove(); if (_hlToastEl === toast) _hlToastEl = null; }, 300);
    }, 2200);
  }

  // ============================================================
  // Comment Popup
  // ============================================================

  function _hideCommentPopup() {
    if (_commentPopupEl) {
      _commentPopupEl.remove();
      _commentPopupEl = null;
    }
  }

  function _showCommentPopup(highlight, markEl) {
    _hideCommentPopup();

    const lang = _lang();
    const editLabel = lang === 'ja' ? '編集' : 'Editar';
    const deleteLabel = lang === 'ja' ? '削除' : 'Apagar';
    const closeLabel = lang === 'ja' ? '閉じる' : 'Fechar';

    const rect = markEl.getBoundingClientRect();

    _commentPopupEl = document.createElement('div');
    _commentPopupEl.className = 'highlight-comment-popup';

    let html = `<div class="popup-text">${_esc(highlight.text)}</div>`;
    if (highlight.comment) {
      html += `<div class="popup-comment">${_esc(highlight.comment)}</div>`;
    }
    html += `<div class="popup-actions">` +
      `<button class="edit-highlight-btn">${editLabel}</button>` +
      `<button class="delete-highlight-btn">${deleteLabel}</button>` +
      `<button class="close-highlight-btn">${closeLabel}</button>` +
    `</div>`;

    _commentPopupEl.innerHTML = html;
    document.body.appendChild(_commentPopupEl);

    let left = rect.left + (rect.width / 2) - 110;
    let top = rect.bottom + 8 + window.scrollY;

    if (left < 8) left = 8;
    if (left + 220 > window.innerWidth - 8) left = window.innerWidth - 230;
    if (top + 200 > window.scrollY + window.innerHeight) top = rect.top - 200 + window.scrollY;

    _commentPopupEl.style.left = `${left}px`;
    _commentPopupEl.style.top = `${top}px`;
    _commentPopupEl.classList.add('visible');

    _commentPopupEl.querySelector('.close-highlight-btn').addEventListener('click', _hideCommentPopup);
    _commentPopupEl.querySelector('.delete-highlight-btn').addEventListener('click', () => {
      _removeHighlight(highlight.id);
      _hideCommentPopup();
    });
    _commentPopupEl.querySelector('.edit-highlight-btn').addEventListener('click', () => {
      _hideCommentPopup();
      _openEditDialog(highlight);
    });
  }

  function _openEditDialog(highlight) {
    const lang = _lang();
    const commentPlaceholder = lang === 'ja' ? 'コメントを編集...' : 'Editar comentário...';
    const saveLabel = lang === 'ja' ? '保存' : 'Salvar';
    const cancelLabel = lang === 'ja' ? 'キャンセル' : 'Cancelar';

    const tooltip = document.createElement('div');
    tooltip.className = 'highlight-tooltip visible';

    let colorBtnsHTML = COLORS.map(c =>
      `<button class="highlight-color-btn color-${c}" data-color="${c}"></button>`
    ).join('');

    tooltip.innerHTML =
      `<div class="highlight-colors">${colorBtnsHTML}</div>` +
      `<div class="highlight-tooltip-divider"></div>` +
      `<div class="highlight-comment-section">` +
        `<textarea class="highlight-comment-input" id="highlightEditCommentInput" placeholder="${commentPlaceholder}">${_esc(highlight.comment || '')}</textarea>` +
        `<div class="highlight-comment-actions">` +
          `<button class="highlight-cancel-btn" id="highlightEditCancelBtn">${cancelLabel}</button>` +
          `<button class="highlight-save-btn" id="highlightEditSaveBtn">${saveLabel}</button>` +
        `</div>` +
      `</div>`;

    document.body.appendChild(tooltip);

    const markEl = document.querySelector(`mark.user-highlight[data-highlight-id="${highlight.id}"]`);
    if (markEl) {
      const rect = markEl.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
      let top = rect.bottom + 10 + window.scrollY;
      if (left < 8) left = 8;
      if (left + tooltipRect.width > window.innerWidth - 8) left = window.innerWidth - tooltipRect.width - 8;
      if (top + tooltipRect.height > window.scrollY + window.innerHeight) top = rect.top - tooltipRect.height - 10 + window.scrollY;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    } else {
      tooltip.style.left = '50%';
      tooltip.style.top = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
    }

    tooltip.querySelectorAll('.highlight-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tooltip.querySelectorAll('.highlight-color-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    const activeColorBtn = tooltip.querySelector(`.highlight-color-btn.color-${highlight.color}`);
    if (activeColorBtn) activeColorBtn.classList.add('selected');

    tooltip.querySelector('#highlightEditCancelBtn').addEventListener('click', () => tooltip.remove());
    tooltip.querySelector('#highlightEditSaveBtn').addEventListener('click', () => {
      const newColor = tooltip.querySelector('.highlight-color-btn.selected')?.dataset.color || highlight.color;
      const newComment = document.getElementById('highlightEditCommentInput').value.trim();

      const h = _highlights.find(x => x.id === highlight.id);
      if (h) {
        h.color = newColor;
        h.comment = newComment;
        h.updatedAt = Date.now();
        _saveHighlights();
        _refreshPageHighlights();
      }
      tooltip.remove();
    });
  }

  // ============================================================
  // Save / Remove
  // ============================================================

  function _saveSelection() {
    if (!_currentSelection) return;

    const { volId, filename } = _getParams();
    const commentInputDesktop = document.getElementById('highlightCommentInput');
    const commentInputMobile = document.getElementById('highlightMobileCommentInput');
    const comment = (commentInputDesktop?.value || commentInputMobile?.value || '').trim();

    const highlight = {
      id: 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      vol: volId,
      file: filename,
      topicId: _currentSelection.topicId,
      topicIndex: _currentSelection.topicIndex,
      topicTitle: _currentSelection.topicTitle,
      color: _selectedColor,
      comment: comment,
      text: _currentSelection.text,
      startChar: _currentSelection.startChar,
      endChar: _currentSelection.endChar,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Highlights são cloud-first: requerem conexão. O site exige internet
    // pra carregar os ensinamentos de qualquer forma, então oferecer
    // suporte offline pra destaques só causava ressurreição de itens
    // apagados pelo admin (bulk push no login). Aborta com aviso.
    if (!window._cloudSync) {
      alert('Você precisa estar online para criar destaques.');
      return;
    }

    _highlights.unshift(highlight);
    _saveHighlights();

    window._cloudSync.saveHighlight(
      highlight.vol, highlight.file, highlight.topicId, highlight.topicIndex,
      highlight.topicTitle, highlight.color, highlight.comment, highlight.text,
      highlight.startChar, highlight.endChar
    );

    if (_isMobile) {
      _hideMobileBar();
    } else {
      _hideTooltip();
    }

    const topicEl = document.getElementById(highlight.topicId);
    if (topicEl) {
      _applyHighlightsToTopic(topicEl, [highlight]);
    }
    _updateHighlightBadge();
  }

  function _removeHighlight(id) {
    // Cloud-first: requer conexão. Sem fallback offline (ver _saveHighlights
    // acima — mesma justificativa).
    if (!window._cloudSync) {
      alert('Você precisa estar online para apagar destaques.');
      return;
    }

    const h = _highlights.find(x => x.id === id);
    _highlights = _highlights.filter(x => x.id !== id);
    _saveHighlights();

    if (h) {
      const key = `${h.vol}:${h.file}:${h.topicId}:${h.startChar}:${h.endChar}`;
      _addDeletedTombstone(key);
      window._cloudSync
        .removeHighlight(h.vol, h.file, h.topicId, h.startChar, h.endChar)
        .catch(err => console.warn('Failed to remove highlight from cloud:', err));
    }

    // Um destaque que cruza vários nós de texto (ex.: passa por um <i>) é
    // renderizado em VÁRIAS marcas: a 1ª com data-highlight-id, as demais com
    // data-highlight-group. Desfaz TODAS — antes só a 1ª saía e sobravam órfãs.
    const marks = document.querySelectorAll(
      `mark.user-highlight[data-highlight-id="${id}"], mark.user-highlight[data-highlight-group="${id}"]`
    );
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });

    _updateHighlightBadge();
  }

  function _applyHighlightsToTopic(topicEl, highlights) {
    const textNodes = _collectTextNodes(topicEl);
    if (textNodes.length === 0) return;

    const totalChars = textNodes[textNodes.length - 1].endChar;

    // Process highlights in reverse so wrapping later nodes doesn't
    // invalidate offsets of earlier ones.
    const sorted = [...highlights].reverse();
    sorted.forEach(h => {
      const startChar = h.startChar;
      const endChar = h.endChar;

      if (startChar < 0 || endChar < 0 || startChar >= endChar || endChar > totalChars + 1) return;

      const segs = [];
      for (const tn of textNodes) {
        const overlapStart = Math.max(tn.startChar, startChar);
        const overlapEnd = Math.min(tn.endChar, endChar);
        if (overlapStart < overlapEnd) {
          // Fatia só de espaço/quebra entre blocos → não embrulha (ver
          // comentário em _applyHighlightsToPage; mesmo bug, mesma regra).
          if (!tn.node.textContent.slice(overlapStart - tn.startChar, overlapEnd - tn.startChar).trim()) continue;
          segs.push({
            node: tn.node,
            offsetStart: overlapStart - tn.startChar,
            offsetEnd: overlapEnd - tn.startChar,
          });
        }
      }

      if (segs.length === 0) return;

      // Wrap each segment individually (reverse order to preserve offsets)
      let isFirst = true;
      for (let i = segs.length - 1; i >= 0; i--) {
        const seg = segs[i];
        try {
          const r = document.createRange();
          r.setStart(seg.node, seg.offsetStart);
          r.setEnd(seg.node, seg.offsetEnd);
          const mark = _createMarkEl(h);
          if (isFirst) {
            isFirst = false;
          } else {
            // Secondary marks: use group attr instead of id to avoid
            // duplicate data-highlight-id in the DOM
            delete mark.dataset.highlightId;
            mark.dataset.highlightGroup = h.id;
          }
          r.surroundContents(mark);
        } catch (e) {
          _applyWithSplit(seg.node, seg.offsetStart, seg.offsetEnd, h);
        }
      }
    });
  }

  function _createMarkEl(highlight) {
    const mark = document.createElement('mark');
    mark.className = `user-highlight highlight-${highlight.color}`;
    mark.dataset.highlightId = highlight.id;
    if (highlight.comment) mark.title = highlight.comment;
    mark.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const h = _highlights.find(x => x.id === highlight.id);
      if (h) _showCommentPopup(h, mark);
    });
    return mark;
  }

  function _applyWithSplit(textNode, startOffset, endOffset, highlight) {
    try {
      const parent = textNode.parentNode;
      if (!parent) return;

      const after = textNode.splitText(endOffset);
      const target = textNode.splitText(startOffset);

      const mark = _createMarkEl(highlight);
      parent.insertBefore(mark, after);
      mark.appendChild(target);
      parent.normalize();
    } catch (e) {}
  }

  function _refreshPageHighlights() {
    _unwrapMarks();
    _applyHighlightsToPage();
  }

  function _updateHighlightBadge() {
    const { volId, filename } = _getParams();
    const count = _highlights.filter(h => h.vol === volId && h.file === filename).length;
    const badge = document.querySelector('.highlight-badge');
    if (badge) {
      badge.textContent = count > 0 ? count : '';
      badge.classList.toggle('visible', count > 0);
    }
    const btn = document.getElementById('highlightBtn');
    if (btn) btn.classList.toggle('active', count > 0);
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  // Lê a seleção nativa atual, valida (≥2 chars, dentro de um tópico) e preenche
  // _currentSelection. Retorna o range (p/ posicionar o tooltip no desktop) ou
  // null se não houver seleção aproveitável. Compartilhado entre o gatilho de
  // desktop (_handleSelection) e o de mobile (selectionchange).
  function _captureSelectionFromDOM() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString().trim();
    if (text.length < 2) return null;

    const range = sel.getRangeAt(0);
    const topicId = _getTopicIdFromNode(range.startContainer);
    if (!topicId) return null;

    const topicEl = document.getElementById(topicId);
    const topicIndex = topicId.startsWith('topic-')
      ? parseInt(topicId.replace('topic-', ''), 10)
      : -1;
    let topicTitle = '';
    if (topicIndex >= 0 && window._currentTopics && window._currentTopics[topicIndex]) {
      const lang = _lang();
      topicTitle = (lang === 'pt'
        ? (window._currentTopics[topicIndex].title_ptbr || window._currentTopics[topicIndex].title_pt || window._currentTopics[topicIndex].title || '')
        : (window._currentTopics[topicIndex].title_ja || window._currentTopics[topicIndex].title || '')
      ).replace(/<[^>]+>/g, '').trim();
    } else if (topicEl) {
      // Disciples mode: pull title from the section's heading
      const heading = topicEl.querySelector('h1, h2, h3, h4, h5, h6, .disciples-section-title');
      topicTitle = (heading?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    }

    const { startChar, endChar } = _getCharOffsetsFromSelection(range, topicEl);
    _currentSelection = { topicId, topicIndex, topicTitle, text, startChar, endChar };
    return range;
  }

  // Mostra a barra mobile e DISPENSA a seleção nativa. No Android, manter a
  // seleção viva faz o OS desenhar sua própria janela (Copiar/Compartilhar/
  // Buscar) sobre o texto. Como já guardamos tudo em _currentSelection (e
  // _saveSelection não relê window.getSelection), limpar a seleção derruba a
  // janela do sistema e deixa só a nossa barra. _justCaptured ignora o evento
  // fantasma (mouseup sintético / selectionchange) gerado pela própria limpeza.
  function _showMobileBarAndClear() {
    _showMobileBar();
    _dbg('  ↳ _showMobileBar() + removeAllRanges()');
    _justCaptured = true;
    const live = window.getSelection();
    if (live) live.removeAllRanges();
    setTimeout(() => { _justCaptured = false; }, 350);
  }

  // Gatilho de seleção no MOBILE. O Android consome o long-press e NÃO entrega
  // touchend/mouseup pro nosso handler (confirmado on-device via ?hldebug=1) —
  // só dispara selectionchange. Debounce no "settle" pra não capturar/limpar no
  // meio do gesto: o usuário faz long-press numa palavra, PAUSA, e arrasta a
  // alça pra estender. Um settle curto dispararia na pausa e arrancaria a
  // seleção. 800ms tolera a pausa típica; ajustável conforme teste on-device.
  const _SEL_SETTLE_MS = 800;
  let _selSettleTimer = null;
  function _onMobileSelectionSettle() {
    if (_tapMode) return; // no modo grifar a seleção nativa fica desligada
    clearTimeout(_selSettleTimer);
    _selSettleTimer = setTimeout(() => {
      if (_justCaptured) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return; // ignora o selectionchange da limpeza
      const range = _captureSelectionFromDOM();
      if (!range) return;
      _dbg(`  ↳ [selchange settle] captura OK len=${_currentSelection.text.length}`);

      // Título segue o fluxo NORMAL de grifo (mudou 12/06: usuários grifam o
      // título de propósito como marca pessoal; o card "Salvar?" que existia
      // aqui virou estorvo — quem quer registrar leitura tem o botão Lido).
      _showMobileBarAndClear();
    }, _SEL_SETTLE_MS);
  }

  function _handleSelection(e) {
    if (_tapMode) return; // no modo grifar a seleção nativa fica desligada
    const clickedInsideTooltip = e && e.target && e.target.closest('.highlight-tooltip');
    const clickedInsidePopup = e && e.target && e.target.closest('.highlight-comment-popup');
    const clickedOnHighlight = e && e.target && e.target.closest('mark.user-highlight');
    const clickedInsideMobileBar = e && e.target && e.target.closest('.highlight-mobile-bar');
    if (clickedInsideTooltip || clickedInsidePopup || clickedOnHighlight || clickedInsideMobileBar) return;

    setTimeout(() => {
      _dbg(`_handleSelection fire (${e ? e.type : '?'}) justCap=${_justCaptured}`);
      // Ignora o mouseup sintético que o Android dispara após o touchend
      // (já capturamos e limpamos a seleção — ver _isMobile abaixo).
      if (_justCaptured) { _dbg('  ↳ skip: _justCaptured'); return; }

      const tooltip = document.getElementById('highlightTooltip');
      if (tooltip && tooltip.contains(document.activeElement)) return;

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        _dbg('  ↳ exit: seleção vazia/colapsada');
        if (_tooltipEl) _hideTooltip();
        if (_mobileBarEl) _hideMobileBar();
        return;
      }

      const range = _captureSelectionFromDOM();
      if (!range) {
        if (_tooltipEl) _hideTooltip();
        if (_mobileBarEl) _hideMobileBar();
        return;
      }

      _dbg(`  ↳ captura OK (isMobile=${_isMobile}, len=${_currentSelection.text.length})`);

      // Título segue o fluxo NORMAL de grifo (mudou 12/06 — ver nota no
      // _onMobileSelectionSettle).

      // No MOBILE não interceptamos mais a seleção nativa (arrastar/long-press):
      // ela briga com o menu do sistema operacional (Copiar/Buscar/Ask). Deixa
      // a seleção 100% com o SO — grifar no mobile é só pelo "modo grifar"
      // (botão no header → toca na frase). Ver _setTapMode / _handleTapModeClick.
      // No DESKTOP a seleção continua abrindo o tooltip de grifo.
      if (_isMobile) {
        return;
      } else {
        _showTooltip(range);
      }
    }, 10);
  }

  function _handleClick(e) {
    const tooltip = document.getElementById('highlightTooltip');
    const popup = document.querySelector('.highlight-comment-popup');

    if (tooltip && !tooltip.contains(e.target)) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        _hideTooltip();
      }
    }

    if (popup && !popup.contains(e.target) && !e.target.classList.contains('user-highlight')) {
      _hideCommentPopup();
    }
  }

  // ============================================================
  // MODO GRIFAR (tap-to-highlight) — opt-in pelo ícone do header
  // ------------------------------------------------------------
  // Alternativa ao long-press: o usuário ativa o modo, TOCA numa frase e ela
  // entra em preview; vai tocando em quantas quiser e só então confirma em
  // "Adicionar". Resolve os 2 atritos do mobile: (1) não precisa arrastar as
  // alças de seleção; (2) um toque curto NÃO dispara o menu nativo do OS
  // (só o long-press dispara), e enquanto o modo está ativo desligamos a
  // seleção nativa (user-select:none) — então a janela do sistema some.
  //
  // Reaproveita toda a infra de offset-por-caractere (_collectTextNodes) e o
  // salvamento na nuvem já existentes. A ÚNICA peça frágil (e só testável
  // on-device) é "qual frase foi tocada", isolada em _tapRange — se a
  // detecção de frase falhar no aparelho, trocar _TAP_GRANULARITY p/ 'paragraph'
  // resolve sem mexer no resto.
  // ============================================================

  let _tapMode = false;
  let _pendingTaps = [];        // [{ topicId, startChar, endChar, text }]
  let _tapBarEl = null;

  // Granularidade do toque. 'sentence' = frase (padrão); 'paragraph' = bloco
  // inteiro (reserva à prova de bala — não depende de detectar pontuação nem
  // do caretRangeFromPoint). Único ajuste necessário pra trocar o comportamento.
  const _TAP_GRANULARITY = 'sentence';

  // Terminadores de frase: PT (. ! ? …) + JA (。！？). Aspas/parênteses de
  // fechamento logo após o ponto entram na mesma frase.
  const _SENT_END = '.!?…。！？';
  const _CLOSERS = '"\'”’»)]';

  function _topicFullText(textNodes) {
    let s = '';
    for (const tn of textNodes) s += tn.node.textContent;
    return s;
  }

  // Nó de texto sob o ponto (x,y) — null se a API de caret não existir.
  function _caretNodeFromPoint(x, y) {
    if (document.caretRangeFromPoint) {            // WebKit/Blink (iOS, Android Chrome)
      const r = document.caretRangeFromPoint(x, y);
      return r ? r.startContainer : null;
    }
    if (document.caretPositionFromPoint) {         // padrão (Firefox)
      const p = document.caretPositionFromPoint(x, y);
      return p ? p.offsetNode : null;
    }
    return null;
  }

  // node+offset → offset global de caractere dentro do tópico.
  function _caretGlobalOffset(topicEl, x, y) {
    let node = null, offset = 0;
    if (document.caretRangeFromPoint) {            // WebKit/Blink (iOS, Android Chrome)
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    } else if (document.caretPositionFromPoint) {  // padrão (Firefox)
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    }
    if (!node) return -1;
    // Se o caret caiu num elemento (entre nós), desce pro primeiro texto.
    if (node.nodeType !== Node.TEXT_NODE) {
      const start = node.childNodes[offset] || node.childNodes[offset - 1] || node;
      const w = document.createTreeWalker(start, NodeFilter.SHOW_TEXT, null);
      const t = w.nextNode();
      if (!t) return -1;
      node = t; offset = 0;
    }
    const textNodes = _collectTextNodes(topicEl);
    for (const tn of textNodes) {
      if (tn.node === node) return tn.startChar + offset;
    }
    return -1;
  }

  // Limites da frase que contém `pos` no texto completo do tópico.
  function _sentenceBounds(fullText, pos) {
    const n = fullText.length;
    if (pos < 0) pos = 0;
    if (pos > n) pos = n;

    let start = 0;
    for (let i = Math.min(pos, n); i > 0; i--) {
      if (_SENT_END.indexOf(fullText[i - 1]) !== -1) { start = i; break; }
    }
    // pula fechamentos/espaço no começo
    while (start < n && (_CLOSERS.indexOf(fullText[start]) !== -1 || /\s/.test(fullText[start]))) start++;

    let end = n;
    for (let i = pos; i < n; i++) {
      if (_SENT_END.indexOf(fullText[i]) !== -1) {
        end = i + 1;
        while (end < n && _CLOSERS.indexOf(fullText[end]) !== -1) end++;
        break;
      }
    }
    return { start, end };
  }

  // Limites do bloco (parágrafo/item) que contém o nó tocado.
  function _blockBounds(topicEl, node) {
    let el = node && node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    const block = el && el.closest
      ? el.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6, pre')
      : null;
    const target = (block && topicEl.contains(block)) ? block : topicEl;
    const textNodes = _collectTextNodes(topicEl);
    let start = -1, end = -1;
    for (const tn of textNodes) {
      if (target.contains(tn.node)) {
        if (start < 0) start = tn.startChar;
        end = tn.endChar;
      }
    }
    return { start, end };
  }

  function _finishRange(fullText, start, end) {
    while (start < end && /\s/.test(fullText[start])) start++;
    while (end > start && /\s/.test(fullText[end - 1])) end--;
    if (end - start < 2) return null;
    return { startChar: start, endChar: end, text: fullText.slice(start, end) };
  }

  // Range do TÍTULO do tópico — só o <b> do cabeçalho, SEM a linha de data
  // "(Publicado em ...)" (pedido de usuário). Usado pelo modo grifar quando o
  // toque cai no cabeçalho: um toque seleciona o título completo, como
  // _tapRange faz com frases. Reserva: sem <b> antes da save-bar, cai no
  // cabeçalho inteiro (tudo antes da .topic-save-bar).
  function _titleRange(topicEl) {
    const saveBar = topicEl.querySelector('.topic-save-bar');
    if (!saveBar) return null;
    const textNodes = _collectTextNodes(topicEl);
    if (!textNodes.length) return null;
    const fullText = _topicFullText(textNodes);
    const bold = topicEl.querySelector('b');
    const titleEl = (bold && (saveBar.compareDocumentPosition(bold) & Node.DOCUMENT_POSITION_PRECEDING))
      ? bold : null;
    let start = -1, end = -1;
    for (const tn of textNodes) {
      if (titleEl) {
        if (titleEl.contains(tn.node)) { if (start < 0) start = tn.startChar; end = tn.endChar; }
        else if (start >= 0) break;   // já passou do título (nós são em ordem)
      } else {
        // textNodes vem em ordem de documento: para no primeiro nó que não
        // precede a save-bar (os de dentro dela são "contained", não preceding).
        if (saveBar.compareDocumentPosition(tn.node) & Node.DOCUMENT_POSITION_PRECEDING) {
          if (start < 0) start = tn.startChar;
          end = tn.endChar;
        } else break;
      }
    }
    if (start < 0 || end <= start) return null;
    return _finishRange(fullText, start, end);
  }

  // Primeiro caractere do CORPO do tópico: depois do cabeçalho (título/data),
  // da .topic-save-bar e do CTA de citação parcial. Necessário porque muitos
  // corpos são formatados só com <br> (sem <p> — _normalizeContent converte
  // parágrafos em <br>): aí não existe fronteira de bloco e a "frase" da 1ª
  // linha recuaria até o char 0, selecionando o título junto.
  function _bodyStartChar(topicEl, textNodes) {
    const saveBar = topicEl.querySelector('.topic-save-bar');
    if (!saveBar) return 0;
    let start = 0;
    for (const tn of textNodes) {
      const el = tn.node.parentNode;
      const inHeaderZone =
        (saveBar.compareDocumentPosition(tn.node) & Node.DOCUMENT_POSITION_PRECEDING) ||
        saveBar.contains(tn.node) ||
        !!(el && el.closest && el.closest('.topic-partial-cta'));
      if (inHeaderZone) { start = tn.endChar; }
      else break;                  // nós vêm em ordem: achou o corpo, para
    }
    return start;
  }

  // Resolve o que o toque (x,y / nó) deve grifar → {startChar,endChar,text}.
  function _tapRange(topicEl, x, y, node) {
    const textNodes = _collectTextNodes(topicEl);
    if (!textNodes.length) return null;
    const fullText = _topicFullText(textNodes);
    const bodyStart = _bodyStartChar(topicEl, textNodes);

    if (_TAP_GRANULARITY === 'paragraph') {
      const b = _blockBounds(topicEl, node);
      return b.start < 0 ? null : _finishRange(fullText, Math.max(b.start, bodyStart), b.end);
    }

    const off = _caretGlobalOffset(topicEl, x, y);
    if (off < 0) {
      // Reserva: caret indisponível → grifa o bloco tocado.
      const b = _blockBounds(topicEl, node);
      return b.start < 0 ? null : _finishRange(fullText, Math.max(b.start, bodyStart), b.end);
    }
    const s = _sentenceBounds(fullText, off);
    // Clampa a frase ao bloco (<p>/li/...) tocado E ao início do corpo: o
    // cabeçalho não tem pontuação, então a 1ª frase recuaria até o char 0 e
    // englobaria título + data + rótulos da save-bar (e aí o grifo de título
    // e o da 1ª frase se sobreporiam, um toggle derrubando o outro). O clamp
    // de bloco sozinho NÃO basta: corpo só-<br> não tem bloco (vira o tópico
    // inteiro) — daí o bodyStart.
    const b = _blockBounds(topicEl, node);
    let cs = b.start >= 0 ? Math.max(s.start, b.start) : s.start;
    const ce = b.end >= 0 ? Math.min(s.end, b.end) : s.end;
    cs = Math.max(cs, bodyStart);
    return _finishRange(fullText, cs, ce);
  }

  function _resolveTopicTitle(topicId, topicEl, topicIndex) {
    let topicTitle = '';
    if (topicIndex >= 0 && window._currentTopics && window._currentTopics[topicIndex]) {
      const lang = _lang();
      topicTitle = (lang === 'pt'
        ? (window._currentTopics[topicIndex].title_ptbr || window._currentTopics[topicIndex].title_pt || window._currentTopics[topicIndex].title || '')
        : (window._currentTopics[topicIndex].title_ja || window._currentTopics[topicIndex].title || '')
      ).replace(/<[^>]+>/g, '').trim();
    } else if (topicEl) {
      const heading = topicEl.querySelector('h1, h2, h3, h4, h5, h6, .disciples-section-title');
      topicTitle = (heading?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    return topicTitle;
  }

  // Marca pendente ⇄ desmarca (toque sobre uma frase já pendente a remove).
  function _togglePending(topicId, range) {
    const idx = _pendingTaps.findIndex(p => p.topicId === topicId &&
      !(range.endChar <= p.startChar || range.startChar >= p.endChar));
    if (idx >= 0) {
      _pendingTaps.splice(idx, 1);
    } else {
      _pendingTaps.push({ topicId, startChar: range.startChar, endChar: range.endChar, text: range.text });
    }
  }

  function _clearPendingPreview() {
    document.querySelectorAll('mark.hl-pending').forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
  }

  // Envolve os trechos pendentes de UM tópico em <mark.hl-pending> (preview).
  // Achata todos os segmentos e processa da direita p/ esquerda pra não
  // invalidar offsets quando dois trechos caem no mesmo nó de texto.
  function _wrapPendingMarks(topicEl, ranges) {
    const textNodes = _collectTextNodes(topicEl);
    if (!textNodes.length) return;
    const totalChars = textNodes[textNodes.length - 1].endChar;

    const segs = [];
    ranges.forEach(rg => {
      if (rg.startChar < 0 || rg.endChar <= rg.startChar || rg.endChar > totalChars + 1) return;
      for (const tn of textNodes) {
        const os = Math.max(tn.startChar, rg.startChar);
        const oe = Math.min(tn.endChar, rg.endChar);
        if (os < oe) segs.push({ node: tn.node, s: os - tn.startChar, e: oe - tn.startChar, g: os });
      }
    });
    segs.sort((a, b) => b.g - a.g);
    for (const seg of segs) {
      try {
        const r = document.createRange();
        r.setStart(seg.node, seg.s);
        r.setEnd(seg.node, seg.e);
        const mark = document.createElement('mark');
        mark.className = `hl-pending highlight-${_selectedColor}`;
        r.surroundContents(mark);
      } catch (_) { /* noop */ }
    }
  }

  function _renderPendingPreview() {
    _clearPendingPreview();
    const byTopic = {};
    _pendingTaps.forEach(p => { (byTopic[p.topicId] = byTopic[p.topicId] || []).push(p); });
    for (const topicId in byTopic) {
      const topicEl = document.getElementById(topicId);
      if (topicEl) _wrapPendingMarks(topicEl, byTopic[topicId]);
    }
  }

  function _confirmPending() {
    if (!_pendingTaps.length) return;
    if (!window._cloudSync) {
      alert('Você precisa estar online para criar destaques.');
      return;
    }
    // Cada frase tocada vira um destaque SEPARADO (não fundimos contíguas) —
    // assim o usuário apaga frase a frase. Fundir num só fazia "apagar uma
    // frase" remover o trecho inteiro.
    const items = _pendingTaps.slice();
    const { volId, filename } = _getParams();
    _clearPendingPreview();

    items.forEach(p => {
      const topicEl = document.getElementById(p.topicId);
      const topicIndex = p.topicId.startsWith('topic-')
        ? parseInt(p.topicId.replace('topic-', ''), 10)
        : -1;
      const topicTitle = _resolveTopicTitle(p.topicId, topicEl, topicIndex);
      const highlight = {
        id: 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        vol: volId,
        file: filename,
        topicId: p.topicId,
        topicIndex: topicIndex,
        topicTitle: topicTitle,
        color: _selectedColor,
        comment: '',
        text: p.text,
        startChar: p.startChar,
        endChar: p.endChar,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      _highlights.unshift(highlight);
      window._cloudSync.saveHighlight(
        highlight.vol, highlight.file, highlight.topicId, highlight.topicIndex,
        highlight.topicTitle, highlight.color, highlight.comment, highlight.text,
        highlight.startChar, highlight.endChar
      );
      if (topicEl) _applyHighlightsToTopic(topicEl, [highlight]);
    });

    _saveHighlights();
    const n = items.length;
    _pendingTaps = [];
    _hideTapBar();
    _updateHighlightBadge();
    const lang = _lang();
    _showHlToast(lang === 'ja'
      ? 'ハイライトを追加しました'
      : (n === 1 ? 'Destaque adicionado' : `${n} destaques adicionados`));
  }

  function _showTapBar() {
    const lang = _lang();
    if (!_tapBarEl) {
      const addLabel = lang === 'ja' ? '追加' : 'Adicionar';
      const clearLabel = lang === 'ja' ? 'クリア' : 'Limpar';
      const hint = lang === 'ja' ? '文をタップしてハイライト' : 'Toque nas frases para grifar';

      _tapBarEl = document.createElement('div');
      _tapBarEl.className = 'highlight-taps-bar';
      _tapBarEl.id = 'highlightTapsBar';
      const colorBtnsHTML = COLORS.map(c =>
        `<button class="highlight-color-btn color-${c}" data-color="${c}"></button>`
      ).join('');
      _tapBarEl.innerHTML =
        `<div class="highlight-mobile-bar-content">` +
          `<div class="highlight-taps-hint">${hint}</div>` +
          `<div class="highlight-colors">${colorBtnsHTML}</div>` +
          `<div class="highlight-mobile-bar-actions">` +
            `<button class="highlight-cancel-btn" id="hlTapsClearBtn">${clearLabel}</button>` +
            `<button class="highlight-save-btn" id="hlTapsAddBtn">${addLabel} (<span id="hlTapsCount">0</span>)</button>` +
          `</div>` +
        `</div>`;
      document.body.appendChild(_tapBarEl);

      _tapBarEl.querySelectorAll('.highlight-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          _tapBarEl.querySelectorAll('.highlight-color-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          _selectedColor = btn.dataset.color;
          _renderPendingPreview();
        });
      });
      const activeC = _tapBarEl.querySelector(`.highlight-color-btn.color-${_selectedColor}`)
        || _tapBarEl.querySelector('.highlight-color-btn');
      if (activeC) { activeC.classList.add('selected'); _selectedColor = activeC.dataset.color; }

      document.getElementById('hlTapsClearBtn').addEventListener('click', () => {
        _pendingTaps = [];
        _clearPendingPreview();
        _hideTapBar();
      });
      document.getElementById('hlTapsAddBtn').addEventListener('click', _confirmPending);
    }
    _updateTapBarCount();
  }

  function _updateTapBarCount() {
    const el = document.getElementById('hlTapsCount');
    if (el) el.textContent = String(_pendingTaps.length);
  }

  function _hideTapBar() {
    if (_tapBarEl) { _tapBarEl.remove(); _tapBarEl = null; }
  }

  function _setTapMode(on) {
    _tapMode = !!on;
    document.body.classList.toggle('hl-tap-mode', _tapMode);
    const btn = document.getElementById('hlTapModeBtn');
    if (btn) btn.classList.toggle('active', _tapMode);

    if (_tapMode) {
      // Derruba qualquer UI de seleção nativa e limpa a seleção.
      _hideTooltip();
      _hideMobileBar();
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      const lang = _lang();
      _showHlToast(lang === 'ja' ? '文をタップしてハイライト' : 'Toque nas frases para grifar');
    } else {
      _pendingTaps = [];
      _clearPendingPreview();
      _hideTapBar();
    }
  }

  function _handleTapModeClick(e) {
    if (!_tapMode) return;
    // Toques na própria barra/botão e em elementos interativos (Salvar, links,
    // CTAs) seguem o fluxo normal — não os engolimos como "grifar".
    if (e.target.closest('.highlight-taps-bar') || e.target.closest('#hlTapModeBtn')) return;
    if (e.target.closest('button, a, .topic-save-bar')) return;

    const topicId = _getTopicIdFromNode(e.target);
    if (!topicId) return;                 // tocou fora do conteúdo
    const topicEl = document.getElementById(topicId);
    if (!topicEl) return;

    e.preventDefault();
    e.stopPropagation();

    // Alvo REAL do toque: em corpos só-<br> (sem <p>) os nós de texto são
    // filhos diretos da div do tópico, então e.target = a PRÓPRIA div — tanto
    // no título quanto no corpo (e a div "precede" a save-bar por ser
    // ancestral ⇒ TODO toque viraria título). Resolve pelo caret qual texto
    // está sob o dedo antes de decidir.
    let hitNode = e.target;
    if (hitNode === topicEl) {
      const cn = _caretNodeFromPoint(e.clientX, e.clientY);
      if (cn && topicEl.contains(cn) && cn !== topicEl) hitNode = cn;
    }

    // Tocou no título → seleciona o TÍTULO pra grifar, em um toque só
    // (pedido de usuário; antes abria o card de salvar, que aqui no modo
    // grifar atrapalhava — fora do modo grifar o card continua).
    const titleHit = _nodeTitleHit(hitNode);
    if (titleHit) {
      const trange = _titleRange(topicEl);
      if (trange) {
        _dbg(`tap título: [${trange.startChar},${trange.endChar}] "${trange.text.slice(0, 24)}"`);
        _togglePending(topicId, trange);
        _renderPendingPreview();
        if (_pendingTaps.length) _showTapBar(); else _hideTapBar();
      }
      return;
    }

    const range = _tapRange(topicEl, e.clientX, e.clientY, e.target);
    if (!range) { _dbg('tap: sem range'); return; }
    _dbg(`tap: [${range.startChar},${range.endChar}] "${range.text.slice(0, 24)}"`);

    _togglePending(topicId, range);
    _renderPendingPreview();
    if (_pendingTaps.length) _showTapBar(); else _hideTapBar();
  }

  // Injeta o botão de "modo grifar" no header do leitor. Fica AQUI (não no
  // nav.js) de propósito: nav.js é compartilhado por 16 páginas e mexer nele
  // espalha o cache-bump; este botão só importa no reader.html.
  function _injectTapModeBtn() {
    if (!window.location.pathname.includes('reader.html')) return true;
    const actions = document.querySelector('.header__actions');
    if (!actions) return false;           // header ainda não montado

    // Remove o antigo botão "Destaques" (lápis) do header — pedido do usuário:
    // dois ícones de caneta lado a lado confundiam. A lista de destaques segue
    // acessível pelo menu lateral ("Central de Destaques"). Criado no nav.js;
    // removido aqui pra manter o cache-bump só no reader.html (ver nota no
    // _injectTapModeBtn original sobre não mexer no nav.js).
    const oldHlBtn = document.getElementById('mobileHighlightBtn');
    if (oldHlBtn) oldHlBtn.remove();

    if (document.getElementById('hlTapModeBtn')) return true;

    const isComparison = localStorage.getItem('reader_comparison') === 'true';
    const btn = document.createElement('button');
    btn.id = 'hlTapModeBtn';
    btn.className = 'mobile-fav-btn hl-tapmode-btn';
    btn.setAttribute('aria-label', 'Modo grifar');
    btn.setAttribute('title', 'Modo grifar — toque para destacar');
    btn.style.display = isComparison ? 'none' : 'flex';
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m9 11-6 6v3h9l3-3"/>
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
    </svg>`;
    btn.addEventListener('click', () => _setTapMode(!_tapMode));

    // Posiciona onde ficava o lápis de Destaques: antes da busca (fallback: o
    // hambúrguer). Não ancorar no #mobileHighlightBtn — ele acabou de ser removido.
    const ref = actions.querySelector('button[aria-label="Buscar"]')
      || actions.querySelector('.mobile-menu-btn');
    if (ref) actions.insertBefore(btn, ref); else actions.appendChild(btn);
    return true;
  }

  // ============================================================
  // DETECÇÃO DE TÍTULO (cabeçalho do tópico)
  // ------------------------------------------------------------
  // Usada pelo MODO GRIFAR: toque no cabeçalho seleciona o título inteiro
  // via _titleRange. [Histórico: até 12/06 a seleção no título abria um card
  // "Salvar este Ensinamento?" — removido; usuários grifam o título de
  // propósito como marca pessoal, e o registro de leitura agora é o botão
  // "Marcar como lido".] Só leitor normal (ids topic-N).
  // ============================================================

  function _nodeTitleHit(node) {
    if (!node) return null;
    const topicId = _getTopicIdFromNode(node);
    if (!topicId || !/^topic-\d+$/.test(topicId)) return null;
    const topicEl = document.getElementById(topicId);
    const saveBar = topicEl && topicEl.querySelector('.topic-save-bar');
    if (!saveBar) return null;
    // node ANTES da save-bar (em ordem de documento) = está no cabeçalho/título
    const pos = saveBar.compareDocumentPosition(node);
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
      return { topicId, topicIdx: parseInt(topicId.replace('topic-', ''), 10) };
    }
    return null;
  }

  // ============================================================
  // Public API
  // ============================================================

  window.openHighlights = function () {
    const onReader = window.location.pathname.includes('reader.html');
    if (!onReader) {
        const isVolDir = window.location.pathname.includes('/mioshiec');
        window.location.href = (isVolDir ? '../' : '') + 'destaques.html';
        return;
    }

    const { volId, filename } = _getParams();
    _loadHighlights();
    const pageHighlights = _highlights.filter(h => h.vol === volId && h.file === filename);

    const lang = _lang();
    const noHighlights = lang === 'ja' ? 'ハイライトはまだありません。' : 'Nenhum destaque ainda.';

    const titleEl = document.getElementById('highlightsModalTitle');
    if (titleEl) {
      // Em obra de discípulo, mostra o nome do livro no título do modal.
      const isDisc = _isDisciplesMode();
      const activeBook = isDisc ? (window._disciplesActiveBook || null) : null;
      if (activeBook) {
        const bookTitle = lang === 'ja'
          ? (activeBook.titleJa || activeBook.title)
          : activeBook.title;
        titleEl.textContent = lang === 'ja'
          ? `${bookTitle} のハイライト`
          : `Destaques em ${bookTitle}`;
      } else {
        titleEl.textContent = lang === 'ja' ? 'この教えのハイライト' : 'Destaques deste Ensinamento';
      }
    }

    const resultsEl = document.getElementById('highlightsResults');
    if (!resultsEl) return;

    if (pageHighlights.length === 0) {
      resultsEl.innerHTML = `<li style="padding: 24px 16px; text-align: center; color: var(--text-muted);">${noHighlights}</li>`;
    } else {
      const renderItem = (h, showMetaTitle) => {
        const bgColor = COLOR_MAP[h.color] || '#fff3a1';
        const date = new Date(h.createdAt).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR');

        return `<li class="highlight-item" data-id="${h.id}" data-topic="${h.topicIndex}" data-topic-id="${_esc(h.topicId || '')}" data-vol="${_esc(h.vol || '')}" data-file="${_esc(h.file || '')}">
          <div class="highlight-item-text" style="border-left: 3px solid ${bgColor}; padding-left: 10px;">${_esc(h.text)}</div>
          ${h.comment ? `<div class="highlight-item-comment">${_esc(h.comment)}</div>` : ''}
          <div class="highlight-item-meta">${showMetaTitle ? _esc(h.topicTitle || '') + ' · ' : ''}${date}</div>
          <div class="highlight-item-actions">
            <button class="edit-highlight-btn" data-id="${h.id}">${lang === 'ja' ? '編集' : 'Editar'}</button>
            <button class="delete-highlight-btn" data-id="${h.id}">${lang === 'ja' ? '削除' : 'Apagar'}</button>
          </div>
        </li>`;
      };

      // Em obra de discípulos os highlights são agrupados por livro inteiro
      // (não por capítulo), então mostramos o título da seção em cada item
      // pra dar contexto de onde foi grifado.
      const showSectionContext = _isDisciplesMode();
      // Em livro de discípulos: rodapé com atalho pra Central já filtrada.
      const centralLink = showSectionContext && filename
        ? `<li style="padding:12px 16px; text-align:center; border-top:1px solid var(--border);">
             <a href="destaques.html?book=${encodeURIComponent(filename)}" style="color:var(--accent); text-decoration:none; font-size:0.85rem;">
               ${lang === 'ja' ? 'ハイライト一覧で見る →' : 'Ver na Central de Destaques →'}
             </a>
           </li>`
        : '';
      resultsEl.innerHTML = pageHighlights.map(h => renderItem(h, showSectionContext)).join('') + centralLink;

      resultsEl.querySelectorAll('.highlight-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.tagName === 'BUTTON') return;
          const topicIdx = item.dataset.topic;
          const topicIdRaw = item.dataset.topicId;
          const highlightId = item.dataset.id;
          if (topicIdx !== undefined) {
            const lookupId = (topicIdRaw && !/^topic-/.test(topicIdRaw))
              ? topicIdRaw
              : `topic-${topicIdx}`;
            const el = document.getElementById(lookupId);
            if (el) {
              closeHighlights();
              setTimeout(() => {
                const markEl = highlightId
                  ? document.querySelector(`mark.user-highlight[data-highlight-id="${highlightId}"]`)
                  : null;
                const scrollTarget = markEl || el;
                scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => {
                  const flashEl = markEl || el;
                  flashEl.style.transition = 'background-color 0.4s ease';
                  flashEl.style.backgroundColor = 'var(--accent-soft)';
                  setTimeout(() => { flashEl.style.backgroundColor = ''; }, 1800);
                }, 400);
              }, 350);
            } else {
              const hVol  = item.dataset.vol;
              const hFile = item.dataset.file;
              if (hVol && hFile) {
                const lang = _lang();
                let url;
                if (hVol === 'disciples') {
                  // Mesmo livro aberto, grifo noutro capítulo → navega POR
                  // DENTRO (troca de capítulo + scroll + flash), sem reload.
                  if (typeof window._disciplesGoToSection === 'function'
                      && window._disciplesActiveBook && window._disciplesActiveBook.id === hFile) {
                    closeHighlights();
                    if (window._disciplesGoToSection(topicIdRaw, highlightId)) return;
                  }
                  url = `reader.html?pub=disciples&book=${encodeURIComponent(hFile)}`;
                  if (topicIdRaw) url += `&sec=${encodeURIComponent(topicIdRaw)}`;
                  if (highlightId) url += `&highlight=${encodeURIComponent(highlightId)}`;
                } else {
                  url = `reader.html?vol=${encodeURIComponent(hVol)}&file=${encodeURIComponent(hFile)}`;
                  if (topicIdx !== undefined && topicIdx !== '') url += `&topic=${topicIdx}`;
                  if (highlightId) url += `&highlight=${encodeURIComponent(highlightId)}&hl_scroll=1`;
                }
                if (lang === 'ja') url += '&lang=ja';
                closeHighlights();
                window.location.href = url;
              }
            }
          }
        });
      });

      resultsEl.querySelectorAll('.edit-highlight-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const h = _highlights.find(x => x.id === id);
          if (h) _openEditDialog(h);
        });
      });

      resultsEl.querySelectorAll('.delete-highlight-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          _removeHighlight(btn.dataset.id);
          window.openHighlights();
        });
      });
    }

    const modal = document.getElementById('highlightsModal');
    if (modal) {
      modal.classList.add('active');
      if (typeof _trapFocus === 'function') _trapFocus(modal);
    }
  };

  window.closeHighlights = function () {
    const modal = document.getElementById('highlightsModal');
    if (modal) {
      modal.classList.remove('active');
      if (typeof _releaseFocus === 'function') _releaseFocus(modal);
    }
  };

  window.initHighlights = function () {
    _loadHighlights();

    _isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;

    if (_HL_DEBUG) {
      _dbg(`init: isMobile=${_isMobile} innerW=${window.innerWidth} UA=${(navigator.userAgent || '').slice(0, 60)}`);
      // Captura crua: registra CADA evento relevante, mesmo que _handleSelection
      // não rode, pra distinguir "evento não dispara" de "ramo não executa".
      ['touchstart', 'touchend', 'mouseup', 'contextmenu'].forEach(ev =>
        document.addEventListener(ev, () => _dbg(`evt:${ev}`), true));
      let _scTimer = null;
      document.addEventListener('selectionchange', () => {
        clearTimeout(_scTimer);
        _scTimer = setTimeout(() => _dbg('evt:selectionchange (settle)'), 150);
      }, true);
    }

    document.addEventListener('mouseup', _handleSelection);
    document.addEventListener('touchend', _handleSelection);
    document.addEventListener('click', _handleClick);

    // Modo grifar: intercepta o toque em fase de captura (antes dos handlers de
    // <mark> e do _handleClick) pra grifar a frase e barrar o clique normal.
    // Inerte enquanto _tapMode estiver desligado.
    document.addEventListener('click', _handleTapModeClick, true);

    // Botão "modo grifar" no header. O header é montado pelo nav.js também no
    // DOMContentLoaded, então pode ainda não existir — observa e injeta quando aparecer.
    if (!_injectTapModeBtn()) {
      const obs = new MutationObserver(() => { if (_injectTapModeBtn()) obs.disconnect(); });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 5000);
    }

    // Mobile: grifar por SELEÇÃO (arrastar/long-press) foi DESATIVADO — brigava
    // com o menu nativo do SO (Copiar/Buscar/Ask). No mobile a seleção fica 100%
    // com o sistema; grifar é exclusivamente pelo "modo grifar" (botão no header
    // → toca na frase). Por isso NÃO registramos mais o selectionchange aqui.
    // (Antes: if (_isMobile) document.addEventListener('selectionchange', _onMobileSelectionSettle);
    //  _onMobileSelectionSettle/_showMobileBarAndClear/_showMobileBar ficaram inertes.)

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (_tapMode) _setTapMode(false);
        _hideTooltip();
        _hideCommentPopup();
        _hideMobileBar();
      }
    });
  };

  window.applyHighlightsOnPage = function () {
    _applyHighlightsToPage();
    _updateHighlightBadge();
  };

  // Pinta TRECHOS RECOMENDADOS (que NÃO são destaques salvos do usuário) e
  // scrolla até o primeiro. Usado pelo reader quando a URL traz
  // &excerpt=s:e[,s:e...] (recomendação com trechos do admin — migration
  // v15). ranges = [[start,end],...]; aceita também (topicIdx, s, e) por
  // conveniência. Os marks usam ids sintéticos que não existem em
  // _highlights, então o clique não abre popup nem permite apagar; somem
  // naturalmente no próximo re-render.
  window.flashExcerptRange = function (topicIdx, ranges, maybeEnd) {
    if (typeof ranges === 'number' && typeof maybeEnd === 'number') ranges = [[ranges, maybeEnd]];
    if (!Array.isArray(ranges) || !ranges.length) return false;
    const topicEl = document.getElementById(`topic-${topicIdx}`);
    if (!topicEl) return false;
    if (!document.querySelector('mark[data-highlight-id="rec-excerpt-0"]')) {
      _applyHighlightsToTopic(topicEl, ranges.map((p, i) => ({
        id: `rec-excerpt-${i}`,
        color: 'yellow',
        startChar: Number(p[0]),
        endChar: Number(p[1]),
        comment: ''
      })));
    }
    const first = document.querySelector('mark[data-highlight-id="rec-excerpt-0"]');
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    return false;
  };

  window.getHighlightsForPage = function () {
    const { volId, filename } = _getParams();
    return _highlights.filter(h => h.vol === volId && h.file === filename);
  };

  window._HighlightsApi = {
      getAll: () => {
          _loadHighlights();
          return [..._highlights];
      },
      delete: (id) => {
          _removeHighlight(id);
      },
      edit: (id) => {
          const h = _highlights.find(x => x.id === id);
          if (h) _openEditDialog(h);
      }
  };
})();
