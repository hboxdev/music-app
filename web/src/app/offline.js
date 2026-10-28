// Songs saved for offline listening, kept inside this browser (Cache Storage),
// not in the Downloads folder. Only songs whose owners allow downloads are
// saved (see canDownload in sources.js).
const CACHE = 'tubetunes-songs';
const PREFIX = 'offline-songs/';

export const offlineSupported = typeof caches !== 'undefined';

const keyFor = (id) => new URL(PREFIX + encodeURIComponent(id), location.href).href;
const idOf = (url) => decodeURIComponent(url.slice(url.indexOf(PREFIX) + PREFIX.length));

// IDs of every saved song
export async function listSaved() {
  if (!offlineSupported) return new Set();
  const keys = await (await caches.open(CACHE)).keys();
  return new Set(keys.map((r) => idOf(r.url)));
}

// Tries each link in turn and keeps the first one that gives audio
export async function saveOffline(song, urls) {
  if (!offlineSupported) throw new Error('This browser can’t keep songs for offline listening.');
  let blob = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const b = await res.blob();
      if (b.size && !b.type.startsWith('text/')) {
        blob = b;
        break;
      }
    } catch {}
  }
  if (!blob) throw new Error('download failed');
  const cache = await caches.open(CACHE);
  await cache.put(keyFor(song.id), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } }));
  // Ask the browser not to clear saved songs when the device runs low on space
  try {
    await navigator.storage.persist();
  } catch {}
}

export async function savedBlob(id) {
  if (!offlineSupported) return null;
  const res = await (await caches.open(CACHE)).match(keyFor(id));
  return res ? res.blob() : null;
}

export async function removeOffline(id) {
  if (!offlineSupported) return;
  await (await caches.open(CACHE)).delete(keyFor(id));
}
