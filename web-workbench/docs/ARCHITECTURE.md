# Architecture

```text
browser tab
  ├─ app.js
  │   ├─ xterm.js terminal UI
  │   ├─ IndexedDB workspace
  │   ├─ File System Access API bridge, when available
  │   └─ explicit upload/download controls
  │
  ├─ singular-terminal-worker.js
  │   ├─ xterm-pty bridge
  │   ├─ Emscripten virtual filesystem
  │   └─ interactive Singular REPL
  │
  └─ singular-batch-worker.js
      ├─ fresh Emscripten virtual filesystem
      └─ one-shot Singular script execution
```

The web host only serves static assets. It does not execute Singular.

## Filesystem

The workspace has three layers:

1. Browser IndexedDB: persistent across reloads for this origin.
2. `/workspace` in Emscripten MEMFS: copied into each Singular worker.
3. Optional selected local folder: mirrored only after explicit user action.

The terminal worker keeps an in-memory `/workspace` for the life of the session.
When the user uploads or saves a file, the main page sends a copy to the worker.
Workers for executing scripts receive a complete workspace snapshot before the script runs.

## Termination

The UI can terminate a running Singular by killing the whole Web Worker.
This is intentionally coarse since it is reliable for a browser try-out. The next run
starts a fresh worker.

## Completeness

Some native Singular behavior cannot be identical in a browser:

- arbitrary OS shell execution
- launching external programs
- native dynamic modules not linked into the WASM binary
- unprompted host filesystem access
- POSIX features that Emscripten does not emulate.

The practical target is: we aim at all core Singular language features, preloaded
libraries, statically linked modules, docs, and user-uploaded libraries/scripts working.
