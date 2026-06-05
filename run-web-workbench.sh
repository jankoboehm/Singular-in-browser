#!/usr/bin/env bash
set -euo pipefail

# Serve the browser workbench from this split repository. Build or copy the
# engine files into web-workbench/public/engine first.

PORT="${PORT:-9999}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${ROOT_DIR}"

bash web-workbench/scripts/fetch-web-deps.sh
python3 web-workbench/scripts/serve-local.py --port "${PORT}"
