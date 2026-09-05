import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const PACKAGE_NAME = "@hraness/ensoul";
const REPOSITORY = "hraness/ensoul";
const REPOSITORY_ID = "1350294135";
const REPOSITORY_OWNER_ID = "307125679";
const WORKFLOW_PATH = ".github/workflows/npm-stage.yml";
const REGISTRY = "https://registry.npmjs.org";
const PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";
const PUBLISH_PREDICATE = "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";
const WORKFLOW_BUILD_TYPE = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const GITHUB_HOSTED_BUILDER = "https://github.com/actions/runner/github-hosted";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const STABLE_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;

export type NpmProvenanceIdentityInput = Readonly<{
  auditJson: string;
  expectedSourceSha: string;
  expectedVersion: string;
  registryArchive: string;
  registryViewJson: string;
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
  if (
    typeof value !== "string"
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) throw new Error(`${label} is not canonical base64`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error(`${label} is not canonical base64`);
  return bytes;
}

function stableVersion(value: string): void {
  const match = STABLE_VERSION_PATTERN.exec(value);
  if (match === null || match.slice(1).some(part => !Number.isSafeInteger(Number(part)))) {
    throw new Error("Expected version is not stable semantic version");
  }
}

function canonicalAttestationUrl(value: unknown, version: string): void {
  if (typeof value !== "string") throw new Error("Verified npm attestation URL is missing");
  const url = new URL(value);
  const prefix = "/-/npm/v1/attestations/";
  if (
    url.origin !== REGISTRY
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || !url.pathname.startsWith(prefix)
    || decodeURIComponent(url.pathname.slice(prefix.length)) !== `${PACKAGE_NAME}@${version}`
  ) throw new Error("Verified npm attestation URL is not canonical");
}

function canonicalTarballUrl(value: unknown, version: string): void {
  if (typeof value !== "string") throw new Error("npm registry tarball URL is missing");
  const url = new URL(value);
  if (
    url.origin !== REGISTRY
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.pathname !== `/@hraness/ensoul/-/ensoul-${version}.tgz`
  ) throw new Error("npm registry tarball URL is not canonical");
}

function statementFromBundle(
  bundleDescriptor: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  const bundle = record(bundleDescriptor.bundle, `${label} bundle`);
  if (
    typeof bundle.mediaType !== "string"
    || !bundle.mediaType.startsWith("application/vnd.dev.sigstore.bundle")
  ) throw new Error(`${label} bundle media type is unsupported`);
  const verification = record(bundle.verificationMaterial, `${label} verification material`);
  if (array(verification.tlogEntries, `${label} transparency entries`).length === 0) {
    throw new Error(`${label} bundle has no transparency entry`);
  }
  const envelope = record(bundle.dsseEnvelope, `${label} DSSE envelope`);
  exactString(envelope.payloadType, "application/vnd.in-toto+json", `${label} payload type`);
  const signatures = array(envelope.signatures, `${label} signatures`);
  if (signatures.length !== 1) throw new Error(`${label} bundle must contain one signature`);
  const signature = record(signatures[0], `${label} signature`);
  if (typeof signature.sig !== "string" || signature.sig.length === 0) {
    throw new Error(`${label} signature is empty`);
  }
  const payload = decodeCanonicalBase64(envelope.payload, `${label} payload`);
  try {
    return record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)) as unknown,
      `${label} statement`,
    );
  } catch (error) {
    throw new Error(`${label} payload is not valid UTF-8 JSON`, { cause: error });
  }
}

function exactSha512Digest(value: unknown, expected: string, label: string): void {
  const digest = record(value, label);
  if (Object.keys(digest).length !== 1 || digest.sha512 !== expected) {
    throw new Error(`${label} does not bind the registry archive SHA-512`);
  }
}

function invocationIdentity(value: unknown): VerifiedNpmProvenanceIdentity {
  if (typeof value !== "string") throw new Error("Verified SLSA invocation is missing");
  const url = new URL(value);
  const match = /^\/hraness\/ensoul\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/u.exec(url.pathname);
  if (
    url.origin !== "https://github.com"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || match === null
  ) throw new Error("Verified SLSA invocation is not an exact Ensoul Actions attempt");
  const runId = Number(match[1]);
  const runAttempt = Number(match[2]);
  if (!Number.isSafeInteger(runId) || !Number.isSafeInteger(runAttempt)) {
    throw new Error("Verified SLSA invocation uses an unsafe numeric identity");
  }
  return Object.freeze({ runAttempt, runId });
}

export async function verifyNpmProvenanceIdentity(
  input: NpmProvenanceIdentityInput,
): Promise<VerifiedNpmProvenanceIdentity> {
  stableVersion(input.expectedVersion);
  if (!SHA_PATTERN.test(input.expectedSourceSha)) throw new Error("Expected source SHA is malformed");
  const [auditBytes, archiveBytes, viewBytes] = await Promise.all([
    readFile(input.auditJson),
    readFile(input.registryArchive),
    readFile(input.registryViewJson),
  ]);
  const archiveSha1 = createHash("sha1").update(archiveBytes).digest("hex");
  const archiveSha512Hex = createHash("sha512").update(archiveBytes).digest("hex");
  const archiveIntegrity = `sha512-${createHash("sha512").update(archiveBytes).digest("base64")}`;

  let view: Record<string, unknown>;
  try {
    view = record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(viewBytes)) as unknown,
      "npm registry view",
    );
  } catch (error) {
    throw new Error("npm registry view is not valid UTF-8 JSON", { cause: error });
  }
  exactString(view.name, PACKAGE_NAME, "npm registry package name");
  exactString(view.version, input.expectedVersion, "npm registry package version");
  const dist = record(view.dist, "npm registry dist metadata");
  canonicalTarballUrl(dist.tarball, input.expectedVersion);
  exactString(dist.shasum, archiveSha1, "npm registry SHA-1");
  exactString(dist.integrity, archiveIntegrity, "npm registry integrity");
  const registrySignatures = array(dist.signatures, "npm registry signatures");
  if (registrySignatures.length === 0) throw new Error("npm registry package has no signatures");
  for (const [index, value] of registrySignatures.entries()) {
    const signature = record(value, `npm registry signature ${String(index + 1)}`);
    if (
      typeof signature.keyid !== "string"
      || !/^SHA256:[A-Za-z0-9+/]+={0,2}$/u.test(signature.keyid)
      || typeof signature.sig !== "string"
    ) throw new Error("npm registry signature metadata is malformed");
    decodeCanonicalBase64(signature.sig, `npm registry signature ${String(index + 1)}`);
  }
  const registryAttestations = record(dist.attestations, "npm registry attestations");
  canonicalAttestationUrl(registryAttestations.url, input.expectedVersion);
  const registryProvenance = record(registryAttestations.provenance, "npm registry provenance");
  exactString(registryProvenance.predicateType, PROVENANCE_PREDICATE, "npm registry provenance predicate");

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
  const verifiedPackages = array(audit.verified, "npm signature audit.verified")
    .map((value, index) => record(value, `npm signature audit.verified[${String(index)}]`));
  if (
    verifiedPackages.length !== 1
    || verifiedPackages[0]?.name !== PACKAGE_NAME
    || verifiedPackages[0]?.version !== input.expectedVersion
  ) throw new Error("npm signature audit must verify only the exact Ensoul package");
  const verified = verifiedPackages[0]!;
  exactString(verified.registry, `${REGISTRY}/`, "Verified npm registry");
  const verifiedAttestations = record(verified.attestations, "Verified npm attestations");
  canonicalAttestationUrl(verifiedAttestations.url, input.expectedVersion);
  const verifiedProvenance = record(verifiedAttestations.provenance, "Verified npm provenance descriptor");
  exactString(verifiedProvenance.predicateType, PROVENANCE_PREDICATE, "Verified npm provenance predicate");

  const bundles = array(verified.attestationBundles, "Verified npm attestation bundles")
    .map((value, index) => record(value, `Verified npm attestation bundle ${String(index + 1)}`));
  const provenanceBundles = bundles.filter(value => value.predicateType === PROVENANCE_PREDICATE);
  const publishBundles = bundles.filter(value => value.predicateType === PUBLISH_PREDICATE);
  if (bundles.length !== 2 || provenanceBundles.length !== 1 || publishBundles.length !== 1) {
    throw new Error("npm signature audit must verify exactly one publish and one SLSA provenance bundle");
  }

  const purl = `pkg:npm/%40hraness/ensoul@${input.expectedVersion}`;
  const provenanceStatement = statementFromBundle(provenanceBundles[0]!, "Verified SLSA");
  exactString(provenanceStatement._type, "https://in-toto.io/Statement/v1", "Verified SLSA statement type");
  exactString(provenanceStatement.predicateType, PROVENANCE_PREDICATE, "Verified SLSA statement predicate");
  const subjects = array(provenanceStatement.subject, "Verified SLSA subjects");
  if (subjects.length !== 1) throw new Error("Verified SLSA statement must contain one subject");
  const subject = record(subjects[0], "Verified SLSA subject");
  exactString(subject.name, purl, "Verified SLSA subject name");
  exactSha512Digest(subject.digest, archiveSha512Hex, "Verified SLSA subject digest");
  const predicate = record(provenanceStatement.predicate, "Verified SLSA predicate");
  const definition = record(predicate.buildDefinition, "Verified SLSA build definition");
  exactString(definition.buildType, WORKFLOW_BUILD_TYPE, "Verified SLSA build type");
  const parameters = record(definition.externalParameters, "Verified SLSA external parameters");
  const workflow = record(parameters.workflow, "Verified SLSA workflow parameters");
  exactString(workflow.ref, "refs/heads/main", "Verified SLSA workflow ref");
  exactString(workflow.repository, `https://github.com/${REPOSITORY}`, "Verified SLSA workflow repository");
  exactString(workflow.path, WORKFLOW_PATH, "Verified SLSA workflow path");
  const internal = record(definition.internalParameters, "Verified SLSA internal parameters");
  const github = record(internal.github, "Verified SLSA GitHub parameters");
  exactString(github.event_name, "workflow_dispatch", "Verified SLSA event");
  exactString(github.repository_id, REPOSITORY_ID, "Verified SLSA repository ID");
  exactString(github.repository_owner_id, REPOSITORY_OWNER_ID, "Verified SLSA repository owner ID");
  const dependencies = array(definition.resolvedDependencies, "Verified SLSA dependencies");
  if (dependencies.length !== 1) throw new Error("Verified SLSA statement must contain one source dependency");
  const dependency = record(dependencies[0], "Verified SLSA source dependency");
  exactString(dependency.uri, `git+https://github.com/${REPOSITORY}@refs/heads/main`, "Verified SLSA source URI");
  const sourceDigest = record(dependency.digest, "Verified SLSA source digest");
  if (Object.keys(sourceDigest).length !== 1 || sourceDigest.gitCommit !== input.expectedSourceSha) {
    throw new Error("Verified SLSA source does not bind the staged commit");
  }
  const details = record(predicate.runDetails, "Verified SLSA run details");
  const builder = record(details.builder, "Verified SLSA builder");
  exactString(builder.id, GITHUB_HOSTED_BUILDER, "Verified SLSA builder ID");
  const metadata = record(details.metadata, "Verified SLSA run metadata");
  const invocation = invocationIdentity(metadata.invocationId);

  const publishStatement = statementFromBundle(publishBundles[0]!, "Verified npm publish");
  exactString(publishStatement._type, "https://in-toto.io/Statement/v0.1", "Verified npm publish statement type");
  exactString(publishStatement.predicateType, PUBLISH_PREDICATE, "Verified npm publish statement predicate");
  const publishSubjects = array(publishStatement.subject, "Verified npm publish subjects");
  if (publishSubjects.length !== 1) throw new Error("Verified npm publish statement must contain one subject");
  const publishSubject = record(publishSubjects[0], "Verified npm publish subject");
  exactString(publishSubject.name, purl, "Verified npm publish subject name");
  exactSha512Digest(publishSubject.digest, archiveSha512Hex, "Verified npm publish subject digest");
  const publish = record(publishStatement.predicate, "Verified npm publish predicate");
  exactString(publish.name, PACKAGE_NAME, "Verified npm package name");
  exactString(publish.version, input.expectedVersion, "Verified npm package version");
  exactString(publish.registry, REGISTRY, "Verified npm publish registry");
  return invocation;
}

function parseArguments(args: readonly string[]): NpmProvenanceIdentityInput {
  const flags = [
    "--audit-json",
    "--expected-source-sha",
    "--expected-version",
    "--registry-archive",
    "--registry-view-json",
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
  return Object.freeze({
    auditJson: get("--audit-json"),
    expectedSourceSha: get("--expected-source-sha"),
    expectedVersion: get("--expected-version"),
    registryArchive: get("--registry-archive"),
    registryViewJson: get("--registry-view-json"),
  });
}

if (import.meta.main) {
  const identity = await verifyNpmProvenanceIdentity(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(identity)}\n`);
}
