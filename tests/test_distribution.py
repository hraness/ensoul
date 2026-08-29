import json
import re
import unittest
from pathlib import Path


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
        self.assertIn("https://skills.sh/hraness/ensoul", readme)
        self.assertIn(f"npx skills add hraness/ensoul#v{self.version}", readme)
        self.assertIn(f"@hraness/ensoul@{self.version}", readme)
        self.assertIn("node_modules/@hraness/ensoul/skills/ensoul/", readme)

    def test_release_requires_public_npm_and_immutability_before_write(self) -> None:
        workflow = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
        self.assertIn('npm pack "$package_name@$package_version"', workflow)
        immutable_preflight = workflow.index("Require immutable releases before publication")
        release_write = workflow.index('gh release create "$GITHUB_REF_NAME"')
        self.assertLess(immutable_preflight, release_write)

    def test_future_npm_delivery_uses_trusted_staging(self) -> None:
        workflow = (ROOT / ".github/workflows/npm-stage.yml").read_text(encoding="utf-8")
        self.assertIn("id-token: write", workflow)
        self.assertIn('npm stage publish "$tarball"', workflow)
        self.assertNotIn("NODE_AUTH_TOKEN", workflow)
        self.assertNotIn("npm publish ", workflow)


if __name__ == "__main__":
    unittest.main()
