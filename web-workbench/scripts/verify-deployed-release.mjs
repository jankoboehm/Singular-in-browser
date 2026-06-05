#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

function usage() {
  console.error(`Usage:
  node scripts/verify-deployed-release.mjs \\
    --server-base-url https://example.org/wasm/releases/2026-06-04/ \\
    --manifest-url https://raw.githubusercontent.com/OWNER/REPO/gh-pages/singular-wasm/2026-06-04/release-manifest.json \\
    --signature-url https://raw.githubusercontent.com/OWNER/REPO/gh-pages/singular-wasm/2026-06-04/release-manifest.json.sig \\
    --public-key singular-wasm-release-public.pem

Use --manifest-file and --signature-file instead of URL arguments for local checks.`);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function normalizeBaseUrl(value) {
  if (!value) return null;
  return value.endsWith('/') ? value : `${value}/`;
}

async function readTextFromUrlOrFile({ url, file, label }) {
  if (url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    return response.text();
  }
  if (file) return readFile(file, 'utf8');
  throw new Error(`missing ${label}`);
}

async function readBytesFromUrlOrFile({ url, file, label }) {
  if (url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  if (file) return new Uint8Array(await readFile(file));
  throw new Error(`missing ${label}`);
}

function pemToArrayBuffer(pem, label) {
  const clean = pem
    .replace(`-----BEGIN ${label}-----`, '')
    .replace(`-----END ${label}-----`, '')
    .replace(/\s+/g, '');
  return Uint8Array.from(Buffer.from(clean, 'base64')).buffer;
}

async function shaHex(bytes, algorithm) {
  const digest = await webcrypto.subtle.digest(algorithm, bytes);
  return Buffer.from(digest).toString('hex');
}

async function verifySignature({ manifestText, signatureBytes, publicKeyPath }) {
  const publicPem = await readFile(publicKeyPath, 'utf8');
  const key = await webcrypto.subtle.importKey(
    'spki',
    pemToArrayBuffer(publicPem, 'PUBLIC KEY'),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const ok = await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signatureBytes,
    new TextEncoder().encode(manifestText)
  );
  if (!ok) throw new Error('release manifest signature is invalid');
}

const serverBaseUrl = normalizeBaseUrl(readArg('--server-base-url'));
const manifestUrl = readArg('--manifest-url');
const manifestFile = readArg('--manifest-file');
const signatureUrl = readArg('--signature-url');
const signatureFile = readArg('--signature-file');
const publicKeyPath = readArg('--public-key');

if (!serverBaseUrl || (!manifestUrl && !manifestFile)) {
  usage();
  process.exit(2);
}

const manifestText = await readTextFromUrlOrFile({
  url: manifestUrl,
  file: manifestFile,
  label: 'release manifest'
});

if (publicKeyPath || signatureUrl || signatureFile) {
  if (!publicKeyPath || (!signatureUrl && !signatureFile)) {
    throw new Error('signature verification needs --public-key and --signature-url/--signature-file');
  }
  const signatureBytes = await readBytesFromUrlOrFile({
    url: signatureUrl,
    file: signatureFile,
    label: 'release manifest signature'
  });
  await verifySignature({ manifestText, signatureBytes, publicKeyPath });
  console.log('Verified release manifest signature.');
}

const manifest = JSON.parse(manifestText);
if (manifest.format !== 'singular-browser-workbench.asset-manifest.v1' || !manifest.assets) {
  throw new Error('not a Singular workbench asset manifest');
}

let checked = 0;
for (const [relPath, expected] of Object.entries(manifest.assets)) {
  const url = new URL(relPath, serverBaseUrl).toString();
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${relPath} returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (Number.isFinite(expected.bytes) && bytes.byteLength !== expected.bytes) {
    throw new Error(`${relPath} size mismatch: expected ${expected.bytes}, got ${bytes.byteLength}`);
  }
  const sha256 = await shaHex(bytes, 'SHA-256');
  if (sha256 !== expected.sha256) throw new Error(`${relPath} SHA-256 mismatch`);
  if (expected.sha384) {
    const sha384 = await shaHex(bytes, 'SHA-384');
    if (sha384 !== expected.sha384) throw new Error(`${relPath} SHA-384 mismatch`);
  }
  checked += 1;
}

console.log(`Verified ${checked} deployed asset(s) from ${serverBaseUrl}`);
