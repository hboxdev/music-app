# music-app (TubeTunes)

TubeTunes turns a person's YouTube playlists into a music app. It has three parts:

| Folder | What it is |
|---|---|
| `web/` | React (Vite) website: landing page with the download button (`/`), the web app (`/app/`) and the privacy policy (`/privacy/`) |
| `mobile/` | Expo (React Native) app for Android, and iOS later |
| `web/src/shared/` | YouTube link and sync code shared by both (copied into `mobile/src/`) |

## How it works

1. A user opens the website and taps **Download for Android** (or **Open web app** on any other device).
2. In the app they tap **Connect YouTube** and sign in with Google. TubeTunes asks for **read-only** access (`youtube.readonly`).
3. TubeTunes reads their playlists and liked videos through the YouTube Data API and shows them as a music library. **Sync** refreshes them, and the phone app also refreshes quietly when it starts.
4. Songs play through YouTube's official embedded player. Nothing is downloaded as MP3.

### Music sources

| Source | How songs get in | Plays with the screen locked? |
|---|---|---|
| YouTube | Sync, or paste a song/playlist link | No (YouTube's player stops). TubeTunes keeps the screen on instead |
| Audius | **Search** tab, or paste an `audius.co` link | Yes, with lock-screen controls |
| Jamendo | **Search** tab, or paste a `jamendo.com/track/…` link | Yes, with lock-screen controls |
| Internet Archive | **Search** tab, or paste an `archive.org/details/…` album link (imports every song as a playlist) | Yes, with lock-screen controls. Songs can be downloaded |
| Live radio ([radio-browser.info](https://www.radio-browser.info)) | **Search** tab → Live radio (station name or genre) | Yes. Live, so no downloads or seeking |
| Direct audio link | Paste a link to an `.mp3` (or other audio) file you have the right to play | Yes |

Audius, the Internet Archive and live radio need no key. Jamendo needs a free Client ID: sign up at <https://devportal.jamendo.com>, create an app, and put its Client ID in:

- `web/.env` (and Vercel) → `VITE_JAMENDO_CLIENT_ID=...`
- `mobile/src/config.js` → `JAMENDO_CLIENT_ID`

Until then, Search shows Audius only.

There is no backend. Each device keeps its library locally and talks to Google directly. Signing in with the same Google account on the phone and the web shows the same playlists.

Users can also paste any YouTube song, playlist or Mix link without signing in.

---

## 1. Google Cloud setup (one time)

Sign-in needs a free Google Cloud project. Do this in your own Google account at <https://console.cloud.google.com>.

1. **Create a project**, for example "TubeTunes".
2. **Enable the API**: APIs & Services → Library → **YouTube Data API v3** → Enable.
3. **OAuth consent screen** (APIs & Services → OAuth consent screen / Google Auth Platform):
   - User type: **External**
   - App name: TubeTunes, plus a support email
   - App domain: homepage `https://YOUR-DOMAIN/`, privacy policy `https://YOUR-DOMAIN/privacy/`
   - Authorized domain: `YOUR-DOMAIN`
   - Data access / scopes: add `https://www.googleapis.com/auth/youtube.readonly`
   - **Test users**: add the Google accounts that may sign in while the app is in testing (up to 100).
4. **Web client** (Credentials → Create credentials → OAuth client ID → *Web application*):
   - Authorized JavaScript origins: `https://YOUR-DOMAIN` and `http://localhost`
   - Copy the **Client ID**, then paste it into:
     - `web/.env` → `VITE_GOOGLE_CLIENT_ID=...` (copy `web/.env.example` to `web/.env` first)
     - `mobile/src/config.js` → `GOOGLE_WEB_CLIENT_ID`
5. **Android client** (Create credentials → OAuth client ID → *Android*):
   - Package name: `digital.hbox.tubetunes`
   - SHA-1: run `eas credentials` in `mobile/` → Android → preview, and copy the **SHA-1 fingerprint** of the keystore EAS created. Do this after your first EAS build, which creates the keystore.

To let anyone sign in (not just test users), click **Publish app** on the consent screen and submit it for Google's verification. Google reviews apps that use YouTube scopes, which can take a few weeks.

## 2. Website

```bash
cd web
npm install
npm run dev        # local preview at http://localhost:5173
npm run build      # production files go to web/dist/
```

### Deploy on Vercel (recommended)

1. Sign in at <https://vercel.com> with GitHub and click **Add New → Project**.
2. Import the `hboxdev/music-app` repository.
3. Set **Root Directory** to `web`. Vercel reads the rest from `web/vercel.json` (Vite, `npm run build`, output `dist`).
4. Under **Environment Variables** add:
   - `VITE_GOOGLE_CLIENT_ID` — your Google Web Client ID
   - `VITE_APK_URL` — `https://github.com/hboxdev/music-app/releases/latest/download/tubetunes.apk` (see the Android section)
5. Click **Deploy**. Every push to `main` redeploys automatically.
6. To use your own domain: Project → Settings → **Domains** → add it, then create the DNS record Vercel shows.
7. Add the Vercel address (for example `https://music-app.vercel.app`) and your domain to the Google **Web client**'s Authorized JavaScript origins. Add the domain to the consent screen's authorized domains too.

Changing an environment variable needs a redeploy (Deployments → ⋯ → Redeploy).

### Or upload to any hosting

Upload **everything inside `web/dist/`** to your domain's web root (`public_html`). The site works from the root or any sub-folder.

## 3. Android app

Test without sign-in in **Expo Go**:

```bash
cd mobile
npm install
npx expo start
```

Google sign-in does not work in Expo Go, because it needs native code. Build the real app with EAS:

```bash
npm install --global eas-cli
eas login
cd mobile
eas build --platform android --profile preview
```

When the build finishes, download the `.apk` and rename it to `tubetunes.apk`. Then either:

- **GitHub Release (best with Vercel):** on GitHub open the repo → **Releases → Draft a new release**, create a tag such as `v1.0.0`, attach `tubetunes.apk` and publish. The link `https://github.com/hboxdev/music-app/releases/latest/download/tubetunes.apk` always points to the newest release, so set it once as `VITE_APK_URL`. The repo must be **public** for visitors to download from it.
- **Own hosting:** upload it next to the website at `/downloads/tubetunes.apk`. The download button finds it automatically.

After the first build, add its SHA-1 to the Android OAuth client (step 1.5). Sign-in fails until you do.

## 4. iPhone (later)

Apple only allows installs from the App Store or TestFlight, which needs an Apple Developer account ($99/year). Until then, iPhone users can use the web app in Safari. To build for iOS later:

- create an *iOS* OAuth client with bundle ID `digital.hbox.tubetunes`
- put its reversed client ID in `mobile/app.json` (`iosUrlScheme`)
- run `eas build --platform ios`

## Limits

- Music stops when the phone is locked or the app is in the background (a YouTube player rule).
- Some uploaders block their videos from playing outside YouTube. TubeTunes skips them.
- The YouTube Data API allows 10,000 quota units per day per project. A sync costs about 1 unit per 50 songs.
