// Connects to an already-running Chromium debugging port and verifies that the
// unified official-source search UI is present and usable without sign-in.
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
const opened = await command('Runtime.evaluate', {
  expression: `(() => {
    const buttons = [...document.querySelectorAll('button')];
    const search = buttons.find((button) => button.textContent.trim() === 'Search');
    if (!search) return false;
    search.click();
    return true;
  })()`,
  returnByValue: true,
});
if (opened.result?.result?.value !== true) throw new Error('Search navigation was not found.');
await new Promise((resolve) => setTimeout(resolve, 500));
const verified = await command('Runtime.evaluate', {
  expression: `(() => {
    const text = document.body.innerText;
    const input = document.querySelector('input[placeholder="Search YouTube and free music sources"]');
    return !!input
      && text.includes('All sources')
      && text.includes('YouTube')
      && text.includes('Audius')
      && text.includes('Jamendo')
      && text.includes('Internet Archive')
      && text.includes('Add official YouTube results');
  })()`,
  returnByValue: true,
});
socket.close();
if (verified.result?.result?.value !== true) throw new Error('Unified search sources or YouTube connection prompt are missing.');
console.log('Unified search rendered YouTube and authorized downloadable sources.');
