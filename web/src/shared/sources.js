// Music sources whose tracks are real audio streams (they keep playing when
// the phone is locked), plus helpers that work for every kind of song.
//
// A song is { id, source, title, artist, artwork?, duration?, ... }
//   source 'youtube' (or missing, for older saved songs): id is the YouTube video ID
//   source 'audius':  id 'au_<trackId>', trackId, pageUrl
//   source 'jamendo': id 'ja_<trackId>', trackId, streamUrl, pageUrl
//   source 'archive': id 'ia_<hash>', identifier, streamUrl, pageUrl (one file of an Internet Archive item)
//   source 'radio':   id 'radio_<stationuuid>', streamUrl, live: true (a live radio station)
//   source 'url':     id 'url_<hash>', streamUrl (a direct audio link)
import { thumbUrl } from './youtube';

const APP_NAME = 'TubeTunes';
const AUDIUS = 'https://api.audius.co/v1';
const JAMENDO = 'https://api.jamendo.com/v3.0';
const ARCHIVE = 'https://archive.org';
const RADIO_HOSTS = ['de1', 'de2', 'all'].map((h) => `https://${h}.api.radio-browser.info/json`);

export const SOURCE_LABELS = { youtube: 'YouTube', audius: 'Audius', jamendo: 'Jamendo', archive: 'Archive', radio: 'Radio', url: 'Link' };

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
    // Only when the artist turned downloads on with no conditions (follow, purchase…)
    downloadUrl:
      t.is_downloadable && !t.download_conditions && !t.is_download_gated
        ? `${AUDIUS}/tracks/${t.id}/download?app_name=${APP_NAME}`
        : null,
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
    // Jamendo marks whether the artist's licence allows downloads
    downloadUrl: t.audiodownload_allowed ? t.audiodownload || t.audio : null,
    license: t.license_ccurl || null,
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

// Jamendo's search sometimes returns nothing for a query that works a moment
// later, so this asks two ways at once (all fields + track names), merges the
// results, and retries once if both come back empty.
export async function searchJamendo(query, clientId, limit = 25) {
  const once = async () => {
    const [all, names] = await Promise.all([
      jamendo({ search: query, limit }, clientId),
      jamendo({ namesearch: query, limit }, clientId).catch(() => []),
    ]);
    const seen = new Set();
    return [...all, ...names].filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, limit);
  };
  const first = await once();
  if (first.length) return first;
  await new Promise((r) => setTimeout(r, 500));
  return once();
}
export async function popularJamendo(clientId, limit = 25) {
  const first = await jamendo({ order: 'popularity_week', limit }, clientId);
  if (first.length) return first;
  await new Promise((r) => setTimeout(r, 500));
  return jamendo({ order: 'popularity_week', limit }, clientId);
}

export function extractJamendoId(url) {
  const m = (url || '').match(/jamendo\.com\/(?:[a-z]{2}\/)?track\/(\d+)/i);
  return m ? m[1] : null;
}

export async function jamendoTrack(id, clientId) {
  const list = await jamendo({ id }, clientId);
  return list[0] || null;
}

// ---------- Internet Archive (no key needed) ----------
// An archive item is an album, concert or single upload; each MP3 file in it
// becomes one song. Searches stay inside the music collections, so audiobooks
// and podcasts don't show up.

const ARCHIVE_MUSIC =
  'mediatype:audio AND collection:(netlabels OR etree OR audio_music OR opensource_audio OR 78rpm OR georgeblood)' +
  ' AND -collection:(podcasts OR librivoxaudio OR audio_bookspoetry)';
const ITEMS_PER_SEARCH = 8;
const TRACKS_PER_ITEM = 4;

const archiveFileUrl = (identifier, name) =>
  `${ARCHIVE}/download/${identifier}/${name.split('/').map(encodeURIComponent).join('/')}`;

function seconds(length) {
  if (!length) return 0;
  if (String(length).includes(':')) return String(length).split(':').reduce((t, part) => t * 60 + Number(part || 0), 0);
  return Math.round(Number(length)) || 0;
}

const firstOf = (v) => (Array.isArray(v) ? v[0] : v) || '';

// The item's MP3 files in track order: the uploaded MP3s, or else the MP3
// copies the Archive made of other formats
function mp3Files(files) {
  const mp3 = (files || []).filter((f) => /\.mp3$/i.test(f.name) && /mp3/i.test(f.format || ''));
  const originals = mp3.filter((f) => f.source === 'original');
  const vbr = mp3.filter((f) => /vbr/i.test(f.format));
  const list = originals.length ? originals : vbr.length ? vbr : mp3;
  const num = (f) => parseInt(firstOf(f.track), 10) || 0;
  return list.sort((a, b) => num(a) - num(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function fromArchiveFile(identifier, meta, f) {
  const streamUrl = archiveFileUrl(identifier, f.name);
  const fileTitle = f.name.split('/').pop().replace(/\.mp3$/i, '').replace(/_+/g, ' ').trim();
  return {
    id: `ia_${hash(`${identifier}/${f.name}`)}`,
    source: 'archive',
    identifier,
    title: (firstOf(f.title) || fileTitle).trim(),
    artist: (firstOf(f.creator) || firstOf(f.artist) || firstOf(meta.creator) || firstOf(meta.title)).trim(),
    artwork: `${ARCHIVE}/services/img/${identifier}`,
    duration: seconds(f.length),
    streamUrl,
    pageUrl: `${ARCHIVE}/details/${identifier}`,
    // Everything on the Archive is shared for free download
    downloadUrl: streamUrl,
    license: meta.licenseurl || null,
  };
}

// Every MP3 in one item, as songs
export async function archiveItemTracks(identifier, limit = 200) {
  const res = await fetch(`${ARCHIVE}/metadata/${encodeURIComponent(identifier)}`);
  if (!res.ok) throw new Error('The Internet Archive is not responding. Try again later.');
  const item = await res.json();
  if (!item || !item.metadata) return { title: null, songs: [] };
  return {
    title: firstOf(item.metadata.title) || identifier,
    songs: mp3Files(item.files).slice(0, limit).map((f) => fromArchiveFile(identifier, item.metadata, f)),
  };
}

async function archiveSearch(q, sort, limit) {
  const p = new URLSearchParams({ q, rows: String(ITEMS_PER_SEARCH), output: 'json' });
  p.append('fl[]', 'identifier');
  p.append('sort[]', sort);
  const res = await fetch(`${ARCHIVE}/advancedsearch.php?${p}`);
  if (!res.ok) throw new Error(`The Internet Archive is not responding (${res.status}). Try again later.`);
  const ids = ((await res.json()).response?.docs || []).map((d) => d.identifier);
  const items = await Promise.all(ids.map((id) => archiveItemTracks(id, TRACKS_PER_ITEM).catch(() => ({ songs: [] }))));
  return items.flatMap((i) => i.songs).slice(0, limit);
}

export const searchArchive = (query, limit = 25) => archiveSearch(`(${query}) AND ${ARCHIVE_MUSIC}`, 'downloads desc', limit);

// The most downloaded albums from free netlabels (without the shortwave-radio recordings)
export const popularArchive = (limit = 25) =>
  archiveSearch('mediatype:audio AND collection:netlabels AND -collection:irdial', 'downloads desc', limit);

export function extractArchiveId(url) {
  const m = (url || '').match(/archive\.org\/details\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------- Live radio (radio-browser.info, no key needed) ----------
// Only stations with a working https stream (http streams don't play inside
// an https page, and Android blocks them by default)

async function radio(path, params) {
  const qs = new URLSearchParams({ hidebroken: 'true', is_https: 'true', order: 'clickcount', reverse: 'true', ...params });
  for (const host of RADIO_HOSTS) {
    try {
      const res = await fetch(`${host}/${path}?${qs}`);
      if (res.ok) return await res.json();
    } catch {}
  }
  throw new Error('Radio stations are not responding. Try again later.');
}

function fromStation(s) {
  const tags = (s.tags || '').split(',').filter(Boolean).slice(0, 2).join(', ');
  return {
    id: `radio_${s.stationuuid}`,
    source: 'radio',
    title: s.name.trim(),
    artist: ['Live radio', tags, s.country].filter(Boolean).join(' · '),
    artwork: /^https:\/\//i.test(s.favicon || '') ? s.favicon : null,
    streamUrl: s.url_resolved,
    pageUrl: s.homepage || null,
    live: true,
  };
}

const playableStations = (list, limit) => {
  const seen = new Set();
  return (list || [])
    .filter((s) => !s.hls && /^https:\/\//i.test(s.url_resolved || '') && !seen.has(s.stationuuid) && seen.add(s.stationuuid))
    .slice(0, limit)
    .map(fromStation);
};

// Matches station names and genres (tags), e.g. "bollywood" or "lofi"
export async function searchRadio(query, limit = 25) {
  const [byName, byTag] = await Promise.all([
    radio('stations/search', { name: query, limit: String(limit) }),
    radio('stations/search', { tag: query.toLowerCase(), limit: String(limit) }).catch(() => []),
  ]);
  return playableStations([...byName, ...byTag], limit);
}

// The most played music stations (the overall top list is mostly news)
export async function topRadio(limit = 25) {
  return playableStations(await radio('stations/search', { tag: 'music', limit: String(limit * 2) }), limit);
}

// ---------- Search suggestions (iTunes Search API, no key needed) ----------

// The user's country, for example 'PK' from 'en-PK'
export function regionOf(locale) {
  const m = (locale || '').match(/[-_]([A-Za-z]{2})\b/);
  return m ? m[1].toUpperCase() : 'US';
}

// Real song names as you type: [{ title, artist, query }]
export async function suggestSongs(term, country = 'US', limit = 8) {
  const params = new URLSearchParams({ term, country, media: 'music', entity: 'song', limit: String(limit * 2) });
  const res = await fetch(`https://itunes.apple.com/search?${params}`);
  if (!res.ok) return [];
  const json = await res.json();
  const seen = new Set();
  const out = [];
  for (const t of json.results || []) {
    // "Tum Hi Ho (From "Aashiqui 2")" → "Tum Hi Ho"
    const title = (t.trackName || '').replace(/\s*[([](from|feat\.?|ft\.?)\b[^)\]]*[)\]]/gi, '').trim();
    const artist = (t.artistName || '').split(/,|&/)[0].trim();
    const key = `${title}|${artist}`.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, artist, query: `${title} ${artist}`.trim() });
    if (out.length === limit) break;
  }
  return out;
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
  return { id: `url_${hash(url)}`, source: 'url', title: title || 'Audio link', artist: u.hostname, streamUrl: url, downloadUrl: url };
}

// ---------- Downloads ----------
// Only songs whose owners allow it can be saved: Jamendo tracks with downloads
// allowed, Audius tracks with free downloads, and the user's own audio links.
// YouTube songs are never downloadable.
export const canDownload = (song) => !!song && !isYouTube(song) && !!song.downloadUrl;

export function fileNameOf(song) {
  const base = `${song.artist ? `${song.artist} - ` : ''}${song.title}`.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return `${base.slice(0, 120) || 'song'}.mp3`;
}
