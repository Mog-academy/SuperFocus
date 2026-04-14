const CACHE = 'superfocus-v8';
const BASE = '/SuperFocus';
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/404.html',
  BASE + '/manifest.json',
  BASE + '/icons/icon-192.png',
  BASE + '/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Let API/push requests go straight to network — never cache them
  if (!url.startsWith(self.location.origin)) return;

  // For navigation, serve cached index.html (offline support)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match(BASE + '/index.html')
        .then(r => r || fetch(BASE + '/index.html'))
    );
    return;
  }

  // Only cache known static assets; everything else hits the network
  const isStaticAsset = ASSETS.some(a => url.endsWith(a));
  if (!isStaticAsset) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }))
  );
});

// ── Handle incoming Web Push from server ─────────────────────
self.addEventListener('push', e => {
  let data = { title: 'SuperFocus', body: 'Open SuperFocus — time to log today!' };
  try { data = e.data.json(); } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:     data.body,
      icon:     BASE + '/icons/icon-192.png',
      badge:    BASE + '/icons/icon-192.png',
      vibrate:  [200, 100, 200],
      tag:      'superfocus-daily',
      renotify: true,
    })
  );
});

// ── Notification click: open the app ─────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('/SuperFocus') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(BASE + '/');
    })
  );
});
