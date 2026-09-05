import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  EXPECTED_PATHS,
  readTarGzip,
  verifyNpmPublishManifest,
} from "../scripts/package-smoke.ts";
import { violations } from "../scripts/check-runtime-policy.ts";
import {
  verifyNpmProvenanceIdentity,
  type NpmProvenanceIdentityInput,
} from "../scripts/npm-provenance-identity.ts";

const ROOT = resolve(import.meta.dir, "..");
const package_ = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, any>;
const version = readFileSync(join(ROOT, "VERSION"), "utf8").trim();

function sha1(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function integrity(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function workflowStepScript(workflow: string, name: string): string {
  const lines = workflow.split("\n");
  const step = lines.findIndex((line) => line === `      - name: ${name}`);
  if (step < 0) throw new Error(`Workflow step not found: ${name}`);
  const run = lines.findIndex((line, index) => index > step && line === "        run: |");
  if (run < 0) throw new Error(`Workflow script not found: ${name}`);
  const script: string[] = [];
  for (let index = run + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("      - ") || /^  [a-zA-Z0-9_-]+:/u.test(line)) break;
    if (line !== "" && !line.startsWith("          ")) {
      throw new Error(`Workflow script has unexpected indentation: ${name}`);
    }
    script.push(line === "" ? "" : line.slice(10));
  }
  return script.join("\n");
}

async function runWorkflowScript(
  script: string,
  environment: Readonly<Record<string, string>>,
): Promise<Readonly<{ exitCode: number; stderr: string; stdout: string }>> {
  const child = Bun.spawn(["/bin/bash", "-c", script], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return Object.freeze({ exitCode, stderr, stdout });
}

type StageArtifact = Readonly<{
  directory: string;
  metadataPath: string;
  tarballName: string;
  tarballPath: string;
}>;

async function createStageArtifact(root: string): Promise<StageArtifact> {
  const directory = join(root, "ensoul-npm-package");
  const metadataPath = join(directory, "npm-pack.json");
  const userConfig = join(root, "empty-user.npmrc");
  const globalConfig = join(root, "empty-global.npmrc");
  await mkdir(directory, { recursive: true });
  await Promise.all([writeFile(userConfig, ""), writeFile(globalConfig, "")]);
  const packed = Bun.spawnSync({
    cmd: [
      "npm",
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      directory,
      "--cache",
      join(root, "npm-cache"),
      "--registry=https://registry.npmjs.org",
    ],
    cwd: ROOT,
    env: {
      ...process.env,
      NPM_CONFIG_GLOBALCONFIG: globalConfig,
      NPM_CONFIG_USERCONFIG: userConfig,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  if (packed.exitCode !== 0) {
    throw new Error(`npm pack failed: ${packed.stderr.toString().trim()}`);
  }
  const metadataBytes = packed.stdout;
  const metadata = JSON.parse(metadataBytes.toString("utf8")) as readonly Readonly<{ filename?: unknown }>[];
  const tarballName = metadata[0]?.filename;
  if (metadata.length !== 1 || typeof tarballName !== "string") {
    throw new Error("npm pack returned an invalid receipt");
  }
  const tarballPath = join(directory, tarballName);
  const archiveBytes = await readFile(tarballPath);
  await Promise.all([
    writeFile(metadataPath, metadataBytes),
    writeFile(
      join(directory, "npm-package.sha256"),
      `${sha256(archiveBytes)}  ${tarballName}\n${sha256(metadataBytes)}  npm-pack.json\n`,
    ),
  ]);
  return Object.freeze({ directory, metadataPath, tarballName, tarballPath });
}

function tarText(header: Buffer, start: number, length: number): string {
  const field = header.subarray(start, start + length);
  const zero = field.indexOf(0);
  return (zero < 0 ? field : field.subarray(0, zero)).toString("ascii");
}

function tarSize(header: Buffer): number {
  return Number.parseInt(tarText(header, 124, 12).trim(), 8);
}

function writeTarChecksum(header: Buffer): void {
  header.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
}

async function rewriteStageArchive(
  artifact: StageArtifact,
  mutate: (tar: Buffer, header: Buffer, bodyOffset: number, size: number, path: string) => boolean,
): Promise<Buffer> {
  const tar = gunzipSync(await readFile(artifact.tarballPath));
  let offset = 0;
  let changed = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const name = tarText(header, 0, 100);
    const prefix = tarText(header, 345, 155);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const size = tarSize(header);
    changed = mutate(tar, header, offset, size, path) || changed;
    offset += Math.ceil(size / 512) * 512;
  }
  if (!changed) throw new Error("Test archive mutation target was not found");
  const archiveBytes = gzipSync(tar);
  const metadata = JSON.parse(await readFile(artifact.metadataPath, "utf8")) as Array<Record<string, unknown>>;
  if (metadata.length !== 1 || metadata[0] === undefined) throw new Error("Test npm pack receipt is invalid");
  metadata[0].size = archiveBytes.byteLength;
  metadata[0].integrity = integrity(archiveBytes);
  metadata[0].shasum = sha1(archiveBytes);
  const metadataBytes = Buffer.from(`${JSON.stringify(metadata)}\n`, "utf8");
  await Promise.all([
    writeFile(artifact.tarballPath, archiveBytes),
    writeFile(artifact.metadataPath, metadataBytes),
    writeFile(
      join(artifact.directory, "npm-package.sha256"),
      `${sha256(archiveBytes)}  ${artifact.tarballName}\n${sha256(metadataBytes)}  npm-pack.json\n`,
    ),
  ]);
  return archiveBytes;
}

function stageArtifactEnvironment(root: string, artifact: StageArtifact): Readonly<Record<string, string>> {
  return Object.freeze({
    EXPECTED_SOURCE_SHA: "a".repeat(40),
    EXPECTED_TARBALL_NAME: artifact.tarballName,
    EXPECTED_VERSION: version,
    GITHUB_OUTPUT: join(root, "github-output.txt"),
    RUNNER_TEMP: root,
  });
}

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
    expect(Object.hasOwn(package_, "tag")).toBe(false);
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
    expect(workflow).toContain("npm config get tag");
    expect(workflow).toContain('"$configured_tag" != latest');
    expect(workflow).not.toMatch(/\s--tag(?:=|\s)/u);
    expect(workflow).toContain('unset NPM_CONFIG_TAG npm_config_tag');
    expect(workflow).toContain("Candidate ${process.env.NEW_VERSION} must be newer than npm latest");
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
    expect(workflow).not.toContain("npm publish ");
  });

  test("builds an exact candidate artifact without staging by default", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/npm-stage.yml"), "utf8");
    expect(workflow).toContain("publish_to_npm:");
    expect(workflow).toContain("description: Submit the verified artifact to npm staging");
    expect(workflow).toContain("default: false");
    expect(workflow).toContain("resolved_stage_version:");
    expect(workflow).toContain("Exact cleared stage-intent version that releases the retained history lock");
    expect(workflow).toContain("if: inputs.publish_to_npm == true");
    expect(workflow).toContain("environment:\n      name: npm-stage");
    const artifactUpload = workflow.indexOf("actions/upload-artifact@");
    const stageGuard = workflow.indexOf("if: inputs.publish_to_npm == true");
    expect(artifactUpload).toBeGreaterThanOrEqual(0);
    expect(stageGuard).toBeGreaterThan(artifactUpload);
  });

  test("rejects npm manifest dist-tag overrides at the source boundary", () => {
    expect(() => verifyNpmPublishManifest(package_)).not.toThrow();
    expect(() => verifyNpmPublishManifest({ ...package_, tag: "beta" })).toThrow(
      "top-level tag because npm lets it override",
    );
    expect(() => verifyNpmPublishManifest({
      ...package_,
      publishConfig: { ...package_.publishConfig, tag: "beta" },
    })).toThrow("publishConfig may contain only");
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
    expect(stage).toContain('Object.hasOwn(manifest, "tag")');
    expect(stage).toContain("header.subarray(257, 265).equals(ustarSignature)");
    expect(stage).toContain("Rebind downloaded package without repository code");
    expect(stage).toContain("Reject unresolved stable-stage intent");
    expect(stage).toContain("Record exclusive stable-stage intent");
    expect(stage).toContain("Record cleared stable-stage intent v${{ inputs.resolved_stage_version }}");
    expect(stage).toContain("already reserved stable stage");
    expect(stage).toContain("does not identify a blocking intent");
    expect(stage).toContain("jobs?filter=all&per_page=100");
    expect(stage).toContain("inspectRunJobs(currentRunNumber)");
    expect(stage).toContain("terminal write without one durable intent");
    expect(stage).toContain("terminal write is not immediately preceded by its durable intent");
    expect(stage).toContain("!Number.isSafeInteger(intentNumber)");
    expect(stage).toContain("intentNumber < 1");
    expect(stage).toContain("!Number.isSafeInteger(terminalNumber)");
    expect(stage).toContain("terminalNumber < 1");
    expect(stage.indexOf("const terminalWrites = job.steps.filter"))
      .toBeLessThan(stage.indexOf('!job.name.startsWith("Stage exact package")'));
    expect(stage).toContain("33262478732");
    expect(stage).toContain("33263116309");
    expect(stage).toContain("33558844386");
    expect(stage).toContain('git --git-dir="$current_main" fetch');
    expect(stage).toContain('"$GITHUB_SHA" != "$current_default_sha"');
    expect(stage).toContain("git ls-remote --exit-code --refs");
    expect(stage.lastIndexOf('npm view "@hraness/ensoul" dist-tags.latest'))
      .toBeLessThan(stage.indexOf('npm stage publish "$TARBALL"'));
    expect(stage.lastIndexOf("Record exclusive stable-stage intent"))
      .toBeLessThan(stage.indexOf('npm stage publish "$TARBALL"'));
  });

  test("the retained stage-intent lock survives failed jobs, reruns, and exact resolutions", async () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/npm-stage.yml"), "utf8");
    const script = workflowStepScript(workflow, "Reject unresolved stable-stage intent");
    const root = await mkdtemp(join(tmpdir(), "ensoul-stage-history-"));
    const binaryDirectory = join(root, "bin");
    const currentJobsPath = join(root, "current-jobs.json");
    const runsPath = join(root, "runs.json");
    const jobsPath = join(root, "jobs.json");
    try {
      await mkdir(binaryDirectory, { recursive: true });
      await Promise.all([
        writeFile(join(binaryDirectory, "npm"), [
          "#!/bin/bash",
          "set -euo pipefail",
          "printf '\"%s\"\\n' \"$MOCK_NPM_LATEST\"",
        ].join("\n")),
        writeFile(join(binaryDirectory, "gh"), [
          "#!/bin/bash",
          "set -euo pipefail",
          'case "$*" in',
          '  *"/actions/workflows/345387949/runs?"*) cat "$MOCK_RUNS_JSON" ;;',
          '  *"/actions/runs/67890/jobs?"*) cat "$MOCK_CURRENT_JOBS_JSON" ;;',
          '  *"/actions/runs/12345/jobs?"*) cat "$MOCK_JOBS_JSON" ;;',
          '  *"/actions/runs/33262478732/jobs?"*) cat "$MOCK_JOBS_JSON" ;;',
          '  *"/actions/runs/33558844386/jobs?"*) cat "$MOCK_JOBS_JSON" ;;',
          '  *) echo "unexpected gh request: $*" >&2; exit 2 ;;',
          "esac",
        ].join("\n")),
        writeFile(runsPath, JSON.stringify({ total_count: 0, workflow_runs: [] })),
        writeFile(currentJobsPath, JSON.stringify({ total_count: 0, jobs: [] })),
        writeFile(jobsPath, JSON.stringify({ total_count: 0, jobs: [] })),
      ]);
      await Promise.all([
        chmod(join(binaryDirectory, "npm"), 0o755),
        chmod(join(binaryDirectory, "gh"), 0o755),
      ]);
      const environment = {
        PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
        EXPECTED_VERSION: "0.3.4",
        EXPECTED_WORKFLOW_ID: "345387949",
        GITHUB_REPOSITORY: "hraness/ensoul",
        GITHUB_RUN_ID: "67890",
        MOCK_CURRENT_JOBS_JSON: currentJobsPath,
        MOCK_JOBS_JSON: jobsPath,
        MOCK_NPM_LATEST: "0.3.2",
        MOCK_RUNS_JSON: runsPath,
        RESOLVED_STAGE_VERSION: "",
        RUNNER_TEMP: root,
      };

      const firstRun = await runWorkflowScript(script, environment);
      expect(firstRun.exitCode).toBe(0);

      const completedRun = {
        event: "workflow_dispatch",
        head_branch: "main",
        id: 12345,
        status: "completed",
        workflow_id: 345387949,
      };
      const failedWriteAfterIntent = {
        conclusion: "failure",
        head_sha: "b".repeat(40),
        name: "Stage exact package v0.3.3",
        run_attempt: 1,
        steps: [{
          conclusion: "success",
          name: "Record exclusive stable-stage intent",
          number: 7,
        }, {
          conclusion: "failure",
          name: "Revalidate current main and submit exact package to npm staging",
          number: 8,
        }],
      };
      await Promise.all([
        writeFile(runsPath, JSON.stringify({
          total_count: 1,
          workflow_runs: [completedRun],
        })),
        writeFile(jobsPath, JSON.stringify({
          total_count: 1,
          jobs: [failedWriteAfterIntent],
        })),
      ]);
      const failedJob = await runWorkflowScript(script, environment);
      expect(failedJob.exitCode).not.toBe(0);
      expect(failedJob.stderr).toContain("run 12345 already reserved stable stage 0.3.3");

      const rejectedStageRecovery = await runWorkflowScript(script, {
        ...environment,
        RESOLVED_STAGE_VERSION: "0.3.3",
      });
      expect(rejectedStageRecovery.exitCode).toBe(0);

      await Promise.all([
        writeFile(runsPath, JSON.stringify({ total_count: 0, workflow_runs: [] })),
        writeFile(currentJobsPath, JSON.stringify({
          total_count: 1,
          jobs: [failedWriteAfterIntent],
        })),
      ]);
      const sameRunRerun = await runWorkflowScript(script, environment);
      expect(sameRunRerun.exitCode).not.toBe(0);
      expect(sameRunRerun.stderr).toContain("run 67890 already reserved stable stage 0.3.3");
      expect((await runWorkflowScript(script, {
        ...environment,
        RESOLVED_STAGE_VERSION: "0.3.3",
      })).exitCode).toBe(0);

      const durableResolution = {
        conclusion: "failure",
        head_sha: "b".repeat(40),
        name: "Stage exact package v0.3.3",
        run_attempt: 2,
        steps: [{
          conclusion: "success",
          name: "Record cleared stable-stage intent v0.3.3",
        }],
      };
      await Promise.all([
        writeFile(runsPath, JSON.stringify({
          total_count: 1,
          workflow_runs: [completedRun],
        })),
        writeFile(currentJobsPath, JSON.stringify({ total_count: 0, jobs: [] })),
        writeFile(jobsPath, JSON.stringify({
          total_count: 2,
          jobs: [failedWriteAfterIntent, durableResolution],
        })),
      ]);
      const durablyCleared = await runWorkflowScript(script, environment);
      expect(durablyCleared.exitCode).toBe(0);

      await writeFile(jobsPath, JSON.stringify({
        total_count: 3,
        jobs: [failedWriteAfterIntent, durableResolution, {
          conclusion: "failure",
          head_sha: "b".repeat(40),
          name: "Stage exact package v0.3.3",
          run_attempt: 3,
          steps: [{
            conclusion: "success",
            name: "Record cleared stable-stage intent v0.3.3",
          }],
        }],
      }));
      const overCleared = await runWorkflowScript(script, environment);
      expect(overCleared.exitCode).not.toBe(0);
      expect(overCleared.stderr).toContain(
        "cleared 0.3.3 intent without its matching reservation",
      );

      await writeFile(jobsPath, JSON.stringify({
        total_count: 2,
        jobs: [failedWriteAfterIntent, durableResolution],
      }));
      const unrelatedRecovery = await runWorkflowScript(script, {
        ...environment,
        RESOLVED_STAGE_VERSION: "0.3.1",
      });
      expect(unrelatedRecovery.exitCode).not.toBe(0);
      expect(unrelatedRecovery.stderr).toContain("does not identify a blocking intent");

      await Promise.all([
        writeFile(runsPath, JSON.stringify({
          total_count: 1,
          workflow_runs: [{
            event: "workflow_dispatch",
            head_branch: "main",
            id: 33262478732,
            status: "completed",
            workflow_id: 345387949,
          }],
        })),
        writeFile(jobsPath, JSON.stringify({
          total_count: 1,
          jobs: [{
            conclusion: "failure",
            head_sha: "e8308cb3f89fd38377d68196b1d75a64675d2c6b",
            name: "Stage exact package",
            run_attempt: 1,
            steps: [{
              conclusion: "failure",
              name: "Submit verified package to npm staging",
            }],
          }],
        })),
      ]);
      const sealedFailedLegacyWrite = await runWorkflowScript(script, environment);
      expect(sealedFailedLegacyWrite.exitCode).toBe(0);

      await Promise.all([
        writeFile(runsPath, JSON.stringify({
          total_count: 1,
          workflow_runs: [{
            event: "workflow_dispatch",
            head_branch: "main",
            id: 33558844386,
            status: "completed",
            workflow_id: 345387949,
          }],
        })),
        writeFile(jobsPath, JSON.stringify({
          total_count: 1,
          jobs: [{
            conclusion: "success",
            head_sha: "46c8b14d03fecdfe8d75e5a61d5f7bfcc255e674",
            name: "Stage exact package",
            run_attempt: 1,
            steps: [{
              conclusion: "success",
              name: "Submit verified package to npm staging",
            }],
          }],
        })),
      ]);
      const sealedLegacyStage = await runWorkflowScript(script, {
        ...environment,
        EXPECTED_VERSION: "0.3.2",
        MOCK_NPM_LATEST: "0.3.1",
      });
      expect(sealedLegacyStage.exitCode).toBe(0);

      await writeFile(jobsPath, JSON.stringify({
        total_count: 1,
        jobs: [{
          conclusion: "success",
          head_sha: "a".repeat(40),
          name: "Stage exact package",
          run_attempt: 1,
          steps: [{
            conclusion: "success",
            name: "Submit verified package to npm staging",
          }],
        }],
      }));
      const forgedLegacyStage = await runWorkflowScript(script, {
        ...environment,
        EXPECTED_VERSION: "0.3.2",
        MOCK_NPM_LATEST: "0.3.1",
      });
      expect(forgedLegacyStage.exitCode).not.toBe(0);
      expect(forgedLegacyStage.stderr).toContain("unsealed generic stage job");

      await Promise.all([
        writeFile(runsPath, JSON.stringify({
          total_count: 1,
          workflow_runs: [completedRun],
        })),
        writeFile(jobsPath, JSON.stringify({
          total_count: 1,
          jobs: [{
            conclusion: "failure",
            head_sha: "b".repeat(40),
            name: "Stage exact package v0.3.3",
            run_attempt: 1,
            steps: [{
              conclusion: "failure",
              name: "Revalidate current main and submit exact package to npm staging",
            }],
          }],
        })),
      ]);
      const writeWithoutIntent = await runWorkflowScript(script, environment);
      expect(writeWithoutIntent.exitCode).not.toBe(0);
      expect(writeWithoutIntent.stderr).toContain("terminal write without one durable intent");

      await writeFile(jobsPath, JSON.stringify({
        total_count: 1,
        jobs: [{
          conclusion: "failure",
          head_sha: "b".repeat(40),
          name: "Hostile renamed npm staging job",
          run_attempt: 1,
          steps: [{
            conclusion: "failure",
            name: "Revalidate current main and submit exact package to npm staging",
            number: 8,
          }],
        }],
      }));
      const renamedJobWriteWithoutIntent = await runWorkflowScript(script, environment);
      expect(renamedJobWriteWithoutIntent.exitCode).not.toBe(0);
      expect(renamedJobWriteWithoutIntent.stderr).toContain(
        "terminal write without one durable intent",
      );

      await writeFile(jobsPath, JSON.stringify({
        total_count: 1,
        jobs: [{
          conclusion: "failure",
          head_sha: "b".repeat(40),
          name: "Hostile renamed npm staging job",
          run_attempt: 1,
          steps: [{
            conclusion: "success",
            name: "Record exclusive stable-stage intent",
            number: 7,
          }, {
            conclusion: "failure",
            name: "Revalidate current main and submit exact package to npm staging",
            number: 8,
          }],
        }],
      }));
      const renamedJobWithIntent = await runWorkflowScript(script, environment);
      expect(renamedJobWithIntent.exitCode).not.toBe(0);
      expect(renamedJobWithIntent.stderr).toContain("lacks a version-bound stage job");

      await writeFile(jobsPath, JSON.stringify({
        total_count: 1,
        jobs: [{
          conclusion: "failure",
          head_sha: "b".repeat(40),
          name: "Stage exact package v0.3.3",
          run_attempt: 1,
          steps: [{
            conclusion: "failure",
            name: "Revalidate current main and submit exact package to npm staging",
            number: 7,
          }, {
            conclusion: "success",
            name: "Record exclusive stable-stage intent",
            number: 8,
          }],
        }],
      }));
      const reversedIntentOrder = await runWorkflowScript(script, environment);
      expect(reversedIntentOrder.exitCode).not.toBe(0);
      expect(reversedIntentOrder.stderr).toContain(
        "terminal write is not immediately preceded by its durable intent",
      );

      await writeFile(jobsPath, JSON.stringify({
        total_count: 1,
        jobs: [{
          conclusion: "failure",
          head_sha: "b".repeat(40),
          name: "Stage exact package v0.3.3",
          run_attempt: 1,
          steps: [{
            conclusion: "success",
            name: "Record exclusive stable-stage intent",
            number: 0,
          }, {
            conclusion: "failure",
            name: "Revalidate current main and submit exact package to npm staging",
            number: 1,
          }],
        }],
      }));
      const unsafeStepNumber = await runWorkflowScript(script, environment);
      expect(unsafeStepNumber.exitCode).not.toBe(0);
      expect(unsafeStepNumber.stderr).toContain(
        "terminal write is not immediately preceded by its durable intent",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("the checkout-free stage rejects a packed top-level tag override", async () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/npm-stage.yml"), "utf8");
    const script = workflowStepScript(workflow, "Rebind downloaded package without repository code");
    const root = await mkdtemp(join(tmpdir(), "ensoul-stage-tag-"));
    try {
      const artifact = await createStageArtifact(root);
      const accepted = await runWorkflowScript(script, stageArtifactEnvironment(root, artifact));
      if (accepted.exitCode !== 0) {
        throw new Error(`Canonical stage artifact was rejected:\n${accepted.stderr}${accepted.stdout}`);
      }
      await rewriteStageArchive(artifact, (tar, _header, bodyOffset, size, path) => {
        if (path !== "package/package.json") return false;
        const source = tar.subarray(bodyOffset, bodyOffset + size).toString("utf8");
        const original = '"type": "module"';
        const hostile = '"tag": "beta"   ';
        if (original.length !== hostile.length || !source.includes(original)) {
          throw new Error("Packed manifest lacks the fixed-width top-level tag mutation target");
        }
        Buffer.from(source.replace(original, hostile), "utf8").copy(tar, bodyOffset);
        return true;
      });
      const rejected = await runWorkflowScript(script, stageArtifactEnvironment(root, artifact));
      expect(rejected.exitCode).not.toBe(0);
      expect(rejected.stderr).toContain(
        "Packed package.json can publish only this dual-use package to the canonical public registry",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("both tar readers reject the npm-consumer USTAR version differential", async () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/npm-stage.yml"), "utf8");
    const script = workflowStepScript(workflow, "Rebind downloaded package without repository code");
    const root = await mkdtemp(join(tmpdir(), "ensoul-stage-ustar-"));
    try {
      const artifact = await createStageArtifact(root);
      const hostileArchive = await rewriteStageArchive(artifact, (_tar, header, _bodyOffset, _size, path) => {
        if (path !== "package/package.json") return false;
        // npm's node-tar consumes prefix only for the exact `ustar\0` + `00`
        // signature. The former six-byte check treated this as package/package.json
        // while the consumer treated it as the root-level package.json.
        header.fill(0, 0, 100);
        header.write("package.json", 0, "ascii");
        header.fill(0, 345, 500);
        header.write("package", 345, "ascii");
        header.write("XX", 263, 2, "ascii");
        writeTarChecksum(header);
        return true;
      });
      expect(() => readTarGzip(hostileArchive)).toThrow("supported POSIX USTAR archive");
      const rejected = await runWorkflowScript(script, stageArtifactEnvironment(root, artifact));
      expect(rejected.exitCode).not.toBe(0);
      expect(rejected.stderr).toContain("Packed manifest tar header is invalid");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("both tar readers apply npm's extended USTAR prefix discriminator", async () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/npm-stage.yml"), "utf8");
    const smoke = readFileSync(join(ROOT, "scripts/package-smoke.ts"), "utf8");
    const script = workflowStepScript(workflow, "Rebind downloaded package without repository code");
    const root = await mkdtemp(join(tmpdir(), "ensoul-stage-extended-prefix-"));
    expect(smoke).toContain("header[475] === 0 ? 130 : 155");
    expect(workflow).toContain("header[475] === 0 ? 130 : 155");
    try {
      const artifact = await createStageArtifact(root);
      const hostileArchive = await rewriteStageArchive(artifact, (_tar, header, _bodyOffset, _size, path) => {
        if (path !== "package/package.json") return false;
        header.fill(0, 0, 100);
        header.write("package.json", 0, "ascii");
        header.fill(0, 345, 500);
        header.write(`${"a".repeat(130)}/../package`, 345, "ascii");
        writeTarChecksum(header);
        return true;
      });
      expect(() => readTarGzip(hostileArchive)).toThrow("unsafe path");
      const rejected = await runWorkflowScript(script, stageArtifactEnvironment(root, artifact));
      expect(rejected.exitCode).not.toBe(0);
      expect(rejected.stderr).toContain("Packed manifest tar path is unsafe");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("release identity closes tagged controls over current main", async () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
    const script = workflowStepScript(workflow, "Verify release identity");
    const root = await mkdtemp(join(tmpdir(), "ensoul-release-identity-"));
    const binaryDirectory = join(root, "bin");
    const output = join(root, "output");
    const sourceSha = "b".repeat(40);
    const mainSha = "c".repeat(40);
    const releaseTag = "v0.3.3";
    try {
      await mkdir(binaryDirectory, { recursive: true });
      await Promise.all([
        writeFile(output, ""),
        writeFile(join(binaryDirectory, "bun"), [
          "#!/bin/bash",
          "set -euo pipefail",
          'if [[ "$1" == -e ]]; then printf \'0.3.3\\n\'; else exit 2; fi',
        ].join("\n")),
        writeFile(join(binaryDirectory, "git"), [
          "#!/bin/bash",
          "set -euo pipefail",
          'case "$*" in',
          '  "check-ref-format refs/heads/main") ;;',
          '  "check-ref-format refs/tags/v0.3.3") ;;',
          '  "fetch --no-tags origin refs/heads/main:refs/remotes/origin/main") ;;',
          '  "fetch --no-tags origin refs/tags/v0.3.3:refs/ensoul-release-tags/v0.3.3") ;;',
          '  "fetch --force --tags origin") ;;',
          '  "rev-parse origin/main") printf \'%s\\n\' "$MOCK_MAIN_SHA" ;;',
          '  "rev-parse HEAD") printf \'%s\\n\' "$MOCK_SOURCE_SHA" ;;',
          '  "rev-parse refs/ensoul-release-tags/v0.3.3^{commit}") printf \'%s\\n\' "$MOCK_SOURCE_SHA" ;;',
          '  "rev-parse refs/tags/v0.3.3^{commit}") printf \'%s\\n\' "$MOCK_SOURCE_SHA" ;;',
          '  "cat-file -t refs/ensoul-release-tags/v0.3.3") printf \'tag\\n\' ;;',
          '  "merge-base --is-ancestor "*) ;;',
          '  "diff --quiet --no-ext-diff --no-textconv "*) [[ "${MOCK_CONTROL_DRIFT:-false}" != true ]] ;;',
          '  "tag --list v"*) printf \'v0.3.3\\n\' ;;',
          '  *) echo "unexpected git invocation: $*" >&2; exit 2 ;;',
          "esac",
        ].join("\n")),
      ]);
      await Promise.all([
        chmod(join(binaryDirectory, "bun"), 0o755),
        chmod(join(binaryDirectory, "git"), 0o755),
      ]);
      const environment = {
        PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
        DEFAULT_BRANCH: "main",
        GITHUB_EVENT_NAME: "push",
        GITHUB_OUTPUT: output,
        GITHUB_REF: `refs/tags/${releaseTag}`,
        GITHUB_REF_NAME: releaseTag,
        GITHUB_SHA: sourceSha,
        MOCK_MAIN_SHA: mainSha,
        MOCK_SOURCE_SHA: sourceSha,
        REF_PROTECTED: "true",
      };

      const accepted = await runWorkflowScript(script, environment);
      expect(accepted.exitCode).toBe(0);
      expect(await readFile(output, "utf8")).toContain(`workflow_sha=${mainSha}`);

      await writeFile(output, "");
      const drifted = await runWorkflowScript(script, {
        ...environment,
        MOCK_CONTROL_DRIFT: "true",
      });
      expect(drifted.exitCode).not.toBe(0);
      expect(`${drifted.stderr}${drifted.stdout}`).toContain(
        "Tagged and current release workflow controls differ",
      );
      expect(await readFile(output, "utf8")).toBe("");

      const wrongSource = await runWorkflowScript(script, {
        ...environment,
        GITHUB_SHA: "d".repeat(40),
      });
      expect(wrongSource.exitCode).not.toBe(0);
      expect(`${wrongSource.stderr}${wrongSource.stdout}`).toContain(
        "Tag does not match the checked release commit",
      );

      const wrongEvent = await runWorkflowScript(script, {
        ...environment,
        GITHUB_EVENT_NAME: "workflow_dispatch",
      });
      expect(wrongEvent.exitCode).not.toBe(0);
      expect(`${wrongEvent.stderr}${wrongEvent.stdout}`).toContain(
        "Release requires a protected owner-created stable tag",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("verifies public npm bytes before immutable release publication", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
    expect(workflow).toContain('npm pack "$package_name@$package_version"');
    expect(workflow).toContain("source_payload_sha256");
    expect(workflow).toContain("registry_payload_sha256");
    expect(workflow).toContain('npm view "$package_name" dist-tags.latest');
    expect(workflow).toContain("npm audit signatures");
    expect(workflow).toContain("--include-attestations");
    expect(workflow).toContain('git show "$WORKFLOW_SHA:scripts/package-smoke.ts"');
    expect(workflow).toContain('git show "$WORKFLOW_SHA:scripts/npm-provenance-identity.ts"');
    expect(workflow).toContain('git hash-object "$current_tool"');
    expect(workflow).toContain('bun --no-env-file --config=/dev/null run "$current_package_smoke"');
    expect(workflow).toContain('bun --no-env-file --config=/dev/null run "$current_provenance_identity"');
    expect(workflow).toContain("Published npm provenance is not bound to the completed owner-authorized stage attempt");
    expect(workflow).toContain('attempt.status !== "completed"');
    expect(workflow).toContain('attempt.conclusion !== "success"');
    expect(workflow).toContain("IMMUTABLE_RELEASES_ENABLED: ${{ vars.IMMUTABLE_RELEASES_ENABLED }}");
    expect(workflow).toContain('REF_PROTECTED: ${{ github.ref_protected }}');
    expect(workflow).toContain('"$GITHUB_ACTOR_ID" != "$EXPECTED_ACTOR_ID"');
    expect(workflow).toContain("attempt.triggering_actor?.id !== actorId");
    expect(workflow).toContain('value?.object?.type !== "tag"');
    expect(workflow).toContain('"/repos/$GITHUB_REPOSITORY/compare/$VERIFIED_SOURCE_SHA...$current_default_sha"');
    expect(workflow).toContain("release.author?.id !== 41898282");
    expect(workflow).toContain('release.author?.login !== "github-actions[bot]"');
    expect(workflow).toContain('release.body !== process.env.EXPECTED_BODY');
    expect(workflow).toContain("Tagged and current release workflow controls differ");
    expect(workflow).toContain("verify_current_release_controls");
    expect(workflow).toContain("Current release verifier controls changed after verification");
    expect(workflow).toContain("ref: main");
    expect(workflow).not.toContain('gh api "/repos/$GITHUB_REPOSITORY/immutable-releases"');
    expect(workflow.indexOf("Require immutable releases before publication"))
      .toBeLessThan(workflow.indexOf('gh release create "$GITHUB_REF_NAME"'));
    const publishJob = workflow.slice(workflow.indexOf("\n  publish:\n"));
    expect(publishJob.lastIndexOf('npm view "@hraness/ensoul" dist-tags.latest'))
      .toBeLessThan(publishJob.indexOf('gh release create "$GITHUB_REF_NAME"'));
  });

  test("release publication authenticates exact Actions-authored provenance and live npm latest", async () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
    const script = workflowStepScript(workflow, "Publish verified GitHub release");
    const root = await mkdtemp(join(tmpdir(), "ensoul-release-record-"));
    const binaryDirectory = join(root, "bin");
    const releaseJson = join(root, "release.json");
    const releaseCreated = join(root, "release-created");
    const commandLog = join(root, "commands.log");
    const sourceSha = "b".repeat(40);
    const mainSha = "c".repeat(40);
    const releaseVersion = "0.3.3";
    const releaseTag = `v${releaseVersion}`;
    const runId = "76543";
    const releaseBody = [
      "Automated immutable Ensoul release.",
      "",
      `Source: ${sourceSha}`,
      "Workflow: .github/workflows/release.yml",
      `Run: https://github.com/hraness/ensoul/actions/runs/${runId}`,
    ].join("\n");
    const exactRelease = {
      assets: [],
      author: { id: 41898282, login: "github-actions[bot]", type: "Bot" },
      body: releaseBody,
      draft: false,
      id: 1234,
      immutable: true,
      name: `Ensoul ${releaseTag}`,
      prerelease: false,
      tag_name: releaseTag,
    };
    try {
      await mkdir(binaryDirectory, { recursive: true });
      await Promise.all([
        writeFile(releaseJson, JSON.stringify(exactRelease)),
        writeFile(join(binaryDirectory, "npm"), [
          "#!/bin/bash",
          "set -euo pipefail",
          'printf \'"%s"\\n\' "$MOCK_NPM_LATEST"',
        ].join("\n")),
        writeFile(join(binaryDirectory, "gh"), [
          "#!/bin/bash",
          "set -euo pipefail",
          'printf \'%s\\n\' "$*" >> "$GH_COMMAND_LOG"',
          'if [[ "$1" == api ]]; then',
          '  endpoint=""',
          '  for argument in "$@"; do',
          '    if [[ "$argument" == /repos/* ]]; then endpoint="$argument"; fi',
          '  done',
          '  case "$endpoint" in',
          '    */commits/main) printf \'%s\\n\' "$MOCK_MAIN_SHA" ;;',
          '    */commits/v*) printf \'%s\\n\' "$MOCK_SOURCE_SHA" ;;',
          '    */compare/*) printf \'ahead\\n\' ;;',
          '    */releases/tags/*)',
          '      if [[ "$MOCK_RELEASE_PRESENT" == true || -f "$MOCK_RELEASE_CREATED" ]]; then',
          '        cat "$MOCK_RELEASE_JSON"',
          '      else',
          '        echo "gh: Not Found (HTTP 404)" >&2',
          '        exit 1',
          '      fi',
          '      ;;',
          '    */releases/latest) printf \'%s\\n\' "$MOCK_RELEASE_TAG" ;;',
          '    *) echo "unexpected gh api endpoint: $endpoint" >&2; exit 2 ;;',
          '  esac',
          'elif [[ "$1 $2" == "release create" ]]; then',
          '  : > "$MOCK_RELEASE_CREATED"',
          "else",
          '  echo "unexpected gh invocation: $*" >&2',
          '  exit 2',
          "fi",
        ].join("\n")),
        writeFile(join(binaryDirectory, "git"), [
          "#!/bin/bash",
          "set -euo pipefail",
          'case "$*" in',
          '  "fetch --no-tags --force origin "*) ;;',
          '  "rev-parse refs/remotes/ensoul-release-current/main") printf \'%s\\n\' "$MOCK_MAIN_SHA" ;;',
          '  "merge-base --is-ancestor "*) ;;',
          '  "diff --quiet --no-ext-diff --no-textconv "*"scripts/package-smoke.ts"*)',
          '    [[ "${MOCK_HELPER_DRIFT:-false}" != true ]]',
          '    ;;',
          '  "diff --quiet --no-ext-diff --no-textconv "*".github/workflows/release.yml"*)',
          '    [[ "${MOCK_WORKFLOW_DRIFT:-false}" != true ]]',
          '    ;;',
          '  *) echo "unexpected git invocation: $*" >&2; exit 2 ;;',
          "esac",
        ].join("\n")),
      ]);
      await Promise.all([
        chmod(join(binaryDirectory, "npm"), 0o755),
        chmod(join(binaryDirectory, "gh"), 0o755),
        chmod(join(binaryDirectory, "git"), 0o755),
      ]);
      const environment = {
        PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
        DEFAULT_BRANCH: "main",
        GH_COMMAND_LOG: commandLog,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: `refs/tags/${releaseTag}`,
        GITHUB_REF_NAME: releaseTag,
        GITHUB_REPOSITORY: "hraness/ensoul",
        GITHUB_RUN_ID: runId,
        GITHUB_SHA: sourceSha,
        MOCK_MAIN_SHA: mainSha,
        MOCK_NPM_LATEST: releaseVersion,
        MOCK_RELEASE_CREATED: releaseCreated,
        MOCK_RELEASE_JSON: releaseJson,
        MOCK_RELEASE_PRESENT: "true",
        MOCK_RELEASE_TAG: releaseTag,
        MOCK_SOURCE_SHA: sourceSha,
        RUNNER_TEMP: root,
        VERIFIED_SOURCE_SHA: sourceSha,
        VERIFIED_TAG: releaseTag,
        WORKFLOW_SHA: mainSha,
      };

      const acceptedExisting = await runWorkflowScript(script, environment);
      expect(acceptedExisting.exitCode).toBe(0);
      expect(await readFile(commandLog, "utf8")).not.toContain("release create");

      await writeFile(releaseJson, JSON.stringify({
        ...exactRelease,
        author: { id: 1, login: "attacker", type: "User" },
      }));
      const hostileExisting = await runWorkflowScript(script, environment);
      expect(hostileExisting.exitCode).not.toBe(0);
      expect(hostileExisting.stderr).toContain("not the exact immutable Actions-authored release");

      await writeFile(releaseJson, JSON.stringify(exactRelease));
      await writeFile(commandLog, "");
      const workflowDrift = await runWorkflowScript(script, {
        ...environment,
        MOCK_RELEASE_PRESENT: "false",
        MOCK_WORKFLOW_DRIFT: "true",
      });
      expect(workflowDrift.exitCode).not.toBe(0);
      expect(workflowDrift.stderr).toContain("Tagged and current release workflow controls differ");
      expect(await readFile(commandLog, "utf8")).not.toContain("release create");

      await writeFile(commandLog, "");
      const helperDrift = await runWorkflowScript(script, {
        ...environment,
        MOCK_HELPER_DRIFT: "true",
        MOCK_RELEASE_PRESENT: "false",
      });
      expect(helperDrift.exitCode).not.toBe(0);
      expect(helperDrift.stderr).toContain("Current release verifier controls changed after verification");
      expect(await readFile(commandLog, "utf8")).not.toContain("release create");

      await writeFile(commandLog, "");
      const staleNpm = await runWorkflowScript(script, {
        ...environment,
        MOCK_NPM_LATEST: "0.3.4",
        MOCK_RELEASE_PRESENT: "false",
      });
      expect(staleNpm.exitCode).not.toBe(0);
      expect(staleNpm.stdout).toContain("npm latest advanced before release mutation");
      expect(await readFile(commandLog, "utf8")).not.toContain("release create");

      await writeFile(commandLog, "");
      const created = await runWorkflowScript(script, {
        ...environment,
        MOCK_RELEASE_PRESENT: "false",
      });
      expect(created.exitCode).toBe(0);
      const createdLog = await readFile(commandLog, "utf8");
      expect(createdLog).toContain("release create");
      expect(createdLog).toContain(`--title Ensoul ${releaseTag}`);
      expect(createdLog).toContain(`Source: ${sourceSha}`);
      expect(createdLog).toContain(`actions/runs/${runId}`);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
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
