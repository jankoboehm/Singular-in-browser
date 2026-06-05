#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def digest(path: Path, algorithm: str) -> str:
    h = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_package(value: str) -> tuple[str, str]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("packages must be NAME=VERSION")
    name, version = value.split("=", 1)
    return name, version


def parse_metadata(value: str) -> tuple[str, str]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("metadata must be KEY=VALUE")
    key, metadata_value = value.split("=", 1)
    if not key:
        raise argparse.ArgumentTypeError("metadata key must not be empty")
    return key, metadata_value


RESERVED_MANIFEST_KEYS = {"format", "name", "source", "generatedAt", "packages", "assets"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Write a checksum manifest for browser-loaded assets.")
    parser.add_argument("--base", required=True, help="Base directory for asset paths.")
    parser.add_argument("--output", required=True, help="Manifest JSON path.")
    parser.add_argument("--name", default="Singular browser assets")
    parser.add_argument("--source", default="")
    parser.add_argument("--package", action="append", type=parse_package, default=[])
    parser.add_argument("--metadata", action="append", type=parse_metadata, default=[])
    parser.add_argument("--asset", action="append", default=[])
    parser.add_argument("--allow-missing", action="store_true")
    args = parser.parse_args()

    for key, _ in args.metadata:
        if key in RESERVED_MANIFEST_KEYS:
            raise SystemExit(f"metadata key is reserved: {key}")

    base = Path(args.base).resolve()
    output = Path(args.output).resolve()
    assets: dict[str, dict[str, object]] = {}

    for rel in args.asset:
        path = (base / rel).resolve()
        if not path.exists():
            if args.allow_missing:
                continue
            raise SystemExit(f"missing asset: {path}")
        if not path.is_file():
            raise SystemExit(f"not a file: {path}")
        try:
            rel_path = path.relative_to(base).as_posix()
        except ValueError as exc:
            raise SystemExit(f"asset is outside base directory: {path}") from exc
        assets[rel_path] = {
            "bytes": path.stat().st_size,
            "sha256": digest(path, "sha256"),
            "sha384": digest(path, "sha384"),
        }

    if not assets:
        raise SystemExit("no assets were written to the manifest")

    manifest = {
        "format": "singular-browser-workbench.asset-manifest.v1",
        "name": args.name,
        "source": args.source,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "packages": dict(args.package),
        "assets": assets,
    }
    manifest.update(dict(args.metadata))

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
