// ============================================================
// THEME MODAL — mode (light/dark) + theme selection + customize
// Depends on: MENU_TEXTS, _trapFocus/_releaseFocus (toggle.js)
//             initLineHeight, initAdvancedOptions (typography.js)
// ============================================================

async function toggleTheme() {
  openThemeModal();
}

function openThemeModal() {
  let modal = document.getElementById('themeModal');
  if (!modal) {
    _createThemeModal();
    modal = document.getElementById('themeModal');
  }

  const currentLang = localStorage.getItem('site_lang') || 'pt';
  const titleEl = document.getElementById('themeModalTitle');
  if (titleEl) {
    titleEl.textContent = currentLang === 'ja' ? 'テーマと設定' : 'Themes & Settings';
  }

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-theme-val') === currentTheme);
  });

  const currentMode = document.documentElement.getAttribute('data-mode') || 'light';
  const lightBtn = document.getElementById('modeLightBtn');
  const darkBtn = document.getElementById('modeDarkBtn');
  if (lightBtn) lightBtn.classList.toggle('active', currentMode === 'light');
  if (darkBtn) darkBtn.classList.toggle('active', currentMode === 'dark');

  _updateThemeCardColors(currentMode);

  const isReaderPage = !!document.getElementById('readerContainer');
  const customizeRow = document.getElementById('customizeRow');
  const slidersGroup = document.getElementById('themeSlidersGroup');
  if (customizeRow) customizeRow.style.display = isReaderPage ? '' : 'none';
  if (slidersGroup && !isReaderPage) slidersGroup.style.display = 'none';

  if (typeof initLineHeight === 'function') initLineHeight();
  if (typeof initAdvancedOptions === 'function') initAdvancedOptions();

  modal.classList.add('active');
  _trapFocus(modal);
}

function closeThemeModal() {
  const modal = document.getElementById('themeModal');
  if (modal) { modal.classList.remove('active'); _releaseFocus(modal); }
}

window.setAppTheme = function (theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('theme', theme); } catch (e) { }

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-theme-val') === theme);
  });
};

window.setAppMode = function (mode) {
  document.documentElement.setAttribute('data-mode', mode);
  try { localStorage.setItem('site_mode', mode); } catch (e) { }

  const lightBtn = document.getElementById('modeLightBtn');
  const darkBtn = document.getElementById('modeDarkBtn');
  if (lightBtn) lightBtn.classList.toggle('active', mode === 'light');
  if (darkBtn) darkBtn.classList.toggle('active', mode === 'dark');

  _updateThemeCardColors(mode);
};

function _updateThemeCardColors(mode) {
  const isDark = mode === 'dark';
  const cardColors = {
    light: isDark ? { bg: '#1A1A1A', fg: '#D4D4D4' } : { bg: '#FFFFFF', fg: '#1C1C1E' },
    quiet: isDark ? { bg: '#38383A', fg: '#C8C8C8' } : { bg: '#5E5E60', fg: '#E5E5E5' },
    paper: isDark ? { bg: '#36332E', fg: '#C0B9A8' } : { bg: '#F4EEDF', fg: '#3C3B37' },
    bold: isDark ? { bg: '#151515', fg: '#FFFFFF' } : { bg: '#FFFFFF', fg: '#000000' },
    calm: isDark ? { bg: '#4A4032', fg: '#D4C4B0' } : { bg: '#EADDC8', fg: '#4A3A2A' },
    focus: isDark ? { bg: '#000000', fg: '#8A8A8C' } : { bg: '#FFFFFF', fg: '#000000' },
  };

  document.querySelectorAll('.theme-btn').forEach(btn => {
    const val = btn.getAttribute('data-theme-val');
    const colors = cardColors[val];
    if (!colors) return;
    btn.style.background = colors.bg;
    btn.style.color = colors.fg;
    if ((val === 'light' || val === 'bold' || val === 'focus') && !isDark) {
      btn.style.borderColor = '#E5E5E0';
    } else if ((val === 'light' || val === 'bold' || val === 'focus') && isDark) {
      btn.style.borderColor = '#444';
    } else {
      btn.style.borderColor = 'transparent';
    }
    const previewText = btn.querySelector('.theme-btn-preview-text');
    const labelText = btn.querySelector('.theme-btn-label');
    if (previewText) previewText.style.color = colors.fg;
    if (labelText) labelText.style.color = colors.fg;
  });
}

function _createThemeModal() {
  const overlay = document.createElement('div');
  overlay.className = 'theme-modal-overlay';
  overlay.id = 'themeModal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'themeModalTitle');

  const t = MENU_TEXTS[localStorage.getItem('site_lang') === 'ja' ? 'ja' : 'pt'];

  const iconSun = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
  const iconMoon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
  const iconLineHeight = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4h6"/><path d="M11 12h6"/><path d="M11 20h6"/><path d="M3 8l3-4 3 4"/><path d="M3 16l3 4 3-4"/></svg>`;
  const iconCharSpacingSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20l-4-4 4-4"/><path d="M17 20l4-4-4-4"/><path d="M3 16h18"/><path d="M10 4l2 8 2-8"/></svg>`;
  const iconWordSpacingSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20l-4-4 4-4"/><path d="M17 20l4-4-4-4"/><path d="M3 16h18"/><path d="M8 4h2"/><path d="M14 4h2"/></svg>`;
  const iconMarginsSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`;

  overlay.innerHTML = `
    <div class="theme-modal" id="themeModalCard">
      <div class="theme-modal-header">
        <h3 class="theme-modal-title" id="themeModalTitle">Themes & Settings</h3>
        <button class="search-close" onclick="closeThemeModal()" aria-label="Fechar" style="position:static;">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="theme-modal-content">

        <div class="theme-mode-switcher">
          <button class="theme-mode-btn" id="modeLightBtn" onclick="setAppMode('light')">
            ${iconSun} <span style="margin-left:8px; font-weight:500" class="tr-lightmode">${t.lightMode}</span>
          </button>
          <button class="theme-mode-btn" id="modeDarkBtn" onclick="setAppMode('dark')">
            ${iconMoon} <span style="margin-left:8px; font-weight:500" class="tr-darkmode">${t.darkMode}</span>
          </button>
        </div>

        <div class="theme-grid">
          <div class="theme-btn" data-theme-val="light" onclick="setAppTheme('light')">
            <div class="theme-btn-preview-text">Aa</div>
            <div class="theme-btn-label">Original</div>
          </div>
          <div class="theme-btn" data-theme-val="quiet" onclick="setAppTheme('quiet')">
            <div class="theme-btn-preview-text">Aa</div>
            <div class="theme-btn-label">Quiet</div>
          </div>
          <div class="theme-btn" data-theme-val="paper" onclick="setAppTheme('paper')">
            <div class="theme-btn-preview-text">Aa</div>
            <div class="theme-btn-label">Paper</div>
          </div>
          <div class="theme-btn" data-theme-val="bold" onclick="setAppTheme('bold')">
            <div class="theme-btn-preview-text">Aa</div>
            <div class="theme-btn-label">Bold</div>
          </div>
          <div class="theme-btn" data-theme-val="calm" onclick="setAppTheme('calm')">
            <div class="theme-btn-preview-text">Aa</div>
            <div class="theme-btn-label">Calm</div>
          </div>
          <div class="theme-btn" data-theme-val="focus" onclick="setAppTheme('focus')">
            <div class="theme-btn-preview-text">Aa</div>
            <div class="theme-btn-label">Focus</div>
          </div>
        </div>

        <div class="theme-custom-row" id="customizeRow" style="margin-top:8px;">
          <span class="theme-custom-row-title">${t.customize}</span>
          <label class="theme-toggle">
            <input type="checkbox" id="themeCustomizeToggle" onchange="toggleCustomize(this.checked)">
            <span class="theme-toggle-slider"></span>
          </label>
        </div>

        <div class="theme-sliders-group" id="themeSlidersGroup" style="display:none;">
          <div class="theme-slider-item">
            <span class="theme-slider-label">${t.lineSpacing}</span>
            <div class="theme-slider-row">
              <div class="theme-slider-icon">${iconLineHeight}</div>
              <input type="range" min="1.2" max="2.4" step="0.1" class="theme-slider" id="themeLineHeightSlider" oninput="changeLineHeight(this.value)">
              <span class="theme-slider-value" id="lineHeightValue">1.6</span>
            </div>
          </div>
          <div class="theme-slider-item">
            <span class="theme-slider-label">${t.charSpacing}</span>
            <div class="theme-slider-row">
              <div class="theme-slider-icon">${iconCharSpacingSvg}</div>
              <input type="range" min="-0.05" max="0.15" step="0.01" value="0" class="theme-slider" id="themeLetterSpacingSlider" oninput="changeLetterSpacing(this.value)">
              <span class="theme-slider-value" id="letterSpacingValue">0%</span>
            </div>
          </div>
          <div class="theme-slider-item">
            <span class="theme-slider-label">${t.wordSpacing}</span>
            <div class="theme-slider-row">
              <div class="theme-slider-icon">${iconWordSpacingSvg}</div>
              <input type="range" min="-0.05" max="0.2" step="0.01" value="0" class="theme-slider" id="themeWordSpacingSlider" oninput="changeWordSpacing(this.value)">
              <span class="theme-slider-value" id="wordSpacingValue">0%</span>
            </div>
          </div>
          <div class="theme-slider-item">
            <span class="theme-slider-label">${t.margins}</span>
            <div class="theme-slider-row">
              <div class="theme-slider-icon">${iconMarginsSvg}</div>
              <input type="range" min="0" max="100" step="5" value="0" class="theme-slider" id="themeMarginsSlider" oninput="changeMargins(this.value)">
              <span class="theme-slider-value" id="marginsValue">0%</span>
            </div>
          </div>
          <div class="theme-slider-item">
            <div class="theme-slider-row" style="justify-content:space-between;">
              <span class="theme-custom-row-title tr-justify">${t.justify}</span>
              <label class="theme-toggle">
                <input type="checkbox" id="themeJustifyToggle" onchange="toggleJustify(this.checked)">
                <span class="theme-toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="theme-slider-item">
            <div class="theme-slider-row" style="justify-content:space-between;">
              <span class="theme-custom-row-title tr-boldtext">${t.boldText}</span>
              <label class="theme-toggle">
                <input type="checkbox" id="themeBoldToggle" onchange="toggleBoldText(this.checked)">
                <span class="theme-toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target.id === 'themeModal') closeThemeModal();
  });

  document.body.appendChild(overlay);
}
