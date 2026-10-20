// Служебный скрипт: принимает уведомления и открывает приложение по нажатию.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: 'НА МЕСТЕ', body: event.data ? event.data.text() : '' };
  }
  const isDriver = (d.url || '').startsWith('/driver');
  event.waitUntil(
    self.registration.showNotification(d.title || 'НА МЕСТЕ', {
      body: d.body || '',
      tag: d.tag,
      renotify: Boolean(d.tag) && d.priority !== 'info',
      requireInteraction: d.priority === 'critical',
      icon: isDriver ? '/icons/driver-192.png' : '/icons/parent-192.png',
      data: { url: d.url || '/' },
      lang: 'ru',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
