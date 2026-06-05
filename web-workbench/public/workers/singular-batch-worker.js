/* global importScripts, FS */
(() => {
  'use strict';

  const ENGINE_JS = '../engine/Singular.js';
  let started = false;
  let finished = false;
  let metrics = { createdAt: performance.now() };

  function post(type, payload = {}) {
    self.postMessage({ type, ...payload });
  }

  function normalizePath(path) {
    const raw = String(path || '').trim().replace(/\\+/g, '/');
    const prefixed = raw.startsWith('/') ? raw : `/workspace/${raw}`;
    const parts = [];
    for (const part of prefixed.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { parts.pop(); continue; }
      parts.push(part);
    }
    let normalized = `/${parts.join('/')}`;
    if (!normalized.startsWith('/workspace/')) {
      normalized = `/workspace/${normalized.replace(/^\/+/, '')}`;
    }
    return normalized;
  }

  function getFS() {
    return self.Module?.FS || self.FS || (typeof FS !== 'undefined' ? FS : null);
  }

  function mkdirp(path) {
    const fs = getFS();
    if (!fs) throw new Error('Emscripten FS is not available.');
    const clean = path.startsWith('/') ? path : `/${path}`;
    const parts = clean.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += `/${part}`;
      try { if (!fs.analyzePath(current).exists) fs.mkdir(current); } catch (_) { /* noop */ }
    }
  }

  function writeFile(path, data) {
    const fs = getFS();
    const normalized = normalizePath(path);
    mkdirp(normalized.split('/').slice(0, -1).join('/') || '/workspace');
    fs.writeFile(normalized, data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data || []), { canOwn: false });
  }

  function locateFile(path, prefix) {
    if (path.endsWith('.wasm') || path.endsWith('.data') || path.startsWith('Singular.')) {
      return new URL(`../engine/${path}`, self.location.href).toString();
    }
    return `${prefix || ''}${path}`;
  }

  function finish(exitCode = 0, detail = '') {
    if (finished) return;
    finished = true;
    metrics.finishedAt = performance.now();
    metrics.totalMs = Math.round(metrics.finishedAt - metrics.createdAt);
    post('metrics', { metrics });
    post('done', { exitCode, detail });
    setTimeout(() => self.close(), 0);
  }

  function run(message) {
    if (started) return;
    started = true;
    const scriptPath = normalizePath(message.scriptPath || '/workspace/input.sing');
    const args = Array.isArray(message.args) ? message.args.map(String) : ['-q', '--no-rc', '--no-tty'];
    const finalArgs = [...args, scriptPath];
    post('phase', { name: `Loading Singular engine for ${scriptPath}` });

    self.Module = {
      arguments: finalArgs,
      noInitialRun: false,
      noExitRuntime: false,
      locateFile,
      print: text => post('stdout', { text: `${text}\n` }),
      printErr: text => post('stderr', { text: `${text}\n` }),
      preRun: [() => {
        metrics.preRunAt = performance.now();
        const fs = getFS();
        if (!fs) throw new Error('Emscripten FS is not available in preRun. Rebuild with -s FORCE_FILESYSTEM=1.');
        try { if (!fs.analyzePath('/workspace').exists) fs.mkdir('/workspace'); } catch (_) { /* noop */ }
        try { if (!fs.analyzePath('/tmp').exists) fs.mkdir('/tmp'); } catch (_) { /* noop */ }
        for (const file of message.files || []) writeFile(file.path, file.data);
        post('phase', { name: `Wrote ${(message.files || []).length} workspace file(s)` });
      }],
      onRuntimeInitialized: () => {
        metrics.runtimeInitializedAt = performance.now();
        post('phase', { name: 'Runtime initialized' });
      },
      onAbort: reason => {
        post('stderr', { text: `\n[Singular/WASM abort: ${String(reason)}]\n` });
        finish(134, String(reason));
      },
      onExit: status => finish(Number.isFinite(status) ? status : 0, 'process exited')
    };

    try {
      importScripts(ENGINE_JS);
      // Emscripten runs main() during importScripts when noInitialRun is false.
      // Completion should be reported by Module.onExit/onAbort. The UI owns the
      // wall-clock timeout and will terminate this worker if Singular does not exit.
    } catch (error) {
      post('stderr', { text: `\n[Could not start Singular/WASM: ${error.message || String(error)}]\n` });
      finish(1, 'engine start failed');
    }
  }

  self.addEventListener('message', event => {
    const message = event.data || {};
    if (message.type === 'run') run(message);
  });
})();
