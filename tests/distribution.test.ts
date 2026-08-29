import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { EXPECTED_PATHS } from "../scripts/package-smoke.ts";
import { violations } from "../scripts/check-runtime-policy.ts";

const ROOT = resolve(import.meta.dir, "..");
const package_ = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, any>;
const version = readFileSync(join(ROOT, "VERSION"), "utf8").trim();

describe("distribution identity", () => {
  test("synchronizes stable release identity and Bun policy", () => {
    expect(version).toMatch(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u);
    expect(package_).toMatchObject({
      name: "@hraness/ensoul",
      version,
      private: false,
      type: "module",
      packageManager: "bun@1.3.14",
      engines: { bun: ">=1.3.14" },
      repository: { type: "git", url: "git+https://github.com/hraness/ensoul.git" },
      publishConfig: { access: "public", registry: "https://registry.npmjs.org" },
    });
    expect(package_.dependencies).toBeUndefined();
    expect(package_.optionalDependencies).toBeUndefined();
    expect(package_.peerDependencies).toBeUndefined();
    for (const lifecycle of ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"]) {
      expect(package_.scripts[lifecycle]).toBeUndefined();
    }
  });

  test("uses an explicit package inventory", () => {
    expect(package_.files).toEqual([
      "LICENSE",
      "README.md",
      "VERSION",
      "schema",
      "skills/ensoul/agents",
      "skills/ensoul/LICENSE",
      "skills/ensoul/NOTICE.md",
      "skills/ensoul/references",
      "skills/ensoul/scripts/*.ts",
      "skills/ensoul/SKILL.md",
    ]);
    expect(EXPECTED_PATHS.size).toBe(17);
  });

  test("publishes exactly one marketplace skill", async () => {
    const found: string[] = [];
    for await (const path of new Bun.Glob("**/SKILL.md").scan({ cwd: join(ROOT, "skills"), onlyFiles: true })) {
      found.push(`skills/${path}`);
    }
    expect(found.sort()).toEqual(["skills/ensoul/SKILL.md"]);
  });

  test("keeps repository support skills internal", async () => {
    const found: string[] = [];
    for await (const path of new Bun.Glob("*/SKILL.md").scan({ cwd: join(ROOT, ".agents/skills"), onlyFiles: true })) {
      found.push(path);
    }
    expect(found).toHaveLength(5);
    for (const path of found) {
      const frontmatter = readFileSync(join(ROOT, ".agents/skills", path), "utf8").split("---", 3)[1];
      expect(frontmatter).toContain("metadata:\n  internal: true");
    }
  });

  test("documents the official marketplace badge and release-pinned installs", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain("[![skills.sh](https://skills.sh/b/hraness/ensoul)](https://skills.sh/hraness/ensoul)");
    expect(readme).toContain(`bunx skills add hraness/ensoul#v${version} --skill ensoul`);
    expect(readme).toContain(`bun add --exact @hraness/ensoul@${version}`);
    expect(readme).toContain("node_modules/@hraness/ensoul/skills/ensoul/");
  });
});

describe("delivery policy", () => {
  test("uses only Bun and TypeScript project tooling", () => {
    expect(violations(ROOT)).toEqual([]);
  });

  test("requires trusted npm staging without a long-lived token", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/npm-stage.yml"), "utf8");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain('npm stage publish "$tarball"');
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
    expect(workflow).not.toContain("npm publish ");
  });

  test("verifies public npm bytes before immutable release publication", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
    expect(workflow).toContain('npm pack "$package_name@$package_version"');
    expect(workflow).toContain("source_payload_sha256");
    expect(workflow).toContain("registry_payload_sha256");
    expect(workflow.indexOf("Require immutable releases before publication"))
      .toBeLessThan(workflow.indexOf('gh release create "$GITHUB_REF_NAME"'));
  });
});
