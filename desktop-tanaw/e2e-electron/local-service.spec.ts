import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

const execFileAsync = promisify(execFile);
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mlServiceRoot = path.join(desktopRoot, "ml-service");
const pythonExecutable = path.join(mlServiceRoot, ".venv", "bin", "python");
const enterpriseId = "11111111-1111-4111-8111-111111111111";
const centralCameraId = "22222222-2222-4222-8222-222222222222";
const cameraCredentialCanary = "tanaw-camera-credential-canary-7f4b9d2e";

type MlServiceStatus = {
  baseUrl: string;
  error: string | null;
  pid: number | null;
  running: boolean;
};

type LocalReportRevision = {
  outbox_item_id: string;
  payload_hash: string;
  report_id: string;
  revision_id: string;
  sync_status: string;
};

type LocalReportRecord = LocalReportRevision & {
  acknowledged_at: string | null;
};

type OutboxHealth = {
  attempt_count: number;
  dead_letter_count: number;
  last_failure_class: string | null;
  oldest_pending_at: string | null;
  pending_count: number;
  retry_item_count: number;
};

type OutboxRecoveryItem = {
  attempt_count: number;
  last_error_class: string | null;
  last_error_message: string | null;
  outbox_item_id: string;
  report_id: string;
  status: "ready" | "retry" | "dead_letter";
};

type OperationalDiagnostics = {
  camera: {
    active_sessions: number;
    coverage_evidence_status: "recorded" | "not_recorded";
    reconnect_attempts: number;
  };
  observed_at: string;
  outbox: OutboxHealth;
  persistence: {
    error_count: number;
    unresolved_count: number;
  };
  reporting_period_id: string;
  writer: {
    committed_transaction_count: number;
    latest_lock_wait_ms: number;
    latest_transaction_duration_ms: number;
  };
};

test("supervises the authenticated ML service and preserves an exact report retry across restart", async () => {
  const appDataDirectory = await mkdtemp(path.join(os.tmpdir(), "tanaw-electron-e2e-"));
  const activePeriod = reportingPeriod();
  const reportPeriod = reportingPeriod(-1);
  const reportId = `E2E-${reportPeriod.year}-${reportPeriod.month}`;
  const capturedLogs: string[] = [];
  let electronApplication: ElectronApplication | null = null;

  try {
    await seedOfficialCameraEvent(appDataDirectory, reportPeriod.capturedAt);
    electronApplication = await electron.launch({
      args: [`--user-data-dir=${appDataDirectory}`, desktopRoot],
      cwd: desktopRoot,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
    });
    captureProcessLogs(electronApplication, capturedLogs);
    const page = await electronApplication.firstWindow();
    captureRendererLogs(page, capturedLogs);
    await waitForMainRenderer(page);

    const initialStatus = await getServiceStatus(page);
    expect(initialStatus).toMatchObject({
      baseUrl: "tanaw-ml://local",
      error: null,
      running: true,
    });
    expect(initialStatus.pid).toBeGreaterThan(0);
    await expectNoSecretsInProcessListing(initialStatus.pid!);

    await bindEnterprise(page);
    const initialDiagnostics = await requestMl<OperationalDiagnostics>(page, "diagnostics.operations");
    expect(initialDiagnostics.reporting_period_id).toBe(activePeriod.periodId);
    expect(Date.parse(initialDiagnostics.observed_at)).not.toBeNaN();
    expect(initialDiagnostics.outbox).toMatchObject({
      attempt_count: 0,
      dead_letter_count: 0,
      pending_count: 0,
      retry_item_count: 0,
    });
    expect(initialDiagnostics.writer.committed_transaction_count).toBeGreaterThan(0);
    expect(initialDiagnostics.writer.latest_lock_wait_ms).toBeGreaterThanOrEqual(0);
    expect(initialDiagnostics.writer.latest_transaction_duration_ms).toBeGreaterThanOrEqual(0);
    expect(initialDiagnostics.persistence).toEqual({
      error_count: 0,
      last_error_at: null,
      unresolved_count: 0,
    });

    const reportRequest = {
      notes: "Electron restart persistence check",
      payload: {},
      period_id: reportPeriod.periodId,
      report_id: reportId,
      source_window: {
        end: reportPeriod.endsAtUtc,
        start: reportPeriod.startsAtUtc,
      },
    };
    const created = await requestMl<LocalReportRevision>(page, "reports.createRevision", reportRequest);
    expect(created.report_id).toBe(reportId);
    expect(created.sync_status).toBe("pending_cloud_sync");

    const readyBeforeFailure = await requestMl<Array<{ outbox_item_id: string }>>(page, "sync.outbox.ready", { limit: 10 });
    expect(readyBeforeFailure.map((item) => item.outbox_item_id)).toEqual([created.outbox_item_id]);

    await requestMl(page, "sync.outbox.failure", {
      error_class: "network_error",
      error_message: "E2E-injected transient central outage.",
      http_status: null,
      outboxItemId: created.outbox_item_id,
      retryable: true,
    });
    const failedHealth = await requestMl<OutboxHealth>(page, "sync.outbox.health");
    expect(failedHealth).toMatchObject({
      attempt_count: 1,
      dead_letter_count: 0,
      last_failure_class: "network_error",
      pending_count: 1,
      retry_item_count: 1,
    });
    expect(Date.parse(failedHealth.oldest_pending_at ?? "")).not.toBeNaN();

    const recoveryItems = await requestMl<OutboxRecoveryItem[]>(page, "sync.outbox.recovery.list", { limit: 10 });
    expect(recoveryItems).toHaveLength(1);
    expect(recoveryItems[0]).toMatchObject({
      attempt_count: 1,
      last_error_class: "network_error",
      last_error_message: "E2E-injected transient central outage.",
      outbox_item_id: created.outbox_item_id,
      report_id: reportId,
      status: "retry",
    });
    expect(recoveryItems[0]).not.toHaveProperty("payload");
    const recoveryDetail = await requestMl<OutboxRecoveryItem>(page, "sync.outbox.recovery.detail", {
      outboxItemId: created.outbox_item_id,
    });
    expect(recoveryDetail).toEqual(recoveryItems[0]);
    const requeued = await requestMl<OutboxRecoveryItem>(page, "sync.outbox.recovery.retry", {
      outboxItemId: created.outbox_item_id,
      reason: "Electron E2E operator reviewed the transient outage.",
    });
    expect(requeued).toMatchObject({ attempt_count: 2, status: "ready" });
    expect(await requestMl<OutboxRecoveryItem[]>(page, "sync.outbox.recovery.list", { limit: 10 })).toEqual([]);
    expect((await requestMl<Array<{ outbox_item_id: string }>>(page, "sync.outbox.ready", { limit: 10 })).map((item) => item.outbox_item_id)).toEqual([created.outbox_item_id]);
    await requestMl(page, "sync.outbox.failure", {
      error_class: "network_error",
      error_message: "E2E-injected outage remains active after deliberate retry.",
      http_status: null,
      outboxItemId: created.outbox_item_id,
      retryable: true,
    });

    const cameraTest = await requestMl<{ message: string; ok: boolean }>(page, "camera.test", {
      body: { camera_type: "USB_WEBCAM", stream_url: "999999" },
      cameraId: 999999,
      credentialScope: enterpriseId,
    });
    expect(cameraTest.ok).toBe(false);
    expect(cameraTest.message).toMatch(/camera|webcam|device|stream/i);
    const credentialBearingCameraTest = await requestMl<{ message: string; ok: boolean }>(page, "camera.test", {
      body: {
        camera_type: "RTSP_CCTV",
        stream_url: `rtsp://127.0.0.1:1/tanaw-e2e?credential=${cameraCredentialCanary}`,
      },
      cameraId: 999998,
      credentialScope: enterpriseId,
    });
    expect(credentialBearingCameraTest.ok).toBe(false);
    await requestMl(page, "camera.stop");
    const stoppedCamera = await requestMl<{ running: boolean; status: string }>(page, "camera.session");
    expect(stoppedCamera).toMatchObject({ running: false, status: "stopped" });

    const restartedStatus = await page.evaluate(() => window.tanawMlService?.restart());
    expect(restartedStatus).toMatchObject({ error: null, running: true });
    expect(restartedStatus?.pid).toBeGreaterThan(0);
    expect(restartedStatus?.pid).not.toBe(initialStatus.pid);

    await bindEnterprise(page);
    const replayed = await requestMl<LocalReportRevision>(page, "reports.createRevision", reportRequest);
    expect(replayed).toMatchObject({
      outbox_item_id: created.outbox_item_id,
      payload_hash: created.payload_hash,
      report_id: created.report_id,
      revision_id: created.revision_id,
      sync_status: "pending_cloud_sync",
    });
    const reportsAfterRestart = await requestMl<LocalReportRecord[]>(page, "reports.list", { limit: 10 });
    expect(reportsAfterRestart).toHaveLength(1);
    expect(reportsAfterRestart[0]).toMatchObject({
      acknowledged_at: null,
      outbox_item_id: created.outbox_item_id,
      revision_id: created.revision_id,
      sync_status: "pending_cloud_sync",
    });

    const diagnosticsAfterRestart = await requestMl<OperationalDiagnostics>(page, "diagnostics.operations");
    expect(diagnosticsAfterRestart.outbox).toMatchObject({
      attempt_count: 3,
      dead_letter_count: 0,
      last_failure_class: "network_error",
      pending_count: 1,
      retry_item_count: 1,
    });
    expect(diagnosticsAfterRestart.camera).toMatchObject({
      active_sessions: 0,
      reconnect_attempts: 0,
    });
    expect(["recorded", "not_recorded"]).toContain(diagnosticsAfterRestart.camera.coverage_evidence_status);

  } finally {
    await electronApplication?.close().catch(() => undefined);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expectNoSecretsInLogs(capturedLogs);
    } finally {
      await rm(appDataDirectory, { force: true, recursive: true });
    }
  }
});

async function waitForMainRenderer(page: Page) {
  await expect
    .poll(() => page.url(), { timeout: 45_000 })
    .toMatch(/index\.html(?:#.*)?$/);
  await expect
    .poll(() => page.evaluate(() => typeof window.tanawMlService?.getStatus === "function"))
    .toBe(true);
}

function captureProcessLogs(application: ElectronApplication, records: string[]) {
  const process = application.process();
  process.stdout?.on("data", (chunk) => records.push(String(chunk)));
  process.stderr?.on("data", (chunk) => records.push(String(chunk)));
}

function captureRendererLogs(page: Page, records: string[]) {
  page.on("console", (message) => records.push(message.text()));
  page.on("pageerror", (error) => records.push(error.message));
}

async function expectNoSecretsInProcessListing(pid: number) {
  if (process.platform !== "linux") return;
  const [commandLine, environment] = await Promise.all([
    readFile(`/proc/${pid}/cmdline`, "utf8"),
    readFile(`/proc/${pid}/environ`, "utf8"),
  ]);
  const listing = `${commandLine}\n${environment}`;
  expect(listing).not.toContain(cameraCredentialCanary);
  expect(listing).not.toMatch(/TANAW-(?:Capability|Session)|tanaw-session\.|(?:^|\0)(?:TANAW_)?(?:CAPABILITY|TOKEN|PASSWORD)=/i);
}

function expectNoSecretsInLogs(records: string[]) {
  const output = records.join("\n");
  expect(output).not.toContain(cameraCredentialCanary);
  expect(output).not.toMatch(/TANAW-(?:Capability|Session)\s+[A-Za-z0-9_-]+/i);
  expect(output).not.toMatch(/tanaw-session\.[A-Za-z0-9_-]+/i);
  expect(output).not.toMatch(/rtsp:\/\/[^\s"']*@/i);
}

async function getServiceStatus(page: Page) {
  await expect
    .poll(async () => (await page.evaluate(() => window.tanawMlService?.getStatus()))?.running, {
      timeout: 30_000,
    })
    .toBe(true);
  const status = await page.evaluate(() => window.tanawMlService?.getStatus());
  if (!status) throw new Error("The trusted Electron ML service bridge is unavailable.");
  return status as MlServiceStatus;
}

async function bindEnterprise(page: Page) {
  const context = await requestMl<{ changed: boolean; enterprise_id: string }>(page, "context.enterprise", {
    enterprise_id: enterpriseId,
    enterprise_name: "Electron E2E Enterprise",
  });
  expect(context.enterprise_id).toBe(enterpriseId);
}

async function requestMl<T = unknown>(page: Page, operation: Parameters<NonNullable<Window["tanawMlService"]>["request"]>[0], payload?: unknown): Promise<T> {
  return page.evaluate(
    async ({ operationName, operationPayload }) => {
      if (!window.tanawMlService) throw new Error("The trusted Electron ML service bridge is unavailable.");
      return window.tanawMlService.request(operationName, operationPayload);
    },
    { operationName: operation, operationPayload: payload },
  ) as Promise<T>;
}

async function seedOfficialCameraEvent(appDataDirectory: string, capturedAt: string) {
  const script = `
import sys
from app.storage.local_ledger import LocalLedger

ledger = LocalLedger(sys.argv[1], sys.argv[2])
ledger.append_count_event(
    {
        "camera_id": 1,
        "central_camera_id": sys.argv[3],
        "camera_name": "Electron E2E Camera",
        "counts": {"entry": 1, "exit": 0, "occupancy": 1},
        "direction": "entry",
        "is_unique_entry": True,
        "source_kind": "real",
        "track_id": 1,
    },
    sys.argv[4],
)
`;
  await execFileAsync(pythonExecutable, ["-c", script, appDataDirectory, enterpriseId, centralCameraId, capturedAt], {
    cwd: mlServiceRoot,
    env: { ...process.env, PYTHONPATH: mlServiceRoot },
  });
}

function reportingPeriod(monthOffset = 0) {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    timeZone: "Asia/Manila",
    year: "numeric",
  }).formatToParts(new Date());
  const currentYear = Number(parts.find((part) => part.type === "year")?.value);
  const currentMonth = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isInteger(currentYear) || !Number.isInteger(currentMonth)) throw new Error("Unable to resolve the current TANAW reporting period.");
  const targetMonth = new Date(Date.UTC(currentYear, currentMonth - 1 + monthOffset, 1));
  const year = targetMonth.getUTCFullYear();
  const month = targetMonth.getUTCMonth() + 1;
  const offsetMilliseconds = 8 * 60 * 60 * 1000;
  const start = new Date(Date.UTC(year, month - 1, 1) - offsetMilliseconds);
  const end = new Date(Date.UTC(year, month, 1) - offsetMilliseconds);
  const paddedMonth = String(month).padStart(2, "0");
  return {
    capturedAt: new Date((start.getTime() + end.getTime()) / 2).toISOString(),
    endsAtUtc: end.toISOString().replace(".000Z", "Z"),
    month: paddedMonth,
    periodId: `month:Asia/Manila:${year}-${paddedMonth}`,
    startsAtUtc: start.toISOString().replace(".000Z", "Z"),
    year,
  };
}
