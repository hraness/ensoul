import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { EXPECTED_PATHS } from "../scripts/package-smoke.ts";
import { violations } from "../scripts/check-runtime-policy.ts";
import {
  verifyNpmProvenanceIdentity,
  type NpmProvenanceIdentityInput,
} from "../scripts/npm-provenance-identity.ts";

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
    expect(Object.keys(package_.publishConfig).sort()).toEqual(["access", "registry"]);
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
    expect(workflow).toContain("--tag latest");
    expect(workflow).toContain("Candidate ${process.env.NEW_VERSION} must be newer than npm latest");
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
    expect(stage).toContain("permissions:\n      actions: read\n      id-token: write");
    expect(stage.indexOf("Reauthorize current npm stage attempt"))
      .toBeLessThan(stage.indexOf("actions/setup-node@"));
    expect(stage).toContain("attempt.actor?.id !== actorId");
    expect(stage).toContain("attempt.triggering_actor?.id !== actorId");
    expect(stage).toContain("Packed package.json can publish only this dual-use package to the canonical public registry");
    expect(stage).toContain('JSON.stringify(Object.keys(publishConfig).sort()) !== JSON.stringify(["access", "registry"])');
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
    expect(workflow).toContain('npm view "$package_name" dist-tags.latest');
    expect(workflow).toContain("npm audit signatures");
    expect(workflow).toContain("--include-attestations");
    expect(workflow).toContain("scripts/npm-provenance-identity.ts");
    expect(workflow).toContain("Published npm provenance is not bound to the completed owner-authorized stage attempt");
    expect(workflow).toContain('attempt.status !== "completed"');
    expect(workflow).toContain('attempt.conclusion !== "success"');
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

  test("binds cryptographically audited npm attestations to the exact stage attempt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ensoul-provenance-test-"));
    const auditJson = join(directory, "audit.json");
    const registryArchive = join(directory, "hraness-ensoul-0.3.3.tgz");
    const registryViewJson = join(directory, "view.json");
    const archive = Buffer.from("reviewed Ensoul registry archive\n", "utf8");
    const sourceSha = "a".repeat(40);
    const version = "0.3.3";
    const sha512Hex = createHash("sha512").update(archive).digest("hex");
    const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
    const shasum = createHash("sha1").update(archive).digest("hex");
    const purl = `pkg:npm/%40hraness/ensoul@${version}`;
    const bundle = (predicateType: string, statement: unknown) => ({
      predicateType,
      bundle: {
        mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
        verificationMaterial: { tlogEntries: [{}] },
        dsseEnvelope: {
          payload: Buffer.from(JSON.stringify(statement), "utf8").toString("base64"),
          payloadType: "application/vnd.in-toto+json",
          signatures: [{ keyid: "", sig: "verified" }],
        },
      },
    });
    const auditFixture = ({
      event = "workflow_dispatch",
      includePublish = true,
      invalid = [] as readonly unknown[],
      source = sourceSha,
      subjectDigest = sha512Hex,
      workflowPath = ".github/workflows/npm-stage.yml",
    } = {}) => {
      const provenance = {
        _type: "https://in-toto.io/Statement/v1",
        subject: [{ name: purl, digest: { sha512: subjectDigest } }],
        predicateType: "https://slsa.dev/provenance/v1",
        predicate: {
          buildDefinition: {
            buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
            externalParameters: {
              workflow: {
                ref: "refs/heads/main",
                repository: "https://github.com/hraness/ensoul",
                path: workflowPath,
              },
            },
            internalParameters: {
              github: {
                event_name: event,
                repository_id: "1350294135",
                repository_owner_id: "307125679",
              },
            },
            resolvedDependencies: [{
              uri: "git+https://github.com/hraness/ensoul@refs/heads/main",
              digest: { gitCommit: source },
            }],
          },
          runDetails: {
            builder: { id: "https://github.com/actions/runner/github-hosted" },
            metadata: {
              invocationId: "https://github.com/hraness/ensoul/actions/runs/123456/attempts/2",
            },
          },
        },
      };
      const publishPredicate = "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";
      const publish = {
        _type: "https://in-toto.io/Statement/v0.1",
        subject: [{ name: purl, digest: { sha512: subjectDigest } }],
        predicateType: publishPredicate,
        predicate: {
          name: "@hraness/ensoul",
          version,
          registry: "https://registry.npmjs.org",
        },
      };
      return {
        invalid,
        missing: [],
        verified: [{
          name: "@hraness/ensoul",
          version,
          registry: "https://registry.npmjs.org/",
          attestations: {
            url: `https://registry.npmjs.org/-/npm/v1/attestations/%40hraness%2Fensoul@${version}`,
            provenance: { predicateType: "https://slsa.dev/provenance/v1" },
          },
          attestationBundles: [
            ...(includePublish ? [bundle(publishPredicate, publish)] : []),
            bundle("https://slsa.dev/provenance/v1", provenance),
          ],
        }],
      };
    };
    const registryView = (signatures: readonly unknown[] = [{
      keyid: `SHA256:${Buffer.from("registry-key", "utf8").toString("base64")}`,
      sig: Buffer.from("registry-signature", "utf8").toString("base64"),
    }]) => ({
      name: "@hraness/ensoul",
      version,
      dist: {
        attestations: {
          url: `https://registry.npmjs.org/-/npm/v1/attestations/%40hraness%2Fensoul@${version}`,
          provenance: { predicateType: "https://slsa.dev/provenance/v1" },
        },
        integrity,
        shasum,
        signatures,
        tarball: `https://registry.npmjs.org/@hraness/ensoul/-/ensoul-${version}.tgz`,
      },
    });
    const input: NpmProvenanceIdentityInput = Object.freeze({
      auditJson,
      expectedSourceSha: sourceSha,
      expectedVersion: version,
      registryArchive,
      registryViewJson,
    });
    try {
      await writeFile(registryArchive, archive);
      await writeFile(registryViewJson, `${JSON.stringify(registryView())}\n`, "utf8");
      await writeFile(auditJson, `${JSON.stringify(auditFixture())}\n`, "utf8");
      await expect(verifyNpmProvenanceIdentity(input)).resolves.toEqual({
        runAttempt: 2,
        runId: 123456,
      });
      for (const [fixture, message] of [
        [auditFixture({ event: "push" }), "Verified SLSA event"],
        [auditFixture({ source: "b".repeat(40) }), "does not bind the staged commit"],
        [auditFixture({ subjectDigest: "0".repeat(128) }), "does not bind the registry archive"],
        [auditFixture({ workflowPath: ".github/workflows/release.yml" }), "Verified SLSA workflow path"],
        [auditFixture({ includePublish: false }), "exactly one publish and one SLSA"],
        [auditFixture({ invalid: [{}] }), "contains invalid entries"],
      ] as const) {
        await writeFile(auditJson, `${JSON.stringify(fixture)}\n`, "utf8");
        await expect(verifyNpmProvenanceIdentity(input)).rejects.toThrow(message);
      }
      await writeFile(auditJson, `${JSON.stringify(auditFixture())}\n`, "utf8");
      await writeFile(registryViewJson, `${JSON.stringify(registryView([]))}\n`, "utf8");
      await expect(verifyNpmProvenanceIdentity(input)).rejects.toThrow("has no signatures");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
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
