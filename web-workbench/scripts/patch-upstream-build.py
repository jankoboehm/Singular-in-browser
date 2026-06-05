#!/usr/bin/env python3
"""Patch PR #1360's Emscripten build script for the browser workbench.

The PR's web demo already produces Singular.js/Singular.wasm/Singular.data.  The
workbench uses Web Workers, local workspace mirroring, and batch execution, so it
is helpful to make the final Emscripten link explicit about filesystem/runtime
availability and the browser/worker environment.

This script is deliberately idempotent. Set PATCH_BUILD=0 when running
build-full-wasm.sh to skip it.
"""
from __future__ import annotations

from pathlib import Path

WORKBENCH = Path(__file__).resolve().parents[1]
REPO_ROOT = WORKBENCH.parents[1]
BUILD_SH = REPO_ROOT / "emscripten" / "build.sh"

FLAGS = [
    "-s FORCE_FILESYSTEM=1",
    "-s EXPORTED_RUNTIME_METHODS='[\"FS\",\"TTY\",\"PATH\",\"callMain\",\"ccall\",\"cwrap\"]'",
    "-s ENVIRONMENT=web,worker",
    "-s EXIT_RUNTIME=1",
]


def main() -> None:
    if not BUILD_SH.exists():
        raise SystemExit(f"missing PR #1360 build script: {BUILD_SH}")

    text = BUILD_SH.read_text()
    original = text

    # The workbench loads Singular.js directly. Emscripten's .html output also
    # emits .js/.wasm/.data, but using .js as the named output avoids producing
    # an unused HTML shell and makes the generated artifact intent explicit.
    text = text.replace("-o Singular.html", "-o Singular.js")

    marker = "--preload-file ../doc@/info"
    if marker not in text:
        raise SystemExit("could not find final em++ preload marker in emscripten/build.sh")

    for flag in FLAGS:
        if flag not in text:
            text = text.replace(marker, f"{marker} \\\n  {flag}")

    if text != original:
        BUILD_SH.write_text(text)
        print(f"patched {BUILD_SH}")
    else:
        print(f"{BUILD_SH} already patched")


if __name__ == "__main__":
    main()
