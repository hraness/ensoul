import io
import json
import re
import tarfile
import tempfile
import unittest
from pathlib import Path

from scripts import package_smoke


ROOT = Path(__file__).resolve().parents[1]
STABLE_VERSION = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")


class DistributionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        cls.version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()

    def test_release_identity_is_synchronized(self) -> None:
        self.assertRegex(self.version, STABLE_VERSION)
        self.assertEqual(self.package["name"], "@hraness/ensoul")
        self.assertEqual(self.package["version"], self.version)
        self.assertFalse(self.package["private"])
        self.assertEqual(
            self.package["repository"]["url"],
            "git+https://github.com/hraness/ensoul.git",
        )
        self.assertEqual(
            self.package["publishConfig"],
            {"access": "public", "registry": "https://registry.npmjs.org"},
        )

    def test_package_inventory_is_explicit(self) -> None:
        self.assertEqual(
            self.package["files"],
            [
                "LICENSE",
                "README.md",
                "VERSION",
                "schema",
                "skills/ensoul/agents",
                "skills/ensoul/LICENSE",
                "skills/ensoul/NOTICE.md",
                "skills/ensoul/references",
                "skills/ensoul/scripts/*.py",
                "skills/ensoul/SKILL.md",
            ],
        )
        self.assertNotIn("scripts", self.package)
        self.assertNotIn("dependencies", self.package)
        self.assertNotIn("devDependencies", self.package)

    def test_only_ensoul_is_a_public_skill(self) -> None:
        public_entrypoints = [
            path.relative_to(ROOT).as_posix()
            for path in sorted((ROOT / "skills").glob("**/SKILL.md"))
        ]
        self.assertEqual(public_entrypoints, ["skills/ensoul/SKILL.md"])

    def test_repository_support_skills_are_internal(self) -> None:
        internal_entrypoints = sorted((ROOT / ".agents" / "skills").glob("*/SKILL.md"))
        self.assertEqual(len(internal_entrypoints), 5)
        for path in internal_entrypoints:
            frontmatter = path.read_text(encoding="utf-8").split("---", 2)[1]
            self.assertIn("metadata:\n  internal: true", frontmatter, path.as_posix())

    def test_readme_names_live_install_surfaces(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("https://skills.sh/hraness/ensoul/ensoul", readme)
        self.assertIn(
            f"npx skills add hraness/ensoul#v{self.version} --skill ensoul",
            readme,
        )
        self.assertIn(
            f"bunx skills add hraness/ensoul#v{self.version} --skill ensoul",
            readme,
        )
        self.assertIn(f"@hraness/ensoul@{self.version}", readme)
        self.assertIn("node_modules/@hraness/ensoul/skills/ensoul/", readme)

    def test_release_requires_public_npm_and_immutability_before_write(self) -> None:
        workflow = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
        self.assertIn('npm pack "$package_name@$package_version"', workflow)
        self.assertIn('source_payload_sha256', workflow)
        self.assertIn('registry_payload_sha256', workflow)
        self.assertNotIn('cmp --silent', workflow)
        immutable_preflight = workflow.index("Require immutable releases before publication")
        release_write = workflow.index('gh release create "$GITHUB_REF_NAME"')
        self.assertLess(immutable_preflight, release_write)

    def test_payload_digest_ignores_container_metadata_but_not_content(self) -> None:
        source_paths = sorted(package_smoke.EXPECTED_PATHS)

        def build_archive(path: Path, *, reverse: bool, mutate: bool = False) -> dict[str, object]:
            records = []
            unpacked_size = 0
            ordered_paths = list(reversed(source_paths)) if reverse else source_paths
            with tarfile.open(path, mode="w:gz") as archive:
                for index, relative in enumerate(ordered_paths):
                    content = (ROOT / relative).read_bytes()
                    if mutate and relative == "skills/ensoul/NOTICE.md":
                        content = content[:-1] + bytes([content[-1] ^ 1])
                    member = tarfile.TarInfo(f"package/{relative}")
                    member.mode = 0o644
                    member.size = len(content)
                    member.mtime = 1_000 + index
                    member.uid = 1_000 + index
                    member.gid = 2_000 + index
                    archive.addfile(member, io.BytesIO(content))
                    records.append({"mode": 0o644, "path": relative, "size": len(content)})
                    unpacked_size += len(content)
            return {
                "entryCount": len(records),
                "files": records,
                "unpackedSize": unpacked_size,
            }

        with tempfile.TemporaryDirectory() as temporary:
            temporary_root = Path(temporary)
            first = temporary_root / "first.tgz"
            second = temporary_root / "second.tgz"
            mutated = temporary_root / "mutated.tgz"
            first_record = build_archive(first, reverse=False)
            second_record = build_archive(second, reverse=True)
            mutated_record = build_archive(mutated, reverse=True, mutate=True)

            self.assertNotEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(
                package_smoke.verify_archive(first, first_record),
                package_smoke.verify_archive(second, second_record),
            )
            with self.assertRaisesRegex(SystemExit, "bytes differ from source"):
                package_smoke.verify_archive(mutated, mutated_record)

    def test_future_npm_delivery_uses_trusted_staging(self) -> None:
        workflow = (ROOT / ".github/workflows/npm-stage.yml").read_text(encoding="utf-8")
        self.assertIn("id-token: write", workflow)
        self.assertIn('npm stage publish "$tarball"', workflow)
        self.assertNotIn("NODE_AUTH_TOKEN", workflow)
        self.assertNotIn("npm publish ", workflow)


if __name__ == "__main__":
    unittest.main()
