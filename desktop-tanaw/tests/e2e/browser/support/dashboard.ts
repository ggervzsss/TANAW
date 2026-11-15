import type { Page } from "@playwright/test";

export async function selectDashboardPeriod(page: Page, period: "Today" | "Week" | "Month") {
  await page.getByRole("combobox", { name: "Dashboard date range" }).click();
  const label = period === "Today" ? /^Today,/ : period === "Week" ? "Past 7 days" : "Past 30 days";
  await page.getByRole("option", { name: label }).click();
}
