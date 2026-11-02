// Offline copies of songs, stored inside the app (Documents/downloads).
// Songs whose owners allow downloads (see canDownload in sources.js), and
// YouTube songs through your own download helper (see helper.js).
import { Directory, File, Paths } from 'expo-file-system';

function folder() {
  const dir = new Directory(Paths.document, 'downloads');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const fileNameFor = (song, ext) => `${song.id.replace(/[^A-Za-z0-9_-]/g, '_')}.${ext}`;

// Downloads the song and returns the local file's URI.
// source: { url, headers, ext }; by default the song's own download link.
export async function saveOffline(song, source = { url: song.downloadUrl, ext: 'mp3' }) {
  const target = new File(folder(), fileNameFor(song, source.ext || 'mp3'));
  const file = await File.downloadFileAsync(source.url, target, { idempotent: true, headers: source.headers });
  if (!file.exists || !file.size) throw new Error('The download was empty.');
  return file.uri;
}

export function isSavedFile(uri) {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export function removeOffline(uri) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}
