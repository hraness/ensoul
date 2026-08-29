#!/usr/bin/env bun
/** Build and smoke one disposable npm artifact with Bun orchestration. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main as smoke } from "./package-smoke.ts";

function main(): void {
  const temporary = mkdtempSync(join(tmpdir(), "ensoul-package-check-"));
  try {
    const packed = Bun.spawnSync({
      cmd: [
        "npm",
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        temporary,
        "--cache",
        join(temporary, "npm-cache"),
        "--registry=https://registry.npmjs.org",
      ],
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (packed.exitCode !== 0) throw new Error(`npm pack failed: ${packed.stderr.toString().trim()}`);
    const receiptText = packed.stdout.toString();
    const receipt = JSON.parse(receiptText) as readonly Readonly<{ filename: string }>[];
    if (receipt.length !== 1 || typeof receipt[0]?.filename !== "string") throw new Error("npm pack returned an invalid receipt");
    const receiptPath = join(temporary, "npm-pack.json");
    writeFileSync(receiptPath, receiptText, { mode: 0o600 });
    smoke(["--archive", join(temporary, receipt[0].filename), "--pack-json", receiptPath]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
