#!/usr/bin/env python3
"""Zip the extension for a Chrome Web Store upload.

Includes only what Chrome loads. Development files — tests, generators, store
artwork, git — are left out, both to keep the package small and to avoid a
reviewer asking what a Python file is doing in a browser extension.

    python3 tools/pack.py            # writes tab-dedupe-<version>.zip
"""

import json
import pathlib
import zipfile

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

INCLUDE_FILES = ["manifest.json", "background.js", "popup.html", "popup.css", "popup.js",
                 "options.html", "options.css", "options.js", "PRIVACY_POLICY.md", "LICENSE"]
INCLUDE_DIRS = ["lib", "icons"]


def main():
    version = json.loads((REPO_ROOT / "manifest.json").read_text())["version"]
    out = REPO_ROOT / f"tab-dedupe-{version}.zip"

    members = []
    for name in INCLUDE_FILES:
        path = REPO_ROOT / name
        if not path.exists():
            raise SystemExit(f"missing required file: {name}")
        members.append(path)
    for name in INCLUDE_DIRS:
        members.extend(sorted(p for p in (REPO_ROOT / name).rglob("*") if p.is_file()))

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in members:
            zf.write(path, path.relative_to(REPO_ROOT))

    print(f"wrote {out.name} ({out.stat().st_size:,} bytes, {len(members)} files)")
    for path in members:
        print(f"  {path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
