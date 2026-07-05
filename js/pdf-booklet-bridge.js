// ============================================================
// PDF Booklet Bridge — expõe generateFromPlaylistItems globalmente
// ============================================================
// Módulo curto que importa de pdf-booklet.js (também módulo) e expõe
// uma função pro escopo global. Permite que js/playlists.js (IIFE
// non-module) chame a geração de apostila a partir de uma playlist.
//
// Carregado em todas as páginas onde o manager de playlists abre:
//   reader.html + mioshiec[1-4]/index.html.
// ============================================================

import { generateFromPlaylistItems } from './pdf-booklet.js?v=3';

window.generatePlaylistApostila = generateFromPlaylistItems;
