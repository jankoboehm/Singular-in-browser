#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_VERSION="${EMSDK_VERSION:-3.1.23}"
EMSDK_COMMIT="${EMSDK_COMMIT:-b4fd4751bae9f37f7a991e6733ba1af40a1c8739}"
EMSDK_DIR="${ROOT_DIR}/.emsdk"

if [[ -d "${EMSDK_DIR}/.git" ]]; then
  :
elif [[ -e "${EMSDK_DIR}" ]]; then
  echo "Existing emsdk path is not a git checkout and cannot be verified: ${EMSDK_DIR}" >&2
  exit 1
else
  git init "${EMSDK_DIR}"
  git -C "${EMSDK_DIR}" remote add origin https://github.com/emscripten-core/emsdk.git
  git -C "${EMSDK_DIR}" fetch --depth 1 origin "${EMSDK_COMMIT}"
  git -C "${EMSDK_DIR}" checkout --detach FETCH_HEAD
fi

actual_commit="$(git -C "${EMSDK_DIR}" rev-parse HEAD)"
if [[ "${actual_commit}" != "${EMSDK_COMMIT}" ]]; then
  echo "emsdk source verification failed: expected ${EMSDK_COMMIT}, got ${actual_commit}" >&2
  exit 1
fi

(
  cd "${EMSDK_DIR}"
  ./emsdk install "${EMSDK_VERSION}"
  ./emsdk activate "${EMSDK_VERSION}"
)

cat <<MSG
Emscripten SDK ${EMSDK_VERSION} is installed.
Before building, run:

  source "${EMSDK_DIR}/emsdk_env.sh"

MSG
