import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "./support/preload";

test.describe.configure({ timeout: 60_000 });
const fixtures = Object.fromEntries(
  ["open-space", "entrance-exit", "mixed", "corrected-open-space"].map((mode) => [
    mode,
    JSON.parse(readFileSync(new URL(`../../../../test-fixtures/${mode}-establishment-report.json`, import.meta.url), "utf8")),
  ]),
);
const user = { id: "report-operator", email: "reports@example.test", role: "enterprise", name: "Park Operator", enterpriseId: "park-fixture", enterpriseName: "Park" };

async function setup(page: Page, mode: "open_space" | "entrance_exit" | "mixed", revision = false) {
  let signedIn = false;
  const frozen = fixtures[mode.replaceAll("_", "-")];
  const fixture = revision ? fixtures["corrected-open-space"] : frozen;
  const counting = structuredClone(fixture.counting);
  const metrics = { entries: fixture.entries, exits: fixture.exits, peak_occupancy: fixture.peak_occupancy, unique_count: fixture.unique_count };
  const payloadMetrics = { entries: metrics.entries, exits: metrics.exits, peak: metrics.peak_occupancy, unique: metrics.unique_count };
  const profile = (id: number, analysisMode: string) => ({
    id,
    name: `Camera ${id}`,
    zone: "Park",
    analysisMode,
    status: "stopped",
    rtsp: "rtsp://192.168.1.10/stream2",
    cameraHost: "192.168.1.10",
    rtspStream: "stream2",
    confidence: 0.35,
    processingProfile: "auto",
    coverage: {
      role: analysisMode === "entrance_exit" ? "external_boundary" : "internal_observation",
      relationship: id === 2 ? "contained" : "independent",
      related_camera_id: id === 2 ? 1 : null,
      travel_seconds: {},
    },
    config: { tripwire: 50, reverse: false, roi: { top: 0, left: 0, width: 100, height: 100 } },
    openSpace: null,
  });
  let saved: Record<string, unknown> | null = revision ? { ...frozen, sync_status: "synced" } : null;
  const submissions: Record<string, unknown>[] = [];
  const uploads: Record<string, unknown>[] = [];
  const drafts = new Map<string, unknown>();
  let uploadAvailable = false;
  let sampleRequests = 0;
  await page.clock.install({ time: new Date("2026-11-02T02:00:00Z") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ json: { token: "report-token", user } });
  });
  await page.route("**/auth/session", (route) => route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { token: "report-token", user } : { detail: "Sign in" } }));
  await page.route("**/auth/me", (route) => route.fulfill({ json: user }));
  await page.route("**/operational/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/desktop/report-submissions")) {
      uploads.push(route.request().postDataJSON());
      return route.fulfill({ status: uploadAvailable ? 202 : 503, json: uploadAvailable ? {} : { detail: "Offline test" } });
    }
    if (revision && path.endsWith("/reports/intake"))
      return route.fulfill({
        json: [
          {
            id: "cloud-one",
            enterpriseId: user.enterpriseId,
            enterprise: "Park",
            category: "Tourism",
            barangay: "Poblacion",
            month: "October",
            period: frozen.period,
            submitted: frozen.submitted_at,
            submittedAt: frozen.submitted_at,
            status: "Returned",
            code: frozen.report_id,
            metrics: { entry: frozen.entries, exit: frozen.exits, peak: frozen.peak_occupancy, unique: frozen.unique_count },
            payload: frozen.payload,
            remarks: "Review additional qualifying observation",
          },
        ],
      });
    if (path.endsWith("/desktop/sample-preparation")) {
      sampleRequests += 1;
      return route.fulfill({ json: null });
    }
    return route.fulfill({ json: [] });
  });
  await mockMlRequest(page, "*", (request) => {
    const path = new URL(request.url).pathname;
    const reply = (body: unknown, status = 200) => mlResponse({ status, body: JSON.stringify(body) });
    if (path === "/context/enterprise") return reply({ enterprise_id: user.enterpriseId, enterprise_name: user.enterpriseName });
    if (path === "/cameras") return reply(mode === "mixed" ? [profile(1, "entrance_exit"), profile(2, "open_space")] : [profile(1, mode)]);
    if (path === "/cameras/runtime")
      return reply({ enterprise_id: user.enterpriseId, cameras: [], pending_camera_ids: [], active_camera_count: 0, max_configured_cameras: 6, max_concurrent_cameras: 6, enterprise_occupancy: 0 });
    if (path === "/health")
      return reply({
        status: "ok",
        service_version: "fixture",
        api_contract_version: 2,
        tripwire_hot_update: true,
        running: false,
        active_camera_count: 0,
        max_configured_cameras: 6,
        max_concurrent_cameras: 6,
      });
    if (path === "/metrics/establishment/summary") return reply(counting);
    if (path === "/metrics/establishment/live")
      return reply({ enterprise_id: user.enterpriseId, occupancy: 2, partial_occupancy: 2, state: "estimated", contributions: [], missing_camera_ids: [], excluded_camera_ids: [] });
    if (path === "/metrics/establishment/periods") return reply([{ period: "October 2026", metrics, counting }]);
    if (path.startsWith("/reports/drafts/")) {
      if (request.method === "GET") return reply(drafts.get(path) ?? null);
      if (request.method === "DELETE") {
        drafts.delete(path);
        return reply({ updated: 1 });
      }
      const body = JSON.parse(request.body!);
      drafts.set(path, body);
      return reply(body);
    }
    if (path === "/reports/local-submit") {
      const body = JSON.parse(request.body!);
      submissions.push(body);
      expect(body.expected_snapshot_version).toBe(counting.snapshot_version);
      expect(body.metrics).toEqual(metrics);
      const reportPayload = { ...body.payload, counting, metrics: payloadMetrics };
      saved = { ...fixture, ...metrics, report_id: body.report_id, submission_id: body.request_id, notes: body.notes, payload: reportPayload, counting, synced_at: null };
      return reply(saved);
    }
    if (path === "/reports/local") return reply(saved ? [saved] : []);
    if (path.endsWith("/synced")) {
      saved = { ...saved, sync_status: "synced" };
      return reply({ updated: 1 });
    }
    return reply({ detail: `Unconfigured ${path}` }, 503);
  });
  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(user.email);
  await page.getByPlaceholder("Enter your password").fill("Report fixture password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible({ timeout: 20_000 });
  return {
    counting,
    submissions,
    uploads,
    getSaved: () => saved,
    getSampleRequests: () => sampleRequests,
    enableUpload: () => {
      uploadAvailable = true;
    },
  };
}

for (const mode of ["open_space", "entrance_exit", "mixed"] as const) {
  test(`${mode} uses one form, frozen preview and offline report upload`, async ({ page }, testInfo) => {
    const state = await setup(page, mode);
    const row = page.locator("tbody tr").filter({ hasText: "October 2026" });
    await row.click();
    const basis = page.getByRole("region", { name: "Establishment counting basis" });
    await expect(basis).toContainText("One establishment total from both camera modes");
    await expect(basis).toContainText("someone returning on another day can contribute again");
    await expect(basis).toContainText(mode === "open_space" ? "Not measured" : "4");
    await expect(page.getByText("Unique visitors: 2", { exact: true })).toBeVisible();
    // The full demographic allocation uses one establishment baseline.
    await page.getByPlaceholder("M", { exact: true }).first().fill("1");
    await page.getByPlaceholder("F", { exact: true }).first().fill("1");
    await expect(page.getByText("Grand total: 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Submit Report", exact: true }).click();
    await page.getByRole("button", { name: "Yes, Submit", exact: true }).click();
    await expect.poll(() => state.submissions.length).toBe(1);
    await expect.poll(() => state.getSaved()?.sync_status).toBe("pending_cloud_sync");
    await expect(page.getByRole("button", { name: "Yes, Submit", exact: true })).toHaveCount(0);
    expect(state.uploads.length).toBeGreaterThan(0);
    expect(state.uploads[0].payload).toMatchObject({ counting: { snapshot_version: state.counting.snapshot_version }, metrics: { unique: 2 } });
    expect(state.uploads[0].entries).toBe(mode === "open_space" ? null : 3);
    expect(state.uploads[0].exits).toBe(mode === "open_space" ? null : 4);
    await expect(page.getByText("Open Space reporting is not available")).toHaveCount(0);
    const savedRow = page.locator("tbody tr").filter({ hasText: String(state.getSaved()!.report_id) });
    await savedRow.getByRole("button", { name: /View/ }).click();
    const preview = page.getByRole("dialog", { name: "DOT Form Preview" });
    await expect(preview.getByRole("region", { name: "Establishment counting basis" })).toContainText(mode === "open_space" ? "Not measured" : "4");
    const downloadEvent = page.waitForEvent("download");
    await preview.getByRole("button", { name: /Download/ }).click();
    const download = await downloadEvent;
    await download.saveAs(testInfo.outputPath(`${mode}-unified-report.pdf`));
    await page.screenshot({ path: testInfo.outputPath(`${mode}-unified-preview.png`) });
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    const firstUpload = state.uploads[0];
    state.enableUpload();
    await page.evaluate(() => window.dispatchEvent(new Event("tanaw:desktop-report-submitted")));
    await expect.poll(() => state.getSaved()?.sync_status, { timeout: 20_000 }).toBe("synced");
    expect(state.uploads.at(-1)?.submissionId).toBe(firstUpload.submissionId);
    expect(state.uploads.at(-1)?.uniqueCount).toBe(2);
    expect(state.submissions).toHaveLength(1);
    expect(state.getSampleRequests()).toBe(0);
  });
}

test("returned reports keep the old snapshot until counts are explicitly refreshed", async ({ page }) => {
  const state = await setup(page, "open_space", true);
  await page.locator("tbody tr").filter({ hasText: "REP-FIXTURE" }).click();
  await expect(page.getByRole("button", { name: "Resubmit Report", exact: true })).toBeVisible();
  await expect(page.getByText("Unique visitors: 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Grand total: 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh reconciled counts for this revision", exact: true }).click();
  await expect(page.getByText("Unique visitors: 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resubmit Report", exact: true })).toBeDisabled();
  await page.getByPlaceholder("M", { exact: true }).first().fill("2");
  await expect(page.getByText("Grand total: 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resubmit Report", exact: true }).click();
  await page.getByRole("button", { name: "Yes, Submit", exact: true }).click();
  await expect.poll(() => state.submissions.length).toBe(1);
  expect(state.submissions[0].report_id).toBe("REP-FIXTURE");
  expect(state.submissions[0].request_id).not.toBe(fixtures["open-space"].submission_id);
  expect(state.submissions[0].payload).toMatchObject({ status: "Resubmitted" });
  expect(state.submissions[0].metrics).toMatchObject({ unique_count: 3 });
  expect(state.submissions[0].expected_snapshot_version).toBe(fixtures["corrected-open-space"].counting.snapshot_version);
  expect(state.getSaved()?.unique_count).toBe(3);
});
