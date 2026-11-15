import { expect, type Page, type TestInfo } from "@playwright/test";

/** Runs unchanged in Chromium and in the actual Electron renderer. */
export async function verifyReportsPolish(page: Page, info: TestInfo) {
  await page.setViewportSize({ width: 1920, height: 1024 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.locator('[data-reports-source="mock"]')).toBeVisible();
  await expect(page.getByRole("status", { name: "System unique visitor count" })).toHaveText("617");
  const steps = page.locator(".report-next-steps li");
  await expect(steps.nth(0)).toHaveAttribute("data-complete", "true");
  await expect(steps.nth(0).locator("svg")).toHaveCSS("stroke", "rgb(255, 255, 255)");
  await expect(steps.nth(1)).toHaveAttribute("data-complete", "false");
  await expect(page.getByRole("button", { name: "Submit Report", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Review Report Form", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review Report Form", exact: true });
  const canvas = dialog.getByLabel("Scrollable VAR 1 report preview");
  const document = dialog.locator(".var1-document");
  const centerDifference = () =>
    canvas.evaluate((area) => {
      const sheet = area.querySelector(".var1-document")!.getBoundingClientRect();
      const rect = area.getBoundingClientRect();
      return Math.abs((sheet.left + sheet.right) / 2 - (rect.left + area.clientWidth / 2));
    });
  await expect.poll(centerDifference).toBeLessThan(10);
  await expect(dialog.locator(".var1-official-table tbody tr")).toHaveCount(30);
  expect(await dialog.locator(".var1-official-table tbody tr").first().locator("td").allTextContents()).not.toContain("");
  const initialZoom = Number(await canvas.getAttribute("data-report-zoom"));
  const box = (await canvas.boundingBox())!;
  const pointer = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.45 };
  const anchorBefore = await document.evaluate((sheet, point) => {
    const rect = sheet.getBoundingClientRect();
    return { x: (point.x - rect.left) / (rect.width / 1288), y: (point.y - rect.top) / (rect.width / 1288) };
  }, pointer);
  await page.mouse.move(pointer.x, pointer.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -180);
  await page.keyboard.up("Control");
  await expect.poll(async () => Number(await canvas.getAttribute("data-report-zoom"))).toBeGreaterThan(initialZoom);
  const anchorAfter = await document.evaluate((sheet, point) => {
    const rect = sheet.getBoundingClientRect();
    return { x: (point.x - rect.left) / (rect.width / 1288), y: (point.y - rect.top) / (rect.width / 1288) };
  }, pointer);
  // Centering wins horizontally while the document still fits. Vertical anchoring stays stable.
  expect(Math.abs(anchorAfter.y - anchorBefore.y)).toBeLessThan(12);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 180);
  await page.keyboard.up("Control");
  await expect.poll(async () => Number(await canvas.getAttribute("data-report-zoom"))).toBeCloseTo(initialZoom, 1);
  await dialog.getByRole("button", { name: "Fit to Page", exact: true }).click();
  await expect.poll(centerDifference).toBeLessThan(10);
  await page.screenshot({ path: info.outputPath("reports-centered-fit.png") });
  for (let i = 0; i < 12; i++) await dialog.getByRole("button", { name: "Zoom In", exact: true }).click();
  await expect.poll(() => canvas.evaluate((area) => area.scrollWidth > area.clientWidth && area.scrollHeight > area.clientHeight)).toBe(true);
  await canvas.evaluate((area) => {
    area.scrollLeft = area.scrollWidth;
    area.scrollTop = area.scrollHeight;
  });
  expect(await canvas.evaluate((area) => area.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(steps.nth(1)).toHaveAttribute("data-complete", "true");
  await expect(steps.nth(2)).toHaveAttribute("data-complete", "false");

  const male = page.getByRole("textbox", { name: "This City Male", exact: true });
  const originalMale = await male.inputValue();
  await male.fill(String(Number(originalMale) - 1));
  await expect(steps.nth(0)).toHaveAttribute("data-complete", "false");
  await expect(steps.nth(1)).toHaveAttribute("data-complete", "false");
  await male.fill(originalMale);
  await page.screenshot({ path: info.outputPath("reports-mock-create.png") });

  const trigger = page.getByRole("button", { name: "Allocation tools", exact: true });
  const tools = page.getByRole("region", { name: "Allocation tools", exact: true });
  for (const size of [
    { width: 1440, height: 1024 },
    { width: 1100, height: 700 },
    { width: 850, height: 600 },
  ]) {
    await page.setViewportSize(size);
    await trigger.click();
    await tools.getByRole("button", { name: "Assisted", exact: true }).click();
    const rect = (await tools.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(10);
    expect(rect.y).toBeGreaterThanOrEqual(10);
    expect(rect.x + rect.width).toBeLessThanOrEqual(size.width - 10);
    expect(rect.y + rect.height).toBeLessThanOrEqual(size.height - 10);
    await tools.getByRole("button", { name: "Apply Allocation", exact: true }).scrollIntoViewIfNeeded();
    await expect(tools.getByRole("button", { name: "Apply Allocation", exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`allocation-${size.width}.png`) });
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(tools).not.toBeVisible();
  }
  await page.setViewportSize({ width: 1440, height: 1024 });
  await trigger.click();
  await tools.getByRole("spinbutton", { name: "Category Share percentage", exact: true }).first().fill("61");
  await page.getByRole("button", { name: "Review Report Form", exact: true }).click();
  await expect(tools).not.toBeVisible();
  await expect(dialog).not.toBeVisible(); // Dismissal must not also open the preview.
  await trigger.click();
  await expect(tools.getByRole("spinbutton", { name: "Category Share percentage", exact: true }).first()).toHaveValue("61");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Review Report Form", exact: true }).click();
  await page.locator(".tanaw-var1-viewer").click({ position: { x: 2, y: 2 } });
  await expect(dialog).not.toBeVisible();

  await page.getByRole("tab", { name: "Reports History", exact: true }).click();
  await expect(page.locator(".report-history-table-scroll tbody tr")).toHaveCount(8);
  const period = page.getByRole("combobox", { name: "Filter reports by reporting period" });
  const status = page.getByRole("combobox", { name: "Filter reports by status" });
  await period.click();
  await status.click();
  await expect(period).toHaveAttribute("aria-expanded", "false");
  await expect(status).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(status).toBeFocused();
  await page.getByRole("button", { name: "Search reports", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search reports", exact: true }).fill("MOCK-TOURISM-2026-1107");
  await page.keyboard.press("Escape");
  await expect(page.locator(".report-history-table-scroll tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Search reports", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search reports", exact: true }).fill("");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: info.outputPath("reports-mock-history.png") });
}
