#!/usr/bin/env node
/**
 * Runs only the @design-capture Playwright tests, which save light and dark screenshots of the main
 * screens for design review (DESIGN.md at the repository root). Normal test runs exclude them.
 *
 *   npm run capture:design                    saves to ./design-captures
 *   npm run capture:design -- --headed        extra arguments go to Playwright
 *   TANAW_DESIGN_CAPTURE=<folder> npm run capture:design
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const folder = path.resolve(process.env.TANAW_DESIGN_CAPTURE ?? "design-captures");
mkdirSync(folder, { recursive: true });
const before = new Set(readdirSync(folder));
const result = spawnSync("npx", ["playwright", "test", "--grep", "@design-capture", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, TANAW_DESIGN_CAPTURE: folder },
});
const written = readdirSync(folder).filter((name) => name.endsWith(".png") && !before.has(name));
console.log(`\n${written.length} new screenshot(s) in ${folder}`);
if (result.status === 0 && written.length === 0) {
  console.error("The capture run passed but wrote no screenshots.");
  process.exit(1);
}
process.exit(result.status ?? 1);
