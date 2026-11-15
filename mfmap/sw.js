// Offline support. The page and the sealed app are fetched fresh whenever there is internet (so an update always
// arrives) and come from the saved copy only when there is none. The big map data is saved once per version.
const CACHE = 'map-1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url), base = new URL('./', self.location).pathname;
  if (u.origin !== self.location.origin || !u.pathname.startsWith(base)) return;
  if (u.pathname.includes('/data/')) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(r); if (hit) return hit;
      const res = await fetch(r);
      if (res.ok) { for (const k of await c.keys()) if (new URL(k.url).pathname === u.pathname) await c.delete(k); await c.put(r, res.clone()); }
      return res;
    }));
  } else {
    e.respondWith(caches.open(CACHE).then(async c => {
      try { const res = await fetch(r, { cache: 'no-store' }); if (res.ok) await c.put(u.pathname, res.clone()); return res; }
      catch (err) { const hit = await c.match(u.pathname); if (hit) return hit; throw err; }
    }));
  }
});
