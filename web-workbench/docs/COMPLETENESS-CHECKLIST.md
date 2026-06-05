# Completeness checklist for the Singular WASM engine

After building `web-workbench/public/engine/Singular.js`, `.wasm`, and `.data`, run these in
the browser terminal or as batch scripts.

## Core language

```singular
ring r = 0,(x,y),dp
ideal I = x2-y3, x3-y5
std(I)
factorize(x6-1)
```

## Library loading

```singular
LIB "all.lib"
LIB "normaliz.lib"
LIB "gfan.lib"
LIB "tropical.lib"
```

## Uploaded user library

Upload `/workspace/user-demo.lib`:

```singular
proc hello_from_user_lib()
{
  "hello from uploaded library"
}
```

Then run:

```singular
LIB "/workspace/user-demo.lib"
hello_from_user_lib()
```

## Script execution

Save `/workspace/script.sing`:

```singular
ring r = 0,(a,b,c),dp
ideal J = a2+b2+c2, a*b-c
std(J)
```

Click **Run script**.

## Browser storage workbench

1. Save a script in the editor.
2. Reload the page.
3. Confirm the file remains in the workspace list.
4. Choose a local folder.
5. Click **Push**.
6. Verify the file appears in the selected folder.
7. Modify that file locally.
8. Click **Pull** and confirm the editor sees the change.

## Performance samples

Record these with the Benchmark button on a cold page load and again after
refreshing once:

- page shell ready time
- engine load/runtime initialization time
- modest Gröbner basis sample time
- total batch worker time
- engine asset sizes.

Keep the examples modest. The public try-out should demonstrate responsiveness,
not invite accidental browser lockups.

## Asset verification

- vendor files are self-hosted
- `public/vendor/versions.json` is generated after fetching vendor files
- SRI hashes in `index.html` match the fetched xterm CSS/JS files
- `public/engine/engine-manifest.json` is generated after copying/building the engine
- browser startup refuses to run workers if engine hashes do not match
- service worker does not cache `engine/` or `vendor/` files.
