from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "skills" / "ensoul" / "scripts" / "prepare_x_archive.py"
SPEC = importlib.util.spec_from_file_location("prepare_x_archive", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
sys.modules["prepare_x_archive"] = MODULE
VALIDATOR_SCRIPT = ROOT / "skills" / "ensoul" / "scripts" / "validate_source_packet.py"
VALIDATOR_SPEC = importlib.util.spec_from_file_location("validate_source_packet", VALIDATOR_SCRIPT)
assert VALIDATOR_SPEC and VALIDATOR_SPEC.loader
VALIDATOR = importlib.util.module_from_spec(VALIDATOR_SPEC)
VALIDATOR_SPEC.loader.exec_module(VALIDATOR)


def wrapper(name: str, value: object) -> str:
    return f"window.YTD.{name}.part0 = " + json.dumps(value)


class PrepareXArchiveTest(unittest.TestCase):
    def test_vendored_skill_schema_matches_canonical_schema(self) -> None:
        canonical = ROOT / "schema" / "ensoul-source-packet-v1.schema.json"
        skill_copy = ROOT / "skills" / "ensoul" / "references" / "ensoul-source-packet-v1.schema.json"
        self.assertEqual(canonical.read_bytes(), skill_copy.read_bytes())

    def make_archive(self, root: Path) -> Path:
        archive = root / "twitter.zip"
        posts = [
            {
                "tweet": {
                    "id_str": "1",
                    "created_at": "Mon Jan 01 12:00:00 +0000 2024",
                    "full_text": "first public post",
                }
            },
            {
                "tweet": {
                    "id_str": "2",
                    "created_at": "Tue Jan 02 12:00:00 +0000 2024",
                    "full_text": "RT @someone: quoted third-party prose",
                }
            },
            {
                "tweet": {
                    "id_str": "3",
                    "created_at": "Wed Jan 03 12:00:00 +0000 2024",
                    "full_text": "a reply",
                    "in_reply_to_status_id_str": "99",
                }
            },
        ]
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
            zipped.writestr("data/tweets.js", wrapper("tweets", posts))
            zipped.writestr("data/direct-messages.js", "PRIVATE_DM_CANARY")
            zipped.writestr("data/ad-engagements.js", "PRIVATE_AD_CANARY")
        return archive

    def test_builds_bounded_subject_relative_packet_without_private_members(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            archive = self.make_archive(root)
            output = root / "posts.ensoul-source.json"
            result = MODULE.main([str(archive), "--output", str(output), "--limit", "2"])
            self.assertEqual(result, 0)
            packet = json.loads(output.read_text())
            self.assertEqual(packet["schemaVersion"], "ensoul.source-packet.v1")
            self.assertEqual(packet["digestCanonicalization"], "JCS-RFC8785")
            self.assertEqual(packet["scope"]["payloadSchema"], "ensoul.x-authored-posts-source.v1")
            self.assertEqual(len(packet["records"]), 2)
            self.assertEqual(packet["records"][0]["authorRole"], "subject")
            self.assertEqual(packet["records"][0]["contentRole"], "original")
            self.assertEqual(packet["records"][0]["authorshipConfidence"], "strong")
            self.assertEqual(packet["records"][0]["sentStatus"], "published")
            self.assertEqual(packet["scope"]["limits"]["selectedMembers"], 1)
            self.assertEqual(packet["scope"]["limits"]["inputRecords"], 3)
            self.assertEqual(packet["scope"]["limits"]["malformedRecordsSkipped"], 0)
            self.assertEqual(packet["scope"]["limits"]["exactDuplicateRecordsSkipped"], 0)
            packet_without_digest = dict(packet)
            packet_digest = packet_without_digest.pop("packetDigest")
            self.assertEqual(
                packet_digest,
                "sha256:" + MODULE.sha256_hex(MODULE.canonical_bytes(packet_without_digest)),
            )
            for record in packet["records"]:
                record_without_digest = dict(record)
                record_digest = record_without_digest.pop("digest")
                self.assertEqual(
                    record_digest,
                    "sha256:" + MODULE.sha256_hex(MODULE.canonical_bytes(record_without_digest)),
                )
                self.assertEqual(
                    record["provenance"]["contentSha256"],
                    MODULE.sha256_hex(MODULE.canonical_bytes(record["content"])),
                )
            serialized = json.dumps(packet)
            self.assertNotIn("PRIVATE_DM_CANARY", serialized)
            self.assertNotIn("PRIVATE_AD_CANARY", serialized)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            receipt = VALIDATOR.validate_file(output)
            self.assertTrue(receipt["valid"])
            self.assertEqual(receipt["records"], 2)

    def test_marks_reposts_mixed_and_rejects_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            archive = self.make_archive(root)
            output = root / "posts.ensoul-source.json"
            self.assertEqual(MODULE.main([str(archive), "--output", str(output), "--limit", "3"]), 0)
            packet = json.loads(output.read_text())
            repost = next(record for record in packet["records"] if record["kind"] == "repost")
            self.assertEqual(repost["authorRole"], "mixed")
            self.assertEqual(repost["contentRole"], "forwarded")
            self.assertEqual(MODULE.main([str(archive), "--output", str(output)]), 2)

    def test_rejects_a_limit_above_the_packet_record_cap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            archive = self.make_archive(root)
            output = root / "posts.ensoul-source.json"
            self.assertEqual(
                MODULE.main([str(archive), "--output", str(output), "--limit", "2001"]),
                2,
            )
            self.assertFalse(output.exists())

    def test_bounds_multibyte_and_escaped_content_by_emitted_bytes(self) -> None:
        content = MODULE.bounded_content(("\u0000\U0001f642" * 20_000) + "tail")
        self.assertTrue(content["truncated"])
        self.assertLessEqual(
            len(MODULE.canonical_bytes(content)),
            MODULE.MAX_RECORD_CONTENT_BYTES,
        )

    def test_refuses_to_emit_a_packet_over_the_validator_file_cap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            archive = self.make_archive(root)
            output = root / "posts.ensoul-source.json"
            original = MODULE.MAX_PACKET_BYTES
            MODULE.MAX_PACKET_BYTES = 128
            try:
                self.assertEqual(MODULE.main([str(archive), "--output", str(output)]), 2)
            finally:
                MODULE.MAX_PACKET_BYTES = original
            self.assertFalse(output.exists())

    def test_rejects_future_dated_evidence_before_emitting(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            archive = root / "future.zip"
            posts = [{"tweet": {
                "id_str": "999",
                "created_at": "Mon Jan 01 12:00:00 +0000 2999",
                "full_text": "future-dated evidence",
            }}]
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
                zipped.writestr("data/tweets.js", wrapper("tweets", posts))
            output = root / "posts.ensoul-source.json"
            self.assertEqual(MODULE.main([str(archive), "--output", str(output)]), 2)
            self.assertFalse(output.exists())

    def test_marks_malformed_foreign_ids_as_a_bounded_omission(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            archive = root / "foreign-id.zip"
            posts = [
                {"tweet": {"id_str": "valid-looking-but-foreign", "created_at": "2024-01-01T00:00:00Z", "full_text": "skip me"}},
                {"tweet": {"id_str": "123", "created_at": "2024-01-02T00:00:00Z", "full_text": "keep me"}},
            ]
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
                zipped.writestr("data/tweets.js", wrapper("tweets", posts))
            output = root / "posts.ensoul-source.json"
            self.assertEqual(MODULE.main([str(archive), "--output", str(output)]), 0)
            packet = json.loads(output.read_text())
            self.assertEqual(packet["scope"]["completeness"], "bounded")
            self.assertEqual(packet["scope"]["limits"]["malformedRecordsSkipped"], 1)

    def test_rejects_conflicting_duplicate_post_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            archive = root / "conflict.zip"
            posts = [
                {"tweet": {"id_str": "123", "created_at": "2024-01-01T00:00:00Z", "full_text": "first"}},
                {"tweet": {"id_str": "123", "created_at": "2024-01-01T00:00:00Z", "full_text": "conflict"}},
            ]
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
                zipped.writestr("data/tweets.js", wrapper("tweets", posts))
            output = root / "posts.ensoul-source.json"
            self.assertEqual(MODULE.main([str(archive), "--output", str(output)]), 2)
            self.assertFalse(output.exists())

    def test_rejects_traversal_even_when_unselected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            archive = root / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr("data/tweets.js", wrapper("tweets", []))
                zipped.writestr("../escape", "x")
            output = root / "packet.json"
            self.assertEqual(MODULE.main([str(archive), "--output", str(output)]), 2)
            self.assertFalse(output.exists())

    def source_packet(self, adapter: str) -> dict[str, object]:
        is_message = adapter == "message-like-me"
        content = {"text": "synthetic evidence", "truncated": False}
        record_base: dict[str, object] = {
            "id": f"{adapter}:record:1",
            "kind": "message" if is_message else "web_evidence",
            "occurredAt" if is_message else "observedAt": "2026-08-20T12:00:00Z",
            "authorRole": "subject" if is_message else "unknown",
            "contentRole": "original" if is_message else "summary",
            "authorshipConfidence": "strong" if is_message else "unknown",
            "sentStatus": "sent" if is_message else "published",
            "visibility": "private" if is_message else "public",
            "sourceClass": "private_capture" if is_message else "public_web_evidence",
            "content": content,
            "provenance": {
                "provider": adapter,
                "operation": "synthetic-test",
                "contentSha256": MODULE.sha256_hex(MODULE.canonical_bytes(content)),
            },
        }
        record = dict(record_base)
        record["digest"] = "sha256:" + MODULE.sha256_hex(MODULE.canonical_bytes(record_base))
        packet_base: dict[str, object] = {
            "schemaVersion": "ensoul.source-packet.v1",
            "digestCanonicalization": "JCS-RFC8785",
            "packetId": f"synthetic:{adapter}",
            "generatedAt": "2026-08-21T12:00:00Z",
            "subject": {
                "localId": "synthetic-subject",
                "kind": "owner" if is_message else "person",
                "identityBasis": "synthetic fixture",
            },
            "scope": {
                "adapter": adapter,
                "payloadSchema": "ensoul.messages-source.v1" if is_message else "ensoul.public-enrichment-source.v1",
                "asOf": "2026-08-21T12:00:00Z",
                "completeness": "bounded",
                "limits": {
                    "recordLimit": 1,
                    **({"services": ["SMS", "iMessage"]} if adapter == "peopleblade" else {}),
                },
            },
            "records": [record],
            "claims": [],
            "limitations": ["synthetic fixture"],
        }
        packet = dict(packet_base)
        packet["packetDigest"] = "sha256:" + MODULE.sha256_hex(MODULE.canonical_bytes(packet_base))
        return packet

    def redigest_packet(self, packet: dict[str, object], *, records: bool = False) -> None:
        if records:
            for raw_record in packet["records"]:  # type: ignore[index]
                record = raw_record  # type: ignore[assignment]
                record_without_digest = dict(record)
                record_without_digest.pop("digest")
                record["digest"] = "sha256:" + MODULE.sha256_hex(
                    MODULE.canonical_bytes(record_without_digest)
                )
        packet_without_digest = dict(packet)
        packet_without_digest.pop("packetDigest")
        packet["packetDigest"] = "sha256:" + MODULE.sha256_hex(
            MODULE.canonical_bytes(packet_without_digest)
        )

    def test_dependency_free_validator_accepts_cross_producer_packets(self) -> None:
        for adapter in ("message-like-me", "peopleblade"):
            with self.subTest(adapter=adapter):
                receipt = VALIDATOR.validate_packet(self.source_packet(adapter))
                self.assertTrue(receipt["valid"])
                self.assertEqual(receipt["adapter"], adapter)

    def test_validator_does_not_mutate_an_installed_skill_with_bytecode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            scripts = root / "scripts"
            scripts.mkdir()
            shutil.copy2(SCRIPT, scripts / SCRIPT.name)
            shutil.copy2(VALIDATOR_SCRIPT, scripts / VALIDATOR_SCRIPT.name)
            packet_path = root / "packet.json"
            packet_path.write_text(json.dumps(self.source_packet("peopleblade")), encoding="utf-8")
            environment = dict(os.environ)
            environment.pop("PYTHONDONTWRITEBYTECODE", None)
            result = subprocess.run(
                [sys.executable, str(scripts / VALIDATOR_SCRIPT.name), str(packet_path)],
                check=False,
                capture_output=True,
                env=environment,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((scripts / "__pycache__").exists())

    def test_dependency_free_validator_rejects_tampering_and_duplicate_keys(self) -> None:
        packet = self.source_packet("message-like-me")
        packet["records"][0]["content"]["text"] = "tampered"  # type: ignore[index]
        with self.assertRaisesRegex(VALIDATOR.PacketValidationError, "content digest mismatch"):
            VALIDATOR.validate_packet(packet)
        duplicate = b'{"schemaVersion":"ensoul.source-packet.v1","schemaVersion":"other"}'
        with self.assertRaisesRegex(VALIDATOR.PacketValidationError, "duplicate object member"):
            VALIDATOR.strict_json_loads(duplicate)

    def test_dependency_free_validator_rejects_invalid_claim_binding(self) -> None:
        packet = self.source_packet("peopleblade")
        packet["claims"] = [{  # type: ignore[index]
            "id": "claim:1",
            "text": "synthetic claim",
            "recordIds": ["missing-record"],
            "status": "adapter_structured",
            "claimantRole": "adapter",
            "claimKind": "derived_index",
            "subjectLocalId": "synthetic-subject",
            "sensitivity": "ordinary",
        }]
        packet_without_digest = dict(packet)
        packet_without_digest.pop("packetDigest")
        packet["packetDigest"] = "sha256:" + MODULE.sha256_hex(MODULE.canonical_bytes(packet_without_digest))
        with self.assertRaisesRegex(VALIDATOR.PacketValidationError, "unknown record"):
            VALIDATOR.validate_packet(packet)

    def test_dependency_free_validator_rejects_inverted_empty_bounds(self) -> None:
        packet = self.source_packet("peopleblade")
        packet["records"] = []
        packet["scope"]["limits"] = {  # type: ignore[index]
            "afterInclusive": "2026-08-21T00:00:00Z",
            "beforeExclusive": "2026-08-20T00:00:00Z",
        }
        self.redigest_packet(packet)
        with self.assertRaisesRegex(VALIDATOR.PacketValidationError, "lower bound must be earlier"):
            VALIDATOR.validate_packet(packet)

    def test_dependency_free_validator_rejects_conflicting_bound_aliases(self) -> None:
        packet = self.source_packet("message-like-me")
        packet["scope"]["limits"] = {  # type: ignore[index]
            "after": "2026-08-01T00:00:00Z",
            "afterInclusive": "2026-08-02T00:00:00Z",
        }
        self.redigest_packet(packet)
        with self.assertRaisesRegex(VALIDATOR.PacketValidationError, "two lower-bound aliases"):
            VALIDATOR.validate_packet(packet)

    def test_dependency_free_validator_rejects_evidence_after_cutoffs(self) -> None:
        for key, cutoff in (
            ("asOf", "2026-08-19T12:00:00Z"),
            ("sourceCutoff", "2026-08-19T12:00:00Z"),
        ):
            with self.subTest(key=key):
                packet = self.source_packet("peopleblade")
                packet["scope"][key] = cutoff  # type: ignore[index]
                self.redigest_packet(packet)
                with self.assertRaisesRegex(VALIDATOR.PacketValidationError, key):
                    VALIDATOR.validate_packet(packet)

    def test_dependency_free_validator_rejects_inverted_record_times(self) -> None:
        packet = self.source_packet("peopleblade")
        record = packet["records"][0]  # type: ignore[index]
        record["occurredAt"] = "2026-08-20T13:00:00Z"  # type: ignore[index]
        self.redigest_packet(packet, records=True)
        with self.assertRaisesRegex(VALIDATOR.PacketValidationError, "occurredAt must not be later"):
            VALIDATOR.validate_packet(packet)

    def test_dependency_free_validator_rejects_inverted_scope_times(self) -> None:
        cases = (
            ({"asOf": "2026-08-22T12:00:00Z"}, "later than generatedAt"),
            ({"sourceCutoff": "2026-08-22T12:00:00Z"}, "later than generatedAt"),
            (
                {
                    "asOf": "2026-08-21T10:00:00Z",
                    "sourceCutoff": "2026-08-21T11:00:00Z",
                },
                "later than scope.asOf",
            ),
        )
        for overrides, expected in cases:
            with self.subTest(overrides=overrides):
                packet = self.source_packet("message-like-me")
                packet["scope"].update(overrides)  # type: ignore[index]
                self.redigest_packet(packet)
                with self.assertRaisesRegex(VALIDATOR.PacketValidationError, expected):
                    VALIDATOR.validate_packet(packet)


if __name__ == "__main__":
    unittest.main()
