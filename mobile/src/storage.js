import AsyncStorage from '@react-native-async-storage/async-storage';

// The whole library is saved on the phone as one JSON value
const KEY = 'tubetunes:library:v1';

export const emptyLibrary = { songs: [], playlists: [], account: null, syncedAt: null };

export async function loadLibrary() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) return { ...emptyLibrary, ...JSON.parse(raw) };
  } catch {}
  return emptyLibrary;
}

export function saveLibrary(data) {
  return AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {});
}
