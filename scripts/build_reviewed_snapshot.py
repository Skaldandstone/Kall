"""Build a deterministic, manifest-verified Kall source archive for CodeBuild."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

INCLUDED_PREFIXES = ("backend/", "migrations/", "apps/web/")
INCLUDED_FILES = {"Dockerfile.api", "pyproject.toml", "alembic.ini"}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--commit", default="HEAD")
    args = parser.parse_args()

    if git("status", "--porcelain").strip():
        raise SystemExit("Refusing to package an uncommitted working tree")

    commit = git("rev-parse", "--verify", f"{args.commit}^{{commit}}").decode().strip()
    names = git("ls-tree", "-r", "--name-only", "-z", commit).decode().split("\0")
    selected = sorted(
        name for name in names
        if name and (name in INCLUDED_FILES or name.startswith(INCLUDED_PREFIXES))
    )
    files: dict[str, bytes] = {
        name: git("show", f"{commit}:{name}")
        for name in selected
    }
    manifest = {
        "application": "kall",
        "commit": commit,
        "files": {
            name: hashlib.sha256(body).hexdigest()
            for name, body in files.items()
        },
    }
    manifest_body = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    digest = hashlib.sha256(manifest_body).hexdigest()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, body in files.items():
            archive.writestr(name, body)
        archive.writestr(".aws-rebuild/manifest.json", manifest_body)

    print(json.dumps({"archive": str(args.output.resolve()), "commit": commit, "source_sha256": digest}))


if __name__ == "__main__":
    main()
