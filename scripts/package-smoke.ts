#!/usr/bin/env bun
/** Verify one exact Ensoul npm tarball without trusting package scripts. */

import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

const ROOT = resolve(import.meta.dir, "..");
const MAXIMUM_FILES = 32;
const MAXIMUM_PACKED_BYTES = 512 * 1024;
const MAXIMUM_UNPACKED_BYTES = 2 * 1024 * 1024;

export const EXPECTED_PATHS = new Set([
  "DISCLOSURE",
  "LICENSE",
  "README.md",
  "VERSION",
  "package.json",
  "schema/ensoul-source-packet-v1.schema.json",
  "skills/ensoul/agents/openai.yaml",
  "skills/ensoul/LICENSE",
  "skills/ensoul/NOTICE.md",
  "skills/ensoul/references/ensoul-source-packet-v1.schema.json",
  "skills/ensoul/references/evidence-method.md",
  "skills/ensoul/references/output-blueprint.md",
  "skills/ensoul/references/source-packets.md",
  "skills/ensoul/scripts/prepare-x-archive.ts",
  "skills/ensoul/scripts/source-packet.ts",
  "skills/ensoul/scripts/validate-source-packet.ts",
  "skills/ensoul/scripts/x-zip-file.ts",
  "skills/ensoul/SKILL.md",
]);

type PackFile = Readonly<{ mode: number; path: string; size: number }>;
export type PackRecord = Readonly<{
  name: string;
  version: string;
  filename: string;
  size: number;
  shasum: string;
  integrity: string;
  entryCount: number;
  files: readonly PackFile[];
  unpackedSize: number;
}>;

type TarEntry = Readonly<{ name: string; mode: number; size: number; type: "file" | "directory"; bytes: Buffer }>;

function fail(message: string): never {
  throw new Error(message);
}

function equalSets<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function safeRelativePath(path: string): boolean {
  return path !== "" && !path.startsWith("/") && !path.includes("\\")
    && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function tarText(bytes: Buffer, start: number, length: number): string {
  const field = bytes.subarray(start, start + length);
  const zero = field.indexOf(0);
  const selected = zero < 0 ? field : field.subarray(0, zero);
  if (selected.some((byte) => byte > 0x7f)) fail("npm archive contains a non-ASCII tar header field");
  return selected.toString("ascii");
}

function tarOctal(bytes: Buffer, start: number, length: number, label: string): number {
  const text = tarText(bytes, start, length).trim();
  if (!/^[0-7]+$/u.test(text)) fail(`npm archive has an invalid ${label}`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail(`npm archive has an unsafe ${label}`);
  return value;
}

function tarChecksum(header: Buffer): number {
  let total = 0;
  for (let index = 0; index < header.length; index += 1) {
    total += index >= 148 && index < 156 ? 0x20 : header[index]!;
  }
  return total;
}

export function readTarGzip(archiveBytes: Uint8Array): readonly TarEntry[] {
  let bytes: Buffer;
  try {
    bytes = gunzipSync(archiveBytes, { maxOutputLength: MAXIMUM_UNPACKED_BYTES + 512 * (MAXIMUM_FILES + 16) });
  } catch (error) {
    throw new Error("npm archive cannot be safely decompressed", { cause: error });
  }
  const entries: TarEntry[] = [];
  let offset = 0;
  let zeroBlocks = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 512) fail("npm archive has a truncated tar header");
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) {
        if (bytes.subarray(offset).some((byte) => byte !== 0)) fail("npm archive contains data after its tar terminator");
        return entries;
      }
      continue;
    }
    if (zeroBlocks !== 0) fail("npm archive has an invalid tar terminator");
    const expectedChecksum = tarOctal(header, 148, 8, "tar checksum");
    if (expectedChecksum !== tarChecksum(header)) fail("npm archive has an invalid tar checksum");
    const magic = tarText(header, 257, 6);
    if (magic !== "ustar") fail("npm archive is not a supported USTAR archive");
    const name = tarText(header, 0, 100);
    const prefix = tarText(header, 345, 155);
    const fullName = prefix === "" ? name : `${prefix}/${name}`;
    if (!safeRelativePath(fullName.replace(/\/$/u, ""))) fail("npm archive contains an unsafe path");
    const mode = tarOctal(header, 100, 8, "tar mode") & 0o7777;
    const size = tarOctal(header, 124, 12, "tar size");
    const typeByte = header[156]!;
    const type = typeByte === 0 || typeByte === 0x30 ? "file" : typeByte === 0x35 ? "directory" : undefined;
    if (type === undefined) fail("npm archive contains a non-regular entry");
    if (type === "directory" && size !== 0) fail("npm archive directory has data");
    if (size > bytes.length - offset) fail("npm archive entry is truncated");
    const body = Buffer.from(bytes.subarray(offset, offset + size));
    const padded = Math.ceil(size / 512) * 512;
    if (padded > bytes.length - offset) fail("npm archive entry padding is truncated");
    if (bytes.subarray(offset + size, offset + padded).some((byte) => byte !== 0)) fail("npm archive entry has nonzero padding");
    offset += padded;
    entries.push({ name: fullName, mode, size, type, bytes: body });
    if (entries.length > MAXIMUM_FILES + 16) fail("npm archive has too many entries");
  }
  fail("npm archive is missing its tar terminator");
}

function sha1Hex(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

function sha512Integrity(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

export function verifyPackReceipt(archivePath: string, receiptPath: string): PackRecord {
  const value: unknown = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (!Array.isArray(value) || value.length !== 1 || value[0] === null || typeof value[0] !== "object") {
    fail("npm pack receipt must contain exactly one package");
  }
  const record = value[0] as Partial<PackRecord>;
  const package_ = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { name: string; version: string };
  if (record.name !== package_.name) fail("npm pack receipt has the wrong name");
  if (record.version !== package_.version) fail("npm pack receipt has the wrong version");
  if (record.filename !== basename(archivePath)) fail("npm pack receipt filename does not match the reviewed archive");
  const archiveBytes = readFileSync(archivePath);
  if (record.size !== archiveBytes.byteLength) fail("npm pack receipt size does not match the reviewed archive");
  if (archiveBytes.byteLength > MAXIMUM_PACKED_BYTES) fail("npm package exceeds the packed-size limit");
  if (record.shasum !== sha1Hex(archiveBytes) || record.integrity !== sha512Integrity(archiveBytes)) {
    fail("npm pack receipt digest does not match the reviewed archive");
  }
  return record as PackRecord;
}

function addDigestField(digest: ReturnType<typeof createHash>, value: Uint8Array): void {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(value.byteLength));
  digest.update(length);
  digest.update(value);
}

export function verifyArchive(archivePath: string, record: PackRecord): string {
  if (!Array.isArray(record.files) || record.entryCount !== record.files.length) fail("npm pack receipt entry count is inconsistent");
  if (record.files.length < 1 || record.files.length > MAXIMUM_FILES) fail("npm package has an unexpected file count");
  const reported = new Map<string, PackFile>();
  for (const file of record.files) {
    if (file === null || typeof file !== "object" || typeof file.path !== "string" || !safeRelativePath(file.path)) {
      fail("npm pack receipt contains an invalid file record");
    }
    if (reported.has(file.path)) fail("npm pack receipt contains a duplicate path");
    reported.set(file.path, file);
  }
  const reportedPaths = new Set(reported.keys());
  if (!equalSets(reportedPaths, EXPECTED_PATHS)) {
    const missing = [...EXPECTED_PATHS].filter((path) => !reportedPaths.has(path)).sort();
    const extra = [...reportedPaths].filter((path) => !EXPECTED_PATHS.has(path)).sort();
    fail(`npm package inventory differs from source (missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)})`);
  }

  const archiveBytes = readFileSync(archivePath);
  const archiveEntries = readTarGzip(archiveBytes);
  const byPath = new Map<string, TarEntry>();
  for (const entry of archiveEntries) {
    if (entry.type === "directory") continue;
    if (!entry.name.startsWith("package/")) fail("npm archive contains an out-of-root entry");
    const path = entry.name.slice("package/".length);
    if (!safeRelativePath(path) || byPath.has(path)) fail("npm archive contains a duplicate or unsafe path");
    byPath.set(path, entry);
  }
  if (!equalSets(new Set(byPath.keys()), EXPECTED_PATHS)) fail("npm archive inventory differs from the npm pack receipt");

  let unpackedBytes = 0;
  const payloadDigest = createHash("sha256").update("ensoul-package-payload-v1\0");
  for (const path of [...byPath.keys()].sort()) {
    const entry = byPath.get(path)!;
    const file = reported.get(path)!;
    if (file.size !== entry.size) fail(`npm archive size differs for ${path}`);
    if (file.mode !== 0o644 || entry.mode !== 0o644) fail(`npm archive mode differs from the read-only data contract for ${path}`);
    unpackedBytes += entry.size;
    if (path === "package.json") {
      const packaged = JSON.parse(entry.bytes.toString("utf8"));
      const source = JSON.parse(readFileSync(join(ROOT, path), "utf8"));
      if (JSON.stringify(packaged) !== JSON.stringify(source)) fail("packed package.json differs from source metadata");
    } else if (!entry.bytes.equals(readFileSync(join(ROOT, path)))) {
      fail(`npm archive bytes differ from source: ${path}`);
    }
    addDigestField(payloadDigest, Buffer.from(path));
    addDigestField(payloadDigest, Buffer.from("regular-file"));
    const mode = Buffer.alloc(4);
    mode.writeUInt32BE(entry.mode);
    addDigestField(payloadDigest, mode);
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(entry.size));
    addDigestField(payloadDigest, size);
    addDigestField(payloadDigest, entry.bytes);
  }
  if (unpackedBytes !== record.unpackedSize) fail("npm pack receipt unpacked size is inconsistent");
  if (unpackedBytes > MAXIMUM_UNPACKED_BYTES) fail("npm package exceeds the unpacked-size limit");
  return payloadDigest.digest("hex");
}

function regularFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) fail("installed package contains a symbolic link");
      if (info.isDirectory()) visit(path);
      else if (info.isFile()) found.push(relative(root, path).split(sep).join("/"));
      else fail("installed package contains a non-regular entry");
    }
  };
  visit(root);
  return found;
}

export function verifyCleanInstall(archivePath: string): void {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "ensoul-package-smoke-"));
  try {
    const consumer = join(temporaryRoot, "consumer");
    mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), "{\"private\":true}\n");
    const process_ = Bun.spawnSync({
      cmd: [process.execPath, "add", "--ignore-scripts", realpathSync(archivePath)],
      cwd: consumer,
      env: { ...process.env, BUN_INSTALL_CACHE_DIR: join(temporaryRoot, "bun-cache") },
      stdout: "ignore",
      stderr: "pipe",
    });
    if (process_.exitCode !== 0) fail(`clean Bun install failed: ${process_.stderr.toString().trim()}`);
    const installedRoot = join(consumer, "node_modules", "@hraness", "ensoul");
    for (const relativeRoot of ["skills/ensoul", "schema"]) {
      const sourceRoot = join(ROOT, relativeRoot);
      const installed = join(installedRoot, relativeRoot);
      const sourceNames = regularFiles(sourceRoot);
      const installedNames = regularFiles(installed);
      if (JSON.stringify(sourceNames) !== JSON.stringify(installedNames)) fail(`installed ${relativeRoot} inventory differs from source`);
      for (const name of sourceNames) {
        if (!readFileSync(join(sourceRoot, name)).equals(readFileSync(join(installed, name)))) {
          fail(`installed bytes differ from source: ${relativeRoot}/${name}`);
        }
      }
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function parseArguments(argv: readonly string[]): Readonly<{ archive: string; packJson: string }> {
  let archive: string | undefined;
  let packJson: string | undefined;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) fail(`missing value for ${flag ?? "argument"}`);
    if (flag === "--archive") archive = resolve(value);
    else if (flag === "--pack-json") packJson = resolve(value);
    else fail(`unknown argument ${flag}`);
  }
  if (archive === undefined || packJson === undefined) fail("usage: bun scripts/package-smoke.ts --archive <tgz> --pack-json <json>");
  return { archive, packJson };
}

export function main(argv: readonly string[] = Bun.argv.slice(2)): void {
  const { archive, packJson } = parseArguments(argv);
  for (const [path, label] of [[archive, "archive"], [packJson, "pack receipt"]] as const) {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) fail(`${label} must be a regular non-symlink file`);
  }
  const record = verifyPackReceipt(archive, packJson);
  const payloadSha256 = verifyArchive(archive, record);
  verifyCleanInstall(archive);
  process.stdout.write(`${JSON.stringify({
    files: record.entryCount,
    name: record.name,
    packedBytes: record.size,
    payloadSha256,
    valid: true,
    version: record.version,
  })}\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
