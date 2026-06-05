#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { webcrypto } from 'node:crypto';

function usage() {
  console.error(`Usage:
  node scripts/sign-release-manifest.mjs --key PRIVATE_PKCS8_PEM --manifest release-manifest.json --signature release-manifest.json.sig

The private key must be an ECDSA P-256 key in PKCS#8 PEM format, for example:
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out singular-wasm-release-private.pem
  openssl pkey -in singular-wasm-release-private.pem -pubout -out singular-wasm-release-public.pem`);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function pemToArrayBuffer(pem, label) {
  const clean = pem
    .replace(`-----BEGIN ${label}-----`, '')
    .replace(`-----END ${label}-----`, '')
    .replace(/\s+/g, '');
  return Uint8Array.from(Buffer.from(clean, 'base64')).buffer;
}

const keyPath = readArg('--key');
const manifestPath = readArg('--manifest');
const signaturePath = readArg('--signature');

if (!keyPath || !manifestPath || !signaturePath) {
  usage();
  process.exit(2);
}

const privatePem = await readFile(keyPath, 'utf8');
if (!privatePem.includes('BEGIN PRIVATE KEY')) {
  console.error(`${basename(keyPath)} must be PKCS#8 PEM ("BEGIN PRIVATE KEY"), not traditional EC PRIVATE KEY.`);
  process.exit(2);
}

const key = await webcrypto.subtle.importKey(
  'pkcs8',
  pemToArrayBuffer(privatePem, 'PRIVATE KEY'),
  { name: 'ECDSA', namedCurve: 'P-256' },
  false,
  ['sign']
);
const manifest = await readFile(manifestPath);
const signature = await webcrypto.subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' },
  key,
  manifest
);

await writeFile(signaturePath, Buffer.from(signature));
await writeFile(`${signaturePath}.base64`, `${Buffer.from(signature).toString('base64')}\n`);
console.log(`Wrote ${signaturePath}`);
console.log(`Wrote ${signaturePath}.base64`);
