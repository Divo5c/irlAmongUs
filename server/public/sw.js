/* App shell: install (add to home screen). Network-first so deploys land
   immediately; cache only as offline fallback. */
const CACHE = 'rlaus-shell-v73';
const VERSION = '19.17.0';
const ASSETS = [
  '/',
  '/css/style.css',
  '/css/styles/tokens.css',
  '/css/styles/base.css',
  '/css/styles/components.css',
  '/css/styles/screens/editor.css',
  '/css/styles/screens/hud.css',
  '/css/styles/screens/tasks.css',
  '/css/styles/screens/moments.css',
  '/css/styles/screens/meeting.css',
  '/css/styles/terminal.css',
  '/css/styles/motion.css',
  '/css/styles/fonts/nunito-latin.woff2',
  ...['osm', 'mapEditor', 'tasks', 'app'].map((name) => `/js/${name}.js?v=${VERSION}`),
  '/js/ui.js',
  '/socket.io/socket.io.js',
  '/manifest.webmanifest',
  '/icons/terminal.svg',
  '/img/terminal.svg',
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
  const socketTransport = url.pathname.startsWith('/socket.io') && url.pathname !== '/socket.io/socket.io.js';
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || socketTransport) {
    return;
  }
  // Network first: deploy == instant update for every reload.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && ASSETS.includes(url.pathname + url.search)) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(async () => (await caches.match(event.request))
        ?? (event.request.mode === 'navigate' ? await caches.match('/') : Response.error())
        ?? Response.error()),
  );
});
