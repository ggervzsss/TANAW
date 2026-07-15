import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import { complianceFixture, enterpriseReportFixture, periodFixture } from "../src/features/reports/testFixtures";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function authenticate(page: Page, role: "admin" | "staff") {
  const user = {
    id: `target-e2e-${role}`,
    email: `${role}@example.test`,
    displayName: `Target ${role}`,
    role,
    title: role === "admin" ? "LGU Administrator" : "LGU Staff",
    phone: null,
    firstName: "Target",
    lastName: role,
    enterpriseId: null,
    enterpriseName: null,
    category: null,
    managerName: null,
    barangay: null,
    address: null,
    buildingCapacity: 0,
    displayImageUrl: null,
  };
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }),
  );
  await page.route("**/operational/notifications", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.addInitScript((authenticatedUser) => {
    sessionStorage.setItem(
      "tanaw-auth",
      JSON.stringify({ state: { token: "target-contract-token", user: authenticatedUser }, version: 0 }),
    );
  }, user);
}

test("Staff finalizes only the exact accepted revision from frozen compliance", async ({ page }) => {
  const report = enterpriseReportFixture();
  const compliance = complianceFixture({
    summary: {
      totalFrozen: 1,
      eligibleExpected: 1,
      exempt: 0,
      ineligible: 0,
      unresolved: 0,
      notSubmitted: 0,
      submitted: 0,
      returned: 0,
      accepted: 1,
      consolidated: 0,
      complete: true,
    },
    obligations: [complianceFixture().obligations[0]!],
  });
  let submittedRevisionIds: string[] = [];

  await authenticate(page, "staff");
  await page.route("**/operational/reporting-periods/v2**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [periodFixture],
        page: { limit: 100, returnedCount: 1, hasMore: false, nextCursor: null },
      }),
    }),
  );
  await page.route(`**/operational/reporting-periods/${periodFixture.reportingPeriodId}/compliance/v2`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(compliance) }),
  );
  await page.route("**/operational/reports/v2**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        contractVersion: 2,
        classification: "official",
        items: [report],
        page: { limit: 100, returnedCount: 1, hasMore: false, nextCursor: null },
      }),
    }),
  );
  await page.route("**/operational/reports/finalizations/v2", async (route) => {
    const command = route.request().postDataJSON() as {
      commandId: string;
      payload: { reportingPeriodId: string; reportRevisionIds: string[] };
    };
    submittedRevisionIds = command.payload.reportRevisionIds;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        contractVersion: 2,
        commandId: command.commandId,
        disposition: "created",
        payloadHash: `sha256:${"a".repeat(64)}`,
        acknowledgedAt: "2026-08-02T01:00:00Z",
        resource: {
          reportFinalizationId: "00000000-0000-0000-0000-000000009001",
          finalReportVersionId: "00000000-0000-0000-0000-000000009002",
          reportCode: "FINAL-2026-07-001",
          reportingPeriodId: command.payload.reportingPeriodId,
          classification: "official",
          versionNumber: 1,
          logicalVersion: 1,
          scopeType: "citywide",
          scopeLabel: "Citywide",
          sourceCount: 1,
          artifactStatus: "pending",
        },
      }),
    });
  });

  await page.goto("/staff/batch-reports");

  await expect(page.getByRole("heading", { name: "Batch Reports" })).toBeVisible();
  await expect(page.getByText("Frozen Enterprise (ENT-001)")).toBeVisible();
  await expect(page.getByText("complete · recorded")).toBeVisible();
  const finalizeButton = page.getByRole("button", { name: "Finalize 1 exact revision" });
  await expect(finalizeButton).toBeEnabled();
  await finalizeButton.click();
  await expect(page.getByRole("alertdialog")).toContainText(report.acceptedRevisionId!);
  await page.getByRole("button", { name: "Finalize exact scope" }).click();

  await expect(page.getByRole("status").filter({ hasText: "FINAL-2026-07-001 finalized" })).toBeVisible();
  expect(submittedRevisionIds).toEqual([report.acceptedRevisionId]);
});

test("Admin Map derives live and stale presentation from the target site resource", async ({ page }) => {
  await authenticate(page, "admin");
  await page.route(/https:\/\/[abcd]\.basemaps\.cartocdn\.com\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: transparentPng }),
  );
  await page.route("**/operational/sites/v2**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            siteId: "00000000-0000-0000-0000-000000008001",
            enterpriseId: "00000000-0000-0000-0000-000000008002",
            enterpriseName: "Fresh Camera Enterprise",
            enterpriseCategory: "Attraction",
            enterpriseLifecycleState: "active",
            classification: "official",
            siteName: "Poblacion Entrance",
            barangay: "Poblacion",
            address: "Poblacion, San Pedro, Laguna",
            geocodedAddress: null,
            latitude: 14.3645,
            longitude: 121.0591,
            topologyStatus: "ready",
            liveState: {
              freshnessState: "fresh",
              currentOccupancy: 18,
              venueLocalUniqueEstimateWindow: 27,
              observedAt: "2026-07-15T08:58:55Z",
              receivedAt: "2026-07-15T08:59:00Z",
              serviceState: "healthy",
              syncHealth: { pendingCount: 0 },
            },
          },
          {
            siteId: "00000000-0000-0000-0000-000000008003",
            enterpriseId: "00000000-0000-0000-0000-000000008004",
            enterpriseName: "Stale Camera Enterprise",
            enterpriseCategory: "Retail",
            enterpriseLifecycleState: "active",
            classification: "official",
            siteName: "Unpinned Site",
            barangay: "Poblacion",
            address: "Poblacion, San Pedro, Laguna",
            geocodedAddress: null,
            latitude: 14.3646,
            longitude: 121.0592,
            topologyStatus: "ready",
            liveState: {
              freshnessState: "stale",
              currentOccupancy: null,
              venueLocalUniqueEstimateWindow: null,
              observedAt: "2026-07-15T08:00:00Z",
              receivedAt: "2026-07-15T08:00:05Z",
              serviceState: "degraded",
              syncHealth: { pendingCount: 2 },
            },
          },
        ],
        nextCursor: null,
        evaluatedAt: "2026-07-15T09:00:00Z",
      }),
    }),
  );

  await page.goto("/admin/mapview");

  await expect(page.locator("#admin-enterprise-map")).toBeVisible();
  await expect(page.getByText("Spatial Directory")).toBeVisible();
  const freshSite = page.getByRole("button", { name: /Fresh Camera Enterprise — Poblacion Entrance/ });
  const staleSite = page.getByRole("button", { name: /Stale Camera Enterprise — Unpinned Site/ });
  await expect(freshSite).toContainText("Normal");
  await expect(freshSite).toContainText("18");
  await expect(freshSite).toContainText("27");
  await expect(staleSite).toContainText("Warning");
  await expect(staleSite.getByText("Not available")).toHaveCount(2);
});
