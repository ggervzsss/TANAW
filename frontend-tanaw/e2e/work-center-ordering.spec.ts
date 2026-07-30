import { expect, test, type Page } from "@playwright/test";

type AlertStatus = "New" | "In Review" | "Resolved";
type AlertUrgency = "Normal" | "Important" | "Urgent";

const itUser = {
  id: "it-work-center-ordering",
  email: "it.ordering@example.test",
  displayName: "IT Personnel",
  role: "it",
  title: "IT Personnel",
  phone: null,
  firstName: "IT",
  lastName: "Personnel",
  enterpriseId: null,
  enterpriseName: null,
  category: null,
  managerName: null,
  barangay: null,
  address: null,
  buildingCapacity: 100,
  displayImageDataUrl: null,
};

const issue = (id: string, urgency: AlertUrgency, status: AlertStatus, time: string) => ({
  id,
  type: "Maintenance Request",
  severity: urgency === "Urgent" ? "Critical" : "Warning",
  urgency,
  enterprise: "Ordering Test Enterprise",
  requester: "Ordering Test Enterprise",
  summary: `${id} summary`,
  requiredAction: `${id} action`,
  resolutionMode: "Remote Review",
  status,
  owner: "IT",
  time,
});

async function mockWorkCenter(page: Page) {
  let alerts = [
    issue("ALT-RESOLVED-NEW", "Normal", "Resolved", "2026-07-29T14:00:00Z"),
    issue("ALT-NORMAL", "Normal", "New", "2026-07-29T13:00:00Z"),
    issue("ALT-IMPORTANT", "Important", "New", "2026-07-29T12:00:00Z"),
    issue("ALT-URGENT-OLD", "Urgent", "New", "2026-07-29T10:00:00Z"),
    issue("ALT-RESOLVED-OLD", "Urgent", "Resolved", "2026-07-29T08:00:00Z"),
    issue("ALT-URGENT-NEW", "Urgent", "New", "2026-07-29T11:00:00Z"),
  ];

  await page.route("**/auth/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "it-ordering-token", user: itUser }) }),
  );
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(itUser) }));
  await page.route("**/auth/preferences", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: "light" }) }),
  );
  await page.route("**/operational/alerts**", async (route) => {
    if (route.request().method() === "PATCH") {
      const alertId = new URL(route.request().url()).pathname.split("/").at(-2);
      const { status } = route.request().postDataJSON() as { status: AlertStatus };
      const updatedAlert = { ...alerts.find((alert) => alert.id === alertId)!, status };

      await new Promise((resolve) => setTimeout(resolve, 1_000));
      alerts = alerts.map((alert) => (alert.id === alertId ? updatedAlert : alert));
      alerts.push(issue("ALT-URGENT-REFRESH", "Urgent", "New", "2026-07-29T16:00:00Z"));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(updatedAlert) });
    }

    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(alerts) });
  });

  for (const endpoint of ["**/operational/notifications", "**/operational/tickets", "**/accounts/enterprises", "**/accounts/email-deliveries"]) {
    await page.route(endpoint, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  }
}

test("keeps urgent active Work Center issues at the top across every data change", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockWorkCenter(page);
  await page.goto("/it/work-center");

  const issueIds = page.locator("tbody tr td:first-child");
  await expect(issueIds).toHaveText(["ALT-URGENT-NEW", "ALT-URGENT-OLD", "ALT-IMPORTANT", "ALT-NORMAL", "ALT-RESOLVED-NEW", "ALT-RESOLVED-OLD"]);
  await expect(issueIds.first()).toBeInViewport();

  const search = page.getByPlaceholder("Search issue, enterprise, person, or suggested action");
  await search.fill("urgent");
  await expect(issueIds).toHaveText(["ALT-URGENT-NEW", "ALT-URGENT-OLD", "ALT-RESOLVED-OLD"]);
  await search.clear();

  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Important", exact: true }).click();
  await expect(issueIds).toHaveText(["ALT-IMPORTANT"]);
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "All Urgencies", exact: true }).click();

  await page.getByRole("tab", { name: /Support Requests/ }).click();
  await page.getByRole("tab", { name: /Technical Issues/ }).click();
  await expect(issueIds.first()).toHaveText("ALT-URGENT-NEW");

  await page.locator("tbody tr").first().getByRole("button", { name: "Resolve" }).click();
  await expect(issueIds.first()).toHaveText("ALT-URGENT-OLD", { timeout: 500 });

  await expect(issueIds.first()).toHaveText("ALT-URGENT-REFRESH");
  await expect(issueIds).toHaveText([
    "ALT-URGENT-REFRESH",
    "ALT-URGENT-OLD",
    "ALT-IMPORTANT",
    "ALT-NORMAL",
    "ALT-RESOLVED-NEW",
    "ALT-URGENT-NEW",
    "ALT-RESOLVED-OLD",
  ]);
});
