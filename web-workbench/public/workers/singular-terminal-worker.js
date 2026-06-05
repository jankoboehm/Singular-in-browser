/* global importScripts, emscriptenHack, TtyClient, FS */
(() => {
  'use strict';

  const CONTROL = '__singularControl';
  const ENGINE_JS = '../engine/Singular.js';
  const XTERM_PTY_TOOLS = '../vendor/xterm-pty/workerTools.js';

  let started = false;
  let configuredArgs = ['--no-rc'];
  let fsReady = false;
  let pendingFiles = [];
  let fsTrackerInstalled = false;
  let suppressTracking = false;
  const dirtyWorkspacePaths = new Set();

  function post(type, payload = {}) {
    self.postMessage({ [CONTROL]: true, type, ...payload });
  }

  function postTransfer(type, payload = {}, transfer = []) {
    self.postMessage({ [CONTROL]: true, type, ...payload }, transfer);
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
    if (normalized !== '/workspace' && !normalized.startsWith('/workspace/')) {
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
    const parts = normalizePath(path).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += `/${part}`;
      try {
        if (!fs.analyzePath(current).exists) fs.mkdir(current);
      } catch (_) {
        // Directory may already exist or be created by another preRun hook.
      }
    }
  }

  function isWorkspacePath(path) {
    const normalized = normalizePath(path);
    return normalized !== '/workspace' && normalized.startsWith('/workspace/');
  }

  function trackedFileRecord(fs, path) {
    const normalized = normalizePath(path);
    const stat = fs.stat(normalized);
    if (fs.isDir(stat.mode)) return null;
    const bytes = fs.readFile(normalized);
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const data = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    return {
      path: normalized,
      size: stat.size,
      mtimeMs: stat.mtime instanceof Date ? stat.mtime.getTime() : 0,
      data
    };
  }

  function postWorkspaceFile(path, reason = 'changed') {
    if (suppressTracking || !isWorkspacePath(path)) return;
    const fs = getFS();
    if (!fs) return;
    try {
      suppressTracking = true;
      if (!fs.analyzePath(normalizePath(path)).exists) {
        post('fs.deleted', { path: normalizePath(path), reason });
        return;
      }
      const record = trackedFileRecord(fs, path);
      if (record) postTransfer('fs.changed', { file: record, reason }, [record.data]);
    } catch (error) {
      post('error', { message: `Could not track ${path}: ${error.message || String(error)}` });
    } finally {
      suppressTracking = false;
    }
  }

  function markDirtyPath(path) {
    if (!suppressTracking && path && isWorkspacePath(path)) dirtyWorkspacePaths.add(normalizePath(path));
  }

  function streamPath(fs, stream) {
    try {
      return stream?.path || (stream?.node ? fs.getPath(stream.node) : '');
    } catch (_) {
      return stream?.path || '';
    }
  }

  function flushDirtyPath(path, reason = 'changed') {
    const normalized = normalizePath(path);
    if (!dirtyWorkspacePaths.has(normalized)) return;
    dirtyWorkspacePaths.delete(normalized);
    postWorkspaceFile(normalized, reason);
  }

  function installWorkspaceTracker(fs) {
    if (fsTrackerInstalled || !fs) return;
    fsTrackerInstalled = true;

    const originalWriteFile = fs.writeFile?.bind(fs);
    if (originalWriteFile) {
      fs.writeFile = (path, data, opts) => {
        const result = originalWriteFile(path, data, opts);
        if (!suppressTracking) postWorkspaceFile(path, 'writeFile');
        return result;
      };
    }

    const originalWrite = fs.write?.bind(fs);
    if (originalWrite) {
      fs.write = (stream, buffer, offset, length, position, canOwn) => {
        const result = originalWrite(stream, buffer, offset, length, position, canOwn);
        const path = streamPath(fs, stream);
        markDirtyPath(path);
        postWorkspaceFile(path, 'write');
        return result;
      };
    }

    const originalClose = fs.close?.bind(fs);
    if (originalClose) {
      fs.close = stream => {
        const path = streamPath(fs, stream);
        const result = originalClose(stream);
        if (path) flushDirtyPath(path, 'close');
        return result;
      };
    }

    const originalUnlink = fs.unlink?.bind(fs);
    if (originalUnlink) {
      fs.unlink = path => {
        const normalized = normalizePath(path);
        const result = originalUnlink(path);
        if (!suppressTracking && isWorkspacePath(normalized)) post('fs.deleted', { path: normalized, reason: 'unlink' });
        return result;
      };
    }

    const originalRename = fs.rename?.bind(fs);
    if (originalRename) {
      fs.rename = (oldPath, newPath) => {
        const oldNormalized = normalizePath(oldPath);
        const result = originalRename(oldPath, newPath);
        if (!suppressTracking && isWorkspacePath(oldNormalized)) post('fs.deleted', { path: oldNormalized, reason: 'rename' });
        if (!suppressTracking && isWorkspacePath(newPath)) postWorkspaceFile(newPath, 'rename');
        return result;
      };
    }
  }

  function writeMany(files) {
    if (!fsReady) {
      pendingFiles.push(...files);
      return;
    }
    const fs = getFS();
    if (!fs) throw new Error('Emscripten FS is not available.');
    for (const file of files) {
      const path = normalizePath(file.path);
      mkdirp(path.split('/').slice(0, -1).join('/') || '/workspace');
      const data = file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : new Uint8Array(file.data || []);
      suppressTracking = true;
      try {
        fs.writeFile(path, data, { canOwn: false });
      } finally {
        suppressTracking = false;
      }
    }
  }

  function listFiles(dir = '/workspace') {
    const fs = getFS();
    if (!fs) return [];
    const out = [];
    function walk(path) {
      if (!fs.analyzePath(path).exists) return;
      for (const name of fs.readdir(path)) {
        if (name === '.' || name === '..') continue;
        const child = `${path.replace(/\/$/, '')}/${name}`;
        const stat = fs.stat(child);
        if (fs.isDir(stat.mode)) walk(child);
        else out.push({
          path: child,
          size: stat.size,
          mtimeMs: stat.mtime instanceof Date ? stat.mtime.getTime() : 0
        });
      }
    }
    walk(normalizePath(dir));
    return out;
  }

  function readFile(path) {
    const fs = getFS();
    if (!fs) throw new Error('Emscripten FS is not available.');
    const normalized = normalizePath(path);
    const stat = fs.stat(normalized);
    if (fs.isDir(stat.mode)) throw new Error(`${normalized} is a directory.`);
    const bytes = fs.readFile(normalized);
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const data = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    return {
      path: normalized,
      size: stat.size,
      mtimeMs: stat.mtime instanceof Date ? stat.mtime.getTime() : 0,
      data
    };
  }

  function locateFile(path, prefix) {
    if (path.endsWith('.wasm') || path.endsWith('.data') || path.startsWith('Singular.')) {
      return new URL(`../engine/${path}`, self.location.href).toString();
    }
    return `${prefix || ''}${path}`;
  }

  function preRunSetup() {
    const fs = getFS();
    if (!fs) throw new Error('Emscripten FS is not available in preRun.');
    try { if (!fs.analyzePath('/workspace').exists) fs.mkdir('/workspace'); } catch (_) { /* noop */ }
    try { if (!fs.analyzePath('/tmp').exists) fs.mkdir('/tmp'); } catch (_) { /* noop */ }
    installWorkspaceTracker(fs);
    fsReady = true;
    writeMany(pendingFiles.splice(0));
    post('ready', { detail: 'filesystem ready' });
    post('fs.list', { files: listFiles('/workspace') });
  }

  function configure(message) {
    if (Array.isArray(message.args) && message.args.length) configuredArgs = message.args.map(String);
  }

  function handleControl(message) {
    const requestId = message.requestId;
    try {
      if (message.type === 'configure') {
        configure(message);
      } else if (message.type === 'fs.writeMany') {
        writeMany(message.files || []);
        post('fs.ack', { requestId, detail: `Installed ${(message.files || []).length} file(s) in /workspace.` });
      } else if (message.type === 'fs.list') {
        post('fs.list', { requestId, files: listFiles(message.dir || '/workspace') });
      } else if (message.type === 'fs.read') {
        const record = readFile(message.path);
        postTransfer('fs.read', { requestId, ...record }, [record.data]);
      }
    } catch (error) {
      post('error', { requestId, message: error.message || String(error) });
    }
  }

  function startSingular(ttyData) {
    if (started) return;
    started = true;
    try {
      importScripts(XTERM_PTY_TOOLS);
      self.Module = {
        arguments: configuredArgs,
        noInitialRun: false,
        noExitRuntime: true,
        locateFile,
        preRun: [
          preRunSetup,
          () => emscriptenHack(new TtyClient(ttyData))
        ],
        onAbort: reason => post('error', { message: `Singular aborted: ${String(reason)}` }),
        onExit: status => post('error', { message: `Singular exited with status ${status}` })
      };
      importScripts(ENGINE_JS);
    } catch (error) {
      post('error', { message: `Could not load Singular terminal runtime: ${error.message || String(error)}` });
      throw error;
    }
  }

  self.addEventListener('message', event => {
    const message = event.data;
    if (message && message[CONTROL]) {
      handleControl(message);
      return;
    }
    if (!started) startSingular(message);
  });
})();
