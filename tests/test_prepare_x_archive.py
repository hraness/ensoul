from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "skills" / "ensoul" / "scripts" / "prepare_x_archive.py"
SPEC = importlib.util.spec_from_file_location("prepare_x_archive", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


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


if __name__ == "__main__":
    unittest.main()
