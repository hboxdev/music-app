// Offline copies of songs, stored inside the app (Documents/downloads).
// Only songs whose owners allow downloads are saved (see canDownload in sources.js).
import { Directory, File, Paths } from 'expo-file-system';

function folder() {
  const dir = new Directory(Paths.document, 'downloads');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const fileNameFor = (song) => `${song.id.replace(/[^A-Za-z0-9_-]/g, '_')}.mp3`;

// Downloads the song and returns the local file's URI
export async function saveOffline(song) {
  const target = new File(folder(), fileNameFor(song));
  const file = await File.downloadFileAsync(song.downloadUrl, target, { idempotent: true });
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
