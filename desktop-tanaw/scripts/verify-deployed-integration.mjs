import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline";
import { _electron as electron } from "@playwright/test";

const executablePath = path.resolve(process.argv[2] ?? "");
const verifyExisting = process.argv.includes("--verify-existing");
if (!process.argv[2]) throw new Error("Provide the actual installed executable path.");
const api = "https://tanaw-api-yked.onrender.com";
const outputDirectory = path.resolve("release", "installed-verification");
const profile = path.join(outputDirectory, "Isolated Cloud Test Profile");
await mkdir(outputDirectory, { recursive: true });
// Credentials enter through a non-echoing pipe, never arguments, files, traces,
// screenshots, or logs. Supply one JSON line containing username and password.
console.log("Waiting for designated enterprise credentials on stdin (not logged).");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const input = createInterface({ input: process.stdin, terminal: false });
const [line] = await once(input, "line");
input.close();
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();
let credentials;
try {
  credentials = JSON.parse(line);
} catch {
  throw new Error("Credential input must be a valid JSON line.");
}
const result = { executablePath, startedAt: new Date().toISOString(), syntheticReportAuthorized: !verifyExisting };
const telemetryStatuses = [];
let realtimeReady = 0;
let active;
try {
  active = await launch();
  await signIn(active.page);
  const session = await active.page.evaluate(async () => {
    const value = await window.tanawAuthSession.load();
    return { role: value?.user.role, enterpriseId: value?.user.enterpriseId };
  });
  assert.equal(session.role, "enterprise", "Cloud writes require an enterprise test account.");
  assert.ok(session.enterpriseId);
  result.enterpriseSignIn = true;
  console.log("Designated enterprise sign-in succeeded.");
  await until(() => telemetryStatuses.some((status) => status >= 200 && status < 300), 45_000);
  await until(() => realtimeReady > 0, 30_000);
  result.normalTelemetryAccepted = true;
  result.authenticatedRealtimeReady = true;
  console.log("Deployed telemetry and authenticated real-time connection passed.");

  if (verifyExisting) {
    const previous = JSON.parse(await readFile(path.join(outputDirectory, "deployed-integration.json"), "utf8"));
    const history = await cloud(active.page, "/operational/reports/intake");
    const matches = history.filter((report) => report.code === previous.reportId);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, previous.cloudReportId);
    const localReport = (await local(active.page, "/reports/local")).find((report) => report.report_id === previous.reportId);
    assert.equal(localReport?.submission_id, previous.pendingSubmissionId);
    assert.equal(localReport?.sync_status, "synced");
    const installedAsar = path.join(path.dirname(executablePath), "resources", "app.asar");
    const packagedAsar = path.resolve("release", "0.1.0", "win-unpacked", "resources", "app.asar");
    const digest = (data) => createHash("sha256").update(data).digest("hex");
    result.installedAsarSha256 = digest(await readFile(installedAsar));
    assert.equal(result.installedAsarSha256, digest(await readFile(packagedAsar)));
    result.installerSha256 = JSON.parse(await readFile(path.resolve("release", "0.1.0", "offline", "installer-manifest.json"), "utf8")).sha256;
    await active.page.goto("tanaw-app://desktop/index.html#/enterprise/reports");
    await active.page.getByText(previous.reportId, { exact: true }).first().waitFor({ timeout: 30_000 });
    result.reportId = previous.reportId;
    result.cloudReportId = previous.cloudReportId;
    result.existingReportStillSingleAndSynced = true;
    result.visibleInInstalledReportHistory = true;
  } else {
    const existing = await cloud(active.page, "/operational/reports/intake");
    const usedPeriods = new Set(existing.map((report) => report.period));
    const now = new Date();
    let period;
    for (let offset = 1; offset <= 36; offset++) {
      const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      const formatted = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(candidate);
      if (!usedPeriods.has(formatted)) {
        period = formatted;
        break;
      }
    }
    assert.ok(period, "No unused reporting period was found; existing reports will not be overwritten.");
    const reportId = `TEST-INSTALLER-${Date.now()}`;
    const notes = "SYNTHETIC INSTALLER VERIFICATION. These are test counts, not real tourism measurements.";
    result.reportId = reportId;
    result.period = period;
    let cloudReportId;
    let ackLost = false;
    let firstAttempt = true;
    let routeError;
    const matcher = `${api}/operational/desktop/report-submissions`;
    await active.app.context().route(matcher, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (firstAttempt) {
        firstAttempt = false;
        try {
          const response = await route.fetch({ timeout: 45_000 });
          assert.equal(response.status(), 202, `The deployed report endpoint returned HTTP ${response.status()}.`);
          cloudReportId = (await response.json()).id;
          // The real backend commits the record, but the renderer loses the ACK.
          // Keep later attempts disconnected until the app has been restarted.
          await route.abort("failed");
          ackLost = true;
        } catch (error) {
          routeError = error;
          await route.abort("failed").catch(() => undefined);
        }
      } else await route.abort("internetdisconnected");
    });
    await local(active.page, "/sample/prepare", "POST", {
      report_id: reportId,
      enterprise_id: session.enterpriseId,
      entries: 3,
      exits: 1,
      unique_count: 2,
      peak_occupancy: 2,
      period,
    });
    await local(active.page, "/reports/local-submit", "POST", {
      report_id: reportId,
      period,
      notes,
      payload: { status: "Submitted", demo: { thisProvMale: 1, thisProvFemale: 1, otherProvMale: 0, otherProvFemale: 0, foreignMale: 0, foreignFemale: 0 } },
    });
    await active.page.evaluate(() => window.dispatchEvent(new Event("tanaw:desktop-report-submitted")));
    await until(() => {
      if (routeError) throw routeError;
      return ackLost;
    }, 60_000);
    const pending = (await local(active.page, "/reports/local")).find((report) => report.report_id === reportId);
    assert.ok(pending);
    assert.notEqual(pending.sync_status, "synced");
    result.pendingSubmissionId = pending.submission_id;
    result.realBackendAcceptedBeforeSimulatedAckLoss = true;
    await close(active.app);
    active = undefined;

    active = await launch();
    await signIn(active.page);
    let synced;
    await until(async () => {
      const report = (await local(active.page, "/reports/local")).find((record) => record.report_id === reportId);
      if (report?.sync_status === "synced") {
        synced = report;
        return true;
      }
      return false;
    }, 90_000);
    assert.equal(synced.submission_id, pending.submission_id);
    const history = await cloud(active.page, "/operational/reports/intake");
    const matches = history.filter((report) => report.code === reportId);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, cloudReportId);
    assert.equal(matches[0].metrics.entry, 3);
    assert.equal(matches[0].metrics.exit, 1);
    assert.equal(matches[0].metrics.unique, 2);
    assert.ok(matches[0].notes.includes("SYNTHETIC INSTALLER VERIFICATION"));
    result.cloudReportId = cloudReportId;
    result.pendingReportSurvivedRestart = true;
    result.reconnectedRetryMarkedLocalRecordSynced = true;
    result.realBackendReportCount = matches.length;
    result.noDuplicateAfterLostAcknowledgment = true;
    await active.page.goto("tanaw-app://desktop/index.html#/enterprise/reports");
    await active.page.getByText(reportId, { exact: true }).first().waitFor({ timeout: 30_000 });
    result.visibleInInstalledReportHistory = true;
    result.webPlatformReportApiVerified = true;
    result.staffWebUiVerified = false;
  }
  result.telemetryStatuses = telemetryStatuses;
  result.passed = true;
} finally {
  credentials.password = "";
  if (active) {
    await active.page.evaluate(() => window.tanawAuthSession.clear()).catch(() => undefined);
    await close(active.app);
  }
}
await writeFile(path.join(outputDirectory, verifyExisting ? "deployed-integration-current.json" : "deployed-integration.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => ["SYSTEMROOT", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "COMSPEC"].includes(key.toUpperCase())),
  );
  env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  env.CUDA_VISIBLE_DEVICES = "-1";
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], cwd: path.dirname(executablePath), env, timeout: 90_000 });
  let page;
  await until(() => {
    page = app.windows().find((candidate) => candidate.url().startsWith("tanaw-app://desktop"));
    return Boolean(page);
  }, 45_000);
  page.on("response", (response) => {
    if (response.url() === `${api}/operational/desktop/telemetry`) telemetryStatuses.push(response.status());
  });
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/realtime/ws")) return;
    socket.on("framereceived", (event) => {
      try {
        if (JSON.parse(String(event.payload)).type === "realtime.ready") realtimeReady++;
      } catch {
        /* Ignore non-JSON frames. */
      }
    });
  });
  await page.evaluate(() => new Promise((resolve) => window.tanawStartup.onRevealed(resolve)));
  await page.waitForTimeout(1000);
  return { app, page };
}

async function signIn(page) {
  try {
    await page.getByPlaceholder("Enter username or registered email").fill(credentials.username);
    await page.getByPlaceholder("Enter your password").fill(credentials.password);
  } catch {
    // Playwright action logs can include fill values. Keep credentials out of
    // failures as well as successful diagnostic output.
    throw new Error("Enterprise sign-in controls were unavailable.");
  }
  const response = page.waitForResponse((reply) => reply.url() === `${api}/auth/login` && reply.request().method() === "POST", { timeout: 45_000 });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  assert.equal((await response).status(), 200, "Designated enterprise sign-in was rejected.");
  await page.waitForURL(/#\/enterprise\/dashboard$/, { timeout: 45_000 });
}

async function local(page, endpoint, method = "GET", body) {
  const response = await page.evaluate(
    async ({ endpoint, method, body }) => {
      const status = await window.tanawMlService.getStatus();
      return window.tanawMlService.request({ method, url: `${status.baseUrl}${endpoint}`, timeoutMs: 30_000, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    },
    { endpoint, method, body },
  );
  assert.equal(response.ok, true, `Local ${method} ${endpoint} returned HTTP ${response.status}.`);
  return JSON.parse(response.body);
}

async function cloud(page, endpoint) {
  const response = await page.evaluate(
    async ({ api, endpoint }) => {
      const session = await window.tanawAuthSession.load();
      const reply = await fetch(`${api}${endpoint}`, { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(30_000) });
      return { ok: reply.ok, status: reply.status, data: reply.ok ? await reply.json() : null };
    },
    { api, endpoint },
  );
  assert.equal(response.ok, true, `Deployed GET ${endpoint} returned HTTP ${response.status}.`);
  return response.data;
}

async function until(predicate, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Installed deployed-integration verification timed out.");
}

async function close(app) {
  const child = app.process();
  const exited = child.exitCode === null ? once(child, "exit") : Promise.resolve();
  await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("Installed app did not quit.")), 20_000).unref())]);
}
