import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  MAX_RECORD_CONTENT_BYTES,
  boundedContent,
  main,
} from "../skills/ensoul/scripts/prepare-x-archive.ts";
import { canonicalBytes, sha256Hex, strictJsonParse } from "../skills/ensoul/scripts/source-packet.ts";
import {
  validateSourcePacket,
  validateSourcePacketFile,
} from "../skills/ensoul/scripts/validate-source-packet.ts";
import { assignment, zipFixture } from "./x-archive-fixture.ts";

const ROOT = resolve(import.meta.dir, "..");
const temporaries: string[] = [];

afterEach(() => {
  for (const directory of temporaries.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporary(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "ensoul-x-test-")));
  temporaries.push(directory);
  return directory;
}

function publicPosts(): unknown[] {
  return [
    { tweet: { id_str: "1", created_at: "Mon Jan 01 12:00:00 +0000 2024", full_text: "first public post" } },
    { tweet: { id_str: "2", created_at: "Tue Jan 02 12:00:00 +0000 2024", full_text: "RT @someone: quoted third-party prose" } },
    { tweet: { id_str: "3", created_at: "Wed Jan 03 12:00:00 +0000 2024", full_text: "a reply", in_reply_to_status_id_str: "99" } },
  ];
}

function writeArchive(directory: string, posts: readonly unknown[] = publicPosts(), extra: readonly Readonly<{ name: string; value: string }>[] = []): string {
  const path = join(directory, "twitter.zip");
  writeFileSync(path, zipFixture([
    { name: "data/tweets.js", value: assignment("tweets", posts), deflate: true },
    { name: "data/direct-messages.js", value: "PRIVATE_DM_CANARY" },
    { name: "data/ad-engagements.js", value: "PRIVATE_AD_CANARY" },
    ...extra,
  ]), { mode: 0o600 });
  return path;
}

function run(archive: string, output: string, additional: readonly string[] = []): number {
  return main([archive, "--output", output, ...additional]);
}

function syntheticPacket(adapter: "message-like-me" | "peopleblade"): Record<string, any> {
  const isMessage = adapter === "message-like-me";
  const content = { text: "synthetic evidence", truncated: false };
  const record: Record<string, any> = {
    id: `${adapter}:record:1`,
    kind: isMessage ? "message" : "web_evidence",
    [isMessage ? "occurredAt" : "observedAt"]: "2026-08-20T12:00:00Z",
    authorRole: isMessage ? "subject" : "unknown",
    contentRole: isMessage ? "original" : "summary",
    authorshipConfidence: isMessage ? "strong" : "unknown",
    sentStatus: isMessage ? "sent" : "published",
    visibility: isMessage ? "private" : "public",
    sourceClass: isMessage ? "private_capture" : "public_web_evidence",
    content,
    provenance: {
      provider: adapter,
      operation: "synthetic-test",
      contentSha256: sha256Hex(canonicalBytes(content)),
    },
  };
  record.digest = `sha256:${sha256Hex(canonicalBytes(record))}`;
  const packet: Record<string, any> = {
    schemaVersion: "ensoul.source-packet.v1",
    digestCanonicalization: "JCS-RFC8785",
    packetId: `synthetic:${adapter}`,
    generatedAt: "2026-08-21T12:00:00Z",
    subject: {
      localId: "synthetic-subject",
      kind: isMessage ? "owner" : "person",
      identityBasis: "synthetic fixture",
    },
    scope: {
      adapter,
      payloadSchema: isMessage ? "ensoul.messages-source.v1" : "ensoul.public-enrichment-source.v1",
      asOf: "2026-08-21T12:00:00Z",
      completeness: "bounded",
      limits: { recordLimit: 1 },
    },
    records: [record],
    claims: [],
    limitations: ["synthetic fixture"],
  };
  packet.packetDigest = `sha256:${sha256Hex(canonicalBytes(packet))}`;
  return packet;
}

function redigest(packet: Record<string, any>, records = false): void {
  if (records) {
    for (const record of packet.records as Record<string, any>[]) {
      const withoutDigest = { ...record };
      delete withoutDigest.digest;
      record.digest = `sha256:${sha256Hex(canonicalBytes(withoutDigest))}`;
    }
  }
  const withoutDigest = { ...packet };
  delete withoutDigest.packetDigest;
  packet.packetDigest = `sha256:${sha256Hex(canonicalBytes(withoutDigest))}`;
}

describe("X archive packet preparation", () => {
  test("vendored schema matches the canonical schema", () => {
    expect(readFileSync(join(ROOT, "schema/ensoul-source-packet-v1.schema.json")))
      .toEqual(readFileSync(join(ROOT, "skills/ensoul/references/ensoul-source-packet-v1.schema.json")));
  });

  test("builds a bounded packet without reading private archive members", () => {
    const directory = temporary();
    const archive = writeArchive(directory);
    const output = join(directory, "posts.ensoul-source.json");
    expect(run(archive, output, ["--limit", "2"])).toBe(0);
    const packet = JSON.parse(readFileSync(output, "utf8")) as Record<string, any>;
    expect(packet.schemaVersion).toBe("ensoul.source-packet.v1");
    expect(packet.digestCanonicalization).toBe("JCS-RFC8785");
    expect(packet.scope.payloadSchema).toBe("ensoul.x-authored-posts-source.v1");
    expect(packet.records).toHaveLength(2);
    expect(packet.records.map((record: any) => record.id)).toEqual(["x:1", "x:3"]);
    expect(packet.scope.limits).toMatchObject({
      selectedMembers: 1,
      inputRecords: 3,
      malformedRecordsSkipped: 0,
      exactDuplicateRecordsSkipped: 0,
    });
    const withoutDigest = { ...packet };
    delete withoutDigest.packetDigest;
    expect(packet.packetDigest).toBe(`sha256:${sha256Hex(canonicalBytes(withoutDigest))}`);
    for (const record of packet.records) {
      const recordWithoutDigest = { ...record };
      delete recordWithoutDigest.digest;
      expect(record.digest).toBe(`sha256:${sha256Hex(canonicalBytes(recordWithoutDigest))}`);
      expect(record.provenance.contentSha256).toBe(sha256Hex(canonicalBytes(record.content)));
    }
    expect(JSON.stringify(packet)).not.toContain("PRIVATE_DM_CANARY");
    expect(JSON.stringify(packet)).not.toContain("PRIVATE_AD_CANARY");
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(validateSourcePacketFile(output)).toMatchObject({ valid: true, records: 2 });
  });

  test("marks repost authorship and refuses overwrite", () => {
    const directory = temporary();
    const archive = writeArchive(directory);
    const output = join(directory, "posts.ensoul-source.json");
    expect(run(archive, output, ["--limit", "3"])).toBe(0);
    const packet = JSON.parse(readFileSync(output, "utf8")) as Record<string, any>;
    const repost = packet.records.find((record: any) => record.kind === "repost");
    expect(repost).toMatchObject({ authorRole: "mixed", contentRole: "forwarded" });
    expect(run(archive, output)).toBe(2);
  });

  test("enforces record and emitted-content byte limits", () => {
    const directory = temporary();
    const archive = writeArchive(directory);
    const output = join(directory, "posts.ensoul-source.json");
    expect(run(archive, output, ["--limit", "2001"])).toBe(2);
    const content = boundedContent(("\u0000🙂".repeat(20_000)) + "tail");
    expect(content.truncated).toBe(true);
    expect(canonicalBytes(content).byteLength).toBeLessThanOrEqual(MAX_RECORD_CONTENT_BYTES);
  });

  test("rejects future evidence and conflicting duplicate IDs", () => {
    for (const [name, posts] of [
      ["future", [{ tweet: { id_str: "999", created_at: "2999-01-01T12:00:00Z", full_text: "future" } }]],
      ["conflict", [
        { tweet: { id_str: "123", created_at: "2024-01-01T00:00:00Z", full_text: "first" } },
        { tweet: { id_str: "123", created_at: "2024-01-01T00:00:00Z", full_text: "conflict" } },
      ]],
    ] as const) {
      const directory = temporary();
      const archive = writeArchive(directory, posts);
      const output = join(directory, `${name}.json`);
      expect(run(archive, output)).toBe(2);
      expect(Bun.file(output).size).toBe(0);
    }
  });

  test("records malformed-ID omissions as bounded", () => {
    const directory = temporary();
    const archive = writeArchive(directory, [
      { tweet: { id_str: "foreign-id", created_at: "2024-01-01T00:00:00Z", full_text: "skip" } },
      { tweet: { id_str: "123", created_at: "2024-01-02T00:00:00Z", full_text: "keep" } },
    ]);
    const output = join(directory, "packet.json");
    expect(run(archive, output)).toBe(0);
    const packet = JSON.parse(readFileSync(output, "utf8")) as Record<string, any>;
    expect(packet.scope.completeness).toBe("bounded");
    expect(packet.scope.limits.malformedRecordsSkipped).toBe(1);
  });

  test("validates every archive path, including unselected members", () => {
    const directory = temporary();
    const archive = writeArchive(directory, [], [{ name: "../escape", value: "x" }]);
    expect(run(archive, join(directory, "packet.json"))).toBe(2);
  });
});

describe("standalone source-packet validator", () => {
  test("accepts packets from both copied producer seams", () => {
    for (const adapter of ["message-like-me", "peopleblade"] as const) {
      expect(validateSourcePacket(syntheticPacket(adapter))).toMatchObject({ valid: true, adapter, records: 1 });
    }
  });

  test("rejects tampering and duplicate JSON keys", () => {
    const directory = temporary();
    const output = join(directory, "packet.json");
    expect(run(writeArchive(directory), output)).toBe(0);
    const packet = JSON.parse(readFileSync(output, "utf8")) as Record<string, any>;
    packet.records[0].content.text = "tampered";
    expect(() => validateSourcePacket(packet)).toThrow("content digest mismatch");
    expect(() => strictJsonParse('{"schemaVersion":"ensoul.source-packet.v1","schemaVersion":"other"}')).toThrow("duplicate object member");
  });

  test("runs from a copied skill without writing runtime artifacts", () => {
    const directory = temporary();
    const output = join(directory, "packet.json");
    expect(run(writeArchive(directory), output)).toBe(0);
    const scriptDirectory = join(directory, "scripts");
    cpSync(join(ROOT, "skills/ensoul/scripts"), scriptDirectory, { recursive: true });
    const before = readdirSync(scriptDirectory).sort();
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(scriptDirectory, "validate-source-packet.ts"), output],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(readdirSync(scriptDirectory).sort()).toEqual(before);
  });

  test("enforces claim bindings and non-conflicting bounds", () => {
    const withClaim = syntheticPacket("peopleblade");
    withClaim.claims = [{
      id: "claim:1",
      text: "synthetic claim",
      recordIds: ["missing-record"],
      status: "adapter_structured",
      claimantRole: "adapter",
      claimKind: "derived_index",
      subjectLocalId: "synthetic-subject",
      sensitivity: "ordinary",
    }];
    redigest(withClaim);
    expect(() => validateSourcePacket(withClaim)).toThrow("unknown record");

    const withBounds = syntheticPacket("message-like-me");
    withBounds.records = [];
    withBounds.scope.limits = {
      afterInclusive: "2026-08-21T00:00:00Z",
      beforeExclusive: "2026-08-20T00:00:00Z",
    };
    redigest(withBounds);
    expect(() => validateSourcePacket(withBounds)).toThrow("lower bound must be earlier");
  });

  test("rejects evidence and scope timestamps beyond declared cutoffs", () => {
    const lateRecord = syntheticPacket("message-like-me");
    lateRecord.records[0].occurredAt = "2026-08-22T13:00:00Z";
    redigest(lateRecord, true);
    expect(() => validateSourcePacket(lateRecord)).toThrow("later than generatedAt");

    const lateScope = syntheticPacket("peopleblade");
    lateScope.scope.sourceCutoff = "2026-08-22T12:00:00Z";
    redigest(lateScope);
    expect(() => validateSourcePacket(lateScope)).toThrow("later than generatedAt");
  });
});
