import { supabase } from '../../supabase-config.js';
import { setAdminIds, volumeCategories } from './state.js';
import {
  DISCIPLES_BOOK_TITLES,
  POETRY_BOOK_TITLES,
  SPECIAL_FILE_TITLES
} from './constants.js';

export function _escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;').replace(/`/g, '&#96;');
}

// Versão mais enxuta de _escHtml usada pelas abas de landing CMU
// (calendar, announcements, access info). Não escapa backtick.
export function _escapeCmu(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export async function logAdminAction(action, details = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from('admin_logs').insert({
      admin_id: session.user.id,
      admin_email: session.user.email,
      action,
      details
    });
  } catch (e) {
    console.warn('[adminLog]', e.message);
  }
}

export async function _loadAdminIds() {
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('role', 'admin');
    setAdminIds(new Set((data || []).map(u => u.id)));
  } catch (e) {
    console.warn('[_loadAdminIds] failed:', e.message);
  }
}

export function getFileTitle(volume, file) {
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
