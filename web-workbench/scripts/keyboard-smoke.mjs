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

function keySpec(key) {
  if (key === 'Enter') return { key, code: 'Enter', windowsVirtualKeyCode: 13 };
  if (key === 'Backspace') return { key, code: 'Backspace', windowsVirtualKeyCode: 8 };
  const upper = key.toUpperCase();
  return { key, code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0) };
}

async function keyChord(cdp, key, modifiers) {
  const spec = keySpec(key);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...spec, modifiers });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...spec, modifiers });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const cdp = await connect();
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
const testUrl = `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}keyboard-smoke=${Date.now()}`;
await cdp.send('Page.navigate', { url: testUrl });
await waitFor(cdp, 'document.readyState === "complete"', 'page load');
await evalValue(cdp, `
  Promise.all([
    navigator.serviceWorker?.getRegistrations?.().then(registrations => Promise.all(registrations.map(registration => registration.unregister()))) || Promise.resolve(),
    caches?.keys?.().then(keys => Promise.all(keys.map(key => caches.delete(key)))) || Promise.resolve()
  ]).then(() => true)
`);
await cdp.send('Page.navigate', { url: testUrl.replace(/keyboard-smoke=\\d+/, `keyboard-smoke=${Date.now()}`) });
await waitFor(cdp, 'document.readyState === "complete"', 'page reload after cache reset');
await waitFor(cdp, 'Boolean(window.SINGULAR_WORKBENCH?.shortcuts)', 'workbench startup');

const platform = await evalValue(cdp, 'navigator.userAgentData?.platform || navigator.platform || ""');
const isApple = /mac|iphone|ipad|ipod/i.test(platform);
const primaryModifier = isApple ? 4 : 2;
const altModifier = 1;
const shiftModifier = 8;
const sessionPath = `/workspace/session-generated-${Date.now()}.txt`;
const labels = await evalValue(cdp, `Object.fromEntries(
  Array.from(document.querySelectorAll('button[id]')).map(button => [
    button.id,
    button.querySelector('.shortcut')?.textContent || ''
  ])
)`);
const layout = await evalValue(cdp, `(() => {
  const measure = id => {
    const button = document.getElementById(id);
    const label = button?.querySelector('.button-label');
    const shortcut = button?.querySelector('.shortcut');
    const buttonRect = button?.getBoundingClientRect();
    const labelRect = label?.getBoundingClientRect();
    const shortcutRect = shortcut?.getBoundingClientRect();
    return {
      label: label?.textContent || '',
      shortcut: shortcut?.textContent || '',
      labelVisible: Boolean(labelRect && labelRect.width > 8 && labelRect.height > 8),
      shortcutFits: Boolean(buttonRect && shortcutRect && shortcutRect.width < buttonRect.width),
      title: button?.title || ''
    };
  };
  return {
    newFile: measure('new-file'),
    download: measure('download-file'),
    deleteFile: measure('delete-file'),
    sendPrimary: document.getElementById('send-editor')?.classList.contains('primary') || false,
    savePrimary: document.getElementById('save-editor')?.classList.contains('primary') || false
  };
})()`);

assert(labels['save-editor'] === `${isApple ? '⌘' : 'Ctrl'}+S`, 'Save shortcut label does not match platform.');
assert(labels['send-editor'] === `${isApple ? '⌘' : 'Ctrl'}+Enter`, 'Send shortcut label does not match platform.');
assert(labels['run-batch'] === `${isApple ? '⌘' : 'Ctrl'}+Shift+Enter`, 'Run shortcut label does not match platform.');
assert(labels['start-session'] === `${isApple ? '⌘+Option' : 'Ctrl+Alt'}+S`, 'Start shortcut label does not match platform.');
assert(labels['terminate-session'] === `${isApple ? '⌘+Option' : 'Ctrl+Alt'}+X`, 'Terminate shortcut label does not match platform.');
assert(layout.newFile.label === 'New' && layout.newFile.labelVisible, 'New button label is not visible.');
assert(layout.download.label === 'Download' && layout.download.labelVisible, 'Download button label is not visible.');
assert(layout.deleteFile.label === 'Delete' && layout.deleteFile.labelVisible, 'Delete button label is not visible.');
assert(layout.newFile.shortcutFits && layout.download.shortcutFits && layout.deleteFile.shortcutFits, 'Compact workspace shortcuts do not fit.');
assert(layout.newFile.title.includes(isApple ? '⌘+Option+N' : 'Ctrl+Alt+N'), 'Compact shortcut lost the full title label.');
assert(layout.sendPrimary && !layout.savePrimary, 'Send should be the primary editor action.');

await keyChord(cdp, 'n', primaryModifier | altModifier);
await waitFor(
  cdp,
  'document.querySelector("#path-input").value.startsWith("/workspace/untitled-") && document.querySelector("#editor").value === ""',
  'new file shortcut'
);
await evalValue(cdp, `
  document.querySelector('#path-input').value = '/workspace/shortcut-test.sing';
  document.querySelector('#path-input').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#editor').value = 'ring r = 0,(x,y),dp;\\nideal I = x2-y3, x3-y5;\\nstd(I);\\n';
  document.querySelector('#editor').focus();
  true;
`);

await keyChord(cdp, 's', primaryModifier);
await waitFor(cdp, 'document.querySelector("#output-log").textContent.includes("Saved /workspace/shortcut-test.sing.")', 'save shortcut');

await keyChord(cdp, 's', primaryModifier | altModifier);
await waitFor(cdp, 'document.querySelector("#engine-status").textContent === "Session running"', 'start shortcut', 45000);
await waitFor(cdp, 'Boolean(window.SINGULAR_WORKBENCH?.debugState?.().terminalInputMethod)', 'terminal input bridge', 45000);
await waitFor(cdp, 'window.SINGULAR_WORKBENCH?.debugState?.().ptyServerState === "input"', 'terminal input readiness', 45000);
await waitFor(
  cdp,
  '(() => { const debug = window.SINGULAR_WORKBENCH.debugState(); return `${debug.rows}\\n${debug.buffer}`.includes(">"); })()',
  'terminal prompt',
  45000
);

await evalValue(cdp, `
  document.querySelector('#editor').value = '1+4321;\\n';
  document.querySelector('#editor').focus();
  true;
`);
await keyChord(cdp, 'Enter', primaryModifier);
await waitFor(cdp, 'document.querySelector("#output-log").textContent.includes("Sent editor contents to the terminal via")', 'send shortcut log');
await waitFor(
  cdp,
  `(() => {
    const debug = window.SINGULAR_WORKBENCH.debugState();
    const terminalText = \`\${debug.rows}\\n\${debug.buffer}\`;
    const output = document.querySelector("#output-log").textContent;
    return terminalText.includes("4322") && !output.includes("Batch run started");
  })()`,
  'terminal send received editor input directly',
  45000
);

await evalValue(cdp, `
  document.querySelector('#editor').value = ${JSON.stringify(`write(":w ${sessionPath}", "created in session");\n`)};
  document.querySelector('#editor').focus();
  true;
`);
await keyChord(cdp, 'Enter', primaryModifier);
await waitFor(
  cdp,
  `window.SINGULAR_WORKBENCH.listVisibleFiles().then(files =>
    files.some(file => file.path === ${JSON.stringify(sessionPath)} && file.sessionOnly)
  )`,
  'session-only file discovery',
  15000
);
await waitFor(
  cdp,
  `Array.from(document.querySelectorAll('#file-list button')).some(button =>
    button.textContent.includes(${JSON.stringify(sessionPath)}) &&
    button.textContent.includes('live')
  )`,
  'session-only file badge',
  15000
);
await evalValue(cdp, `
  (() => {
    const button = Array.from(document.querySelectorAll('#file-list button'))
      .find(item => item.textContent.includes(${JSON.stringify(sessionPath)}));
    button.click();
    return true;
  })()
`);
await waitFor(cdp, 'document.querySelector("#editor").value.includes("created in session")', 'open session-only file');
await waitFor(
  cdp,
  `window.SINGULAR_WORKBENCH.listFiles().then(files =>
    files.some(file => file.path === ${JSON.stringify(sessionPath)})
  )`,
  'session-only file imported into workspace',
  15000
);

await evalValue(cdp, `
  document.querySelector('#editor').value = ${JSON.stringify(`write(":w ${sessionPath}", "changed inside the live session");\n`)};
  document.querySelector('#editor').focus();
  true;
`);
await keyChord(cdp, 'Enter', primaryModifier);
await waitFor(
  cdp,
  `window.SINGULAR_WORKBENCH.listVisibleFiles().then(files =>
    files.some(file => file.path === ${JSON.stringify(sessionPath)} && file.sessionModified)
  )`,
  'session-modified file discovery',
  15000
);
await evalValue(cdp, `
  (() => {
    const button = Array.from(document.querySelectorAll('#file-list button'))
      .find(item => item.textContent.includes(${JSON.stringify(sessionPath)}));
    button.click();
    return true;
  })()
`);
await waitFor(cdp, 'document.querySelector("#editor").value.includes("changed inside the live session")', 'open modified session file');

await evalValue(cdp, `
  document.querySelector('#path-input').value = '/workspace/shortcut-test.sing';
  document.querySelector('#path-input').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#editor').value = 'ring r = 0,(x,y),dp;\\nideal I = x2-y3, x3-y5;\\nstd(I);\\n';
  document.querySelector('#editor').focus();
  true;
`);
await keyChord(cdp, 'Enter', primaryModifier | shiftModifier);
await waitFor(
  cdp,
  `(() => {
    const output = document.querySelector("#output-log").textContent;
    return output.includes("Batch finished with exit 0") &&
      /Batch finished with exit 0 in \\d+ ms\\./.test(output) &&
      !/Batch finished with exit 0 in \\d+(?:\\.\\d+)? sec\\./.test(output);
  })()`,
  'run script shortcut with millisecond runtime',
  45000
);

await keyChord(cdp, 'x', primaryModifier | altModifier);
await waitFor(cdp, 'document.querySelector("#engine-status").textContent === "Not started"', 'terminate shortcut');

console.log(JSON.stringify({
  ok: true,
  platform,
  labels: {
    save: labels['save-editor'],
    send: labels['send-editor'],
    run: labels['run-batch'],
    newFile: layout.newFile.shortcut
  }
}, null, 2));
cdp.socket.close();
