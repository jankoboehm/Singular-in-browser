#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


CHECKED_ASSET_FIELDS = ("bytes", "sha256", "sha384")


def load_json(path: str) -> dict:
    return json.loads(Path(path).read_text())


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify an asset manifest against a checked-in lock file.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--lock", required=True)
    args = parser.parse_args()

    manifest = load_json(args.manifest)
    lock = load_json(args.lock)

    if manifest.get("format") != lock.get("format"):
        raise SystemExit("manifest format does not match asset lock")
    if manifest.get("packages") != lock.get("packages"):
        raise SystemExit("manifest package versions do not match asset lock")

    manifest_assets = manifest.get("assets") or {}
    locked_assets = lock.get("assets") or {}
    if set(manifest_assets) != set(locked_assets):
        raise SystemExit("manifest asset set does not match asset lock")

    for rel_path, expected in sorted(locked_assets.items()):
        actual = manifest_assets[rel_path]
        for field in CHECKED_ASSET_FIELDS:
            if actual.get(field) != expected.get(field):
                raise SystemExit(f"{rel_path} {field} does not match asset lock")

    print(f"Verified {len(locked_assets)} browser asset(s) against {args.lock}")


if __name__ == "__main__":
    main()
