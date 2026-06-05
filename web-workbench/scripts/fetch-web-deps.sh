#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="${ROOT_DIR}/public/vendor"
TMP_DIR="${ROOT_DIR}/.deps-web"

XTERM_VERSION="${XTERM_VERSION:-5.5.0}"
FIT_VERSION="${FIT_VERSION:-0.10.0}"
# The experimental Singular web template used xterm-pty 0.9.4 workerTools.js.
XTERM_PTY_VERSION="${XTERM_PTY_VERSION:-0.9.4}"

rm -rf "${TMP_DIR}"
mkdir -p "${TMP_DIR}" "${VENDOR_DIR}/xterm" "${VENDOR_DIR}/xterm-pty"

cat > "${TMP_DIR}/package.json" <<JSON
{"private":true,"type":"module","dependencies":{"@xterm/xterm":"${XTERM_VERSION}","@xterm/addon-fit":"${FIT_VERSION}","xterm-pty":"${XTERM_PTY_VERSION}"}}
JSON

(
  cd "${TMP_DIR}"
  npm install --omit=dev --no-audit --no-fund
)

cp "${TMP_DIR}/node_modules/@xterm/xterm/css/xterm.css" "${VENDOR_DIR}/xterm/xterm.css"
cp "${TMP_DIR}/node_modules/@xterm/xterm/lib/xterm.js" "${VENDOR_DIR}/xterm/xterm.js"
cp "${TMP_DIR}/node_modules/@xterm/addon-fit/lib/addon-fit.js" "${VENDOR_DIR}/xterm/addon-fit.js"

if [[ -f "${TMP_DIR}/node_modules/xterm-pty/index.mjs" ]]; then
  cp "${TMP_DIR}/node_modules/xterm-pty/index.mjs" "${VENDOR_DIR}/xterm-pty/index.mjs"
elif [[ -f "${TMP_DIR}/node_modules/xterm-pty/index.js" ]]; then
  cp "${TMP_DIR}/node_modules/xterm-pty/index.js" "${VENDOR_DIR}/xterm-pty/index.mjs"
else
  echo "Could not find xterm-pty index file" >&2
  exit 1
fi

if [[ -f "${TMP_DIR}/node_modules/xterm-pty/workerTools.js" ]]; then
  cp "${TMP_DIR}/node_modules/xterm-pty/workerTools.js" "${VENDOR_DIR}/xterm-pty/workerTools.js"
else
  echo "Could not find xterm-pty workerTools.js" >&2
  exit 1
fi

python3 "${ROOT_DIR}/scripts/write-asset-manifest.py" \
  --base "${ROOT_DIR}/public" \
  --output "${VENDOR_DIR}/versions.json" \
  --name "Singular Online vendor assets" \
  --source "npm install --omit=dev --no-audit --no-fund" \
  --package "@xterm/xterm=${XTERM_VERSION}" \
  --package "@xterm/addon-fit=${FIT_VERSION}" \
  --package "xterm-pty=${XTERM_PTY_VERSION}" \
  --asset vendor/xterm/xterm.css \
  --asset vendor/xterm/xterm.js \
  --asset vendor/xterm/addon-fit.js \
  --asset vendor/xterm-pty/index.mjs \
  --asset vendor/xterm-pty/workerTools.js

python3 "${ROOT_DIR}/scripts/verify-asset-manifest.py" \
  --manifest "${VENDOR_DIR}/versions.json" \
  --lock "${ROOT_DIR}/scripts/vendor-assets.lock.json"

echo "Browser dependencies copied to ${VENDOR_DIR}"
