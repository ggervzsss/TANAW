import { expect, type Page, type TestInfo } from "@playwright/test";

/** Shared desktop/browser checks for the final Reports interactions. Starts on History. */
export async function verifyFinalReports(page: Page, info: TestInfo) {
  await page.setViewportSize({ width: 1440, height: 1024 });
  const rows = page.locator(".report-history-table-scroll tbody tr");
  const dialog = page.getByRole("dialog", { name: "Review Report Form", exact: true });
  const canvas = dialog.getByLabel("Scrollable VAR 1 report preview");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // The body of each row, Enter, Space and View must all select that exact report.
  for (const [period, total, action] of [
    ["October 2026", "3,756", "click"],
    ["August 2026", "9,873", "Enter"],
    ["July 2026", "7,923", " "],
    ["September 2026", "4,061", "view"],
  ]) {
    const row = rows.filter({ hasText: period });
    if (action === "click") await row.locator("td").nth(2).click();
    else if (action === "view") await row.getByRole("button", { name: /^View / }).click();
    else {
      await row.focus();
      await page.keyboard.press(action === " " ? "Space" : action);
    }
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".var1-document-information dd").first()).toHaveText(period);
    await expect(dialog.locator(".var1-official-table tfoot td").last()).toHaveText(total);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("tab", { name: "Reports History", exact: true })).toHaveAttribute("aria-selected", "true");
  }
  await rows.filter({ hasText: "October 2026" }).click();
  await expect(canvas).toHaveAttribute("data-report-zoom", "1.00");
  await canvas.evaluate((area) => {
    const values: number[] = [];
    const observer = new MutationObserver(() => values.push(Number(area.getAttribute("data-report-zoom"))));
    observer.observe(area, { attributes: true, attributeFilter: ["data-report-zoom"] });
    Object.assign(window, { __reportZoomTrace: values, __stopReportZoomTrace: () => observer.disconnect() });
  });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect(canvas).toHaveAttribute("data-report-zoom", "1.10");
  const values = await page.evaluate(() => {
    const state = window as unknown as { __reportZoomTrace: number[]; __stopReportZoomTrace: () => void };
    state.__stopReportZoomTrace();
    return state.__reportZoomTrace;
  });
  expect(values.some((value) => value > 1 && value < 1.1)).toBe(true);
  await dialog.getByRole("button", { name: "Actual Size (100%)", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-report-zoom", "1.00");
  // A burst cannot queue dozens of zoom steps.
  await canvas.evaluate((area) => {
    const rect = area.getBoundingClientRect();
    for (let i = 0; i < 50; i++)
      area.dispatchEvent(new WheelEvent("wheel", { deltaY: -1000, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await expect.poll(async () => Number(await canvas.getAttribute("data-report-zoom"))).toBeGreaterThan(1);
  expect(Number(await canvas.getAttribute("data-report-zoom"))).toBeLessThanOrEqual(1.1);
  await dialog.getByRole("button", { name: "Actual Size (100%)", exact: true }).click();
  for (let index = 0; index < 10; index++) await dialog.getByRole("button", { name: "Zoom In", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-report-zoom", "2.00");
  await expect(dialog.getByRole("button", { name: "Zoom In", exact: true })).toBeDisabled();
  for (let index = 0; index < 15; index++) await dialog.getByRole("button", { name: "Zoom Out", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-report-zoom", "0.50");
  await expect(dialog.getByRole("button", { name: "Zoom Out", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Fit to Page", exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute("data-report-zoom"))).toBeGreaterThanOrEqual(0.5);
  await dialog.getByRole("button", { name: "Actual Size (100%)", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-report-zoom", "1.00");
  const review = page.getByRole("button", { name: "Review Report Form", exact: true });
  for (const width of [1440, 1100, 850]) {
    await page.setViewportSize({ width, height: 900 });
    await dialog.getByRole("button", { name: "Actual Size (100%)", exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "Actual Size (100%)", exact: true })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Download PDF", exact: true })).toBeInViewport();
  }
  await page.setViewportSize({ width: 1440, height: 1024 });
  await canvas.evaluate((area) => area.scrollTo({ top: 0, left: 0 }));
  await page.screenshot({ path: info.outputPath("reports-final-preview.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Create Reports", exact: true }).click();
  await expect(page.locator("#reports-panel-create")).toHaveCSS("opacity", "1");
  const originalReview = (await review.boundingBox())!;
  const status = page.locator(".report-workflow-status");
  await expect(status).toContainText("Submitted");
  await expect(status).toContainText("MOCK-TOURISM-2026-1107");
  const bounds = (await status.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(originalReview.y + originalReview.height + 14);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual((await page.locator(".report-next-steps").boundingBox())!.y + (await page.locator(".report-next-steps").boundingBox())!.height - 12);
  expect(await status.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("reports-final-submitted.png") });
  await page.getByRole("tab", { name: "Reports History", exact: true }).click();
}
