// ============================================================
// PDF Booklet UI — Mioshie College
// Injects "Criar Apostila" button and modal into volume pages
// ============================================================
import SUPABASE_CONFIG, { supabase } from './supabase-config.js';
import { generateBooklet, generateFromSelection, generateFromCurrentVolume } from './pdf-booklet.js';
const BUCKET = 'teachings';

function injectBookletButton() {
  if (document.getElementById('pdf-booklet-btn')) return;

  const panel = document.querySelector('.mobile-nav-body');
  if (!panel) {
    const observer = new MutationObserver(() => {
      const p = document.querySelector('.mobile-nav-body');
      if (p) { observer.disconnect(); doInject(p); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return;
  }
  doInject(panel);
}

function doInject(panel) {
  if (document.getElementById('pdf-booklet-btn')) return;

  const divider = document.createElement('div');
  divider.className = 'mobile-nav-divider';

  const btn = document.createElement('button');
  btn.id = 'pdf-booklet-btn';
  btn.className = 'mobile-nav-link';
  btn.innerHTML = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg><span class="link-text">Criar Apostila PDF</span>`;
  btn.onclick = openBookletModal;

  panel.appendChild(divider);
  panel.appendChild(btn);
}

async function openBookletModal() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { alert('Faça login primeiro.'); return; }

  const volMatch = window.location.pathname.match(/mioshiec(\d)/);
  if (!volMatch) { alert('Esta função só está disponível nas páginas de volume.'); return; }

  const volume = `mioshiec${volMatch[1]}`;
  const volNames = {
    mioshiec1: 'Volume 1 — Mundo Espiritual',
    mioshiec2: 'Volume 2 — Método Divino de Saúde',
    mioshiec3: 'Volume 3 — A Verdadeira Fé',
    mioshiec4: 'Volume 4 — Ensinamentos Complementares'
  };

  // Fetch files from storage
  const { data } = await supabase.storage.from(BUCKET).list(`${volume}/`);
  if (!data || data.length === 0) { alert('Nenhum arquivo encontrado.'); return; }

  const files = data.map(f => f.name).filter(n => n.endsWith('.json')).sort();

  // Group files by section using nav data
  let sections = {};
  try {
    const { data: navData } = await supabase.storage.from(BUCKET).download(`${volume}_nav.json`);
    if (navData) {
      const nav = JSON.parse(await navData.text());
      for (const [file, info] of Object.entries(nav)) {
        const sectionName = info.section || 'Outros';
        if (!sections[sectionName]) sections[sectionName] = [];
        sections[sectionName].push(file);
      }
    }
  } catch { /* no nav data */ }

  if (Object.keys(sections).length === 0) {
    sections = { 'Todos os arquivos': files };
  }

  // Create modal
  const overlay = document.createElement('div');
  overlay.id = 'booklet-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:16px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:20px 24px;border-bottom:1px solid var(--border,#e5e5e5);display:flex;align-items:center;justify-content:space-between;">
        <h2 style="font-size:1.1rem;margin:0;">📄 Criar Apostila PDF — ${volNames[volume] || volume}</h2>
        <button id="booklet-close" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-muted,#666);padding:4px 8px;">&times;</button>
      </div>
      <div style="padding:16px 24px;border-bottom:1px solid var(--border,#e5e5e5);display:flex;gap:10px;flex-wrap:wrap;">
        <button id="booklet-select-all" style="padding:6px 14px;border:1px solid var(--border,#e5e5e5);border-radius:8px;background:var(--bg,#f5f5f5);cursor:pointer;font-size:0.85rem;">Selecionar Todos</button>
        <button id="booklet-deselect-all" style="padding:6px 14px;border:1px solid var(--border,#e5e5e5);border-radius:8px;background:var(--bg,#f5f5f5);cursor:pointer;font-size:0.85rem;">Desmarcar Todos</button>
        <input id="booklet-title-input" type="text" placeholder="Título da apostila" value="${volNames[volume] || volume}" style="flex:1;min-width:150px;padding:6px 12px;border:1px solid var(--border,#e5e5e5);border-radius:8px;font-size:0.85rem;">
      </div>
      <div id="booklet-file-list" style="flex:1;overflow-y:auto;padding:16px 24px;">
        ${Object.entries(sections).map(([section, sectionFiles]) => `
          <div style="margin-bottom:16px;">
            <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
              <input type="checkbox" class="booklet-section-cb" data-section="${section}">
              ${section}
              <span style="color:var(--text-muted,#999);font-weight:400;">(${sectionFiles.length})</span>
            </div>
            <div style="padding-left:24px;display:flex;flex-direction:column;gap:4px;">
              ${sectionFiles.map(f => `
                <label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;cursor:pointer;padding:2px 0;">
                  <input type="checkbox" class="booklet-file-cb" value="${f}" data-section="${section}">
                  ${f.replace('.html.json', '')}
                </label>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <div style="padding:16px 24px;border-top:1px solid var(--border,#e5e5e5);display:flex;justify-content:space-between;align-items:center;">
        <span id="booklet-count" style="font-size:0.85rem;color:var(--text-muted,#666);">0 selecionados</span>
        <button id="booklet-generate" style="padding:10px 24px;border:none;border-radius:10px;background:var(--accent,#b8860b);color:#fff;font-weight:600;font-size:0.9rem;cursor:pointer;" disabled>Gerar PDF</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Event handlers
  const allCheckboxes = overlay.querySelectorAll('.booklet-file-cb');
  const countEl = overlay.querySelector('#booklet-count');
  const generateBtn = overlay.querySelector('#booklet-generate');

  function updateCount() {
    const count = overlay.querySelectorAll('.booklet-file-cb:checked').length;
    countEl.textContent = `${count} selecionado${count !== 1 ? 's' : ''}`;
    generateBtn.disabled = count === 0;
  }

  allCheckboxes.forEach(cb => cb.addEventListener('change', updateCount));

  overlay.querySelectorAll('.booklet-section-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const section = cb.dataset.section;
      overlay.querySelectorAll(`.booklet-file-cb[data-section="${section}"]`).forEach(fcb => {
        fcb.checked = cb.checked;
      });
      updateCount();
    });
  });

  overlay.querySelector('#booklet-select-all').onclick = () => {
    allCheckboxes.forEach(cb => cb.checked = true);
    overlay.querySelectorAll('.booklet-section-cb').forEach(cb => cb.checked = true);
    updateCount();
  };

  overlay.querySelector('#booklet-deselect-all').onclick = () => {
    allCheckboxes.forEach(cb => cb.checked = false);
    overlay.querySelectorAll('.booklet-section-cb').forEach(cb => cb.checked = false);
    updateCount();
  };

  overlay.querySelector('#booklet-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  generateBtn.onclick = async () => {
    const selectedFiles = Array.from(overlay.querySelectorAll('.booklet-file-cb:checked')).map(cb => cb.value);
    const title = overlay.querySelector('#booklet-title-input').value || volume;

    generateBtn.disabled = true;
    generateBtn.textContent = 'Gerando...';

    try {
      await generateFromSelection(volume, selectedFiles, title);
      overlay.remove();
    } catch (e) {
      alert(`Erro ao gerar PDF: ${e.message}`);
      generateBtn.disabled = false;
      generateBtn.textContent = 'Gerar PDF';
    }
  };
}

// Initialize
document.addEventListener('DOMContentLoaded', injectBookletButton);

// Also try immediately in case DOM is already ready
if (document.readyState !== 'loading') {
  injectBookletButton();
}
