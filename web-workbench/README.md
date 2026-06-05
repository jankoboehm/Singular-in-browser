# Singular Online

This implements the user frontend for Singular in the Browser

## Features

- interactive Singular terminal
- **Start**, **Restart**, and **Terminate** Singular
- script editor and fresh-worker batch script runner
- upload files into `/workspace`
- persistent browser workspace uses IndexedDB
- optional local-folder bridge using the browser File System Access API with push and pull
- export/import workspace JSON
- `LIB` helper for loading libraries
- benchmark button and Playwright benchmark
- generated SHA-256/SHA-384 manifests for browser vendor and engine assets
- hash verification of Singular engine assets before worker startup
- Podman helpers for building locally

## Setup

The WebAssembly program is running on the user's machine
inside the browser sandbox. It cannot silently read from the user's machine, or execute in the
user's shell.

```text
local files chosen by user
  -> browser permission / picker
  -> app workspace in IndexedDB
  -> Emscripten virtual /workspace
  -> Singular reads /workspace/foo.sing or /workspace/lib/foo.lib
```

Chromium-family browsers can read/write a user-selected folder via the File
System Access API. Other browsers use upload/download and workspace JSON
import/export.

## File layout

```text
run-web-workbench.sh               local server wrapper
web-workbench/public/              static browser app
web-workbench/public/engine/       put Singular.js/.wasm/.data here
web-workbench/public/vendor/       generated xterm/xterm-pty files
web-workbench/scripts/             build, serve, test, benchmark
web-workbench/deploy/              static hosting examples
web-workbench/docs/                architecture and security notes
web-workbench/ci/*.example         manual CI examples only
```

## Build in CI or a Singular checkout

The GitHub Actions workflow is the preferred build path. It checks out this
repository, checks out `Singular/Singular` at the selected ref, overlays this
repository into `Singular/emscripten`, and builds there.

For a local manual build, we use the same layout: copy this repo
into the `emscripten/` directory of a Singular checkout, then run the build
commands from that Singular checkout.

We currently use emsdk 3.1.23:

```bash
bash web-workbench/scripts/install-emsdk.sh
source web-workbench/.emsdk/emsdk_env.sh
```

Fetch pinned browser UI dependencies:

```bash
bash web-workbench/scripts/fetch-web-deps.sh
```

This writes `public/vendor/versions.json` with package versions, byte counts,
SHA-256, and SHA-384 for every generated browser vendor file. The HTML uses SRI
for the loaded xterm CSS/JS files. The terminal startup path verifies the
dynamic xterm-pty files before importing them.

Build Singular to WebAssembly and copy the generated engine into the workbench:

```bash
bash web-workbench/scripts/build-full-wasm.sh
```

Expected runtime files:

```text
web-workbench/public/engine/Singular.js
web-workbench/public/engine/Singular.wasm
web-workbench/public/engine/Singular.data
```

The build/copy helpers write `public/engine/engine-manifest.json`. The browser
checks this manifest and verifies `Singular.js`, `Singular.wasm`, and
`Singular.data` before starting a terminal or batch worker.

The build helper runs `scripts/patch-upstream-build.py` by default. This makes
the final Emscripten link explicit about filesystem/runtime exports and changes
the final named output from `Singular.html` to `Singular.js`. Set `PATCH_BUILD=0`
to skip that local patching step.

## Serve locally

After building:

```bash
bash run-web-workbench.sh
```

or directly:

```bash
python3 web-workbench/scripts/serve-local.py --port 9999
```

Open `http://127.0.0.1:9999/`.

The local server adds COOP/COEP headers for terminal integration and future
pthread builds.

## Podman/Docker build

From the repository root:

```bash
podman build \
  --ignorefile web-workbench/build/Containerignore \
  -t singular-wasm-workbench \
  -f web-workbench/build/Dockerfile \
  .

podman run --rm \
  -e JOBS=1 \
  -e BINARYEN_CORES=1 \
  -e REFRESH_VERIFIED_SOURCES=0 \
  -e SINGULAR_REF=spielwiese \
  -v singular-wasm-repo-cache:/work/Singular \
  singular-wasm-workbench
```

## Test and benchmark

Static checks:

```bash
bash web-workbench/scripts/smoke-static.sh
```

Automated benchmark after a successful engine build:

```bash
cd web-workbench
npm install
npx playwright install chromium
bash scripts/benchmark-local.sh
```

The browser page also has a **Benchmark startup/run** button.

Keyboard/UI test with already running Chrome DevTools:

```bash
node web-workbench/scripts/keyboard-smoke.mjs http://127.0.0.1:9999/
```

The test checks the platform-specific Strg/Cmd shortcut labels and tries out Save, Start,
Send, Run script, and Terminate via keyboard.

## Release package

After `public/engine/` and `public/vendor/` are populated, build a deployable
zip plus release manifest:

```bash
bash web-workbench/scripts/package-served-files.sh
```

For public deployments with GitHub-backed browser verification, use the
environment variables documented in `docs/DEPLOYMENT.md`.

Security/verification:

- no CDN scripts are loaded by the browser app
- vendor files are self-hosted and recorded in `public/vendor/versions.json`
- engine files are self-hosted and recorded in `public/engine/engine-manifest.json`
- engine and dynamic terminal helper assets are verified with Web Crypto before use
- public deployments can additionally verify every served asset against a
- service-worker caching intentionally bypasses `engine/` and `vendor/`.

## CI

The active workflow builds on pull requests and `workflow_dispatch`, then stores
the deployable package as a workflow artifact. On GitHub Release publication it
requires signing-key secrets, signs the manifest, and attaches the zip and
manifest files to the release.
