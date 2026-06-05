# Singular WebAssembly engine files

Emscripten-generated Singular engine here:

```text
Singular.js
Singular.wasm
Singular.data
```

The browser workers assume a classic Emscripten app build with filesystem
support available from JavaScript callbacks. For this, build with flags equivalent to:

```text
-s FORCE_FILESYSTEM=1
-s EXIT_RUNTIME=1
-s ALLOW_MEMORY_GROWTH=1
-s ASYNCIFY=1
```

For the terminal worker, the Singular build also needs the xterm-pty Emscripten
PTY integration.
