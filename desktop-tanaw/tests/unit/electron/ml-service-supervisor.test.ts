import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), write: vi.fn() }));
vi.mock("electron", () => ({ app: { isPackaged: true, getVersion: () => "test", getPath: () => "test-profile" } }));
vi.mock("node:fs", () => ({ existsSync: () => true, statSync: () => ({ mtime: new Date(0) }) }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn, execFile: vi.fn() }));
vi.mock("../../../electron/ml-service-diagnostics", () => ({
  createMlDiagnosticLog: () => ({ file: "test-profile/logs/ml-service.log", write: mocks.write }),
  createMlDiagnosticOutput: () => ({ push: vi.fn(), flush: vi.fn() }),
}));

describe("ML service startup recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv("APP_ROOT", "test-app");
    mocks.spawn.mockReset();
    mocks.write.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function setup(readyAt: number) {
    const start = Date.now();
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 1234 });
    mocks.spawn.mockReturnValue(child);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (Date.now() - start < readyAt) throw new Error("not listening yet");
        return new Response(
          JSON.stringify(
            url.endsWith("/health")
              ? { api_contract_version: 2, tripwire_hot_update: true, max_configured_cameras: 6, max_concurrent_cameras: 2 }
              : { cameras: [], pending_camera_ids: [], enterprise_occupancy: 0 },
          ),
        );
      }),
    );
    const service = await import("../../../electron/services/ml-service-supervisor");
    return { child, service };
  }

  it("allows a cold launch taking longer than twenty seconds", async () => {
    const { service } = await setup(35_000);
    const starting = service.startMlService();
    await vi.advanceTimersByTimeAsync(36_000);
    await starting;
    expect(await service.getMlServiceStatusPayload()).toMatchObject({ running: true, error: null });
    expect(mocks.write).toHaveBeenCalledWith("ML service is ready.");
    expect(mocks.spawn).toHaveBeenCalledWith(expect.any(String), [], expect.objectContaining({ env: expect.objectContaining({ PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }) }));
  });

  it("recovers automatically when the service becomes healthy after the startup deadline", async () => {
    const { service } = await setup(95_000);
    const starting = service.startMlService();
    await vi.advanceTimersByTimeAsync(91_000);
    await starting;
    expect((await service.getMlServiceStatusPayload()).error).toContain("did not expose");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await service.getMlServiceStatusPayload()).toMatchObject({ running: true, error: null });
  });

  it("preserves the actual native crash code instead of replacing it with a startup timeout", async () => {
    const { child, service } = await setup(999_000);
    const starting = service.startMlService();
    await vi.advanceTimersByTimeAsync(1000);
    child.emit("exit", 3221225781, null);
    await vi.advanceTimersByTimeAsync(1000);
    await starting;
    expect(await service.getMlServiceStatusPayload()).toMatchObject({ running: false, error: expect.stringContaining("0xc0000135") });
  });
});
