import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';

import { colors } from './src/theme';
import { emptyLibrary, loadLibrary, saveLibrary } from './src/storage';
import {
  extractPlaylistId,
  extractVideoId,
  fetchManyVideoInfo,
  fetchPlaylistTitle,
  fetchVideoInfo,
} from './src/youtube';
import { isSavedFile, removeOffline, saveOffline } from './src/downloads';
import {
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
  streamUrlOf,
  suggestSongs,
  topRadio,
  trendingAudius,
} from './src/sources';
import { JAMENDO_CLIENT_ID, YOUTUBE_API_KEY } from './src/config';
import { mergeSync, removeSynced, searchYouTube, syncYouTube, topYouTube } from './src/ytsync';
import { dropToken, getAccessToken, googleAvailable, signOutGoogle } from './src/google';
import SongRow from './src/SongRow';
import SongMenu from './src/SongMenu';
import PromptModal from './src/PromptModal';
import PlayerPanel from './src/PlayerPanel';
import YouTubeEngine from './src/YouTubeEngine';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Main />
    </SafeAreaProvider>
  );
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Alert with buttons that resolves to the chosen button's value (null if dismissed)
function choose(title, message, buttons) {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      buttons.map((b) => ({ text: b.text, style: b.style, onPress: () => resolve(b.value) })),
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

const DOWNLOADS = 'downloads';

const REGION = regionOf(Intl.DateTimeFormat().resolvedOptions().locale);
const NO_YOUTUBE_SEARCH = 'Connect YouTube (in Playlists) to search YouTube.';

// API key if set, otherwise the signed-in user's token (never shows the sign-in screen)
async function youtubeAuth() {
  if (YOUTUBE_API_KEY) return { key: YOUTUBE_API_KEY };
  try {
    return await getAccessToken({ interactive: false });
  } catch {
    return null;
  }
}

// Mixes several result lists: a1, b1, a2, b2, ...
function interleave(lists) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

const ERROR_REASONS = {
  2: 'invalid video',
  5: 'player error',
  100: 'video removed or private',
  101: 'the uploader blocks playing it in apps',
  150: 'the uploader blocks playing it in apps',
};

function Main() {
  const insets = useSafeAreaInsets();

  // Library
  const [lib, setLib] = useState(emptyLibrary);
  const [loaded, setLoaded] = useState(false);

  // Navigation
  const [tab, setTab] = useState('songs'); // songs | playlists | search

  // Search (Audius + Jamendo)
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState({ q: '', source: 'all', results: [], loading: false, error: '', heading: '' });
  const searchSeq = useRef(0);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [openPlaylistId, setOpenPlaylistId] = useState(null);
  const [filter, setFilter] = useState('');

  // Playback
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // off | all | one
  const [expanded, setExpanded] = useState(false);

  // Dialogs
  const [menuSong, setMenuSong] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);

  // Playlist import uses a second, invisible player
  const [importListId, setImportListId] = useState(null);
  const importEngine = useRef(null);
  const importResolve = useRef(null);

  const player = useRef(null);
  const playerReady = useRef(false);
  const pendingVideo = useRef(null);
  const toastTimer = useRef(null);
  const nextRef = useRef(null);

  useEffect(() => {
    loadLibrary().then((data) => {
      setLib(data);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) saveLibrary(lib);
  }, [lib, loaded]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // ---------- Derived data ----------
  const songMap = useMemo(() => Object.fromEntries(lib.songs.map((s) => [s.id, s])), [lib.songs]);
  // "Downloaded" is a built-in list of the songs saved for offline listening
  const downloadedIds = useMemo(() => lib.songs.filter((s) => s.localUri).map((s) => s.id), [lib.songs]);
  const openPlaylist =
    openPlaylistId === DOWNLOADS
      ? { id: DOWNLOADS, name: 'Downloaded', source: 'downloads', songIds: downloadedIds }
      : lib.playlists.find((p) => p.id === openPlaylistId) || null;
  // Only the user's own playlists can be renamed, deleted or added to
  const editable = !!openPlaylist && openPlaylist.source !== 'youtube' && openPlaylist.source !== 'downloads';
  const [downloading, setDownloading] = useState({}); // songId → true while saving

  const viewSongs = useMemo(() => {
    const list = openPlaylist
      ? openPlaylist.songIds.map((id) => songMap[id]).filter(Boolean)
      : lib.songs;
    const q = filter.trim().toLowerCase();
    return q
      ? list.filter((s) => s.title.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q))
      : list;
  }, [openPlaylist, songMap, lib.songs, filter]);

  const current = queue[index] || null;
  const currentIsYouTube = !!current && isYouTube(current);

  // ---------- Audio engine (Audius, Jamendo, links) ----------
  // A native audio player keeps going when the phone is locked and shows
  // play/pause on the lock screen. YouTube songs use the WebView player instead.
  const audio = useMemo(() => createAudioPlayer(null, { updateInterval: 500 }), []);
  const audioHandler = useRef(() => {});
  const [audioTime, setAudioTime] = useState({ t: 0, d: 0 });
  const audioLoadTimer = useRef(null);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {});
    const sub = audio.addListener('playbackStatusUpdate', (st) => audioHandler.current(st));
    return () => {
      sub.remove();
      audio.remove();
    };
  }, [audio]);

  // YouTube's player stops when the phone locks, so keep the screen on during YouTube songs
  useEffect(() => {
    if (isPlaying && currentIsYouTube) activateKeepAwakeAsync('player').catch(() => {});
    else deactivateKeepAwake('player').catch(() => {});
  }, [isPlaying, currentIsYouTube]);

  // ---------- Playback ----------
  const loadSong = (song) => {
    clearTimeout(audioLoadTimer.current);
    if (isYouTube(song)) {
      audio.pause();
      try {
        audio.clearLockScreenControls();
      } catch {}
      if (playerReady.current) player.current.load(song.id);
      else pendingVideo.current = song.id;
      return;
    }
    pendingVideo.current = null;
    if (playerReady.current) player.current.pause();
    setAudioTime({ t: 0, d: song.duration || 0 });
    // A downloaded copy plays without internet
    const saved = songMap[song.id];
    const local = saved && saved.localUri && isSavedFile(saved.localUri) ? saved.localUri : null;
    audio.replace({ uri: local || streamUrlOf(song) });
    audio.play();
    try {
      audio.setActiveForLockScreen(
        true,
        { title: song.title, artist: song.artist || '', albumTitle: 'TubeTunes', artworkUrl: artworkOf(song) || undefined },
        { showSeekForward: false, showSeekBackward: false }
      );
    } catch {}
    // A stream that never loads is skipped
    audioLoadTimer.current = setTimeout(() => {
      if (!audio.isLoaded) nextRef.current && nextRef.current.skipBroken('the stream did not load');
    }, 20000);
  };

  const startQueue = (songs, start = 0, forceShuffle = shuffle) => {
    if (!songs.length) return;
    let q;
    let i;
    if (forceShuffle) {
      q = [songs[start], ...shuffled(songs.filter((_, k) => k !== start))];
      i = 0;
    } else {
      q = songs.slice();
      i = start;
    }
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
    else {
      setIsPlaying(false);
      if (!currentIsYouTube) audio.pause();
    }
  };

  const seekTo = (sec) => {
    if (!current) return;
    if (currentIsYouTube) player.current.seekTo(sec);
    else {
      audio.seekTo(sec).catch(() => {});
      setAudioTime((t) => ({ ...t, t: sec }));
    }
  };

  const currentTime = () => (currentIsYouTube ? player.current.getTime() : audioTime.t);

  const prev = () => {
    if (!queue.length) return;
    if (currentTime() > 3) {
      seekTo(0);
      return;
    }
    goTo(index > 0 ? index - 1 : queue.length - 1);
  };

  const resume = () => (currentIsYouTube ? player.current.play() : audio.play());
  const pause = () => (currentIsYouTube ? player.current.pause() : audio.pause());

  const playPause = () => {
    if (!current) {
      startQueue(viewSongs, 0);
      return;
    }
    if (isPlaying) pause();
    else resume();
  };

  const onSongEnded = () => {
    if (repeat === 'one') {
      seekTo(0);
      resume();
    } else {
      next(true);
    }
  };

  const skipBroken = (reason) => {
    showToast(`Can't play ${current ? `"${current.title}"` : 'this song'}: ${reason}. Skipping.`);
    setTimeout(() => nextRef.current && nextRef.current.next(true), 1500);
  };

  // Latest versions, for callbacks that fire later (timers, native events)
  nextRef.current = { next, skipBroken };

  audioHandler.current = (st) => {
    if (!current || currentIsYouTube) return;
    if (st.isLoaded) clearTimeout(audioLoadTimer.current);
    setIsPlaying(!!st.playing);
    setAudioTime({ t: st.currentTime || 0, d: st.duration || current.duration || 0 });
    if (st.didJustFinish) onSongEnded();
  };

  const toggleShuffle = () => {
    const on = !shuffle;
    setShuffle(on);
    // Reshuffle what's left, keeping the current song first
    if (on && current) {
      setQueue([current, ...shuffled(queue.filter((_, k) => k !== index))]);
      setIndex(0);
    }
  };

  const cycleRepeat = () => setRepeat((r) => ({ off: 'all', all: 'one', one: 'off' }[r]));

  const onPlayerReady = () => {
    playerReady.current = true;
    if (pendingVideo.current) {
      player.current.load(pendingVideo.current);
      pendingVideo.current = null;
    }
  };

  const onPlayerState = (s) => {
    if (!currentIsYouTube) return;
    if (s === 1) setIsPlaying(true);
    else if (s === 2 || s === 0 || s === 5) setIsPlaying(false);
    if (s === 0) onSongEnded();
  };

  const onPlayerError = (code) => {
    if (currentIsYouTube) skipBroken(ERROR_REASONS[code] || 'error ' + code);
  };

  // ---------- Search ----------
  const runSearch = async (q, source) => {
    const seq = ++searchSeq.current;
    setSearch((s) => ({ ...s, q, source, loading: true, error: '' }));
    // "All" means songs; radio stations only show under Radio.
    // YouTube has the original releases, so its results come first.
    const wantsYouTube = source === 'youtube' || source === 'all';
    const ytAuth = wantsYouTube ? await youtubeAuth() : null;
    const ytTask =
      wantsYouTube && (ytAuth || source === 'youtube')
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
      error: [yt, ...settled]
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason.message)
        .join(' '),
      heading: q ? `Results for “${q}”` : source === 'radio' ? 'Popular stations' : 'Trending now',
    }));
  };

  // Song names suggested while typing
  useEffect(() => {
    const term = searchText.trim();
    if (!suggestOpen || term.length < 2) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      suggestSongs(term, REGION)
        .then((items) => alive && setSuggestions(items))
        .catch(() => {});
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [searchText, suggestOpen]);

  const submitSearch = (q) => {
    setSuggestOpen(false);
    setSearchText(q);
    runSearch(q, search.source);
  };

  const openSearchTab = () => {
    setTab('search');
    setFilter('');
    if (!search.results.length && !search.loading) runSearch(search.q, search.source);
  };

  // ---------- YouTube sync ----------
  const runSync = async (interactive) => {
    let token = await getAccessToken({ interactive });
    if (interactive) setBusy('Connecting to YouTube…');
    try {
      return await syncYouTube(token, interactive ? setBusy : undefined);
    } catch (e) {
      if (e.status !== 401) throw e;
      // Token expired: get a fresh one and try once more
      await dropToken(token);
      token = await getAccessToken({ interactive });
      return await syncYouTube(token, interactive ? setBusy : undefined);
    }
  };

  const syncNow = async () => {
    try {
      const result = await runSync(true);
      setLib((l) => mergeSync(l, result));
      const songs = result.playlists.reduce((n, p) => n + p.videos.length, 0);
      showToast(`Synced ${result.playlists.length} playlists (${songs} songs) from YouTube`);
    } catch (e) {
      if (!/cancel/i.test(e.message)) Alert.alert('YouTube sync', e.message);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = () =>
    Alert.alert('Disconnect YouTube?', 'Your YouTube playlists will be removed from TubeTunes. Songs you added yourself stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          signOutGoogle();
          if (openPlaylist && openPlaylist.source === 'youtube') setOpenPlaylistId(null);
          setLib(removeSynced);
        },
      },
    ]);

  // Quietly refresh YouTube playlists each time the app starts
  const autoSynced = useRef(false);
  useEffect(() => {
    if (!loaded || autoSynced.current || !lib.account || !googleAvailable) return;
    autoSynced.current = true;
    runSync(false)
      .then((result) => setLib((l) => mergeSync(l, result)))
      .catch(() => {});
  }, [loaded, lib.account]);

  // ---------- Library changes ----------
  const addToOpenPlaylist = (playlists, songId) =>
    editable
      ? playlists.map((p) =>
          p.id === openPlaylistId && !p.songIds.includes(songId)
            ? { ...p, songIds: [...p.songIds, songId] }
            : p
        )
      : playlists;

  // Adds a full song object (YouTube, Search result or resolved link) to the library
  const addSongObject = (song) => {
    const exists = !!songMap[song.id];
    setLib((l) => ({
      ...l,
      songs: l.songs.some((s) => s.id === song.id) ? l.songs : [{ ...song, addedAt: Date.now() }, ...l.songs],
      playlists: addToOpenPlaylist(l.playlists, song.id),
    }));
    showToast(
      exists
        ? editable
          ? `"${song.title}" added to this playlist`
          : `"${song.title}" is already in your library`
        : `Added "${song.title}"`
    );
  };

  const addYouTubeSong = async (videoId) => {
    if (songMap[videoId]) return addSongObject(songMap[videoId]);
    setBusy('Adding song…');
    const info = await fetchVideoInfo(videoId);
    setBusy(null);
    if (!info) {
      Alert.alert("Couldn't add song", 'That video may be private, removed, or blocked from playing in apps.');
      return;
    }
    addSongObject({ id: videoId, source: 'youtube', ...info });
  };

  const readPlaylistIds = (listId) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve([]), 25000);
      importResolve.current = (ids) => {
        clearTimeout(timer);
        resolve(ids);
      };
      setImportListId(listId);
    });

  const importPlaylist = async (listId) => {
    setBusy('Reading playlist…');
    const ids = await readPlaylistIds(listId);
    setImportListId(null);
    importResolve.current = null;

    const unique = [...new Set(ids)];
    if (!unique.length) {
      setBusy(null);
      Alert.alert("Couldn't read playlist", 'It may be private or empty.');
      return;
    }

    const have = new Set(lib.songs.map((s) => s.id));
    const missing = unique.filter((id) => !have.has(id));
    setBusy(`Getting song details… 0/${missing.length}`);
    const infos = await fetchManyVideoInfo(missing, (done, total) =>
      setBusy(`Getting song details… ${done}/${total}`)
    );
    const name =
      (await fetchPlaylistTitle(listId)) || (listId.startsWith('RD') ? 'My Mix' : 'Imported playlist');

    const now = Date.now();
    const newSongs = missing
      .filter((id) => infos[id])
      .map((id, k) => ({ id, source: 'youtube', ...infos[id], addedAt: now - k }));
    const playlist = {
      id: `pl_${now}`,
      name,
      source: 'local',
      songIds: unique.filter((id) => have.has(id) || infos[id]),
    };

    setLib((l) => {
      const existing = new Set(l.songs.map((s) => s.id));
      return {
        ...l,
        songs: [...newSongs.filter((s) => !existing.has(s.id)), ...l.songs],
        playlists: [...l.playlists, playlist],
      };
    });
    setBusy(null);

    const skipped = unique.length - playlist.songIds.length;
    showToast(
      `Imported "${name}": ${newSongs.length} new song${newSongs.length === 1 ? '' : 's'}` +
        (skipped ? `, ${skipped} unavailable` : '')
    );
    setFilter('');
    setTab('playlists');
    setOpenPlaylistId(playlist.id);
  };

  const addFromLink = async (text) => {
    const url = text.trim();
    if (!url) return;
    const listId = extractPlaylistId(url);
    const videoId = extractVideoId(url);

    if (listId) {
      const choice = videoId
        ? await choose('This link is part of a playlist', 'What do you want to add?', [
            { text: 'Cancel', style: 'cancel', value: null },
            { text: 'Just this song', value: 'song' },
            { text: 'Whole playlist', value: 'playlist' },
          ])
        : 'playlist';
      if (choice === 'playlist') return importPlaylist(listId);
      if (choice !== 'song') return;
    }

    if (videoId) return addYouTubeSong(videoId);

    // Internet Archive album: one song, or all of them as a new playlist
    const archiveId = extractArchiveId(url);
    if (archiveId) {
      setBusy('Reading the album on the Internet Archive…');
      try {
        const { title, songs } = await archiveItemTracks(archiveId);
        if (!songs.length) {
          Alert.alert("Couldn't add songs", 'That Internet Archive page has no MP3 songs.');
          return;
        }
        if (songs.length === 1) return addSongObject(songs[0]);
        const now = Date.now();
        const playlist = { id: `pl_${now}`, name: title, source: 'local', songIds: songs.map((s) => s.id) };
        setLib((l) => {
          const have = new Set(l.songs.map((s) => s.id));
          const add = songs.filter((s) => !have.has(s.id)).map((s, k) => ({ ...s, addedAt: now - k }));
          return { ...l, songs: [...add, ...l.songs], playlists: [...l.playlists, playlist] };
        });
        showToast(`Imported "${title}": ${songs.length} songs`);
        setFilter('');
        setTab('playlists');
        setOpenPlaylistId(playlist.id);
      } catch (e) {
        Alert.alert("Couldn't add songs", e.message);
      } finally {
        setBusy(null);
      }
      return;
    }

    // Audius
    if (isAudiusLink(url)) {
      setBusy('Finding the track on Audius…');
      const song = await resolveAudius(url).catch(() => null);
      setBusy(null);
      if (song) addSongObject(song);
      else Alert.alert("Couldn't add song", 'Could not find that Audius track.');
      return;
    }

    // Jamendo
    const jamendoId = extractJamendoId(url);
    if (jamendoId) {
      setBusy('Finding the track on Jamendo…');
      try {
        const song = await jamendoTrack(jamendoId, JAMENDO_CLIENT_ID);
        if (song) addSongObject(song);
        else Alert.alert("Couldn't add song", 'Could not find that Jamendo track.');
      } catch (e) {
        Alert.alert("Couldn't add song", e.message);
      } finally {
        setBusy(null);
      }
      return;
    }

    // Direct audio file (checked when it plays)
    const song = directAudioSong(url);
    if (!song) {
      Alert.alert(
        'Link not recognized',
        'Paste a link from YouTube, Audius, Jamendo or the Internet Archive, or a direct link to an MP3 or other audio file.'
      );
      return;
    }
    addSongObject(song);
  };

  const submitLink = () => {
    const text = linkText;
    setAddOpen(false);
    setLinkText('');
    addFromLink(text);
  };

  const pasteLink = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setLinkText(text.trim());
  };

  // songs: song objects to put in the new playlist (added to the library if needed)
  const createPlaylist = (songs = [], then) =>
    setPrompt({
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
        then && then(pl);
      },
    });

  const renamePlaylist = (pl) =>
    setPrompt({
      title: 'Rename playlist',
      fields: [{ key: 'name', label: 'Name', value: pl.name }],
      onSubmit: ({ name }) =>
        setLib((l) => ({
          ...l,
          playlists: l.playlists.map((p) => (p.id === pl.id ? { ...p, name: name.trim() } : p)),
        })),
    });

  const deletePlaylist = (pl) =>
    Alert.alert('Delete playlist?', `"${pl.name}" will be deleted. The songs stay in your library.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setOpenPlaylistId(null);
          setLib((l) => ({ ...l, playlists: l.playlists.filter((p) => p.id !== pl.id) }));
        },
      },
    ]);

  // ---------- Song menu actions ----------
  const playNext = (song) => {
    if (!current) {
      startQueue([song], 0, false);
      return;
    }
    setQueue((q) => [...q.slice(0, index + 1), song, ...q.slice(index + 1)]);
    showToast(`"${song.title}" will play next`);
  };

  const editSong = (song) =>
    setPrompt({
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

  const addToPlaylist = (song, playlistId) => {
    setLib((l) => ({
      ...l,
      songs: l.songs.some((s) => s.id === song.id) ? l.songs : [{ ...song, addedAt: Date.now() }, ...l.songs],
      playlists: l.playlists.map((p) =>
        p.id === playlistId && !p.songIds.includes(song.id) ? { ...p, songIds: [...p.songIds, song.id] } : p
      ),
    }));
    const pl = lib.playlists.find((p) => p.id === playlistId);
    showToast(`Added to "${pl ? pl.name : 'playlist'}"`);
  };

  const removeFromPlaylist = (song) =>
    setLib((l) => ({
      ...l,
      playlists: l.playlists.map((p) =>
        p.id === openPlaylistId ? { ...p, songIds: p.songIds.filter((id) => id !== song.id) } : p
      ),
    }));

  // ---------- Offline downloads ----------
  const downloadSong = async (song) => {
    if (!canDownload(song)) {
      Alert.alert("Can't download", 'This song’s owner only allows streaming. Songs from Jamendo usually can be downloaded.');
      return;
    }
    if (downloading[song.id]) return;
    setDownloading((d) => ({ ...d, [song.id]: true }));
    showToast(`Downloading "${song.title}"…`);
    try {
      const uri = await saveOffline(song);
      setLib((l) => {
        const exists = l.songs.some((s) => s.id === song.id);
        const songs = exists
          ? l.songs.map((s) => (s.id === song.id ? { ...s, localUri: uri } : s))
          : [{ ...song, localUri: uri, addedAt: Date.now() }, ...l.songs];
        return { ...l, songs };
      });
      showToast(`"${song.title}" is saved for offline listening`);
    } catch (e) {
      Alert.alert('Download failed', 'Check your internet connection and try again.');
    } finally {
      setDownloading((d) => {
        const n = { ...d };
        delete n[song.id];
        return n;
      });
    }
  };

  const removeDownload = (song) => {
    const saved = songMap[song.id];
    if (!saved || !saved.localUri) return;
    removeOffline(saved.localUri);
    setLib((l) => ({ ...l, songs: l.songs.map((s) => (s.id === song.id ? { ...s, localUri: undefined } : s)) }));
    showToast('Removed the offline copy');
  };

  const deleteSong = (song) =>
    Alert.alert('Delete song?', `Remove "${song.title}" from your library and all playlists?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const saved = songMap[song.id];
          if (saved && saved.localUri) removeOffline(saved.localUri);
          setLib((l) => ({
            ...l,
            songs: l.songs.filter((s) => s.id !== song.id),
            playlists: l.playlists.map((p) => ({ ...p, songIds: p.songIds.filter((id) => id !== song.id) })),
          }));
        },
      },
    ]);

  // Android back button: collapse player, then leave the playlist
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (expanded) {
        setExpanded(false);
        return true;
      }
      if (openPlaylistId) {
        setOpenPlaylistId(null);
        setFilter('');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [expanded, openPlaylistId]);

  // ---------- Rendering ----------
  const renderSong = ({ item, index: i }) => (
    <SongRow
      song={item}
      number={i + 1}
      playing={!!current && current.id === item.id}
      onPress={() => startQueue(viewSongs, i)}
      onMore={() => setMenuSong(item)}
      downloaded={!!item.localUri}
      downloading={!!downloading[item.id]}
    />
  );

  const screen = openPlaylist ? 'songs' : tab;

  const renderResult = ({ item, index: i }) => (
    <SongRow
      song={item}
      number={i + 1}
      playing={!!current && current.id === item.id}
      onPress={() => startQueue(search.results, i)}
      onMore={() => setMenuSong(item)}
      onAdd={() => addSongObject(item)}
      inLibrary={!!songMap[item.id]}
      downloaded={!!(songMap[item.id] && songMap[item.id].localUri)}
      downloading={!!downloading[item.id]}
    />
  );

  const searchHeader = (
    <View style={styles.searchHead}>
      <Text style={styles.searchHint}>
        {search.source === 'radio'
          ? 'Live stations from around the world. Search a station name or a genre like bollywood or lofi.'
          : search.source === 'youtube'
          ? 'Original songs from YouTube. They play in YouTube’s player and can’t be downloaded.'
          : 'YouTube songs come first. Songs from the free sources keep playing when your phone is locked.'}
      </Text>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={searchText}
          onChangeText={(text) => {
            setSearchText(text);
            setSuggestOpen(true);
          }}
          onBlur={() => setSuggestOpen(false)}
          placeholder="Song, artist or mood: lofi, workout…"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          onSubmitEditing={() => submitSearch(searchText.trim())}
          clearButtonMode="while-editing"
        />
      </View>
      {suggestOpen && suggestions.length ? (
        <View style={styles.suggest}>
          {suggestions.map((it) => (
            <Pressable
              key={it.query}
              onPress={() => submitSearch(it.query)}
              style={({ pressed }) => [styles.suggestRow, pressed && styles.rowPressed]}
            >
              <Ionicons name="search" size={16} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestTitle} numberOfLines={1}>{it.title}</Text>
                <Text style={styles.suggestArtist} numberOfLines={1}>{it.artist}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {[
          ['all', 'All'],
          ['youtube', 'YouTube'],
          ['audius', 'Audius'],
          ['jamendo', 'Jamendo'],
          ['archive', 'Archive'],
          ['radio', 'Radio'],
        ].map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => runSearch(search.q, key)}
            style={[styles.tab, search.source === key && styles.tabActive]}
          >
            <Text style={[styles.tabText, search.source === key && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {search.error ? <Text style={styles.errorText}>{search.error}</Text> : null}
      {search.source === 'all' && !JAMENDO_CLIENT_ID ? (
        <Text style={styles.muted}>Jamendo results appear once a Jamendo Client ID is added.</Text>
      ) : null}
      {!search.loading && search.results.length ? <Text style={styles.resultsHead}>{search.heading}</Text> : null}
    </View>
  );

  const listHeader = (
    <View>
      {openPlaylist ? (
        <View style={styles.plHead}>
          <Text style={styles.eyebrow}>{openPlaylist.source === 'youtube' ? 'YouTube playlist' : 'Playlist'}</Text>
          <Text style={styles.h1} numberOfLines={2}>{openPlaylist.name}</Text>
          <Text style={styles.muted}>
            {openPlaylist.songIds.length} song{openPlaylist.songIds.length === 1 ? '' : 's'}
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Pressable style={styles.playAll} onPress={() => startQueue(viewSongs, 0, false)} disabled={!viewSongs.length}>
          <Ionicons name="play" size={18} color="#fff" />
          <Text style={styles.playAllText}>Play</Text>
        </Pressable>
        <Pressable
          style={styles.ghostBtn}
          disabled={!viewSongs.length}
          onPress={() => {
            setShuffle(true);
            startQueue(viewSongs, Math.floor(Math.random() * viewSongs.length), true);
          }}
        >
          <Ionicons name="shuffle" size={18} color={colors.text} />
          <Text style={styles.ghostText}>Shuffle</Text>
        </Pressable>
        {editable ? (
          <>
            <Pressable style={styles.iconBtn} onPress={() => renamePlaylist(openPlaylist)}>
              <Ionicons name="create-outline" size={20} color={colors.text} />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => deletePlaylist(openPlaylist)}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          </>
        ) : null}
      </View>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={filter}
          onChangeText={setFilter}
          placeholder="Search"
          placeholderTextColor={colors.muted}
          clearButtonMode="while-editing"
        />
      </View>
    </View>
  );

  const emptySongs = (
    <View style={styles.empty}>
      <Ionicons name="musical-notes-outline" size={48} color={colors.muted} />
      <Text style={styles.emptyTitle}>{filter ? 'No matches' : 'No songs here yet'}</Text>
      {!filter ? (
        <Text style={styles.emptyText}>
          {openPlaylist
            ? 'Tap + to paste a link into this playlist, or use a song\'s ⋮ menu → Add to playlist.'
            : 'Find songs in the Search tab, or tap + and paste a YouTube, Audius, Jamendo or MP3 link.'}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.main, { paddingTop: insets.top }]}>
        {/* Top bar */}
        <View style={styles.topbar}>
          {openPlaylist ? (
            <Pressable
              hitSlop={12}
              onPress={() => {
                setOpenPlaylistId(null);
                setFilter('');
              }}
              style={styles.back}
            >
              <Ionicons name="chevron-back" size={26} color={colors.text} />
              <Text style={styles.backText}>Playlists</Text>
            </Pressable>
          ) : (
            <View style={styles.brand}>
              <View style={styles.logo}>
                <Ionicons name="musical-notes" size={18} color="#fff" />
              </View>
              <Text style={styles.brandText}>TubeTunes</Text>
            </View>
          )}
          <Pressable style={styles.addBtn} onPress={() => setAddOpen(true)} hitSlop={8}>
            <Ionicons name="add" size={26} color="#fff" />
          </Pressable>
        </View>

        {/* Tabs */}
        {!openPlaylist ? (
          <View style={styles.tabs}>
            {[
              ['songs', `Songs · ${lib.songs.length}`],
              ['playlists', `Playlists · ${lib.playlists.length}`],
              ['search', 'Search'],
            ].map(([key, label]) => (
              <Pressable
                key={key}
                onPress={() => {
                  if (key === 'search') return openSearchTab();
                  setTab(key);
                  setFilter('');
                }}
                style={[styles.tab, tab === key && styles.tabActive]}
              >
                <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {screen === 'search' ? (
          <FlatList
            data={search.loading ? [] : search.results}
            keyExtractor={(s) => s.id}
            renderItem={renderResult}
            ListHeaderComponent={searchHeader}
            ListEmptyComponent={
              search.loading ? (
                <ActivityIndicator color={colors.accent} size="large" style={{ marginTop: 40 }} />
              ) : (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>{search.q ? 'Nothing found' : 'Search for music'}</Text>
                  <Text style={styles.emptyText}>Try another word, or a different source.</Text>
                </View>
              )
            }
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            extraData={[current && current.id, songMap]}
          />
        ) : screen === 'songs' ? (
          <FlatList
            data={viewSongs}
            keyExtractor={(s) => s.id}
            renderItem={renderSong}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={loaded ? emptySongs : null}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            extraData={current && current.id}
          />
        ) : (
          <FlatList
            data={lib.playlists}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <View>
                <View style={styles.ytCard}>
                  <View style={styles.ytHead}>
                    <Ionicons name="logo-youtube" size={26} color="#ff0000" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.plName} numberOfLines={1}>
                        {lib.account ? lib.account.name : 'Your YouTube playlists'}
                      </Text>
                      <Text style={styles.muted}>
                        {lib.account
                          ? `Synced ${lib.syncedAt ? new Date(lib.syncedAt).toLocaleString() : ''}`
                          : 'Sign in with Google to bring them here'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.ytButtons}>
                    <Pressable style={styles.playAll} onPress={syncNow}>
                      <Ionicons name={lib.account ? 'sync' : 'logo-google'} size={16} color="#fff" />
                      <Text style={styles.playAllText}>{lib.account ? 'Sync now' : 'Connect YouTube'}</Text>
                    </Pressable>
                    {lib.account ? (
                      <Pressable style={styles.ghostBtn} onPress={disconnect}>
                        <Text style={styles.ghostText}>Disconnect</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                {downloadedIds.length ? (
                  <Pressable
                    style={({ pressed }) => [styles.plRow, pressed && { backgroundColor: colors.raised }]}
                    onPress={() => {
                      setFilter('');
                      setOpenPlaylistId(DOWNLOADS);
                    }}
                  >
                    <View style={[styles.plThumb, styles.plNew, { backgroundColor: '#0e7a4f' }]}>
                      <Ionicons name="arrow-down-circle" size={28} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.plName}>Downloaded</Text>
                      <Text style={styles.muted}>
                        {downloadedIds.length} song{downloadedIds.length === 1 ? '' : 's'} · plays offline
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </Pressable>
                ) : null}
                <Pressable style={styles.plRow} onPress={() => createPlaylist()}>
                  <View style={[styles.plThumb, styles.plNew]}>
                    <Ionicons name="add" size={26} color={colors.accent} />
                  </View>
                  <Text style={styles.plName}>New playlist</Text>
                </Pressable>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.plRow, pressed && { backgroundColor: colors.raised }]}
                onPress={() => {
                  setFilter('');
                  setOpenPlaylistId(item.id);
                }}
              >
                {item.songIds[0] && songMap[item.songIds[0]] && artworkOf(songMap[item.songIds[0]]) ? (
                  <Image source={{ uri: artworkOf(songMap[item.songIds[0]]) }} style={styles.plThumb} />
                ) : (
                  <View style={[styles.plThumb, styles.plNew]}>
                    <Ionicons name="musical-notes" size={22} color={colors.muted} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.plName} numberOfLines={1}>{item.name}</Text>
                  <View style={styles.plMeta}>
                    {item.source === 'youtube' ? <Ionicons name="logo-youtube" size={13} color="#ff0000" /> : null}
                    <Text style={styles.muted}>
                      {item.songIds.length} song{item.songIds.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            )}
          />
        )}

        {toast ? (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}
      </View>

      <PlayerPanel
        ref={player}
        song={current}
        isPlaying={isPlaying}
        expanded={expanded}
        onExpand={() => setExpanded(true)}
        onCollapse={() => setExpanded(false)}
        shuffle={shuffle}
        repeat={repeat}
        onToggleShuffle={toggleShuffle}
        onCycleRepeat={cycleRepeat}
        onPlayPause={playPause}
        onNext={() => next()}
        onPrev={prev}
        onReady={onPlayerReady}
        onStateChange={onPlayerState}
        onError={onPlayerError}
        audioTime={current && !currentIsYouTube ? audioTime : null}
        onSeekAudio={seekTo}
      />

      {/* Invisible player used only to read playlist contents */}
      {importListId ? (
        <View style={styles.importEngine} pointerEvents="none">
          <YouTubeEngine
            ref={importEngine}
            onReady={() => importEngine.current && importEngine.current.readPlaylist(importListId)}
            onPlaylistIds={(ids) => importResolve.current && importResolve.current(ids)}
          />
        </View>
      ) : null}

      {/* Add link dialog */}
      <Modal transparent animationType="fade" visible={addOpen} onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAddOpen(false)} />
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>
              {editable ? `Add to "${openPlaylist.name}"` : 'Add from a link'}
            </Text>
            <Text style={styles.dialogHint}>
              Paste a YouTube song or playlist link, an Audius or Jamendo track link, an Internet Archive album, or a direct MP3 link.
            </Text>
            <View style={styles.linkRow}>
              <TextInput
                style={styles.linkInput}
                value={linkText}
                onChangeText={setLinkText}
                placeholder="https://youtu.be/…"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={submitLink}
              />
              <Pressable style={styles.pasteBtn} onPress={pasteLink}>
                <Ionicons name="clipboard-outline" size={18} color={colors.text} />
                <Text style={styles.ghostText}>Paste</Text>
              </Pressable>
            </View>
            <View style={styles.dialogButtons}>
              <Pressable style={styles.dialogBtn} onPress={() => setAddOpen(false)}>
                <Text style={styles.ghostText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.dialogBtn, styles.dialogPrimary, !linkText.trim() && { opacity: 0.5 }]}
                onPress={submitLink}
                disabled={!linkText.trim()}
              >
                <Text style={styles.playAllText}>Add</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <SongMenu
        song={menuSong}
        inLibrary={!!menuSong && !!songMap[menuSong.id]}
        playlists={lib.playlists.filter((p) => p.source !== 'youtube')}
        currentPlaylistId={screen === 'songs' && editable ? openPlaylistId : null}
        canDownload={!!menuSong && canDownload(menuSong)}
        downloaded={!!menuSong && !!songMap[menuSong.id] && !!songMap[menuSong.id].localUri}
        onDownload={downloadSong}
        onRemoveDownload={removeDownload}
        onClose={() => setMenuSong(null)}
        onPlayNext={playNext}
        onAddToLibrary={addSongObject}
        onEdit={editSong}
        onOpenSource={(s) => {
          const url = pageUrlOf(s);
          if (url) Linking.openURL(url).catch(() => {});
        }}
        onAddToPlaylist={addToPlaylist}
        onNewPlaylist={(s) => createPlaylist([s], (pl) => showToast(`Added to "${pl.name}"`))}
        onRemoveFromPlaylist={removeFromPlaylist}
        onDelete={deleteSong}
      />

      <PromptModal prompt={prompt} onClose={() => setPrompt(null)} />

      <Modal transparent visible={!!busy} animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.busyBox}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.busyText}>{busy}</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  main: { flex: 1 },

  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { color: colors.text, fontSize: 22, fontWeight: '800' },
  back: { flexDirection: 'row', alignItems: 'center', marginLeft: -6 },
  backText: { color: colors.text, fontSize: 16 },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.panel },
  tabActive: { backgroundColor: colors.text },
  tabText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: colors.bg },

  listContent: { paddingHorizontal: 4, paddingBottom: 24 },

  plHead: { paddingHorizontal: 12, paddingTop: 6 },
  eyebrow: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 4 },
  muted: { color: colors.muted, fontSize: 13, marginTop: 2 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 12 },
  playAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  playAllText: { color: '#fff', fontWeight: '700' },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.panel,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  ghostText: { color: colors.text, fontWeight: '600' },
  iconBtn: { padding: 9, borderRadius: 20, backgroundColor: colors.panel },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.panel,
  },
  searchInput: { flex: 1, color: colors.text, paddingVertical: 9, fontSize: 15 },
  suggest: { marginHorizontal: 12, marginBottom: 6, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.panel },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 12 },
  rowPressed: { backgroundColor: colors.raised },
  suggestTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  suggestArtist: { color: colors.muted, fontSize: 12, marginTop: 1 },

  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  emptyText: { color: colors.muted, textAlign: 'center', lineHeight: 20 },

  plRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  plThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.panel },
  plNew: { alignItems: 'center', justifyContent: 'center' },
  plName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  plMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },

  searchHead: { paddingTop: 4, paddingBottom: 4 },
  searchHint: { color: colors.muted, fontSize: 13, paddingHorizontal: 12, marginBottom: 2 },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, marginTop: 4, marginBottom: 8 },
  errorText: { color: colors.danger, paddingHorizontal: 12, marginBottom: 6 },
  resultsHead: { color: colors.text, fontSize: 16, fontWeight: '700', paddingHorizontal: 12, marginTop: 10, marginBottom: 4 },

  ytCard: {
    margin: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.panel,
    gap: 14,
  },
  ytHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ytButtons: { flexDirection: 'row', gap: 8 },

  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    backgroundColor: colors.text,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  toastText: { color: colors.bg, fontWeight: '500' },

  importEngine: { position: 'absolute', top: 0, left: 0, width: 200, height: 113, opacity: 0 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: colors.panel, borderRadius: 16, padding: 20 },
  dialogTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  dialogHint: { color: colors.muted, marginTop: 4, marginBottom: 14 },
  linkRow: { flexDirection: 'row', gap: 8 },
  linkInput: {
    flex: 1,
    backgroundColor: colors.bg,
    color: colors.text,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  pasteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.raised,
  },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  dialogBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  dialogPrimary: { backgroundColor: colors.accent },

  busyBox: {
    alignSelf: 'center',
    backgroundColor: colors.panel,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 28,
    alignItems: 'center',
    gap: 14,
    minWidth: 220,
  },
  busyText: { color: colors.text, fontWeight: '600', textAlign: 'center' },
});
