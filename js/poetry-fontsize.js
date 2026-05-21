/**
 * poetry-fontsize.js — controle de escala de fonte nas páginas de poesia.
 * Aplica --poetry-scale no <html> e persiste em localStorage.
 * Wire-up: botões com IDs *FontDec / *FontInc (warai/yama).
 */
(function () {
  'use strict';

  const STEPS = [0.85, 0.95, 1.0, 1.15, 1.3, 1.5, 1.75];
  const STORAGE_KEY = 'poetry_font_scale';

  function _currentIdx() {
    const saved = parseFloat(localStorage.getItem(STORAGE_KEY) || '1');
    let idx = STEPS.indexOf(saved);
    if (idx < 0) idx = STEPS.indexOf(1.0);
    return idx;
  }

  function _apply(idx) {
    const scale = STEPS[idx];
    document.documentElement.style.setProperty('--poetry-scale', String(scale));
    try { localStorage.setItem(STORAGE_KEY, String(scale)); } catch (e) {}

    const atMin = idx === 0;
    const atMax = idx === STEPS.length - 1;
    ['waraiFontDec', 'yamaFontDec'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = atMin;
    });
    ['waraiFontInc', 'yamaFontInc'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = atMax;
    });
  }

  function _wire() {
    let idx = _currentIdx();
    _apply(idx);

    const bind = (id, delta) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        idx = Math.max(0, Math.min(STEPS.length - 1, idx + delta));
        _apply(idx);
      });
    };
    bind('waraiFontDec', -1);
    bind('waraiFontInc', +1);
    bind('yamaFontDec', -1);
    bind('yamaFontInc', +1);
  }

  // Apply persisted scale immediately to avoid flash
  try {
    const saved = parseFloat(localStorage.getItem(STORAGE_KEY) || '1');
    if (!isNaN(saved)) document.documentElement.style.setProperty('--poetry-scale', String(saved));
  } catch (e) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire);
  } else {
    _wire();
  }
})();
