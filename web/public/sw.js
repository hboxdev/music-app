// Service worker for the installed web app (/app/).
// Keeps the app's own files so it opens quickly and still starts without
// internet. Music, YouTube and Google requests are never touched.
// Songs saved for offline listening live in IndexedDB (see
// src/app/offline.js), independent from this replaceable app-shell cache.
const CACHE = 'tubetunes-v8';
const APP = new URL('./app/', self.location).href;

async function cacheWithImports(url, cache, seen) {
  if (seen.has(url)) return;
  seen.add(url);
  const response = await fetch(url, { cache: 'reload' });
  if (!response.ok) return;
  await cache.put(url, response.clone());
  if (!new URL(url).pathname.endsWith('.js')) return;

  // Vite may split React and other shared code into imported chunks that do
  // not appear in index.html. Follow those same-origin module imports so the
  // app can hydrate on the very first offline launch.
  const source = await response.text();
  const imports = [...source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], url).href)
    .filter((item) => item.startsWith(self.location.origin));
  await Promise.all(imports.map((item) => cacheWithImports(item, cache, seen).catch(() => {})));
}

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
  const seen = new Set([APP]);
  await Promise.all([...new Set(files)].map((u) => cacheWithImports(u, cache, seen).catch(() => {})));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('tubetunes-v') && key !== CACHE).map((key) => caches.delete(key))))
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
        .catch(() => caches.match(APP, { ignoreVary: true }))
    );
    return;
  }

  // Built files have a hash in their name and never change, so the cache wins
  if (url.pathname.includes('/assets/') || url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(req, { ignoreVary: true }).then(
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
  event.respondWith(fetch(req).catch(() => caches.match(req, { ignoreVary: true }).then((hit) => hit || Response.error())));
});
