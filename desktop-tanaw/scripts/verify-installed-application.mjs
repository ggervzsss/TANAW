import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron } from "@playwright/test";

const executable = process.argv[2];
const phase = process.argv[3] ?? "check";
if (!executable || !["seed", "check"].includes(phase)) {
  throw new Error("Usage: node scripts/verify-installed-application.mjs <installed-executable> [seed|check]");
}
const verificationDirectory = path.resolve("release", process.platform === "linux" ? "installed-verification-linux" : "installed-verification");
const profileDirectory = path.join(verificationDirectory, "Isolated User Profile");
await mkdir(verificationDirectory, { recursive: true });
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    [
      "SYSTEMROOT",
      "WINDIR",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "TEMP",
      "TMP",
      "COMSPEC",
      "HOME",
      "DISPLAY",
      "WAYLAND_DISPLAY",
      "XDG_RUNTIME_DIR",
      "DBUS_SESSION_BUS_ADDRESS",
      "XDG_CURRENT_DESKTOP",
      "XDG_SESSION_TYPE",
      "XAUTHORITY",
      "LANG",
    ].includes(key.toUpperCase()),
  ),
);
environment.PATH = process.platform === "win32" ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : "/usr/local/bin:/usr/bin:/bin";
environment.CUDA_VISIBLE_DEVICES = "-1";
// Keep verification independent of any operator's running TANAW instance.
environment.TANAW_ML_SERVICE_PORT = String(await availableLoopbackPort());
const started = Date.now();
const desktop = await electron.launch({
  executablePath: path.resolve(executable),
  chromiumSandbox: true,
  args: [`--user-data-dir=${profileDirectory}`],
  cwd: path.dirname(path.resolve(executable)),
  env: environment,
  timeout: 90_000,
});
const result = { phase, executable: path.resolve(executable), startedAt: new Date().toISOString() };
let serviceBaseUrl;
try {
  const metadata = await desktop.evaluate(({ app, safeStorage }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    userData: app.getPath("userData"),
    appPath: app.getAppPath(),
    encryptedStorageAvailable: safeStorage.isEncryptionAvailable(),
    storageBackend: process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "dpapi",
    sandboxDisabled: app.commandLine.hasSwitch("no-sandbox"),
    userId: process.getuid?.(),
  }));
  assert.equal(metadata.packaged, true);
  assert.equal(path.resolve(metadata.userData).toLowerCase(), profileDirectory.toLowerCase());
  assert.equal(metadata.encryptedStorageAvailable, true);
  assert.notEqual(metadata.storageBackend, "basic_text");
  assert.equal(metadata.sandboxDisabled, false);
  if (process.platform === "linux") assert.notEqual(metadata.userId, 0);
  result.application = metadata;
  let page;
  const deadline = Date.now() + 90_000;
  while (!page && Date.now() < deadline) {
    for (const candidate of desktop.windows()) {
      if (candidate.url().startsWith("tanaw-app://desktop")) page = candidate;
    }
    if (!page) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(page, "The installed renderer must load from its bundled origin.");
  await page.waitForFunction(() => Boolean(window.tanawMlService), { timeout: 30_000 });
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor({ timeout: 30_000 });
  await page.evaluate(() => new Promise((resolve) => window.tanawStartup.onRevealed(resolve)));
  assert.equal(
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.webContents.getURL().startsWith("tanaw-app://desktop") && window.isVisible())),
    true,
  );
  result.renderer = await page.evaluate(() => ({
    origin: location.origin,
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
    nodeIntegrationAbsent: typeof window.require === "undefined" && typeof window.process === "undefined",
  }));
  assert.equal(result.renderer.origin, "tanaw-app://desktop");
  assert.equal(result.renderer.nodeIntegrationAbsent, true);
  assert.ok(result.renderer.csp.includes("https://tanaw-api-yked.onrender.com"));
  assert.ok(result.renderer.csp.includes("wss://tanaw-api-yked.onrender.com"));
  assert.ok(!result.renderer.csp.includes("localhost:8000"));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(verificationDirectory, `installed-${phase}.png`) });

  let health;
  while (!health && Date.now() < deadline) {
    try {
      const status = await page.evaluate(() => window.tanawMlService.getStatus());
      serviceBaseUrl = status.baseUrl;
      const response = await request(page, "/health");
      if (response.status === "ok") health = response;
    } catch {
      /* Native libraries may still be importing on cold startup. */
    }
    if (!health) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(health, "The installed Python service must start automatically.");
  assert.equal(health.api_contract_version, 2);
  assert.equal(health.runtime_capabilities.openvino_available, true);
  assert.equal(health.runtime_capabilities.onnxruntime_available, true);
  assert.equal(health.runtime_capabilities.cuda_available, false);
  result.nativeRuntime = health.runtime_capabilities;
  result.startupMilliseconds = Date.now() - started;
  const unauthenticated = await fetch(`${serviceBaseUrl}/health`);
  assert.equal(unauthenticated.status, 401);
  result.localServiceRejectsUnauthenticatedRequests = true;
  const blocked = await page.evaluate(async () => {
    try {
      await window.tanawMlService.request({ method: "GET", timeoutMs: 1000, url: "https://example.com/health" });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(blocked, true);
  result.bridgeRejectsOtherOrigins = true;
  result.publicBackendHealth = await page.evaluate(async () => {
    const response = await fetch("https://tanaw-api-yked.onrender.com/health", { signal: AbortSignal.timeout(30_000) });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(result.publicBackendHealth.status, 200);
  result.deployedWebSocket = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const socket = new WebSocket("wss://tanaw-api-yked.onrender.com/realtime/ws");
        let opened = false;
        const timer = setTimeout(() => {
          socket.close();
          resolve({ opened, timedOut: true });
        }, 15_000);
        // Test the real transport/origin boundary without an account session.
        socket.onopen = () => {
          opened = true;
          clearTimeout(timer);
          socket.close(1000, "Transport probe complete");
          resolve({ opened });
        };
        socket.onclose = (event) => {
          clearTimeout(timer);
          resolve({ opened, closeCode: event.code });
        };
      }),
  );
  assert.equal(result.deployedWebSocket.opened, true);

  // All records below are synthetic and scoped to a separate local enterprise.
  // No login, telemetry, or report submission is sent to the deployed backend.
  await request(page, "/context/enterprise", "POST", { enterprise_id: "packaging-verification-local", enterprise_name: "Offline Installer Verification" });
  if (phase === "seed") {
    await request(page, "/cameras", "PUT", {
      cameras: [
        {
          id: 901,
          name: "Packaging verification camera",
          status: "stopped",
          zone: "Local fixture",
          rtsp: "rtsp://192.0.2.1/stream1",
          cameraHost: "192.0.2.1",
          cameraBrand: "tapo",
          rtspStream: "stream1",
          processingProfile: "compatibility",
          config: {},
        },
      ],
    });
    await request(page, "/sample/prepare", "POST", {
      report_id: "PACKAGING-LOCAL-2026-10",
      enterprise_id: "packaging-verification-local",
      entries: 3,
      exits: 1,
      unique_count: 2,
      peak_occupancy: 2,
      period: "October 2026",
    });
    await request(page, "/reports/local-submit", "POST", {
      report_id: "PACKAGING-LOCAL-2026-10",
      period: "October 2026",
      notes: "Local packaging fixture only",
      payload: { demo: { thisProvMale: 1, thisProvFemale: 1, otherProvMale: 0, otherProvFemale: 0, foreignMale: 0, foreignFemale: 0 } },
    });
  }
  const cameras = await request(page, "/cameras");
  assert.equal(cameras.length, 1);
  assert.equal(cameras[0].id, 901);
  const reports = await request(page, "/reports/local");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].report_id, "PACKAGING-LOCAL-2026-10");
  assert.notEqual(reports[0].sync_status, "synced");
  assert.equal(reports[0].entries, 3);
  result.localRecords = { cameras: cameras.length, pendingReports: reports.length, submissionId: reports[0].submission_id };
  if (phase === "check") {
    const previous = JSON.parse(await readFile(path.join(verificationDirectory, "seed.json"), "utf8"));
    assert.equal(result.localRecords.submissionId, previous.localRecords.submissionId);
  }
  // Exercise OS-backed credential storage without using real credentials.
  await page.evaluate(() => window.tanawAuthSession.save({ token: "packaging-fixture-not-a-real-token", user: { enterpriseId: "packaging-verification-local" } }, false));
  if (phase === "seed") {
    await page.evaluate(() => window.tanawCameraCredentials.save(901, { username: "fixture-user", password: "fixture-password-not-real" }));
  }
  const storedCredentials = await page.evaluate(() => window.tanawCameraCredentials.load());
  assert.ok(JSON.stringify(storedCredentials).includes("fixture-user"));
  const encryptedCameraStore = await readFile(path.join(profileDirectory, "camera-credentials.json"), "utf8");
  assert.ok(!encryptedCameraStore.includes("fixture-password-not-real"));
  assert.equal(JSON.parse(encryptedCameraStore).encoding, "safeStorage");
  await page.evaluate(() => window.tanawAuthSession.clear());
  result.cameraCredentialsEncryptedAndReadable = true;
  if (process.argv.includes("--backend-failure")) {
    const matcher = "https://tanaw-api-yked.onrender.com/**";
    await desktop.context().route(matcher, (route) => route.abort("internetdisconnected"));
    await page.getByPlaceholder("Enter username or registered email").fill("offline-verification@example.invalid");
    await page.getByPlaceholder("Enter your password").fill("synthetic-password-not-real");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText("Unable to reach the TANAW server. Check your internet connection and try again.", { exact: true }).waitFor({ timeout: 10_000 });
    assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(), true);
    result.disconnectedBackendRecovered = true;
    await desktop.context().unroute(matcher);
    let releaseStalledRequest;
    await desktop.context().route(matcher, async (route) => {
      await new Promise((resolve) => {
        releaseStalledRequest = resolve;
      });
      await route.abort("failed").catch(() => undefined);
    });
    try {
      await page.getByPlaceholder("Enter your password").fill("another-synthetic-password");
      const slowStart = Date.now();
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByText("Unable to reach the TANAW server. Check your internet connection and try again.", { exact: true }).waitFor({ timeout: 40_000 });
      result.stalledBackendMilliseconds = Date.now() - slowStart;
      assert.ok(result.stalledBackendMilliseconds >= 29_000 && result.stalledBackendMilliseconds < 38_000);
      assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(), true);
      result.stalledBackendRecovered = true;
      assert.equal((await request(page, "/health")).status, "ok");
    } finally {
      releaseStalledRequest?.();
    }
  }
} finally {
  const processHandle = desktop.process();
  const exited = processHandle.exitCode !== null ? Promise.resolve() : once(processHandle, "exit");
  await desktop.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("Installed app did not quit cleanly.")), 20_000).unref())]);
}
if (serviceBaseUrl) {
  let stopped = false;
  try {
    await fetch(`${serviceBaseUrl}/health`, { signal: AbortSignal.timeout(1500) });
  } catch {
    stopped = true;
  }
  assert.equal(stopped, true, "The child service must stop when the installed app quits.");
}
result.serviceStoppedOnQuit = true;
result.passed = true;
await writeFile(path.join(verificationDirectory, `${phase}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

async function request(page, endpoint, method = "GET", body) {
  const response = await page.evaluate(
    async ({ endpoint, method, body }) => {
      const status = await window.tanawMlService.getStatus();
      return window.tanawMlService.request({ method, url: `${status.baseUrl}${endpoint}`, timeoutMs: 30_000, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    },
    { endpoint, method, body },
  );
  if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${response.body}`);
  return JSON.parse(response.body);
}

async function availableLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}
