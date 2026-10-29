#!/usr/bin/env python3
"""The bundle manifest: sha256 of every file in a bundle folder, the version and the images.

Used by deploy/enterprise/build-bundle.sh (no third-party modules; the system python3 is enough).

    manifest.py write <bundle-dir> --version V --commit C [--built-at T] [--image name=tag=id ...]
    manifest.py check <bundle-dir>            # recompute the sha256s and compare (exit 1 on a mismatch)
    manifest.py changelog <CHANGELOG.md> V    # print the "## V" section of the changelog

manifest.json and manifest.sig are never listed in the manifest (the signature covers manifest.json).
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

EXCLUDED = {"manifest.json", "manifest.sig"}


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def bundle_files(bundle_dir):
    """Relative paths of every regular file under bundle_dir, sorted, minus the manifest and its signature."""
    out = []
    for root, dirs, files in os.walk(bundle_dir):
        dirs.sort()
        for name in sorted(files):
            rel = os.path.relpath(os.path.join(root, name), bundle_dir).replace(os.sep, "/")
            if rel in EXCLUDED:
                continue
            out.append(rel)
    return out


def build_manifest(bundle_dir, version, commit, built_at=None, images=None):
    """The manifest as a dict: version, built_at, commit, images {name: {tag, id}}, files {path: sha256}."""
    files = {rel: sha256_of(os.path.join(bundle_dir, rel)) for rel in bundle_files(bundle_dir)}
    return {
        "format": 1,
        "product": "tenderos",
        "version": version,
        "built_at": built_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commit": commit,
        "images": images or {},
        "files": files,
    }


def parse_images(specs):
    """--image name=tag=id, e.g. web=tenderos-web:1.2.0=sha256:abc..."""
    images = {}
    for spec in specs or []:
        parts = spec.split("=", 2)
        if len(parts) != 3:
            raise SystemExit(f"--image expects name=tag=id, got {spec!r}")
        name, tag, image_id = parts
        images[name] = {"tag": tag, "id": image_id}
    return images


def write_manifest(bundle_dir, manifest):
    path = os.path.join(bundle_dir, "manifest.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write("\n")
    return path


def check_manifest(bundle_dir):
    """Every file in the manifest present with the right sha256, and no file in the folder outside it."""
    with open(os.path.join(bundle_dir, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    problems = []
    listed = manifest.get("files", {})
    for rel, expected in sorted(listed.items()):
        path = os.path.join(bundle_dir, rel)
        if not os.path.isfile(path):
            problems.append(f"missing: {rel}")
        elif sha256_of(path) != expected:
            problems.append(f"sha256 mismatch: {rel}")
    for rel in bundle_files(bundle_dir):
        if rel not in listed:
            problems.append(f"not in manifest: {rel}")
    return problems


def changelog_section(text, version):
    """The lines of the '## <version>' heading (or '## [version]', '## version - date') up to the next '## '."""
    lines = text.splitlines()
    out = []
    taking = False
    for line in lines:
        if line.startswith("## "):
            if taking:
                break
            head = line[3:].strip().strip("[]").split()[0].strip("[]") if line[3:].strip() else ""
            taking = head in (version, version.lstrip("v")) or head.lstrip("v") == version.lstrip("v")
        if taking:
            out.append(line)
    return "\n".join(out).rstrip() + "\n" if out else ""


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("write")
    w.add_argument("bundle_dir")
    w.add_argument("--version", required=True)
    w.add_argument("--commit", required=True)
    w.add_argument("--built-at")
    w.add_argument("--image", action="append", help="name=tag=id, repeatable")
    c = sub.add_parser("check")
    c.add_argument("bundle_dir")
    g = sub.add_parser("changelog")
    g.add_argument("changelog")
    g.add_argument("version")
    args = p.parse_args(argv)

    if args.cmd == "write":
        manifest = build_manifest(args.bundle_dir, args.version, args.commit, args.built_at, parse_images(args.image))
        print(write_manifest(args.bundle_dir, manifest))
        return 0
    if args.cmd == "check":
        problems = check_manifest(args.bundle_dir)
        for line in problems:
            print(line, file=sys.stderr)
        return 1 if problems else 0
    if args.cmd == "changelog":
        with open(args.changelog, encoding="utf-8") as f:
            section = changelog_section(f.read(), args.version)
        sys.stdout.write(section or f"No changelog entry for {args.version}.\n")
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
