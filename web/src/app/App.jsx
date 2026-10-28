import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  CircleArrowDown,
  CircleCheck,
  CircleMinus,
  Clipboard,
  Disc3,
  Download,
  Ellipsis,
  ExternalLink,
  Heart,
  House,
  Library,
  Link2,
  ListEnd,
  ListMusic,
  ListPlus,
  LoaderCircle,
  LogOut,
  Maximize2,
  MonitorDown,
  PanelRight,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sun,
  Trash,
  Volume1,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import { loadLibrary, saveLibrary } from './storage';
import { listSaved, removeOffline, saveOffline, savedBlob } from './offline';
import { cachedAccessToken, getAccessToken, googleConfigured, initGoogle, signOutGoogle } from './google';
import { loadYouTubeApi, readPlaylistIds } from './player';
import { Card, Cover, Equalizer, HeartButton, Shelf, TrackTable, YouTubeIcon, fmtTime, hueOf } from './ui';
import {
  extractPlaylistId,
  extractVideoId,
  fetchManyVideoInfo,
  fetchPlaylistTitle,
  fetchVideoInfo,
} from '../shared/youtube';
import { mergeSync, removeSynced, searchYouTube, syncYouTube, topYouTube } from '../shared/ytsync';
import {
  SOURCE_LABELS,
  archiveItemTracks,
  artworkOf,
  canDownload,
  directAudioSong,
  extractArchiveId,
  extractJamendoId,
  isAudiusLink,
  isYouTube,
  jamendoTrack,
  pageUrlOf,
  popularArchive,
  popularJamendo,
  regionOf,
  resolveAudius,
  searchArchive,
  searchAudius,
  searchJamendo,
  searchRadio,
  sourceOf,
  streamUrlOf,
  suggestSongs,
  topRadio,
  trendingAudius,
} from '../shared/sources';

const JAMENDO_CLIENT_ID = import.meta.env.VITE_JAMENDO_CLIENT_ID || '';
// Optional key for searching YouTube without signing in (Google Cloud → Credentials → API key)
const YOUTUBE_API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY || '';
const REGION = regionOf(navigator.language);
const youtubeAuth = () => (YOUTUBE_API_KEY ? { key: YOUTUBE_API_KEY } : cachedAccessToken());
const NO_YOUTUBE_SEARCH = 'Connect YouTube (in Your Library) to search YouTube.';

// Views
const HOME = 'home';
const SEARCH = 'search';
const COLLECTION = 'collection'; // the library list (used on phones)
const ALL_SONGS = 'all';
const DOWNLOADS = 'downloads'; // songs saved for offline listening

const GENRES = [
  ['Lofi', 'lofi', 265],
  ['Hip-Hop', 'hip hop', 20],
  ['Electronic', 'electronic', 190],
  ['Chill', 'chill', 160],
  ['Workout', 'workout', 0],
  ['Piano', 'piano', 220],
  ['Acoustic', 'acoustic', 35],
  ['Jazz', 'jazz', 45],
  ['Ambient', 'ambient', 200],
  ['Rock', 'rock', 350],
];

const OFFLINE_SEARCH = 'You’re offline. Search needs internet; your downloaded songs are in Your Library → Downloaded.';

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

function timeAgo(ts) {
  if (!ts) return '';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
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

function useMedia(query) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

export default function App() {
  // Library
  const [lib, setLib] = useState(loadLibrary);
  useEffect(() => saveLibrary(lib), [lib]);

  // Navigation
  const [viewId, setViewId] = useState(HOME); // HOME, SEARCH, COLLECTION, ALL_SONGS or a playlist id
  const [filter, setFilter] = useState('');
  const [libFilter, setLibFilter] = useState('all'); // all | youtube | mine
  const mainRef = useRef(null);

  // Search and home shelves
  const [search, setSearch] = useState({ q: '', source: 'all', results: [], loading: false, error: '', heading: '' });
  const [searchText, setSearchText] = useState('');
  const searchSeq = useRef(0);
  // Song names suggested while typing in Search
  const [suggest, setSuggest] = useState({ items: [], open: false, active: -1 });
  const [home, setHome] = useState({ trending: [], fresh: [], radio: [], loading: true });

  // Playback
  const [queue, setQueue] = useState([]);
  const [queueFrom, setQueueFrom] = useState('');
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [time, setTime] = useState({ t: 0, d: 0 });
  const [seeking, setSeeking] = useState(null);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);

  // UI
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [menu, setMenu] = useState(null); // { song, x, y, top }
  const [dialog, setDialog] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const wide = useMedia('(min-width: 1180px)');

  // Offline: songs saved inside this browser, and whether there is internet
  const [savedIds, setSavedIds] = useState(() => new Set());
  const [downloading, setDownloading] = useState({}); // songId → true while saving
  const [online, setOnline] = useState(() => navigator.onLine);

  // Chrome and Edge offer to install the web app as a desktop app; keep their
  // prompt so our own "Install app" button can show it
  const [installPrompt, setInstallPrompt] = useState(null);
  useEffect(() => {
    const offer = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const installed = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const installApp = async () => {
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

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
  const inLibrary = useCallback((id) => !!songMap[id], [songMap]);
  const isSaved = useCallback((id) => savedIds.has(id), [savedIds]);
  const downloadedSongs = useMemo(() => lib.songs.filter((s) => savedIds.has(s.id)), [lib.songs, savedIds]);
  // Without internet only downloaded songs can play
  const canPlay = useCallback((song) => online || savedIds.has(song.id), [online, savedIds]);
  const view = lib.playlists.find((p) => p.id === viewId) || null;
  const isListView = !!view || viewId === ALL_SONGS || viewId === DOWNLOADS;
  const playlistSongs = useCallback((p) => p.songIds.map((id) => songMap[id]).filter(Boolean), [songMap]);

  const viewSongs = useMemo(() => {
    const list = view ? playlistSongs(view) : viewId === DOWNLOADS ? downloadedSongs : lib.songs;
    const q = filter.trim().toLowerCase();
    return q ? list.filter((s) => s.title.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q)) : list;
  }, [view, viewId, playlistSongs, downloadedSongs, lib.songs, filter]);

  const libraryItems = lib.playlists.filter((p) =>
    libFilter === 'all' ? true : libFilter === 'youtube' ? p.source === 'youtube' : p.source !== 'youtube'
  );

  const current = queue[index] || null;
  const currentIsYouTube = !!current && isYouTube(current);

  // ---------- Player setup ----------
  // YouTube's player needs internet to load; without it, this runs again once
  // the connection is back
  const ytStarted = useRef(false);
  const startYouTube = useCallback(() => {
    if (ytStarted.current) return;
    ytStarted.current = true;
    loadYouTubeApi()
      .then((YT) => {
        player.current = new YT.Player(playerEl.current, {
          width: '320',
          height: '180',
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
      .catch((e) => {
        ytStarted.current = false;
        if (navigator.onLine) showToast(e.message);
      });
  }, [showToast]);

  useEffect(() => {
    startYouTube();
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
    return () => a.pause();
  }, [startYouTube]);

  // Home shelves
  const loadHome = useCallback(() => {
    setHome((h) => ({ ...h, loading: true }));
    Promise.allSettled([
      trendingAudius(20),
      JAMENDO_CLIENT_ID ? popularJamendo(JAMENDO_CLIENT_ID, 20) : Promise.resolve([]),
      topRadio(20),
    ]).then(([t, f, r]) =>
      setHome({
        trending: t.status === 'fulfilled' ? t.value : [],
        fresh: f.status === 'fulfilled' ? f.value : [],
        radio: r.status === 'fulfilled' ? r.value : [],
        loading: false,
      })
    );
  }, []);
  useEffect(loadHome, [loadHome]);

  // Saved songs. A saved copy whose song was removed from the library is cleaned up.
  useEffect(() => {
    listSaved()
      .then((ids) => {
        const known = new Set(loadLibrary().songs.map((s) => s.id));
        for (const id of [...ids]) {
          if (known.has(id)) continue;
          ids.delete(id);
          removeOffline(id).catch(() => {});
        }
        setSavedIds(ids);
      })
      .catch(() => {});
  }, []);

  // Going offline and back online
  useEffect(() => {
    const down = () => {
      setOnline(false);
      showToast('You’re offline. Downloaded songs still play.');
    };
    const up = () => {
      setOnline(true);
      startYouTube();
      if (!window.google) initGoogle().then(setGoogleReady);
      if (!handlers.current.homeLoaded) loadHome();
      showToast('Back online');
    };
    window.addEventListener('offline', down);
    window.addEventListener('online', up);
    return () => {
      window.removeEventListener('offline', down);
      window.removeEventListener('online', up);
    };
  }, [showToast, startYouTube, loadHome]);

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
  const loadSeq = useRef(0);
  const blobUrl = useRef(null);

  const playAudioFrom = (src) => {
    if (blobUrl.current && blobUrl.current !== src) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = src.startsWith('blob:') ? src : null;
    audio.current.src = src;
    audio.current.play().catch(() => setIsPlaying(false));
  };

  const loadSong = (song) => {
    const seq = ++loadSeq.current;
    setTime({ t: 0, d: song.duration || 0 });
    if (!canPlay(song)) {
      audio.current.pause();
      if (playerReady.current) player.current.pauseVideo();
      return skipBroken('you’re offline and it isn’t downloaded', song);
    }
    if (isYouTube(song)) {
      audio.current.pause();
      if (playerReady.current) player.current.loadVideoById(song.id);
      else pendingVideo.current = song.id;
    } else {
      pendingVideo.current = null;
      if (playerReady.current) player.current.pauseVideo();
      if (!savedIds.has(song.id)) return playAudioFrom(streamUrlOf(song));
      // A downloaded copy plays without internet
      audio.current.pause();
      savedBlob(song.id)
        .catch(() => null)
        .then((blob) => {
          if (seq !== loadSeq.current) return;
          if (blob) playAudioFrom(URL.createObjectURL(blob));
          else if (online) playAudioFrom(streamUrlOf(song));
          else skipBroken('the downloaded copy is missing', song);
        });
    }
  };

  // from: a label for "Playing from …"
  const startQueue = (songs, start = 0, useShuffle = shuffle, from = '') => {
    if (!songs.length) return;
    // Offline, the queue only holds downloaded songs
    if (!online) {
      if (!canPlay(songs[start])) return showToast('You’re offline. Only downloaded songs play without internet.');
      const ok = songs.filter(canPlay);
      start = ok.indexOf(songs[start]);
      songs = ok;
    }
    const q = useShuffle ? [songs[start], ...shuffled(songs.filter((_, k) => k !== start))] : songs.slice();
    const i = useShuffle ? 0 : start;
    setQueue(q);
    setIndex(i);
    setQueueFrom(from);
    loadSong(q[i]);
  };

  const goTo = (i) => {
    setIndex(i);
    loadSong(queue[i]);
  };

  // Next and previous skip songs that can't play right now (offline and not downloaded)
  const next = (auto = false) => {
    if (!queue.length) return;
    const ahead = queue.findIndex((s, i) => i > index && canPlay(s));
    const first = queue.findIndex(canPlay);
    if (ahead !== -1) goTo(ahead);
    else if ((repeat === 'all' || !auto) && first !== -1) goTo(first);
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
    for (let k = 1, i = index; k <= queue.length; k++) {
      i = (i - 1 + queue.length) % queue.length;
      if (canPlay(queue[i])) return goTo(i);
    }
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

  // Play a list, or pause/resume it when it is already the one playing
  const playList = (songs, from, { shuffleIt = false } = {}) => {
    if (!songs.length) return;
    if (queueFrom === from && current && songs.some((s) => s.id === current.id) && !shuffleIt) return playPause();
    if (shuffleIt) setShuffle(true);
    startQueue(songs, shuffleIt ? Math.floor(Math.random() * songs.length) : 0, shuffleIt, from);
  };
  const isPlayingFrom = (from) => isPlaying && queueFrom === from;

  const toggleShuffle = () => {
    const on = !shuffle;
    setShuffle(on);
    if (on && current) {
      setQueue([current, ...shuffled(queue.filter((_, k) => k !== index))]);
      setIndex(0);
    }
  };

  const cycleRepeat = () => setRepeat((r) => ({ off: 'all', all: 'one', one: 'off' }[r]));

  const onSongEnded = () => {
    if (repeat === 'one') {
      seekTo(0);
      resume();
    } else next(true);
  };

  const skipBroken = (reason, song = current) => {
    showToast(`Can't play ${song ? `"${song.title}"` : 'this song'}: ${reason}. Skipping.`);
    setTimeout(() => handlers.current.next(true), 1500);
  };

  handlers.current = {
    ...handlers.current,
    currentIsYouTube,
    homeLoaded: home.trending.length > 0 || home.fresh.length > 0 || home.radio.length > 0,
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
    const set = (action, fn) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
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

  const playingWhenHidden = useRef(false);
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        playingWhenHidden.current = isPlaying && currentIsYouTube;
      } else if (playingWhenHidden.current && playerReady.current && player.current.getPlayerState() !== 1) {
        showToast('YouTube songs pause when the screen locks. Songs from Search keep playing. Press play to continue.');
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [isPlaying, currentIsYouTube, showToast]);

  // ---------- Full-screen "Now playing" and the side panel ----------
  const [npOpen, setNpOpen] = useState(false);
  const frameRef = useRef(null);
  const npSlotRef = useRef(null);
  const panelSlotRef = useRef(null);
  const npScroller = useRef(null);
  const panelScroller = useRef(null);
  const panelVisible = wide && panelOpen && !!current;

  const openNowPlaying = () => {
    if (npOpen || !current) return;
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
  handlers.current.closeNowPlaying = () => npOpen && closeNowPlaying();

  // The YouTube player is one element. It sits in the player bar and is moved
  // (with CSS, never re-mounted) over the side panel or the full-screen player,
  // so a video keeps playing while the layout changes.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const slot = npOpen ? npSlotRef.current : panelVisible ? panelSlotRef.current : null;
    if (!slot) {
      frame.classList.remove('floating');
      frame.style.cssText = '';
      return;
    }
    frame.classList.add('floating');
    const place = () => {
      const r = slot.getBoundingClientRect();
      Object.assign(frame.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(slot);
    const scroller = npOpen ? npScroller.current : panelScroller.current;
    window.addEventListener('resize', place);
    scroller && scroller.addEventListener('scroll', place, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      scroller && scroller.removeEventListener('scroll', place);
    };
  }, [npOpen, panelVisible, currentIsYouTube, current && current.id]);

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

  // ---------- Navigation ----------
  const go = (id) => {
    setViewId(id);
    setFilter('');
    setMenu(null);
    if (mainRef.current) mainRef.current.scrollTop = 0;
    if (id === SEARCH && !search.results.length && !search.loading) runSearch(search.q, search.source);
  };

  // ---------- Search ----------
  const runSearch = async (q, source) => {
    const seq = ++searchSeq.current;
    if (!navigator.onLine) {
      setSearch((s) => ({ ...s, q, source, loading: false, results: [], heading: '', error: OFFLINE_SEARCH }));
      return;
    }
    setSearch((s) => ({ ...s, q, source, loading: true, error: '' }));
    // "All sources" means songs; radio stations only show under Radio.
    // YouTube has the original releases, so its results come first.
    const ytAuth = youtubeAuth();
    const ytTask =
      source === 'youtube' || (source === 'all' && ytAuth)
        ? ytAuth
          ? q
            ? searchYouTube(q, ytAuth)
            : topYouTube(ytAuth, REGION)
          : Promise.reject(new Error(NO_YOUTUBE_SEARCH))
        : null;
    const tasks = [];
    if (source === 'all' || source === 'audius') tasks.push(q ? searchAudius(q) : trendingAudius());
    if (source === 'jamendo' || (source === 'all' && JAMENDO_CLIENT_ID)) {
      tasks.push(q ? searchJamendo(q, JAMENDO_CLIENT_ID) : popularJamendo(JAMENDO_CLIENT_ID));
    }
    if (source === 'all' || source === 'archive') tasks.push(q ? searchArchive(q) : popularArchive());
    if (source === 'radio') tasks.push(q ? searchRadio(q) : topRadio());
    const [yt, ...settled] = await Promise.allSettled([ytTask || Promise.resolve([]), ...tasks]);
    if (seq !== searchSeq.current) return;
    setSearch((s) => ({
      ...s,
      results: [
        ...(yt.status === 'fulfilled' ? yt.value : []),
        ...interleave(settled.filter((r) => r.status === 'fulfilled').map((r) => r.value)),
      ],
      loading: false,
      error: [yt, ...settled].filter((r) => r.status === 'rejected').map((r) => r.reason.message).join(' '),
      heading: q ? `Results for “${q}”` : source === 'radio' ? 'Popular stations' : 'Trending now',
    }));
  };

  useEffect(() => {
    const term = searchText.trim();
    if (viewId !== SEARCH || !suggest.open || !online || term.length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      suggestSongs(term, REGION)
        .then((items) => alive && setSuggest((s) => ({ ...s, items, active: -1 })))
        .catch(() => {});
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [searchText, viewId, suggest.open, online]);

  const closeSuggest = () => setSuggest({ items: [], open: false, active: -1 });

  const submitSearch = (q) => {
    closeSuggest();
    setSearchText(q);
    runSearch(q, search.source);
  };

  const onSearchKey = (e) => {
    const { items, active, open } = suggest;
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      // Cycles through the suggestions and back to the typed text (-1)
      setSuggest((s) => ({ ...s, active: ((s.active + 1 + step + items.length + 1) % (items.length + 1)) - 1 }));
    } else if (e.key === 'Enter' && active >= 0 && active < items.length) {
      e.preventDefault();
      submitSearch(items[active].query);
    } else if (e.key === 'Escape') closeSuggest();
  };

  const searchFor = (q) => {
    setSearchText(q);
    setViewId(SEARCH);
    runSearch(q, search.source);
  };

  // ---------- YouTube sync ----------
  const syncNow = async () => {
    if (!navigator.onLine) return showToast('You’re offline. Connect to the internet to sync YouTube.');
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
    if (!confirm('Sign out? Your YouTube playlists will be removed from TubeTunes. Songs you added yourself stay.')) return;
    signOutGoogle();
    if (view && view.source === 'youtube') setViewId(HOME);
    setLib((l) => ({ ...removeSynced(l), guest: false }));
  };

  // Signing in with Google also connects YouTube, so the login screen shows
  // until the user signs in or chooses to continue without an account
  const showLogin = googleConfigured && !lib.account && !lib.guest;

  // ---------- Adding songs ----------
  const addToView = (playlists, songId) =>
    view && view.source !== 'youtube'
      ? playlists.map((p) => (p.id === view.id && !p.songIds.includes(songId) ? { ...p, songIds: [...p.songIds, songId] } : p))
      : playlists;

  const addSongObject = (song) => {
    const exists = !!songMap[song.id];
    setLib((l) => ({
      ...l,
      songs: l.songs.some((s) => s.id === song.id) ? l.songs : [{ ...song, addedAt: Date.now() }, ...l.songs],
      playlists: addToView(l.playlists, song.id),
    }));
    showToast(exists ? `"${song.title}" is already in your library` : `Added "${song.title}" to your library`);
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
      go(pl.id);
      const skipped = ids.length - pl.songIds.length;
      showToast(`Imported "${name}": ${newSongs.length} new songs${skipped ? `, ${skipped} unavailable` : ''}`);
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(null);
    }
  };

  const addFromLink = async (url) => {
    if (!navigator.onLine) return showToast('You’re offline. Connect to the internet to add songs.');
    const listId = extractPlaylistId(url);
    const videoId = extractVideoId(url);
    if (listId && (!videoId || confirm('This link is part of a playlist.\n\nOK = import the whole playlist\nCancel = add only this song'))) {
      return importPlaylist(listId);
    }
    if (videoId) return addYouTubeSong(videoId);

    // An Internet Archive album: one song, or all of them as a new playlist
    const archiveId = extractArchiveId(url);
    if (archiveId) {
      setBusy('Reading the album on the Internet Archive…');
      try {
        const { title, songs } = await archiveItemTracks(archiveId);
        if (!songs.length) return showToast('That Internet Archive page has no MP3 songs.');
        if (songs.length === 1) return addSongObject(songs[0]);
        const now = Date.now();
        const pl = { id: `pl_${now}`, name: title, source: 'local', songIds: songs.map((s) => s.id) };
        setLib((l) => {
          const have = new Set(l.songs.map((s) => s.id));
          const add = songs.filter((s) => !have.has(s.id)).map((s, k) => ({ ...s, addedAt: now - k }));
          return { ...l, songs: [...add, ...l.songs], playlists: [...l.playlists, pl] };
        });
        go(pl.id);
        showToast(`Imported "${title}": ${songs.length} songs`);
      } catch (e) {
        showToast(e.message);
      } finally {
        setBusy(null);
      }
      return;
    }

    if (isAudiusLink(url)) {
      setBusy('Finding the track on Audius…');
      const song = await resolveAudius(url).catch(() => null);
      setBusy(null);
      return song ? addSongObject(song) : showToast('Could not find that Audius track.');
    }

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

    const song = directAudioSong(url);
    if (!song) return showToast('That link is not recognized. Paste a YouTube, Audius, Jamendo, Internet Archive or audio file link.');
    setBusy('Checking the audio link…');
    const probe = await probeAudio(url);
    setBusy(null);
    if (!probe.ok) return showToast('That link does not play as audio. Use a direct link to an MP3 or other audio file.');
    addSongObject({ ...song, duration: probe.duration });
  };

  // ---------- Downloads ----------
  // Saves the song inside the app (not the Downloads folder) so it plays
  // without internet, and adds it to the library and the Downloaded list.
  // Jamendo's file server may not let browsers read its files; then the
  // download fails with a message.
  const downloadSong = async (song) => {
    if (!canDownload(song)) return showToast('This song can’t be downloaded. Its owner only allows streaming.');
    if (savedIds.has(song.id) || downloading[song.id]) return;
    if (!navigator.onLine) return showToast('You’re offline. Connect to the internet to download.');
    setDownloading((d) => ({ ...d, [song.id]: true }));
    showToast(`Downloading “${song.title}”…`);
    try {
      await saveOffline(song, [song.downloadUrl, streamUrlOf(song)].filter(Boolean));
      setLib((l) => ({
        ...l,
        songs: l.songs.some((s) => s.id === song.id) ? l.songs : [{ ...song, addedAt: Date.now() }, ...l.songs],
      }));
      setSavedIds((ids) => new Set(ids).add(song.id));
      showToast(`“${song.title}” is downloaded and plays without internet`);
    } catch (e) {
      showToast(
        e.message !== 'download failed'
          ? e.message
          : song.source === 'jamendo'
            ? 'Jamendo doesn’t let web browsers save its songs. Use the Android app to download this one.'
            : 'Download failed. Check your internet connection and try again.'
      );
    } finally {
      setDownloading((d) => {
        const n = { ...d };
        delete n[song.id];
        return n;
      });
    }
  };

  const removeDownload = (song) => {
    removeOffline(song.id).catch(() => {});
    setSavedIds((ids) => {
      const n = new Set(ids);
      n.delete(song.id);
      return n;
    });
    showToast(`Removed the download of “${song.title}”`);
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
        then ? then(pl) : go(pl.id);
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
    go(HOME);
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
    if (savedIds.has(song.id)) removeDownload(song);
    setLib((l) => ({
      ...l,
      songs: l.songs.filter((s) => s.id !== song.id),
      playlists: l.playlists.map((p) => ({ ...p, songIds: p.songIds.filter((id) => id !== song.id) })),
    }));
  };

  // ---------- Render helpers ----------
  const progress = seeking ?? time.t;
  const pct = time.d ? Math.min(100, (progress / time.d) * 100) : 0;
  const subtitle = current ? current.artist || 'Unknown artist' : '';
  const upNext = queue.map((song, i) => ({ song, i })).slice(index + 1, index + 31);
  const finishSeek = () => {
    if (seeking !== null) seekTo(seeking);
    setSeeking(null);
  };

  const playlistLabel = (p) =>
    `${p.source === 'youtube' ? 'YouTube' : 'Playlist'} · ${p.songIds.length} song${p.songIds.length === 1 ? '' : 's'}`;

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  // Live radio has no length and can't be seeked
  const live = !!current && !!current.live;
  const progressBar = (
    <div className={`progress ${live ? 'live' : ''}`}>
      <span className="time">{fmtTime(progress)}</span>
      <input
        type="range"
        className="range"
        style={{ '--pct': `${live ? 0 : pct}%` }}
        min="0"
        max={live ? 1 : time.d || 1}
        step="0.1"
        value={live ? 0 : progress}
        onChange={(e) => setSeeking(+e.target.value)}
        onPointerUp={finishSeek}
        onKeyUp={finishSeek}
        disabled={live}
        aria-label="Seek"
      />
      <span className="time">{live ? <b className="live-badge">LIVE</b> : fmtTime(time.d)}</span>
    </div>
  );

  const transport = (big = false) => (
    <div className={`transport ${big ? 'big' : ''}`}>
      <button className={`ibtn toggle ${shuffle ? 'on' : ''}`} title="Shuffle" onClick={toggleShuffle}>
        <Shuffle size={big ? 24 : 18} />
      </button>
      <button className="ibtn" title="Previous" onClick={prev}>
        <SkipBack size={big ? 30 : 20} fill="currentColor" />
      </button>
      <button className="play" title={isPlaying ? 'Pause' : 'Play'} onClick={playPause}>
        {isPlaying ? <Pause size={big ? 30 : 18} fill="currentColor" /> : <Play size={big ? 30 : 18} fill="currentColor" className="nudge" />}
      </button>
      <button className="ibtn" title="Next" onClick={() => next()}>
        <SkipForward size={big ? 30 : 20} fill="currentColor" />
      </button>
      <button className={`ibtn toggle ${repeat !== 'off' ? 'on' : ''}`} title={`Repeat: ${repeat}`} onClick={cycleRepeat}>
        {repeat === 'one' ? <Repeat1 size={big ? 24 : 18} /> : <Repeat size={big ? 24 : 18} />}
      </button>
    </div>
  );

  const volumeControl = (
    <div className="vol">
      <button
        className="ibtn"
        title={muted ? 'Unmute' : 'Mute'}
        onClick={() => {
          const m = !muted;
          setMuted(m);
          audio.current.muted = m;
          if (playerReady.current) (m ? player.current.mute() : player.current.unMute());
        }}
      >
        <VolumeIcon size={18} />
      </button>
      <input
        type="range"
        className="range"
        style={{ '--pct': `${muted ? 0 : volume}%` }}
        min="0"
        max="100"
        value={muted ? 0 : volume}
        aria-label="Volume"
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
    </div>
  );

  const awakeButton = (
    <button
      className={`ibtn toggle ${keepAwake ? 'on' : ''}`}
      title={keepAwake ? 'Screen stays on during YouTube songs (click to turn off)' : 'Keep screen on during YouTube songs'}
      onClick={() => {
        setKeepAwake(!keepAwake);
        showToast(keepAwake ? 'Screen can lock again during YouTube songs' : 'Screen stays on during YouTube songs');
      }}
    >
      <Sun size={18} />
    </button>
  );

  const queueList = (
    <ol className="queue">
      {upNext.map(({ song, i }) => (
        <li key={`${song.id}-${i}`} onClick={() => goTo(i)}>
          <Cover songs={[song]} seed={song.id} className="q-art" />
          <div className="q-text">
            <div className="q-title">{song.title}</div>
            <div className="q-artist">{song.artist || 'Unknown artist'}</div>
          </div>
        </li>
      ))}
    </ol>
  );

  const libraryRow = (p) => {
    const songs = playlistSongs(p);
    const active = viewId === p.id;
    const liked = p.ytId === 'LIKED';
    return (
      <button key={p.id} className={`lib-row ${active ? 'active' : ''}`} onClick={() => go(p.id)}>
        {liked ? (
          <span className="cover liked">
            <Heart size={18} fill="currentColor" />
          </span>
        ) : (
          <Cover songs={songs} seed={p.id} icon={ListMusic} />
        )}
        <span className="lib-text">
          <span className={`lib-name ${isPlayingFrom(p.id) ? 'playing' : ''}`}>{p.name}</span>
          <span className="lib-sub">
            {p.source === 'youtube' ? <YouTubeIcon size={12} /> : null} {playlistLabel(p)}
          </span>
        </span>
        {isPlayingFrom(p.id) ? <Equalizer /> : null}
      </button>
    );
  };

  const allSongsRow = (
    <button className={`lib-row ${viewId === ALL_SONGS ? 'active' : ''}`} onClick={() => go(ALL_SONGS)}>
      <span className="cover all-songs">
        <Disc3 size={20} />
      </span>
      <span className="lib-text">
        <span className={`lib-name ${isPlayingFrom(ALL_SONGS) ? 'playing' : ''}`}>All songs</span>
        <span className="lib-sub">Your library · {lib.songs.length} songs</span>
      </span>
      {isPlayingFrom(ALL_SONGS) ? <Equalizer /> : null}
    </button>
  );

  const downloadsRow = (
    <button className={`lib-row ${viewId === DOWNLOADS ? 'active' : ''}`} onClick={() => go(DOWNLOADS)}>
      <span className="cover downloads">
        <CircleArrowDown size={20} />
      </span>
      <span className="lib-text">
        <span className={`lib-name ${isPlayingFrom(DOWNLOADS) ? 'playing' : ''}`}>Downloaded</span>
        <span className="lib-sub">
          {downloadedSongs.length} song{downloadedSongs.length === 1 ? '' : 's'} · plays offline
        </span>
      </span>
      {isPlayingFrom(DOWNLOADS) ? <Equalizer /> : null}
    </button>
  );

  const youtubeCard = lib.account ? (
    <div className="yt-account">
      {lib.account.avatar ? <img src={lib.account.avatar} alt="" referrerPolicy="no-referrer" /> : <YouTubeIcon size={20} />}
      <div className="yt-text">
        <b>{lib.account.name}</b>
        <span>Synced {timeAgo(lib.syncedAt)}</span>
      </div>
      <button className="ibtn" title="Sync now" onClick={syncNow} disabled={!!busy}>
        <RefreshCw size={16} />
      </button>
      <button className="ibtn" title="Sign out" onClick={disconnect}>
        <LogOut size={16} />
      </button>
    </div>
  ) : googleConfigured ? (
    <div className="yt-connect">
      <b>Bring your YouTube playlists</b>
      <span>Sign in with Google and they show up here.</span>
      <button className="pill light" onClick={syncNow} disabled={!googleReady || !!busy}>
        <GoogleIcon size={16} /> Sign in with Google
      </button>
    </div>
  ) : null;

  const libraryPanel = (
    <>
      <div className="lib-head">
        <button className="lib-title" onClick={() => go(COLLECTION)}>
          <Library size={22} /> Your Library
        </button>
        <button className="ibtn round" title="Create playlist" onClick={() => newPlaylist()}>
          <Plus size={18} />
        </button>
      </div>
      <div className="chips">
        {[
          ['all', 'All'],
          ['mine', 'Playlists'],
          ['youtube', 'YouTube'],
        ].map(([k, label]) => (
          <button key={k} className={`chip ${libFilter === k ? 'on' : ''}`} onClick={() => setLibFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="lib-list">
        {libFilter === 'all' ? allSongsRow : null}
        {libFilter === 'all' ? downloadsRow : null}
        {libraryItems.map(libraryRow)}
        {libFilter !== 'mine' ? youtubeCard : null}
        {libFilter === 'mine' && !libraryItems.length ? (
          <div className="lib-empty">
            <b>Create your first playlist</b>
            <span>It's easy, we'll help you.</span>
            <button className="pill light" onClick={() => newPlaylist()}>
              Create playlist
            </button>
          </div>
        ) : null}
      </div>
    </>
  );

  // ---------- Views ----------
  const heroHue = hueOf(view ? view.id : viewId);

  const listView = () => {
    const isDownloads = !view && viewId === DOWNLOADS;
    const songs = view ? playlistSongs(view) : isDownloads ? downloadedSongs : lib.songs;
    const from = view ? view.id : isDownloads ? DOWNLOADS : ALL_SONGS;
    const isYt = view && view.source === 'youtube';
    return (
      <div className="page" style={{ '--hue': isDownloads ? 150 : heroHue }}>
        <header className="hero">
          {view && view.ytId === 'LIKED' ? (
            <span className="cover hero-cover liked">
              <Heart size="40%" fill="currentColor" />
            </span>
          ) : isDownloads ? (
            <span className="cover hero-cover downloads">
              <CircleArrowDown size="42%" />
            </span>
          ) : view ? (
            <Cover songs={songs} seed={view.id} icon={ListMusic} className="hero-cover" />
          ) : (
            <span className="cover hero-cover all-songs">
              <Disc3 size="42%" />
            </span>
          )}
          <div className="hero-text">
            <span className="hero-kind">
              {isYt ? <><YouTubeIcon size={14} /> YouTube playlist</> : view ? 'Playlist' : 'Library'}
            </span>
            <h1>{view ? view.name : isDownloads ? 'Downloaded' : 'All songs'}</h1>
            <span className="hero-meta">
              {isYt && lib.account ? <b>{lib.account.name} · </b> : null}
              {songs.length} song{songs.length === 1 ? '' : 's'}
              {isDownloads ? ' · saved in this browser, play without internet' : ''}
            </span>
          </div>
        </header>

        <div className="action-bar">
          <button className="big-play" title="Play" onClick={() => playList(viewSongs, from)} disabled={!viewSongs.length}>
            {isPlayingFrom(from) ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="nudge" />}
          </button>
          <button className="ibtn xl" title="Shuffle play" onClick={() => playList(viewSongs, from, { shuffleIt: true })} disabled={!viewSongs.length}>
            <Shuffle size={26} />
          </button>
          {view && !isYt ? (
            <>
              <button className="ibtn xl" title="Rename" onClick={renamePlaylist}>
                <Pencil size={22} />
              </button>
              <button className="ibtn xl" title="Delete playlist" onClick={deletePlaylist}>
                <Trash size={22} />
              </button>
            </>
          ) : null}
          <label className="find">
            <Search size={16} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find in this list" />
          </label>
        </div>

        {viewSongs.length ? (
          <TrackTable
            songs={viewSongs}
            currentId={current && current.id}
            isPlaying={isPlaying}
            onPlay={(i) => startQueue(viewSongs, i, shuffle, from)}
            onMore={openMenu}
            onDownload={downloadSong}
            isSaved={isSaved}
            downloading={downloading}
            canPlay={canPlay}
          />
        ) : isDownloads && !filter ? (
          <div className="empty">
            <CircleArrowDown size={44} strokeWidth={1.4} />
            <b>No downloads yet</b>
            <span>Tap the download button on a song from Search or an audio link. It’s saved here and plays without internet.</span>
            <div className="empty-actions">
              <button className="pill light" onClick={() => go(SEARCH)}>
                <Search size={16} /> Search music
              </button>
            </div>
          </div>
        ) : (
          <div className="empty">
            <Disc3 size={44} strokeWidth={1.4} />
            <b>{filter ? 'No matches' : 'Nothing here yet'}</b>
            <span>
              {filter ? 'Try another word.' : 'Find songs in Search, or add one from a link.'}
            </span>
            {!filter ? (
              <div className="empty-actions">
                <button className="pill light" onClick={() => go(SEARCH)}>
                  <Search size={16} /> Search music
                </button>
                <button className="pill" onClick={() => setLinkOpen(true)}>
                  <Link2 size={16} /> Add from link
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  const homeView = () => {
    const quick = [
      { id: ALL_SONGS, name: 'All songs', songs: lib.songs, all: true },
      ...(downloadedSongs.length ? [{ id: DOWNLOADS, name: 'Downloaded', songs: downloadedSongs, downloads: true }] : []),
      ...lib.playlists.slice(0, downloadedSongs.length ? 6 : 7).map((p) => ({ id: p.id, name: p.name, songs: playlistSongs(p), liked: p.ytId === 'LIKED' }))];
    return (
      <div className="page" style={{ '--hue': 330 }}>
        <header className="home-head">
          <h1>{greeting()}</h1>
        </header>

        <div className="quick">
          {quick.map((q) => (
            <div key={q.id} className="quick-tile" onClick={() => go(q.id)}>
              {q.all ? (
                <span className="cover all-songs">
                  <Disc3 size={22} />
                </span>
              ) : q.liked ? (
                <span className="cover liked">
                  <Heart size={20} fill="currentColor" />
                </span>
              ) : q.downloads ? (
                <span className="cover downloads">
                  <CircleArrowDown size={22} />
                </span>
              ) : (
                <Cover songs={q.songs} seed={q.id} icon={ListMusic} />
              )}
              <span className="quick-name">{q.name}</span>
              <button
                className={`fab small ${isPlayingFrom(q.id) ? 'show' : ''}`}
                title="Play"
                onClick={(e) => {
                  e.stopPropagation();
                  playList(q.songs, q.id);
                }}
              >
                {isPlayingFrom(q.id) ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>
            </div>
          ))}
        </div>

        <Shelf
          title="Trending now"
          action={
            <button className="link" onClick={() => go(SEARCH)}>
              Show all
            </button>
          }
        >
          {home.loading
            ? Array.from({ length: 6 }, (_, i) => <div key={i} className="card skeleton" />)
            : home.trending.map((s, i) => (
                <Card
                  key={s.id}
                  title={s.title}
                  subtitle={s.artist}
                  cover={<Cover songs={[s]} seed={s.id} />}
                  playing={isPlaying && current && current.id === s.id}
                  onOpen={() => startQueue(home.trending, i, false, 'trending')}
                  onPlay={() => (current && current.id === s.id ? playPause() : startQueue(home.trending, i, false, 'trending'))}
                />
              ))}
        </Shelf>

        {home.fresh.length ? (
          <Shelf title="Popular on Jamendo">
            {home.fresh.map((s, i) => (
              <Card
                key={s.id}
                title={s.title}
                subtitle={s.artist}
                cover={<Cover songs={[s]} seed={s.id} />}
                playing={isPlaying && current && current.id === s.id}
                onOpen={() => startQueue(home.fresh, i, false, 'fresh')}
                onPlay={() => (current && current.id === s.id ? playPause() : startQueue(home.fresh, i, false, 'fresh'))}
              />
            ))}
          </Shelf>
        ) : null}

        {home.radio.length ? (
          <Shelf
            title="Live radio"
            action={
              <button
                className="link"
                onClick={() => {
                  setSearchText('');
                  setViewId(SEARCH);
                  runSearch('', 'radio');
                }}
              >
                Show all
              </button>
            }
          >
            {home.radio.map((s, i) => (
              <Card
                key={s.id}
                title={s.title}
                subtitle={s.artist}
                cover={<Cover songs={[s]} seed={s.id} />}
                playing={isPlaying && current && current.id === s.id}
                onOpen={() => startQueue(home.radio, i, false, 'radio')}
                onPlay={() => (current && current.id === s.id ? playPause() : startQueue(home.radio, i, false, 'radio'))}
              />
            ))}
          </Shelf>
        ) : null}

        {lib.playlists.length ? (
          <Shelf title="Your playlists">
            {lib.playlists.map((p) => (
              <Card
                key={p.id}
                title={p.name}
                subtitle={playlistLabel(p)}
                cover={
                  p.ytId === 'LIKED' ? (
                    <span className="cover liked">
                      <Heart size="36%" fill="currentColor" />
                    </span>
                  ) : (
                    <Cover songs={playlistSongs(p)} seed={p.id} icon={ListMusic} />
                  )
                }
                playing={isPlayingFrom(p.id)}
                onOpen={() => go(p.id)}
                onPlay={() => playList(playlistSongs(p), p.id)}
              />
            ))}
          </Shelf>
        ) : null}

        {lib.songs.length ? (
          <Shelf title="Recently added">
            {lib.songs.slice(0, 14).map((s, i) => (
              <Card
                key={s.id}
                title={s.title}
                subtitle={s.artist}
                cover={<Cover songs={[s]} seed={s.id} />}
                playing={isPlaying && current && current.id === s.id}
                onOpen={() => startQueue(lib.songs, i, false, ALL_SONGS)}
                onPlay={() => (current && current.id === s.id ? playPause() : startQueue(lib.songs, i, false, ALL_SONGS))}
              />
            ))}
          </Shelf>
        ) : null}

        <section className="shelf">
          <div className="shelf-head">
            <h2>Browse by mood</h2>
          </div>
          <div className="genres">
            {GENRES.map(([label, q, hue]) => (
              <button key={label} className="genre" style={{ '--hue': hue }} onClick={() => searchFor(q)}>
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const searchView = () => (
    <div className="page" style={{ '--hue': 250 }}>
      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          submitSearch(searchText.trim());
        }}
      >
        <Search size={20} />
        <input
          type="search"
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            setSuggest((s) => ({ ...s, open: true, items: e.target.value.trim().length < 2 ? [] : s.items }));
          }}
          onKeyDown={onSearchKey}
          onBlur={closeSuggest}
          placeholder="What do you want to listen to?"
          autoComplete="off"
          autoFocus
        />
        {searchText ? (
          <button
            type="button"
            className="ibtn"
            title="Clear"
            onClick={() => {
              setSearchText('');
              closeSuggest();
              runSearch('', search.source);
            }}
          >
            <X size={18} />
          </button>
        ) : null}
        {suggest.open && suggest.items.length ? (
          // mousedown keeps focus in the input, so the list isn't closed by blur first
          <ul className="suggest" role="listbox" onMouseDown={(e) => e.preventDefault()}>
            {suggest.items.map((it, i) => (
              <li
                key={it.query}
                role="option"
                aria-selected={i === suggest.active}
                className={i === suggest.active ? 'on' : ''}
                onMouseEnter={() => setSuggest((s) => ({ ...s, active: i }))}
                onClick={() => submitSearch(it.query)}
              >
                <Search size={16} />
                <span>
                  <b>{it.title}</b>
                  <small>{it.artist}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </form>

      <div className="chips">
        {[
          ['all', 'All sources'],
          ['youtube', 'YouTube'],
          ['audius', 'Audius'],
          ['jamendo', 'Jamendo'],
          ['archive', 'Internet Archive'],
          ['radio', 'Live radio'],
        ].map(([key, label]) => (
          <button key={key} className={`chip ${search.source === key ? 'on' : ''}`} onClick={() => runSearch(search.q, key)}>
            {label}
          </button>
        ))}
      </div>

      {search.error ? <p className="error">{search.error}</p> : null}

      {!search.q ? (
        <section className="shelf">
          <div className="shelf-head">
            <h2>Browse all</h2>
          </div>
          <div className="genres">
            {GENRES.map(([label, q, hue]) => (
              <button key={label} className="genre" style={{ '--hue': hue }} onClick={() => searchFor(q)}>
                {label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {search.loading ? (
        <div className="empty">
          <LoaderCircle size={34} className="spin" />
        </div>
      ) : search.results.length ? (
        <>
          <div className="shelf-head">
            <h2>{search.heading}</h2>
            <button className="pill" onClick={() => playList(search.results, 'search')}>
              <Play size={14} fill="currentColor" /> Play all
            </button>
          </div>
          <p className="hint">
            {search.source === 'radio'
              ? 'Live stations from around the world. Search a station name or a genre like bollywood or lofi.'
              : search.source === 'youtube'
              ? 'Original songs from YouTube. They play in YouTube’s player and can’t be downloaded.'
              : 'YouTube songs come first. Songs from the free sources keep playing when your phone is locked, and Internet Archive songs can be downloaded.'}
          </p>
          <TrackTable
            songs={search.results}
            currentId={current && current.id}
            isPlaying={isPlaying}
            onPlay={(i) => startQueue(search.results, i, shuffle, 'search')}
            onMore={openMenu}
            onAdd={addSongObject}
            inLibrary={inLibrary}
            onDownload={downloadSong}
            isSaved={isSaved}
            downloading={downloading}
            canPlay={canPlay}
          />
        </>
      ) : search.q ? (
        <div className="empty">
          <Search size={40} strokeWidth={1.4} />
          <b>No results for “{search.q}”</b>
          <span>Check the spelling, or try another word or source.</span>
        </div>
      ) : null}
    </div>
  );

  const collectionView = () => (
    <div className="page collection" style={{ '--hue': 280 }}>{libraryPanel}</div>
  );

  // ---------- Layout ----------
  const bottomNav = [
    [HOME, 'Home', House],
    [SEARCH, 'Search', Search],
    [COLLECTION, 'Your Library', Library],
  ];
  const navActive = (id) =>
    id === COLLECTION ? viewId === COLLECTION || isListView : viewId === id;

  return (
    <div className={`shell ${panelVisible ? 'with-panel' : ''}`} onClick={() => setMenu(null)}>
      {/* Sidebar */}
      <aside className="side">
        <nav className="box nav">
          <a className="brand" href="../">
            <span className="logo">
              <Disc3 size={18} />
            </span>
            TubeTunes
          </a>
          <button className={`nav-link ${viewId === HOME ? 'active' : ''}`} onClick={() => go(HOME)}>
            <House size={22} /> Home
          </button>
          <button className={`nav-link ${viewId === SEARCH ? 'active' : ''}`} onClick={() => go(SEARCH)}>
            <Search size={22} /> Search
          </button>
        </nav>
        <div className="box library">{libraryPanel}</div>
      </aside>

      {/* Main */}
      <main className="box main" ref={mainRef}>
        <div className="topbar">
          <span className="topbar-brand">
            <span className="logo">
              <Disc3 size={16} />
            </span>
            TubeTunes
          </span>
          <div className="topbar-actions">
            {!online ? (
              <button className="pill offline" title="No internet: downloaded songs still play" onClick={() => go(DOWNLOADS)}>
                <WifiOff size={16} /> <span className="hide-sm">Offline</span>
              </button>
            ) : null}
            {installPrompt ? (
              <button className="pill" title="Install TubeTunes as an app on this device" onClick={installApp}>
                <MonitorDown size={16} /> <span className="hide-sm">Install app</span>
              </button>
            ) : null}
            <button className="pill light" onClick={() => setLinkOpen(true)}>
              <Link2 size={16} /> <span className="hide-sm">Add from link</span>
            </button>
            {lib.account ? (
              <button className="avatar" title={`${lib.account.name}: sync now`} onClick={syncNow}>
                {lib.account.avatar ? <img src={lib.account.avatar} alt="" referrerPolicy="no-referrer" /> : lib.account.name[0]}
              </button>
            ) : null}
          </div>
        </div>

        {viewId === HOME ? homeView() : viewId === SEARCH ? searchView() : viewId === COLLECTION ? collectionView() : isListView ? listView() : homeView()}
      </main>

      {/* Now playing side panel (wide screens) */}
      {panelVisible ? (
        <aside className="box panel" ref={panelScroller}>
          <div className="panel-head">
            <b>{queueFrom && lib.playlists.find((p) => p.id === queueFrom) ? lib.playlists.find((p) => p.id === queueFrom).name : 'Now playing'}</b>
            <button className="ibtn" title="Hide" onClick={() => setPanelOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <div className={`slot ${currentIsYouTube ? 'wide' : 'square'}`} ref={panelSlotRef} />
          <div className="panel-meta">
            <div>
              <h3>{current.title}</h3>
              <p>{subtitle}</p>
            </div>
            <HeartButton saved={inLibrary(current.id)} onAdd={() => addSongObject(current)} />
          </div>
          <div className="panel-source">
            <span className={`src src-${sourceOf(current)}`}>
              {currentIsYouTube ? <YouTubeIcon size={14} /> : null}
              {SOURCE_LABELS[sourceOf(current)]}
            </span>
            <span className="panel-links">
              {savedIds.has(current.id) ? (
                <button onClick={() => go(DOWNLOADS)}>
                  <CircleCheck size={13} /> Downloaded
                </button>
              ) : canDownload(current) ? (
                <button onClick={() => downloadSong(current)} disabled={!!downloading[current.id]}>
                  <Download size={13} /> {downloading[current.id] ? 'Downloading…' : 'Download'}
                </button>
              ) : null}
              <a href={pageUrlOf(current)} target="_blank" rel="noopener noreferrer">
                Open <ExternalLink size={13} />
              </a>
            </span>
          </div>
          {upNext.length ? (
            <div className="panel-queue">
              <b>Next in queue</b>
              {queueList}
            </div>
          ) : null}
        </aside>
      ) : null}

      {/* Player bar */}
      <footer className={`bar ${current ? '' : 'idle'}`}>
        <div className="bar-progress" style={{ width: `${pct}%` }} />
        <div className="bar-left" onClick={(e) => { e.stopPropagation(); openNowPlaying(); }}>
          <div className={`bar-art ${currentIsYouTube ? 'wide' : ''}`}>
            {current ? <Cover songs={[current]} seed={current.id} className="bar-art-bg" /> : null}
            <div className="frame" ref={frameRef}>
              <div ref={playerEl} />
              {current && !currentIsYouTube ? (
                <div className="frame-cover">
                  <Cover songs={[current]} seed={current.id} />
                </div>
              ) : null}
              {!current ? (
                <div className="frame-cover idle">
                  <Disc3 size={22} />
                </div>
              ) : null}
            </div>
          </div>
          <div className="bar-text">
            <div className="bar-title">{current ? current.title : 'Nothing playing'}</div>
            <div className="bar-artist">{current ? subtitle : 'Pick something to play'}</div>
          </div>
          {current ? (
            <span onClick={(e) => e.stopPropagation()}>
              <HeartButton saved={inLibrary(current.id)} onAdd={() => addSongObject(current)} />
            </span>
          ) : null}
          {current ? (
            <button
              className="ibtn mini-play"
              onClick={(e) => {
                e.stopPropagation();
                playPause();
              }}
            >
              {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
            </button>
          ) : null}
        </div>

        <div className="bar-center">
          {transport(false)}
          {progressBar}
        </div>

        <div className="bar-right">
          {awakeButton}
          {wide ? (
            <button className={`ibtn toggle ${panelOpen ? 'on' : ''}`} title="Now playing view" onClick={() => setPanelOpen(!panelOpen)}>
              <PanelRight size={18} />
            </button>
          ) : null}
          {volumeControl}
          <button className="ibtn" title="Full screen player" onClick={openNowPlaying} disabled={!current}>
            <Maximize2 size={17} />
          </button>
        </div>
      </footer>

      {/* Phone navigation */}
      <nav className="tabbar">
        {bottomNav.map(([id, label, Icon]) => (
          <button key={id} className={navActive(id) ? 'active' : ''} onClick={() => go(id)}>
            <Icon size={24} strokeWidth={navActive(id) ? 2.4 : 1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* Full-screen player */}
      {npOpen && current ? (
        <div className="np" ref={npScroller} role="dialog" aria-label="Now playing" style={{ '--hue': hueOf(current.id) }}>
          {artworkOf(current) ? <div className="np-blur" style={{ backgroundImage: `url("${artworkOf(current)}")` }} /> : null}
          <div className="np-inner">
            <header className="np-head">
              <button className="ibtn" title="Close" onClick={closeNowPlaying}>
                <ChevronDown size={28} />
              </button>
              <div className="np-from">
                <span>Playing from</span>
                <b>{queueFrom && lib.playlists.find((p) => p.id === queueFrom) ? lib.playlists.find((p) => p.id === queueFrom).name : queueFrom === 'search' ? 'Search' : queueFrom === ALL_SONGS ? 'All songs' : queueFrom === DOWNLOADS ? 'Downloaded' : queueFrom === 'radio' ? 'Live radio' : 'TubeTunes'}</b>
              </div>
              <button className="ibtn" title="More" onClick={(e) => openMenu(current, e)}>
                <Ellipsis size={24} />
              </button>
            </header>
            <div className={`slot ${currentIsYouTube ? 'wide' : 'square'}`} ref={npSlotRef} />
            <div className="np-meta">
              <div>
                <h2>{current.title}</h2>
                <p>{subtitle}</p>
              </div>
              <HeartButton saved={inLibrary(current.id)} onAdd={() => addSongObject(current)} />
            </div>
            {progressBar}
            {transport(true)}
            <div className="np-extra">
              {awakeButton}
              <span className={`src src-${sourceOf(current)}`}>
                {currentIsYouTube ? <YouTubeIcon size={14} /> : null}
                {SOURCE_LABELS[sourceOf(current)]}
              </span>
              <span>
                {savedIds.has(current.id) ? (
                  <span className="ibtn saved" title="Downloaded: plays without internet">
                    <CircleCheck size={20} />
                  </span>
                ) : canDownload(current) ? (
                  <button className="ibtn" title="Download" onClick={() => downloadSong(current)} disabled={!!downloading[current.id]}>
                    {downloading[current.id] ? <LoaderCircle size={20} className="spin" /> : <Download size={20} />}
                  </button>
                ) : null}
                <a className="ibtn" href={pageUrlOf(current)} target="_blank" rel="noopener noreferrer" title="Open source page">
                  <ExternalLink size={18} />
                </a>
              </span>
            </div>
            {upNext.length ? (
              <section className="np-queue">
                <h3>Up next</h3>
                {queueList}
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      {menu ? (
        <SongMenu
          menu={menu}
          inLibrary={!!songMap[menu.song.id]}
          playlists={lib.playlists.filter((p) => p.source !== 'youtube' && (!view || p.id !== view.id))}
          inMyPlaylist={!!view && view.source !== 'youtube' && !npOpen}
          onPlayNext={menuAction(playNext)}
          onAddToLibrary={menuAction((s) => addSongObject(s))}
          onEdit={menuAction(editSong)}
          onOpen={menuAction((s) => window.open(pageUrlOf(s), '_blank', 'noopener'))}
          onDownload={menuAction(downloadSong)}
          saved={savedIds.has(menu.song.id)}
          onRemoveDownload={menuAction(removeDownload)}
          onAdd={(pl) => menuAction((s) => addToPlaylist(s, pl))()}
          onNew={menuAction((s) => newPlaylist([s], (pl) => showToast(`Added to "${pl.name}"`)))}
          onRemove={menuAction(removeFromPlaylist)}
          onDelete={menuAction(deleteSong)}
        />
      ) : null}

      {showLogin ? (
        <LoginScreen
          ready={googleReady && !busy}
          onSignIn={syncNow}
          onSkip={() => setLib((l) => ({ ...l, guest: true }))}
        />
      ) : null}

      {linkOpen ? <LinkDialog onClose={() => setLinkOpen(false)} onSubmit={(url) => addFromLink(url)} /> : null}
      {dialog ? <Dialog dialog={dialog} onClose={() => setDialog(null)} /> : null}

      {busy ? (
        <div className="overlay">
          <div className="busy">
            <LoaderCircle size={34} className="spin" />
            <p>{busy}</p>
          </div>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function SongMenu({ menu, inLibrary, playlists, inMyPlaylist, onPlayNext, onAddToLibrary, onEdit, onOpen, onDownload, saved, onRemoveDownload, onAdd, onNew, onRemove, onDelete }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y, visibility: 'hidden' });
  const [picking, setPicking] = useState(false);
  const src = sourceOf(menu.song);

  useLayoutEffect(() => {
    const el = ref.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(menu.x - w, window.innerWidth - w - 8));
    const top = menu.y + h + 8 > window.innerHeight ? Math.max(8, menu.top - h - 4) : menu.y + 4;
    setPos({ left, top });
  }, [menu, picking]);

  const Item = ({ icon: Icon, children, onClick, danger }) => (
    <button className={danger ? 'danger' : ''} onClick={onClick}>
      <Icon size={17} /> {children}
    </button>
  );

  return (
    <div className="menu" ref={ref} style={pos} onClick={(e) => e.stopPropagation()}>
      {picking ? (
        <>
          <Item icon={ChevronDown} onClick={() => setPicking(false)}>
            Back
          </Item>
          <hr />
          <Item icon={Plus} onClick={onNew}>
            New playlist
          </Item>
          {playlists.map((p) => (
            <Item key={p.id} icon={ListMusic} onClick={() => onAdd(p)}>
              {p.name}
            </Item>
          ))}
        </>
      ) : (
        <>
          <div className="menu-song">
            <b>{menu.song.title}</b>
            <span>{menu.song.artist}</span>
          </div>
          <Item icon={ListEnd} onClick={onPlayNext}>
            Play next
          </Item>
          {!inLibrary ? (
            <Item icon={Heart} onClick={onAddToLibrary}>
              Add to library
            </Item>
          ) : null}
          <Item icon={ListPlus} onClick={() => setPicking(true)}>
            Add to playlist
          </Item>
          {inLibrary ? (
            <Item icon={Pencil} onClick={onEdit}>
              Edit details
            </Item>
          ) : null}
          {saved ? (
            <Item icon={CircleMinus} onClick={onRemoveDownload}>
              Remove download
            </Item>
          ) : canDownload(menu.song) ? (
            <Item icon={Download} onClick={onDownload}>
              Download
            </Item>
          ) : null}
          <Item icon={ExternalLink} onClick={onOpen}>
            {src === 'url' ? 'Open link' : `Open on ${SOURCE_LABELS[src]}`}
          </Item>
          {inLibrary ? (
            <>
              <hr />
              {inMyPlaylist ? (
                <Item icon={CircleMinus} onClick={onRemove}>
                  Remove from this playlist
                </Item>
              ) : null}
              <Item icon={Trash} danger onClick={onDelete}>
                Delete from library
              </Item>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function GoogleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

// Shown on first visit: one Google sign-in also connects YouTube and syncs it
function LoginScreen({ ready, onSignIn, onSkip }) {
  return (
    <div className="login" role="dialog" aria-label="Sign in to TubeTunes" onClick={(e) => e.stopPropagation()}>
      <div className="login-card">
        <span className="logo login-logo">
          <Disc3 size={30} />
        </span>
        <h1>TubeTunes</h1>
        <p>Your YouTube playlists, as a music app.</p>
        <button className="login-google" onClick={onSignIn} disabled={!ready}>
          <GoogleIcon size={20} /> Continue with Google
        </button>
        <small>
          TubeTunes only reads your YouTube playlists and liked videos. It can't change anything.{' '}
          <a href="../privacy/">Privacy policy</a>
        </small>
        <button className="login-skip" onClick={onSkip}>
          Continue without signing in
        </button>
      </div>
    </div>
  );
}

function LinkDialog({ onClose, onSubmit }) {
  const [url, setUrl] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    onClose();
    onSubmit(url.trim());
  };
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setUrl(t.trim());
    } catch {}
  };
  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="dialog-head">
          <h2>Add from a link</h2>
          <button type="button" className="ibtn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
        <p className="muted">Paste a YouTube song or playlist, an Audius or Jamendo track, an Internet Archive album, or a direct MP3 link.</p>
        <div className="link-row">
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          <button type="button" className="pill" onClick={paste} title="Paste from clipboard">
            <Clipboard size={16} /> Paste
          </button>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="pill" onClick={onClose}>
            Cancel
          </button>
          <button className="pill accent" disabled={!url.trim()}>
            Add
          </button>
        </div>
      </form>
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
        <div className="dialog-head">
          <h2>{dialog.title}</h2>
          <button type="button" className="ibtn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
        {dialog.fields.map((f, i) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <input autoFocus={i === 0} value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          </label>
        ))}
        <div className="dialog-buttons">
          <button type="button" className="pill" onClick={onClose}>
            Cancel
          </button>
          <button className="pill accent" disabled={!ok}>
            {dialog.submitLabel || 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
