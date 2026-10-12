/* Service worker: precache the app shell, serve cache-first, update in the background. */
importScripts('./js/version.js');

const CACHE = 'fmm-' + self.APP_VERSION;
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/styles.css',
  './js/version.js', './js/app.js', './js/db.js', './js/models.js', './js/categories.js',
  './js/transactions.js', './js/budgets.js', './js/recurring.js', './js/reports.js',
  './js/holdings.js', './js/csvimport.js', './js/sync.js', './js/livesync.js', './js/hubfile.js', './js/lock.js',
  './js/ui/components.js', './js/ui/shared-screens.js', './js/ui/position-screens.js', './js/ui/settings-screens.js', './js/ui/member-screens.js', './js/ui/hub-screens.js',
  './js/vendor/chart.min.js', './js/vendor/peerjs.min.js',
  './icons/icon-192.png', './icons/apple-touch-icon.png', './icons/logo-160.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  // No skipWaiting here: the app asks the user first ("Update available - tap to refresh").
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fmm-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
