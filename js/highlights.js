// ============================================================
// HIGHLIGHTS — text selection, color picker, save/apply, modal
// Uses character offsets (stable across DOM mutations) instead
// of DOM node paths (break when <mark> tags are inserted).
// ============================================================

(function () {
  const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'];
  const DEFAULT_COLOR = 'yellow';

  let _tooltipEl = null;
  let _commentPopupEl = null;
  let _currentSelection = null;
  let _selectedColor = DEFAULT_COLOR;
  let _highlights = [];
  let _appliedIds = new Set();
  let _savedRange = null;
  let _tempMarkEl = null;

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

  function _getParams() {
    const urlParams = new URLSearchParams(window.location.search);
    let volId = urlParams.get('vol') || urlParams.get('v');
    let filename = urlParams.get('file') || urlParams.get('f');

    // Fallback to hash (e.g. #v1/artigo) when search params are empty
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
      // Keep only last 2000 tombstones to avoid localStorage bloat
      if (tombstones.length > 2000) tombstones.splice(0, tombstones.length - 2000);
      localStorage.setItem('highlightDeletedKeys', JSON.stringify(tombstones));
    } catch (e) {}
  }

  function _getTopicIdFromNode(node) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    while (el) {
      if (el.classList && el.classList.contains('topic-content')) {
        return el.id;
      }
      el = el.parentNode;
    }
    return null;
  }

  // Collect all text nodes inside an element (including inside <mark> wrappers)
  // Returns [{node, startChar, endChar}]
  // BUG 2 FIX: Must include text inside existing marks so character offsets
  // stay consistent regardless of how many highlights are already applied.
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

  function _applyHighlightsToPage() {
    const { volId, filename } = _getParams();
    const pageHighlights = _highlights.filter(h => h.vol === volId && h.file === filename);

    // Group by topic
    const byTopic = {};
    pageHighlights.forEach(h => {
      if (!byTopic[h.topicId]) byTopic[h.topicId] = [];
      byTopic[h.topicId].push(h);
    });

    for (const topicId in byTopic) {
      const topicEl = document.getElementById(topicId);
      if (!topicEl) continue;

      const topicHighlights = byTopic[topicId].sort((a, b) => a.startChar - b.startChar);
      _applyHighlightsToTopic(topicEl, topicHighlights);
    }
  }

  // S1: Helper to create a <mark> element for a highlight
  function _createMarkEl(highlight) {
    const mark = document.createElement('mark');
    mark.className = `user-highlight highlight-${highlight.color}`;
    mark.dataset.highlightId = highlight.id;
    if (highlight.comment) mark.title = highlight.comment;
    mark.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _showCommentPopup(highlight, mark);
    });
    return mark;
  }

  // Helper to unwrap all <mark.user-highlight> without deleting text (BUG 1 FIX)
  function _unwrapMarks() {
    document.querySelectorAll('mark.user-highlight').forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
  }

  // S4: Unified single/multi node application
  function _applyHighlightsToTopic(topicEl, highlights) {
    const textNodes = _collectTextNodes(topicEl);
    if (textNodes.length === 0) return;

    const totalChars = textNodes[textNodes.length - 1].endChar;

    highlights.forEach(h => {
      if (_appliedIds.has(h.id)) return;

      const startChar = h.startChar;
      const endChar = h.endChar;

      if (startChar < 0 || endChar < 0 || startChar >= endChar || endChar > totalChars + 1) return;

      // Find all text nodes that overlap with [startChar, endChar]
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

      // Try surroundContents first (works for single node and same-parent multi-node)
      try {
        const domRange = document.createRange();
        domRange.setStart(ranges[0].node, ranges[0].offsetStart);
        domRange.setEnd(ranges[ranges.length - 1].node, ranges[ranges.length - 1].offsetEnd);
        const mark = _createMarkEl(h);
        domRange.surroundContents(mark);
        _appliedIds.add(h.id);
      } catch (e) {
        // Fallback: apply to each segment individually
        ranges.forEach(r => {
          _applyWithSplit(r.node, r.offsetStart, r.offsetEnd, h);
        });
        _appliedIds.add(h.id);
      }
    });
  }

  // BUG 3 FIX: normalize after split to clean empty text nodes
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

    _tooltipEl.innerHTML =
      `<div class="highlight-colors">${colorBtnsHTML}</div>` +
      `<div class="highlight-tooltip-divider"></div>` +
      `<div class="highlight-comment-section">` +
        `<textarea class="highlight-comment-input" id="highlightCommentInput" placeholder="${commentPlaceholder}"></textarea>` +
        `<div class="highlight-comment-actions">` +
          `<button class="highlight-cancel-btn" id="highlightCancelBtn">${cancelLabel}</button>` +
          `<button class="highlight-save-btn" id="highlightSaveBtn">${saveLabel}</button>` +
        `</div>` +
      `</div>`;

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

    // Wrap selection in a temporary mark so it stays visible
    try {
      const tempMark = document.createElement('mark');
      tempMark.className = 'temp-selection';
      range.surroundContents(tempMark);
      _tempMarkEl = tempMark;
    } catch (e) {}

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
  }

  function _hideTooltip() {
    _removeTempMark();
    _savedRange = null;
    if (_tooltipEl) {
      _tooltipEl.remove();
      _tooltipEl = null;
    }
    _currentSelection = null;
  }

  function _removeTempMark() {
    if (_tempMarkEl && _tempMarkEl.parentNode) {
      const parent = _tempMarkEl.parentNode;
      while (_tempMarkEl.firstChild) {
        parent.insertBefore(_tempMarkEl.firstChild, _tempMarkEl);
      }
      parent.removeChild(_tempMarkEl);
      parent.normalize();
    }
    _tempMarkEl = null;
  }

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

    // BUG 4 FIX: Position the edit tooltip near the highlight mark
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
      // Fallback: center on screen
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

  function _saveSelection() {
    if (!_currentSelection) return;

    const { volId, filename } = _getParams();
    const comment = document.getElementById('highlightCommentInput')?.value.trim() || '';

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
    }

    _hideTooltip();

    // Apply only the new highlight without disturbing existing ones
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

    // Record tombstone so cloud sync doesn't re-add it
    if (h) {
      const key = `${h.vol}:${h.file}:${h.topicId}:${h.startChar}:${h.endChar}`;
      _addDeletedTombstone(key);
    }

    if (window._cloudSync && h) {
      window._cloudSync.removeHighlight(h.vol, h.file, h.topicId, h.startChar, h.endChar);
    }

    // Remove only the specific mark from DOM, don't re-apply all
    const mark = document.querySelector(`mark.user-highlight[data-highlight-id="${id}"]`);
    if (mark) {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    }

    _appliedIds.delete(id);
    _updateHighlightBadge();
  }

  // BUG 1 FIX: unwrap marks instead of removing them (preserves text content)
  function _refreshPageHighlights() {
    _appliedIds.clear();
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

  function _handleSelection(e) {
    const clickedInsideTooltip = e && e.target && e.target.closest('.highlight-tooltip');
    const clickedInsidePopup = e && e.target && e.target.closest('.highlight-comment-popup');
    const clickedOnHighlight = e && e.target && e.target.closest('mark.user-highlight');
    if (clickedInsideTooltip || clickedInsidePopup || clickedOnHighlight) return;

    setTimeout(() => {
      const tooltip = document.getElementById('highlightTooltip');
      if (tooltip && tooltip.contains(document.activeElement)) return;

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        if (_tooltipEl) {
          _hideTooltip();
        }
        return;
      }

      const text = sel.toString().trim();
      if (text.length < 2) {
        if (_tooltipEl) {
          _hideTooltip();
        }
        return;
      }

      const range = sel.getRangeAt(0);
      const topicId = _getTopicIdFromNode(range.startContainer);
      if (!topicId) {
        _hideTooltip();
        return;
      }

      const topicEl = document.getElementById(topicId);
      const topicIndex = parseInt(topicId.replace('topic-', ''), 10);
      let topicTitle = '';
      if (window._currentTopics && window._currentTopics[topicIndex]) {
        const lang = _lang();
        topicTitle = (lang === 'pt'
          ? (window._currentTopics[topicIndex].title_ptbr || window._currentTopics[topicIndex].title_pt || window._currentTopics[topicIndex].title || '')
          : (window._currentTopics[topicIndex].title_ja || window._currentTopics[topicIndex].title || '')
        ).replace(/<[^>]+>/g, '').trim();
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

      _showTooltip(range);
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
        const colorMap = {
          yellow: '#fff3a1', green: '#a8e6cf', blue: '#a0c4ff',
          pink: '#ffb3c6', purple: '#d4a5f5', orange: '#ffd6a5'
        };
        const bgColor = colorMap[h.color] || '#fff3a1';
        const date = new Date(h.createdAt).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-BR');

        return `<li class="highlight-item" data-id="${h.id}" data-topic="${h.topicIndex}" data-vol="${_esc(h.vol || '')}" data-file="${_esc(h.file || '')}">
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
          const highlightId = item.dataset.id;
          if (topicIdx !== undefined) {
            const el = document.getElementById(`topic-${topicIdx}`);
            if (el) {
              // On reader page: close modal first, then scroll after overlay fades
              closeHighlights();
              setTimeout(() => {
                // Try to scroll to the specific highlight mark, fallback to topic
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
              // On home/other page: navigate to the reader with correct context
              const hVol  = item.dataset.vol;
              const hFile = item.dataset.file;
              if (hVol && hFile) {
                const lang = _lang();
                let url = `reader.html?vol=${encodeURIComponent(hVol)}&file=${encodeURIComponent(hFile)}`;
                // Always include topic (even 0) so the reader knows where to scroll
                if (topicIdx !== undefined && topicIdx !== '') url += `&topic=${topicIdx}`;
                // Pass highlightId so the reader can scroll to the exact <mark>
                if (highlightId) url += `&highlight=${encodeURIComponent(highlightId)}&hl_scroll=1`;
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
      // P2 FIX: trap focus for accessibility (WCAG 2.1.2)
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

    document.addEventListener('mouseup', _handleSelection);
    document.addEventListener('touchend', _handleSelection);
    document.addEventListener('click', _handleClick);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        _hideTooltip();
        _hideCommentPopup();
      }
    });
  };

  window.applyHighlightsOnPage = function () {
    _appliedIds.clear();
    _applyHighlightsToPage();
    _updateHighlightBadge();
  };

  window.getHighlightsForPage = function () {
    const { volId, filename } = _getParams();
    return _highlights.filter(h => h.vol === volId && h.file === filename);
  };

  // Modern API for external managers (e.g. destaques-page.js)
  window._HighlightsApi = {
      getAll: () => {
          _loadHighlights();
          return [..._highlights]; // Returns an array copy
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
