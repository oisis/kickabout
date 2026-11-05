// Network first, cache fallback: always fresh online, playable offline after one visit.
const CACHE = 'kopanka';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    try {
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch {
      return (await c.match(e.request)) ?? Response.error();
    }
  }));
});
