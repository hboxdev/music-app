// TubeTunes download helper. Runs on your own PC and saves the audio of
// YouTube songs for the TubeTunes app, using yt-dlp. For personal use only.
//
//   node server.mjs        (or double-click start-helper.cmd)
//
// The first start creates config.json with a random password and downloads
// yt-dlp into bin/. See README.md for connecting the app and your phone.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const WINDOWS = process.platform === 'win32';
const YTDLP = path.join(DIR, 'bin', WINDOWS ? 'yt-dlp.exe' : 'yt-dlp');
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${WINDOWS ? 'yt-dlp.exe' : 'yt-dlp'}`;
const CACHE = path.join(DIR, 'cache');
const CONFIG = path.join(DIR, 'config.json');
const KEEP_FILES_FOR = 24 * 3600 * 1000; // the app keeps its own copy
const MAX_JOBS = 2; // yt-dlp runs at the same time
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TYPES = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg', mp3: 'audio/mpeg' };

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

function loadConfig() {
  if (existsSync(CONFIG)) return { port: 7777, host: '127.0.0.1', ...JSON.parse(readFileSync(CONFIG, 'utf8')) };
  const config = { port: 7777, host: '127.0.0.1', password: randomBytes(12).toString('base64url') };
  writeFileSync(CONFIG, JSON.stringify(config, null, 2));
  return config;
}
const config = loadConfig();
mkdirSync(CACHE, { recursive: true });

// ---------- yt-dlp ----------

async function installYtDlp() {
  if (existsSync(YTDLP)) return;
  log('Downloading yt-dlp…');
  mkdirSync(path.dirname(YTDLP), { recursive: true });
  const res = await fetch(YTDLP_URL);
  if (!res.ok) throw new Error(`Couldn’t download yt-dlp (${res.status})`);
  writeFileSync(YTDLP, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
}

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(YTDLP, args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => resolve({ code: -1, out, err: e.message }));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

// YouTube changes often; a fresh yt-dlp fixes most failed downloads
async function updateYtDlp() {
  const { out, err } = await run(['-U']);
  log('yt-dlp update:', (out || err).trim().split('\n').pop());
}

function friendlyError(stderr) {
  const s = stderr || '';
  if (/private video/i.test(s)) return 'This video is private.';
  if (/confirm your age|age-restricted/i.test(s)) return 'YouTube only plays this video to signed-in adults, so it can’t be downloaded.';
  if (/not a bot|429|too many requests/i.test(s)) return 'YouTube is asking the helper to prove it isn’t a bot. Try again later.';
  if (/unavailable|removed|copyright/i.test(s)) return 'This video isn’t available on YouTube.';
  if (/members-only|join this channel/i.test(s)) return 'This video is for channel members only.';
  return 'yt-dlp couldn’t download this song. Restart the helper to update it, then try again.';
}

const cachedFile = (id) => {
  const name = readdirSync(CACHE).find((f) => f.startsWith(`${id}.`) && !/\.(part|ytdl|temp)$/.test(f));
  return name ? path.join(CACHE, name) : null;
};

let running = 0;
const waiting = [];
const jobs = new Map();

async function slot() {
  if (running < MAX_JOBS) {
    running++;
    return;
  }
  await new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

// Downloads the best audio-only stream (m4a when YouTube has one, so no converting is needed)
function audioFile(id) {
  const ready = cachedFile(id);
  if (ready) return Promise.resolve(ready);
  if (!jobs.has(id)) {
    const job = (async () => {
      await slot();
      try {
        log('Downloading', id);
        const { code, err } = await run([
          '--js-runtimes', 'node',
          '-f', 'bestaudio[ext=m4a]/bestaudio',
          '--no-playlist', '--no-progress', '--quiet', '--no-warnings',
          '-o', path.join(CACHE, '%(id)s.%(ext)s'),
          '--', `https://www.youtube.com/watch?v=${id}`,
        ]);
        const file = cachedFile(id);
        if (code !== 0 || !file) {
          log('Failed', id, err.trim().split('\n').pop());
          throw new Error(friendlyError(err));
        }
        log('Ready', id, `${(statSync(file).size / 1e6).toFixed(1)} MB`);
        return file;
      } finally {
        release();
        jobs.delete(id);
      }
    })();
    jobs.set(id, job);
  }
  return jobs.get(id);
}

function cleanCache() {
  for (const f of readdirSync(CACHE)) {
    const file = path.join(CACHE, f);
    try {
      if (Date.now() - statSync(file).mtimeMs > KEEP_FILES_FOR) unlinkSync(file);
    } catch {}
  }
}

// ---------- Server ----------

function allowed(req) {
  const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const wanted = Buffer.from(config.password);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

function cors(res) {
  // The app runs on another address (your website), so the browser asks first
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method !== 'GET') return json(res, 405, { error: 'Only GET is supported.' });
  if (!allowed(req)) return json(res, 401, { error: 'Wrong password.' });

  const url = new URL(req.url, 'http://helper');
  if (url.pathname === '/health') {
    const { out } = await run(['--version']);
    return json(res, 200, { ok: true, app: 'tubetunes-helper', ytdlp: out.trim() });
  }

  const m = url.pathname.match(/^\/audio\/([^/]+)$/);
  if (!m || !VIDEO_ID.test(m[1])) return json(res, 404, { error: 'Not found.' });
  try {
    const file = await audioFile(m[1]);
    const ext = path.extname(file).slice(1);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': statSync(file).size,
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 502, { error: e.message });
  }
});

await installYtDlp();
cleanCache();
setInterval(cleanCache, 3600 * 1000);
setTimeout(updateYtDlp, 5000);
setInterval(updateYtDlp, 24 * 3600 * 1000);

server.listen(config.port, config.host, () => {
  console.log(`
TubeTunes download helper is running.

  Address:   http://localhost:${config.port}
  Password:  ${config.password}

In TubeTunes on this PC, open the web app with #helper at the end
(for example https://your-site/app/#helper) and enter these two.
For your phone, see README.md in this folder (Tailscale).
Keep this window open while you download songs.
`);
});
