// Service worker for the installed web app (/app/).
// Keeps the app's own files so it opens quickly and still starts without
// internet. Music, YouTube and Google requests are never touched.
const CACHE = 'tubetunes-v1';
const APP = new URL('./app/', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pages: always try the network first so updates show up straight away
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(APP, copy));
          }
          return res;
        })
        .catch(() => caches.match(APP))
    );
    return;
  }

  // Built files have a hash in their name and never change, so the cache wins
  if (url.pathname.includes('/assets/') || url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});
