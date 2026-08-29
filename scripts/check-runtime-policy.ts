#!/usr/bin/env bun
/** Enforce Hraness's Bun + TypeScript-only project runtime policy. */

import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SELF = resolve(import.meta.path);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".turbo", "coverage", "dist"]);
const FORBIDDEN_FILE = /\.(?:py|pyc|pyo)$/iu;
const FORBIDDEN_REFERENCE = /(?:actions\/setup-python|\bpython(?:3(?:\.\d+)?)?\b|\.py(?:\b|$))/iu;

export function violations(root = ROOT): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (SKIPPED_DIRECTORIES.has(name)) continue;
      const path = join(directory, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        visit(path);
        continue;
      }
      if (!info.isFile() || resolve(path) === SELF) continue;
      const display = relative(root, path).split(sep).join("/");
      if (FORBIDDEN_FILE.test(display)) {
        found.push(`${display}: forbidden runtime file`);
        continue;
      }
      const bytes = readFileSync(path);
      if (bytes.includes(0)) continue;
      const lines = bytes.toString("utf8").split(/\r?\n/u);
      for (const [index, line] of lines.entries()) {
        if (FORBIDDEN_REFERENCE.test(line)) found.push(`${display}:${index + 1}: forbidden runtime reference`);
      }
    }
  };
  visit(root);
  return found;
}

export function main(): void {
  const found = violations();
  if (found.length > 0) throw new Error(`Bun + TypeScript runtime policy violations:\n${found.join("\n")}`);
  process.stdout.write(JSON.stringify({ policy: "bun-typescript-only", valid: true }) + "\n");
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
