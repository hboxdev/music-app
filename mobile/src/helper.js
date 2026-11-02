// Your own download helper (the helper/ folder, running on your PC with yt-dlp).
// It is set only on this phone (long-press "TubeTunes" at the top), so other
// people's copies of the app never offer YouTube downloads.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'tubetunes:helper';

export async function loadHelperConfig() {
  try {
    const c = JSON.parse(await AsyncStorage.getItem(KEY));
    return c && c.url && c.password ? c : null;
  } catch {
    return null;
  }
}

export function saveHelperConfig(c) {
  return (c ? AsyncStorage.setItem(KEY, JSON.stringify(c)) : AsyncStorage.removeItem(KEY)).catch(() => {});
}

// "my-pc.tailnet.ts.net" → "https://my-pc.tailnet.ts.net"
export const normalizeHelperUrl = (url) => {
  const u = url.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
};

export const helperHeaders = (c) => ({ Authorization: `Bearer ${c.password}` });
export const helperAudioUrl = (c, videoId) => `${c.url}/audio/${videoId}`;

export async function testHelper(c) {
  let res;
  try {
    res = await fetch(`${c.url}/health`, { headers: helperHeaders(c) });
  } catch {
    throw new Error('Can’t reach your download helper. Check that it’s running on your PC and that Tailscale is on.');
  }
  if (res.status === 401) throw new Error('Wrong download helper password.');
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.app !== 'tubetunes-helper') throw new Error('That address isn’t a TubeTunes download helper.');
  return j;
}

// The helper's error message for a failed download, if it gave one
export async function helperError(c, videoId) {
  try {
    const res = await fetch(helperAudioUrl(c, videoId), { method: 'GET', headers: helperHeaders(c) });
    if (res.ok) return null;
    const j = await res.json().catch(() => ({}));
    return j.error || null;
  } catch {
    return 'Can’t reach your download helper. Check that it’s running on your PC and that Tailscale is on.';
  }
}
