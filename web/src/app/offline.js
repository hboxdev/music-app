// Persistent offline audio storage. Metadata stays in the existing library;
// the audio Blob itself lives in IndexedDB so it survives reloads and browser
// restarts without mixing user downloads into the service worker's app cache.
const DB_NAME = 'tubetunes-offline';
const DB_VERSION = 1;
const STORE = 'audio';
const LEGACY_CACHE = 'tubetunes-songs';
const LEGACY_PREFIX = 'offline-songs/';

export const offlineSupported = typeof indexedDB !== 'undefined';

let opening;
function database() {
  if (!offlineSupported) return Promise.reject(new Error('This browser does not support persistent offline audio storage.'));
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open offline storage.'));
    request.onblocked = () => reject(new Error('Offline storage is busy in another tab. Close other TubeTunes tabs and try again.'));
  });
  return opening;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Offline storage failed.'));
  });
}

async function objectStore(mode = 'readonly') {
  return (await database()).transaction(STORE, mode).objectStore(STORE);
}

function friendlyStorageError(error) {
  if (error?.name === 'QuotaExceededError') {
    return new Error('This browser is out of storage space. Remove a download or free device storage, then try again.');
  }
  return error instanceof Error ? error : new Error('Could not save this audio for offline playback.');
}

const legacyId = (url) => {
  const at = url.indexOf(LEGACY_PREFIX);
  return at < 0 ? null : decodeURIComponent(url.slice(at + LEGACY_PREFIX.length));
};

// Existing users previously stored songs in Cache Storage. Migrate those
// copies once, preserving their IDs, and remove only the dedicated old cache.
async function migrateLegacyCache() {
  if (typeof caches === 'undefined') return;
  const names = await caches.keys();
  if (!names.includes(LEGACY_CACHE)) return;
  const cache = await caches.open(LEGACY_CACHE);
  for (const key of await cache.keys()) {
    const id = legacyId(key.url);
    if (!id) continue;
    const existing = await requestResult((await objectStore()).get(id));
    if (existing) continue;
    const response = await cache.match(key);
    if (!response) continue;
    const blob = await response.blob();
    if (blob.size) {
      await requestResult((await objectStore('readwrite')).put({ id, blob, size: blob.size, type: blob.type, savedAt: Date.now() }));
    }
  }
  await caches.delete(LEGACY_CACHE);
}

let migrated;
async function ready() {
  await database();
  if (!migrated) migrated = migrateLegacyCache().catch(() => {});
  await migrated;
}

export async function listSaved() {
  if (!offlineSupported) return new Set();
  await ready();
  return new Set(await requestResult((await objectStore()).getAllKeys()));
}

async function audioBlob(response, onProgress, signal) {
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !onProgress) return response.blob();
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new DOMException('Download cancelled', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress({ received, total, percent: total ? Math.min(100, Math.round((received / total) * 100)) : null });
  }
  return new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });
}

// Tries each authorized link and stores the first response that is audio.
export async function saveOffline(song, urls, onProgress, { signal } = {}) {
  if (!offlineSupported) throw new Error('This browser cannot keep songs for offline listening.');
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`The audio server returned ${response.status}.`);
      const blob = await audioBlob(response, onProgress, signal);
      if (!blob.size || blob.type.startsWith('text/') || blob.type.includes('json')) throw new Error('The source did not return an audio file.');
      return await saveBlob(song, blob);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError || new Error('Download failed. The source may block browser downloads.');
}

export async function saveBlob(song, blob) {
  if (!offlineSupported) throw new Error('This browser cannot keep songs for offline listening.');
  await ready();
  try {
    const record = { id: song.id, blob, size: blob.size, type: blob.type || 'audio/mpeg', savedAt: Date.now() };
    await requestResult((await objectStore('readwrite')).put(record));
    try {
      await navigator.storage?.persist?.();
    } catch {}
    return { size: record.size, type: record.type, savedAt: record.savedAt };
  } catch (error) {
    throw friendlyStorageError(error);
  }
}

export async function savedBlob(id) {
  if (!offlineSupported) return null;
  await ready();
  const record = await requestResult((await objectStore()).get(id));
  return record?.blob || null;
}

export async function removeOffline(id) {
  if (!offlineSupported) return;
  await ready();
  await requestResult((await objectStore('readwrite')).delete(id));
}

export async function storageInfo() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota, available: Math.max(0, quota - usage) };
}
