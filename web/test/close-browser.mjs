const port = process.argv[2] || '9222';
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
await new Promise((resolve) => setTimeout(resolve, 500));
