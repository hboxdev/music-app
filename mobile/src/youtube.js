// Reading YouTube links and looking up song details (no sign-in needed)

export function extractVideoId(input) {
  const s = (input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

export function extractPlaylistId(input) {
  const m = (input || '').match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export const thumbUrl = (videoId) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

// Auto-generated music channels are named "Artist - Topic"
export const cleanArtist = (name) => (name || '').replace(/\s+-\s+Topic$/i, '');

async function oembed(url) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchVideoInfo(videoId) {
  const j = await oembed(`https://www.youtube.com/watch?v=${videoId}`);
  return j && j.title ? { title: j.title, artist: cleanArtist(j.author_name) } : null;
}

// Looks up many videos, 8 at a time. Returns { videoId: info } for the ones found.
export async function fetchManyVideoInfo(ids, onProgress) {
  const results = {};
  for (let i = 0; i < ids.length; i += 8) {
    const chunk = ids.slice(i, i + 8);
    const infos = await Promise.all(chunk.map(fetchVideoInfo));
    chunk.forEach((id, k) => {
      if (infos[k]) results[id] = infos[k];
    });
    onProgress && onProgress(Math.min(i + 8, ids.length), ids.length);
  }
  return results;
}

export async function fetchPlaylistTitle(listId) {
  const j = await oembed(`https://www.youtube.com/playlist?list=${listId}`);
  return (j && j.title) || null;
}
