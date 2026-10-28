// Song lyrics from LRCLIB (https://lrclib.net): free, no key needed.
// Most popular songs have a time for every line, so the current line can be
// shown as the song plays. The same file is used by the website and the phone app.
//
// Lyrics are { synced: [{ t, text }] | null, plain: string, instrumental: bool }

const API = 'https://lrclib.net/api';
const RETRY_MISSING_AFTER = 7 * 24 * 3600 * 1000; // look again for songs that had none

// Words YouTube uploaders add to titles: (Official Video), [Lyrics], | T-Series …
const TAGS = /\s*[([][^)\]]*\b(official|video|audio|lyrics?|lyrical|full song|hd|4k|visuali[sz]er|remaster(ed)?|explicit|from|feat\.?|ft\.?|prod\.?)\b[^)\]]*[)\]]/gi;
const TAIL = /\s*(official\s*(music\s*)?(video|audio)|lyrical(\s*video)?|full\s*(video|song|audio)|with lyrics|lyrics?)\s*$/i;

export function cleanTitle(title) {
  return (title || '')
    .replace(TAGS, '')
    .replace(/\s*[|｜•].*$/, '')
    .replace(/\s+(feat\.?|ft\.?)\s.*$/i, '')
    .replace(TAIL, '')
    .replace(/[\s\-–—:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "[01:02.50] words" lines → [{ t: 62.5, text: 'words' }]
export function parseLrc(text) {
  const lines = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: words });
  }
  return lines.sort((a, b) => a.t - b.t);
}

// The line playing at a given time (-1 before the first line)
export function activeLine(lines, time) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= time + 0.25) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

async function search(params, retry = true) {
  let res;
  try {
    res = await fetch(`${API}/search?${new URLSearchParams(params)}`);
  } catch {
    throw new Error('Couldn’t load lyrics. Check your internet connection.');
  }
  if (!res.ok && retry) {
    // The service sometimes fails for a moment under load
    await new Promise((r) => setTimeout(r, 1200));
    return search(params, false);
  }
  if (!res.ok) throw new Error('The lyrics service isn’t responding. Try again later.');
  const list = await res.json();
  return list.filter((x) => x.instrumental || x.syncedLyrics || x.plainLyrics);
}

// Prefers lyrics with timings, then the version closest in length
function best(list, duration) {
  const score = (x) => (x.syncedLyrics ? 0 : 20) + (duration ? Math.min(Math.abs((x.duration || 0) - duration), 60) : 0);
  return list.reduce((a, b) => (score(b) < score(a) ? b : a));
}

export async function findLyrics(title, artist, duration = 0) {
  const name = cleanTitle(title);
  if (!name) return null;
  // YouTube titles are often "Artist - Song" from a label's channel
  const [left, right] = name.includes(' - ') ? name.split(' - ', 2).map((s) => s.trim()) : [];
  const tries = [
    artist && { track_name: name, artist_name: artist },
    right && { track_name: right, artist_name: left },
    right && { track_name: left, artist_name: right },
    artist && { q: `${right || name} ${artist}` },
    { q: right || name },
  ].filter(Boolean);
  let error = null;
  for (const params of tries) {
    let list;
    try {
      list = await search(params);
    } catch (e) {
      error = e; // try the next way of asking
      continue;
    }
    if (!list.length) continue;
    const x = best(list, duration);
    const synced = x.syncedLyrics ? parseLrc(x.syncedLyrics) : null;
    return {
      synced: synced && synced.length ? synced : null,
      plain: (x.plainLyrics || '').trim(),
      instrumental: !!x.instrumental,
    };
  }
  // Only "not found" when the service answered; errors must not be saved as missing lyrics
  if (error) throw error;
  return null;
}

// store: { get(key), set(key, value) }, either may be async. Saved lyrics also show offline.
export async function getLyrics(song, duration, store) {
  const key = `tubetunes:lyrics:${song.id}`;
  const saved = store ? await store.get(key) : null;
  if (saved && (saved.found || Date.now() - saved.at < RETRY_MISSING_AFTER)) return saved.found ? saved : null;
  const found = await findLyrics(song.title, song.artist, song.duration || duration);
  const entry = found ? { found: true, ...found } : { found: false, at: Date.now() };
  if (store) await store.set(key, entry);
  return found ? entry : null;
}
