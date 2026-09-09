"""Build a deterministic, manifest-verified Kall source archive for CodeBuild."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipInfo

INCLUDED_PREFIXES = ("backend/", "migrations/", "apps/web/", "deploy/certs/")
INCLUDED_FILES = {"Dockerfile.api", "pyproject.toml", "alembic.ini"}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args])


def write_deterministic_entry(archive: zipfile.ZipFile, name: str, body: bytes) -> None:
    info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--commit", default="HEAD")
    args = parser.parse_args()

    # The archive is materialized with `git show` from the selected commit, so
    # unrelated untracked local evidence can never enter it. Refuse tracked
    # staged or unstaged changes because those are the only changes that could
    # make an operator mistake the checkout for the reviewed commit.
    if git("status", "--porcelain", "--untracked-files=no").strip():
        raise SystemExit("Refusing to package a working tree with uncommitted tracked changes")

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
    with zipfile.ZipFile(args.output, "w") as archive:
        for name, body in files.items():
            write_deterministic_entry(archive, name, body)
        write_deterministic_entry(archive, ".aws-rebuild/manifest.json", manifest_body)

    print(json.dumps({"archive": str(args.output.resolve()), "commit": commit, "source_sha256": digest}))


if __name__ == "__main__":
    main()
