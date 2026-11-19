import { writeFile } from "node:fs/promises";
import { expect, type Page, type TestInfo } from "@playwright/test";

const toggle = (page: Page) => page.getByRole("button", { name: /Switch to (light|dark) mode/ });
async function choose(page: Page, name: string, option: string) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}
/** The computed color of a design token (or theme role) as it applies inside the app shell. */
export async function token(page: Page, name: string) {
  return page.evaluate((variable) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${variable})`;
    (document.querySelector(".enterprise-shell") ?? document.body).appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}
async function geometry(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect(),
        s = getComputedStyle(node);
      return { x: r.x, y: r.y, w: r.width, h: r.height, font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, bg: s.backgroundColor, border: s.borderColor, color: s.color };
    }),
  );
}

export async function verifyThemeAndFilters(page: Page, info: TestInfo, downloads = true) {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".overview-layout")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".overview-metrics")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".overview-layout .design-skeleton")).toHaveCount(0);
  if (await page.locator("html").evaluate((root) => root.classList.contains("dark"))) await toggle(page).click();
  await expect(page.locator(".overview-metric").first()).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  const cardBorder = await token(page, "--tanaw-border-soft");
  await expect.poll(async () => (await geometry(page, ".overview-metrics,.overview-charts > section,.overview-secondary > section")).every((node) => node.border === cardBorder)).toBe(true);
  const before = await geometry(page, ".overview-metric,.overview-charts > section,.overview-secondary > section");
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Switch to dark mode"]')!;
    const t = performance.now();
    button.click();
    Object.assign(window, { __themeImmediate: { dark: document.documentElement.classList.contains("dark"), elapsed: performance.now() - t } });
  });
  expect(await page.evaluate(() => (window as unknown as { __themeImmediate: { dark: boolean } }).__themeImmediate.dark)).toBe(true);
  await expect(page.locator(".overview-metrics")).toHaveCSS("background-color", await token(page, "--tanaw-surface"));
  const dark = await geometry(page, ".overview-metric,.overview-charts > section,.overview-secondary > section");
  dark.forEach((node, i) => {
    expect({ x: node.x, y: node.y, w: node.w, h: node.h, font: node.font, size: node.size, weight: node.weight }).toEqual({
      x: before[i].x,
      y: before[i].y,
      w: before[i].w,
      h: before[i].h,
      font: before[i].font,
      size: before[i].size,
      weight: before[i].weight,
    });
  });
  await auditDarkContrast(page, info, "dashboard", ".overview-layout");
  await page.screenshot({ path: info.outputPath("dark-dashboard.png"), fullPage: true });
  await page.getByRole("button", { name: "Open TANAW Insights" }).click();
  await expect(page.getByRole("complementary", { name: "TANAW Insights" })).toBeVisible();
  await auditDarkContrast(page, info, "assistant", ".tanaw-assistant");
  await page.screenshot({ path: info.outputPath("dark-assistant.png"), fullPage: true });
  await page.getByRole("button", { name: "Collapse TANAW Insights" }).click();
  for (let n = 0; n < 4; n++) await toggle(page).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await toggle(page).click();
  await expect.poll(() => geometry(page, ".overview-metric,.overview-charts > section,.overview-secondary > section")).toEqual(before);
  await toggle(page).click();
  await page.getByRole("button", { name: "Camera Setup", exact: true }).click();
  await page.getByRole("button", { name: "Edit configuration" }).click();
  const settings = page.getByRole("region", { name: "Camera Settings", exact: true });
  for (const section of ["Information", "Connection", "Counting Area", "Display", "Maintenance"]) {
    await settings.getByRole("tab", { name: section, exact: true }).click();
    await auditDarkContrast(page, info, `camera-${section}`, ".camera-settings");
    await page.screenshot({ path: info.outputPath(`dark-camera-${section.toLowerCase()}.png`), fullPage: true });
    await expect(settings.locator(".camera-settings-identity")).toHaveCSS("border-top-color", await token(page, "--theme-divider"));
    await expect(settings.locator(".camera-settings-footer")).toHaveCSS("border-top-color", await token(page, "--theme-divider"));
    await expect(settings.locator(".camera-settings-content")).toHaveCSS("scrollbar-color", `${await token(page, "--theme-scrollbar")} ${await token(page, "--theme-surface-low")}`);
  }
  await settings.getByRole("tab", { name: "Information", exact: true }).click();
  await expect(settings.getByLabel("Camera Name", { exact: true })).toHaveCSS("border-bottom-color", await token(page, "--theme-outline"));
  await page.screenshot({ path: info.outputPath("dark-camera-settings.png"), fullPage: true });
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Camera Information", exact: true });
  await expect(add).toHaveCSS("background-color", await token(page, "--theme-raised"));
  await expect(page.locator(".camera-dialog-backdrop")).toHaveCSS("backdrop-filter", "blur(2.5px)");
  await auditDarkContrast(page, info, "add-camera", ".camera-dialog");
  await page.screenshot({ path: info.outputPath("dark-add-camera.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(add).toHaveCount(0);
  await toggle(page).click();
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  await expect(add).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".camera-dialog-backdrop")).toHaveCSS("background-color", "rgba(244, 248, 246, 0.56)");
  await page.screenshot({ path: info.outputPath("light-add-camera.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(add).toHaveCount(0);
  await toggle(page).click();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.locator(".report-origin-table")).toBeVisible();
  await expect(page.getByLabel("System unique visitor count", { exact: true })).not.toHaveText("\u2026");
  await auditDarkContrast(page, info, "create-reports", ".tanaw-reports-workspace");
  await page.screenshot({ path: info.outputPath("dark-create-reports.png"), fullPage: true });
  await page.locator(".report-day-picker > button").click();
  await expect(page.locator(".report-day-popover")).toHaveCSS("background-color", await token(page, "--theme-raised"));
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Reports History", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply Filter", exact: true })).toHaveCount(0);
  const rows = page.locator(".report-history-results tr[role='button']");
  await expect.poll(() => rows.count()).toBeGreaterThan(3);
  const original = await rows.evaluateAll((nodes) => nodes.map((row) => ({ period: row.children[1].textContent!.trim(), status: row.querySelector(".report-status")!.textContent!.trim() })));
  await page.evaluate(() => Object.assign(window, { __filterPageIdentity: "same-document" }));
  await auditDarkContrast(page, info, "report-history", ".report-ledger");
  await page.screenshot({ path: info.outputPath("dark-report-history.png"), fullPage: true });
  await choose(page, "Filter reports by status", "Submitted");
  await expect(rows).toHaveCount(original.filter((row) => row.status === "Submitted").length);
  await expect(page.getByRole("combobox", { name: "Filter reports by reporting period" })).toContainText("This Year");
  await choose(page, "Filter reports by reporting period", "October 2026");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("October 2026");
  await expect(page.getByRole("combobox", { name: "Filter reports by status" })).toContainText("Submitted");
  await choose(page, "Filter reports by status", "Consolidated");
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("No matching reports found.", { exact: true })).toBeVisible();
  await choose(page, "Filter reports by status", "All Statuses");
  await expect(rows).toHaveCount(1);
  await rows.first().locator("td").nth(2).click();
  const preview = page.getByRole("dialog", { name: "Review Report Form", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.locator(".var1-document")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(preview.locator(".var1-document")).toHaveCSS("color", "rgb(0, 0, 0)");
  await page.screenshot({ path: info.outputPath("dark-dot-preview.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await rows
    .first()
    .getByRole("button", { name: /^View / })
    .click();
  await expect(preview).toBeVisible();
  await page.keyboard.press("Escape");
  if (downloads) {
    const downloaded = page.waitForEvent("download");
    await rows
      .first()
      .getByRole("button", { name: /^Download / })
      .click();
    expect((await downloaded).suggestedFilename()).toMatch(/\.pdf$/);
  }
  await choose(page, "Filter reports by reporting period", "All Periods");
  await expect(rows).toHaveCount(original.length);
  const tones = await page.locator(".report-status").evaluateAll((nodes) => nodes.map((node) => ({ tone: node.getAttribute("data-tone"), bg: getComputedStyle(node).backgroundColor })));
  for (const tone of ["draft", "submitted", "pending", "consolidated", "returned"]) expect(tones.some((item) => item.tone === tone)).toBe(true);
  expect(new Set(tones.map((item) => item.bg)).size).toBe(5);
  expect(await page.evaluate(() => (window as unknown as { __filterPageIdentity: string }).__filterPageIdentity)).toBe("same-document");
  await page.getByRole("combobox", { name: "Filter reports by status" }).click();
  await expect(page.locator(".tanaw-dropdown-menu")).toHaveCSS("background-color", await token(page, "--theme-raised"));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const switches: Awaited<ReturnType<typeof expectSynchronizedTheme>>[] = [];
  switches.push(await expectSynchronizedTheme(page, "light", [".enterprise-shell", ".report-ledger", ".report-status", ".enterprise-topbar__overlay", ".enterprise-topbar__image--day"], info));
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition");
  await toggle(page).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition");
  await page.getByRole("button", { name: "Camera Setup", exact: true }).click();
  await page.getByRole("button", { name: "Edit configuration" }).click();
  switches.push(
    await expectSynchronizedTheme(page, "light", [".camera-settings", ".camera-settings-identity", ".camera-settings-footer", ".camera-settings-content input", ".enterprise-topbar__overlay"], info),
  );
  switches.push(
    await expectSynchronizedTheme(page, "dark", [".camera-settings", ".camera-settings-identity", ".camera-settings-footer", ".camera-settings-content input", ".enterprise-topbar__overlay"], info),
  );
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  await expect(add).toHaveCSS("opacity", "1");
  switches.push(await expectSynchronizedTheme(page, "light", [".camera-dialog", ".camera-dialog-backdrop", ".camera-dialog input", ".camera-dialog .primary"], info));
  switches.push(await expectSynchronizedTheme(page, "dark", [".camera-dialog", ".camera-dialog-backdrop", ".camera-dialog input", ".camera-dialog .primary"], info));
  await page.keyboard.press("Escape");
  await expect(add).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("inert");
  expectQuickThemeUpdates(switches.map((frames) => frames.updateMs));
}

/**
 * The app's update is synchronous main-thread work, so one sample also counts the time the
 * operating system gives other processes: the same build measures 3-58 ms per switch on a loaded
 * laptop. The median of the run's switches tracks the app instead (8-20 ms there) and still fails
 * when every switch renders slowly.
 */
function expectQuickThemeUpdates(updates: (number | null)[]) {
  const measured = updates.filter((ms): ms is number => ms !== null).sort((a, b) => a - b);
  if (measured.length) expect(measured[Math.floor(measured.length / 2)]).toBeLessThan(50);
}

export async function expectSynchronizedTheme(page: Page, theme: "light" | "dark", selectors: string[], info?: TestInfo) {
  const frames = await page.evaluate(
    async ({ theme, selectors }) => {
      const root = document.documentElement;
      const read = () =>
        selectors.map((selector) => {
          const element = document.querySelector(selector)!;
          const style = getComputedStyle(element);
          return { selector, color: style.color, bg: style.backgroundColor, image: style.backgroundImage, opacity: style.opacity, border: style.borderColor };
        });
      // Time the switch the way a person makes it: on a settled page. Finite animations (a dialog
      // opening, the previous theme dissolve) finish, then the browser gets time to draw the new
      // screen. Right after a dialog opens, the first capture otherwise waits for that drawing,
      // which on this laptop's software renderer can take about 300 ms.
      const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
      await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 400));
      // A switch feels immediate when the app hands it to the browser in the click itself and its
      // own update is quick. Between those two the browser captures the old screen, which depends
      // on the renderer and the machine's load (150 ms to 1 s under load on this laptop's software
      // renderer), so that wall-clock time is recorded in the trace but not asserted on.
      const transitionDocument = document as Document & { startViewTransition?: (update: () => void) => unknown };
      const startViewTransition = transitionDocument.startViewTransition;
      const timing: { requested: boolean; updateMs: number | null } = { requested: false, updateMs: null };
      if (startViewTransition) {
        transitionDocument.startViewTransition = (update: () => void) => {
          timing.requested = true;
          return startViewTransition.call(document, () => {
            const started = performance.now();
            update();
            timing.updateMs = performance.now() - started;
          });
        };
      }
      const firstTime = performance.now();
      document.querySelector<HTMLButtonElement>(`button[aria-label="Switch to ${theme} mode"]`)!.click();
      // Without view transitions the app applies the theme synchronously instead.
      const handedOffInClick = startViewTransition ? timing.requested : root.classList.contains(theme);
      while (!root.classList.contains(theme)) await new Promise(requestAnimationFrame);
      const commitMs = performance.now() - firstTime;
      if (startViewTransition) transitionDocument.startViewTransition = startViewTransition;
      const atCommit = read();
      const snapshot = root.dataset.themeTransition;
      await new Promise(requestAnimationFrame);
      const animations = document.getAnimations().filter((animation) => (animation as CSSAnimation).animationName === "tanaw-theme-dissolve");
      const durations = animations.map((animation) => animation.effect!.getComputedTiming().duration);
      await Promise.all(animations.map((animation) => animation.finished));
      while (root.hasAttribute("data-theme-transition")) await new Promise(requestAnimationFrame);
      return { atCommit, settled: read(), handedOffInClick, commitMs, updateMs: timing.updateMs, snapshot, durations };
    },
    { theme, selectors },
  );
  if (info) {
    const trace = info.outputPath(`transition-${theme}-${selectors[0].replaceAll(".", "")}.json`);
    await writeFile(trace, JSON.stringify(frames, null, 2));
    await info.attach(`transition-${theme}-${selectors[0]}`, { path: trace, contentType: "application/json" });
  }
  expect(frames.snapshot).toBe("snapshot");
  expect(frames.handedOffInClick).toBe(true);
  expect(frames.durations).toEqual([220]);
  expect(frames.atCommit).toEqual(frames.settled);
  return frames;
}

async function auditDarkContrast(page: Page, info: TestInfo, label: string, scope: string) {
  const results = await page.evaluate((scope) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const colors = new Map<string, number[]>();
    const rgba = (value: string) => {
      const cached = colors.get(value);
      if (cached) return cached;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const channels = [...context.getImageData(0, 0, 1, 1).data];
      channels[3] /= 255;
      colors.set(value, channels);
      return channels;
    };
    const blend = (fg: number[], bg: number[]) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
    const luminance = (rgb: number[]) =>
      rgb
        .slice(0, 3)
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const records = [];
    for (const node of document.querySelectorAll<HTMLElement>(`${scope} :is(h1,h2,h3,h4,p,span,label,button,th,td,strong,small,input)`)) {
      const text =
        node instanceof HTMLInputElement
          ? node.type === "password"
            ? node.placeholder
            : node.type === "text"
              ? node.value || node.placeholder
              : ""
          : [...node.childNodes]
              .filter((child) => child.nodeType === Node.TEXT_NODE)
              .map((child) => child.textContent)
              .join("")
              .trim();
      if (!text || !node.getClientRects().length || node.closest('details:not([open]),[disabled],[aria-disabled="true"],[hidden],.var1-document')) continue;
      const style = getComputedStyle(node);
      if (style.visibility !== "visible") continue;
      const ancestors = [];
      let parent: HTMLElement | null = node;
      let image = false,
        opacity = 1;
      while (parent) {
        const s = getComputedStyle(parent);
        ancestors.unshift(s.backgroundColor);
        image ||= s.backgroundImage !== "none";
        opacity *= Number(s.opacity);
        parent = parent.parentElement;
      }
      if (image || opacity < 0.99) continue; // Gradients and transient animation frames need separate visual review.
      let bg = [21, 27, 33];
      for (const background of ancestors) bg = blend(rgba(background), bg);
      const fg = blend(rgba(node instanceof HTMLInputElement && !node.value ? getComputedStyle(node, "::placeholder").color : style.color), bg);
      const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      const ratio = (light + 0.05) / (dark + 0.05);
      const size = Number.parseFloat(style.fontSize),
        weight = Number.parseInt(style.fontWeight);
      const required = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      records.push({ text: text.slice(0, 70), color: style.color, bg, ratio: Number(ratio.toFixed(2)), required });
    }
    return records;
  }, scope);
  const reportPath = info.outputPath(`contrast-${label}.json`);
  await writeFile(reportPath, JSON.stringify(results, null, 2));
  await info.attach(`contrast-${label}`, { path: reportPath, contentType: "application/json" });
  expect(results.length).toBeGreaterThan(0);
  expect(
    results.filter((result) => result.ratio < result.required),
    `Rendered text contrast: ${label}`,
  ).toEqual([]);
}
