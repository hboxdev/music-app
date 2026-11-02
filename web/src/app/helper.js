// Your own download helper (the helper/ folder, running on your PC with yt-dlp).
// It is set only in this browser, so the public site never offers YouTube downloads.
const KEY = 'tubetunes:helper';

export function helperConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    return c && c.url && c.password ? c : null;
  } catch {
    return null;
  }
}

export function saveHelperConfig(c) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {}
}

// "localhost:7777" → "http://localhost:7777"
export const normalizeHelperUrl = (url) => {
  const u = url.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(u) ? u : `http://${u}`;
};

async function call(c, path) {
  let res;
  try {
    res = await fetch(`${c.url}${path}`, { headers: { Authorization: `Bearer ${c.password}` } });
  } catch {
    throw new Error('Can’t reach your download helper. Check that it’s running on your PC.');
  }
  if (res.status === 401) throw new Error('Wrong download helper password.');
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Download helper error ${res.status}`);
  }
  return res;
}

export async function testHelper(c) {
  const j = await (await call(c, '/health')).json();
  if (j.app !== 'tubetunes-helper') throw new Error('That address isn’t a TubeTunes download helper.');
  return j;
}

// The audio of a YouTube video, as a file
export async function helperAudio(c, videoId) {
  return (await call(c, `/audio/${videoId}`)).blob();
}
