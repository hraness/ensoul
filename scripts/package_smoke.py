#!/usr/bin/env python3
"""Verify one exact Ensoul npm tarball without trusting package scripts."""

import argparse
import base64
import hashlib
import json
import subprocess
import tarfile
import tempfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
MAXIMUM_FILES = 32
MAXIMUM_PACKED_BYTES = 512 * 1024
MAXIMUM_UNPACKED_BYTES = 2 * 1024 * 1024
EXPECTED_PATHS = {
    "LICENSE",
    "README.md",
    "VERSION",
    "package.json",
    "schema/ensoul-source-packet-v1.schema.json",
    "skills/ensoul/agents/openai.yaml",
    "skills/ensoul/LICENSE",
    "skills/ensoul/NOTICE.md",
    "skills/ensoul/references/ensoul-source-packet-v1.schema.json",
    "skills/ensoul/references/evidence-method.md",
    "skills/ensoul/references/output-blueprint.md",
    "skills/ensoul/references/source-packets.md",
    "skills/ensoul/scripts/prepare_x_archive.py",
    "skills/ensoul/scripts/validate_source_packet.py",
    "skills/ensoul/SKILL.md",
}


def fail(message: str) -> None:
    raise SystemExit(message)


def regular_source_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file()
        and not path.is_symlink()
        and "__pycache__" not in path.parts
        and path.suffix not in {".pyc", ".pyo"}
    )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--pack-json", required=True, type=Path)
    return parser.parse_args()


def verify_pack_receipt(archive: Path, receipt_path: Path) -> dict[str, object]:
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if not isinstance(receipt, list) or len(receipt) != 1 or not isinstance(receipt[0], dict):
        fail("npm pack receipt must contain exactly one package")
    record = receipt[0]
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    for field in ("name", "version"):
        if record.get(field) != package[field]:
            fail(f"npm pack receipt has the wrong {field}")
    if record.get("filename") != archive.name:
        fail("npm pack receipt filename does not match the reviewed archive")

    archive_bytes = archive.read_bytes()
    if record.get("size") != len(archive_bytes):
        fail("npm pack receipt size does not match the reviewed archive")
    if len(archive_bytes) > MAXIMUM_PACKED_BYTES:
        fail("npm package exceeds the packed-size limit")
    expected_shasum = hashlib.sha1(archive_bytes).hexdigest()
    expected_integrity = "sha512-" + base64.b64encode(
        hashlib.sha512(archive_bytes).digest()
    ).decode("ascii")
    if record.get("shasum") != expected_shasum or record.get("integrity") != expected_integrity:
        fail("npm pack receipt digest does not match the reviewed archive")
    return record


def add_digest_field(digest, value: bytes) -> None:
    digest.update(len(value).to_bytes(8, byteorder="big"))
    digest.update(value)


def verify_archive(archive: Path, record: dict[str, object]) -> str:
    reported_files = record.get("files")
    if not isinstance(reported_files, list):
        fail("npm pack receipt files must be a list")
    if record.get("entryCount") != len(reported_files):
        fail("npm pack receipt entry count is inconsistent")
    if not 1 <= len(reported_files) <= MAXIMUM_FILES:
        fail("npm package has an unexpected file count")

    reported_by_path: dict[str, dict[str, object]] = {}
    for value in reported_files:
        if not isinstance(value, dict) or not isinstance(value.get("path"), str):
            fail("npm pack receipt contains an invalid file record")
        path = value["path"]
        parts = PurePosixPath(path).parts
        if not parts or path.startswith("/") or any(part in {"", ".", ".."} for part in parts):
            fail("npm pack receipt contains an unsafe path")
        if path in reported_by_path:
            fail("npm pack receipt contains a duplicate path")
        reported_by_path[path] = value

    source_paths = EXPECTED_PATHS
    if set(reported_by_path) != source_paths:
        missing = sorted(source_paths - set(reported_by_path))
        extra = sorted(set(reported_by_path) - source_paths)
        fail(f"npm package inventory differs from source (missing={missing}, extra={extra})")

    unpacked_bytes = 0
    payload_digest = hashlib.sha256(b"ensoul-package-payload-v1\0")
    with tarfile.open(archive, mode="r:gz") as package_archive:
        archive_by_path: dict[str, tarfile.TarInfo] = {}
        for member in package_archive.getmembers():
            if member.isdir():
                continue
            if not member.isfile() or not member.name.startswith("package/"):
                fail("npm archive contains a non-regular or out-of-root entry")
            path = member.name.removeprefix("package/")
            if path in archive_by_path:
                fail("npm archive contains a duplicate path")
            archive_by_path[path] = member
        if set(archive_by_path) != source_paths:
            fail("npm archive inventory differs from the npm pack receipt")

        for path in sorted(archive_by_path):
            member = archive_by_path[path]
            reported = reported_by_path[path]
            if reported.get("size") != member.size:
                fail(f"npm archive size differs for {path}")
            if reported.get("mode") != 0o644 or member.mode != 0o644:
                fail(f"npm archive mode differs from the read-only data contract for {path}")
            unpacked_bytes += member.size
            stream = package_archive.extractfile(member)
            if stream is None:
                fail(f"npm archive entry cannot be read: {path}")
            packaged_bytes = stream.read()
            if path == "package.json":
                packaged_package = json.loads(packaged_bytes)
                source_package = json.loads((ROOT / path).read_text(encoding="utf-8"))
                if packaged_package != source_package:
                    fail("packed package.json differs from source metadata")
            elif packaged_bytes != (ROOT / path).read_bytes():
                fail(f"npm archive bytes differ from source: {path}")

            add_digest_field(payload_digest, path.encode("utf-8"))
            add_digest_field(payload_digest, b"regular-file")
            add_digest_field(payload_digest, member.mode.to_bytes(4, byteorder="big"))
            add_digest_field(payload_digest, member.size.to_bytes(8, byteorder="big"))
            add_digest_field(payload_digest, packaged_bytes)

    if unpacked_bytes != record.get("unpackedSize"):
        fail("npm pack receipt unpacked size is inconsistent")
    if unpacked_bytes > MAXIMUM_UNPACKED_BYTES:
        fail("npm package exceeds the unpacked-size limit")
    return payload_digest.hexdigest()


def verify_clean_install(archive: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="ensoul-package-smoke-") as temporary:
        temporary_root = Path(temporary)
        consumer = temporary_root / "consumer"
        consumer.mkdir()
        (consumer / "package.json").write_text('{"private":true}\n', encoding="utf-8")
        subprocess.run(
            [
                "npm",
                "install",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--cache",
                str(temporary_root / "npm-cache"),
                str(archive.resolve()),
            ],
            cwd=consumer,
            check=True,
            stdout=subprocess.DEVNULL,
        )
        installed_root = consumer / "node_modules" / "@hraness" / "ensoul"
        for relative in (Path("skills/ensoul"), Path("schema")):
            source_files = regular_source_files(ROOT / relative)
            installed_files = regular_source_files(installed_root / relative)
            source_names = [path.relative_to(ROOT / relative) for path in source_files]
            installed_names = [path.relative_to(installed_root / relative) for path in installed_files]
            if source_names != installed_names:
                fail(f"installed {relative.as_posix()} inventory differs from source")
            for name in source_names:
                if (ROOT / relative / name).read_bytes() != (installed_root / relative / name).read_bytes():
                    fail(f"installed bytes differ from source: {(relative / name).as_posix()}")


def main() -> None:
    arguments = parse_arguments()
    archive = arguments.archive.resolve()
    pack_json = arguments.pack_json.resolve()
    if not archive.is_file() or archive.is_symlink():
        fail("archive must be a regular non-symlink file")
    if not pack_json.is_file() or pack_json.is_symlink():
        fail("pack receipt must be a regular non-symlink file")
    record = verify_pack_receipt(archive, pack_json)
    payload_sha256 = verify_archive(archive, record)
    verify_clean_install(archive)
    print(
        json.dumps(
            {
                "files": record["entryCount"],
                "name": record["name"],
                "packedBytes": record["size"],
                "payloadSha256": payload_sha256,
                "valid": True,
                "version": record["version"],
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
