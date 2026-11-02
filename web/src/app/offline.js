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
async function audioBlob(res, onProgress) {
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress({ received, total, percent: total ? Math.round((received / total) * 100) : null });
  }
  return new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' });
}

export async function saveOffline(song, urls, onProgress) {
  if (!offlineSupported) throw new Error('This browser can’t keep songs for offline listening.');
  let blob = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const b = await audioBlob(res, onProgress);
      if (b.size && !b.type.startsWith('text/')) {
        blob = b;
        break;
      }
    } catch {}
  }
  if (!blob) throw new Error('download failed');
  return saveBlob(song, blob);
}

// Keeps an audio file the app already has (for example from the download helper)
export async function saveBlob(song, blob) {
  if (!offlineSupported) throw new Error('This browser can’t keep songs for offline listening.');
  const cache = await caches.open(CACHE);
  await cache.put(keyFor(song.id), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } }));
  // Ask the browser not to clear saved songs when the device runs low on space
  try {
    await navigator.storage.persist();
  } catch {}
  return { size: blob.size, type: blob.type || 'audio/mpeg' };
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
