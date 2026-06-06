#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createPrivateKey, createSign } from 'node:crypto';

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

function readDerLength(bytes, offset) {
  let length = bytes[offset];
  offset += 1;
  if ((length & 0x80) === 0) return { length, offset };
  const count = length & 0x7f;
  if (count === 0 || count > 2) throw new Error('Unsupported ECDSA signature length encoding.');
  length = 0;
  for (let i = 0; i < count; i += 1) {
    length = (length << 8) | bytes[offset + i];
  }
  return { length, offset: offset + count };
}

function readDerInteger(bytes, offset) {
  if (bytes[offset] !== 0x02) throw new Error('Invalid ECDSA signature integer.');
  const lengthInfo = readDerLength(bytes, offset + 1);
  const start = lengthInfo.offset;
  const end = start + lengthInfo.length;
  if (end > bytes.length) throw new Error('Truncated ECDSA signature integer.');
  return { value: bytes.subarray(start, end), offset: end };
}

function derEcdsaToP1363(derSignature) {
  const bytes = new Uint8Array(derSignature);
  if (bytes[0] !== 0x30) throw new Error('Invalid ECDSA signature sequence.');
  const sequenceLength = readDerLength(bytes, 1);
  const sequenceEnd = sequenceLength.offset + sequenceLength.length;
  if (sequenceEnd !== bytes.length) throw new Error('Invalid ECDSA signature length.');
  const r = readDerInteger(bytes, sequenceLength.offset);
  const s = readDerInteger(bytes, r.offset);
  if (s.offset !== sequenceEnd) throw new Error('Unexpected ECDSA signature data.');
  return Buffer.concat([normalizeInteger(r.value), normalizeInteger(s.value)]);
}

function normalizeInteger(value) {
  let bytes = Buffer.from(value);
  while (bytes.length > 0 && bytes[0] === 0) bytes = bytes.subarray(1);
  if (bytes.length > 32) throw new Error('ECDSA P-256 signature component is too large.');
  if (bytes.length === 32) return bytes;
  return Buffer.concat([Buffer.alloc(32 - bytes.length), bytes]);
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

const key = createPrivateKey({
  key: Buffer.from(pemToArrayBuffer(privatePem, 'PRIVATE KEY')),
  format: 'der',
  type: 'pkcs8'
});
const manifest = await readFile(manifestPath);
const signer = createSign('SHA256');
signer.update(manifest);
signer.end();
const signature = derEcdsaToP1363(signer.sign(key));

await writeFile(signaturePath, Buffer.from(signature));
await writeFile(`${signaturePath}.base64`, `${Buffer.from(signature).toString('base64')}\n`);
console.log(`Wrote ${signaturePath}`);
console.log(`Wrote ${signaturePath}.base64`);
