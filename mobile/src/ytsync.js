// Syncing a signed-in user's YouTube playlists through the YouTube Data API.
// Needs an OAuth access token with the scope below (read-only).
// The same file is used by the website and the phone app.
import { cleanArtist } from './youtube';

export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

const API = 'https://www.googleapis.com/youtube/v3';
const MAX_PER_PLAYLIST = 500;

const FRIENDLY = {
  quotaExceeded: 'YouTube daily limit reached for this app. Try again tomorrow.',
  forbidden: 'YouTube did not allow access. Sign in again and allow access to your YouTube account.',
  insufficientPermissions: 'Sign in again and tick the box that allows access to your YouTube account.',
  youtubeSignupRequired: 'This Google account has no YouTube channel yet, so it has no playlists.',
  channelNotFound: 'This Google account has no YouTube channel yet, so it has no playlists.',
};

async function get(path, params, token) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data.error && data.error.errors && data.error.errors[0] && data.error.errors[0].reason;
    const err = new Error(
      res.status === 401
        ? 'Your YouTube sign-in expired. Please sign in again.'
        : FRIENDLY[reason] || (data.error && data.error.message) || `YouTube error ${res.status}`
    );
    err.status = res.status;
    throw err;
  }
  return data;
}

async function paginate(path, params, token, limit, mapItem) {
  const out = [];
  let pageToken;
  do {
    const data = await get(path, { ...params, maxResults: 50, ...(pageToken ? { pageToken } : {}) }, token);
    for (const item of data.items || []) {
      const v = mapItem(item);
      if (v) out.push(v);
    }
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < limit);
  return out.slice(0, limit);
}

export async function fetchChannel(token) {
  const data = await get('channels', { part: 'snippet', mine: 'true' }, token);
  const c = data.items && data.items[0];
  return c
    ? { name: c.snippet.title, avatar: c.snippet.thumbnails && c.snippet.thumbnails.default && c.snippet.thumbnails.default.url }
    : null;
}

export function fetchMyPlaylists(token) {
  return paginate('playlists', { part: 'snippet,contentDetails', mine: 'true' }, token, 200, (p) => ({
    ytId: p.id,
    name: p.snippet.title,
    count: p.contentDetails.itemCount,
  }));
}

// Deleted and private videos have no owner channel; they are skipped
export function fetchPlaylistVideos(token, playlistId) {
  return paginate(
    'playlistItems',
    { part: 'snippet,contentDetails', playlistId },
    token,
    MAX_PER_PLAYLIST,
    (it) =>
      it.snippet.videoOwnerChannelTitle
        ? { id: it.contentDetails.videoId, title: it.snippet.title, artist: cleanArtist(it.snippet.videoOwnerChannelTitle) }
        : null
  );
}

export function fetchLikedVideos(token) {
  return paginate('videos', { part: 'snippet', myRating: 'like' }, token, MAX_PER_PLAYLIST, (v) => ({
    id: v.id,
    title: v.snippet.title,
    artist: cleanArtist(v.snippet.channelTitle),
  }));
}

// Reads the account name, every playlist the user owns, and their liked videos
export async function syncYouTube(token, onProgress = () => {}) {
  onProgress('Reading your YouTube account…');
  const channel = await fetchChannel(token);
  if (!channel) throw new Error(FRIENDLY.channelNotFound);

  const lists = await fetchMyPlaylists(token);
  const playlists = [];

  onProgress('Reading liked videos…');
  const liked = await fetchLikedVideos(token).catch(() => []);
  if (liked.length) playlists.push({ ytId: 'LIKED', name: 'Liked videos', videos: liked });

  for (let i = 0; i < lists.length; i++) {
    onProgress(`Reading playlist ${i + 1} of ${lists.length}: ${lists[i].name}`);
    const videos = await fetchPlaylistVideos(token, lists[i].ytId).catch(() => []);
    playlists.push({ ytId: lists[i].ytId, name: lists[i].name, videos });
  }
  return { channel, playlists };
}

// Merges a sync result into the library. YouTube playlists are replaced each
// sync; the user's own playlists and added songs are kept.
export function mergeSync(lib, result) {
  const songs = new Map(lib.songs.map((s) => [s.id, s]));
  const now = Date.now();
  let k = 0;
  for (const pl of result.playlists) {
    for (const v of pl.videos) {
      if (!songs.has(v.id)) songs.set(v.id, { id: v.id, title: v.title, artist: v.artist, addedAt: now - k++ });
    }
  }
  const synced = result.playlists.map((pl) => ({
    id: `yt_${pl.ytId}`,
    ytId: pl.ytId,
    source: 'youtube',
    name: pl.name,
    songIds: [...new Set(pl.videos.map((v) => v.id))],
  }));
  return {
    ...lib,
    songs: [...songs.values()].sort((a, b) => b.addedAt - a.addedAt),
    playlists: [...synced, ...lib.playlists.filter((p) => p.source !== 'youtube')],
    account: result.channel,
    syncedAt: now,
  };
}

// Removes everything that came from YouTube (used on sign-out)
export function removeSynced(lib) {
  return { ...lib, playlists: lib.playlists.filter((p) => p.source !== 'youtube'), account: null, syncedAt: null };
}
