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

      const ranges = _buildHighlightRanges(topicEl, byTopic[topicId]);

      ranges.forEach(({ range, highlight }) => {
        const colorClass = `highlight-${highlight.color}`;
        const existing = document.querySelector(`mark.user-highlight[data-highlight-id="${highlight.id}"]`);
        if (existing) {
          existing.remove();
        }

        const mark = document.createElement('mark');
        mark.className = `user-highlight ${colorClass}`;
        mark.dataset.highlightId = highlight.id;
        if (highlight.comment) mark.title = highlight.comment;

        try {
          range.surroundContents(mark);
          mark.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            _showCommentPopup(highlight, mark);
          });
        } catch (e) {
          // Cross-node selections: split text nodes and wrap each segment
          const startNode = range.startContainer;
          const endNode = range.endContainer;
          if (startNode === endNode) {
            _applyWithSplit(startNode, range.startOffset, range.endOffset, highlight);
          } else {
            // Multi-node: wrap each node's portion individually
            const startMark = mark.cloneNode(true);
            const endMark = mark.cloneNode(true);
            try {
              const startRange = new Range();
              startRange.setStart(startNode, range.startOffset);
              startRange.setEnd(startNode, startNode.textContent.length);
              startRange.surroundContents(startMark);
              startMark.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                _showCommentPopup(highlight, startMark);
              });
            } catch (e2) {}
            try {
              const endRange = new Range();
              endRange.setStart(endNode, 0);
              endRange.setEnd(endNode, range.endOffset);
              endRange.surroundContents(endMark);
              endMark.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                _showCommentPopup(highlight, endMark);
              });
            } catch (e2) {}
            // Middle nodes: wrap entirely
            try {
              const middleRange = new Range();
              middleRange.setStartAfter(startNode);
              middleRange.setEndBefore(endNode);
              if (middleRange.toString().trim()) {
                const midMark = mark.cloneNode(true);
                middleRange.surroundContents(midMark);
                midMark.addEventListener('click', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  _showCommentPopup(highlight, midMark);
                });
              }
            } catch (e2) {}
          }
        }
      });
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

    _highlights.unshift(highlight);
    _saveHighlights();

    if (window._cloudSync) {
      window._cloudSync.saveHighlight(
        highlight.vol, highlight.file, highlight.topicId, highlight.topicIndex,
        highlight.topicTitle, highlight.color, highlight.comment, highlight.text,
        highlight.startChar, highlight.endChar
      );
    } else if (window._syncQueue) {
      window._syncQueue.queueSaveHighlight({
        volume: highlight.vol, file: highlight.file,
        topicId: highlight.topicId, topicIndex: highlight.topicIndex,
        topicTitle: highlight.topicTitle, color: highlight.color,
        comment: highlight.comment, text: highlight.text,
        startChar: highlight.startChar, endChar: highlight.endChar,
      });
    }

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
    const h = _highlights.find(x => x.id === id);
    _highlights = _highlights.filter(x => x.id !== id);
    _saveHighlights();

    if (h) {
      const key = `${h.vol}:${h.file}:${h.topicId}:${h.startChar}:${h.endChar}`;
      _addDeletedTombstone(key);

      const queueFallback = () => {
        if (window._syncQueue) {
          window._syncQueue.queueRemoveHighlight({
            volume: h.vol, file: h.file, topicId: h.topicId,
            startChar: h.startChar, endChar: h.endChar,
          });
        }
      };

      if (window._cloudSync) {
        window._cloudSync
          .removeHighlight(h.vol, h.file, h.topicId, h.startChar, h.endChar)
          .catch(() => queueFallback());
      } else {
        queueFallback();
      }
    }

    const mark = document.querySelector(`mark.user-highlight[data-highlight-id="${id}"]`);
    if (mark) {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    }

    _updateHighlightBadge();
  }

  function _applyHighlightsToTopic(topicEl, highlights) {
    const textNodes = _collectTextNodes(topicEl);
    if (textNodes.length === 0) return;

    const totalChars = textNodes[textNodes.length - 1].endChar;

    highlights.forEach(h => {
      const startChar = h.startChar;
      const endChar = h.endChar;

      if (startChar < 0 || endChar < 0 || startChar >= endChar || endChar > totalChars + 1) return;

      const ranges = [];

      for (const tn of textNodes) {
        const overlapStart = Math.max(tn.startChar, startChar);
        const overlapEnd = Math.min(tn.endChar, endChar);

        if (overlapStart < overlapEnd) {
          ranges.push({
            node: tn.node,
            offsetStart: overlapStart - tn.startChar,
            offsetEnd: overlapEnd - tn.startChar,
          });
        }
      }

      if (ranges.length === 0) return;

      try {
        const domRange = document.createRange();
        domRange.setStart(ranges[0].node, ranges[0].offsetStart);
        domRange.setEnd(ranges[ranges.length - 1].node, ranges[ranges.length - 1].offsetEnd);
        const mark = _createMarkEl(h);
        domRange.surroundContents(mark);
      } catch (e) {
        ranges.forEach(r => {
          _applyWithSplit(r.node, r.offsetStart, r.offsetEnd, h);
        });
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

  function _handleSelection(e) {
    const clickedInsideTooltip = e && e.target && e.target.closest('.highlight-tooltip');
    const clickedInsidePopup = e && e.target && e.target.closest('.highlight-comment-popup');
    const clickedOnHighlight = e && e.target && e.target.closest('mark.user-highlight');
    const clickedInsideMobileBar = e && e.target && e.target.closest('.highlight-mobile-bar');
    if (clickedInsideTooltip || clickedInsidePopup || clickedOnHighlight || clickedInsideMobileBar) return;

    setTimeout(() => {
      const tooltip = document.getElementById('highlightTooltip');
      if (tooltip && tooltip.contains(document.activeElement)) return;

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        if (_tooltipEl) _hideTooltip();
        if (_mobileBarEl) _hideMobileBar();
        return;
      }

      const text = sel.toString().trim();
      if (text.length < 2) {
        if (_tooltipEl) _hideTooltip();
        if (_mobileBarEl) _hideMobileBar();
        return;
      }

      const range = sel.getRangeAt(0);
      const topicId = _getTopicIdFromNode(range.startContainer);
      if (!topicId) {
        _hideTooltip();
        _hideMobileBar();
        return;
      }

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

      _currentSelection = {
        topicId,
        topicIndex,
        topicTitle,
        text,
        startChar,
        endChar,
      };

      if (_isMobile) {
        _showMobileBar();
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
      titleEl.textContent = lang === 'ja' ? 'この教えのハイライト' : 'Destaques deste Ensinamento';
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

      resultsEl.innerHTML = pageHighlights.map(h => renderItem(h, false)).join('');

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
                  url = `reader.html?pub=disciples&book=${encodeURIComponent(hFile)}`;
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

    document.addEventListener('mouseup', _handleSelection);
    document.addEventListener('touchend', _handleSelection);
    document.addEventListener('click', _handleClick);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
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
