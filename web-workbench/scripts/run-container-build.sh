#!/usr/bin/env bash
set -euo pipefail

IMAGE_REPO="${IMAGE_REPO:-/image-repo}"
BUILD_REPO="${BUILD_REPO:-/work/Singular}"
SINGULAR_REPO="${SINGULAR_REPO:-https://github.com/Singular/Singular.git}"
SINGULAR_REF="${SINGULAR_REF:-spielwiese}"

if [[ ! -d "${IMAGE_REPO}" ]]; then
  echo "Missing image repository at ${IMAGE_REPO}" >&2
  exit 1
fi

mkdir -p "$(dirname "${BUILD_REPO}")"

if [[ -d "${BUILD_REPO}/.git" ]]; then
  git -C "${BUILD_REPO}" fetch --depth 1 origin "${SINGULAR_REF}"
  git -C "${BUILD_REPO}" checkout --detach FETCH_HEAD
else
  git clone --depth 1 --branch "${SINGULAR_REF}" "${SINGULAR_REPO}" "${BUILD_REPO}"
fi

mkdir -p "${BUILD_REPO}/emscripten"

# Keep a persistent Singular checkout without mutating the browser repository.
# Do not delete generated build files under BUILD_REPO/emscripten; they are the
# cache we want for repeated container builds.
rsync -a \
  --exclude '/.git/' \
  --exclude '/.github/' \
  --exclude '/LICENSE' \
  --exclude '/Singular/' \
  --exclude '/build/' \
  --exclude '/install/' \
  --exclude '/extern/' \
  --exclude '/web-workbench/.deps-web/' \
  --exclude '/web-workbench/node_modules/' \
  --exclude '/web-workbench/public/vendor/' \
  --exclude '/web-workbench/public/engine/Singular.js' \
  --exclude '/web-workbench/public/engine/Singular.wasm' \
  --exclude '/web-workbench/public/engine/Singular.data' \
  --exclude '/web-workbench/public/engine/engine-manifest.json' \
  "${IMAGE_REPO}/" "${BUILD_REPO}/emscripten/"

cd "${BUILD_REPO}"

bash emscripten/web-workbench/scripts/fetch-web-deps.sh
bash emscripten/web-workbench/scripts/build-full-wasm.sh
bash emscripten/web-workbench/scripts/smoke-static.sh
