#!/usr/bin/env node
/**
 * Accessibility sweep: loads every Storybook story in the Light and Dark themes and runs axe on it.
 *
 *   npm run storybook      (in another terminal)
 *   npm run a11y           exits 1 if any story has a violation
 *
 * STORYBOOK_URL overrides http://127.0.0.1:6006.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6006";

const index = await fetch(`${base}/index.json`)
  .then((response) => response.json())
  .catch(() => {
    console.error(`Storybook is not running at ${base}. Start it with: npm run storybook`);
    process.exit(1);
  });
const stories = Object.values(index.entries).filter((entry) => entry.type === "story");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let violations = 0;

for (const theme of ["Light", "Dark"]) {
  for (const story of stories) {
    await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`);
    await page.waitForSelector("#storybook-root > *", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.addScriptTag({ content: axeSource });
    let found = [];
    // Storybook's own a11y panel may be running axe at the same moment; wait for it.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        found = await page.evaluate(async () => {
          const result = await window.axe.run("#storybook-root", { resultTypes: ["violations"] });
          return result.violations.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.length} element(s), first ${violation.nodes[0]?.target?.join(" ")}`);
        });
        break;
      } catch (error) {
        if (!String(error).includes("already running")) throw error;
        await page.waitForTimeout(250);
      }
    }
    if (found.length > 0) {
      violations += found.length;
      console.log(`${theme}  ${story.title} / ${story.name}\n  ${found.join("\n  ")}`);
    }
  }
}

await browser.close();
console.log(`${stories.length} stories checked in Light and Dark: ${violations} violation(s).`);
if (violations > 0) process.exitCode = 1;
