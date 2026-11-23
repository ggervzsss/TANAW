import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  blockerStart: vi.fn(() => 7),
  blockerStop: vi.fn(),
  secure: new Map<string, unknown>(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "test", getPath: () => "test-profile" },
  powerSaveBlocker: { start: mocks.blockerStart, stop: mocks.blockerStop },
}));
vi.mock("node:fs", () => ({ existsSync: () => true, statSync: () => ({ mtime: new Date(0) }) }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn, execFile: mocks.execFile }));
vi.mock("../../../electron/ml-service-diagnostics", () => ({
  createMlDiagnosticLog: () => ({ file: "test-profile/logs/ml-service.log", write: vi.fn() }),
  createMlDiagnosticOutput: () => ({ push: vi.fn(), flush: vi.fn() }),
}));
vi.mock("../../../electron/stores/secure-json-store", () => ({
  readSecureJson: (file: string) => mocks.secure.get(file) ?? null,
  writeSecureJson: (file: string, value: unknown) => mocks.secure.set(file, structuredClone(value)),
}));
vi.mock("../../../electron/stores/camera-credential-store", () => ({
  getCameraCredential: () => ({ username: "admin", password: "secret" }),
  normalizeCameraCredentialId: (value: unknown) => String(value),
}));

type ServiceState = { counting: Set<number>; profiles: number[] };

describe("ML service recovery", () => {
  const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv("APP_ROOT", "test-app");
    vi.stubEnv("TANAW_ML_SERVICE_PORT", undefined);
    Object.defineProperty(process, "resourcesPath", { configurable: true, value: "test-resources" });
    mocks.spawn.mockReset();
    mocks.execFile.mockReset();
    mocks.blockerStart.mockClear();
    mocks.blockerStop.mockClear();
    mocks.secure.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (originalResourcesPath) Object.defineProperty(process, "resourcesPath", originalResourcesPath);
    else Reflect.deleteProperty(process, "resourcesPath");
  });

  async function setup() {
    const children: EventEmitter[] = [];
    // The service answers only while a process TANAW spawned is alive.
    let listening = false;
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 1000 + children.length, kill: vi.fn(() => child.emit("exit", null, "SIGTERM")) });
      child.on("exit", () => {
        listening = false;
      });
      children.push(child);
      listening = true;
      return child;
    });
    // Windows stops the service with taskkill instead of child.kill(); end the matching process.
    mocks.execFile.mockImplementation((file: string, args: string[], _options: unknown, callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (file === "taskkill.exe") {
        const pid = Number(args[args.indexOf("/PID") + 1]);
        children.find((child) => (child as EventEmitter & { pid: number }).pid === pid)?.emit("exit", 1, null);
      }
      callback(null, { stdout: "", stderr: "" });
    });
    const state: ServiceState = { counting: new Set(), profiles: [1] };
    let bound: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (!listening) throw new Error("not listening");
        const path = new URL(String(url)).pathname;
        const json = (value: unknown) => new Response(JSON.stringify(value));
        if (path === "/health") return json({ api_contract_version: 2, live_stream_frames_only: true, tripwire_hot_update: true, max_configured_cameras: 6, max_concurrent_cameras: 6 });
        if (path === "/context/enterprise") {
          bound = (JSON.parse(String(init?.body)) as { enterprise_id: string }).enterprise_id;
          return json({ enterprise_id: bound, changed: true });
        }
        if (path === "/cameras/runtime")
          return json({
            enterprise_id: bound ?? "",
            active_camera_count: state.counting.size,
            pending_camera_ids: [],
            enterprise_occupancy: 0,
            cameras: [...state.counting].map((id) => ({ camera_id: id, counts: { running: true } })),
          });
        if (path === "/cameras") return json(state.profiles.map((id) => ({ id })));
        if (path === "/camera/start") {
          state.counting.add((JSON.parse(String(init?.body)) as { camera_id: number }).camera_id);
          return json({ accepted: true });
        }
        const stop = /^\/camera\/(\d+)\/stop$/.exec(path);
        if (stop) {
          state.counting.delete(Number(stop[1]));
          return json({ stopped: true });
        }
        return json({});
      }),
    );
    const service = await import("../../../electron/services/ml-service-supervisor");
    const starting = service.startMlService();
    await vi.advanceTimersByTimeAsync(500);
    await starting;
    const binding = service.proxyMlServiceJsonRequest({ url: "http://127.0.0.1:8766/context/enterprise", method: "POST", body: '{"enterprise_id":"park"}' });
    await vi.advanceTimersByTimeAsync(10);
    await binding;
    return { children, service, state, calls: () => vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)).pathname) };
  }

  it("restarts a crashed service, reopens the establishment, and resumes counting", async () => {
    const { children, service, state, calls } = await setup();
    await service.requestCameraWithCredentials("scope", 1, "start", { stream_url: "rtsp://10.0.0.2/stream1" });
    expect(state.counting.has(1)).toBe(true);

    state.counting.clear(); // the crash took the camera worker with it
    children[0].emit("exit", 3221225477, null);
    expect((await service.getMlServiceStatusPayload()).running).toBe(false);
    await vi.advanceTimersByTimeAsync(2500);

    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(calls().filter((path) => path === "/context/enterprise")).toHaveLength(2);
    expect(state.counting.has(1)).toBe(true);
    expect(await service.getMlServiceStatusPayload()).toMatchObject({ running: true, error: null });
  });

  it("does not resume a camera the operator stopped", async () => {
    const { children, service, state, calls } = await setup();
    await service.requestCameraWithCredentials("scope", 1, "start", { stream_url: "rtsp://10.0.0.2/stream1" });
    await service.proxyMlServiceJsonRequest({ url: "http://127.0.0.1:8766/camera/1/stop", method: "POST" });
    children[0].emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(2500);
    expect(calls().filter((path) => path === "/camera/start")).toHaveLength(1);
    expect(state.counting.size).toBe(0);
  });

  it("retries a camera that should be counting but is not", async () => {
    const { service, state, calls } = await setup();
    await service.requestCameraWithCredentials("scope", 1, "start", { stream_url: "rtsp://10.0.0.2/stream1" });
    state.counting.clear(); // e.g. the camera was unreachable and its start failed
    await vi.advanceTimersByTimeAsync(service.COUNTING_RESUME_INTERVAL_MS);
    expect(calls().filter((path) => path === "/camera/start")).toHaveLength(2);
    expect(state.counting.has(1)).toBe(true);
  });

  it("forgets cameras removed from the camera list", async () => {
    const { service, state, calls } = await setup();
    await service.requestCameraWithCredentials("scope", 1, "start", { stream_url: "rtsp://10.0.0.2/stream1" });
    state.profiles = [];
    await service.proxyMlServiceJsonRequest({ url: "http://127.0.0.1:8766/cameras", method: "PUT", body: '{"cameras":[]}' });
    state.counting.clear();
    await vi.advanceTimersByTimeAsync(service.COUNTING_RESUME_INTERVAL_MS);
    expect(calls().filter((path) => path === "/camera/start")).toHaveLength(1);
  });

  it("keeps the computer awake only while a camera is counting", async () => {
    const { service } = await setup();
    await service.requestCameraWithCredentials("scope", 1, "start", { stream_url: "rtsp://10.0.0.2/stream1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.blockerStart).toHaveBeenCalledWith("prevent-app-suspension");
    await service.proxyMlServiceJsonRequest({ url: "http://127.0.0.1:8766/camera/1/stop", method: "POST" });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.blockerStop).toHaveBeenCalledWith(7);
  });

  it("rebinds the establishment after a manual restart", async () => {
    const { service, calls } = await setup();
    const restarting = service.restartMlService();
    await vi.advanceTimersByTimeAsync(5000);
    await restarting;
    expect(calls().filter((path) => path === "/context/enterprise")).toHaveLength(2);
  });
});
