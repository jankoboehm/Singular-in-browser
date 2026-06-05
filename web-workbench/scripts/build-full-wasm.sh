#!/usr/bin/env bash
set -euo pipefail

# Build the WebAssembly target from the current Singular checkout and copy the
# generated Emscripten runtime into this workbench.
#
# Intended use after applying PR #1360 plus this workbench patch:
#   bash emscripten/web-workbench/scripts/fetch-web-deps.sh
#   bash emscripten/web-workbench/scripts/build-full-wasm.sh

WORKBENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${WORKBENCH_DIR}/../.." && pwd)"
OUT_DIR="${WORKBENCH_DIR}/public/engine"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"

if ! command -v emcc >/dev/null 2>&1; then
  cat >&2 <<MSG
emcc was not found. Install/source Emscripten first, for example:

  bash emscripten/web-workbench/scripts/install-emsdk.sh
  source emscripten/web-workbench/.emsdk/emsdk_env.sh

MSG
  exit 1
fi

if [[ ! -f "${WORKBENCH_DIR}/scripts/singular-wasm-build.sh" ]]; then
  echo "This script must be run from a Singular checkout containing the workbench WASM build script." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

(
  cd "${REPO_ROOT}"

  echo "Building all.lib before final data packaging if possible..."
  if [[ -d Singular/LIB && -f emscripten/gen_all_lib.sh ]]; then
    bash emscripten/gen_all_lib.sh || true
  fi

  echo "Running workbench Singular WebAssembly build script..."
  MAKEFLAGS="-j${JOBS}" bash "${WORKBENCH_DIR}/scripts/singular-wasm-build.sh"

  echo "Regenerating all.lib after build for source tree consistency..."
  if [[ -f emscripten/gen_all_lib.sh ]]; then
    bash emscripten/gen_all_lib.sh || true
  fi

  if [[ -f Singular/Singular.js ]]; then
    cp Singular/Singular.js "${OUT_DIR}/Singular.js"
  elif [[ -f Singular/Singular.html ]]; then
    cp Singular/Singular.html "${OUT_DIR}/Singular.js"
  else
    echo "Could not find Singular/Singular.js after build" >&2
    exit 1
  fi

  [[ -f Singular/Singular.wasm ]] && cp Singular/Singular.wasm "${OUT_DIR}/Singular.wasm"
  [[ -f Singular/Singular.data ]] && cp Singular/Singular.data "${OUT_DIR}/Singular.data"

  python3 "${WORKBENCH_DIR}/scripts/write-asset-manifest.py" \
    --base "${WORKBENCH_DIR}/public" \
    --output "${OUT_DIR}/engine-manifest.json" \
    --name "Singular WebAssembly engine" \
    --source "current Singular checkout; $(emcc --version | head -1)" \
    --asset engine/Singular.js \
    --asset engine/Singular.wasm \
    --asset engine/Singular.data \
    --allow-missing
)

cat <<MSG
Build artifacts copied to:

  ${OUT_DIR}

Next:

  bash emscripten/web-workbench/scripts/fetch-web-deps.sh
  bash emscripten/web-workbench/scripts/benchmark-local.sh

MSG
