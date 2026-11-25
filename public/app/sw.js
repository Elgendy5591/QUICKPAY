// Service Worker der Klarfall-App: App-Gerüst offline verfügbar, Daten immer frisch vom Server.
// Bei Änderungen an App-Dateien VERSION erhöhen.
const VERSION = 'kf-app-v2';
const SHELL = ['/app/', '/assets/base.css', '/assets/api.js', '/assets/i18n-app.js', '/assets/icon.svg', '/assets/icon-192.png', '/app/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // API, Dateien und alles Fremde nie aus dem Cache
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/files/')) return;
  // Netz zuerst, bei Funkloch die gespeicherte Version
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && SHELL.includes(u.pathname)) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('/app/') : Response.error())))
  );
});
