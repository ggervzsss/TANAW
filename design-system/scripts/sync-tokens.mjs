#!/usr/bin/env node
/**
 * Copies design-system/tokens/tanaw.css into each app as a generated file.
 *
 *   node design-system/scripts/sync-tokens.mjs           write the copies
 *   node design-system/scripts/sync-tokens.mjs --check   exit 1 if a copy is missing or stale
 *
 * The apps never import from design-system/, so each keeps building on its own. Each copy
 * records the SHA-256 of the source it came from; the drift test in each app checks that
 * the copy was not edited by hand and still matches this source.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const designSystem = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(designSystem, "..");
const source = path.join(designSystem, "tokens", "tanaw.css");

export const TOKEN_TARGETS = [
  "desktop-tanaw/src/styles/tanaw-tokens.css",
  "frontend-tanaw/src/styles/tanaw-tokens.css",
];

/** Line endings differ between checkouts (Git on Windows); hashes use LF. */
export function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

export function sha256(text) {
  return createHash("sha256").update(normalize(text), "utf8").digest("hex");
}

export function generatedCopy(sourceText) {
  const body = normalize(sourceText);
  return [
    "/*",
    " * GENERATED FILE. Do not edit; change design-system/tokens/tanaw.css instead.",
    " * Update with: node design-system/scripts/sync-tokens.mjs",
    ` * Source SHA-256: ${sha256(body)}`,
    " */",
    body,
  ].join("\n");
}

async function main() {
  const check = process.argv.includes("--check");
  const expected = generatedCopy(await readFile(source, "utf8"));
  const stale = [];
  for (const target of TOKEN_TARGETS) {
    const file = path.join(repoRoot, target);
    const current = await readFile(file, "utf8").catch(() => null);
    if (current !== null && normalize(current) === expected) {
      console.log(`up to date  ${target}`);
      continue;
    }
    if (check) {
      stale.push(target);
      console.error(`${current === null ? "missing" : "stale"}      ${target}`);
      continue;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, expected, "utf8");
    console.log(`wrote       ${target}`);
  }
  if (stale.length > 0) {
    console.error("Run: node design-system/scripts/sync-tokens.mjs");
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
