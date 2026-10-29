"""The enterprise patch tool's verify path and the bundle manifest helper, without Docker.

A bundle is built in a temp folder with a test keypair (openssl), packed as a .tar, and run
through `tenderos-patch verify`: good manifest passes, a tampered file fails, a signature from
another key fails, a file not in the manifest fails.
"""

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
ENTERPRISE = ROOT / "deploy" / "enterprise"
PATCH_TOOL = ENTERPRISE / "tenderos-patch"

pytestmark = pytest.mark.skipif(shutil.which("openssl") is None, reason="openssl not installed")


def load_manifest_module():
    spec = importlib.util.spec_from_file_location("tenderos_manifest", ENTERPRISE / "manifest.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


manifest = load_manifest_module()


def openssl(*args, **kw):
    return subprocess.run(["openssl", *args], check=True, capture_output=True, **kw)


def make_keypair(folder, name):
    key = folder / f"{name}.key"
    pub = folder / f"{name}.pub"
    openssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(key))
    openssl("pkey", "-in", str(key), "-pubout", "-out", str(pub))
    return key, pub


def sign(key, bundle_dir):
    openssl("dgst", "-sha256", "-sign", str(key), "-out", str(bundle_dir / "manifest.sig"), str(bundle_dir / "manifest.json"))


def make_bundle(tmp, version="9.9.9"):
    """A bundle folder with the files a real one holds (small stand-ins) and a manifest; not yet signed."""
    bundle = tmp / f"tenderos-{version}.bundle"
    (bundle / "migrations").mkdir(parents=True)
    (bundle / "images.tar").write_bytes(b"\0" * 4096)
    (bundle / "docker-compose.yml").write_text("services: {}\n")
    (bundle / "docker-compose.enterprise.yml").write_text("services: {}\n")
    (bundle / "Caddyfile").write_text(":443 {}\n")
    (bundle / "migrations" / "001_init.sql").write_text("select 1;\n")
    (bundle / "CHANGELOG.md").write_text(f"## {version}\n\n* test\n")
    (bundle / "VERSION").write_text(f"{version}\n")
    images = {"web": {"tag": f"tenderos-web:{version}", "id": "sha256:" + "a" * 64}}
    m = manifest.build_manifest(str(bundle), version, "abc123", "2026-10-29T00:00:00Z", images)
    manifest.write_manifest(str(bundle), m)
    return bundle


def pack(bundle):
    tar_path = bundle.parent / (bundle.name + ".tar")
    with tarfile.open(tar_path, "w") as tar:
        tar.add(bundle, arcname=bundle.name)
    return tar_path


def run_verify(tar_path, pub):
    env = dict(os.environ, TENDEROS_RELEASE_PUB=str(pub), TENDEROS_HOME=str(tar_path.parent))
    return subprocess.run(["bash", str(PATCH_TOOL), "verify", str(tar_path)], env=env, capture_output=True, text=True)


def test_manifest_lists_every_file_with_its_sha256(tmp_path):
    bundle = make_bundle(tmp_path)
    data = json.loads((bundle / "manifest.json").read_text())
    assert data["version"] == "9.9.9"
    assert data["commit"] == "abc123"
    assert data["built_at"] == "2026-10-29T00:00:00Z"
    assert data["product"] == "tenderos"
    assert data["images"]["web"]["tag"] == "tenderos-web:9.9.9"
    expected = {}
    for path in bundle.rglob("*"):
        if path.is_file() and path.name not in ("manifest.json", "manifest.sig"):
            expected[path.relative_to(bundle).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    assert data["files"] == expected
    assert "migrations/001_init.sql" in data["files"]
    assert "manifest.json" not in data["files"]
    assert list(data["files"]) == sorted(data["files"])
    assert manifest.check_manifest(str(bundle)) == []


def test_manifest_check_reports_tamper_and_stray_files(tmp_path):
    bundle = make_bundle(tmp_path)
    (bundle / "Caddyfile").write_text(":443 { evil }\n")
    (bundle / "extra.sh").write_text("echo hi\n")
    problems = manifest.check_manifest(str(bundle))
    assert "sha256 mismatch: Caddyfile" in problems
    assert "not in manifest: extra.sh" in problems


def test_changelog_section():
    text = "# Changelog\n\n## 1.3.0 - 2026-11-01\n\n* new\n\n## 1.2.0\n\n* old\n"
    assert manifest.changelog_section(text, "1.3.0") == "## 1.3.0 - 2026-11-01\n\n* new\n"
    assert manifest.changelog_section(text, "v1.2.0") == "## 1.2.0\n\n* old\n"
    assert manifest.changelog_section(text, "1.1.0") == ""


def test_manifest_cli_write_and_check(tmp_path):
    bundle = make_bundle(tmp_path)
    (bundle / "manifest.json").unlink()
    subprocess.run(
        [
            "python3",
            str(ENTERPRISE / "manifest.py"),
            "write",
            str(bundle),
            "--version",
            "9.9.9",
            "--commit",
            "c0ffee",
            "--image",
            "web=tenderos-web:9.9.9=sha256:" + "b" * 64,
        ],
        check=True,
        capture_output=True,
    )
    data = json.loads((bundle / "manifest.json").read_text())
    assert data["images"] == {"web": {"tag": "tenderos-web:9.9.9", "id": "sha256:" + "b" * 64}}
    assert subprocess.run(["python3", str(ENTERPRISE / "manifest.py"), "check", str(bundle)]).returncode == 0
    (bundle / "VERSION").write_text("0.0.0\n")
    assert subprocess.run(["python3", str(ENTERPRISE / "manifest.py"), "check", str(bundle)], capture_output=True).returncode == 1


def test_verify_accepts_a_good_bundle(tmp_path):
    key, pub = make_keypair(tmp_path, "release")
    bundle = make_bundle(tmp_path)
    sign(key, bundle)
    result = run_verify(pack(bundle), pub)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "bundle OK: tenderos 9.9.9" in result.stdout
    assert "image web: tenderos-web:9.9.9" in result.stdout


def test_verify_rejects_a_tampered_file(tmp_path):
    key, pub = make_keypair(tmp_path, "release")
    bundle = make_bundle(tmp_path)
    sign(key, bundle)
    (bundle / "docker-compose.yml").write_text("services: {evil: {}}\n")
    result = run_verify(pack(bundle), pub)
    assert result.returncode != 0
    assert "TAMPERED  docker-compose.yml" in result.stderr
    assert "checksum verification FAILED" in result.stderr


def test_verify_rejects_a_file_outside_the_manifest(tmp_path):
    key, pub = make_keypair(tmp_path, "release")
    bundle = make_bundle(tmp_path)
    sign(key, bundle)
    (bundle / "migrations" / "999_extra.sql").write_text("drop table users;\n")
    result = run_verify(pack(bundle), pub)
    assert result.returncode != 0
    assert "UNSIGNED  migrations/999_extra.sql" in result.stderr


def test_verify_rejects_a_bad_signature(tmp_path):
    _, pub = make_keypair(tmp_path, "release")
    other_key, _ = make_keypair(tmp_path, "other")
    bundle = make_bundle(tmp_path)
    sign(other_key, bundle)
    result = run_verify(pack(bundle), pub)
    assert result.returncode != 0
    assert "SIGNATURE INVALID" in result.stderr


def test_verify_rejects_a_manifest_edited_after_signing(tmp_path):
    key, pub = make_keypair(tmp_path, "release")
    bundle = make_bundle(tmp_path)
    sign(key, bundle)
    data = json.loads((bundle / "manifest.json").read_text())
    data["files"]["docker-compose.yml"] = "0" * 64
    (bundle / "manifest.json").write_text(json.dumps(data))
    result = run_verify(pack(bundle), pub)
    assert result.returncode != 0
    assert "SIGNATURE INVALID" in result.stderr
