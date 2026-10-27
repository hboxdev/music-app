import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadLibrary, saveLibrary } from './storage';
import { getAccessToken, googleConfigured, initGoogle, signOutGoogle } from './google';
import { loadYouTubeApi, readPlaylistIds } from './player';
import {
  extractPlaylistId,
  extractVideoId,
  fetchManyVideoInfo,
  fetchPlaylistTitle,
  fetchVideoInfo,
} from '../shared/youtube';
import { mergeSync, removeSynced, syncYouTube } from '../shared/ytsync';
import {
  SOURCE_LABELS,
  artworkOf,
  directAudioSong,
  extractJamendoId,
  isAudiusLink,
  isYouTube,
  jamendoTrack,
  pageUrlOf,
  popularJamendo,
  resolveAudius,
  searchAudius,
  searchJamendo,
  sourceOf,
  streamUrlOf,
  trendingAudius,
} from '../shared/sources';

const JAMENDO_CLIENT_ID = import.meta.env.VITE_JAMENDO_CLIENT_ID || '';
const SEARCH = 'search';

const ERROR_REASONS = {
  2: 'invalid video',
  5: 'player error',
  100: 'video removed or private',
  101: 'the uploader blocks playing it on other sites',
  150: 'the uploader blocks playing it on other sites',
};

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}

// Mixes several result lists: a1, b1, a2, b2, ...
function interleave(lists) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

// Checks that a direct audio link really plays, and reads its length
function probeAudio(url) {
  return new Promise((resolve) => {
    const a = new Audio();
    const done = (ok) => {
      clearTimeout(timer);
      const d = a.duration;
      a.removeAttribute('src');
      a.load();
      resolve(ok ? { ok: true, duration: Number.isFinite(d) ? d : 0 } : { ok: false });
    };
    const timer = setTimeout(() => done(false), 12000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(true);
    a.onerror = () => done(false);
    a.src = url;
  });
}

const YouTubeIcon = () => (
  <svg width="18" height="13" viewBox="0 0 24 17" aria-hidden="true">
    <rect width="24" height="17" rx="4" fill="#ff0000" />
    <path d="M9.6 4.8v7.4l6.4-3.7z" fill="#fff" />
  </svg>
);

function Thumb({ song, className = 'thumb' }) {
  const art = artworkOf(song);
  return art ? (
    <img className={className} loading="lazy" alt="" src={art} />
  ) : (
    <span className={`${className} thumb-blank`}>♪</span>
  );
}

export default function App() {
  // Library
  const [lib, setLib] = useState(loadLibrary);
  useEffect(() => saveLibrary(lib), [lib]);

  // Navigation
  const [viewId, setViewId] = useState(null); // null = all songs, SEARCH, or a playlist id
  const [filter, setFilter] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Search
  const [search, setSearch] = useState({ q: '', source: 'all', results: [], loading: false, error: '', heading: '' });
  const [searchText, setSearchText] = useState('');
  const searchSeq = useRef(0);

  // Playback
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [time, setTime] = useState({ t: 0, d: 0 });
  const [seeking, setSeeking] = useState(null);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);

  // UI
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [menu, setMenu] = useState(null); // { song, x, y, top }
  const [dialog, setDialog] = useState(null);
  const [googleReady, setGoogleReady] = useState(false);

  // Two engines: YouTube's player for YouTube songs, an <audio> element for the rest
  const playerEl = useRef(null);
  const player = useRef(null);
  const playerReady = useRef(false);
  const pendingVideo = useRef(null);
  const audio = useRef(null);
  if (!audio.current) audio.current = new Audio();

  const handlers = useRef({});
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // ---------- Derived ----------
  const songMap = useMemo(() => Object.fromEntries(lib.songs.map((s) => [s.id, s])), [lib.songs]);
  const showSearch = viewId === SEARCH;
  const view = showSearch ? null : lib.playlists.find((p) => p.id === viewId) || null;
  const ytPlaylists = lib.playlists.filter((p) => p.source === 'youtube');
  const myPlaylists = lib.playlists.filter((p) => p.source !== 'youtube');

  const viewSongs = useMemo(() => {
    const list = view ? view.songIds.map((id) => songMap[id]).filter(Boolean) : lib.songs;
    const q = filter.trim().toLowerCase();
    return q ? list.filter((s) => s.title.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q)) : list;
  }, [view, songMap, lib.songs, filter]);

  const current = queue[index] || null;
  const currentIsYouTube = !!current && isYouTube(current);

  // ---------- Player setup ----------
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        player.current = new YT.Player(playerEl.current, {
          width: '160',
          height: '90',
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: () => {
              playerReady.current = true;
              player.current.setVolume(80);
              if (pendingVideo.current) {
                player.current.loadVideoById(pendingVideo.current);
                pendingVideo.current = null;
              }
            },
            onStateChange: (e) => handlers.current.onYouTubeState(e.data),
            onError: (e) => handlers.current.onYouTubeError(e.data),
          },
        });
      })
      .catch((e) => showToast(e.message));
    initGoogle().then(setGoogleReady);

    const a = audio.current;
    a.volume = 0.8;
    const on = (name, fn) => a.addEventListener(name, fn);
    on('playing', () => handlers.current.onAudio('playing'));
    on('pause', () => handlers.current.onAudio('pause'));
    on('ended', () => handlers.current.onAudio('ended'));
    on('error', () => handlers.current.onAudio('error'));
    on('timeupdate', () => handlers.current.onAudio('time'));
    on('loadedmetadata', () => handlers.current.onAudio('time'));
    return () => {
      cancelled = true;
      a.pause();
    };
  }, [showToast]);

  // Progress for YouTube songs (audio songs report through timeupdate)
  useEffect(() => {
    const id = setInterval(() => {
      const p = player.current;
      if (!handlers.current.currentIsYouTube || !playerReady.current || !p.getDuration) return;
      setTime({ t: p.getCurrentTime() || 0, d: p.getDuration() || 0 });
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.title = current ? `${current.title} · TubeTunes` : 'TubeTunes Player';
  }, [current]);

  // ---------- Playback ----------
  const loadSong = (song) => {
    setTime({ t: 0, d: song.duration || 0 });
    if (isYouTube(song)) {
      audio.current.pause();
      if (playerReady.current) player.current.loadVideoById(song.id);
      else pendingVideo.current = song.id;
    } else {
      pendingVideo.current = null;
      if (playerReady.current) player.current.pauseVideo();
      audio.current.src = streamUrlOf(song);
      audio.current.play().catch(() => setIsPlaying(false));
    }
  };

  const startQueue = (songs, start = 0, useShuffle = shuffle) => {
    if (!songs.length) return;
    const q = useShuffle ? [songs[start], ...shuffled(songs.filter((_, k) => k !== start))] : songs.slice();
    const i = useShuffle ? 0 : start;
    setQueue(q);
    setIndex(i);
    loadSong(q[i]);
  };

  const goTo = (i) => {
    setIndex(i);
    loadSong(queue[i]);
  };

  const next = (auto = false) => {
    if (!queue.length) return;
    if (index < queue.length - 1) goTo(index + 1);
    else if (repeat === 'all' || !auto) goTo(0);
    else setIsPlaying(false);
  };

  const seekTo = (sec) => {
    if (!current) return;
    if (currentIsYouTube) playerReady.current && player.current.seekTo(sec, true);
    else audio.current.currentTime = sec;
    setTime((t) => ({ ...t, t: sec }));
  };

  const prev = () => {
    if (!queue.length) return;
    if (time.t > 3) return seekTo(0);
    goTo(index > 0 ? index - 1 : queue.length - 1);
  };

  const resume = () => {
    if (!current) return startQueue(viewSongs, 0);
    if (currentIsYouTube) playerReady.current && player.current.playVideo();
    else audio.current.play().catch(() => {});
  };

  const pause = () => {
    if (!current) return;
    if (currentIsYouTube) playerReady.current && player.current.pauseVideo();
    else audio.current.pause();
  };

  const playPause = () => (isPlaying ? pause() : resume());

  const toggleShuffle = () => {
    const on = !shuffle;
    setShuffle(on);
    if (on && current) {
      setQueue([current, ...shuffled(queue.filter((_, k) => k !== index))]);
      setIndex(0);
    }
  };

  const onSongEnded = () => {
    if (repeat === 'one') {
      seekTo(0);
      resume();
    } else next(true);
  };

  const skipBroken = (reason) => {
    showToast(`Can't play ${current ? `"${current.title}"` : 'this song'}: ${reason}. Skipping.`);
    setTimeout(() => handlers.current.next(true), 1500);
  };

  // Latest versions for the player callbacks
  handlers.current = {
    currentIsYouTube,
    next,
    playPause,
    resume,
    pause,
    prev,
    seekTo,
    onYouTubeState: (s) => {
      if (!currentIsYouTube) return;
      if (s === 1) setIsPlaying(true);
      else if (s === 2 || s === 0 || s === 5) setIsPlaying(false);
      if (s === 0) onSongEnded();
    },
    onYouTubeError: (code) => {
      if (currentIsYouTube) skipBroken(ERROR_REASONS[code] || 'error ' + code);
    },
    onAudio: (type) => {
      if (!current || currentIsYouTube) return;
      const a = audio.current;
      if (type === 'playing') setIsPlaying(true);
      else if (type === 'pause') setIsPlaying(false);
      else if (type === 'ended') onSongEnded();
      else if (type === 'error' && a.getAttribute('src')) skipBroken('the stream is not available');
      else if (type === 'time') setTime({ t: a.currentTime || 0, d: Number.isFinite(a.duration) ? a.duration : current.duration || 0 });
    },
  };

  // ---------- Lock screen / notification controls ----------
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, fn) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {}
    };
    set('play', () => handlers.current.resume());
    set('pause', () => handlers.current.pause());
    set('nexttrack', () => handlers.current.next());
    set('previoustrack', () => handlers.current.prev());
    set('seekto', (d) => handlers.current.seekTo(d.seekTime));
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const art = current && artworkOf(current);
    navigator.mediaSession.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artist || '',
          album: 'TubeTunes',
          artwork: art ? [{ src: art, sizes: '480x480' }] : [],
        })
      : null;
  }, [current]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  // ---------- Keep the screen on for YouTube songs ----------
  // Phones pause YouTube's player when the screen locks. Audius, Jamendo and
  // link songs keep playing, so they don't need this.
  const [keepAwake, setKeepAwake] = useState(() => {
    try {
      return localStorage.getItem('tubetunes:keepAwake') !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('tubetunes:keepAwake', keepAwake ? '1' : '0');
    } catch {}
  }, [keepAwake]);

  useEffect(() => {
    if (!keepAwake || !isPlaying || !currentIsYouTube || !('wakeLock' in navigator)) return;
    let lock = null;
    let active = true;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {}
    };
    const onVisible = () => active && document.visibilityState === 'visible' && request();
    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      if (lock) lock.release().catch(() => {});
    };
  }, [keepAwake, isPlaying, currentIsYouTube]);

  // If the phone locked during a YouTube song and it stopped, explain why on return
  const playingWhenHidden = useRef(false);
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        playingWhenHidden.current = isPlaying && currentIsYouTube;
      } else if (playingWhenHidden.current && playerReady.current && player.current.getPlayerState() !== 1) {
        showToast('YouTube songs pause when the screen locks. Songs from Search keep playing. Press ▶ to continue.');
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [isPlaying, currentIsYouTube, showToast]);

  // ---------- Full-screen "Now playing" ----------
  const [npOpen, setNpOpen] = useState(false);
  const frameRef = useRef(null);
  const slotRef = useRef(null);
  const npScroller = useRef(null);

  // Opening adds a history entry, so the phone's Back button closes the player
  const openNowPlaying = () => {
    if (npOpen) return;
    setMenu(null);
    setNpOpen(true);
    try {
      history.pushState({ nowPlaying: true }, '');
    } catch {}
  };
  const closeNowPlaying = () => {
    if (history.state && history.state.nowPlaying) history.back();
    else setNpOpen(false);
  };
  useEffect(() => {
    const onPop = () => setNpOpen(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (!current) setNpOpen(false);
  }, [current]);
  useEffect(() => {
    document.body.style.overflow = npOpen ? 'hidden' : '';
  }, [npOpen]);
  handlers.current.closeNowPlaying = () => npOpen && closeNowPlaying();

  // Moves the single video/art box over the big player's empty slot (and back).
  // Moving it with CSS instead of re-rendering keeps a YouTube video playing.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (!npOpen || !slotRef.current) {
      frame.style.cssText = '';
      return;
    }
    const place = () => {
      const r = slotRef.current.getBoundingClientRect();
      Object.assign(frame.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(slotRef.current);
    const scroller = npScroller.current;
    window.addEventListener('resize', place);
    scroller && scroller.addEventListener('scroll', place, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      scroller && scroller.removeEventListener('scroll', place);
      frame.style.cssText = '';
    };
  }, [npOpen, currentIsYouTube, current && current.id]);

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handlers.current.playPause();
      } else if (e.shiftKey && e.key === 'ArrowRight') handlers.current.next();
      else if (e.shiftKey && e.key === 'ArrowLeft') handlers.current.prev();
      else if (e.key === 'Escape') {
        setMenu(null);
        handlers.current.closeNowPlaying && handlers.current.closeNowPlaying();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- Search ----------
  const runSearch = async (q, source) => {
    const seq = ++searchSeq.current;
    setSearch((s) => ({ ...s, q, source, loading: true, error: '' }));
    const tasks = [];
    if (source !== 'jamendo') tasks.push(q ? searchAudius(q) : trendingAudius());
    if (source === 'jamendo' || (source === 'all' && JAMENDO_CLIENT_ID)) {
      tasks.push(q ? searchJamendo(q, JAMENDO_CLIENT_ID) : popularJamendo(JAMENDO_CLIENT_ID));
    }
    const settled = await Promise.allSettled(tasks);
    if (seq !== searchSeq.current) return;
    const lists = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const errors = settled.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    setSearch((s) => ({
      ...s,
      results: interleave(lists),
      loading: false,
      error: errors.join(' '),
      heading: q ? `Results for “${q}”` : 'Trending now',
    }));
  };

  const openSearch = () => {
    setViewId(SEARCH);
    setSidebarOpen(false);
    if (!search.results.length && !search.loading) runSearch(search.q, search.source);
  };

  // ---------- YouTube sync ----------
  const syncNow = async () => {
    let token;
    try {
      token = await getAccessToken(); // opens Google's popup when needed
    } catch (e) {
      showToast(e.message);
      return;
    }
    setBusy('Connecting to YouTube…');
    try {
      const result = await syncYouTube(token, setBusy);
      setLib((l) => mergeSync(l, result));
      const songs = result.playlists.reduce((n, p) => n + p.videos.length, 0);
      showToast(`Synced ${result.playlists.length} playlists (${songs} songs) from YouTube`);
    } catch (e) {
      if (e.status === 401) signOutGoogle();
      showToast(e.message);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = () => {
    if (!confirm('Disconnect YouTube? Your YouTube playlists will be removed from TubeTunes. Songs you added yourself stay.')) return;
    signOutGoogle();
    if (view && view.source === 'youtube') setViewId(null);
    setLib(removeSynced);
  };

  // ---------- Adding songs ----------
  const addToView = (playlists, songId) =>
    view && view.source !== 'youtube'
      ? playlists.map((p) => (p.id === view.id && !p.songIds.includes(songId) ? { ...p, songIds: [...p.songIds, songId] } : p))
      : playlists;

  // Adds a full song object (from Search or a resolved link) to the library
  const addSongObject = (song, { quiet = false } = {}) => {
    const exists = !!songMap[song.id];
    setLib((l) => ({
      ...l,
      songs: l.songs.some((s) => s.id === song.id) ? l.songs : [{ ...song, addedAt: Date.now() }, ...l.songs],
      playlists: addToView(l.playlists, song.id),
    }));
    if (!quiet) showToast(exists ? `"${song.title}" is already in your library` : `Added "${song.title}"`);
  };

  const addYouTubeSong = async (videoId) => {
    if (songMap[videoId]) return addSongObject(songMap[videoId]);
    setBusy('Adding song…');
    const info = await fetchVideoInfo(videoId);
    setBusy(null);
    if (!info) return showToast('Could not find that video. It may be private, removed, or blocked from embedding.');
    addSongObject({ id: videoId, source: 'youtube', ...info });
  };

  const importPlaylist = async (listId) => {
    setBusy('Reading playlist…');
    try {
      const ids = [...new Set(await readPlaylistIds(listId))];
      const missing = ids.filter((id) => !songMap[id]);
      setBusy(`Getting song details… 0/${missing.length}`);
      const infos = await fetchManyVideoInfo(missing, (d, n) => setBusy(`Getting song details… ${d}/${n}`));
      const name = (await fetchPlaylistTitle(listId)) || (listId.startsWith('RD') ? 'My Mix' : 'Imported playlist');
      const now = Date.now();
      const newSongs = missing.filter((id) => infos[id]).map((id, k) => ({ id, source: 'youtube', ...infos[id], addedAt: now - k }));
      const pl = { id: `pl_${now}`, name, source: 'local', songIds: ids.filter((id) => songMap[id] || infos[id]) };
      setLib((l) => ({ ...l, songs: [...newSongs, ...l.songs], playlists: [...l.playlists, pl] }));
      setViewId(pl.id);
      const skipped = ids.length - pl.songIds.length;
      showToast(`Imported "${name}": ${newSongs.length} new songs${skipped ? `, ${skipped} unavailable` : ''}`);
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(null);
    }
  };

  const addFromLink = async (url) => {
    // YouTube
    const listId = extractPlaylistId(url);
    const videoId = extractVideoId(url);
    if (listId && (!videoId || confirm('This link is part of a playlist.\n\nOK = import the whole playlist\nCancel = add only this song'))) {
      return importPlaylist(listId);
    }
    if (videoId) return addYouTubeSong(videoId);

    // Audius
    if (isAudiusLink(url)) {
      setBusy('Finding the track on Audius…');
      const song = await resolveAudius(url).catch(() => null);
      setBusy(null);
      return song ? addSongObject(song) : showToast('Could not find that Audius track.');
    }

    // Jamendo
    const jamendoId = extractJamendoId(url);
    if (jamendoId) {
      setBusy('Finding the track on Jamendo…');
      try {
        const song = await jamendoTrack(jamendoId, JAMENDO_CLIENT_ID);
        song ? addSongObject(song) : showToast('Could not find that Jamendo track.');
      } catch (e) {
        showToast(e.message);
      } finally {
        setBusy(null);
      }
      return;
    }

    // Direct audio file
    const song = directAudioSong(url);
    if (!song) return showToast('That link is not recognized. Paste a YouTube, Audius, Jamendo or audio file link.');
    setBusy('Checking the audio link…');
    const probe = await probeAudio(url);
    setBusy(null);
    if (!probe.ok) return showToast('That link does not play as audio. Use a direct link to an MP3 or other audio file.');
    addSongObject({ ...song, duration: probe.duration });
  };

  const submitLink = (e) => {
    e.preventDefault();
    const url = link.trim();
    if (!url) return;
    setLink('');
    addFromLink(url);
  };

  // ---------- Playlists ----------
  const newPlaylist = (songs = [], then) =>
    setDialog({
      title: 'New playlist',
      fields: [{ key: 'name', label: 'Name', value: '' }],
      submitLabel: 'Create',
      onSubmit: ({ name }) => {
        const pl = { id: `pl_${Date.now()}`, name: name.trim(), source: 'local', songIds: songs.map((s) => s.id) };
        setLib((l) => {
          const have = new Set(l.songs.map((s) => s.id));
          const add = songs.filter((s) => !have.has(s.id)).map((s) => ({ ...s, addedAt: Date.now() }));
          return { ...l, songs: [...add, ...l.songs], playlists: [...l.playlists, pl] };
        });
        then ? then(pl) : setViewId(pl.id);
      },
    });

  const renamePlaylist = () =>
    setDialog({
      title: 'Rename playlist',
      fields: [{ key: 'name', label: 'Name', value: view.name }],
      onSubmit: ({ name }) =>
        setLib((l) => ({ ...l, playlists: l.playlists.map((p) => (p.id === view.id ? { ...p, name: name.trim() } : p)) })),
    });

  const deletePlaylist = () => {
    if (!confirm(`Delete the playlist "${view.name}"? The songs stay in your library.`)) return;
    setLib((l) => ({ ...l, playlists: l.playlists.filter((p) => p.id !== view.id) }));
    setViewId(null);
  };

  // ---------- Song menu ----------
  const openMenu = (song, e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ song, x: r.right, y: r.bottom, top: r.top });
  };

  const menuAction = (fn) => () => {
    const s = menu.song;
    setMenu(null);
    fn(s);
  };

  const playNext = (song) => {
    if (!current) return startQueue([song], 0, false);
    setQueue((q) => [...q.slice(0, index + 1), song, ...q.slice(index + 1)]);
    showToast(`"${song.title}" will play next`);
  };

  const editSong = (song) =>
    setDialog({
      title: 'Edit song',
      fields: [
        { key: 'title', label: 'Title', value: song.title },
        { key: 'artist', label: 'Artist', value: song.artist },
      ],
      onSubmit: ({ title, artist }) => {
        const patch = { title: title.trim(), artist: (artist || '').trim() };
        setLib((l) => ({ ...l, songs: l.songs.map((s) => (s.id === song.id ? { ...s, ...patch } : s)) }));
        setQueue((q) => q.map((s) => (s.id === song.id ? { ...s, ...patch } : s)));
      },
    });

  const addToPlaylist = (song, pl) => {
    setLib((l) => ({
      ...l,
      songs: l.songs.some((s) => s.id === song.id) ? l.songs : [{ ...song, addedAt: Date.now() }, ...l.songs],
      playlists: l.playlists.map((p) => (p.id === pl.id && !p.songIds.includes(song.id) ? { ...p, songIds: [...p.songIds, song.id] } : p)),
    }));
    showToast(`Added to "${pl.name}"`);
  };

  const removeFromPlaylist = (song) =>
    setLib((l) => ({
      ...l,
      playlists: l.playlists.map((p) => (p.id === view.id ? { ...p, songIds: p.songIds.filter((id) => id !== song.id) } : p)),
    }));

  const deleteSong = (song) => {
    if (!confirm(`Delete "${song.title}" from your library and all your playlists?`)) return;
    setLib((l) => ({
      ...l,
      songs: l.songs.filter((s) => s.id !== song.id),
      playlists: l.playlists.map((p) => ({ ...p, songIds: p.songIds.filter((id) => id !== song.id) })),
    }));
  };

  // ---------- Render ----------
  const openView = (id) => {
    setViewId(id);
    setFilter('');
    setSidebarOpen(false);
  };

  const progress = seeking ?? time.t;
  const count = view ? view.songIds.length : lib.songs.length;
  const subtitle = current
    ? `${current.artist || 'Unknown artist'}${currentIsYouTube ? '' : ` · ${SOURCE_LABELS[sourceOf(current)]}`}`
    : 'Pick a song to start';
  const upNext = queue
    .map((song, i) => ({ song, i }))
    .slice(index + 1, index + 31);

  const controlButtons = (
    <div className="buttons">
      <button className={`icon-btn toggle ${shuffle ? 'on' : ''}`} title="Shuffle" onClick={toggleShuffle}>⤮</button>
      <button className="icon-btn" title="Previous" onClick={prev}>⏮</button>
      <button className="play-btn" title={isPlaying ? 'Pause' : 'Play'} onClick={playPause}>{isPlaying ? '⏸' : '▶'}</button>
      <button className="icon-btn" title="Next" onClick={() => next()}>⏭</button>
      <button
        className={`icon-btn toggle ${repeat !== 'off' ? 'on' : ''}`}
        title={`Repeat: ${repeat}`}
        onClick={() => setRepeat((r) => ({ off: 'all', all: 'one', one: 'off' }[r]))}
      >
        {repeat === 'one' ? '⟳¹' : '⟳'}
      </button>
      <button
        className={`icon-btn toggle ${keepAwake ? 'on' : ''}`}
        title={keepAwake ? 'Screen stays on during YouTube songs (tap to turn off)' : 'Keep screen on during YouTube songs'}
        onClick={() => {
          setKeepAwake(!keepAwake);
          showToast(keepAwake ? 'Screen can lock again during YouTube songs' : 'Screen stays on during YouTube songs');
        }}
      >
        ☀
      </button>
    </div>
  );

  const finishSeek = () => {
    if (seeking !== null) seekTo(seeking);
    setSeeking(null);
  };

  const progressRow = (
    <div className="progress-row">
      <span className="time">{fmtTime(progress)}</span>
      <input
        type="range"
        min="0"
        max={time.d || 1}
        step="0.1"
        value={progress}
        onChange={(e) => setSeeking(+e.target.value)}
        onPointerUp={finishSeek}
        onKeyUp={finishSeek}
      />
      <span className="time">{fmtTime(time.d)}</span>
    </div>
  );

  const volumeControl = (
    <>
      <button
        className="icon-btn"
        title={muted ? 'Unmute' : 'Mute'}
        onClick={() => {
          const m = !muted;
          setMuted(m);
          audio.current.muted = m;
          if (playerReady.current) (m ? player.current.mute() : player.current.unMute());
        }}
      >
        {muted || volume === 0 ? '🔇' : '🔊'}
      </button>
      <input
        type="range"
        min="0"
        max="100"
        value={volume}
        onChange={(e) => {
          const v = +e.target.value;
          setVolume(v);
          setMuted(false);
          audio.current.volume = v / 100;
          audio.current.muted = false;
          if (playerReady.current) {
            player.current.setVolume(v);
            player.current.unMute();
          }
        }}
      />
    </>
  );

  const renderSongs = (songs, { showAdd = false } = {}) => (
    <ol className="song-list">
      {songs.map((s, i) => {
        const playing = current && current.id === s.id;
        const src = sourceOf(s);
        const inLib = !!songMap[s.id];
        return (
          <li key={s.id} className={`song ${playing ? 'playing' : ''}`} onClick={() => startQueue(songs, i)}>
            <span className="song-num">{playing ? '♪' : i + 1}</span>
            <Thumb song={s} />
            <div className="song-info">
              <div className="song-title">{s.title}</div>
              <div className="song-artist">
                {src !== 'youtube' ? <span className={`badge badge-${src}`}>{SOURCE_LABELS[src]}</span> : null}
                {s.artist || 'Unknown artist'}
              </div>
            </div>
            <div className="song-actions">
              {showAdd ? (
                <button
                  className={`icon-btn add-btn ${inLib ? 'done' : ''}`}
                  title={inLib ? 'In your library' : 'Add to library'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!inLib) addSongObject(s);
                  }}
                >
                  {inLib ? '✓' : '＋'}
                </button>
              ) : null}
              <button className="icon-btn more-btn" title="More" onClick={(e) => openMenu(s, e)}>
                ⋯
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );

  return (
    <div className="app" onClick={() => setMenu(null)}>
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
        <a className="brand" href="../">
          <span className="logo">♫</span> TubeTunes
        </a>

        <button className={`nav-item ${showSearch ? 'active' : ''}`} onClick={openSearch}>
          <span className="icon">⌕</span>
          <span className="name">Search music</span>
        </button>
        <button className={`nav-item ${!view && !showSearch ? 'active' : ''}`} onClick={() => openView(null)}>
          <span className="icon">▤</span>
          <span className="name">All songs</span>
          <span className="count">{lib.songs.length}</span>
        </button>

        <div className="section-head">
          <span>YouTube</span>
          {lib.account ? (
            <button className="icon-btn small" title="Sync now" onClick={syncNow} disabled={!!busy}>
              ⟳
            </button>
          ) : null}
        </div>

        {lib.account ? (
          <>
            <div className="account">
              {lib.account.avatar ? <img src={lib.account.avatar} alt="" referrerPolicy="no-referrer" /> : <YouTubeIcon />}
              <div className="account-text">
                <div className="account-name">{lib.account.name}</div>
                <div className="muted small">Synced {timeAgo(lib.syncedAt)}</div>
              </div>
            </div>
            {ytPlaylists.map((p) => (
              <button key={p.id} className={`nav-item ${view && view.id === p.id ? 'active' : ''}`} onClick={() => openView(p.id)}>
                <span className="icon">{p.ytId === 'LIKED' ? '♥' : '▶'}</span>
                <span className="name">{p.name}</span>
                <span className="count">{p.songIds.length}</span>
              </button>
            ))}
            <button className="link-btn" onClick={disconnect}>
              Disconnect YouTube
            </button>
          </>
        ) : googleConfigured ? (
          <button className="connect" onClick={syncNow} disabled={!googleReady || !!busy}>
            <YouTubeIcon /> Connect YouTube
          </button>
        ) : (
          <p className="muted small pad">YouTube sign-in isn't set up on this site yet.</p>
        )}

        <div className="section-head">
          <span>My playlists</span>
          <button className="icon-btn small" title="New playlist" onClick={() => newPlaylist()}>
            ＋
          </button>
        </div>
        {myPlaylists.length ? (
          myPlaylists.map((p) => (
            <button key={p.id} className={`nav-item ${view && view.id === p.id ? 'active' : ''}`} onClick={() => openView(p.id)}>
              <span className="icon">♪</span>
              <span className="name">{p.name}</span>
              <span className="count">{p.songIds.length}</span>
            </button>
          ))
        ) : (
          <p className="muted small pad">No playlists yet</p>
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={(e) => { e.stopPropagation(); setSidebarOpen((o) => !o); }}>
            ☰
          </button>
          <form className="add-form" onSubmit={submitLink}>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube, Audius, Jamendo or MP3 link" />
            <button className="primary" disabled={!!busy}>
              Add
            </button>
          </form>
        </header>

        <section className="content">
          {showSearch ? (
            <>
              <div className="view-head">
                <div>
                  <p className="eyebrow">Discover</p>
                  <h1>Search music</h1>
                  <p className="muted">Songs from Audius and Jamendo keep playing when your phone is locked.</p>
                </div>
              </div>

              <form
                className="search-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  runSearch(searchText.trim(), search.source);
                }}
              >
                <input
                  type="search"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Song, artist or mood: lofi, Atif Aslam, workout…"
                  autoFocus
                />
                <button className="primary">Search</button>
              </form>

              <div className="chips">
                {[
                  ['all', 'All sources'],
                  ['audius', 'Audius'],
                  ['jamendo', 'Jamendo'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={`chip ${search.source === key ? 'on' : ''}`}
                    onClick={() => runSearch(search.q, key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {search.error ? <p className="search-error">{search.error}</p> : null}
              {search.source === 'all' && !JAMENDO_CLIENT_ID ? (
                <p className="muted small">Jamendo results appear once a Jamendo Client ID is added to the site.</p>
              ) : null}

              {search.loading ? (
                <div className="empty">
                  <div className="spinner" />
                </div>
              ) : search.results.length ? (
                <>
                  <h2 className="results-head">{search.heading}</h2>
                  {renderSongs(search.results, { showAdd: true })}
                </>
              ) : (
                <div className="empty">
                  <p className="empty-title">{search.q ? 'Nothing found' : 'Search for music'}</p>
                  <p className="muted">Try another word, or a different source.</p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="view-head">
                <div>
                  <p className="eyebrow">
                    {view ? (view.source === 'youtube' ? <><YouTubeIcon /> YouTube playlist</> : 'Playlist') : 'Library'}
                  </p>
                  <h1>{view ? view.name : 'All songs'}</h1>
                  <p className="muted">{count} song{count === 1 ? '' : 's'}</p>
                </div>
                <div className="view-actions">
                  <button className="primary round" title="Play all" onClick={() => startQueue(viewSongs, 0, false)} disabled={!viewSongs.length}>
                    ▶
                  </button>
                  <button
                    className="ghost"
                    disabled={!viewSongs.length}
                    onClick={() => {
                      setShuffle(true);
                      startQueue(viewSongs, Math.floor(Math.random() * viewSongs.length), true);
                    }}
                  >
                    Shuffle play
                  </button>
                  {view && view.source !== 'youtube' ? (
                    <>
                      <button className="ghost" onClick={renamePlaylist}>Rename</button>
                      <button className="ghost danger" onClick={deletePlaylist}>Delete</button>
                    </>
                  ) : null}
                </div>
              </div>

              <input type="search" className="filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search in this list" />

              {viewSongs.length ? (
                renderSongs(viewSongs)
              ) : (
                <div className="empty">
                  <p className="empty-title">{filter ? 'No matches' : 'No songs here yet'}</p>
                  {!filter ? (
                    <p className="muted">
                      Find songs in <button className="inline-link" onClick={openSearch}>Search music</button>, paste a link above
                      {googleConfigured && !lib.account ? ', or connect YouTube in the sidebar' : ''}.
                    </p>
                  ) : null}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="player">
        <div
          className={`now-playing ${current ? 'can-open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (current) openNowPlaying();
          }}
          title={current ? 'Open player' : undefined}
        >
          {/* The one video/art box. It moves into the full player when that is open,
              so the YouTube video keeps playing without reloading. */}
          <div className="video-frame-slot">
            <div className={`video-frame ${npOpen ? 'floating' : ''}`} ref={frameRef}>
              <div ref={playerEl} />
              {current && !currentIsYouTube ? (
                <div className="art-cover">{artworkOf(current) ? <img src={artworkOf(current)} alt="" /> : <span>♪</span>}</div>
              ) : null}
            </div>
          </div>
          <div className="np-text">
            <div className="np-title">{current ? current.title : 'Nothing playing'}</div>
            <div className="np-artist muted">{subtitle}</div>
          </div>
          {current ? (
            <button
              className="icon-btn mini-play"
              onClick={(e) => {
                e.stopPropagation();
                playPause();
              }}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
          ) : null}
        </div>

        <div className="controls">
          {controlButtons}
          {progressRow}
        </div>

        <div className="volume">
          {volumeControl}
          <button className="icon-btn" title="Open player" onClick={openNowPlaying} disabled={!current}>
            ⤢
          </button>
        </div>
      </footer>

      {npOpen && current ? (
        <div className="np-full" ref={npScroller} role="dialog" aria-label="Now playing">
          {artworkOf(current) ? (
            <div className="np-backdrop" style={{ backgroundImage: `url("${artworkOf(current)}")` }} />
          ) : null}
          <div className="np-inner">
            <header className="np-head">
              <button className="icon-btn big" title="Close" onClick={closeNowPlaying}>
                ⌄
              </button>
              <div className="np-head-text">
                <span className="muted small">Playing from</span>
                <b>{view ? view.name : showSearch ? 'Search' : 'All songs'}</b>
              </div>
              <button className="icon-btn big" title="More" onClick={(e) => openMenu(current, e)}>
                ⋯
              </button>
            </header>

            <div className={`np-slot ${currentIsYouTube ? 'wide' : 'square'}`} ref={slotRef} />

            <div className="np-meta">
              <div className="np-meta-text">
                <h2>{current.title}</h2>
                <p className="muted">{subtitle}</p>
              </div>
              {!songMap[current.id] ? (
                <button className="icon-btn big accent" title="Add to library" onClick={() => addSongObject(current)}>
                  ＋
                </button>
              ) : (
                <span className="np-saved" title="In your library">✓</span>
              )}
            </div>

            <div className="np-controls">
              {progressRow}
              {controlButtons}
              <div className="np-volume">{volumeControl}</div>
            </div>

            {upNext.length ? (
              <section className="np-queue">
                <h3>Up next</h3>
                <ol>
                  {upNext.map(({ song, i }) => (
                    <li key={`${song.id}-${i}`} onClick={() => goTo(i)}>
                      <Thumb song={song} />
                      <div className="song-info">
                        <div className="song-title">{song.title}</div>
                        <div className="song-artist">{song.artist || 'Unknown artist'}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      {menu ? (
        <SongMenu
          menu={menu}
          inLibrary={!!songMap[menu.song.id]}
          playlists={myPlaylists.filter((p) => !view || p.id !== view.id)}
          inMyPlaylist={!!view && view.source !== 'youtube'}
          onPlayNext={menuAction(playNext)}
          onAddToLibrary={menuAction((s) => addSongObject(s))}
          onEdit={menuAction(editSong)}
          onOpen={menuAction((s) => window.open(pageUrlOf(s), '_blank', 'noopener'))}
          onAdd={(pl) => menuAction((s) => addToPlaylist(s, pl))()}
          onNew={menuAction((s) => newPlaylist([s], (pl) => showToast(`Added to "${pl.name}"`)))}
          onRemove={menuAction(removeFromPlaylist)}
          onDelete={menuAction(deleteSong)}
        />
      ) : null}

      {dialog ? <Dialog dialog={dialog} onClose={() => setDialog(null)} /> : null}

      {busy ? (
        <div className="overlay">
          <div className="busy">
            <div className="spinner" />
            <p>{busy}</p>
          </div>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function SongMenu({ menu, inLibrary, playlists, inMyPlaylist, onPlayNext, onAddToLibrary, onEdit, onOpen, onAdd, onNew, onRemove, onDelete }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y, visibility: 'hidden' });
  const src = sourceOf(menu.song);

  // Keep the menu inside the window
  useEffect(() => {
    const el = ref.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(menu.x - w, window.innerWidth - w - 8));
    const top = menu.y + h + 8 > window.innerHeight ? Math.max(8, menu.top - h - 4) : menu.y + 4;
    setPos({ left, top });
  }, [menu]);

  return (
    <div className="menu" ref={ref} style={pos} onClick={(e) => e.stopPropagation()}>
      <button onClick={onPlayNext}>Play next</button>
      {!inLibrary ? <button onClick={onAddToLibrary}>Add to library</button> : null}
      {inLibrary ? <button onClick={onEdit}>Edit title / artist</button> : null}
      <button onClick={onOpen}>{src === 'url' ? 'Open link' : `Open on ${SOURCE_LABELS[src]}`}</button>
      <hr />
      <div className="label">Add to playlist</div>
      {playlists.map((p) => (
        <button key={p.id} onClick={() => onAdd(p)}>
          {p.name}
        </button>
      ))}
      <button onClick={onNew}>＋ New playlist…</button>
      {inLibrary ? (
        <>
          <hr />
          {inMyPlaylist ? <button onClick={onRemove}>Remove from this playlist</button> : null}
          <button className="danger" onClick={onDelete}>
            Delete from library
          </button>
        </>
      ) : null}
    </div>
  );
}

function Dialog({ dialog, onClose }) {
  const [values, setValues] = useState(() => Object.fromEntries(dialog.fields.map((f) => [f.key, f.value || ''])));
  const ok = (values[dialog.fields[0].key] || '').trim().length > 0;
  const submit = (e) => {
    e.preventDefault();
    if (!ok) return;
    onClose();
    dialog.onSubmit(values);
  };
  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{dialog.title}</h2>
        {dialog.fields.map((f, i) => (
          <label key={f.key}>
            <span>{f.label}</span>
            <input autoFocus={i === 0} value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          </label>
        ))}
        <div className="dialog-buttons">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!ok}>
            {dialog.submitLabel || 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
