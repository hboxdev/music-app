// Connects to an already-running Chromium remote-debugging port and verifies
// the production React bundle can open the downloader without a runtime error.
const port = process.argv[2] || '9222';
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((item) => item.type === 'page' && item.url.includes('/app/'));
if (!page) throw new Error('TubeTunes app tab was not found.');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let id = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  pending.get(message.id)(message);
  pending.delete(message.id);
};
const command = (method, params = {}) => new Promise((resolve) => {
  const requestId = ++id;
  pending.set(requestId, resolve);
  socket.send(JSON.stringify({ id: requestId, method, params }));
});

await command('Runtime.enable');
const clicked = await command('Runtime.evaluate', {
  expression: `(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.includes('Download audio'));
    if (!button) return 'missing button';
    button.click();
    return true;
  })()`,
  returnByValue: true,
});
if (clicked.result?.result?.value !== true) throw new Error(`Downloader button smoke test failed: ${clicked.result?.result?.value}`);
await new Promise((resolve) => setTimeout(resolve, 250));
const opened = await command('Runtime.evaluate', {
  expression: `document.body.innerText.includes('Paste a YouTube URL') && document.body.innerText.includes('Check link')`,
  returnByValue: true,
});

if (opened.result?.result?.value !== true) throw new Error(`Downloader smoke test failed: ${opened.result?.result?.value}`);

const cached = await command('Runtime.evaluate', {
  expression: `navigator.serviceWorker.ready.then(async () => (await caches.open('tubetunes-v8')).keys().then((keys) => keys.length))`,
  awaitPromise: true,
  returnByValue: true,
});
const cachedFiles = cached.result?.result?.value || 0;
if (cachedFiles < 2) throw new Error(`Service worker precache is incomplete (${cachedFiles} entries).`);

socket.close();
console.log(`Downloader rendered and service worker cached ${cachedFiles} shell files.`);
