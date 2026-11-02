# TubeTunes download helper (personal use)

A small server that runs on your own PC and downloads the audio of YouTube
songs for TubeTunes, using [yt-dlp](https://github.com/yt-dlp/yt-dlp). The
songs then appear under **Downloaded** and play without internet, also with the
phone locked.

It is for your own use. Downloading from YouTube is against YouTube's terms, and
most music is copyrighted, so don't share the helper's address or password, and
don't turn it on in the public version of the app. It never uses the app's
Google sign-in or API key.

## 1. Start it

Needs [Node.js](https://nodejs.org) 20 or newer.

Double-click **`start-helper.cmd`** (or run `node server.mjs` in this folder).
The first start:

- downloads `yt-dlp.exe` into `bin/`
- creates `config.json` with a random **password**

The window shows the address (`http://localhost:7777`) and the password. Keep
the window open while you download.

To start it automatically, double-click **`add-to-startup.cmd`** once. It then
starts minimized every time you log in to Windows. To undo, delete
`TubeTunes helper.cmd` from the Startup folder (Win + R → `shell:startup`).

## 2. Connect the web app (on this PC)

Open the web app with `#helper` at the end, for example
`https://your-site.vercel.app/app/#helper`. Enter:

- Address: `http://localhost:7777`
- Password: the one from the helper window

YouTube songs now have a Download button. Only this browser sees it.

## 3. Connect your phone (Tailscale)

Your phone can't use `localhost`, and the web app needs an `https` address.
[Tailscale](https://tailscale.com) (free) gives your PC a private `https`
address that only your own devices can open, at home or outside.

1. Install Tailscale on the PC and on the phone, and sign in with the same account.
2. In the Tailscale admin console → **DNS**, turn on **MagicDNS** and **HTTPS Certificates**.
3. On the PC, in a terminal: `tailscale serve --bg 7777`
   It prints an address like `https://my-pc.tail1234.ts.net`.
4. Connect the app with that address and the same password:
   - **Android app:** long-press **TubeTunes** at the top → Download helper.
   - **Web app on the phone:** open `…/app/#helper`.

The PC must be on (and the helper running) while you download. Songs you have
downloaded play without the PC.

## When downloads fail

- The helper updates yt-dlp when it starts and once a day. If YouTube changed
  something, restarting the helper usually fixes it.
- "Prove it isn't a bot": YouTube is limiting your connection. Wait a while.
- Age-restricted, private and members-only videos can't be downloaded.

## Settings

`config.json` (created on first start):

| Key | Default | Meaning |
|---|---|---|
| `port` | `7777` | Port the helper listens on |
| `host` | `127.0.0.1` | Only this PC can connect (Tailscale serve forwards to it). Don't change this unless you know why |
| `password` | random | Delete `config.json` and restart for a new one, then reconnect the app |

Downloaded files are kept in `cache/` for a day, so a retry is instant; the app
keeps its own copy.
