// Service worker for the installed web app (/app/).
// Keeps the app's own files so it opens quickly and still starts without
// internet. Music, YouTube and Google requests are never touched.
// Songs saved for offline listening live in their own cache (see
// src/app/offline.js), which this file never deletes.
const CACHE = 'tubetunes-v2';
const APP = new URL('./app/', self.location).href;

// Saves the app page and every file it links to (scripts, styles, icons),
// so the app opens offline right after the first visit
async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch(APP, { cache: 'reload' });
  if (!res.ok) return;
  await cache.put(APP, res.clone());
  const html = await res.text();
  const files = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => new URL(m[1], APP).href)
    .filter((u) => u.startsWith(self.location.origin));
  await Promise.all([...new Set(files)].map((u) => cache.add(u).catch(() => {})));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tubetunes-v') && k !== CACHE).map((k) => caches.delete(k))))
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
    return;
  }

  // Anything else of ours (favicon, manifest): network, or the saved copy offline
  event.respondWith(fetch(req).catch(() => caches.match(req).then((hit) => hit || Response.error())));
});
