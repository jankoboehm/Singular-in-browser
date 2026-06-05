const DB_NAME = 'singular-browser-workbench';
const DB_VERSION = 1;
const STORE = 'files';

let dbPromise = null;

export function normalizePath(path) {
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

export function basename(path) {
  const parts = normalizePath(path).split('/');
  return parts[parts.length - 1] || 'untitled.sing';
}

export function textExtension(path) {
  return /\.(sing|lib|txt|md|json|csv|tsv|log|c|cc|cpp|h|hpp)$/i.test(path);
}

export function decodeText(buffer) {
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer || new ArrayBuffer(0));
}

export function encodeText(text) {
  return new TextEncoder().encode(String(text || '')).buffer;
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'path' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve(result);
    try {
      result = fn(store);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function putFile(path, data, meta = {}) {
  const record = {
    path: normalizePath(path),
    data: data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    mime: meta.mime || 'application/octet-stream',
    updatedAt: meta.updatedAt || Date.now(),
    source: meta.source || 'workspace'
  };
  await tx('readwrite', store => store.put(record));
  return record;
}

export async function putText(path, text, meta = {}) {
  return putFile(path, encodeText(text), { mime: 'text/plain;charset=utf-8', ...meta });
}

export async function getFile(path) {
  const key = normalizePath(path);
  return tx('readonly', store => reqToPromise(store.get(key)));
}

export async function deleteFile(path) {
  const key = normalizePath(path);
  await tx('readwrite', store => store.delete(key));
}

export async function listFiles() {
  const records = await tx('readonly', store => reqToPromise(store.getAll()));
  return (records || []).sort((a, b) => a.path.localeCompare(b.path));
}

export async function clearWorkspace() {
  await tx('readwrite', store => store.clear());
}

export async function exportWorkspaceJson() {
  const records = await listFiles();
  const files = records.map(record => ({
    path: record.path,
    mime: record.mime,
    updatedAt: record.updatedAt,
    dataBase64: arrayBufferToBase64(record.data)
  }));
  return JSON.stringify({
    format: 'singular-browser-workbench.workspace.v1',
    exportedAt: new Date().toISOString(),
    files
  }, null, 2);
}

export async function importWorkspaceJson(text, { replace = false } = {}) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.format !== 'singular-browser-workbench.workspace.v1' || !Array.isArray(parsed.files)) {
    throw new Error('Not a Singular Online workspace export.');
  }
  if (replace) await clearWorkspace();
  for (const file of parsed.files) {
    await putFile(file.path, base64ToArrayBuffer(file.dataBase64 || ''), {
      mime: file.mime || 'application/octet-stream',
      updatedAt: file.updatedAt || Date.now(),
      source: 'workspace-import'
    });
  }
  return parsed.files.length;
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
