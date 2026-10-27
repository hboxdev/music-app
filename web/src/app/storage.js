// The library is saved in this browser
const KEY = 'tubetunes:library:v1';

export const emptyLibrary = { songs: [], playlists: [], account: null, syncedAt: null };

export function loadLibrary() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyLibrary, ...JSON.parse(raw) };
  } catch {}
  return emptyLibrary;
}

export function saveLibrary(lib) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib));
  } catch {}
}
