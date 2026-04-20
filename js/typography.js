// ============================================================
// TYPOGRAPHY — font size, line height, letter/word spacing,
//              margins, justify, bold, customize panel
// Depends on: closeThemeModal (theme.js), renderContent (reader.js)
// ============================================================

const FONT_SIZES = [14, 16, 18, 21, 24, 28, 32];
let _currentFontSizeIdx = null;

window.initFontSize = function () {
  const saved = parseInt(localStorage.getItem('reader_font_size') || '21');
  const idx = FONT_SIZES.indexOf(saved);
  _currentFontSizeIdx = idx >= 0 ? idx : 3;
  _applyFontSize();
};

window.changeFontSize = function (delta) {
  if (_currentFontSizeIdx === null) _currentFontSizeIdx = 1;
  _currentFontSizeIdx = Math.max(0, Math.min(FONT_SIZES.length - 1, _currentFontSizeIdx + delta));
  _applyFontSize();
  try { localStorage.setItem('reader_font_size', FONT_SIZES[_currentFontSizeIdx]); } catch (e) { }
};

function _applyFontSize() {
  const size = FONT_SIZES[_currentFontSizeIdx];
  document.documentElement.style.setProperty('--reader-font-size', size + 'px');

  const btnMinus = document.getElementById('fontDecrease');
  const btnPlus = document.getElementById('fontIncrease');
  const mBtnMinus = document.getElementById('mobileFontDown');
  const mBtnPlus = document.getElementById('mobileFontUp');

  if (btnMinus) btnMinus.disabled = (_currentFontSizeIdx === 0);
  if (btnPlus) btnPlus.disabled = (_currentFontSizeIdx === FONT_SIZES.length - 1);
  if (mBtnMinus) mBtnMinus.disabled = (_currentFontSizeIdx === 0);
  if (mBtnPlus) mBtnPlus.disabled = (_currentFontSizeIdx === FONT_SIZES.length - 1);
}

window.initLineHeight = function () {
  const saved = parseFloat(localStorage.getItem('reader_line_height') || '1.6');
  _applyLineHeight(saved);
  const slider = document.getElementById('themeLineHeightSlider');
  if (slider) slider.value = saved;
  const el = document.getElementById('lineHeightValue');
  if (el) el.textContent = saved.toFixed(1);
};

window.changeLineHeight = function (val) {
  const num = parseFloat(val);
  _applyLineHeight(num);
  try { localStorage.setItem('reader_line_height', num); } catch (e) { }
  const el = document.getElementById('lineHeightValue');
  if (el) el.textContent = num.toFixed(1);
};

function _applyLineHeight(val) {
  document.documentElement.style.setProperty('--reader-line-height', val);
}

window.initAdvancedOptions = function () {
  const savedLetterSpacing = localStorage.getItem('reader_letter_spacing') || '0';
  _applyLetterSpacing(savedLetterSpacing);
  const letterSlider = document.getElementById('themeLetterSpacingSlider');
  if (letterSlider) letterSlider.value = savedLetterSpacing;
  const lsVal = document.getElementById('letterSpacingValue');
  if (lsVal) lsVal.textContent = Math.round(parseFloat(savedLetterSpacing) * 100) + '%';

  const savedWordSpacing = localStorage.getItem('reader_word_spacing') || '0';
  _applyWordSpacing(savedWordSpacing);
  const wordSlider = document.getElementById('themeWordSpacingSlider');
  if (wordSlider) wordSlider.value = savedWordSpacing;
  const wsVal = document.getElementById('wordSpacingValue');
  if (wsVal) wsVal.textContent = Math.round(parseFloat(savedWordSpacing) * 100) + '%';

  const savedMargins = localStorage.getItem('reader_margins') || '0';
  _applyMargins(savedMargins);
  const marginsSlider = document.getElementById('themeMarginsSlider');
  if (marginsSlider) marginsSlider.value = savedMargins;
  const mVal = document.getElementById('marginsValue');
  if (mVal) mVal.textContent = Math.round(parseFloat(savedMargins)) + '%';

  const savedJustify = localStorage.getItem('reader_justify') === 'true';
  _applyJustify(savedJustify);
  const justifyToggle = document.getElementById('themeJustifyToggle');
  if (justifyToggle) justifyToggle.checked = savedJustify;

  const savedBold = localStorage.getItem('reader_bold') === 'true';
  _applyBoldText(savedBold);
  const boldToggle = document.getElementById('themeBoldToggle');
  if (boldToggle) boldToggle.checked = savedBold;

  const savedCustomize = localStorage.getItem('reader_customize') === 'true';
  const customizeToggle = document.getElementById('themeCustomizeToggle');
  const slidersGroup = document.getElementById('themeSlidersGroup');
  if (customizeToggle) customizeToggle.checked = savedCustomize;
  if (slidersGroup) slidersGroup.style.display = savedCustomize ? '' : 'none';
};

window.changeLetterSpacing = function (val) {
  _applyLetterSpacing(val);
  try { localStorage.setItem('reader_letter_spacing', val); } catch (e) { }
  const el = document.getElementById('letterSpacingValue');
  if (el) el.textContent = Math.round(parseFloat(val) * 100) + '%';
};

window.changeWordSpacing = function (val) {
  _applyWordSpacing(val);
  try { localStorage.setItem('reader_word_spacing', val); } catch (e) { }
  const el = document.getElementById('wordSpacingValue');
  if (el) el.textContent = Math.round(parseFloat(val) * 100) + '%';
};

window.changeMargins = function (val) {
  _applyMargins(val);
  try { localStorage.setItem('reader_margins', val); } catch (e) { }
  const el = document.getElementById('marginsValue');
  if (el) el.textContent = Math.round(parseFloat(val)) + '%';
};

window.toggleJustify = function (isChecked) {
  _applyJustify(isChecked);
  try { localStorage.setItem('reader_justify', isChecked); } catch (e) { }
};

window.toggleBoldText = function (isChecked) {
  _applyBoldText(isChecked);
  try { localStorage.setItem('reader_bold', isChecked); } catch (e) { }
};

window.toggleCustomize = function (isChecked) {
  const group = document.getElementById('themeSlidersGroup');
  if (!group) return;
  if (isChecked) {
    group.style.display = '';
    group.style.maxHeight = '0';
    group.style.opacity = '0';
    group.offsetHeight;
    group.style.maxHeight = group.scrollHeight + 'px';
    group.style.opacity = '1';
    setTimeout(() => {
      group.style.maxHeight = '';
      const row = document.getElementById('customizeRow');
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 310);
  } else {
    _applyLineHeight(1.6);
    _applyLetterSpacing(0);
    _applyWordSpacing(0);
    _applyMargins(0);
    _applyJustify(false);
    _applyBoldText(false);

    const lhSlider = document.getElementById('themeLineHeightSlider');
    if (lhSlider) lhSlider.value = 1.6;
    const lhVal = document.getElementById('lineHeightValue');
    if (lhVal) lhVal.textContent = '1.6';

    const lsSlider = document.getElementById('themeLetterSpacingSlider');
    if (lsSlider) lsSlider.value = 0;
    const lsVal = document.getElementById('letterSpacingValue');
    if (lsVal) lsVal.textContent = '0%';

    const wsSlider = document.getElementById('themeWordSpacingSlider');
    if (wsSlider) wsSlider.value = 0;
    const wsVal = document.getElementById('wordSpacingValue');
    if (wsVal) wsVal.textContent = '0%';

    const mSlider = document.getElementById('themeMarginsSlider');
    if (mSlider) mSlider.value = 0;
    const mVal = document.getElementById('marginsValue');
    if (mVal) mVal.textContent = '0%';

    const justifyToggle = document.getElementById('themeJustifyToggle');
    if (justifyToggle) justifyToggle.checked = false;

    const boldToggle = document.getElementById('themeBoldToggle');
    if (boldToggle) boldToggle.checked = false;

    try {
      localStorage.setItem('reader_line_height', 1.6);
      localStorage.setItem('reader_letter_spacing', 0);
      localStorage.setItem('reader_word_spacing', 0);
      localStorage.setItem('reader_margins', 0);
      localStorage.setItem('reader_justify', false);
      localStorage.setItem('reader_bold', false);
    } catch (e) { }

    group.style.maxHeight = group.scrollHeight + 'px';
    group.offsetHeight;
    group.style.maxHeight = '0';
    group.style.opacity = '0';
    setTimeout(() => { group.style.display = 'none'; group.style.maxHeight = ''; }, 300);
  }
  try { localStorage.setItem('reader_customize', isChecked); } catch (e) { }
};

window.toggleComparison = function (isChecked) {
  localStorage.setItem('reader_comparison', isChecked);
  if (typeof window.renderContent === 'function') window.renderContent();
  if (typeof closeThemeModal === 'function') closeThemeModal();
};

function _applyLetterSpacing(val) {
  const v = parseFloat(val);
  document.documentElement.style.setProperty('--reader-letter-spacing', v === 0 ? 'normal' : v + 'em');
}

function _applyWordSpacing(val) {
  const v = parseFloat(val);
  document.documentElement.style.setProperty('--reader-word-spacing', v === 0 ? 'normal' : v + 'em');
}

function _applyMargins(val) {
  document.documentElement.style.setProperty('--reader-margins', val + 'px');
}

function _applyJustify(isChecked) {
  document.documentElement.style.setProperty('--reader-text-align', isChecked ? 'justify' : 'left');
}

function _applyBoldText(isChecked) {
  document.documentElement.style.setProperty('--reader-font-weight-override', isChecked ? '700' : 'inherit');
}

document.addEventListener('DOMContentLoaded', () => {
  const savedMode = localStorage.getItem('site_mode') || 'light';
  document.documentElement.setAttribute('data-mode', savedMode);
  if (typeof initLineHeight === 'function') initLineHeight();
  if (typeof initAdvancedOptions === 'function') initAdvancedOptions();
});
