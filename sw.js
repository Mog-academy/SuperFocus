const CACHE = 'superfocus-v4';
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
  if (!e.request.url.startsWith(self.location.origin)) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match(BASE + '/index.html')
        .then(r => r || fetch(BASE + '/index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }))
  );
});

// ── Notification scheduling ───────────────────────────────────
const NOTIF_HOURS = [6, 12, 18]; // 6am, 12pm, 6pm
let notifTimers = [];

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SCHEDULE_NOTIFS') {
    scheduleNotifications(e.data.text);
  }
});

function scheduleNotifications(focusText) {
  // Clear any previously scheduled timers
  notifTimers.forEach(id => clearTimeout(id));
  notifTimers = [];

  const now = new Date();
  const body = focusText
    ? `Today's focus on: ${focusText}`
    : 'Time to update your SuperFocus for today!';

  NOTIF_HOURS.forEach(hour => {
    const target = new Date(now);
    target.setHours(hour, 0, 0, 0);
    const ms = target - now;

    if (ms > 0) {
      const id = setTimeout(() => {
        self.registration.showNotification('SuperFocus', {
          body,
          icon: BASE + '/icons/icon-192.png',
          badge: BASE + '/icons/icon-192.png',
          tag: `superfocus-${hour}`,
          renotify: true,
          vibrate: [200, 100, 200]
        });
      }, ms);
      notifTimers.push(id);
    }
  });
}

// Re-open the app when notification is tapped
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
