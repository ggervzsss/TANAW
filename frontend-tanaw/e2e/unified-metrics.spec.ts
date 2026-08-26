import { expect, test, type Locator, type Page } from "@playwright/test";

type PortalRole = "admin" | "it" | "staff";
type Theme = "dark" | "light";

const telemetrySummary = {
  enterpriseCount: 7,
  onlineGateways: 2,
  delayedGateways: 1,
  offlineGateways: 4,
  totalCurrentOccupancy: 12,
  totalEntries: 677,
  totalExits: 665,
  totalUniqueCount: 457,
  activeReports: 3,
  pendingReports: 3,
  lastSyncAt: "2026-07-29T07:09:00Z",
};

function createPortalUser(role: PortalRole) {
  return {
    id: `${role}-unified-metrics`,
    email: `${role}.metrics@example.test`,
    displayName: role === "it" ? "IT Personnel" : role === "staff" ? "LGU Staff" : "LGU Admin",
    role,
    title: role === "it" ? "IT Personnel" : role === "staff" ? "LGU Staff" : "LGU Admin",
    phone: null,
    firstName: "Unified",
    lastName: "Metrics",
    enterpriseId: null,
    enterpriseName: null,
    category: null,
    managerName: null,
    barangay: null,
    address: null,
    buildingCapacity: 100,
    displayImageDataUrl: null,
  };
}

async function mockPortal(page: Page, role: PortalRole, theme: Theme) {
  const user = createPortalUser(role);
  await page.addInitScript((nextTheme) => window.localStorage.setItem("tanaw-web-theme", nextTheme), theme);
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: `${role}-metrics-token`, user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", (route) => {
    const body = route.request().method() === "PATCH" ? route.request().postDataJSON() : { theme };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/operational/telemetry/summary", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(telemetrySummary) }));

  for (const endpoint of [
    "**/operational/alerts",
    "**/operational/notifications",
    "**/operational/tickets",
    "**/operational/reports/enterprises",
    "**/operational/reports/intake",
    "**/operational/reports/final",
    "**/accounts/enterprises",
    "**/accounts/lgu",
    "**/accounts/email-deliveries",
    "**/activity-logs",
  ]) {
    await page.route(endpoint, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  }
}

async function expectUnifiedHeader(header: Locator, titles: string[], dividerCount = titles.length - 1) {
  await expect(header).toHaveCount(1);
  await expect(header.locator("[data-metrics-accent]")).toHaveCount(1);
  await expect(header.locator("[data-metric-segment]")).toHaveCount(titles.length);
  await expect(header.locator("[data-metric-divider]")).toHaveCount(dividerCount);
  await expect(header.locator(".tanaw-unified-metrics__scroller")).toHaveAttribute("tabindex", "0");
  for (const title of titles) await expect(header.getByText(title, { exact: true })).toBeVisible();

  const firstSegment = header.locator("[data-metric-segment]").first().locator(".tanaw-unified-metrics__segment");
  const beforeHover = await firstSegment.boundingBox();
  expect(beforeHover?.height).toBeGreaterThanOrEqual(158);
  await firstSegment.hover();
  await expect(firstSegment.locator(".tanaw-unified-metrics__hover")).toHaveCSS("opacity", "1");
  const afterHover = await firstSegment.boundingBox();
  expect(afterHover?.width).toBeCloseTo(beforeHover?.width ?? 0, 1);
  expect(afterHover?.height).toBeCloseTo(beforeHover?.height ?? 0, 1);
}

test("unifies Admin summary metrics without changing the surrounding pages", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockPortal(page, "admin", "light");

  await page.goto("/admin/activity-history");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Today", "Report Updates", "Admin Activity", "Important Updates"]);
  await expect(page.getByPlaceholder("Search activity, name, affected item, or details")).toBeVisible();

  await page.goto("/admin/operations");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Needs Attention", "Busy Establishments", "Escalated Support", "Account Requests"]);
  await expect(page.getByRole("link", { name: "Open Live Map" })).toBeVisible();
});

test("unifies IT summary metrics in dark mode and preserves responsive overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockPortal(page, "it", "dark");

  await page.goto("/it/dashboard");
  const dashboardHeader = page.locator("[data-unified-metrics-header]");
  await expectUnifiedHeader(dashboardHeader, ["Urgent Issues", "Desktop Apps", "Support Requests", "Account Requests", "Email Problems"]);
  await expect(dashboardHeader).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(dashboardHeader.locator(".tanaw-unified-metrics__icon").first()).toHaveCSS("transform", "none");
  await expect(page.getByRole("heading", { name: "Current Work" })).toBeVisible();
  for (const category of ["Technical Issues", "Support Requests", "Account Requests", "Email Problems"]) {
    await expect(page.getByRole("link", { name: new RegExp(category) })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Desktop Application Status" })).toBeVisible();
  await expect(page.getByText("2 online, 1 delayed, and 4 offline.", { exact: true })).toBeVisible();
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await expect(page.getByText("Delayed", { exact: true })).toBeVisible();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Account Directory" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Accounts" })).toBeVisible();
  await expect(page.locator(".tanaw-it-health-card")).not.toHaveCSS("background-color", "rgb(255, 255, 255)");

  for (const zoom of ["90%", "100%", "110%"]) {
    await page.evaluate((nextZoom) => {
      document.documentElement.style.zoom = nextZoom;
    }, zoom);
    const dimensions = await dashboardHeader.locator(".tanaw-unified-metrics__scroller").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dimensions.clientWidth).toBeGreaterThan(0);
    expect(dimensions.scrollWidth).toBeGreaterThanOrEqual(dimensions.clientWidth);
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = "100%";
  });

  await page.goto("/it/work-center");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Needs Attention", "Urgent", "Working on It", "Resolved"]);
  await expect(page.getByPlaceholder("Search issue, enterprise, person, or suggested action")).toBeVisible();

  await page.goto("/it/work-center?view=support");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Open Requests", "High Priority", "Working on It", "With Photos"]);

  await page.goto("/it/lgu-accounts");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Active Accounts", "Admin Accounts", "IT Accounts", "Staff Accounts"]);
  await expect(page.getByRole("button", { name: "Create LGU Account" })).toBeVisible();

  await page.goto("/it/enterprise-accounts");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Enterprise Accounts", "Active Enterprises", "Inactive Enterprises", "Barangays Covered"]);
  await expect(page.getByRole("button", { name: "Register Enterprise" })).toBeVisible();
});

test("keeps IT dropdown navigation local, keyboard-accessible, and reduced-motion safe", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockPortal(page, "it", "dark");
  await page.goto("/it/dashboard");

  const overview = page.getByRole("link", { name: "Overview" });
  const workCenter = page.getByRole("link", { name: "Work Center" });
  const accounts = page.getByRole("button", { name: "Accounts" });
  await expect(overview.locator("[data-topbar-active-underline='true']")).toHaveCount(1);
  const glassIndicator = page.locator("[data-topbar-glass-indicator='true']");
  await expect(glassIndicator).toHaveCount(1);
  expect(await glassIndicator.getAttribute("data-topbar-glass-target")).toBeNull();
  await expect(glassIndicator).toHaveCSS("opacity", "0");

  await workCenter.focus();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "work-center");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-motion", "reduced");
  await accounts.focus();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "accounts");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-origin", "droplet-center");
  await accounts.press("Enter");
  await expect(accounts).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: "LGU Personnel" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Enterprises", exact: true })).toBeVisible();
  const accountsReplicaChevron = page.locator("[data-topbar-refraction-copy='true']").filter({ hasText: "Accounts" }).locator("svg").last();
  await expect(accountsReplicaChevron).toHaveClass(/rotate-180/);
  await accounts.press("Enter");
  await expect(accounts).toHaveAttribute("aria-expanded", "false");
  await expect(accountsReplicaChevron).not.toHaveClass(/rotate-180/);

  await accounts.hover();
  await accounts.click();
  const lguPersonnel = page.getByRole("link", { name: "LGU Personnel" });
  await expect(lguPersonnel).toBeVisible();
  await page.evaluate(() => {
    const testWindow = window as typeof window & { __tanawGlassTargets?: (string | null)[]; __tanawGlassObserver?: MutationObserver };
    const indicator = document.querySelector("[data-topbar-glass-indicator='true']");
    testWindow.__tanawGlassTargets = [];
    testWindow.__tanawGlassObserver?.disconnect();
    if (!indicator) return;
    testWindow.__tanawGlassObserver = new MutationObserver(() => {
      testWindow.__tanawGlassTargets?.push(indicator.getAttribute("data-topbar-glass-target"));
    });
    testWindow.__tanawGlassObserver.observe(indicator, { attributes: true, attributeFilter: ["data-topbar-glass-target"] });
  });
  await lguPersonnel.hover({ position: { x: 210, y: 16 } });
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "accounts");
  await lguPersonnel.click({ position: { x: 210, y: 16 } });
  await expect(page).toHaveURL(/\/it\/lgu-accounts$/);
  const dropdownTransitions = await page.evaluate(() => {
    const testWindow = window as typeof window & { __tanawGlassTargets?: (string | null)[]; __tanawGlassObserver?: MutationObserver };
    testWindow.__tanawGlassObserver?.disconnect();
    return testWindow.__tanawGlassTargets ?? [];
  });
  expect(dropdownTransitions.every((target) => target === null || target === "accounts")).toBe(true);
  expect(await glassIndicator.getAttribute("data-topbar-glass-target")).toBeNull();
});

test("glides one neutral refractive IT glass capsule through navigation gaps", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockPortal(page, "it", "dark");
  await page.goto("/it/dashboard");

  const overview = page.getByRole("link", { name: "Overview" });
  const workCenter = page.getByRole("link", { name: "Work Center" });
  const accounts = page.getByRole("button", { name: "Accounts" });
  const system = page.getByRole("button", { name: "System" });
  const glassIndicator = page.locator("[data-topbar-glass-indicator='true']");

  await overview.hover();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge", "replicated-lens-refraction");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-thickness", "feathered-lens-band");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-distortion", "visible");
  const refractiveEdge = glassIndicator.locator("[data-topbar-glass-refraction='background-adaptive']");
  await expect(refractiveEdge).toHaveCount(1);
  const foregroundOptics = page.locator("[data-topbar-glass-optics='foreground-endcaps']");
  await expect(foregroundOptics).toHaveCount(1);
  await expect(foregroundOptics).toHaveAttribute("data-topbar-glass-edge-zone", "feathered");
  await expect(foregroundOptics.locator("[data-topbar-glass-edge-side]")).toHaveCount(0);
  await expect(glassIndicator.locator("[data-topbar-glass-lobe], [data-topbar-glass-neck]")).toHaveCount(0);
  const refractionTrack = foregroundOptics.locator("[data-topbar-refraction-track='filtered-navigation-copy']");
  await expect(refractionTrack).toHaveCSS("filter", /tanaw-topbar-lens/);
  await expect(refractionTrack).toHaveAttribute("data-topbar-lens-magnification", "1.10x1.06");
  await expect(refractionTrack.locator("[data-topbar-refraction-copy='true']")).toHaveCount(4);
  await expect(refractionTrack).toContainText("Overview");
  const opticalFilter = page.locator("filter[id^='tanaw-topbar-lens-']");
  await expect(opticalFilter.locator("feDisplacementMap")).toHaveAttribute("scale", "22");
  await expect(opticalFilter.locator("[data-topbar-glass-smear='neutral']")).toHaveAttribute("stdDeviation", "2.4 0.32");
  await expect(opticalFilter.locator("[data-topbar-glass-smear-output='true']")).toHaveAttribute("in", "neutralSmear");
  await expect(opticalFilter.locator("[data-topbar-glass-core='attenuated']")).toHaveAttribute("result", "warpedCore");
  await expect(opticalFilter.locator("[data-topbar-chromatic-channel]")).toHaveCount(2);
  await expect(foregroundOptics).toHaveCSS("backdrop-filter", /blur/);
  await expect(foregroundOptics).toHaveCSS("z-index", "20");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-response", "filtered-foreground-replica");
  await expect(glassIndicator).toHaveCSS("border-top-width", "1px");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-motion", "raf-spring");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-renderer", "motion-value-raf");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-surface", "transparent");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-chromatic", "split-fringe");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-shape", "continuous-waterdrop");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-stretch", "integrated-endcap");
  await expect(glassIndicator).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(glassIndicator).toHaveCSS("clip-path", "none");
  const neutralStops = await glassIndicator.evaluate((element) =>
    Array.from(getComputedStyle(element).backgroundImage.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g), (match) => [Number(match[1]), Number(match[2]), Number(match[3])]),
  );
  expect(neutralStops.length).toBeGreaterThanOrEqual(3);
  expect(neutralStops.every(([red, green, blue]) => red === green && green === blue)).toBe(true);
  const surfaceAlphas = await glassIndicator.evaluate((element) => Array.from(getComputedStyle(element).backgroundImage.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g), (match) => Number(match[1])));
  expect(surfaceAlphas.length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...surfaceAlphas)).toBeLessThanOrEqual(0.2);
  await page.waitForTimeout(480);

  const overviewBox = await overview.boundingBox();
  const workCenterBox = await workCenter.boundingBox();
  expect(overviewBox).not.toBeNull();
  expect(workCenterBox).not.toBeNull();
  await page.mouse.move((overviewBox!.x + overviewBox!.width + workCenterBox!.x) / 2, workCenterBox!.y + workCenterBox!.height / 2);
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-state", "gap");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "gap:dashboard:work-center");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-deformation", "1.000");
  await expect(glassIndicator).toHaveCSS("border-radius", /px$/);
  await page.waitForTimeout(220);
  const gapBox = await glassIndicator.boundingBox();
  expect(gapBox).not.toBeNull();
  const gapCenter = gapBox!.x + gapBox!.width / 2;
  const midpointBetweenItems = (overviewBox!.x + overviewBox!.width / 2 + workCenterBox!.x + workCenterBox!.width / 2) / 2;
  expect(Math.abs(gapCenter - midpointBetweenItems)).toBeLessThan(4);
  await page.mouse.down();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-state", "drag");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "drag:dashboard:work-center");
  await page.mouse.up();
  await workCenter.hover();
  await page.waitForTimeout(240);

  const glidingBox = await glassIndicator.boundingBox();
  expect(glidingBox).not.toBeNull();
  const overviewCenter = overviewBox!.x + overviewBox!.width / 2;
  const workCenterCenter = workCenterBox!.x + workCenterBox!.width / 2;
  const glidingCenter = glidingBox!.x + glidingBox!.width / 2;
  const fullUnionWidth = workCenterBox!.x + workCenterBox!.width - overviewBox!.x;
  expect(glidingCenter).toBeGreaterThan(overviewCenter);
  expect(glidingCenter).toBeLessThan(workCenterCenter);
  expect(glidingBox!.width).toBeLessThan(fullUnionWidth * 0.85);
  await expect(glassIndicator).toHaveCSS("border-radius", /px$/);

  await accounts.hover();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "accounts");
  await page.waitForTimeout(620);
  const accountsBox = await accounts.boundingBox();
  const settledBox = await glassIndicator.boundingBox();
  expect(settledBox!.x + settledBox!.width / 2).toBeCloseTo(accountsBox!.x + accountsBox!.width / 2, 0);

  const systemBox = await system.boundingBox();
  expect(systemBox).not.toBeNull();
  await page.mouse.move(overviewBox!.x + overviewBox!.width / 2, overviewBox!.y + overviewBox!.height / 2);
  await page.waitForTimeout(360);
  await page.mouse.down();
  const dragStart = overviewBox!.x + overviewBox!.width / 2;
  const dragEnd = systemBox!.x + systemBox!.width / 2;
  const dragSamples: number[] = [];
  for (let step = 1; step <= 14; step += 1) {
    await page.mouse.move(dragStart + ((dragEnd - dragStart) * step) / 14, systemBox!.y + systemBox!.height / 2);
    await page.waitForTimeout(18);
    const renderedBox = await glassIndicator.boundingBox();
    expect(renderedBox).not.toBeNull();
    dragSamples.push(renderedBox!.x + renderedBox!.width / 2);
  }
  const activeSamples = dragSamples.filter((center) => center > dragStart + 3 && center < dragEnd - 3);
  const activeCenterDeltas = activeSamples.slice(1).map((center, index) => center - activeSamples[index]);
  expect(new Set(activeSamples.map((center) => Math.round(center))).size).toBeGreaterThanOrEqual(10);
  expect(activeCenterDeltas.filter((delta) => delta > 0.15).length / activeCenterDeltas.length).toBeGreaterThan(0.72);
  expect(Math.max(...activeCenterDeltas)).toBeLessThan((dragEnd - dragStart) * 0.22);

  await page.mouse.move(systemBox!.x + systemBox!.width + 38, systemBox!.y + systemBox!.height / 2, { steps: 6 });
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-state", "pull");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "pull:system:right");
  const pullAmount = Number(await glassIndicator.getAttribute("data-topbar-glass-pull"));
  expect(pullAmount).toBeGreaterThan(0.4);
  await page.waitForTimeout(120);
  const pulledBox = await glassIndicator.boundingBox();
  expect(pulledBox).not.toBeNull();
  expect(pulledBox!.width).toBeGreaterThan(systemBox!.width + 24);
  expect(pulledBox!.width).toBeLessThan(systemBox!.width + 38);
  expect(Math.abs(pulledBox!.x - (systemBox!.x - 4))).toBeLessThan(2.5);
  expect(pulledBox!.x + pulledBox!.width - (systemBox!.x + systemBox!.width)).toBeGreaterThan(18);
  const pulledOpticsBox = await foregroundOptics.boundingBox();
  expect(pulledOpticsBox).not.toBeNull();
  expect(Math.abs(pulledOpticsBox!.width - pulledBox!.width)).toBeLessThan(1.5);
  const pulledRadii = await page.evaluate(() => {
    const material = document.querySelector("[data-topbar-glass-indicator='true']");
    const optics = document.querySelector("[data-topbar-glass-optics='foreground-endcaps']");
    return { material: material ? getComputedStyle(material).borderRadius : null, optics: optics ? getComputedStyle(optics).borderRadius : null };
  });
  expect(pulledRadii.optics).toBe(pulledRadii.material);
  await page.mouse.move(systemBox!.x + systemBox!.width + 82, systemBox!.y + systemBox!.height / 2, { steps: 5 });
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-state", "recoil");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "recoil:system:right");
  await page.waitForTimeout(260);
  const recoiledRightBox = await glassIndicator.boundingBox();
  expect(recoiledRightBox!.width).toBeCloseTo(systemBox!.width + 8, 0);
  await page.mouse.up();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "system");
  await page.waitForTimeout(260);
  const releasedBox = await glassIndicator.boundingBox();
  expect(releasedBox!.width).toBeCloseTo(systemBox!.width + 8, 0);

  await system.blur();
  await overview.hover();
  await page.waitForTimeout(360);
  const overviewGlassBox = await glassIndicator.boundingBox();
  await page.mouse.down();
  await page.mouse.move(overviewBox!.x - 38, overviewBox!.y + overviewBox!.height / 2, { steps: 6 });
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-state", "pull");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "pull:dashboard:left");
  expect(Number(await glassIndicator.getAttribute("data-topbar-glass-pull"))).toBeLessThan(-0.4);
  await page.waitForTimeout(120);
  const pulledLeftBox = await glassIndicator.boundingBox();
  expect(pulledLeftBox!.width).toBeGreaterThan(overviewGlassBox!.width + 16);
  expect(Math.abs(pulledLeftBox!.x + pulledLeftBox!.width - (overviewGlassBox!.x + overviewGlassBox!.width))).toBeLessThan(2.5);
  expect(overviewBox!.x - pulledLeftBox!.x).toBeGreaterThan(18);
  await page.mouse.move(overviewBox!.x - 82, overviewBox!.y + overviewBox!.height / 2, { steps: 5 });
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-state", "recoil");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "recoil:dashboard:left");
  await page.waitForTimeout(260);
  const recoiledLeftBox = await glassIndicator.boundingBox();
  expect(recoiledLeftBox!.width).toBeCloseTo(overviewBox!.width + 8, 0);
  await page.mouse.up();
});

test("keeps Staff Reporting Period as a real control beside unified metrics", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockPortal(page, "staff", "light");
  await page.route("**/operational/reports/enterprises", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "archie", name: "Archie's Event Place", category: "Events Place", barangay: "Landayan", complianceOwner: "Archie" },
        { id: "balon", name: "Balon ni Lolo Uweng", category: "Attraction", barangay: "Landayan", complianceOwner: "Balon" },
        { id: "golf", name: "Hallow Ridge Filipinas Golf Inc.", category: "Attraction", barangay: "Nueva", complianceOwner: "Hallow" },
      ]),
    }),
  );
  await page.route("**/operational/reports/intake", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "report-archie",
          enterpriseId: "archie",
          enterprise: "Archie's Event Place",
          category: "Events Place",
          barangay: "Landayan",
          month: "August",
          period: "August 2026",
          submitted: "2026-08-05T08:00:00Z",
          submittedAt: "2026-08-05T08:00:00Z",
          status: "Consolidated",
          code: "REP-ARCHIE",
          metrics: { entry: 680, exit: 620, unique: 455, peak: "11:00 AM" },
        },
        {
          id: "report-golf",
          enterpriseId: "golf",
          enterprise: "Hallow Ridge Filipinas Golf Inc.",
          category: "Attraction",
          barangay: "Nueva",
          month: "August",
          period: "August 2026",
          submitted: "2026-08-07T08:00:00Z",
          submittedAt: "2026-08-07T08:00:00Z",
          status: "Ready to Consolidate",
          code: "REP-GOLF",
          metrics: { entry: 990, exit: 900, unique: 690, peak: "2:00 PM" },
        },
      ]),
    }),
  );

  await page.goto("/staff/analytics");
  const analyticsHeader = page.locator("[data-unified-metrics-header]");
  await expectUnifiedHeader(analyticsHeader, ["Total Aggregated Entries", "Est. Unique People", "Reports Compliance"], 3);
  const reportingPeriod = page.getByRole("combobox", { name: "Reporting period" });
  await expect(reportingPeriod).toBeVisible();
  await reportingPeriod.focus();
  await expect(analyticsHeader.locator(".tanaw-unified-metrics__segment").last().locator(".tanaw-unified-metrics__hover")).toHaveCSS("opacity", "1");
  await expect(page.getByText("Enterprise Traffic Comparison", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Horizontal grouped bar chart comparing Total Entries and Unique Pax by enterprise" })).toBeVisible();
  await expect(page.getByText("Compare Total Entries and Unique Pax for every registered enterprise.")).toBeVisible();
  await expect(page.locator(".tanaw-traffic-card .recharts-bar")).toHaveCount(2);
  await expect(page.locator(".tanaw-traffic-card .recharts-scatter")).toHaveCount(0);
  const comparisonTable = page.getByRole("table", { name: "Enterprise Traffic Comparison data" });
  await expect(comparisonTable.getByRole("row", { name: "Archie's Event Place 680 455" })).toHaveCount(1);
  await expect(comparisonTable.getByRole("row", { name: "Balon ni Lolo Uweng 0 0" })).toHaveCount(1);
  await expect(page.getByText("Enterprise Traffic Comparison data", { exact: true })).not.toBeVisible();
  await expect(page.getByText("1 of 2 reports complete", { exact: true })).toBeVisible();
  await expect(page.getByText("1 of 1 reports complete", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Landayan report completion" })).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByRole("progressbar", { name: "Nueva report completion" })).toHaveAttribute("aria-valuenow", "100");

  await page.setViewportSize({ width: 1100, height: 820 });
  const trafficBox = await page.locator(".tanaw-traffic-card").boundingBox();
  const complianceBox = await page.locator(".tanaw-compliance-panel").boundingBox();
  expect(trafficBox).not.toBeNull();
  expect(complianceBox).not.toBeNull();
  expect(complianceBox!.y).toBeGreaterThan(trafficBox!.y + trafficBox!.height - 2);

  await page.goto("/staff/batch-reports");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Registered Enterprises", "Ready Reports", "Missing Submissions", "Archived Reports"]);
  await expect(page.getByRole("button", { name: "Generate Final Report" })).toBeVisible();
});
