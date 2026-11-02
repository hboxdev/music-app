import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDB });
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    storage: {
      estimate: async () => ({ usage: 4096, quota: 1024 * 1024 }),
      persist: async () => true,
    },
  },
});

test('offline audio persists across a fresh module instance and can be deleted', async () => {
  const first = await import('../src/app/offline.js?first');
  const song = { id: 'test_track', title: 'Persistence test' };
  const original = new Blob(['offline-audio-bytes'], { type: 'audio/mpeg' });

  const saved = await first.saveBlob(song, original);
  assert.equal(saved.size, original.size);
  assert.deepEqual([...await first.listSaved()], [song.id]);

  // A cache-busting import simulates the application module being recreated
  // after a refresh while IndexedDB retains its durable browser data.
  const reopened = await import('../src/app/offline.js?reopened');
  const restored = await reopened.savedBlob(song.id);
  assert.ok(restored instanceof Blob);
  assert.equal(await restored.text(), 'offline-audio-bytes');

  const quota = await reopened.storageInfo();
  assert.equal(quota.available, 1024 * 1024 - 4096);

  await reopened.removeOffline(song.id);
  assert.equal(await reopened.savedBlob(song.id), null);
  assert.equal((await reopened.listSaved()).size, 0);
});
