# Security and local files

Running in the browser is a better default for a public try-out because the
server does not execute user code. It does not mean the web page becomes a
native app with ambient access to the visitor's computer.

## Why not expose the entire local filesystem?

A web page loaded from the internet must not be able to silently read private
files or overwrite a user's project directory. Browser APIs are intentionally
permission-based. This workbench uses the safe patterns:

- file input for explicit uploads
- Download for explicit saves
- IndexedDB for browser workbench files
- file System Access API only after the user chooses a folder.

## Permissions

When a browser supports `showDirectoryPicker`, the user can select a directory.
The app then mirrors files between that selected directory and `/workspace`.
This is still not a live POSIX mount. The app copies files because browser file
operations are asynchronous and permission-scoped, while native C/C++ code in
Singular expects synchronous file APIs inside Emscripten's virtual filesystem.

## Recommended public defaults

For a public university demo:

- serve from a dedicated subdomain
- do not use cookies or login state on that subdomain
- self-host all JS dependencies
- keep telemetry off unless explicitly disclosed
- use HTTPS so browser file permissions work consistently.

## Asset verification

The browser app must not pull executable code from a CDN at runtime. The vendor
helper downloads pinned npm packages during build/development and writes
`public/vendor/versions.json` with byte counts and SHA-256/SHA-384 hashes.
`scripts/vendor-assets.lock.json` pins the expected byte counts and hashes for
those copied files, including dynamically loaded worker helpers. The HTML uses
SRI for the loaded xterm CSS/JS files.

The WebAssembly engine is generated locally and copied into `public/engine`.
The copy/build helpers write `engine-manifest.json`, the app verifies the engine
files against that manifest before starting workers. The service worker does not
cache `engine/` or `vendor/` assets, and deployment examples avoid immutable
caching for stable engine filenames.

The trust root is still the origin serving `index.html`. For a public deployment,
serve from a dedicated HTTPS origin, keep the deployed artifact immutable after
review, and publish the generated manifests alongside release notes or CI logs.
