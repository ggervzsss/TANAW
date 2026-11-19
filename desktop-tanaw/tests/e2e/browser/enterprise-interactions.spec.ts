import { selectDashboardPeriod } from "./support/dashboard";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mlResponse, mockCameraSetup, mockMlRequest, mockRememberedSession } from "./support/preload";
import { token } from "../support/theme-and-filters";

const enterpriseUser = {
  id: "enterprise-interactions-test",
  name: "Interaction Test Enterprise",
  displayName: "Interaction Test Enterprise",
  email: "enterprise-interactions@example.test",
  role: "enterprise",
  title: "Enterprise Account",
  enterpriseId: "interaction_test@tanaw.sanpedro",
  enterpriseName: "Interaction Test Enterprise",
  buildingCapacity: 100,
};

async function signIn(page: Page, configureMl?: () => Promise<void>, remember = false) {
  let signedIn = false;
  await page.addInitScript(() => window.localStorage.setItem("tanaw-enterprise-theme", "dark"));
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "enterprise-interactions-token", user: enterpriseUser }) });
  });
  await page.route("**/auth/session", (route) => {
    if (!signedIn) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Not authenticated" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "enterprise-interactions-token", user: enterpriseUser }) });
  });
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(enterpriseUser) }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/tickets", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await mockMlRequest(page, "*", (request) => {
    if (new URL(request.url).pathname === "/context/enterprise") {
      return mlResponse({ status: 200, body: JSON.stringify({ enterprise_id: enterpriseUser.enterpriseId, enterprise_name: enterpriseUser.enterpriseName }) });
    }
    return mlResponse({ status: 503, body: JSON.stringify({ detail: "ML service unavailable in renderer acceptance test" }) });
  });

  await configureMl?.();
  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(enterpriseUser.email);
  await page.getByPlaceholder("Enter your password").fill("Enterprise interaction password 2026");
  if (remember) await page.getByRole("checkbox", { name: "Remember me" }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
}

test("recovers camera hydration after service startup and restores live updates after disconnect", async ({ page }) => {
  test.setTimeout(60_000);
  await renderTestVideoFrames(page);
  let runtimeReads = 0;
  let profileReads = 0;
  const camera = {
    id: 1,
    name: "Live camera",
    zone: "Entrance",
    status: "stopped",
    cameraBrand: "tapo",
    cameraHost: "192.168.1.20",
    rtsp: "rtsp://192.168.1.20/stream2",
    processingProfile: "auto",
    confidence: 0.35,
    trackingConfidence: 0.15,
    config: {
      tripwire: 50,
      reverse: false,
      roi: { top: 0, left: 0, width: 100, height: 100 },
      tripwires: {
        entry: { start: { x: 42, y: 12 }, end: { x: 42, y: 88 } },
        exit: { start: { x: 58, y: 12 }, end: { x: 58, y: 88 } },
      },
    },
  };
  await signIn(page, async () => {
    await mockCameraSetup(page, enterpriseUser.enterpriseId);
    await mockMlRequest(page, "/cameras", () => {
      profileReads += 1;
      if (profileReads < 3) throw new Error("connect ECONNREFUSED: ML service still starting");
      return mlResponse({ status: 200, body: JSON.stringify([camera]) });
    });
    await mockMlRequest(page, "/cameras/runtime", () => {
      runtimeReads += 1;
      return mlResponse({
        status: 200,
        body: JSON.stringify({
          enterprise_id: enterpriseUser.enterpriseId,
          enterprise_occupancy: 0,
          active_camera_count: 0,
          max_configured_cameras: 4,
          max_concurrent_cameras: 2,
          pending_camera_ids: [],
          cameras: [],
        }),
      });
    });
  });
  await page.goto("/#/enterprise/cameras");
  await expect(page.getByRole("heading", { name: "Live camera", exact: true })).toBeVisible();
  expect(profileReads).toBeGreaterThanOrEqual(3);
  const counts = { entry: 3, exit: 1, occupancy: 2, running: true, status: "running", error: null, started_at: null };
  const envelope = {
    type: "camera.states",
    data: {
      enterprise_id: enterpriseUser.enterpriseId,
      enterprise_occupancy: 2,
      active_camera_count: 1,
      max_configured_cameras: 4,
      max_concurrent_cameras: 2,
      pending_camera_ids: [],
      cameras: [
        {
          camera_id: 1,
          counts,
          area: null,
          detections: {
            running: true,
            status: "running",
            error: null,
            frame_width: 640,
            frame_height: 360,
            tracks: [{ track_id: 7, source_track_id: 7, confidence: 0.9, bbox: [60, 50, 160, 300], centroid: [110, 175], direction: null, counting_debug: null }],
          },
          health: {
            status: "ok",
            running: true,
            error: null,
            model_ready: true,
            analytics_fps: 11.7,
            processed_frame_stale_ms: 10,
            estimated_unique_count: 3,
            confirmed_unique_count: 3,
            degraded_unique_count: 0,
          },
          session: { running: true, status: "running", error: null, counts },
        },
      ],
    },
  };
  const emit = (payload: unknown) => page.evaluate((detail) => window.dispatchEvent(new CustomEvent("e2e-ml-live-event", { detail })), payload);
  await emit(envelope);
  const performance = page.locator(".camera-page-heading").getByText(/11\.7 AI FPS/);
  await expect(performance).toBeVisible({ timeout: 1000 });
  const box = page.locator("[data-track-id=\"7\"]");
  await expect(box).toBeVisible();
  expect(await box.evaluate((element) => (element as HTMLElement).style.left)).toBe("9.375%");
  envelope.data.cameras[0].detections.tracks[0].bbox = [300, 50, 400, 300];
  await emit(envelope);
  await expect.poll(() => box.evaluate((element) => (element as HTMLElement).style.left), { timeout: 1000 }).toBe("46.875%");
  await page.waitForTimeout(1200); // Allow the separate cloud-telemetry reconciliation to finish.
  const readsAfterLive = runtimeReads;
  await page.waitForTimeout(2700);
  expect(runtimeReads).toBe(readsAfterLive);
  await emit({ type: "disconnected" });
  await expect.poll(() => runtimeReads).toBeGreaterThan(readsAfterLive);
  await emit({ type: "service.error", code: "local_database_reset_required", message: "Close TANAW and reset the local database.", retryable: false });
  await expect(page.locator(".camera-preview-feedback")).toContainText("Close TANAW and reset the local database.");
  const readsAfterReset = runtimeReads;
  await page.waitForTimeout(2700);
  expect(runtimeReads).toBe(readsAfterReset);
  await emit({ type: "connected" });
  await emit(envelope);
  await expect(performance).toBeVisible();
});

async function expectSettledTopbarGlass(glass: Locator, tab: Locator) {
  await expect(glass).toBeVisible();
  const bounds = (await tab.boundingBox())!;
  await expect.poll(async () => {
    const pill = (await glass.boundingBox())!;
    return Math.abs(pill.x + 4 - bounds.x) + Math.abs(pill.width - bounds.width - 8);
  }).toBeLessThan(2);
}

test("updates Support Ticket selects together after a theme change", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/#/enterprise/tickets");

  const category = page.getByRole("combobox", { name: "Category" });
  const priority = page.getByRole("combobox", { name: "Priority" });
  await expect(category).toBeVisible();
  await expect(priority).toBeVisible();
  const initialDarkState = await page.evaluate(() => ({
    categoryBackground: getComputedStyle(document.querySelector('[aria-label="Category"]') as HTMLElement).backgroundColor,
    priorityBackground: getComputedStyle(document.querySelector('[aria-label="Priority"]') as HTMLElement).backgroundColor,
  }));
  expect(initialDarkState.categoryBackground).not.toBe("rgb(255, 255, 255)");
  expect(initialDarkState.priorityBackground).toBe(initialDarkState.categoryBackground);

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const lightState = await page.evaluate(() => {
    const categorySelect = document.querySelector('[aria-label="Category"]') as HTMLElement;
    const prioritySelect = document.querySelector('[aria-label="Priority"]') as HTMLElement;
    return {
      categoryBackground: getComputedStyle(categorySelect).backgroundColor,
      isDark: document.documentElement.classList.contains("dark"),
      priorityBackground: getComputedStyle(prioritySelect).backgroundColor,
      transitionDelay: getComputedStyle(categorySelect).transitionDelay,
    };
  });
  expect(lightState.isDark).toBe(false);
  expect(lightState.priorityBackground).toBe(lightState.categoryBackground);
  expect(lightState.transitionDelay.split(",").every((delay) => delay.trim() === "0s")).toBe(true);
  await expect(category).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(priority).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await category.click();
  await expect(page.getByRole("listbox", { name: "Category" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Category" }).locator("..")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const darkState = await page.evaluate(() => {
    const categorySelect = document.querySelector('[aria-label="Category"]') as HTMLElement;
    const prioritySelect = document.querySelector('[aria-label="Priority"]') as HTMLElement;
    return {
      categoryBackground: getComputedStyle(categorySelect).backgroundColor,
      isDark: document.documentElement.classList.contains("dark"),
      priorityBackground: getComputedStyle(prioritySelect).backgroundColor,
    };
  });
  expect(darkState.isDark).toBe(true);
  expect(darkState.priorityBackground).toBe(darkState.categoryBackground);
  await expect(category).toHaveCSS("background-color", initialDarkState.categoryBackground);
  await expect(priority).toHaveCSS("background-color", initialDarkState.priorityBackground);
});

test("reveals and focuses the first invalid Support Ticket field", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await signIn(page);
  await page.goto("/#/enterprise/tickets");

  await page.getByRole("button", { name: "Submit Ticket" }).click();
  const subject = page.getByPlaceholder("Brief summary of the issue");
  await expect(subject).toBeFocused();
  await expect(subject).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a ticket subject.", { exact: true })).toBeVisible();

  await subject.fill("Camera unavailable");
  await page.getByPlaceholder("Describe what happened, when it started, and any affected workflows.").fill("The camera feed stopped updating this morning.");
  await page.getByRole("button", { name: "Submit Ticket" }).click();
  const affectedArea = page.getByRole("textbox", { name: /^Affected Area/ });
  await expect(affectedArea).toBeFocused();
  await expect(affectedArea).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter the affected area.", { exact: true })).toBeVisible();
});

test("keeps the modern Reports workspace dense, rounded, and fully interactive", async ({ page }) => {
  // About sixty steps across both themes, three viewports and the report preview; a busy full
  // suite run can take longer than the default 30 seconds.
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const reportDemo = {
    thisProvMale: "30",
    thisProvFemale: "30",
    otherProvMale: "15",
    otherProvFemale: "15",
    foreignMale: "5",
    foreignFemale: "5",
  };
  await mockMlRequest(page, "*", (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/context/enterprise") {
      return mlResponse({ status: 200, body: JSON.stringify({ enterprise_id: enterpriseUser.enterpriseId, enterprise_name: enterpriseUser.enterpriseName }) });
    }
    if (url.pathname === "/metrics/summary") {
      return mlResponse({
        status: 200,
        body: JSON.stringify({
          entries: 120,
          exits: 80,
          peak_occupancy: 40,
          current_occupancy: 40,
          unique_count: 100,
          estimated_unique_count: 100,
          confirmed_unique_count: 100,
          degraded_unique_count: 0,
          pending_unique_entries: 0,
          repeat_entry_count: 20,
          occupancy_correction_delta: 0,
          total_events: 200,
          unsubmitted_events: 200,
          unsynced_events: 0,
          first_event_at: "2026-08-01T00:00:00Z",
          last_event_at: "2026-08-10T12:00:00Z",
          period: "2026-08",
        }),
      });
    }
    if (url.pathname === "/reports/local") {
      return mlResponse({
        status: 200,
        body: JSON.stringify([
          {
            report_id: "REP-202607",
            period: "2026-07",
            submitted_at: "2026-08-01T01:00:00Z",
            entries: 140,
            exits: 90,
            peak_occupancy: 50,
            unique_count: 100,
            notes: "Monthly operational summary",
            payload: { status: "Consolidated", demo: reportDemo, metrics: { entries: 140, exits: 90, peak: 50, unique: 100 } },
            sync_status: "synced",
            synced_at: "2026-08-01T01:01:00Z",
            camera_breakdown: [],
          },
        ]),
      });
    }
    if (url.pathname.startsWith("/reports/drafts/")) return mlResponse({ status: 200, body: "null" });
    return mlResponse({ status: 503, body: JSON.stringify({ detail: "Not required by Reports presentation coverage" }) });
  });
  await page.route("**/operational/desktop/sample-preparation", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.route("**/operational/reports/intake", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  await page.goto("/#/enterprise/reports");
  const workspace = page.locator("[data-reports-surface='var1-workspace']");
  await expect(workspace).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly DOT Visitor Report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Report Workspace" })).toHaveCount(0);
  await expect.poll(() => page.getByText("REP-202607", { exact: true }).count()).toBeGreaterThan(0);
  await expect(page.locator(".report-create-card")).toHaveCSS("border-radius", "16px");
  // The date picker lists the reporting month; dark surfaces stay distinct from the card.
  await page.locator(".report-day-picker > button").click();
  const calendar = page.getByRole("group", { name: /^Days of / });
  await expect(calendar).toBeVisible();
  const raised = await token(page, "--theme-raised");
  await expect(page.locator(".report-day-popover")).toHaveCSS("background-color", raised);
  expect(await page.locator(".report-create-card").evaluate((card) => getComputedStyle(card).backgroundColor)).not.toBe(raised);
  await page.keyboard.press("Escape");
  await expect(calendar).toBeHidden();
  await page.getByText("Report details, notes and camera evidence", { exact: true }).click();
  const notes = page.getByPlaceholder("Add notes regarding events, closures, or demographic estimates...");
  await notes.fill("Updated report workspace notes");
  await expect(notes).toHaveValue("Updated report workspace notes");

  const search = page.getByPlaceholder("Search reports");
  await page.getByRole("tab", { name: "Reports History", exact: true }).click();
  await page.locator(".report-history-search > button").click();
  await search.fill("REP-202607");
  await expect(page.getByText("REP-202607", { exact: true }).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Filter reports by status" }).click();
  await page.getByRole("option", { name: "Consolidated" }).click();
  await page.getByRole("button", { name: "View REP-202607", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Review Report Form", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS("border-radius", "16px");
  const reportPaper = preview.locator(".var1-document");
  await expect(reportPaper).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(reportPaper).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(reportPaper.getByRole("heading", { name: "TOURISM ATTRACTION VISITOR RECORD" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  await expect(preview.getByRole("button", { name: "Close preview", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("button", { name: "Download PDF" })).toBeVisible();
  await preview.getByRole("button", { name: "Close preview", exact: true }).click();

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("tab", { name: "Create Reports", exact: true }).click();
  // A report submitted before daily entry shows its monthly origins, without a date picker.
  await expect(page.getByRole("table", { name: "Monthly visitor origins" })).toBeVisible();
  await expect(page.locator(".report-day-picker")).toHaveCount(0);
  await page.getByRole("tab", { name: "Reports History", exact: true }).click();
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect(workspace).toBeVisible();
  await expect(page.getByRole("button", { name: "Search reports", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test("presents unified daily history and distinguishes observed zero from missing data", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1100, height: 760 });
  await signIn(page);
  await mockMlRequest(page, "/metrics/establishment/live", () =>
    mlResponse({
      status: 200,
      body: JSON.stringify({
        enterprise_id: enterpriseUser.enterpriseId,
        occupancy: 15,
        partial_occupancy: 15,
        state: "estimated",
        contributions: [],
        excluded_camera_ids: [],
        missing_camera_ids: [],
      }),
    }),
  );
  await mockMlRequest(page, "/metrics/establishment/summary", (request) => {
    const query = new URL(request.url).searchParams;
    const start = query.get("start")!;
    const end = query.get("end")!;
    const length = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
    const zero = length === 30;
    const days = Array.from({ length }, (_, index) => ({
      business_date: new Date(Date.parse(start) + index * 86400000 + 8 * 3600000).toISOString().slice(0, 10),
      covered_ms: 86400000,
      qualified_observations: zero ? 0 : 2,
      identification_state: "available",
      unique_count: zero ? 0 : 2,
      peak_occupancy: zero ? 0 : 3,
    }));
    return mlResponse({
      status: 200,
      body: JSON.stringify({
        enterprise_id: enterpriseUser.enterpriseId,
        from_at: start,
        to_at: end,
        days,
        days_available: length,
        days_requested: length,
        unique_count: zero ? 0 : length * 2,
        entries: zero ? 0 : length * 3,
        exits: zero ? 0 : length,
        peak_occupancy: zero ? 0 : 3,
        reconciliation_state: "estimated",
        identification_state: "available",
        movement_state: "available",
        coverage_ratio: 1,
        unresolved_observations: 0,
        source_breakdown: [],
      }),
    });
  });
  await mockMlRequest(page, "/reports/local", () => mlResponse({ status: 200, body: "[]" }));
  await page.goto("/#/enterprise/dashboard");
  await expect(page.getByText("Current Occupancy", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Unique Visitors", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Dashboard date range" })).toContainText("Today,");
  await expect(page.getByRole("img", { name: "Today establishment peak occupancy history" })).toBeVisible();
  await selectDashboardPeriod(page, "Month");
  await expect(page.getByText("Available observations recorded no visitor activity. Gaps remain unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Month establishment peak occupancy history" })).toBeVisible();
  const header = page.locator("[data-unified-metrics-header]");
  await expect(header.locator('[data-metric-segment="visitors"]').getByText("0", { exact: true })).toBeVisible();
  await selectDashboardPeriod(page, "Today");
  await expect(page.getByRole("img", { name: "Today establishment peak occupancy history" })).toBeVisible();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("keeps the camera-service warning and explains unavailable historical data", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1100, height: 760 });
  await signIn(page);
  let requests = 0;
  await mockMlRequest(page, "/metrics/establishment/summary", () => {
    requests += 1;
    return mlResponse({ status: 503, body: JSON.stringify({ detail: "Establishment history intentionally unavailable" }) });
  });
  await page.goto("/#/enterprise/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(page.getByText("History unavailable. Check the local camera service.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Today establishment peak occupancy history" })).toHaveCount(0);
});

test("keeps Enterprise password inputs empty and reveals only manually entered text", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/auth/change-password", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      currentPassword: "Current enterprise passphrase 2026",
      newPassword: "Replacement enterprise passphrase 2026",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "enterprise-updated-token", user: enterpriseUser }),
    });
  });
  await signIn(page);
  await page.goto("/#/enterprise/security");

  const currentPassword = page.getByPlaceholder("Enter your current password");
  const newPassword = page.getByPlaceholder("Use a long password");
  const confirmation = page.getByPlaceholder("Repeat the password");
  const currentToggle = page.getByRole("button", { name: "Show current password" });
  await expect(currentPassword).toHaveValue("");
  await expect(newPassword).toHaveValue("");
  await expect(confirmation).toHaveValue("");
  await expect(currentPassword).toHaveAttribute("autocomplete", "new-password");
  await expect(currentPassword).toHaveAttribute("readonly", "");
  await expect(currentPassword).toHaveAttribute("data-1p-ignore", "true");
  await expect(currentToggle).toBeDisabled();

  await currentPassword.focus();
  await expect(currentPassword).not.toHaveAttribute("readonly", "");
  await currentPassword.fill("Current enterprise passphrase 2026");
  await expect(currentToggle).toBeEnabled();
  await currentToggle.click();
  await expect(currentPassword).toHaveAttribute("type", "text");
  await expect(currentPassword).toHaveValue("Current enterprise passphrase 2026");
  await page.getByRole("button", { name: "Hide current password" }).click();
  await newPassword.fill("Replacement enterprise passphrase 2026");
  await confirmation.fill("Replacement enterprise passphrase 2026");
  await page.getByRole("button", { name: "Update Password" }).click();
  await expect(page.getByText("Password updated.")).toBeVisible();
  await expect(currentPassword).toHaveValue("");
  await expect(newPassword).toHaveValue("");
  await expect(confirmation).toHaveValue("");

  await page.goto("/#/enterprise/dashboard");
  await page.goto("/#/enterprise/security");
  await expect(page.getByPlaceholder("Enter your current password")).toHaveValue("");
  await expect(page.getByPlaceholder("Use a long password")).toHaveValue("");
  await expect(page.getByPlaceholder("Repeat the password")).toHaveValue("");
});

test("keeps resolved Support Ticket history visible and closes the composer", async ({ page }) => {
  const resolvedTicket = {
    id: "ticket-resolved",
    code: "TCK-000099",
    enterpriseId: enterpriseUser.enterpriseId,
    enterpriseName: enterpriseUser.enterpriseName,
    submittedBy: enterpriseUser.displayName,
    category: "Camera Issue",
    priority: "High",
    subject: "Resolved camera concern",
    description: "The camera concern has already been resolved.",
    affectedArea: "Lobby",
    cameraNode: null,
    attachments: [],
    status: "Resolved",
    createdAt: "2026-07-23T12:11:04.071391+00:00",
    updatedAt: "2026-07-23T12:15:04.071391+00:00",
    messages: [
      {
        id: "message-1",
        authorName: "Default IT Personnel",
        authorRole: "it",
        message: "The connection has been restored.",
        createdAt: "2026-07-23T12:14:04.071391+00:00",
      },
    ],
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.route("**/operational/tickets**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname.endsWith("/ticket-resolved") ? resolvedTicket : [resolvedTicket];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/#/enterprise/tickets");

  await page.getByRole("button", { name: /Resolved camera concern/ }).click();
  await expect(page.getByText("The connection has been restored.", { exact: true })).toBeVisible();
  await expect(page.getByText("This ticket is resolved. The conversation is now closed.", { exact: false })).toBeVisible();
  await expect(page.getByText("Reply in TANAW", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send Reply" })).toHaveCount(0);
});

test("keeps the active glass visible and retargets it through desktop navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockRememberedSession(page);
  await signIn(page, () => mockCameraSetup(page, enterpriseUser.enterpriseId), true);
  await page.goto("/#/enterprise/cameras");
  const navigation = page.getByRole("navigation", { name: "Enterprise navigation", exact: true });
  const cameras = navigation.getByRole("button", { name: "Camera Setup" });
  const dashboard = navigation.getByRole("button", { name: "Dashboard" });
  const reports = navigation.getByRole("button", { name: "Reports" });
  const glass = navigation.locator("[data-topbar-glass-indicator]");
  const hover = navigation.locator("[data-topbar-glass-hover]");

  await expect(cameras).toHaveAttribute("aria-current", "page");
  await expectSettledTopbarGlass(glass, cameras);
  await expect(navigation.locator("[data-topbar-active-underline]")).toHaveCount(0);
  await dashboard.hover();
  await expect(hover).toHaveCSS("opacity", "1");
  await expectSettledTopbarGlass(glass, cameras);
  const hoveredHeight = (await hover.boundingBox())!.height;
  await page.mouse.down();
  await expect.poll(async () => (await hover.boundingBox())!.height).toBeLessThan(hoveredHeight - 1);
  await page.mouse.up();
  await expect(dashboard).toHaveAttribute("aria-current", "page");
  await expectSettledTopbarGlass(glass, dashboard);

  const from = (await dashboard.boundingBox())!;
  const to = (await reports.boundingBox())!;
  await Promise.all([
    page.waitForFunction(({ min, max }) => {
      const pill = document.querySelector("[data-topbar-glass-indicator]");
      if (!pill) return false;
      const rect = pill.getBoundingClientRect();
      const center = rect.x + rect.width / 2;
      return center > min + 8 && center < max - 8 && getComputedStyle(pill).visibility === "visible";
    }, { min: from.x + from.width / 2, max: to.x + to.width / 2 }),
    reports.press("Enter"),
  ]);
  await cameras.press("Enter");
  await reports.press("Enter");
  await expect(reports).toHaveAttribute("aria-current", "page");
  await expectSettledTopbarGlass(glass, reports);
  await expect(reports).toHaveCSS("transform", "none");

  await page.goBack();
  await expect(cameras).toHaveAttribute("aria-current", "page");
  await expectSettledTopbarGlass(glass, cameras);
  await page.reload();
  await expectSettledTopbarGlass(glass, cameras);
  await dashboard.focus();
  await expect(dashboard).toHaveCSS("outline-style", "solid");
  await expect(cameras).toHaveAttribute("aria-current", "page");

  await page.setViewportSize({ width: 800, height: 700 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobile = page.getByRole("navigation", { name: "Enterprise mobile navigation" });
  await expect(mobile.getByRole("button", { name: "Camera Setup" })).toHaveAttribute("aria-current", "page");
  await expect(mobile.locator("[data-topbar-glass-indicator]")).toBeVisible();
});

async function renderTestVideoFrames(page: Page) {
  await page.route("**/interaction-frame.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#486456"/></svg>' }),
  );
  await page.addInitScript(() => {
    const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...source,
      set(value: string) {
        source.set!.call(this, value.startsWith("tanaw-ml://") ? new URL("/interaction-frame.svg", location.origin).href : value);
      },
    });
    const original = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      return original.call(this, name, this instanceof HTMLImageElement && name === "src" && value.startsWith("tanaw-ml://") ? new URL("/interaction-frame.svg", location.origin).href : value);
    };
  });
}

test("themes the camera modal and keeps the minimized Tripwire toolbar draggable", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await renderTestVideoFrames(page);
  await signIn(page, () => mockCameraSetup(page, enterpriseUser.enterpriseId));
  await page.goto("/#/enterprise/cameras");
  const addCamera = page.getByRole("button", { name: "Add Camera", exact: true });
  await expect(addCamera).toHaveCount(1);
  await expect(addCamera).toBeVisible();
  await addCamera.click();

  let dialog = page.locator(".camera-add-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await dialog.getByLabel("Camera Name", { exact: false }).fill("Temporary camera");
  await dialog.getByRole("button", { name: "Add Camera", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Camera Connection", exact: true })).toBeVisible();
  await dialog.getByLabel("Camera Password", { exact: false }).fill("secret-camera-password");
  await dialog.getByRole("button", { name: "Show password" }).click();
  await expect(dialog.getByLabel("Camera Password", { exact: false })).toHaveAttribute("type", "text");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard Changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await addCamera.click();
  dialog = page.locator(".camera-add-dialog");
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await dialog.getByLabel("Camera Name", { exact: false }).fill("Entrance");
  await dialog.getByLabel("Camera Location", { exact: false }).fill("Lobby");
  await dialog.getByRole("button", { name: "Add Camera", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill("127.0.0.1");
  await dialog.getByLabel("Camera Username", { exact: false }).fill("admin");
  await dialog.getByLabel("Camera Password", { exact: false }).fill("camera-password");
  await dialog.getByRole("button", { name: "Test & Add Camera", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("heading", { name: "Live Metrics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /system status|camera connection/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start Camera", exact: true })).toBeVisible();

  const selectedCamera = page.getByRole("button", { name: /Entrance/, pressed: true });
  await selectedCamera.hover();
  await expect(selectedCamera).toHaveCSS("transform", "none");
  expect(Number.parseFloat(await addCamera.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThan(12);

  await page.evaluate(async (enterpriseId) => {
    const response = await window.tanawMlService!.request({ url: "http://127.0.0.1:8765/cameras", method: "GET", timeoutMs: 2500 });
    const camera = JSON.parse(response.body)[0];
    const counts = { entry: 0, exit: 0, occupancy: 0, running: true, status: "running", error: null };
    window.dispatchEvent(
      new CustomEvent("e2e-ml-live-event", {
        detail: {
          type: "camera.states",
          data: {
            enterprise_id: enterpriseId,
            enterprise_occupancy: 0,
            active_camera_count: 1,
            pending_camera_ids: [],
            cameras: [
              {
                camera_id: camera.id,
                counts,
                detections: { running: true, status: "running", frame_width: 640, frame_height: 360, tracks: [] },
                health: { status: "ok", model_ready: true, running: true, raw_frame_id: 1, raw_frame_stale_ms: 0, analytics_fps: 12 },
                area: null,
                session: { running: true, counts },
              },
            ],
          },
        },
      }),
    );
  }, enterpriseUser.enterpriseId);
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await page.getByRole("tab", { name: "Counting Area", exact: true }).click();
  await page.getByRole("button", { name: "Edit Counting Area", exact: true }).click();
  await page.getByRole("button", { name: "Hide tripwire toolbar" }).click();
  const minimized = page.getByRole("button", { name: "Show tripwire toolbar" });
  const toolbar = minimized.locator("..");
  const overlay = toolbar.locator("..");
  const before = await toolbar.boundingBox();
  expect(before).not.toBeNull();

  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2 + 120, before!.y + before!.height / 2 + 70, { steps: 5 });
  await page.mouse.up();
  const after = await toolbar.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x).toBeGreaterThan(before!.x + 80);
  expect(after!.y).toBeGreaterThan(before!.y + 40);
  await expect(minimized).toBeVisible();
  await expect(page.getByRole("button", { name: "Move tripwire toolbar" })).toHaveCount(0);

  const overlayBox = await overlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  await page.mouse.move(after!.x + after!.width / 2, after!.y + after!.height / 2);
  await page.mouse.down();
  await page.mouse.move(overlayBox!.x - 100, overlayBox!.y - 100, { steps: 5 });
  await page.mouse.up();
  const clamped = await toolbar.boundingBox();
  expect(clamped).not.toBeNull();
  expect(clamped!.x).toBeGreaterThanOrEqual(overlayBox!.x);
  expect(clamped!.y).toBeGreaterThanOrEqual(overlayBox!.y);

  await minimized.click();
  await expect(page.getByRole("button", { name: "Move tripwire toolbar" })).toBeVisible();

  await page.getByRole("button", { name: "Use this Area", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 800, height: 500 });
  await expect(page.getByRole("heading", { name: "Camera Monitoring" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toBeVisible();
  const narrowMetrics = page.getByRole("heading", { name: "Live Metrics" });
  await narrowMetrics.scrollIntoViewIfNeeded();
  await expect(narrowMetrics).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("keeps pending business-email information readable in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await page.route("**/auth/profile/business-email-change", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ requestedEmail: "proposed-enterprise@example.test", status: "pending" }),
    }),
  );
  await page.goto("/#/enterprise/profile");

  const pendingCard = page.locator(".enterprise-profile-pending-email");
  await expect(pendingCard).toBeVisible();
  await expect(page.getByText("proposed-enterprise@example.test", { exact: false })).toBeVisible();
  const darkTitle = await token(page, "--theme-text");
  await expect(pendingCard.locator(".enterprise-profile-pending-email__title")).toHaveCSS("color", darkTitle);
  await expect(pendingCard.locator(".enterprise-profile-pending-email__copy")).toHaveCSS("color", await token(page, "--theme-secondary"));
  await expect(page.getByRole("button", { name: "Cancel request" })).toBeVisible();

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(pendingCard.locator(".enterprise-profile-pending-email__title")).not.toHaveCSS("color", darkTitle);
  await expect(page.getByText("proposed-enterprise@example.test", { exact: false })).toBeVisible();
});

async function mockStoppedCameraRuntime(page: Page, profiles: () => Array<Record<string, unknown>>) {
  await mockMlRequest(page, "/cameras/runtime", () =>
    mlResponse({
      status: 200,
      body: JSON.stringify({
        enterprise_id: enterpriseUser.enterpriseId,
        enterprise_occupancy: 0,
        active_camera_count: 0,
        pending_camera_ids: [],
        cameras: profiles().map((camera) => ({
          camera_id: camera.id,
          counts: { entry: null, exit: null, occupancy: null, running: false, status: "stopped", error: null },
          detections: { running: false, status: "stopped", frame_width: 640, frame_height: 360, tracks: [] },
          health: { status: "ok", model_ready: true, running: false },
          area: { available: false, active_visits: [] },
          session: {},
        })),
      }),
    }),
  );
}

test("sets up Tapo, Tenda and custom RTSP cameras from the IP address alone", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, () => mockCameraSetup(page, enterpriseUser.enterpriseId));
  await page.goto("/#/enterprise/cameras");
  const writes: Array<{ cameras: Array<Record<string, unknown>> }> = [];
  await mockMlRequest(page, "/cameras", (request) => {
    if (request.method === "PUT") writes.push(JSON.parse(request.body ?? "{}"));
    return mlResponse({ status: 200, body: JSON.stringify(writes.at(-1)?.cameras ?? []) });
  });
  await mockStoppedCameraRuntime(page, () => writes.at(-1)?.cameras ?? []);
  const choose = async (name: string, option: string) => {
    await page.getByRole("combobox", { name, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  for (const [brand, name, ip] of [
    ["TP-Link Tapo", "Existing Tapo", "192.168.1.20"],
    ["Tenda", "New Tenda CH3", "192.168.1.21"],
    ["Custom RTSP", "Custom Camera", "192.168.1.22"],
  ]) {
    await page.getByRole("button", { name: "Add Camera", exact: true }).click();
    const dialog = page.locator(".camera-add-dialog");
    await dialog.getByLabel("Camera Name", { exact: false }).fill(name);
    await dialog.getByLabel("Camera Location", { exact: false }).fill("Lobby");
    if (brand !== "TP-Link Tapo") await choose("Camera brand / type", brand);
    await dialog.getByRole("button", { name: "Add Camera", exact: true }).click();
    if (brand === "Custom RTSP") {
      await dialog.getByRole("textbox", { name: "RTSP stream address", exact: true }).fill(`rtsp://${ip}:9554/live?channel=2&subtype=0`);
    } else {
      await dialog.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill(ip);
      for (const hidden of ["Video quality", "RTSP port", "Stream path and query", "Tenda connection profile", "Advanced connection settings"]) {
        await expect(dialog.getByText(hidden, { exact: true })).toHaveCount(0);
      }
    }
    await dialog.getByLabel("Camera Username", { exact: false }).fill("admin");
    await dialog.getByLabel("Camera Password", { exact: false }).fill("device-password");
    if (brand === "Tenda") await page.screenshot({ path: test.info().outputPath("tenda-setup.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Test & Add Camera", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => writes.at(-1)?.cameras.length).toBe(brand === "TP-Link Tapo" ? 1 : brand === "Tenda" ? 2 : 3);
  }
  // The Tenda address is the one the connection test found working, not a user choice.
  expect(writes.at(-1)?.cameras.map((camera) => camera.rtsp)).toEqual(["rtsp://192.168.1.20/stream2", "rtsp://192.168.1.21:8554/profile1", "rtsp://192.168.1.22:9554/live?channel=2&subtype=0"]);
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "RTSP stream address", exact: true })).toHaveValue("rtsp://192.168.1.22:9554/live?channel=2&subtype=0");
  await page.getByRole("textbox", { name: "RTSP stream address", exact: true }).fill("rtsp://192.168.1.22:9554/live?channel=3&subtype=1");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit configuration" })).toBeVisible();
  expect(writes.at(-1)?.cameras[2]?.rtsp).toBe("rtsp://192.168.1.22:9554/live?channel=3&subtype=1");
  expect(writes.at(-1)?.cameras[0]?.rtsp).toBe("rtsp://192.168.1.20/stream2");
  expect(JSON.stringify(writes)).not.toContain("device-password");
  await page.getByRole("button", { name: /New Tenda CH3/ }).click();
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Camera IP Address", exact: true })).toHaveValue("192.168.1.21");
  await expect(page.getByText("Video Stream", { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill("192.168.1.25");
  await page.getByRole("button", { name: "Test Camera Connection", exact: true }).click();
  await expect(page.getByText("Camera connection verified", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit configuration" })).toBeVisible();
  await expect.poll(() => writes.at(-1)?.cameras[1]).toMatchObject({ cameraHost: "192.168.1.25", rtsp: "rtsp://192.168.1.25:8554/profile1" });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  await choose("Camera brand / type", "Tenda");
  await page.getByLabel("Camera Name", { exact: false }).fill("Small window camera");
  await page.locator(".camera-add-dialog").getByRole("button", { name: "Add Camera", exact: true }).click();
  await page.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill("192.168.1.23");
  await page.setViewportSize({ width: 375, height: 812 });
  const dialog = page.locator(".camera-add-dialog");
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("tenda-setup-small-light.png"), fullPage: true });
});

test("adds and edits a Dahua camera from its IP address", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, () => mockCameraSetup(page, enterpriseUser.enterpriseId));
  await page.goto("/#/enterprise/cameras");
  const writes: Array<{ cameras: Array<Record<string, unknown>> }> = [];
  await mockMlRequest(page, "/cameras", (request) => {
    if (request.method === "PUT") writes.push(JSON.parse(request.body ?? "{}"));
    return mlResponse({ status: 200, body: JSON.stringify(writes.at(-1)?.cameras ?? []) });
  });
  await mockStoppedCameraRuntime(page, () => writes.at(-1)?.cameras ?? []);
  const choose = async (name: string, option: string) => {
    await page.getByRole("combobox", { name, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  const dialog = page.locator(".camera-add-dialog");
  await choose("Camera brand / type", "Dahua");
  await dialog.getByLabel("Camera Name", { exact: false }).fill("Dahua B200");
  await dialog.getByLabel("Camera Location", { exact: false }).fill("Entrance");
  await dialog.getByRole("button", { name: "Add Camera", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill("192.168.1.23");
  await dialog.getByLabel("Camera Username", { exact: false }).fill("admin");
  await dialog.getByLabel("Camera Password", { exact: false }).fill("device-password");
  await expect(dialog.getByText("Use the camera's own username and password", { exact: false })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("dahua-setup.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Test & Add Camera", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => writes.at(-1)?.cameras[0])
    .toMatchObject({
      cameraBrand: "dahua",
      rtsp: "rtsp://192.168.1.23:554/cam/realmonitor?channel=1&subtype=1",
    });

  await page.getByRole("button", { name: "Edit configuration" }).click();
  await expect(page.getByRole("combobox", { name: "Camera brand / type" })).toContainText("Dahua");
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await page.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill("192.168.1.24");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit configuration" })).toBeVisible();
  await expect
    .poll(() => writes.at(-1)?.cameras[0])
    .toMatchObject({
      cameraBrand: "dahua",
      cameraHost: "192.168.1.24",
      rtsp: "rtsp://192.168.1.24:554/cam/realmonitor?channel=1&subtype=1",
    });
  expect(JSON.stringify(writes)).not.toContain("device-password");
});
