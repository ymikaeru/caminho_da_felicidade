// ============================================================
// Service Worker — Caminho da Felicidade
// ============================================================
// Existe SÓ para Web Push (avisos de recomendação de estudo).
// De propósito NÃO intercepta fetch nem faz cache offline: o site
// usa cache-bust manual (?v=N) e um cache de SW ia conflitar.
// ============================================================

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { }
  const title = data.title || 'Caminho da Felicidade';
  const body = data.body || 'Você recebeu uma nova recomendação de estudo.';
  const url = data.url || 'recomendacoes.html';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: 'assets/icons/icon-192.png',
    badge: 'assets/icons/icon-192.png',
    tag: data.tag || 'rec-study',     // agrupa: um aviso novo substitui o anterior
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || 'recomendacoes.html', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url === target && 'focus' in w) return w.focus();
    }
    // qualquer janela do site aberta → navega; senão abre nova
    if (wins.length && 'navigate' in wins[0]) { await wins[0].navigate(target); return wins[0].focus(); }
    return self.clients.openWindow(target);
  })());
});
