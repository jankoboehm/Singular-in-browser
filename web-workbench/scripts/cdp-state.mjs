#!/usr/bin/env node
const cdpBase = process.env.CDP_BASE || 'http://127.0.0.1:9222';

const targets = await fetch(`${cdpBase}/json/list`).then(response => response.json());
const target = targets.find(item => item.type === 'page') || targets[0];
if (!target?.webSocketDebuggerUrl) throw new Error('No Chrome DevTools page target found.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  pending.get(message.id)(message);
  pending.delete(message.id);
});

function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise(resolve => pending.set(id, resolve));
}

await send('Runtime.enable');
const expression = `(() => ({
  url: location.href,
  status: document.querySelector("#engine-status")?.textContent,
  detail: document.querySelector("#engine-detail")?.textContent,
  editor: document.querySelector("#editor")?.value,
  active: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName,
  output: document.querySelector("#output-log")?.textContent.slice(-4000),
  rows: Array.from(document.querySelectorAll("#terminal .xterm-rows > div")).map(row => row.textContent).join("\\n").slice(-2000),
  debug: window.SINGULAR_WORKBENCH?.debugState?.()
}))()`;
const result = await send('Runtime.evaluate', { expression, returnByValue: true });
console.log(JSON.stringify(result.result?.value || result, null, 2));
socket.close();
