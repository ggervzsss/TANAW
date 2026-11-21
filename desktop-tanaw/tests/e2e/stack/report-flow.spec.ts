/**
 * Disposable-stack scenario: a report produced by the real ML service travels through the desktop
 * app's own cloud sync into PostgreSQL, and LGU Staff consolidate it in the web portal.
 *
 * Run it with `node scripts/e2e-stack/run.mjs` from the repository root, which provisions the
 * database, backend, ML service and both previews with synthetic accounts and exports the
 * TANAW_STACK_* variables this test reads. Nothing is mocked except the Electron IPC bridge, which
 * forwards each renderer request to the real ML service exactly as the preload would.
 */
import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "../browser/support/preload";

const required = [
  "TANAW_STACK_API_URL",
  "TANAW_STACK_DESKTOP_URL",
  "TANAW_STACK_PORTAL_URL",
  "TANAW_STACK_ML_URL",
  "TANAW_STACK_ML_TOKEN",
  "TANAW_STACK_PASSWORD",
  "TANAW_STACK_ENTERPRISE_EMAIL",
  "TANAW_STACK_ENTERPRISE_ID",
  "TANAW_STACK_ENTERPRISE_NAME",
  "TANAW_STACK_STAFF_EMAIL",
  "TANAW_STACK_PERIOD",
] as const;
type StackEnv = Record<(typeof required)[number], string>;

function stackEnv(): StackEnv {
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`The disposable stack is not configured (missing ${missing.join(", ")}). Run node scripts/e2e-stack/run.mjs from the repository root.`);
  }
  return Object.fromEntries(required.map((name) => [name, process.env[name]!])) as StackEnv;
}

const demographics = { thisProvMale: "1", thisProvFemale: "1", otherProvMale: "0", otherProvFemale: "0", foreignMale: "0", foreignFemale: "0" };

test("an ML-service report syncs from the desktop app and Staff consolidate it in the portal", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const env = stackEnv();
  const reportId = `STACK-${Date.now()}`;
  const [month, year] = env.TANAW_STACK_PERIOD.split(" ");

  const ml = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${env.TANAW_STACK_ML_URL}${path}`, {
      method,
      headers: { "X-TANAW-ML-Token": env.TANAW_STACK_ML_TOKEN, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    expect(response.ok, `ML service ${method} ${path} returned ${response.status}: ${text}`).toBe(true);
    return JSON.parse(text) as T;
  };
  const api = async <T>(token: string, path: string): Promise<T> => {
    const response = await fetch(`${env.TANAW_STACK_API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok, `Backend GET ${path} returned ${response.status}`).toBe(true);
    return (await response.json()) as T;
  };
  const login = async (username: string, loginScope: "web" | "enterprise") => {
    const response = await fetch(`${env.TANAW_STACK_API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: env.TANAW_STACK_PASSWORD, loginScope }),
    });
    expect(response.status, `${username} could not sign in to the stack backend`).toBe(200);
    return ((await response.json()) as { token: string }).token;
  };

  // 1. Desktop app: sign in. The renderer binds the real ML service to this enterprise.
  const desktopContext = await browser.newContext({ baseURL: env.TANAW_STACK_DESKTOP_URL });
  const desktop = await desktopContext.newPage();
  let boundEnterprise: string | null = null;
  await mockMlRequest(desktop, "*", async (request) => {
    const target = new URL(request.url);
    const response = await fetch(`${env.TANAW_STACK_ML_URL}${target.pathname}${target.search}`, {
      method: request.method,
      headers: { "X-TANAW-ML-Token": env.TANAW_STACK_ML_TOKEN, "Content-Type": "application/json" },
      body: request.body,
    });
    const body = await response.text();
    if (target.pathname === "/context/enterprise" && response.ok) boundEnterprise = (JSON.parse(body) as { enterprise_id: string }).enterprise_id;
    return mlResponse({ status: response.status, body });
  });
  await desktop.goto("/#/login");
  await desktop.getByPlaceholder("Enter username or registered email").fill(env.TANAW_STACK_ENTERPRISE_EMAIL);
  await desktop.getByPlaceholder("Enter your password").fill(env.TANAW_STACK_PASSWORD);
  await desktop.getByRole("button", { name: "Sign in" }).click();
  await expect(desktop).toHaveURL(/#\/enterprise\/dashboard$/, { timeout: 30_000 });
  await expect.poll(() => boundEnterprise, { message: "the desktop app should bind the ML service to its enterprise", timeout: 30_000 }).toBe(env.TANAW_STACK_ENTERPRISE_ID);

  // 2. ML service: record counts and save the report on the device, as the Reports workspace does.
  await ml("POST", "/sample/prepare", {
    report_id: reportId,
    enterprise_id: env.TANAW_STACK_ENTERPRISE_ID,
    enterprise_name: env.TANAW_STACK_ENTERPRISE_NAME,
    entries: 3,
    exits: 1,
    unique_count: 2,
    period: env.TANAW_STACK_PERIOD,
  });
  const saved = await ml<{ submission_id: string; sync_status: string; payload: { counting?: { snapshot_version?: string } } }>("POST", "/reports/local-submit", {
    report_id: reportId,
    period: env.TANAW_STACK_PERIOD,
    notes: "SYNTHETIC DISPOSABLE-STACK SCENARIO. Test counts, not tourism measurements.",
    payload: { status: "Submitted", demo: demographics },
  });
  expect(saved.sync_status).toBe("pending_cloud_sync");
  expect(saved.payload.counting?.snapshot_version).toMatch(/^[a-f0-9]{64}$/);

  // 3. Desktop sync: the renderer's own upload sends it to the backend and marks it synced locally.
  await desktop.evaluate(() => window.dispatchEvent(new Event("tanaw:desktop-report-submitted")));
  await expect
    .poll(async () => (await ml<Array<{ report_id: string; sync_status: string }>>("GET", "/reports/local")).find((record) => record.report_id === reportId)?.sync_status, {
      message: "the desktop app should upload the report and mark it synced",
      timeout: 60_000,
    })
    .toBe("synced");

  // 4. PostgreSQL: the backend holds exactly one intake report with the device's counts.
  const staffToken = await login(env.TANAW_STACK_STAFF_EMAIL, "web");
  type Intake = { id: string; code: string; status: string; period: string; metrics: { entry: number; exit: number; unique: number } };
  const intake = (await api<Intake[]>(staffToken, "/operational/reports/intake")).filter((report) => report.code === reportId);
  expect(intake).toHaveLength(1);
  expect(intake[0].metrics).toMatchObject({ entry: 3, exit: 1, unique: 2 });
  await desktopContext.close();

  // 5. Staff portal: review, accept, generate and finalize the monthly report.
  const portalContext = await browser.newContext({ baseURL: env.TANAW_STACK_PORTAL_URL, viewport: { width: 1440, height: 1000 } });
  const portal = await portalContext.newPage();
  await portal.emulateMedia({ reducedMotion: "reduce" });
  await portal.goto("/login");
  await portal.getByLabel("Email", { exact: true }).fill(env.TANAW_STACK_STAFF_EMAIL);
  await portal.getByLabel("Password", { exact: true }).fill(env.TANAW_STACK_PASSWORD);
  await portal.getByRole("button", { name: "Sign in" }).click();
  await expect(portal).toHaveURL(/\/staff\//, { timeout: 30_000 });
  await consolidate(portal, env.TANAW_STACK_ENTERPRISE_NAME, month, year);
  await portal.screenshot({ path: testInfo.outputPath("stack-consolidated.png"), fullPage: true });

  type Final = { id: string; period: string; status: string };
  const finals = (await api<Final[]>(staffToken, "/operational/reports/final")).filter((report) => report.period === env.TANAW_STACK_PERIOD);
  expect(finals).toHaveLength(1);
  const after = (await api<Intake[]>(staffToken, "/operational/reports/intake")).find((report) => report.code === reportId);
  expect(after?.status).toBe("Consolidated");
  await portalContext.close();
});

async function consolidate(page: Page, establishment: string, month: string, year: string) {
  await page.goto(`/staff/batch-reports?month=${month}&year=${year}`);
  const generation = page.getByRole("region", { name: "Monthly report", exact: true });
  const generate = generation.getByRole("button", { name: "Generate monthly report", exact: true });
  await expect(generate).toBeDisabled();

  await page.getByRole("region", { name: "Pending review" }).getByRole("button", { name: `Review report for ${establishment}`, exact: true }).click();
  const intakeDialog = page.getByRole("dialog", { name: "Establishment report", exact: true });
  const table = intakeDialog.getByRole("table", { name: `${establishment} VAR 2M` });
  await expect(table.getByRole("cell", { name: "411", exact: true })).toBeVisible();
  await expect(table.locator("tfoot td").last()).toHaveText("2");
  await intakeDialog.getByRole("textbox", { name: /review remarks/i }).fill("Disposable-stack scenario review.");
  await intakeDialog.getByRole("button", { name: "Accept & mark ready" }).click();
  await page.getByRole("dialog", { name: "Accept report?" }).getByRole("button", { name: "Accept report", exact: true }).click();

  await expect(generate).toBeEnabled({ timeout: 15_000 });
  await generate.click();
  await page.getByRole("dialog", { name: "Generate monthly report?" }).getByRole("button", { name: "Generate monthly report", exact: true }).click();
  const monthly = page.getByRole("dialog", { name: "Monthly report (VAR 2M)" });
  const monthlyTable = monthly.getByRole("table", { name: `VAR 2M ${month} ${year}` });
  await expect(monthlyTable.getByRole("rowheader", { name: establishment })).toBeVisible();
  await expect(monthlyTable.locator("tfoot td").last()).toHaveText("2");
  await monthly.getByRole("button", { name: "Finalize monthly report" }).click();
  await expect(monthly.getByRole("button", { name: "Finalize monthly report" })).toHaveCount(0);
}
