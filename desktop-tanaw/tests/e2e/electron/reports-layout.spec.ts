import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeMlSidecar } from "./support/fake-ml-sidecar";

test("renders the Figma Create Reports arrangement in the actual desktop renderer", async ({ playwright }, testInfo) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(path.join(tmpdir(), "tanaw-reports-ui-"));
  const fixture = JSON.parse(await readFile(new URL("../../../..//test-fixtures/mixed-establishment-report.json", import.meta.url), "utf8"));
  const makeCounting = (period: string, unique = 617) => {
    const date = new Date(`${period} 1 00:00:00 GMT+0800`);
    const year = date.getUTCFullYear();
    const month = Number(new Intl.DateTimeFormat("en", { month: "numeric", timeZone: "Asia/Manila" }).format(date));
    const key = `${year}-${String(month).padStart(2, "0")}`;
    return {
      ...fixture.counting,
      enterprise_id: "enterprise-1",
      from_at: new Date(Date.UTC(year, month - 1, 1) - 8 * 3600000).toISOString(),
      to_at: new Date(Date.UTC(year, month, 1) - 8 * 3600000).toISOString(),
      unique_count: unique,
      confirmed_unique_count: unique,
      qualified_observations: unique,
      days: fixture.counting.days.map((day: Record<string, unknown>, index: number) => ({
        ...day,
        business_date: `${key}-${String(index + 1).padStart(2, "0")}`,
        unique_count: index === 0 ? unique : 0,
        // TANAW's male/female estimate splits the day's unique visitors.
        male_count: index === 0 ? Math.floor(unique / 2) - 8 : 0,
        female_count: index === 0 ? unique - Math.floor(unique / 2) + 8 : 0,
        confirmed_unique_count: index === 0 ? unique : 0,
        qualified_observations: index === 0 ? unique : 0,
      })),
    };
  };
  const records = ["September 2026", "August 2026", "July 2026"].map((period, index) => ({
    ...fixture,
    report_id: `E2E-SAVED-${index}`,
    period,
    submitted_at: `2026-${String(10 - index).padStart(2, "0")}-02T02:00:00Z`,
    sync_status: "synced",
    payload: { ...fixture.payload, counting: makeCounting(period, 2), status: index === 0 ? "Submitted" : "Consolidated" },
    counting: makeCounting(period, 2),
  }));
  const originalRecords = JSON.stringify(records);
  const submissions: Array<Record<string, unknown>> = [];
  const uploads: Array<Record<string, unknown>> = [];
  const drafts = new Map<string, unknown>();
  const sidecar = new FakeMlSidecar();
  sidecar.respond = async (request) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/metrics/establishment/summary") return { status: 200, body: makeCounting(url.searchParams.get("period") ?? "November 2026") };
    if (url.pathname === "/metrics/establishment/periods")
      return {
        status: 200,
        body: [
          { period: "October 2026", metrics: { entries: fixture.entries, exits: fixture.exits, peak_occupancy: fixture.peak_occupancy, unique_count: 617 }, counting: makeCounting("October 2026") },
        ],
      };
    const readBody = async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    };
    if (url.pathname.startsWith("/reports/drafts/")) {
      if (request.method === "GET") return { status: 200, body: drafts.get(url.pathname) ?? null };
      if (request.method === "DELETE") {
        drafts.delete(url.pathname);
        return { status: 200, body: { updated: 1 } };
      }
      const body = await readBody();
      drafts.set(url.pathname, body);
      return { status: 200, body };
    }
    if (url.pathname === "/reports/local") return { status: 200, body: records };
    if (url.pathname === "/reports/local-submit") {
      const body = await readBody();
      submissions.push(body);
      const frozen = makeCounting(body.period);
      const demo = Object.fromEntries(
        ["thisProvMale", "thisProvFemale", "thisProvUnspecified", "otherProvMale", "otherProvFemale", "foreignMale", "foreignFemale"].map((key) => [key, body.payload.demo[key] || "0"]),
      );
      const record = {
        ...fixture,
        report_id: body.report_id,
        submission_id: body.request_id,
        period: body.period,
        unique_count: 617,
        submitted_at: "2026-11-14T02:00:00Z",
        sync_status: "pending_cloud_sync",
        counting: frozen,
        payload: { ...body.payload, demo, counting: frozen, metrics: { entries: fixture.entries, exits: fixture.exits, peak: fixture.peak_occupancy, unique: 617 } },
      };
      records.push(record);
      return { status: 200, body: record };
    }
    if (url.pathname.endsWith("/synced")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-2)!);
      const record = records.find((item) => item.report_id === id);
      if (record) record.sync_status = "synced";
      return { status: 200, body: { updated: 1 } };
    }
    return undefined;
  };
  await sidecar.start();
  let application: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE"));
    Object.assign(env, { APPDATA: directory, LOCALAPPDATA: directory, TANAW_ML_SERVICE_PORT: String(sidecar.port) });
    application = await playwright._electron.launch({ args: [".", `--user-data-dir=${path.join(directory, "profile")}`], env });
    const user = {
      id: "reports-ui-operator",
      name: "Reports UI Operator",
      email: "reports@example.test",
      role: "enterprise",
      enterpriseId: "enterprise-1",
      enterpriseName: "Tourism UI Preview",
      category: "Cultural Tourism",
    };
    await application.context().route("http://localhost:8000/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/operational/desktop/report-submissions") {
        uploads.push(route.request().postDataJSON());
        return route.fulfill({ status: 202, json: {} });
      }
      const body =
        pathname === "/auth/login" || pathname === "/auth/session"
          ? { token: "reports-ui-test-session", user }
          : pathname === "/auth/me"
            ? user
            : pathname === "/auth/system-settings"
              ? { values: { "display.timeFormat": "12-hour" } }
              : [];
      return route.fulfill({ json: body });
    });
    await application.context().routeWebSocket("**/realtime/ws", (socket) =>
      socket.onMessage((message) => {
        if (typeof message === "string" && JSON.parse(message).type === "auth") socket.send(JSON.stringify({ type: "realtime.ready", heartbeat_seconds: 120 }));
      }),
    );
    await expect.poll(() => application!.windows().some((page) => page.url().startsWith("tanaw-app://desktop"))).toBe(true);
    const page = application.windows().find((candidate) => candidate.url().startsWith("tanaw-app://desktop"))!;
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.clock.install({ time: new Date("2026-11-14T02:00:00Z") });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("tanaw-app://desktop/index.html#/login");
    await page.getByPlaceholder("Enter username or registered email").fill(user.email);
    await page.getByPlaceholder("Enter your password").fill("Reports test session password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().startsWith("tanaw-app://desktop"));
      window?.show();
    });
    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Monthly DOT Visitor Report" })).toBeVisible();
    await expect(page.getByText("Report Workspace", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Create Reports" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("status", { name: "System unique visitor count" })).toHaveText("617");
    // TANAW fills This City for the day; it is not editable.
    await expect(page.getByLabel("This City Total", { exact: true })).toHaveText("617");
    await expect(page.getByLabel("This City Male", { exact: true })).toHaveText("300");
    await expect(page.getByLabel("This City Female", { exact: true })).toHaveText("317");
    await expect(page.getByRole("textbox", { name: "This City Male", exact: true })).toHaveCount(0);
    await expect(page.locator(".report-origin-table tfoot")).toContainText("617");
    await page.getByRole("button", { name: "All from This City", exact: true }).click();
    await expect(page.getByText("Visitor origins confirmed for this day.", { exact: true })).toBeVisible();
    await expect(page.locator(".report-information")).toHaveCSS("display", "grid");
    const visitor = (await page.locator(".report-visitor-card").boundingBox())!;
    const steps = (await page.locator(".report-next-steps").boundingBox())!;
    expect(steps.x).toBeGreaterThan(visitor.x + visitor.width);
    expect(Math.abs(visitor.y - steps.y)).toBeLessThan(1);
    const mainCard = (await page.locator(".report-create-card").boundingBox())!;
    const createTab = (await page.getByRole("tab", { name: "Create Reports" }).boundingBox())!;
    expect(Math.abs(mainCard.x - 46)).toBeLessThanOrEqual(3);
    // Positions follow the design-system type scale (31px page title, 16.5px subtitle).
    expect(Math.abs(mainCard.y - 261)).toBeLessThanOrEqual(3);
    expect(createTab.width).toBe(216);
    expect(createTab.height).toBe(50);
    expect(Math.abs(visitor.x - 67)).toBeLessThanOrEqual(3);
    expect(Math.abs(visitor.y - 499)).toBeLessThanOrEqual(3);
    await page.keyboard.press("Escape");
    await page.locator(".reports-heading h1").click();
    await page.screenshot({ path: testInfo.outputPath("reports-create-1440.png") });
    await page.getByRole("button", { name: "Review Report Form", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Review Report Form", exact: true });
    await expect(preview).toBeVisible();
    const canvas = preview.getByLabel("Scrollable VAR 1 report preview");
    await expect(preview.locator(".var1-official-table tbody tr")).toHaveCount(30);
    const initialZoom = Number(await canvas.getAttribute("data-report-zoom"));
    await preview.getByRole("button", { name: "Zoom In", exact: true }).click();
    await expect.poll(async () => Number(await canvas.getAttribute("data-report-zoom"))).toBeGreaterThan(initialZoom);
    await preview.getByRole("button", { name: "Zoom Out", exact: true }).click();
    await expect.poll(async () => Number(await canvas.getAttribute("data-report-zoom"))).toBeCloseTo(initialZoom, 1);
    await page.screenshot({ path: testInfo.outputPath("reports-review-1440.png") });
    await preview.getByRole("button", { name: "Fit to Page", exact: true }).click();
    await expect.poll(async () => Number(await canvas.getAttribute("data-report-zoom"))).toBeLessThan(initialZoom);
    const exportPath = testInfo.outputPath("official-var1.pdf");
    await application.evaluate(({ BrowserWindow }, savePath) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().startsWith("tanaw-app://desktop"));
      window!.webContents.session.once("will-download", (_event, item) => item.setSavePath(savePath));
    }, exportPath);
    await preview.getByRole("button", { name: "Download PDF", exact: true }).click();
    await expect.poll(async () => (await stat(exportPath).catch(() => null))?.size ?? 0).toBeGreaterThan(1000);
    expect((await readFile(exportPath, "utf8")).startsWith("%PDF-1.4")).toBe(true);
    await page.evaluate(() => {
      window.print = () => {
        Object.assign(window, { __var1PrintRequested: true });
      };
    });
    await preview.getByRole("button", { name: "Print", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { __var1PrintRequested?: boolean }).__var1PrintRequested)).toBe(true);
    const printed = await application.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().startsWith("tanaw-app://desktop"));
      return (await window!.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })).toString("base64");
    });
    await writeFile(testInfo.outputPath("native-print-var1.pdf"), Buffer.from(printed, "base64"));
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    await expect(page.getByRole("button", { name: "Review Report Form", exact: true })).toBeFocused();
    await page.getByRole("tab", { name: "Reports History" }).click();
    await expect(page.getByRole("heading", { name: "Report History", exact: true })).toBeVisible();
    const historyRows = page.locator(".report-history-table-scroll tbody tr");
    await expect(historyRows).toHaveCount(5);
    for (const row of await historyRows.all()) expect((await row.boundingBox())!.height).toBeLessThanOrEqual(65);
    await page.screenshot({ path: testInfo.outputPath("reports-history-1440.png") });
    await page.getByRole("combobox", { name: "Filter reports by status", exact: true }).click();
    await page.getByRole("option", { name: "Consolidated", exact: true }).click();
    await expect(historyRows).toHaveCount(2);
    await page.getByRole("combobox", { name: "Filter reports by status", exact: true }).click();
    await page.getByRole("option", { name: "All Statuses", exact: true }).click();
    await page.getByRole("combobox", { name: "Filter reports by reporting period", exact: true }).click();
    await page.getByRole("option", { name: "October 2026", exact: true }).click();
    await expect(historyRows).toHaveCount(1);
    await page.locator(".report-history-table-scroll tbody tr").filter({ hasText: "October 2026" }).click();
    await expect(preview).toBeVisible();
    await expect(preview.locator(".var1-document-information dd").first()).toHaveText("October 2026");
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Create Reports", exact: true }).click();
    await expect(page.getByRole("status", { name: "System unique visitor count" })).toHaveText("617");
    await expect(page.getByRole("button", { name: /Selected day: October 1, 2026/ })).toBeVisible();
    await page.getByRole("textbox", { name: "Other City Male", exact: true }).fill("5");
    await expect(page.getByLabel("This City Total", { exact: true })).toHaveText("612");
    await expect(page.getByLabel("This City Male", { exact: true })).toHaveText("295");
    await expect(page.locator(".report-origin-table tfoot td").last()).toHaveText("617");
    await page.getByRole("button", { name: "Review Report Form", exact: true }).click();
    await expect(page.locator(".var1-official-table tbody tr")).toHaveCount(31);
    await page.getByRole("button", { name: "Close preview", exact: true }).click();
    const reviewBeforeSubmission = (await page.getByRole("button", { name: "Review Report Form", exact: true }).boundingBox())!;
    await page.getByRole("button", { name: "Submit Report", exact: true }).click();
    await page.getByRole("button", { name: "Yes, Submit", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(1);
    await expect.poll(() => uploads.some((item) => item.reportId === submissions[0].report_id)).toBe(true);
    await expect(page.locator(".tanaw-toast--success").getByRole("status").filter({ hasText: "Report submitted successfully" })).toContainText(`Reference ${submissions[0].report_id}.`);
    expect(submissions[0].payload).toMatchObject({
      demo: { thisProvMale: "300", thisProvFemale: "317", thisProvUnspecified: "0" },
      var1: { thisCityMale: "295", thisCityFemale: "317", thisCityUnspecified: "0" },
      origins: { "2026-10-01": { otherCity: { male: 5, female: 0 } } },
    });
    await expect(page.getByRole("textbox", { name: "Other City Male", exact: true })).toHaveValue("5");
    await expect(page.getByRole("textbox", { name: "Other City Male", exact: true })).toBeDisabled();
    const submittedInformation = page.locator(".report-workflow-status");
    await expect(submittedInformation).toContainText(String(submissions[0].report_id));
    const reviewAfterSubmission = (await page.getByRole("button", { name: "Review Report Form", exact: true }).boundingBox())!;
    expect(reviewAfterSubmission).toEqual(reviewBeforeSubmission);
    expect((await submittedInformation.boundingBox())!.y).toBeGreaterThanOrEqual(reviewAfterSubmission.y + reviewAfterSubmission.height + 14);
    expect(JSON.stringify(records.slice(0, 3))).toBe(originalRecords);
  } finally {
    if (application) await application.close();
    await sidecar.stop();
    await cleanTemporaryProfile(directory);
  }
});

async function cleanTemporaryProfile(directory: string) {
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== path.resolve(tmpdir()) || !path.basename(resolvedDirectory).startsWith("tanaw-reports-ui-"))
    throw new Error("Refusing to clean an unexpected test directory");
  await rm(resolvedDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
