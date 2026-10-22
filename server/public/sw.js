/* App shell cache: install (add to home screen) + offline start. */
const CACHE = 'rlaus-shell-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/osm.js',
  '/js/mapEditor.js',
  '/js/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never cache Socket.IO / realtime traffic or cross-origin requests.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/socket.io')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});
