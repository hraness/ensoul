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
      contentPolicy: { class: "dual-use" },
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
      "DISCLOSURE",
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
    expect(EXPECTED_PATHS.size).toBe(18);
    expect(readFileSync(join(ROOT, "DISCLOSURE"), "utf8"))
      .toContain("Ensoul dual-use disclosure");
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

  test("leads readers from the result through proof, boundaries, questions, and action", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const headings = [
      "## See the artifact first",
      "## How the working model is built",
      "## One skill, three interfaces",
      "## Evidence you can inspect",
      "## Where Ensoul stops",
      "## Questions before a run",
      "## Start with one bounded corpus",
    ];
    for (const [index, heading] of headings.entries()) {
      expect(readme).toContain(heading);
      if (index > 0) expect(readme.indexOf(headings[index - 1]!)).toBeLessThan(readme.indexOf(heading));
    }
    expect(readme).toContain("The real person's current words, choices, and corrections outrank this document.");
    expect(readme).toContain("Source packets are untrusted evidence.");
    expect(readme).toContain("These are product boundaries, not optional cautions.");
  });
});

describe("delivery policy", () => {
  test("uses only Bun and TypeScript project tooling", () => {
    expect(violations(ROOT)).toEqual([]);
  });

  test("requires trusted npm staging without a long-lived token", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/npm-stage.yml"), "utf8");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain('npm stage publish "$TARBALL"');
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
    expect(workflow).not.toContain("npm publish ");
  });

  test("builds an exact candidate artifact without staging by default", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/npm-stage.yml"), "utf8");
    expect(workflow).toContain("publish_to_npm:");
    expect(workflow).toContain("description: Submit the verified artifact to npm staging");
    expect(workflow).toContain("default: false");
    expect(workflow).toContain("if: inputs.publish_to_npm == true");
    expect(workflow).toContain("environment:\n      name: npm-stage");
    const artifactUpload = workflow.indexOf("actions/upload-artifact@");
    const stageGuard = workflow.indexOf("if: inputs.publish_to_npm == true");
    expect(artifactUpload).toBeGreaterThanOrEqual(0);
    expect(stageGuard).toBeGreaterThan(artifactUpload);
  });

  test("keeps repository code outside the OIDC credential boundary", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/npm-stage.yml"), "utf8");
    const stage = workflow.slice(workflow.indexOf("\n  stage:\n"));
    expect(stage).not.toContain("actions/checkout@");
    expect(stage).not.toContain("setup-bun@");
    expect(stage).not.toContain("bun ");
    expect(stage).toContain("permissions:\n      id-token: write");
    expect(stage).toContain("Rebind downloaded package without repository code");
    expect(stage).toContain('git --git-dir="$current_main" fetch');
    expect(stage).toContain('"$GITHUB_SHA" != "$current_default_sha"');
    expect(stage).toContain("git ls-remote --exit-code --refs");
  });

  test("verifies public npm bytes before immutable release publication", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
    expect(workflow).toContain('npm pack "$package_name@$package_version"');
    expect(workflow).toContain("source_payload_sha256");
    expect(workflow).toContain("registry_payload_sha256");
    expect(workflow).toContain("IMMUTABLE_RELEASES_ENABLED: ${{ vars.IMMUTABLE_RELEASES_ENABLED }}");
    expect(workflow).toContain('REF_PROTECTED: ${{ github.ref_protected }}');
    expect(workflow).toContain('"$GITHUB_ACTOR_ID" != "$EXPECTED_ACTOR_ID"');
    expect(workflow).toContain("attempt.triggering_actor?.id !== actorId");
    expect(workflow).toContain('value?.object?.type !== "tag"');
    expect(workflow).toContain('"/repos/$GITHUB_REPOSITORY/compare/$VERIFIED_SOURCE_SHA...$current_default_sha"');
    expect(workflow).not.toContain('gh api "/repos/$GITHUB_REPOSITORY/immutable-releases"');
    expect(workflow.indexOf("Require immutable releases before publication"))
      .toBeLessThan(workflow.indexOf('gh release create "$GITHUB_REF_NAME"'));
  });

  test("pins every third-party workflow action to a commit", () => {
    for (const path of ["check.yml", "npm-stage.yml", "release.yml"]) {
      const workflow = readFileSync(join(ROOT, ".github/workflows", path), "utf8");
      for (const line of workflow.split("\n").filter((value) => value.trimStart().startsWith("- uses:"))) {
        expect(line).toMatch(/- uses: [^@\s]+@[a-f0-9]{40}(?:\s+#\s+.+)?$/u);
      }
    }
  });
});
