// Service worker : coquille de l'appli en cache + lecture hors ligne des données déjà consultées.
// Les écritures ne sont jamais mises en file : hors ligne, l'appli le dit clairement.
const SHELL = 'samlock-shell-v2';
const DATA = 'samlock-data-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'clear-data') caches.delete(DATA); });

const NO_CACHE_API = /^\/api\/(auth|public|push|inbox\/sync)/;
const timeout = (ms) => new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms));

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/signer/') || url.pathname.startsWith('/sous-traitant/')) return;

  // Données : réseau d'abord (4 s), sinon dernière copie connue
  if (url.pathname.startsWith('/api/')) {
    if (NO_CACHE_API.test(url.pathname)) return;
    e.respondWith((async () => {
      const c = await caches.open(DATA);
      try {
        const res = await Promise.race([fetch(req), timeout(4000)]);
        if (res.ok && !/pdf|zip|csv|xlsx/.test(res.headers.get('content-type') || '')) c.put(req, res.clone());
        return res;
      } catch {
        const hit = await c.match(req);
        if (hit) return hit;
        return new Response(JSON.stringify({ error: 'Hors ligne : ces données n\'ont pas encore été consultées.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // Pages : réseau d'abord, sinon la coquille de l'appli
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      try { const res = await Promise.race([fetch(req), timeout(5000)]); if (res.ok) c.put('/', res.clone()); return res; }
      catch { return (await c.match('/')) || Response.error(); }
    })());
    return;
  }

  // Fichiers statiques : cache d'abord
  if (!url.pathname.startsWith('/assets/') && !/\.(png|woff2?|svg|webmanifest)$/.test(url.pathname)) return;
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const hit = await c.match(req); if (hit) return hit;
    const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
  }));
});

// Notifications push (rappels de l'agenda)
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data.json(); } catch { /* texte brut */ }
  e.waitUntil(self.registration.showNotification(d.title || 'SAMLOCK', { body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag, data: { url: d.url || '/agenda' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || '/agenda';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if ('focus' in w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
