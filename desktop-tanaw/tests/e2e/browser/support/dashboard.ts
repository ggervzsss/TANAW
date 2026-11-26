import type { Page } from "@playwright/test";

/** Opens the dashboard calendar, picks a quick range and applies it. */
export async function selectDashboardPeriod(page: Page, period: "Today" | "Week" | "Month") {
  await page.getByRole("button", { name: /^Dashboard date range/ }).click();
  const dialog = page.getByRole("dialog", { name: "Choose the dates to show" });
  const label = period === "Today" ? "Today" : period === "Week" ? "Last 7 days" : "Last 30 days";
  await dialog.getByRole("radio", { name: label, exact: true }).click();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
}
