#!/usr/bin/env node
/**
 * Accessibility sweep: loads every Storybook story in the Light and Dark themes and runs axe on it.
 *
 *   npm run storybook      (in another terminal)
 *   npm run a11y           exits 1 on any violation, or on a story that cannot be checked
 *
 * Dialogs, select lists and tooltips render under document.body, outside #storybook-root, so the
 * scan covers #storybook-root plus every other element the story added to <body>. Stories that
 * show an open overlay carry an a11y-open-* tag; the sweep waits for that overlay and fails if it
 * never appears, so an open state cannot silently drop out of the scan.
 *
 * STORYBOOK_URL overrides http://127.0.0.1:6006.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6006";
const themes = ["Light", "Dark"];
const renderTimeoutMs = 15_000;

/** Tag -> the overlay that story must show before it is scanned. */
const openStates = {
  "a11y-open-dialog": { selector: '[role="dialog"]', name: "dialog" },
  "a11y-open-listbox": { selector: '[role="listbox"]', name: "select list" },
  "a11y-open-tooltip": { selector: '[role="tooltip"]', name: "tooltip" },
  "a11y-open-menu": { selector: '[aria-expanded="true"]', name: "menu" },
};
/** Every one of these needs at least one tagged story, or the sweep fails. */
const requiredOpenStates = ["a11y-open-dialog", "a11y-open-listbox", "a11y-open-tooltip"];

const index = await fetch(`${base}/index.json`)
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .catch((error) => {
    console.error(`Storybook is not reachable at ${base} (${error.message}). Start it with: npm run storybook`);
    process.exit(1);
  });
const stories = Object.values(index.entries).filter((entry) => entry.type === "story");
const problems = [];

if (stories.length === 0) problems.push(`Storybook at ${base} lists no stories.`);
for (const tag of requiredOpenStates) {
  if (!stories.some((story) => story.tags?.includes(tag))) {
    problems.push(`No story is tagged ${tag}; the ${openStates[tag].name} open state would go unscanned.`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let violations = 0;
let scanned = 0;
let overlaysScanned = 0;

for (const theme of themes) {
  for (const story of stories) {
    const label = `${theme}  ${story.title} / ${story.name}`;
    const fail = (message) => problems.push(`${label}: ${message}`);
    try {
      await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`);
      const outcome = await page
        .waitForFunction(
          () => {
            const body = document.body;
            if (body.classList.contains("sb-show-errordisplay")) return "error";
            if (body.classList.contains("sb-show-nopreview")) return "missing";
            // A story may render only a portal (an open dialog), leaving #storybook-root empty.
            const rendered = Array.from(body.children).some(
              (element) =>
                (element.id === "storybook-root" && element.childElementCount > 0) ||
                (!element.id.startsWith("storybook-") && !element.classList.contains("sb-wrapper") && !["SCRIPT", "STYLE", "LINK", "TEMPLATE"].includes(element.tagName)),
            );
            return rendered ? "rendered" : false;
          },
          undefined,
          { timeout: renderTimeoutMs },
        )
        .then((handle) => handle.jsonValue())
        .catch(() => "timeout");
      if (outcome === "error") {
        const detail = await page.locator(".sb-errordisplay").innerText().catch(() => "");
        fail(`failed to render: ${detail.trim().split("\n").slice(0, 3).join(" | ") || "Storybook showed its error display"}`);
        continue;
      }
      if (outcome === "missing") {
        fail(`Storybook could not find this story (id ${story.id}).`);
        continue;
      }
      if (outcome === "timeout") {
        fail(`rendered nothing (in #storybook-root or a portal) within ${renderTimeoutMs / 1000} s.`);
        continue;
      }

      const darkApplied = await page
        .waitForFunction((wantDark) => document.documentElement.classList.contains("dark") === wantDark, theme === "Dark", { timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (!darkApplied) {
        fail(`the ${theme} theme was not applied, so it would not be the theme being checked.`);
        continue;
      }

      let overlayMissing = false;
      for (const tag of story.tags ?? []) {
        const state = openStates[tag];
        if (!state) continue;
        const visible = await page
          .locator(state.selector)
          .first()
          .waitFor({ state: "visible", timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        if (!visible) {
          fail(`is tagged ${tag} but no ${state.name} (${state.selector}) became visible.`);
          overlayMissing = true;
        }
      }
      if (overlayMissing) continue;

      // Let entrance transitions finish so contrast is measured on the settled colors.
      await page
        .waitForFunction(
          () =>
            document.getAnimations().every((animation) => {
              const end = animation.effect?.getComputedTiming().endTime;
              return animation.playState !== "running" || end === Infinity;
            }),
          undefined,
          { timeout: 5_000 },
        )
        .catch(() => undefined);
      await page.waitForTimeout(150);

      await page.addScriptTag({ content: axeSource });
      let result = null;
      // Storybook's own a11y panel may be running axe at the same moment; wait for it.
      for (let attempt = 0; attempt < 20 && result === null; attempt += 1) {
        try {
          result = await page.evaluate(async () => {
            const storyRoot = document.getElementById("storybook-root");
            // Everything else on <body> is story content, except Storybook's own elements:
            // its .sb-wrapper screens and the storybook-* roots its addons add.
            const portals = Array.from(document.body.children).filter(
              (element) =>
                !element.id.startsWith("storybook-") &&
                !element.classList.contains("sb-wrapper") &&
                !["SCRIPT", "STYLE", "LINK", "TEMPLATE"].includes(element.tagName),
            );
            const outcome = await window.axe.run({ include: [storyRoot, ...portals] }, { resultTypes: ["violations"] });
            return {
              portals: portals.length,
              found: outcome.violations.map(
                (violation) => `${violation.id} (${violation.impact}): ${violation.nodes.length} element(s), first ${violation.nodes[0]?.target?.join(" ")}`,
              ),
            };
          });
        } catch (error) {
          if (!String(error).includes("already running")) throw error;
          await page.waitForTimeout(250);
        }
      }
      if (result === null) {
        fail("could not be scanned: axe stayed busy with Storybook's own a11y panel for 5 s.");
        continue;
      }
      scanned += 1;
      if (result.portals > 0) overlaysScanned += 1;
      if (result.found.length > 0) {
        violations += result.found.length;
        console.log(`${label}\n  ${result.found.join("\n  ")}`);
      }
    } catch (error) {
      fail(`could not be checked: ${error.message.split("\n")[0]}`);
    }
  }
}

await browser.close();
console.log(
  `${stories.length} stories × ${themes.length} themes: ${scanned} scans (${overlaysScanned} with portal content), ${violations} violation(s), ${problems.length} story problem(s).`,
);
if (problems.length > 0) console.error(`\nStories that could not be checked:\n  ${problems.join("\n  ")}`);
if (violations > 0 || problems.length > 0) process.exitCode = 1;
