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

When the build finishes, download the `.apk`, rename it to `tubetunes.apk` and upload it to your site at **`/downloads/tubetunes.apk`**. The website's download button checks for that file and turns on automatically.

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
