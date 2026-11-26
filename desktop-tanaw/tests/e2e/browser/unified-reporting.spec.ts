import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest, switchTheme } from "./support/preload";

const parkClassification = { code: "411", typeCode: "4", type: "Sports and Recreational Facilities", category: "Parks", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD409" };

test.describe.configure({ timeout: 60_000 });
const fixtures = Object.fromEntries(
  ["open-space", "entrance-exit", "mixed"].map((mode) => [
    mode,
    JSON.parse(readFileSync(new URL(`../../../ml-service/tests/fixtures/reports/${mode}-establishment-report.json`, import.meta.url), "utf8")),
  ]),
);
const user = { id: "report-operator", email: "reports@example.test", role: "enterprise", name: "Park Operator", enterpriseId: "park-fixture", enterpriseName: "Park", attraction: parkClassification };

const ONE_REPORT_PER_MONTH = "A report for October 2026 has already been submitted. An enterprise sends one report per reporting month, and a submitted report cannot be replaced.";

/** `submitted` starts with October 2026 already reported, both on this device and in TANAW. */
async function setup(page: Page, mode: "open_space" | "entrance_exit" | "mixed", submitted = false) {
  let signedIn = false;
  const fixture = fixtures[mode.replaceAll("_", "-")];
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
    confidence: 0.35,
    processingProfile: "auto",
    config: { tripwire: 50, reverse: false, roi: { top: 0, left: 0, width: 100, height: 100 } },
    openSpace: null,
  });
  let saved: Record<string, unknown> | null = submitted ? { ...fixture, sync_status: "synced" } : null;
  const submissions: Record<string, unknown>[] = [];
  const uploads: Record<string, unknown>[] = [];
  const drafts = new Map<string, unknown>();
  let uploadAvailable = false;
  let uploadRefusal: string | null = null;
  let uploadWait = Promise.resolve();
  let localSaveAvailable = true;
  let sampleRequests = 0;
  await page.clock.install({ time: new Date("2026-11-02T02:00:00Z") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ json: { token: "report-token", user } });
  });
  await page.route("**/auth/session", (route) => route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { token: "report-token", user } : { detail: "Sign in" } }));
  await page.route("**/auth/me", (route) => route.fulfill({ json: user }));
  await page.route("**/operational/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/desktop/report-submissions")) {
      uploads.push(route.request().postDataJSON());
      await uploadWait;
      if (uploadRefusal) return route.fulfill({ status: 409, json: { detail: uploadRefusal } });
      return route.fulfill({ status: uploadAvailable ? 202 : 503, json: uploadAvailable ? {} : { detail: "Offline test" } });
    }
    if (submitted && path.endsWith("/reports/intake"))
      return route.fulfill({
        json: [
          {
            id: "cloud-one",
            enterpriseId: user.enterpriseId,
            enterprise: "Park",
            category: "Parks",
            attraction: parkClassification,
            barangay: "Poblacion",
            month: "October",
            period: fixture.period,
            submitted: fixture.submitted_at,
            submittedAt: fixture.submitted_at,
            status: "Pending Review",
            code: fixture.report_id,
            metrics: { entry: fixture.entries, exit: fixture.exits, peak: fixture.peak_occupancy, unique: fixture.unique_count },
            payload: fixture.payload,
            remarks: null,
          },
        ],
      });
    if (path.endsWith("/desktop/sample-preparation")) return route.fulfill({ json: null });
    return route.fulfill({ json: [] });
  });
  await mockMlRequest(page, "*", (request) => {
    const path = new URL(request.url).pathname;
    const reply = (body: unknown, status = 200) => mlResponse({ status, body: JSON.stringify(body) });
    // Without a backend sample dataset, nothing synthetic may enter the local ledger.
    if (path === "/sample/prepare") sampleRequests += 1;
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
      if (!localSaveAvailable) return reply({ detail: "Local save unavailable" }, 503);
      expect(body.expected_snapshot_version).toBe(counting.snapshot_version);
      expect(body.payload.attractionCode).toBe("411");
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
  await page.getByRole("tab", { name: "Reports History", exact: true }).click();
  return {
    counting,
    submissions,
    uploads,
    getSaved: () => saved,
    getSampleRequests: () => sampleRequests,
    enableUpload: () => {
      uploadAvailable = true;
    },
    setLocalSaveAvailable: (available: boolean) => { localSaveAvailable = available; },
    refuseUpload: (detail: string) => { uploadRefusal = detail; },
    holdUpload: (until: Promise<void>) => { uploadWait = until; },
  };
}

for (const mode of ["open_space", "entrance_exit", "mixed"] as const) {
  test(`${mode} uses one form, frozen preview and offline report upload`, async ({ page }, testInfo) => {
    const state = await setup(page, mode);
    const row = page.locator("tbody tr").filter({ hasText: "October 2026" });
    await row.click();
    await expect(page.getByRole("dialog", { name: "Review Report Form", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Create Reports", exact: true }).click();
    await page.getByText("Report details, notes and camera evidence", { exact: true }).click();
    const basis = page.getByRole("region", { name: "Establishment counting basis" });
    await expect(basis).toContainText("One establishment total from both camera modes");
    await expect(basis).toContainText("someone returning on another day can contribute again");
    await expect(basis).toContainText(mode === "open_space" ? "Not measured" : "4");
    await expect(page.getByRole("status", { name: "System unique visitor count" })).toHaveText("2");
    // TANAW fills This City; visitors entered for other origins are deducted from it.
    await expect(page.getByRole("button", { name: /Selected day: October 10, 2026/ })).toBeVisible();
    await expect(page.getByLabel("This City Total", { exact: true })).toHaveText("2");
    // TANAW's male/female estimate of the day's unique visitors fills This City.
    await expect(page.getByLabel("This City Male", { exact: true })).toHaveText("1");
    await expect(page.getByLabel("This City Female", { exact: true })).toHaveText("1");
    await expect(page.getByRole("button", { name: "Submit Report", exact: true })).toBeDisabled();
    await page.getByRole("textbox", { name: "Other City Male", exact: true }).fill("1");
    await expect(page.getByLabel("This City Total", { exact: true })).toHaveText("1");
    await expect(page.getByLabel("This City Male", { exact: true })).toHaveText("0");
    await expect(page.getByLabel("This City Female", { exact: true })).toHaveText("1");
    await expect(page.locator(".report-origin-table tfoot td").last()).toHaveText("2");
    await page.getByRole("button", { name: "Submit Report", exact: true }).click();
    await page.getByRole("button", { name: "Yes, Submit", exact: true }).click();
    await expect.poll(() => state.submissions.length).toBe(1);
    await expect.poll(() => state.getSaved()?.sync_status).toBe("pending_cloud_sync");
    await expect(page.getByRole("button", { name: "Yes, Submit", exact: true })).toHaveCount(0);
    await expect(page.locator(".tanaw-toast--warning")).toContainText("was saved on this device");
    await expect(page.locator(".tanaw-toast--success").filter({ hasText: "Report submitted successfully" })).toHaveCount(0);
    expect(state.uploads.length).toBeGreaterThan(0);
    expect(state.uploads[0].payload).toMatchObject({
      counting: { snapshot_version: state.counting.snapshot_version },
      metrics: { unique: 2 },
      demo: { thisProvMale: "1", thisProvFemale: "1", thisProvUnspecified: "0" },
      var1: { thisCityMale: "0", thisCityFemale: "1", thisCityUnspecified: "0" },
      origins: { "2026-10-10": { otherCity: { male: 1, female: 0 } } },
    });
    expect(state.uploads[0].entries).toBe(mode === "open_space" ? null : 3);
    expect(state.uploads[0].exits).toBe(mode === "open_space" ? null : 4);
    await expect(page.getByText("Open Space reporting is not available")).toHaveCount(0);
    const savedRow = page.locator("tbody tr").filter({ hasText: String(state.getSaved()!.report_id) });
    await page.getByRole("tab", { name: "Reports History", exact: true }).click();
    await savedRow.getByRole("button", { name: /View/ }).click();
    const preview = page.getByRole("dialog", { name: "Review Report Form", exact: true });
    await expect(preview.getByText("411 - Parks", { exact: true })).toBeVisible();
    await preview.getByText("Report details and camera evidence", { exact: true }).click();
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

test("a submitted month is complete and offers no way to submit it again", async ({ page }) => {
  const state = await setup(page, "open_space", true);
  await page.locator("tbody tr").filter({ hasText: "REP-FIXTURE" }).click();
  await expect(page.getByRole("dialog", { name: "Review Report Form", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Create Reports", exact: true }).click();
  await expect(page.locator(".report-workflow-status")).toHaveText("Submitted · REP-FIXTURE");
  await expect(page.getByRole("button", { name: /Submit Report/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Resubmit/ })).toHaveCount(0);

  // The month no longer appears as a period waiting for a report.
  await page.getByRole("tab", { name: "Reports History", exact: true }).click();
  await expect(page.locator("tbody tr").filter({ hasText: "October 2026" })).toHaveCount(1);
  await expect(page.locator("tbody tr").filter({ hasText: "October 2026" })).toContainText("REP-FIXTURE");
  await expect(page.locator("tbody tr").filter({ hasText: "Pending Submission" })).toHaveCount(0);
  expect(state.submissions).toHaveLength(0);
  expect(state.uploads).toHaveLength(0);
});

test("a report TANAW refuses shows the backend's reason", async ({ page }) => {
  const state = await setup(page, "open_space");
  state.enableUpload();
  state.refuseUpload(ONE_REPORT_PER_MONTH);
  await page.locator("tbody tr").filter({ hasText: "October 2026" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Create Reports", exact: true }).click();
  await page.getByRole("textbox", { name: "Other City Male", exact: true }).fill("1");
  await page.getByRole("button", { name: "Submit Report", exact: true }).click();
  await page.getByRole("button", { name: "Yes, Submit", exact: true }).click();
  await expect.poll(() => state.uploads.length).toBe(1);
  const refused = page.locator(".tanaw-toast--error");
  await expect(refused).toContainText(`TANAW did not accept report ${state.getSaved()!.report_id}. ${ONE_REPORT_PER_MONTH}`);
  await expect(refused).toContainText("A copy is saved on this device.");
  await expect(page.locator(".tanaw-toast--success").filter({ hasText: "Report submitted successfully" })).toHaveCount(0);
  expect(state.submissions).toHaveLength(1);
});

test("reports validation, failed saving and confirmed upload without duplicate feedback", async ({ page }) => {
  const state = await setup(page, "open_space");
  await page.setViewportSize({ width: 1050, height: 760 });
  await switchTheme(page, "dark");
  await page.locator("tbody tr").filter({ hasText: "October 2026" }).click();
  await expect(page.getByRole("dialog", { name: "Review Report Form", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Create Reports", exact: true }).click();
  const submit = page.getByRole("button", { name: "Submit Report", exact: true });
  const success = page.locator(".tanaw-toast--success").filter({ hasText: "Report submitted successfully" });
  const warning = page.locator(".tanaw-toast--warning");
  const failure = page.locator(".tanaw-toast--error").filter({ hasText: "Report submission failed" });
  await expect(submit).toHaveAttribute("aria-disabled", "true");
  await submit.press("Enter");
  await submit.press("Enter");
  await expect(warning).toHaveCount(1);
  await expect(warning.getByRole("status")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Confirm Submission" })).toHaveCount(0);
  expect(state.submissions).toHaveLength(0);
  await warning.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(warning).toHaveCount(0);

  await page.getByRole("textbox", { name: "Other City Male", exact: true }).fill("1");
  state.setLocalSaveAvailable(false);
  await submit.click();
  const confirm = page.getByRole("button", { name: "Yes, Submit", exact: true });
  await confirm.click();
  await expect(failure.getByRole("alert")).toHaveText("Report submission failed. Please try again.");
  await expect(success).toHaveCount(0);
  expect(state.uploads).toHaveLength(0);
  expect(state.submissions).toHaveLength(1);

  state.setLocalSaveAvailable(true);
  state.enableUpload();
  let releaseUpload!: () => void;
  state.holdUpload(new Promise<void>((resolve) => { releaseUpload = resolve; }));
  try {
    await confirm.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => state.uploads.length).toBe(1);
    await expect(success).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submitting…" })).toBeDisabled();
  } finally {
    releaseUpload();
  }
  await expect(success.getByRole("status")).toHaveText(`Report submitted successfully. Reference ${state.getSaved()!.report_id}.`);
  await expect(success).toHaveCount(1);
  expect(state.submissions).toHaveLength(2);
  expect(state.submissions[0].request_id).toBe(state.submissions[1].request_id);
  await expect(success).toHaveCSS("pointer-events", "none");
  await switchTheme(page, "light");
  await expect(success.getByRole("button", { name: "Dismiss notification" })).toBeEnabled();
});

test("report filters, preview and responsive workspace retain the existing layout", async ({ page }, testInfo) => {
  await setup(page, "mixed", true);
  await switchTheme(page, "light");
  const search = page.getByRole("searchbox", { name: "Search reports" });
  await page.locator(".report-history-search > button").click();
  await search.fill("not-a-report");
  await expect(page.getByText("No matching reports found.", { exact: true })).toBeVisible();
  await search.fill("REP-FIXTURE");
  await expect(page.locator("tbody tr").filter({ hasText: "REP-FIXTURE" })).toHaveCount(1);
  await search.fill("");
  await page.getByRole("combobox", { name: "Filter reports by status" }).click();
  await page.getByRole("option", { name: "Submitted", exact: true }).click();
  await expect(page.locator("tbody tr").filter({ hasText: "REP-FIXTURE" })).toHaveCount(1);
  await page.getByRole("combobox", { name: "Filter reports by status" }).click();
  await page.getByRole("option", { name: "All Statuses", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("reports-desktop.png"), fullPage: true });
  for (const width of [1024, 760, 430]) {
    await page.setViewportSize({ width, height: 900 });
    const workspace = page.locator("[data-reports-surface='var1-workspace']");
    await expect.poll(() => workspace.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("reports-" + width + ".png"), fullPage: true });
  }
});

// Design review capture (DESIGN.md), tagged @design-capture: run it with `npm run capture:design`.
test("captures Reports for design review", { tag: "@design-capture" }, async ({ page }) => {
  const folder = process.env.TANAW_DESIGN_CAPTURE;
  test.skip(!folder, "Run design captures with npm run capture:design.");
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page, "mixed", true);
  for (const theme of ["light", "dark"] as const) {
    await switchTheme(page, theme);
    await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("tab", { name: "Reports History", exact: true }).click();
    await page.screenshot({ path: `${folder}/reports-history-${theme}.png`, fullPage: true });
    await page.getByRole("tab", { name: "Create Reports", exact: true }).click();
    await page.screenshot({ path: `${folder}/reports-create-${theme}.png`, fullPage: true });
  }
});
