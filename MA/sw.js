// Network first for the page and its config, so a new version reaches every phone the next time it
// opens; the cache is only for when there is no signal. Apps Script calls are never cached.
var CACHE = 'max-ari-87885aa7';
var SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }));
  self.clients.claim();
});
self.addEventListener('fetch', function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (r.mode === 'navigate' || /\/(index\.html|config\.js)?$/.test(u.pathname) || /config\.js$/.test(u.pathname)) {
    e.respondWith(fetch(r).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(r.mode === 'navigate' ? './' : r, copy); });
      return res;
    }).catch(function () { return caches.match(r.mode === 'navigate' ? './' : r).then(function (m) { return m || caches.match('./'); }); }));
    return;
  }
  e.respondWith(caches.match(r).then(function (m) {
    var net = fetch(r).then(function (res) { if (res.ok) caches.open(CACHE).then(function (c) { c.put(r, res.clone()); }); return res; });
    return m || net;
  }));
});
