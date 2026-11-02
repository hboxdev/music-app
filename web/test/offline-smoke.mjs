// Simulates a disconnected network, reloads a service-worker-controlled tab,
// and verifies that the complete React interface hydrates from its app shell.
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
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
const command = (method, params = {}) => new Promise((resolve) => {
  const requestId = ++id;
  pending.set(requestId, resolve);
  socket.send(JSON.stringify({ id: requestId, method, params }));
});

await command('Page.enable');
await command('Runtime.enable');
await command('Network.enable');
await command('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
});
await command('Page.reload');
await new Promise((resolve) => setTimeout(resolve, 2500));
const result = await command('Runtime.evaluate', {
  expression: `(async () => ({
    controlled: !!navigator.serviceWorker.controller,
    rendered: document.getElementById('root')?.innerHTML.length > 1000
      && document.body.innerText.includes('TubeTunes')
      && document.body.innerText.includes('Downloaded'),
    cache: await caches.keys(),
  }))()`,
  awaitPromise: true,
  returnByValue: true,
});
const value = result.result?.result?.value;
await command('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
socket.close();
if (!value?.controlled || !value?.rendered) throw new Error(`Offline shell failed: ${JSON.stringify(value)}`);
console.log('Offline service-worker reload rendered the complete application.');
