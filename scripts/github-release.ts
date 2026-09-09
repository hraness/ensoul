#!/usr/bin/env node
/** Canonical release bytes, verified provenance, and non-destructive publication. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "hraness/ensoul";
const REPOSITORY_ID = 1350294135;
const WORKFLOW_ID = 345387950;
const WORKFLOW = ".github/workflows/release.yml";
const OWNER_ID = 894119;
const BOT_ID = 41898282;
const SHA = /^[a-f0-9]{40}$/u;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
type Json = Record<string, any>;
export type Manifest = {
  schema: "hraness-github-release-v1"; repository: typeof REPOSITORY;
  repositoryId: typeof REPOSITORY_ID; package: "@hraness/ensoul";
  version: string; tag: string; sourceSha: string; workflow: typeof WORKFLOW;
  workflowSha: string; runId: number; runAttempt: number;
  archive: { name: string; bytes: number; sha256: string; sha512: string };
};
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown): Json {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "Expected object");
  return value as Json;
}
function keys(value: Json, expected: string[]): void {
  requireThat(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected.sort()), "Unexpected object fields");
}
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
export function versionParts(value: unknown): number[] {
  requireThat(typeof value === "string" && VERSION.test(value), "Expected stable version");
  const parts = value.split(".").map(Number);
  requireThat(parts.every(Number.isSafeInteger), "Version exceeds safe integer range");
  return parts;
}
export function compareVersions(left: string, right: string): number {
  const a = versionParts(left); const b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return 0;
}
export function parseManifest(value: unknown): Manifest {
  const m = object(value);
  keys(m, ["schema", "repository", "repositoryId", "package", "version", "tag", "sourceSha", "workflow", "workflowSha", "runId", "runAttempt", "archive"]);
  versionParts(m.version);
  requireThat(m.schema === "hraness-github-release-v1" && m.repository === REPOSITORY && m.repositoryId === REPOSITORY_ID && m.package === "@hraness/ensoul" && m.workflow === WORKFLOW, "Wrong release identity");
  requireThat(m.tag === `v${m.version}` && typeof m.sourceSha === "string" && SHA.test(m.sourceSha) && typeof m.workflowSha === "string" && SHA.test(m.workflowSha) && positive(m.runId) && positive(m.runAttempt), "Invalid release source or attempt");
  const a = object(m.archive);
  keys(a, ["name", "bytes", "sha256", "sha512"]);
  requireThat(a.name === `hraness-ensoul-${m.version}.tgz` && positive(a.bytes) && a.bytes <= 512 * 1024 && typeof a.sha256 === "string" && /^[a-f0-9]{64}$/u.test(a.sha256) && typeof a.sha512 === "string" && /^[a-f0-9]{128}$/u.test(a.sha512), "Invalid archive identity");
  return m as Manifest;
}
export const digest = (bytes: Uint8Array, algorithm = "sha256"): string => createHash(algorithm).update(bytes).digest("hex");
export function assetNames(m: Manifest): string[] { return [m.archive.name, "npm-pack.json", "release-manifest.json", "SHA256SUMS", "provenance.jsonl"]; }
function file(directory: string, name: string, limit = 16 * 1024 * 1024): Buffer {
  requireThat(basename(name) === name && name !== "." && name !== "..", "Unsafe asset path");
  const path = join(directory, name); const stat = lstatSync(path);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit, "Unsafe asset type or size");
  return readFileSync(path);
}
export function verifyFiles(directory: string, withProvenance = true): Manifest {
  requireThat(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(), "Unsafe release directory");
  const m = parseManifest(JSON.parse(file(directory, "release-manifest.json", 8192).toString("utf8")));
  const names = assetNames(m).slice(0, withProvenance ? 5 : 4);
  requireThat(JSON.stringify(readdirSync(directory).sort()) === JSON.stringify([...names].sort()), "Unexpected release files");
  const archive = file(directory, m.archive.name, 512 * 1024);
  requireThat(archive.length === m.archive.bytes && digest(archive) === m.archive.sha256 && digest(archive, "sha512") === m.archive.sha512, "Archive digest mismatch");
  const records: unknown = JSON.parse(file(directory, "npm-pack.json", 65536).toString("utf8"));
  requireThat(Array.isArray(records) && records.length === 1, "Expected one pack receipt");
  const record = object(records[0]);
  requireThat(record.name === m.package && record.version === m.version && record.filename === m.archive.name && record.size === archive.length && record.shasum === digest(archive, "sha1") && record.integrity === `sha512-${createHash("sha512").update(archive).digest("base64")}`, "Pack receipt mismatch");
  const checksums = names.slice(0, 3).map(name => `${digest(file(directory, name))}  ${name}\n`).join("");
  requireThat(file(directory, "SHA256SUMS", 1024).toString("utf8") === checksums, "Checksum manifest mismatch");
  if (withProvenance) file(directory, "provenance.jsonl");
  return m;
}
function env(name: string): string { const v = process.env[name]; requireThat(v, `Missing ${name}`); return v; }
function expectedIdentity(m: Manifest): void {
  requireThat(m.sourceSha === env("VERIFIED_SOURCE_SHA") && m.workflowSha === env("WORKFLOW_SHA") && m.tag === env("VERIFIED_TAG") && m.runId === Number(env("GITHUB_RUN_ID")) && m.runAttempt === Number(env("GITHUB_RUN_ATTEMPT")), "Artifact is not bound to this verified run and attempt");
}
function bindExpectedFiles(directory: string, m: Manifest): void {
  expectedIdentity(m);
  for (const [name, key] of [[m.archive.name, "EXPECTED_ARCHIVE_SHA256"], ["npm-pack.json", "EXPECTED_PACK_SHA256"], ["release-manifest.json", "EXPECTED_MANIFEST_SHA256"], ["SHA256SUMS", "EXPECTED_SUMS_SHA256"], ["provenance.jsonl", "EXPECTED_PROVENANCE_SHA256"]]) {
    const expected = env(key!);
    requireThat(/^[a-f0-9]{64}$/u.test(expected) && digest(file(directory, name!)) === expected, `Handoff differs from trusted ${key}`);
  }
}
function command(binary: string, args: string[]): string {
  return execFileSync(binary, args, { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function gh(args: string[]): string { return command("gh", args); }
function api(path: string, options: string[] = []): Json { return object(JSON.parse(gh(["api", "--method", "GET", `/repos/${REPOSITORY}${path}`, ...options]))); }
function optionalRelease(path: string): Json | undefined {
  try { return api(path); } catch (error) {
    const e = error as {stderr?: Buffer | string};
    if (/\(HTTP 404\)\s*$/u.test(String(e.stderr ?? ""))) return undefined;
    throw error;
  }
}
// Drafts are omitted by GET /releases/tags/{tag}; enumerate authenticated
// releases before creating one, then retain its immutable provider ID.
function findRelease(tag: string): Json | undefined {
  const seen = new Set<number>(); const matches: Json[] = [];
  for (let page = 1; page <= 20; page++) {
    const entries = JSON.parse(gh(["api", "--method", "GET", `/repos/${REPOSITORY}/releases?per_page=100&page=${page}`]));
    requireThat(Array.isArray(entries) && entries.length <= 100, "Invalid releases page");
    for (const value of entries) {
      const entry = object(value);
      requireThat(positive(entry.id) && !seen.has(entry.id) && typeof entry.tag_name === "string", "Ambiguous release enumeration");
      seen.add(entry.id);
      if (entry.tag_name === tag) matches.push(entry);
    }
    requireThat(matches.length <= 1, "Multiple releases identify this tag");
    if (entries.length < 100) {
      if (!matches.length) return undefined;
      const release = api(`/releases/${matches[0]!.id}`);
      requireThat(release.id === matches[0]!.id && release.tag_name === tag, "Release identity changed during discovery");
      return release;
    }
  }
  throw new Error("Release enumeration exceeded its bound");
}
export function verifyAttestationResult(value: unknown, m: Manifest, subjects: Record<string, string>): void {
  requireThat(Array.isArray(value) && value.length === 1, "Expected one verified provenance statement");
  const result = object(object(value[0]).verificationResult);
  const certificate = object(object(result.signature).certificate);
  requireThat(certificate.issuer === "https://token.actions.githubusercontent.com" && certificate.runnerEnvironment === "github-hosted" && certificate.sourceRepositoryURI === `https://github.com/${REPOSITORY}` && certificate.sourceRepositoryIdentifier === String(REPOSITORY_ID) && certificate.sourceRepositoryDigest === m.sourceSha && certificate.sourceRepositoryRef === `refs/tags/${m.tag}` && certificate.buildSignerDigest === m.sourceSha && certificate.buildConfigDigest === m.sourceSha && certificate.buildTrigger === "push" && certificate.runInvocationURI === `https://github.com/${REPOSITORY}/actions/runs/${m.runId}/attempts/${m.runAttempt}`, "Verified certificate has wrong source, runner, or attempt");
  const workflowUri = `https://github.com/${REPOSITORY}/${WORKFLOW}@refs/tags/${m.tag}`;
  requireThat(certificate.buildSignerURI === workflowUri && certificate.buildConfigURI === workflowUri, "Verified certificate has wrong workflow URI");
  const statement = object(result.statement);
  requireThat(statement._type === "https://in-toto.io/Statement/v1" && statement.predicateType === "https://slsa.dev/provenance/v1" && Array.isArray(statement.subject) && statement.subject.length === Object.keys(subjects).length, "Wrong provenance statement");
  const predicate = object(statement.predicate);
  const definition = object(predicate.buildDefinition);
  const sourceWorkflow = object(object(definition.externalParameters).workflow);
  const github = object(object(definition.internalParameters).github);
  const details = object(predicate.runDetails);
  requireThat(definition.buildType === "https://actions.github.io/buildtypes/workflow/v1" && sourceWorkflow.repository === `https://github.com/${REPOSITORY}` && sourceWorkflow.path === WORKFLOW && sourceWorkflow.ref === `refs/tags/${m.tag}` && String(github.repository_id) === String(REPOSITORY_ID) && String(github.repository_owner_id) === "307125679" && github.event_name === "push" && github.runner_environment === "github-hosted" && object(details.builder).id === workflowUri && object(details.metadata).invocationId === `https://github.com/${REPOSITORY}/actions/runs/${m.runId}/attempts/${m.runAttempt}`, "Verified provenance has wrong build, workflow, or invocation");
  requireThat(Array.isArray(definition.resolvedDependencies) && definition.resolvedDependencies.length === 1, "Expected one provenance source dependency");
  const source = object(definition.resolvedDependencies[0]);
  requireThat(source.uri === `git+https://github.com/${REPOSITORY}@refs/tags/${m.tag}` && object(source.digest).gitCommit === m.sourceSha, "Provenance source dependency differs");
  const seen = new Set<string>();
  for (const item of statement.subject) {
    const subject = object(item); const hash = object(subject.digest);
    requireThat(typeof subject.name === "string" && Object.hasOwn(subjects, subject.name) && !seen.has(subject.name) && hash.sha256 === subjects[subject.name], "Provenance subject mismatch");
    seen.add(subject.name);
  }
}
function verifyProvenance(directory: string, m: Manifest): void {
  const subjects = Object.fromEntries(assetNames(m).slice(0, 4).map(name => [name, digest(file(directory, name))]));
  for (const name of Object.keys(subjects)) {
    const verified = JSON.parse(gh(["attestation", "verify", join(directory, name), "--repo", REPOSITORY, "--signer-workflow", `${REPOSITORY}/${WORKFLOW}`, "--signer-digest", m.sourceSha, "--source-digest", m.sourceSha, "--source-ref", `refs/tags/${m.tag}`, "--deny-self-hosted-runners", "--bundle", join(directory, "provenance.jsonl"), "--format", "json"]));
    verifyAttestationResult(verified, m, subjects);
  }
}
export function verifyAttempt(attempt: Json, m: Manifest, current: boolean): void {
  requireThat(attempt.id === m.runId && attempt.run_attempt === m.runAttempt && attempt.workflow_id === WORKFLOW_ID && attempt.name === "release" && attempt.path === WORKFLOW && attempt.event === "push" && attempt.head_branch === m.tag && attempt.head_sha === m.sourceSha && attempt.actor?.id === OWNER_ID && attempt.actor?.type === "User" && attempt.triggering_actor?.id === OWNER_ID && attempt.triggering_actor?.type === "User" && attempt.repository?.id === REPOSITORY_ID && attempt.repository?.full_name === REPOSITORY && attempt.repository?.private === false, "Release attempt is not owner-authorized");
  requireThat(current ? attempt.status === "in_progress" && attempt.conclusion === null : attempt.status === "completed" && attempt.conclusion === "success", "Release attempt has not passed the required state");
}
function controls(m: Manifest): void {
  expectedIdentity(m);
  requireThat(env("GITHUB_REPOSITORY") === REPOSITORY && env("GITHUB_REPOSITORY_ID") === String(REPOSITORY_ID) && env("GITHUB_SHA") === m.sourceSha && env("GITHUB_REF") === `refs/tags/${m.tag}` && env("GITHUB_EVENT_NAME") === "push" && env("IMMUTABLE_RELEASES_ENABLED") === "true", "Release environment is not authorized");
  verifyAttempt(api(`/actions/runs/${m.runId}/attempts/${m.runAttempt}`), m, true);
  const repository = api(""); const workflow = api(`/actions/workflows/${WORKFLOW_ID}`);
  requireThat(repository.id === REPOSITORY_ID && repository.full_name === REPOSITORY && repository.private === false && repository.visibility === "public" && repository.default_branch === "main" && workflow.id === WORKFLOW_ID && workflow.name === "release" && workflow.path === WORKFLOW && workflow.state === "active", "Live repository or workflow authority changed");
  const tag = api(`/git/ref/tags/${m.tag}`);
  requireThat(tag.object?.type === "tag" && SHA.test(tag.object.sha ?? ""), "Release requires an annotated tag");
  const annotated = api(`/git/tags/${tag.object.sha}`);
  requireThat(annotated.object?.type === "commit" && annotated.object.sha === m.sourceSha, "Release tag moved");
  const advertised = api("/commits/main").sha;
  requireThat(typeof advertised === "string" && SHA.test(advertised), "Invalid current main");
  command("git", ["fetch", "--no-tags", "--force", "origin", "refs/heads/main:refs/remotes/ensoul-release-current/main"]);
  const main = command("git", ["rev-parse", "refs/remotes/ensoul-release-current/main"]);
  requireThat(main === advertised, "Current main moved during authority import");
  for (const ancestor of [m.sourceSha, m.workflowSha]) command("git", ["merge-base", "--is-ancestor", ancestor, main]);
  command("git", ["diff", "--quiet", "--no-ext-diff", "--no-textconv", m.sourceSha, main, "--", WORKFLOW, ".github/workflows/npm-stage.yml"]);
  command("git", ["diff", "--quiet", "--no-ext-diff", "--no-textconv", m.workflowSha, main, "--", "scripts/package-smoke.ts", "scripts/github-release.ts"]);
  for (const line of command("git", ["ls-remote", "--tags", "--refs", "origin", "refs/tags/v*"]).split("\n")) {
    const version = line.split("\t")[1]?.replace(/^refs\/tags\/v/u, "");
    if (version && VERSION.test(version)) requireThat(compareVersions(version, m.version) <= 0, "A newer stable tag exists");
  }
  const latest = optionalRelease("/releases/latest");
  if (latest) {
    requireThat(typeof latest.tag_name === "string" && latest.tag_name.startsWith("v") && latest.immutable === true && latest.draft === false && latest.prerelease === false, "Latest is not an immutable stable release");
    requireThat(compareVersions(latest.tag_name.slice(1), m.version) <= 0, "A newer canonical release exists");
  }
}
export function releaseBody(m: Manifest): string {
  return `Automated immutable Ensoul release.\n\nSource: ${m.sourceSha}\nWorkflow: ${WORKFLOW}\nRun: https://github.com/${REPOSITORY}/actions/runs/${m.runId}/attempts/${m.runAttempt}\n\nInstall: npm install https://github.com/${REPOSITORY}/releases/download/${m.tag}/${m.archive.name}`;
}
export function verifyReleaseRecord(release: Json, m: Manifest, directory: string, allowDraft: boolean): void {
  requireThat(positive(release.id) && release.tag_name === m.tag && release.name === `Ensoul ${m.tag}` && release.body === releaseBody(m) && release.target_commitish === m.sourceSha && release.prerelease === false && release.author?.id === BOT_ID && release.author?.login === "github-actions[bot]" && release.author?.type === "Bot", "Existing release has different source, owner, or run");
  requireThat(release.draft === false ? release.immutable === true : allowDraft && release.draft === true && release.immutable !== true, "Release is not the expected draft or immutable record");
  requireThat(Array.isArray(release.assets) && release.assets.length <= 5 && (release.draft || release.assets.length === 5), "Unexpected release assets");
  const seen = new Set<string>(); const ids = new Set<number>();
  for (const a of release.assets) {
    requireThat(assetNames(m).includes(a.name) && !seen.has(a.name) && !ids.has(a.id) && positive(a.id) && a.state === "uploaded", "Unexpected, duplicate, or incomplete release asset");
    const bytes = file(directory, a.name);
    requireThat(a.size === bytes.length && a.digest === `sha256:${digest(bytes)}`, "Release asset size or digest differs");
    seen.add(a.name); ids.add(a.id);
  }
}
function verifyRemoteBytes(release: Json, directory: string): void {
  for (const asset of release.assets) {
    const bytes = execFileSync("gh", ["api", "--method", "GET", `/repos/${REPOSITORY}/releases/assets/${asset.id}`, "-H", "Accept: application/octet-stream"], { timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    requireThat(bytes.equals(file(directory, asset.name)), "Remote asset bytes differ");
  }
}
function publish(directory: string): void {
  const m = verifyFiles(directory); bindExpectedFiles(directory, m); verifyProvenance(directory, m); controls(m);
  let release = findRelease(m.tag);
  if (!release) {
    controls(m);
    release = object(JSON.parse(gh(["api", "--method", "POST", `/repos/${REPOSITORY}/releases`,
      "-f", `tag_name=${m.tag}`, "-f", `target_commitish=${m.sourceSha}`,
      "-f", `name=Ensoul ${m.tag}`, "-f", `body=${releaseBody(m)}`,
      "-F", "draft=true", "-F", "prerelease=false"])));
    // The creation response is authoritative; draft discovery can omit a
    // newly created record. Retain its ID instead of querying the list again.
  }
  verifyReleaseRecord(release, m, directory, true); verifyRemoteBytes(release, directory);
  if (release.draft) {
    for (const name of assetNames(m)) if (!release.assets.some((a: Json) => a.name === name)) {
      controls(m);
      gh(["release", "upload", m.tag, join(directory, name), "--repo", REPOSITORY]);
    }
    release = api(`/releases/${release.id}`);
    verifyReleaseRecord(release, m, directory, true);
    requireThat(release.assets.length === 5, "Draft is missing release assets");
    verifyRemoteBytes(release, directory); controls(m);
    gh(["release", "edit", m.tag, "--repo", REPOSITORY, "--draft=false", "--latest"]);
  }
  const published = api(`/releases/${release.id}`);
  verifyReleaseRecord(published, m, directory, false); verifyRemoteBytes(published, directory);
  requireThat(api("/releases/latest").id === published.id, "Canonical latest readback differs");
  process.stdout.write(`Published ${m.tag} from ${m.sourceSha} with five verified assets\n`);
}
function prepare(directory: string): void {
  const pack = JSON.parse(file(directory, "npm-pack.json", 65536).toString("utf8"));
  requireThat(Array.isArray(pack) && pack.length === 1, "Expected one package");
  const record = object(pack[0]); versionParts(record.version);
  requireThat(record.name === "@hraness/ensoul" && record.filename === `hraness-ensoul-${record.version}.tgz`, "Wrong packed package");
  const archive = file(directory, record.filename, 512 * 1024);
  const m = parseManifest({ schema: "hraness-github-release-v1", repository: REPOSITORY, repositoryId: REPOSITORY_ID, package: "@hraness/ensoul", version: record.version, tag: env("VERIFIED_TAG"), sourceSha: env("VERIFIED_SOURCE_SHA"), workflow: WORKFLOW, workflowSha: env("WORKFLOW_SHA"), runId: Number(env("GITHUB_RUN_ID")), runAttempt: Number(env("GITHUB_RUN_ATTEMPT")), archive: {name: record.filename, bytes: archive.length, sha256: digest(archive), sha512: digest(archive, "sha512")} });
  writeFileSync(join(directory, "release-manifest.json"), `${JSON.stringify(m, null, 2)}\n`, {flag: "wx"});
  writeFileSync(join(directory, "SHA256SUMS"), assetNames(m).slice(0, 3).map(name => `${digest(file(directory, name))}  ${name}\n`).join(""), {flag: "wx"});
  verifyFiles(directory, false);
  for (const [name, key] of [[m.archive.name, "archive_sha256"], ["npm-pack.json", "pack_sha256"], ["release-manifest.json", "manifest_sha256"], ["SHA256SUMS", "sums_sha256"]]) {
    writeFileSync(env("GITHUB_OUTPUT"), `${key}=${digest(file(directory, name!))}\n`, {flag: "a"});
  }
}
function downloadMirror(directory: string): void {
  const version = env("EXPECTED_VERSION"); versionParts(version);
  mkdirSync(directory, {recursive: true});
  requireThat(readdirSync(directory).length === 0, "Mirror destination must be empty");
  const release = api(`/releases/tags/v${version}`);
  requireThat(release.immutable === true && release.draft === false && Array.isArray(release.assets) && release.assets.length === 5, "Canonical immutable release is required before npm mirroring");
  const names = [`hraness-ensoul-${version}.tgz`, "npm-pack.json", "release-manifest.json", "SHA256SUMS", "provenance.jsonl"];
  requireThat(JSON.stringify(release.assets.map((a: Json) => a.name).sort()) === JSON.stringify([...names].sort()), "Unexpected canonical assets");
  gh(["release", "download", `v${version}`, "--repo", REPOSITORY, "--dir", directory]);
  const m = verifyFiles(directory);
  requireThat(m.version === version && m.sourceSha === env("EXPECTED_SOURCE_SHA"), "Canonical artifact source differs from verified current main");
  verifyReleaseRecord(release, m, directory, false); verifyProvenance(directory, m);
  verifyAttempt(api(`/actions/runs/${m.runId}/attempts/${m.runAttempt}`), m, false);
  const tag = api(`/git/ref/tags/${m.tag}`);
  requireThat(tag.object?.type === "tag" && SHA.test(tag.object.sha ?? ""), "Canonical tag is not annotated");
  const annotated = api(`/git/tags/${tag.object.sha}`);
  requireThat(annotated.object?.type === "commit" && annotated.object.sha === m.sourceSha, "Canonical tag moved");
  verifyRemoteBytes(release, directory);
  const current = api("/commits/main").sha;
  requireThat(typeof current === "string" && SHA.test(current) && current === env("EXPECTED_WORKFLOW_SHA") && current === env("GITHUB_SHA") && env("GITHUB_REF") === "refs/heads/main", "Mirror workflow is no longer current main");
  const comparison = api(`/compare/${m.sourceSha}...${current}`);
  requireThat(comparison.status === "ahead" || comparison.status === "identical", "Canonical source is not on current main");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, directory] = process.argv.slice(2);
    requireThat(directory && process.argv.length === 4, "Usage: github-release.ts prepare|verify|publish|mirror DIRECTORY");
    if (mode === "prepare") prepare(directory);
    else if (mode === "verify") { const m = verifyFiles(directory); bindExpectedFiles(directory, m); verifyProvenance(directory, m); }
    else if (mode === "publish") publish(directory);
    else if (mode === "mirror") downloadMirror(directory);
    else throw new Error("Unknown release operation");
  } catch (error) { process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
