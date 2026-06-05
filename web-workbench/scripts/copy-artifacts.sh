#!/usr/bin/env bash
set -euo pipefail

WORKBENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${WORKBENCH_DIR}/../.." && pwd)"
SRC="${1:-${REPO_ROOT}/Singular}"
OUT="${WORKBENCH_DIR}/public/engine"
mkdir -p "${OUT}"

if [[ ! -f "${SRC}/Singular.js" ]]; then
  echo "Usage: $0 [/path/to/directory-containing-Singular.js]" >&2
  echo "Default source was: ${SRC}" >&2
  exit 2
fi

cp "${SRC}/Singular.js" "${OUT}/Singular.js"
[[ -f "${SRC}/Singular.wasm" ]] && cp "${SRC}/Singular.wasm" "${OUT}/Singular.wasm"
[[ -f "${SRC}/Singular.data" ]] && cp "${SRC}/Singular.data" "${OUT}/Singular.data"

python3 "${WORKBENCH_DIR}/scripts/write-asset-manifest.py" \
  --base "${WORKBENCH_DIR}/public" \
  --output "${OUT}/engine-manifest.json" \
  --name "Singular WebAssembly engine" \
  --source "${SRC}" \
  --asset engine/Singular.js \
  --asset engine/Singular.wasm \
  --asset engine/Singular.data \
  --allow-missing

echo "Copied Singular WebAssembly artifacts into ${OUT}"
