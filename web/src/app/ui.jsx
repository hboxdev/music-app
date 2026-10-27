// Presentational pieces of the player UI: covers, cards, track tables.
import { Check, Clock3, Disc3, Ellipsis, Heart, Play, Pause, Plus } from 'lucide-react';
import { SOURCE_LABELS, artworkOf, sourceOf } from '../shared/sources';

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// A stable colour for a playlist or page, used for header gradients
export function hueOf(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

export const YouTubeIcon = ({ size = 16 }) => (
  <svg width={size} height={(size * 17) / 24} viewBox="0 0 24 17" aria-hidden="true">
    <rect width="24" height="17" rx="4" fill="#ff0000" />
    <path d="M9.6 4.8v7.4l6.4-3.7z" fill="#fff" />
  </svg>
);

// Square artwork: a 2×2 mosaic for playlists with 4+ covers, one cover, or a coloured tile
export function Cover({ songs = [], icon: Icon = Disc3, seed = '', className = '', round = false }) {
  const arts = [...new Set(songs.map(artworkOf).filter(Boolean))].slice(0, 4);
  const style = { '--hue': hueOf(seed) };
  return (
    <div className={`cover ${round ? 'round' : ''} ${className}`} style={style}>
      {arts.length >= 4 ? (
        <div className="cover-grid">
          {arts.map((a) => (
            <img key={a} src={a} alt="" loading="lazy" />
          ))}
        </div>
      ) : arts.length ? (
        <img src={arts[0]} alt="" loading="lazy" />
      ) : (
        <span className="cover-icon">
          <Icon size="42%" strokeWidth={1.6} />
        </span>
      )}
    </div>
  );
}

export function Equalizer() {
  return (
    <span className="eq" aria-label="Playing">
      <i />
      <i />
      <i />
    </span>
  );
}

// Card with artwork and a play button that appears on hover
export function Card({ title, subtitle, cover, onOpen, onPlay, playing }) {
  return (
    <div className="card" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="card-art">
        {cover}
        <button
          className={`fab ${playing ? 'show' : ''}`}
          title={playing ? 'Pause' : 'Play'}
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
        >
          {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
      </div>
      <div className="card-title">{title}</div>
      <div className="card-sub">{subtitle}</div>
    </div>
  );
}

export function Shelf({ title, action, children }) {
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="shelf-row">{children}</div>
    </section>
  );
}

// Spotify-style track list
export function TrackTable({ songs, currentId, isPlaying, onPlay, onMore, onAdd, inLibrary }) {
  return (
    <div className="tracks" role="table">
      <div className="tracks-head" role="row">
        <span>#</span>
        <span>Title</span>
        <span className="col-source">Source</span>
        <span className="col-time" title="Duration">
          <Clock3 size={15} />
        </span>
        <span />
      </div>
      {songs.map((s, i) => {
        const active = currentId === s.id;
        const src = sourceOf(s);
        const art = artworkOf(s);
        const saved = inLibrary ? inLibrary(s.id) : true;
        return (
          <div
            key={`${s.id}-${i}`}
            role="row"
            className={`track ${active ? 'active' : ''}`}
            onClick={() => onPlay(i)}
            onDoubleClick={() => onPlay(i)}
          >
            <span className="col-num">
              {active && isPlaying ? <Equalizer /> : <span className="num">{i + 1}</span>}
              <Play className="num-play" size={15} fill="currentColor" />
            </span>
            <span className="col-title">
              {art ? <img className={`t-art ${src === 'youtube' ? 'wide' : ''}`} src={art} alt="" loading="lazy" /> : <span className="t-art blank"><Disc3 size={18} /></span>}
              <span className="t-text">
                <span className="t-name">{s.title}</span>
                <span className="t-artist">{s.artist || 'Unknown artist'}</span>
              </span>
            </span>
            <span className="col-source">
              <span className={`src src-${src}`}>{src === 'youtube' ? <YouTubeIcon size={14} /> : null}{SOURCE_LABELS[src]}</span>
            </span>
            <span className="col-time">{s.duration ? fmtTime(s.duration) : ''}</span>
            <span className="col-actions">
              {onAdd ? (
                <button
                  className={`ibtn heart ${saved ? 'on' : ''}`}
                  title={saved ? 'In your library' : 'Add to library'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!saved) onAdd(s);
                  }}
                >
                  {saved ? <Check size={17} /> : <Plus size={18} />}
                </button>
              ) : null}
              <button className="ibtn more" title="More" onClick={(e) => onMore(s, e)}>
                <Ellipsis size={18} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function HeartButton({ saved, onAdd }) {
  return (
    <button className={`ibtn heart ${saved ? 'on' : ''}`} title={saved ? 'In your library' : 'Add to library'} onClick={saved ? undefined : onAdd}>
      {saved ? <Heart size={18} fill="currentColor" /> : <Heart size={18} />}
    </button>
  );
}
