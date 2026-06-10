// ============================================================
// Loader condicional de playlists.min.js
// ============================================================
// Os dois pontos de entrada de playlists.js (openPlaylistAddPicker /
// openPlaylistManager) são admin-only — usuários comuns baixavam ~75 KB
// à toa em TODAS as páginas. Este loader (≤1 KB) só injeta o script
// para admin.
//
// O ?v= do próprio loader é reaproveitado como cache-bust do .min.js:
// pra publicar uma mudança em playlists.js, rode `npm run build:js` e
// bumpe playlists-loader.js (`npm run versions bump playlists-loader.js`).
// ============================================================
(function () {
  var isAdmin;
  if (typeof isAdminUser === 'function') {
    isAdmin = isAdminUser();
  } else {
    // fallback espelhando js/access.js (páginas sem access.js)
    try {
      var a = localStorage.getItem('mioshie_auth');
      isAdmin = (a === 'admin' || a === 'true');
    } catch (_) { isAdmin = false; }
  }
  if (!isAdmin) return;

  var self = document.currentScript;
  var src = (self && self.src) || '';
  var base = src.replace(/[^/]*$/, '');           // .../js/
  var v = (src.match(/[?&]v=(\d+)/) || [])[1] || '1';
  var s = document.createElement('script');
  s.src = base + 'playlists.min.js?v=' + v;
  s.defer = true;
  document.head.appendChild(s);
})();
