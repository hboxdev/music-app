// Music sources whose tracks are real audio streams (they keep playing when
// the phone is locked), plus helpers that work for every kind of song.
//
// A song is { id, source, title, artist, artwork?, duration?, ... }
//   source 'youtube' (or missing, for older saved songs): id is the YouTube video ID
//   source 'audius':  id 'au_<trackId>', trackId, pageUrl
//   source 'jamendo': id 'ja_<trackId>', trackId, streamUrl, pageUrl
//   source 'url':     id 'url_<hash>', streamUrl (a direct audio link)
import { thumbUrl } from './youtube';

const APP_NAME = 'TubeTunes';
const AUDIUS = 'https://api.audius.co/v1';
const JAMENDO = 'https://api.jamendo.com/v3.0';

export const SOURCE_LABELS = { youtube: 'YouTube', audius: 'Audius', jamendo: 'Jamendo', url: 'Link' };

export const isYouTube = (song) => !!song && (!song.source || song.source === 'youtube');
export const sourceOf = (song) => (isYouTube(song) ? 'youtube' : song.source);
export const artworkOf = (song) => (song.artwork ? song.artwork : isYouTube(song) ? thumbUrl(song.id) : null);

export function streamUrlOf(song) {
  if (song.source === 'audius') return `${AUDIUS}/tracks/${song.trackId}/stream?app_name=${APP_NAME}`;
  return song.streamUrl || null;
}

export function pageUrlOf(song) {
  if (isYouTube(song)) return `https://www.youtube.com/watch?v=${song.id}`;
  return song.pageUrl || song.streamUrl || null;
}

// ---------- Audius (no key needed) ----------

function fromAudius(t) {
  return {
    id: `au_${t.id}`,
    source: 'audius',
    trackId: t.id,
    title: t.title,
    artist: (t.user && t.user.name) || '',
    artwork: (t.artwork && (t.artwork['480x480'] || t.artwork['150x150'])) || null,
    duration: t.duration || 0,
    pageUrl: t.permalink ? `https://audius.co${t.permalink}` : null,
  };
}

async function audius(path, params = {}) {
  const res = await fetch(`${AUDIUS}/${path}?${new URLSearchParams({ app_name: APP_NAME, ...params })}`);
  if (!res.ok) throw new Error(`Audius is not responding (${res.status}). Try again later.`);
  const json = await res.json();
  return json.data;
}

const streamable = (list) => (list || []).filter((t) => t && t.is_streamable !== false && t.title);

export async function searchAudius(query, limit = 25) {
  return streamable(await audius('tracks/search', { query, limit })).map(fromAudius);
}

export async function trendingAudius(limit = 25) {
  return streamable(await audius('tracks/trending', { limit })).map(fromAudius);
}

export const isAudiusLink = (url) => /^https?:\/\/(www\.)?audius\.co\/[^/]+\/[^/?#]+/i.test(url || '');

export async function resolveAudius(url) {
  const t = await audius('resolve', { url });
  return t && t.title && t.user ? fromAudius(t) : null;
}

// ---------- Jamendo (free client ID from jamendo.com/developers) ----------

function fromJamendo(t) {
  return {
    id: `ja_${t.id}`,
    source: 'jamendo',
    trackId: t.id,
    title: t.name,
    artist: t.artist_name || '',
    artwork: t.image || t.album_image || null,
    duration: t.duration || 0,
    streamUrl: t.audio,
    pageUrl: t.shareurl || `https://www.jamendo.com/track/${t.id}`,
  };
}

async function jamendo(params, clientId) {
  if (!clientId) throw new Error('Jamendo is not set up yet: add a free Jamendo Client ID.');
  const res = await fetch(
    `${JAMENDO}/tracks/?${new URLSearchParams({ client_id: clientId, format: 'json', audioformat: 'mp32', ...params })}`
  );
  const json = await res.json().catch(() => null);
  if (!json || !json.headers || json.headers.status !== 'success') {
    throw new Error(
      json && json.headers && json.headers.code === 5
        ? 'The Jamendo Client ID is not valid.'
        : 'Jamendo is not responding. Try again later.'
    );
  }
  return (json.results || []).filter((t) => t.audio).map(fromJamendo);
}

export const searchJamendo = (query, clientId, limit = 25) => jamendo({ search: query, limit }, clientId);
export const popularJamendo = (clientId, limit = 25) => jamendo({ order: 'popularity_week', limit }, clientId);

export function extractJamendoId(url) {
  const m = (url || '').match(/jamendo\.com\/(?:[a-z]{2}\/)?track\/(\d+)/i);
  return m ? m[1] : null;
}

export async function jamendoTrack(id, clientId) {
  const list = await jamendo({ id }, clientId);
  return list[0] || null;
}

// ---------- Direct audio links ----------

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function directAudioSong(url) {
  if (!/^https?:\/\//i.test(url || '')) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const file = decodeURIComponent(u.pathname.split('/').pop() || '');
  const title = file.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_]+/g, ' ').trim();
  return { id: `url_${hash(url)}`, source: 'url', title: title || 'Audio link', artist: u.hostname, streamUrl: url };
}
