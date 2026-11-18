#!/usr/bin/env node
/**
 * Copies the design system into each app as generated files.
 *
 *   node design-system/scripts/sync.mjs           write the copies
 *   node design-system/scripts/sync.mjs --check   exit 1 if a copy is missing, stale or left over
 *
 * What is copied:
 *   design-system/tokens/tanaw.css  ->  <app>/src/styles/tanaw-tokens.css
 *   design-system/src/**            ->  <app>/src/design-system/**   (stories, docs and tests excluded)
 *
 * The apps never import from design-system/, so each keeps building and deploying on its own
 * (Vercel builds only frontend-tanaw; electron-builder packages only desktop-tanaw). Each copy
 * starts with a header recording the SHA-256 of its source; the drift test in each app checks
 * that no copy was edited by hand and that every copy still matches this folder.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const designSystem = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(designSystem, "..");
const tokenSource = path.join(designSystem, "tokens", "tanaw.css");
const kitSource = path.join(designSystem, "src");

export const APPS = ["desktop-tanaw", "frontend-tanaw"];
export const TOKEN_COPY = "src/styles/tanaw-tokens.css";
export const KIT_COPY = "src/design-system";

const COPIED = /\.(ts|tsx|css)$/;
const EXCLUDED = /\.(stories|test|spec)\.(ts|tsx)$/;

/** Line endings differ between checkouts (Git on Windows); hashes use LF. */
export function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

export function sha256(text) {
  return createHash("sha256").update(normalize(text), "utf8").digest("hex");
}

export function generatedCopy(sourceText, sourceLabel) {
  const body = normalize(sourceText);
  return [
    "/*",
    ` * GENERATED FILE. Do not edit; change ${sourceLabel} instead.`,
    " * Update with: node design-system/scripts/sync.mjs",
    ` * Source SHA-256: ${sha256(body)}`,
    " */",
    body,
  ].join("\n");
}

async function listKit(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listKit(full, base)));
    else if (COPIED.test(entry.name) && !EXCLUDED.test(entry.name)) files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files.sort();
}

async function listCopies(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listCopies(full, base)));
    else files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files;
}

/** Every copy this script owns, with its expected content. */
export async function expectedCopies() {
  const copies = new Map();
  const tokens = generatedCopy(await readFile(tokenSource, "utf8"), "design-system/tokens/tanaw.css");
  const kitFiles = await listKit(kitSource);
  const kit = await Promise.all(kitFiles.map(async (rel) => [rel, generatedCopy(await readFile(path.join(kitSource, rel), "utf8"), `design-system/src/${rel}`)]));
  for (const app of APPS) {
    copies.set(`${app}/${TOKEN_COPY}`, tokens);
    for (const [rel, content] of kit) copies.set(`${app}/${KIT_COPY}/${rel}`, content);
  }
  return copies;
}

async function main() {
  const check = process.argv.includes("--check");
  const copies = await expectedCopies();
  const problems = [];
  let written = 0;

  for (const [target, expected] of copies) {
    const file = path.join(repoRoot, target);
    const current = await readFile(file, "utf8").catch(() => null);
    if (current !== null && normalize(current) === expected) continue;
    if (check) {
      problems.push(`${current === null ? "missing " : "stale   "} ${target}`);
      continue;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, expected, "utf8");
    written += 1;
    console.log(`wrote     ${target}`);
  }

  for (const app of APPS) {
    const kitDir = path.join(repoRoot, app, KIT_COPY);
    for (const rel of await listCopies(kitDir)) {
      const target = `${app}/${KIT_COPY}/${rel}`;
      if (copies.has(target)) continue;
      if (check) {
        problems.push(`leftover  ${target}`);
        continue;
      }
      await rm(path.join(kitDir, rel));
      console.log(`removed   ${target}`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error("Run: node design-system/scripts/sync.mjs");
    process.exitCode = 1;
    return;
  }
  console.log(check ? `All ${copies.size} copies are up to date.` : `${written} written, ${copies.size} copies in total.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
