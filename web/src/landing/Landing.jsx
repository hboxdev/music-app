import { useEffect, useState } from 'react';

// Android download: either a full link set in VITE_APK_URL (for example a GitHub
// Release asset), or a file uploaded next to the site at downloads/tubetunes.apk
const EXTERNAL_APK_URL = import.meta.env.VITE_APK_URL || '';
const APK_URL = EXTERNAL_APK_URL || 'downloads/tubetunes.apk';
const WEB_APP_URL = 'app/';

const steps = [
  {
    n: 1,
    title: 'Download the app',
    text: 'Install TubeTunes on your Android phone, or open the web app on any computer, tablet or iPhone.',
  },
  {
    n: 2,
    title: 'Connect YouTube',
    text: 'Sign in with Google and allow TubeTunes to read your playlists. It can only read them, never change them.',
  },
  {
    n: 3,
    title: 'Your playlists appear',
    text: 'Every playlist you made on YouTube, plus your liked videos, shows up as a music library. Tap Sync any time to update.',
  },
];

const features = [
  ['⟳', 'Synced with YouTube', 'Your own playlists and liked videos, kept up to date with one tap.'],
  ['🔗', 'Paste any link', 'Add songs from YouTube, Audius, Jamendo or a direct MP3 link, or a whole YouTube playlist.'],
  ['⤮', 'Made for listening', 'Play queue, shuffle, repeat, search and your own playlists.'],
  ['📱', 'Phone, web and desktop', 'An Android app, plus a web app you can install on your computer. They all work the same way.'],
  ['🔒', 'Read-only access', 'TubeTunes never posts, deletes or changes anything on your account.'],
  ['🔍', 'Search free music', 'Full songs from Audius, Jamendo and the Internet Archive, plus live radio from around the world. They keep playing with your screen locked.'],
];

const faqs = [
  [
    'Can I download songs and listen offline?',
    'Yes, for songs whose artists allow it: songs from Audius with free downloads and your own audio links (and Jamendo songs in the Android app). They’re saved inside TubeTunes, appear under Downloaded, and play without internet. YouTube songs always stream through YouTube’s official player; saving YouTube audio breaks YouTube’s rules and often the music’s copyright.',
  ],
  [
    'Why does it ask me to sign in with Google?',
    'That is how YouTube lets an app read your playlists. TubeTunes asks for read-only access. You can remove it any time in your Google Account under Security → Third-party connections.',
  ],
  [
    'Android says the file might be harmful. Is that normal?',
    'Yes, Android shows this for every app installed from outside the Play Store. Allow your browser to “install unknown apps” when asked, then open the file again.',
  ],
  [
    'Is there an iPhone app?',
    'Not yet. Apple only allows installs from the App Store. On iPhone, open the web app in Safari and use Share → Add to Home Screen.',
  ],
  [
    'Is there a desktop app?',
    'Yes. Open the web app in Chrome or Edge and click Install app (or the install icon in the address bar). TubeTunes then opens in its own window from your Start menu, Dock or taskbar.',
  ],
  [
    'Does music keep playing when I lock my phone?',
    'Songs from Search (Audius and Jamendo) and direct audio links do, with play, pause and skip on the lock screen. YouTube songs can’t: YouTube’s player stops when the screen locks, so TubeTunes keeps the screen on while they play.',
  ],
  [
    'Where do the songs in Search come from?',
    'From Audius and Jamendo, two free services where artists share their music for streaming. You’ll find lots of independent artists there; big label releases usually aren’t available.',
  ],
  ['Is it free?', 'Yes.'],
];

function useApkAvailable() {
  // An external link can't be checked from the browser, so it is trusted as set
  const [state, setState] = useState(EXTERNAL_APK_URL ? 'yes' : 'checking');
  useEffect(() => {
    if (EXTERNAL_APK_URL) return;
    fetch(APK_URL, { method: 'HEAD' })
      .then((r) => {
        const type = r.headers.get('content-type') || '';
        setState(r.ok && !type.includes('text/html') ? 'yes' : 'no');
      })
      .catch(() => setState('no'));
  }, []);
  return state;
}

function AndroidIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.6 9.48l1.84-3.18a.38.38 0 00-.66-.38l-1.87 3.23a11.4 11.4 0 00-9.82 0L5.22 5.92a.38.38 0 00-.66.38L6.4 9.48A10.8 10.8 0 001 18h22a10.8 10.8 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z"
      />
    </svg>
  );
}

function DownloadButton({ apk, big }) {
  if (apk === 'yes') {
    return (
      <a className={`btn primary ${big ? 'big' : ''}`} href={APK_URL} download>
        <AndroidIcon /> Download for Android
      </a>
    );
  }
  return (
    <span className={`btn primary disabled ${big ? 'big' : ''}`} title="The Android app will be available here soon">
      <AndroidIcon /> {apk === 'checking' ? 'Checking…' : 'Android app coming soon'}
    </span>
  );
}

function PhoneMock() {
  const rows = [
    ['#ff4f81', '#7c3aed', 'Road trip', '42 songs'],
    ['#f59e0b', '#ef4444', 'Liked videos', '318 songs'],
    ['#10b981', '#0ea5e9', 'Late night chill', '27 songs'],
    ['#6366f1', '#ec4899', 'Workout', '35 songs'],
    ['#14b8a6', '#84cc16', 'Old favourites', '64 songs'],
  ];
  return (
    <div className="phone" aria-hidden="true">
      <div className="phone-notch" />
      <div className="phone-screen">
        <div className="mock-top">
          <span className="mock-logo">♫</span>
          <span className="mock-brand">TubeTunes</span>
        </div>
        <div className="mock-tabs">
          <span>Songs</span>
          <span className="on">Playlists</span>
        </div>
        <div className="mock-sync">
          <span className="yt" /> Synced from YouTube
        </div>
        {rows.map(([a, b, name, count]) => (
          <div className="mock-row" key={name}>
            <span className="mock-thumb" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
            <span className="mock-text">
              <b>{name}</b>
              <small>{count}</small>
            </span>
          </div>
        ))}
        <div className="mock-player">
          <span className="mock-video" />
          <span className="mock-text">
            <b>Now playing</b>
            <small>From your playlist</small>
          </span>
          <span className="mock-play">❚❚</span>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const apk = useApkAvailable();
  return (
    <>
      <header className="nav">
        <div className="wrap nav-inner">
          <a className="brand" href="./">
            <span className="logo">♫</span> TubeTunes
          </a>
          <nav className="nav-links">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#faq">FAQ</a>
          </nav>
          <a className="btn ghost small" href={WEB_APP_URL}>
            Open web app
          </a>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="wrap hero-inner">
            <div className="hero-text">
              <p className="pill">Free · Android, web &amp; desktop</p>
              <h1>Your YouTube playlists, as a music app.</h1>
              <p className="lead">
                Connect your YouTube account once. Every playlist you’ve made, plus your liked videos, turns into a
                clean music library with shuffle, repeat and a play queue.
              </p>
              <div className="cta">
                <DownloadButton apk={apk} big />
                <a className="btn ghost big" href={WEB_APP_URL}>
                  Open web app
                </a>
              </div>
              <p className="note">On iPhone? Use the web app in Safari.</p>
            </div>
            <PhoneMock />
          </div>
        </section>

        <section id="how" className="section">
          <div className="wrap">
            <h2>How it works</h2>
            <ol className="steps">
              {steps.map((s) => (
                <li key={s.n} className="step">
                  <span className="step-n">{s.n}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" className="section alt">
          <div className="wrap">
            <h2>Everything you need to listen</h2>
            <div className="features">
              {features.map(([icon, title, text]) => (
                <div className="feature" key={title}>
                  <span className="feature-icon">{icon}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="download" className="section">
          <div className="wrap">
            <div className="download-card">
              <div>
                <h2>Get TubeTunes</h2>
                <p>
                  Android: download the app and open the file to install it. Everywhere else: open the web app in
                  your browser. Sign in with the same Google account on both and you’ll see the same playlists.
                </p>
              </div>
              <div className="cta">
                <DownloadButton apk={apk} big />
                <a className="btn light big" href={WEB_APP_URL}>
                  Open web app
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="section alt">
          <div className="wrap narrow">
            <h2>Questions</h2>
            {faqs.map(([q, a]) => (
              <details key={q} className="faq">
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span>© {new Date().getFullYear()} TubeTunes</span>
          <a href="privacy/">Privacy policy</a>
          <span className="muted">Not affiliated with YouTube or Google.</span>
        </div>
      </footer>
    </>
  );
}
