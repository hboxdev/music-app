import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadLibrary, saveLibrary } from './storage';
import { getAccessToken, googleConfigured, initGoogle, signOutGoogle } from './google';
import { loadYouTubeApi, readPlaylistIds } from './player';
import {
  extractPlaylistId,
  extractVideoId,
  fetchManyVideoInfo,
  fetchPlaylistTitle,
  fetchVideoInfo,
  thumbUrl,
} from '../shared/youtube';
import { mergeSync, removeSynced, syncYouTube } from '../shared/ytsync';

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

const YouTubeIcon = () => (
  <svg width="18" height="13" viewBox="0 0 24 17" aria-hidden="true">
    <rect width="24" height="17" rx="4" fill="#ff0000" />
    <path d="M9.6 4.8v7.4l6.4-3.7z" fill="#fff" />
  </svg>
);

export default function App() {
  // Library
  const [lib, setLib] = useState(loadLibrary);
  useEffect(() => saveLibrary(lib), [lib]);

  // Navigation
  const [viewId, setViewId] = useState(null); // null = all songs, otherwise a playlist id
  const [filter, setFilter] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
  const [menu, setMenu] = useState(null); // { song, x, y }
  const [dialog, setDialog] = useState(null); // { title, fields, submitLabel, onSubmit }
  const [googleReady, setGoogleReady] = useState(false);

  const playerEl = useRef(null);
  const player = useRef(null);
  const playerReady = useRef(false);
  const pendingVideo = useRef(null);
  const handlers = useRef({});
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // ---------- Derived ----------
  const songMap = useMemo(() => Object.fromEntries(lib.songs.map((s) => [s.id, s])), [lib.songs]);
  const view = lib.playlists.find((p) => p.id === viewId) || null;
  const ytPlaylists = lib.playlists.filter((p) => p.source === 'youtube');
  const myPlaylists = lib.playlists.filter((p) => p.source !== 'youtube');

  const viewSongs = useMemo(() => {
    const list = view ? view.songIds.map((id) => songMap[id]).filter(Boolean) : lib.songs;
    const q = filter.trim().toLowerCase();
    return q ? list.filter((s) => s.title.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q)) : list;
  }, [view, songMap, lib.songs, filter]);

  const current = queue[index] || null;

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
            onStateChange: (e) => handlers.current.onState(e.data),
            onError: (e) => handlers.current.onError(e.data),
          },
        });
      })
      .catch((e) => showToast(e.message));
    initGoogle().then(setGoogleReady);
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // Progress
  useEffect(() => {
    const id = setInterval(() => {
      const p = player.current;
      if (!playerReady.current || !p.getDuration) return;
      setTime({ t: p.getCurrentTime() || 0, d: p.getDuration() || 0 });
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.title = current ? `${current.title} · TubeTunes` : 'TubeTunes Player';
  }, [current]);

  // ---------- Playback ----------
  const loadVideo = (id) => {
    setTime({ t: 0, d: 0 });
    if (playerReady.current) player.current.loadVideoById(id);
    else pendingVideo.current = id;
  };

  const startQueue = (songs, start = 0, useShuffle = shuffle) => {
    if (!songs.length) return;
    const q = useShuffle ? [songs[start], ...shuffled(songs.filter((_, k) => k !== start))] : songs.slice();
    const i = useShuffle ? 0 : start;
    setQueue(q);
    setIndex(i);
    loadVideo(q[i].id);
  };

  const goTo = (i) => {
    setIndex(i);
    loadVideo(queue[i].id);
  };

  const next = (auto = false) => {
    if (!queue.length) return;
    if (index < queue.length - 1) goTo(index + 1);
    else if (repeat === 'all' || !auto) goTo(0);
    else setIsPlaying(false);
  };

  const prev = () => {
    if (!queue.length) return;
    if (time.t > 3) {
      player.current.seekTo(0, true);
      return;
    }
    goTo(index > 0 ? index - 1 : queue.length - 1);
  };

  const playPause = () => {
    if (!current) return startQueue(viewSongs, 0);
    if (!playerReady.current) return;
    if (isPlaying) player.current.pauseVideo();
    else player.current.playVideo();
  };

  const toggleShuffle = () => {
    const on = !shuffle;
    setShuffle(on);
    if (on && current) {
      setQueue([current, ...shuffled(queue.filter((_, k) => k !== index))]);
      setIndex(0);
    }
  };

  // Latest versions for the YouTube player callbacks
  handlers.current = {
    onState: (s) => {
      if (s === 1) setIsPlaying(true);
      else if (s === 2 || s === 0 || s === 5) setIsPlaying(false);
      if (s === 0) {
        if (repeat === 'one') {
          player.current.seekTo(0, true);
          player.current.playVideo();
        } else next(true);
      }
    },
    onError: (code) => {
      showToast(`Can't play ${current ? `"${current.title}"` : 'this video'}: ${ERROR_REASONS[code] || 'error ' + code}. Skipping.`);
      setTimeout(() => handlers.current.next(true), 1500);
    },
    next,
  };

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handlers.current.playPause();
      } else if (e.shiftKey && e.key === 'ArrowRight') handlers.current.next();
      else if (e.shiftKey && e.key === 'ArrowLeft') handlers.current.prev();
      else if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  handlers.current.playPause = playPause;
  handlers.current.prev = prev;

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

  const addSong = async (videoId) => {
    if (songMap[videoId]) {
      setLib((l) => ({ ...l, playlists: addToView(l.playlists, videoId) }));
      showToast(`"${songMap[videoId].title}" is already in your library`);
      return;
    }
    setBusy('Adding song…');
    const info = await fetchVideoInfo(videoId);
    setBusy(null);
    if (!info) return showToast('Could not find that video. It may be private, removed, or blocked from embedding.');
    const song = { id: videoId, ...info, addedAt: Date.now() };
    setLib((l) => ({ ...l, songs: [song, ...l.songs], playlists: addToView(l.playlists, videoId) }));
    showToast(`Added "${info.title}"`);
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
      const newSongs = missing.filter((id) => infos[id]).map((id, k) => ({ id, ...infos[id], addedAt: now - k }));
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

  const submitLink = async (e) => {
    e.preventDefault();
    const url = link.trim();
    if (!url) return;
    const listId = extractPlaylistId(url);
    const videoId = extractVideoId(url);
    if (listId && (!videoId || confirm('This link is part of a playlist.\n\nOK = import the whole playlist\nCancel = add only this song'))) {
      setLink('');
      return importPlaylist(listId);
    }
    if (!videoId) return showToast('That does not look like a YouTube link.');
    setLink('');
    addSong(videoId);
  };

  // ---------- Playlists ----------
  const newPlaylist = (songIds = [], then) =>
    setDialog({
      title: 'New playlist',
      fields: [{ key: 'name', label: 'Name', value: '' }],
      submitLabel: 'Create',
      onSubmit: ({ name }) => {
        const pl = { id: `pl_${Date.now()}`, name: name.trim(), source: 'local', songIds };
        setLib((l) => ({ ...l, playlists: [...l.playlists, pl] }));
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

  return (
    <div className="app" onClick={() => setMenu(null)}>
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
        <a className="brand" href="../">
          <span className="logo">♫</span> TubeTunes
        </a>

        <button className={`nav-item ${!view ? 'active' : ''}`} onClick={() => openView(null)}>
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
          <p className="muted small pad">YouTube sign-in isn't set up on this site yet. Add a Google Client ID to <code>.env</code>.</p>
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
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube song or playlist link" />
            <button className="primary" disabled={!!busy}>
              Add
            </button>
          </form>
        </header>

        <section className="content">
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
            <ol className="song-list">
              {viewSongs.map((s, i) => {
                const playing = current && current.id === s.id;
                return (
                  <li key={s.id} className={`song ${playing ? 'playing' : ''}`} onClick={() => startQueue(viewSongs, i)}>
                    <span className="song-num">{playing ? '♪' : i + 1}</span>
                    <img className="thumb" loading="lazy" alt="" src={thumbUrl(s.id)} />
                    <div className="song-info">
                      <div className="song-title">{s.title}</div>
                      <div className="song-artist">{s.artist || 'Unknown artist'}</div>
                    </div>
                    <button className="icon-btn more-btn" title="More" onClick={(e) => openMenu(s, e)}>
                      ⋯
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="empty">
              <p className="empty-title">{filter ? 'No matches' : 'No songs here yet'}</p>
              {!filter ? (
                <p className="muted">
                  {lib.account || !googleConfigured
                    ? 'Paste a YouTube link in the box above. Playlist links import every song.'
                    : 'Connect YouTube in the sidebar to bring in your playlists, or paste a YouTube link above.'}
                </p>
              ) : null}
            </div>
          )}
        </section>
      </main>

      <footer className="player">
        <div className="now-playing">
          <div className="video-frame">
            <div ref={playerEl} />
          </div>
          <div className="np-text">
            <div className="np-title">{current ? current.title : 'Nothing playing'}</div>
            <div className="np-artist muted">{current ? current.artist || 'Unknown artist' : 'Pick a song to start'}</div>
          </div>
        </div>

        <div className="controls">
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
          </div>
          <div className="progress-row">
            <span className="time">{fmtTime(progress)}</span>
            <input
              type="range"
              min="0"
              max={time.d || 1}
              step="0.1"
              value={progress}
              onChange={(e) => setSeeking(+e.target.value)}
              onPointerUp={() => {
                if (seeking !== null && playerReady.current) player.current.seekTo(seeking, true);
                setSeeking(null);
              }}
              onKeyUp={() => {
                if (seeking !== null && playerReady.current) player.current.seekTo(seeking, true);
                setSeeking(null);
              }}
            />
            <span className="time">{fmtTime(time.d)}</span>
          </div>
        </div>

        <div className="volume">
          <button
            className="icon-btn"
            title={muted ? 'Unmute' : 'Mute'}
            onClick={() => {
              if (!playerReady.current) return;
              muted ? player.current.unMute() : player.current.mute();
              setMuted(!muted);
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
              if (playerReady.current) {
                player.current.setVolume(v);
                player.current.unMute();
                setMuted(false);
              }
            }}
          />
        </div>
      </footer>

      {menu ? (
        <SongMenu
          menu={menu}
          playlists={myPlaylists.filter((p) => !view || p.id !== view.id)}
          inMyPlaylist={!!view && view.source !== 'youtube'}
          onPlayNext={menuAction(playNext)}
          onEdit={menuAction(editSong)}
          onOpen={menuAction((s) => window.open(`https://www.youtube.com/watch?v=${s.id}`, '_blank', 'noopener'))}
          onAdd={(pl) => menuAction((s) => addToPlaylist(s, pl))()}
          onNew={menuAction((s) => newPlaylist([s.id], (pl) => showToast(`Added to "${pl.name}"`)))}
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

function SongMenu({ menu, playlists, inMyPlaylist, onPlayNext, onEdit, onOpen, onAdd, onNew, onRemove, onDelete }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y, visibility: 'hidden' });

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
      <button onClick={onEdit}>Edit title / artist</button>
      <button onClick={onOpen}>Open on YouTube</button>
      <hr />
      <div className="label">Add to playlist</div>
      {playlists.map((p) => (
        <button key={p.id} onClick={() => onAdd(p)}>
          {p.name}
        </button>
      ))}
      <button onClick={onNew}>＋ New playlist…</button>
      <hr />
      {inMyPlaylist ? <button onClick={onRemove}>Remove from this playlist</button> : null}
      <button className="danger" onClick={onDelete}>
        Delete from library
      </button>
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
