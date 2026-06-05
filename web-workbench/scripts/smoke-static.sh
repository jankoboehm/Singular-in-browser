#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"
node --check public/js/app.js
node --check public/js/workspace-db.js
node --check public/trust-config.js
node --check public/workers/singular-terminal-worker.js
node --check public/workers/singular-batch-worker.js
node --check scripts/keyboard-smoke.mjs
node --check scripts/cdp-state.mjs
node --check scripts/terminal-input-methods.mjs
node --check scripts/sign-release-manifest.mjs
node --check scripts/verify-deployed-release.mjs

test -f public/index.html
test -f public/css/app.css
test -f public/sw.js
python3 -c 'import ast, pathlib, sys; [ast.parse(pathlib.Path(path).read_text(), filename=path) for path in sys.argv[1:]]' \
  scripts/patch-upstream-build.py \
  scripts/write-asset-manifest.py \
  scripts/verify-asset-manifest.py

python3 scripts/verify-asset-manifest.py \
  --manifest public/vendor/versions.json \
  --lock scripts/vendor-assets.lock.json

echo "Static smoke checks passed. Engine/vendor files are checked by benchmark-local.sh."
