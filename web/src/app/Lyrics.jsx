import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, MicVocal } from 'lucide-react';
import { activeLine, getLyrics } from '../shared/lyrics';
import { hueOf } from './ui';

// Saved lyrics stay in the browser, so they also show offline
const store = {
  get: (key) => {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

// Lyrics card for the playing song. Synced lyrics follow the song and
// clicking a line jumps there.
export default function Lyrics({ song, time, duration, onSeek, className = '' }) {
  const [state, setState] = useState({ status: 'loading', lyrics: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  const box = useRef(null);
  const userScrolledAt = useRef(0);
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', lyrics: null, error: '' });
    getLyrics(song, durationRef.current, store)
      .then((lyrics) => alive && setState({ status: lyrics ? 'ready' : 'missing', lyrics, error: '' }))
      .catch((e) => alive && setState({ status: 'error', lyrics: null, error: navigator.onLine ? e.message : 'Lyrics need internet the first time.' }));
    return () => {
      alive = false;
    };
  }, [song.id, attempt]);

  const lines = state.lyrics && state.lyrics.synced;
  const active = lines ? activeLine(lines, time) : -1;

  // Keeps the current line in the middle, unless the user just scrolled
  useEffect(() => {
    const el = box.current && box.current.children[active];
    if (!el || Date.now() - userScrolledAt.current < 3000) return;
    box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' });
  }, [active]);

  const noteScroll = () => {
    userScrolledAt.current = Date.now();
  };

  let body;
  if (state.status === 'loading') {
    body = (
      <div className="lyrics-note">
        <LoaderCircle size={26} className="spin" />
      </div>
    );
  } else if (state.status === 'error') {
    body = (
      <div className="lyrics-note">
        <span>{state.error}</span>
        <button className="pill" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  } else if (state.status === 'missing') {
    body = (
      <div className="lyrics-note">
        <MicVocal size={30} strokeWidth={1.5} />
        <span>No lyrics found for this song.</span>
      </div>
    );
  } else if (state.lyrics.instrumental) {
    body = <div className="lyrics-note">♪ Instrumental ♪</div>;
  } else if (lines) {
    body = (
      <div className="lyrics-body" ref={box} onWheel={noteScroll} onTouchMove={noteScroll}>
        {lines.map((l, i) => (
          <p
            key={i}
            className={i === active ? 'on' : i < active ? 'past' : ''}
            onClick={() => {
              userScrolledAt.current = 0;
              onSeek(l.t);
            }}
          >
            {l.text || '♪'}
          </p>
        ))}
      </div>
    );
  } else {
    body = (
      <div className="lyrics-body plain" ref={box}>
        {state.lyrics.plain}
      </div>
    );
  }

  return (
    <section className={`lyrics ${className}`} style={{ '--lyr-hue': hueOf(song.id) }}>
      <div className="lyrics-head">
        <b>Lyrics</b>
        {state.status === 'ready' && !lines && !state.lyrics.instrumental ? <small>Not synced to the song</small> : null}
      </div>
      {body}
      {state.status === 'ready' ? (
        <small className="lyrics-credit">
          Lyrics from{' '}
          <a href="https://lrclib.net" target="_blank" rel="noopener noreferrer">
            LRCLIB
          </a>
        </small>
      ) : null}
    </section>
  );
}
