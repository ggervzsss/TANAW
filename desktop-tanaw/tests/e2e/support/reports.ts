import { expect, type Page } from "@playwright/test";

/** Opens Create Reports on a reporting month by stepping the Tourism Period picker back to it. */
export async function openReportMonth(page: Page, month: string) {
  await page.getByRole("tab", { name: "Create Reports", exact: true }).click();
  await page.locator(".report-day-picker > button").click();
  const calendar = page.locator(".report-day-calendar");
  const label = calendar.locator(".report-month-switch strong");
  await expect(label).toBeVisible();
  for (let step = 0; step < 24 && (await label.textContent()) !== month; step += 1) {
    const previous = calendar.getByRole("button", { name: /^Previous month, / });
    await expect(previous).toBeEnabled();
    const before = await label.textContent();
    await previous.click();
    await expect(label).not.toHaveText(before ?? "");
  }
  await expect(label).toHaveText(month);
  await page.keyboard.press("Escape");
  await expect(calendar).toBeHidden();
}
