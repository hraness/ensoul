import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const registry = "https://registry.npmjs.org/";
const provenancePredicate = "https://slsa.dev/provenance/v1";
const publishPredicate = "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";
const workflowBuildType = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const githubHostedBuilder = "https://github.com/actions/runner/github-hosted";
const shaPattern = /^[a-f0-9]{40}$/u;
const stableVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const maximumSafeSemverComponent = BigInt(Number.MAX_SAFE_INTEGER);

export type NpmProvenanceIdentityInput = Readonly<{
  auditJson: string;
  expectedEvent: "push";
  expectedName: string;
  expectedOwnerId: string;
  expectedRef: string;
  expectedRepository: string;
  expectedRepositoryId: string;
  expectedRunId: string;
  expectedMaxRunAttempt: string;
  expectedSourceSha: string;
  expectedVersion: string;
  expectedWorkflowPath: string;
  registryArchive: string;
}>;

export type VerifiedNpmProvenanceIdentity = Readonly<{
  runAttempt: number;
  runId: number;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function exactString(value: unknown, expected: string, label: string): void {
  if (value !== expected) throw new Error(`${label} is not ${expected}`);
}

function decodeCanonicalBase64(value: unknown, label: string): Buffer {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error(`${label} is not canonical base64`);
  return bytes;
}

function positiveId(value: string, label: string): void {
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${label} is not a positive safe integer`);
  }
}

function canonicalAttestationUrl(value: unknown, name: string, version: string): void {
  if (typeof value !== "string") throw new Error("Verified npm attestation URL is missing");
  const url = new URL(value);
  const prefix = "/-/npm/v1/attestations/";
  if (
    url.origin !== "https://registry.npmjs.org"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || !url.pathname.startsWith(prefix)
    || decodeURIComponent(url.pathname.slice(prefix.length)) !== `${name}@${version}`
  ) throw new Error("Verified npm attestation URL is not canonical");
}

export async function verifyNpmProvenanceIdentity(
  input: NpmProvenanceIdentityInput,
): Promise<VerifiedNpmProvenanceIdentity> {
  if (input.expectedName !== "@hraness/soulscrape") throw new Error("Unexpected package name");
  const versionMatch = stableVersionPattern.exec(input.expectedVersion);
  if (
    versionMatch?.[1] === undefined
    || versionMatch[2] === undefined
    || versionMatch[3] === undefined
    || versionMatch.slice(1).some(component => BigInt(component) > maximumSafeSemverComponent)
  ) throw new Error("Expected version is not stable semver");
  if (!shaPattern.test(input.expectedSourceSha)) throw new Error("Expected source SHA is malformed");
  if (input.expectedRef !== `refs/tags/v${input.expectedVersion}`) throw new Error("Expected ref is not the exact stable release tag");
  if (input.expectedWorkflowPath !== ".github/workflows/release.yml") throw new Error("Expected workflow path is not the Release workflow");
  positiveId(input.expectedRepositoryId, "Expected repository ID");
  positiveId(input.expectedOwnerId, "Expected repository owner ID");
  positiveId(input.expectedRunId, "Expected run ID");
  positiveId(input.expectedMaxRunAttempt, "Expected maximum run attempt");

  const [auditBytes, archiveBytes] = await Promise.all([
    readFile(input.auditJson),
    readFile(input.registryArchive),
  ]);
  let audit: Record<string, unknown>;
  try {
    audit = record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(auditBytes)) as unknown,
      "npm signature audit",
    );
  } catch (error) {
    throw new Error("npm signature audit is not valid UTF-8 JSON", { cause: error });
  }
  if (array(audit.invalid, "npm signature audit.invalid").length !== 0) {
    throw new Error("npm signature audit contains invalid entries");
  }
  if (array(audit.missing, "npm signature audit.missing").length !== 0) {
    throw new Error("npm signature audit contains unsigned entries");
  }
  const target = array(audit.verified, "npm signature audit.verified")
    .map((value, index) => record(value, `npm signature audit.verified[${String(index)}]`))
    .filter(value => value.name === input.expectedName && value.version === input.expectedVersion);
  if (target.length !== 1) throw new Error("npm signature audit must verify the exact package once");
  const verified = target[0] as Record<string, unknown>;
  exactString(verified.registry, registry, "Verified npm registry");
  const attestations = record(verified.attestations, "Verified npm attestations");
  canonicalAttestationUrl(attestations.url, input.expectedName, input.expectedVersion);
  const provenance = record(attestations.provenance, "Verified npm provenance descriptor");
  exactString(provenance.predicateType, provenancePredicate, "Verified npm provenance predicate");

  const bundles = array(verified.attestationBundles, "Verified npm attestation bundles")
    .map((value, index) => record(value, `Verified npm attestation bundle ${String(index + 1)}`))
    .filter(value => value.predicateType === provenancePredicate);
  if (bundles.length !== 1) throw new Error("npm signature audit must verify one SLSA provenance bundle");
  const publishBundles = array(verified.attestationBundles, "Verified npm attestation bundles")
    .map((value, index) => record(value, `Verified npm attestation bundle ${String(index + 1)}`))
    .filter(value => value.predicateType === publishPredicate);
  if (publishBundles.length !== 1) throw new Error("npm signature audit must verify one registry publish bundle");
  const bundle = record((bundles[0] as Record<string, unknown>).bundle, "Verified SLSA bundle");
  if (
    typeof bundle.mediaType !== "string"
    || !bundle.mediaType.startsWith("application/vnd.dev.sigstore.bundle")
  ) throw new Error("Verified SLSA bundle media type is unsupported");
  const verification = record(bundle.verificationMaterial, "Verified SLSA verification material");
  if (array(verification.tlogEntries, "Verified SLSA transparency entries").length === 0) {
    throw new Error("Verified SLSA bundle has no transparency entry");
  }
  const envelope = record(bundle.dsseEnvelope, "Verified SLSA DSSE envelope");
  exactString(envelope.payloadType, "application/vnd.in-toto+json", "Verified SLSA payload type");
  if (array(envelope.signatures, "Verified SLSA signatures").length !== 1) {
    throw new Error("Verified SLSA bundle must contain one signature");
  }
  const payloadBytes = decodeCanonicalBase64(envelope.payload, "Verified SLSA payload");
  let statement: Record<string, unknown>;
  try {
    statement = record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes)) as unknown,
      "Verified SLSA statement",
    );
  } catch (error) {
    throw new Error("Verified SLSA payload is not valid UTF-8 JSON", { cause: error });
  }
  exactString(statement._type, "https://in-toto.io/Statement/v1", "Verified SLSA statement type");
  exactString(statement.predicateType, provenancePredicate, "Verified SLSA statement predicate");
  const subjects = array(statement.subject, "Verified SLSA subjects");
  if (subjects.length !== 1) throw new Error("Verified SLSA statement must contain one subject");
  const subject = record(subjects[0], "Verified SLSA subject");
  exactString(
    subject.name,
    `pkg:npm/${input.expectedName.replace(/^@/u, "%40")}@${input.expectedVersion}`,
    "Verified SLSA subject name",
  );
  const digest = record(subject.digest, "Verified SLSA subject digest");
  const expectedSha512 = createHash("sha512").update(archiveBytes).digest("hex");
  if (Object.keys(digest).length !== 1 || digest.sha512 !== expectedSha512) {
    throw new Error("Verified SLSA subject does not bind the registry archive SHA-512");
  }

  const predicate = record(statement.predicate, "Verified SLSA predicate");
  const definition = record(predicate.buildDefinition, "Verified SLSA build definition");
  exactString(definition.buildType, workflowBuildType, "Verified SLSA build type");
  const parameters = record(definition.externalParameters, "Verified SLSA external parameters");
  const workflow = record(parameters.workflow, "Verified SLSA workflow parameters");
  exactString(workflow.ref, input.expectedRef, "Verified SLSA workflow ref");
  exactString(
    workflow.repository,
    `https://github.com/${input.expectedRepository}`,
    "Verified SLSA workflow repository",
  );
  exactString(workflow.path, input.expectedWorkflowPath, "Verified SLSA workflow path");
  const internal = record(definition.internalParameters, "Verified SLSA internal parameters");
  const github = record(internal.github, "Verified SLSA GitHub parameters");
  exactString(github.event_name, input.expectedEvent, "Verified SLSA event");
  exactString(github.repository_id, input.expectedRepositoryId, "Verified SLSA repository ID");
  exactString(github.repository_owner_id, input.expectedOwnerId, "Verified SLSA repository owner ID");
  const dependencies = array(definition.resolvedDependencies, "Verified SLSA dependencies");
  if (dependencies.length !== 1) throw new Error("Verified SLSA statement must contain one source dependency");
  const dependency = record(dependencies[0], "Verified SLSA source dependency");
  exactString(
    dependency.uri,
    `git+https://github.com/${input.expectedRepository}@${input.expectedRef}`,
    "Verified SLSA source URI",
  );
  const sourceDigest = record(dependency.digest, "Verified SLSA source digest");
  if (Object.keys(sourceDigest).length !== 1 || sourceDigest.gitCommit !== input.expectedSourceSha) {
    throw new Error("Verified SLSA source does not bind the released commit");
  }
  const details = record(predicate.runDetails, "Verified SLSA run details");
  const builder = record(details.builder, "Verified SLSA builder");
  exactString(builder.id, githubHostedBuilder, "Verified SLSA builder ID");
  const metadata = record(details.metadata, "Verified SLSA run metadata");
  if (typeof metadata.invocationId !== "string") {
    throw new Error("Verified SLSA invocation is not an exact GitHub Actions attempt");
  }
  const invocation = new URL(metadata.invocationId);
  const invocationMatch = new RegExp(
    `^/${input.expectedRepository.replace("/", "\\/")}/actions/runs/([1-9][0-9]*)/attempts/([1-9][0-9]*)$`,
    "u",
  ).exec(invocation.pathname);
  if (
    invocation.origin !== "https://github.com"
    || invocation.username !== ""
    || invocation.password !== ""
    || invocation.search !== ""
    || invocation.hash !== ""
    || invocationMatch === null
  ) throw new Error("Verified SLSA invocation is not an exact GitHub Actions attempt");
  const runId = Number(invocationMatch[1]);
  const runAttempt = Number(invocationMatch[2]);
  if (!Number.isSafeInteger(runId) || !Number.isSafeInteger(runAttempt)) {
    throw new Error("Verified SLSA invocation has an unsafe numeric identity");
  }

  if (runId !== Number(input.expectedRunId) || runAttempt > Number(input.expectedMaxRunAttempt)) {
    throw new Error("Verified SLSA invocation is outside the current release run and admitted attempts");
  }

  const publishBundle = record(
    (publishBundles[0] as Record<string, unknown>).bundle,
    "Verified npm publish bundle",
  );
  if (
    typeof publishBundle.mediaType !== "string"
    || !publishBundle.mediaType.startsWith("application/vnd.dev.sigstore.bundle")
  ) throw new Error("Verified npm publish bundle media type is unsupported");
  const publishVerification = record(
    publishBundle.verificationMaterial,
    "Verified npm publish verification material",
  );
  if (array(publishVerification.tlogEntries, "Verified npm publish transparency entries").length === 0) {
    throw new Error("Verified npm publish bundle has no transparency entry");
  }
  const publishEnvelope = record(
    publishBundle.dsseEnvelope,
    "Verified npm publish DSSE envelope",
  );
  exactString(
    publishEnvelope.payloadType,
    "application/vnd.in-toto+json",
    "Verified npm publish payload type",
  );
  if (array(publishEnvelope.signatures, "Verified npm publish signatures").length !== 1) {
    throw new Error("Verified npm publish bundle must contain one signature");
  }
  const publishPayload = decodeCanonicalBase64(
    publishEnvelope.payload,
    "Verified npm publish payload",
  );
  let publishStatement: Record<string, unknown>;
  try {
    publishStatement = record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(publishPayload)) as unknown,
      "Verified npm publish statement",
    );
  } catch (error) {
    throw new Error("Verified npm publish payload is not valid UTF-8 JSON", { cause: error });
  }
  exactString(
    publishStatement._type,
    "https://in-toto.io/Statement/v0.1",
    "Verified npm publish statement type",
  );
  exactString(
    publishStatement.predicateType,
    publishPredicate,
    "Verified npm publish statement predicate",
  );
  const publishSubjects = array(publishStatement.subject, "Verified npm publish subjects");
  if (publishSubjects.length !== 1) {
    throw new Error("Verified npm publish statement must contain one subject");
  }
  const publishSubject = record(publishSubjects[0], "Verified npm publish subject");
  exactString(publishSubject.name, subject.name as string, "Verified npm publish subject name");
  const publishDigest = record(publishSubject.digest, "Verified npm publish subject digest");
  if (Object.keys(publishDigest).length !== 1 || publishDigest.sha512 !== expectedSha512) {
    throw new Error("Verified npm publish subject does not bind the registry archive SHA-512");
  }
  const publish = record(publishStatement.predicate, "Verified npm publish predicate");
  exactString(publish.name, input.expectedName, "Verified npm published package name");
  exactString(publish.version, input.expectedVersion, "Verified npm published package version");
  exactString(publish.registry, "https://registry.npmjs.org", "Verified npm publish registry");
  return Object.freeze({ runAttempt, runId });
}

function parseArguments(args: readonly string[]): NpmProvenanceIdentityInput {
  const flags = [
    "--audit-json",
    "--expected-event",
    "--expected-name",
    "--expected-owner-id",
    "--expected-ref",
    "--expected-repository",
    "--expected-repository-id",
    "--expected-run-id",
    "--expected-max-run-attempt",
    "--expected-source-sha",
    "--expected-version",
    "--expected-workflow-path",
    "--registry-archive",
  ] as const;
  if (args.length !== flags.length * 2) throw new Error("npm provenance identity arguments are incomplete");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      flag === undefined
      || value === undefined
      || !flags.includes(flag as (typeof flags)[number])
      || values.has(flag)
    ) throw new Error("npm provenance identity arguments are unknown or duplicated");
    values.set(flag, value);
  }
  const get = (flag: (typeof flags)[number]): string => {
    const value = values.get(flag);
    if (value === undefined) throw new Error(`Missing npm provenance identity argument ${flag}`);
    return value;
  };
  const expectedEvent = get("--expected-event");
  const expectedRef = get("--expected-ref");
  if (expectedEvent !== "push" || !/^refs\/tags\/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(expectedRef)) {
    throw new Error("npm provenance identity requires the protected stable-tag push of the Release workflow");
  }
  return Object.freeze({
    auditJson: get("--audit-json"),
    expectedEvent,
    expectedName: get("--expected-name"),
    expectedOwnerId: get("--expected-owner-id"),
    expectedRef,
    expectedRepository: get("--expected-repository"),
    expectedRepositoryId: get("--expected-repository-id"),
    expectedRunId: get("--expected-run-id"),
    expectedMaxRunAttempt: get("--expected-max-run-attempt"),
    expectedSourceSha: get("--expected-source-sha"),
    expectedVersion: get("--expected-version"),
    expectedWorkflowPath: get("--expected-workflow-path"),
    registryArchive: get("--registry-archive"),
  });
}

if (import.meta.main) {
  const identity = await verifyNpmProvenanceIdentity(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(identity)}\n`);
}
