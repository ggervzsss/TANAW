import { expect, test, type Page } from "@playwright/test";

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

async function signIn(page: Page) {
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
  await page.route("http://127.0.0.1:8765/**", (route) => {
    if (new URL(route.request().url()).pathname === "/context/enterprise") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enterprise_id: enterpriseUser.enterpriseId, enterprise_name: enterpriseUser.enterpriseName }) });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "ML service unavailable in renderer acceptance test" }) });
  });

  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(enterpriseUser.email);
  await page.getByPlaceholder("Enter your password").fill("Enterprise interaction password 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
}

async function readTopbarGlassFrame(page: Page) {
  return page.evaluate(() => {
    const material = document.querySelector<HTMLElement>("[data-topbar-glass-indicator='true']");
    const optics = document.querySelector<HTMLElement>("[data-topbar-glass-optics='foreground-endcaps']");
    if (!material || !optics) throw new Error("Liquid glass layers are missing");
    const rect = material.getBoundingClientRect();
    return {
      center: rect.left + rect.width / 2,
      materialOpacity: Number(getComputedStyle(material).opacity),
      opticsOpacity: Number(getComputedStyle(optics).opacity),
    };
  });
}

async function expectSettledTopbarGlass(page: Page, targetCenter: number) {
  await expect.poll(async () => Math.abs((await readTopbarGlassFrame(page)).center - targetCenter), { timeout: 1_500, intervals: [16, 24, 32, 48] }).toBeLessThan(1);
  await expect.poll(async () => (await readTopbarGlassFrame(page)).materialOpacity, { timeout: 1_500 }).toBeGreaterThan(0.95);
  await expect.poll(async () => (await readTopbarGlassFrame(page)).opticsOpacity, { timeout: 1_500, intervals: [16, 24, 32, 48] }).toBeLessThanOrEqual(0.01);
}

test("updates Support Ticket selects in the same theme transaction", async ({ page }) => {
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

  const lightState = await page.evaluate(() => {
    (document.querySelector('[aria-label="Switch to light mode"]') as HTMLButtonElement).click();
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
  expect(lightState.transitionDelay).toBe("0s");
  await expect(category).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(priority).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await category.click();
  await expect(page.getByRole("listbox", { name: "Category" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Category" }).locator("..")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("Escape");

  const darkState = await page.evaluate(() => {
    (document.querySelector('[aria-label="Switch to dark mode"]') as HTMLButtonElement).click();
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
  const affectedArea = page.getByPlaceholder("Lobby, reports, account");
  await expect(affectedArea).toBeFocused();
  await expect(affectedArea).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter the affected area.", { exact: true })).toBeVisible();
});

test("keeps the modern Reports workspace dense, rounded, and fully interactive", async ({ page }) => {
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
  await page.route("http://127.0.0.1:8765/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/context/enterprise") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enterprise_id: enterpriseUser.enterpriseId, enterprise_name: enterpriseUser.enterpriseName }) });
    }
    if (url.pathname === "/metrics/summary") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
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
      return route.fulfill({
        status: 200,
        contentType: "application/json",
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
    if (url.pathname.startsWith("/reports/drafts/")) return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Not required by Reports presentation coverage" }) });
  });
  await page.route("**/operational/desktop/sample-preparation", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.route("**/operational/reports/intake", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  await page.goto("/#/enterprise/reports");
  const workspace = page.locator("[data-reports-surface='camera-setup-generation']");
  await expect(workspace).toBeVisible();
  await expect(page.getByRole("heading", { name: "Report Workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Report Submissions" })).toBeVisible();
  await expect.poll(() => page.getByText("REP-202607", { exact: true }).count()).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Report Workspace" }).locator("..")).toHaveCSS("border-radius", "22px");
  const demographicCards = page.locator(".tanaw-demographic-card");
  await expect(demographicCards).toHaveCount(3);
  await expect(demographicCards.first()).toHaveCSS("background-color", "rgb(16, 25, 35)");
  const darkDemographicSurfaces = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".tanaw-demographic-card");
    const input = document.querySelector<HTMLElement>(".tanaw-demographic-input");
    const total = document.querySelector<HTMLElement>(".tanaw-demographic-total");
    return {
      card: card ? getComputedStyle(card).backgroundColor : null,
      input: input ? getComputedStyle(input).backgroundColor : null,
      total: total ? getComputedStyle(total).backgroundColor : null,
    };
  });
  expect(darkDemographicSurfaces.input).not.toBe("rgb(255, 255, 255)");
  expect(darkDemographicSurfaces.total).not.toBe("rgb(255, 255, 255)");
  expect(darkDemographicSurfaces.input).not.toBe(darkDemographicSurfaces.card);
  expect(darkDemographicSurfaces.total).not.toBe(darkDemographicSurfaces.card);

  await page.getByRole("button", { name: "Assisted" }).click();
  await expect(page.getByText("Assisted Allocation", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manual" }).click();
  await page.getByRole("button", { name: "Fill Remaining" }).click();
  const notes = page.getByPlaceholder("Add notes regarding events, closures, or demographic estimates...");
  await notes.fill("Updated report workspace notes");
  await expect(notes).toHaveValue("Updated report workspace notes");

  const search = page.getByPlaceholder("Search reports");
  await search.fill("REP-202607");
  await expect(page.getByText("REP-202607", { exact: true }).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Filter reports by status" }).click();
  await page.getByRole("option", { name: "Consolidated" }).click();
  await page.getByRole("button", { name: "View REP-202607", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "DOT Form Preview" });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS("border-radius", "26px");
  await expect(preview.getByText("Ready for Export", { exact: true })).toBeVisible();
  const reportPaper = preview.locator(".enterprise-dot-document");
  await expect(reportPaper).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(reportPaper).toHaveCSS("color", "rgb(17, 24, 39)");
  await expect(reportPaper.getByRole("heading", { name: "TANAW - DOT Visitor Attraction Report" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  await expect(preview.getByRole("button", { name: "Close Preview", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("button", { name: "Download PDF" })).toBeVisible();
  await preview.getByRole("button", { name: "Close preview", exact: true }).click();

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(demographicCards.first()).toHaveCSS("background-color", "rgb(240, 245, 241)");
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect(workspace).toBeVisible();
  await expect(page.getByPlaceholder("Search reports")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test("presents accurate responsive historical trends and an intentional zero state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const summary = {
    entries: 32,
    exits: 12,
    peak_occupancy: 18,
    current_occupancy: 15,
    unique_count: 24,
    estimated_unique_count: 24,
    confirmed_unique_count: 24,
    degraded_unique_count: 0,
    pending_unique_entries: 0,
    repeat_entry_count: 8,
    occupancy_correction_delta: 0,
    total_events: 44,
    unsubmitted_events: 44,
    unsynced_events: 0,
    first_event_at: "2026-08-11T01:00:00Z",
    last_event_at: "2026-08-11T03:00:00Z",
    period: "2026-08",
  };
  const populated = [
    { label: "09:00", visitors: 8, entries: 12, exits: 2, peak_occupancy: 12, current_occupancy: 12 },
    { label: "10:00", visitors: 14, entries: 20, exits: 4, peak_occupancy: 18, current_occupancy: 18 },
    { label: "11:00", visitors: 20, entries: 32, exits: 12, peak_occupancy: 18, current_occupancy: 15 },
  ];
  const zero = [
    { label: "Aug 1", visitors: 0, entries: 0, exits: 0, peak_occupancy: 0, current_occupancy: 0 },
    { label: "Aug 2", visitors: 0, entries: 0, exits: 0, peak_occupancy: 0, current_occupancy: 0 },
  ];

  await page.route("http://127.0.0.1:8765/metrics/summary**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(summary) }));
  await page.route("http://127.0.0.1:8765/metrics/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ hourly_density: [], historical: { Today: populated, Week: populated, Month: zero } }),
    }),
  );
  await page.route("http://127.0.0.1:8765/reports/local**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/#/enterprise/dashboard");

  await expect(page.getByText("Live Occupancy", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Entry & Exit Flow", { exact: true })).toBeVisible();
  await expect(page.getByText("Unique Entries", { exact: true })).toBeVisible();
  const week = page.getByRole("button", { name: "Week", exact: true });
  await expect(week).toHaveAttribute("aria-pressed", "true");
  const chart = page.getByRole("img", { name: "Week historical visitor trends for Entry Flow and Live Occupancy" });
  await expect(chart).toBeVisible();
  await expect(page.locator(".tanaw-trend-plot .recharts-line")).toHaveCount(2);
  const linePath = page.locator(".tanaw-trend-plot .recharts-line-curve").first();
  await expect(linePath).toHaveAttribute("d", /^M[^C]+$/);

  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByText("No visitor activity recorded for this period.", { exact: true })).toBeVisible();
  await expect(page.locator(".tanaw-trend-plot")).toHaveCount(0);

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("img", { name: "Today historical visitor trends for Entry Flow and Live Occupancy" })).toBeVisible();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.locator(".tanaw-trend-plot")).toBeVisible();
});

test("keeps the camera-service warning and explains unavailable historical data", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await signIn(page);

  await expect(page.getByText("Historical data is temporarily unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText("TANAW will display visitor trends when the local camera service is ready.", { exact: true })).toBeVisible();
  await expect(page.getByText("Visitor counts unavailable", { exact: false })).toBeVisible();
  await expect(page.locator(".tanaw-trend-plot")).toHaveCount(0);
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

  await page.getByText("Resolved camera concern", { exact: true }).click();
  await expect(page.getByText("The connection has been restored.", { exact: true })).toBeVisible();
  await expect(page.getByText("This ticket is resolved. The conversation is now closed.", { exact: false })).toBeVisible();
  await expect(page.getByText("Reply in TANAW", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send Reply" })).toHaveCount(0);
});

test("themes the camera modal and keeps the minimized Tripwire toolbar draggable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/#/enterprise/cameras");
  const cameraNavigation = page.getByRole("button", { name: "Camera Setup", exact: true });
  const dashboardNavigation = page.getByRole("button", { name: "Dashboard", exact: true });
  const reportsNavigation = page.getByRole("button", { name: "Reports", exact: true });
  const glassIndicator = page.locator("[data-topbar-glass-indicator='true']");
  const activeUnderline = cameraNavigation.locator("[data-topbar-active-underline='true']");
  await expect(cameraNavigation).toHaveAttribute("aria-current", "page");
  await expect(activeUnderline).toHaveCount(1);
  await expect(glassIndicator).toHaveCount(1);
  expect(await glassIndicator.getAttribute("data-topbar-glass-target")).toBeNull();
  await expect(glassIndicator).toHaveCSS("opacity", "0");
  await expect(page.locator("[data-topbar-active-surface], [data-topbar-liquid-layer], [data-topbar-liquid-bridge]")).toHaveCount(0);
  await dashboardNavigation.hover();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "dashboard");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-origin", "droplet-center");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-motion", "raf-spring");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-geometry", "continuous-capsule");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-shape", "continuous-waterdrop");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge", "replicated-lens-refraction");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-thickness", "feathered-lens-band");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-distortion", "motion-gated");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-band", "outer-14px");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-rest-optics", "clear");
  const refractiveEdge = glassIndicator.locator("[data-topbar-glass-refraction='background-adaptive']");
  await expect(refractiveEdge).toHaveCount(1);
  const foregroundOptics = page.locator("[data-topbar-glass-optics='foreground-endcaps']");
  await expect(foregroundOptics).toHaveCount(1);
  await expect(foregroundOptics).toHaveAttribute("data-topbar-glass-edge-zone", "feathered");
  await expect(foregroundOptics).toHaveAttribute("data-topbar-glass-optics-activation", "rendered-edge-velocity");
  await expect(foregroundOptics.locator("[data-topbar-glass-edge-side]")).toHaveCount(0);
  await expect(glassIndicator.locator("[data-topbar-glass-lobe], [data-topbar-glass-neck]")).toHaveCount(0);
  const refractionTrack = foregroundOptics.locator("[data-topbar-refraction-track='filtered-navigation-copy']");
  await expect(refractionTrack).toHaveCSS("filter", /tanaw-topbar-lens/);
  await expect(refractionTrack).toHaveAttribute("data-topbar-lens-magnification", "1.10x1.06");
  await expect(refractionTrack.locator("[data-topbar-refraction-copy='true']")).toHaveCount(3);
  await expect(refractionTrack).toContainText("Camera Setup");
  const opticalFilter = page.locator("filter[id^='tanaw-topbar-lens-']");
  await expect(opticalFilter.locator("feDisplacementMap")).toHaveAttribute("scale", "22");
  await expect(opticalFilter.locator("[data-topbar-glass-smear='neutral']")).toHaveAttribute("stdDeviation", "2.4 0.32");
  await expect(opticalFilter.locator("[data-topbar-glass-smear-output='true']")).toHaveAttribute("in", "neutralSmear");
  await expect(opticalFilter.locator("[data-topbar-glass-core='attenuated']")).toHaveAttribute("result", "warpedCore");
  await expect(opticalFilter.locator("[data-topbar-chromatic-channel]")).toHaveCount(2);
  await expect(foregroundOptics).toHaveCSS("backdrop-filter", /blur/);
  await expect(foregroundOptics).toHaveCSS("z-index", "20");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-response", "filtered-foreground-replica");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-surface", "transparent");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-chromatic", "split-fringe");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-stretch", "integrated-endcap");
  await expect(glassIndicator).toHaveCSS("border-top-width", "1px");
  await expect(glassIndicator).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(glassIndicator).toHaveCSS("clip-path", "none");
  await page.waitForTimeout(480);
  const dashboardBox = await dashboardNavigation.boundingBox();
  const cameraBox = await cameraNavigation.boundingBox();
  expect(dashboardBox).not.toBeNull();
  expect(cameraBox).not.toBeNull();
  const dashboardCenter = dashboardBox!.x + dashboardBox!.width / 2;
  await expectSettledTopbarGlass(page, dashboardCenter);
  await cameraNavigation.hover();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "cameras");
  await expect
    .poll(
      async () => {
        const frame = await readTopbarGlassFrame(page);
        return Math.abs(frame.center - dashboardCenter) > 1 && frame.opticsOpacity > 0.15 && frame.materialOpacity > 0.85;
      },
      { timeout: 900, intervals: [16, 16, 24, 32] },
    )
    .toBe(true);
  await page.waitForTimeout(260);
  const stretchedGlassBox = await glassIndicator.boundingBox();
  expect(stretchedGlassBox).not.toBeNull();
  const cameraCenter = cameraBox!.x + cameraBox!.width / 2;
  const glidingCenter = stretchedGlassBox!.x + stretchedGlassBox!.width / 2;
  const fullUnionWidth = cameraBox!.x + cameraBox!.width - dashboardBox!.x;
  expect(glidingCenter).toBeGreaterThan(dashboardCenter);
  expect(glidingCenter).toBeLessThan(cameraCenter);
  expect(stretchedGlassBox!.width).toBeLessThan(fullUnionWidth * 0.85);
  await expect(glassIndicator).toHaveCSS("border-radius", /px$/);
  await page.mouse.move((dashboardBox!.x + dashboardBox!.width + cameraBox!.x) / 2, cameraBox!.y + cameraBox!.height / 2);
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-state", "gap");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "gap:dashboard:cameras");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-deformation", "1.000");
  await expect(glassIndicator).toHaveCSS("border-radius", /px$/);
  await reportsNavigation.hover();
  const reportsGlass = glassIndicator;
  await expect(reportsGlass).toHaveAttribute("data-topbar-glass-target", "reports");
  await page.waitForTimeout(720);
  const reportsBox = await reportsNavigation.boundingBox();
  const reportsGlassBox = await reportsGlass.boundingBox();
  expect(reportsGlassBox!.x + reportsGlassBox!.width / 2).toBeCloseTo(reportsBox!.x + reportsBox!.width / 2, 0);
  const reportsCenter = reportsBox!.x + reportsBox!.width / 2;
  await expectSettledTopbarGlass(page, reportsCenter);
  await page.mouse.down();
  await page.mouse.move(reportsBox!.x + reportsBox!.width + 38, reportsBox!.y + reportsBox!.height / 2, { steps: 6 });
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-state", "pull");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "pull:reports:right");
  const pullAmount = Number(await glassIndicator.getAttribute("data-topbar-glass-pull"));
  expect(pullAmount).toBeGreaterThan(0.4);
  await page.waitForTimeout(120);
  const pulledBox = await glassIndicator.boundingBox();
  expect(pulledBox).not.toBeNull();
  expect(pulledBox!.width).toBeGreaterThan(reportsBox!.width + 24);
  expect(pulledBox!.width).toBeLessThan(reportsBox!.width + 38);
  expect(pulledBox!.x + pulledBox!.width - (reportsBox!.x + reportsBox!.width)).toBeGreaterThan(18);
  const pulledOpticsBox = await foregroundOptics.boundingBox();
  expect(pulledOpticsBox).not.toBeNull();
  expect(Math.abs(pulledOpticsBox!.width - pulledBox!.width)).toBeLessThan(1.5);
  const pulledRadii = await page.evaluate(() => {
    const material = document.querySelector("[data-topbar-glass-indicator='true']");
    const optics = document.querySelector("[data-topbar-glass-optics='foreground-endcaps']");
    return { material: material ? getComputedStyle(material).borderRadius : null, optics: optics ? getComputedStyle(optics).borderRadius : null };
  });
  expect(pulledRadii.optics).toBe(pulledRadii.material);
  await page.mouse.up();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "reports");
  await page.waitForTimeout(260);
  const releasedBox = await glassIndicator.boundingBox();
  expect(releasedBox!.width).toBeCloseTo(reportsBox!.width + 8, 0);
  await expectSettledTopbarGlass(page, reportsCenter);
  await reportsNavigation.blur();
  await expect(reportsNavigation).not.toHaveCSS("transform", /matrix/);
  await cameraNavigation.hover();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "cameras");
  await expect
    .poll(
      async () => {
        const frame = await readTopbarGlassFrame(page);
        return Math.abs(frame.center - reportsCenter) > 1 && frame.opticsOpacity > 0.15 && frame.materialOpacity > 0.85;
      },
      { timeout: 900, intervals: [16, 16, 24, 32] },
    )
    .toBe(true);
  await expect(activeUnderline).toHaveCount(1);
  await page.mouse.move(900, 150);
  await expect.poll(() => glassIndicator.getAttribute("data-topbar-glass-target")).toBeNull();
  await expect(glassIndicator).toHaveCSS("opacity", "0");
  await expect(activeUnderline).toHaveCount(1);
  await dashboardNavigation.focus();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "dashboard");
  await page.keyboard.press("Tab");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "cameras");

  const addCamera = page.getByRole("button", { name: "Add Camera", exact: true });
  await expect(addCamera).toHaveCount(1);
  await expect(addCamera).toBeVisible();
  await addCamera.click();

  let dialog = page.getByRole("dialog", { name: "Add Camera" });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(dialog.getByText("RTSP Camera Configuration", { exact: true })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Password", exact: true }).fill("secret-camera-password");
  await dialog.getByRole("button", { name: "Show password" }).click();
  await expect(dialog.getByRole("textbox", { name: "Password", exact: true })).toHaveAttribute("type", "text");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await addCamera.click();
  dialog = page.getByRole("dialog", { name: "Add Camera" });
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await dialog.getByRole("textbox", { name: "Camera Name", exact: true }).fill("Entrance");
  await dialog.getByRole("textbox", { name: "Assigned Zone", exact: true }).fill("Lobby");
  await dialog.getByPlaceholder("192.168.1.9").fill("127.0.0.1");
  await dialog.getByRole("textbox", { name: "Username", exact: true }).fill("admin");
  await dialog.getByRole("textbox", { name: "Password", exact: true }).fill("camera-password");
  await dialog.getByRole("button", { name: "Save Configuration" }).click();

  const controlsHeading = page.getByText("SYSTEM STATUS & CONTROLS", { exact: true });
  await expect(controlsHeading).toBeVisible();
  await expect(page.getByText("Camera Connection", { exact: true })).toBeVisible();
  await expect(page.getByText("Stream Protocol", { exact: true })).toBeVisible();
  await expect(page.getByText("Profile pending", { exact: false })).toHaveCount(0);
  await expect(page.getByText("FPS adaptive", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Frame Telemetry Idle", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Service", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Test", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  const cameraWorkspace = page.locator("[data-camera-sidebar]");
  const cameraPanel = page.locator("#configured-cameras-panel");
  const selectedCamera = cameraPanel.locator("button[aria-pressed='true']");
  const selectedCameraTop = (await selectedCamera.boundingBox())?.y ?? 0;
  await selectedCamera.hover();
  await expect(selectedCamera).toHaveCSS("transform", "none");
  expect((await selectedCamera.boundingBox())?.y ?? 0).toBeCloseTo(selectedCameraTop, 0);
  const collapseControl = page.getByRole("button", { name: "Collapse configured cameras" });
  const expandedPanelBox = await cameraPanel.boundingBox();
  const expandedControlBox = await collapseControl.boundingBox();
  expect(expandedControlBox && expandedPanelBox).toBeTruthy();
  expect((expandedControlBox?.x ?? 0) + (expandedControlBox?.width ?? 0) / 2).toBeCloseTo((expandedPanelBox?.x ?? 0) + (expandedPanelBox?.width ?? 0), 0);
  expect((expandedControlBox?.y ?? 0) + (expandedControlBox?.height ?? 0) / 2).toBeCloseTo((expandedPanelBox?.y ?? 0) + (expandedPanelBox?.height ?? 0) / 2, 0);
  const previewWorkspace = cameraWorkspace.locator(":scope > div").nth(1);
  const expandedPreviewWidth = (await previewWorkspace.boundingBox())?.width ?? 0;
  await collapseControl.click();
  await expect(cameraWorkspace).toHaveAttribute("data-camera-sidebar", "collapsed");
  await expect(page.getByRole("button", { name: "Expand configured cameras" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toHaveCount(0);
  await expect.poll(async () => (await previewWorkspace.boundingBox())?.width ?? 0).toBeGreaterThan(expandedPreviewWidth + 100);
  await expect(page.getByRole("button", { name: "Test", exact: true })).toBeVisible();
  const expandControl = page.getByRole("button", { name: "Expand configured cameras" });
  const collapsedPanelBox = await cameraPanel.boundingBox();
  const collapsedControlBox = await expandControl.boundingBox();
  expect((collapsedControlBox?.y ?? 0) + (collapsedControlBox?.height ?? 0) / 2).toBeCloseTo((collapsedPanelBox?.y ?? 0) + (collapsedPanelBox?.height ?? 0) / 2, 0);
  await expandControl.click();
  await expect(cameraWorkspace).toHaveAttribute("data-camera-sidebar", "expanded");
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toBeVisible();
  expect(Number.parseFloat(await addCamera.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThan(12);

  await page.getByRole("button", { name: "Edit configuration" }).click();
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

  await page.setViewportSize({ width: 800, height: 500 });
  await expect(page.getByRole("heading", { name: "Camera Setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toBeVisible();
  await page.getByText("SYSTEM STATUS & CONTROLS", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Test", exact: true })).toBeVisible();
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
  await expect(pendingCard.locator(".enterprise-profile-pending-email__title")).toHaveCSS("color", "rgb(255, 248, 232)");
  await expect(pendingCard.locator(".enterprise-profile-pending-email__copy")).toHaveCSS("color", "rgb(216, 222, 232)");
  await expect(page.getByRole("button", { name: "Cancel request" })).toBeVisible();

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(pendingCard.locator(".enterprise-profile-pending-email__title")).not.toHaveCSS("color", "rgb(255, 248, 232)");
  await expect(page.getByText("proposed-enterprise@example.test", { exact: false })).toBeVisible();
});
