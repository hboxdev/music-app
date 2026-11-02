// Verifies that a YouTube library row exposes Find download and that clicking
// it opens the authorized-source finder with the song metadata as its query.
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
await command('Runtime.evaluate', {
  expression: `localStorage.setItem('tubetunes:library:v1', JSON.stringify({
    guest: true,
    account: null,
    syncedAt: null,
    playlists: [],
    songs: [{ id: 'finder-test', source: 'youtube', title: 'Baat Unkahi', artist: 'Kaavish', addedAt: Date.now() }]
  })); location.reload();`,
});
await new Promise((resolve) => setTimeout(resolve, 1500));
const opened = await command('Runtime.evaluate', {
  expression: `(() => {
    const allSongs = [...document.querySelectorAll('button')].find((button) => button.textContent.trim().startsWith('All songs'));
    if (!allSongs) return 'missing All songs';
    allSongs.click();
    return true;
  })()`,
  returnByValue: true,
});
if (opened.result?.result?.value !== true) throw new Error(`Finder control failed: ${opened.result?.result?.value}`);
await new Promise((resolve) => setTimeout(resolve, 300));
const clicked = await command('Runtime.evaluate', {
  expression: `(() => {
    const finder = document.querySelector('.src-find');
    if (!finder || !finder.textContent.includes('Find download')) return false;
    finder.click();
    return true;
  })()`,
  returnByValue: true,
});
if (clicked.result?.result?.value !== true) throw new Error('Find download button was not rendered.');
await new Promise((resolve) => setTimeout(resolve, 200));
const verified = await command('Runtime.evaluate', {
  expression: `document.querySelector('.search-page input[type="search"]')?.value.includes('Baat Unkahi Kaavish')`,
  returnByValue: true,
});
socket.close();
if (verified.result?.result?.value !== true) throw new Error('Finder did not open authorized-source search.');
console.log('YouTube row opened the authorized download finder.');
