#!/usr/bin/env node
const cdpBase = process.env.CDP_BASE || 'http://127.0.0.1:9222';
const pageUrl = process.argv[2] || 'http://127.0.0.1:9999/';

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function fetchJson(path) {
  const response = await fetch(`${cdpBase}${path}`);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

async function connect() {
  const targets = await fetchJson('/json/list');
  const target = targets.find(item => item.type === 'page') || targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('No Chrome DevTools page target found.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return new CdpSession(socket);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function evalValue(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result?.value;
}

async function waitFor(cdp, expression, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evalValue(cdp, expression);
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, 'document.readyState === "complete"', 'page load');
  await waitFor(cdp, 'Boolean(window.SINGULAR_WORKBENCH?.debugSendTerminalInput)', 'debug input API');
}

async function runMethod(cdp, method, offset) {
  console.error(`Testing ${method}...`);
  const url = `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}keyboard-smoke=${Date.now()}-${method}`;
  await navigate(cdp, url);
  await evalValue(cdp, 'window.SINGULAR_WORKBENCH.startSession().then(() => true)');
  await waitFor(cdp, 'document.querySelector("#engine-status").textContent === "Session running"', 'session running', 45000);
  await waitFor(cdp, 'window.SINGULAR_WORKBENCH.debugState().ptyServerState === "input"', 'worker waiting for input', 45000);

  const expected = 1000 + offset + 1;
  const script = `1+${1000 + offset};\n`;
  if (method === 'browser-insert-text' || method === 'browser-key-events') {
    await evalValue(cdp, `(() => {
      const terminal = document.querySelector("#terminal");
      const textarea = terminal?.querySelector("textarea");
      textarea?.focus();
      return document.activeElement === textarea;
    })()`);
  }
  if (method === 'browser-key-events') {
    for (const char of script) {
      if (char === '\n') {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      } else {
        await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: char, unmodifiedText: char });
      }
    }
  } else if (method === 'browser-insert-text') {
    await cdp.send('Input.insertText', { text: script });
  } else {
    await evalValue(cdp, `window.SINGULAR_WORKBENCH.debugSendTerminalInput(${JSON.stringify(method)}, ${JSON.stringify(script)})`);
  }
  await sleep(2500);
  const state = await evalValue(cdp, `(() => {
    const debug = window.SINGULAR_WORKBENCH.debugState();
    return {
      debug,
      output: document.querySelector("#output-log").textContent.slice(-1200)
    };
  })()`);
  const rows = state.debug.rows || '';
  const buffer = state.debug.buffer || '';
  return {
    method,
    expected,
    ok: `${rows}\n${buffer}`.includes(String(expected)),
    rowsTail: rows.slice(-1000),
    bufferTail: buffer.slice(-1000),
    ptyServerState: state.debug.ptyServerState,
    ptyServerInputBuffered: state.debug.ptyServerInputBuffered,
    outputTail: state.output
  };
}

const cdp = await connect();
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

await navigate(cdp, `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}keyboard-smoke=${Date.now()}-cache-reset`);
await evalValue(cdp, `
  Promise.all([
    navigator.serviceWorker?.getRegistrations?.().then(registrations => Promise.all(registrations.map(registration => registration.unregister()))) || Promise.resolve(),
    caches?.keys?.().then(keys => Promise.all(keys.map(key => caches.delete(key)))) || Promise.resolve()
  ]).then(() => true)
`);

const methods = [
  'pty-server-feed',
  'pty-master-cr',
  'xterm-paste',
  'pty-slave-write',
  'browser-insert-text',
  'browser-key-events'
];
const results = [];
for (let i = 0; i < methods.length; i += 1) {
  results.push(await runMethod(cdp, methods[i], i + 1));
}

console.log(JSON.stringify(results, null, 2));
cdp.socket.close();
