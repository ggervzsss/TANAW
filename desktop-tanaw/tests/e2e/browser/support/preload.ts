import { expect, type Page } from "@playwright/test";
import type { Camera } from "../../../../src/types/enterprise";
import type { MlCameraStates, MlHealth } from "../../../../src/features/camera/services/ml-service.types";

type MlApi = NonNullable<Window["tanawMlService"]>;
type Request = Parameters<MlApi["request"]>[0];
type Response = Awaited<ReturnType<MlApi["request"]>>;
type Handler = (request: Request) => Response | Promise<Response>;
const handlers = new WeakMap<Page, { path: string; handle: Handler }[]>();

export function mlResponse({ status, body }: Pick<Response, "status" | "body">): Response {
  return { status, body, ok: status >= 200 && status < 300, statusText: status < 400 ? "OK" : "Fixture unavailable" };
}

// Browser tests model only the renderer-facing bridge. Real IPC/authentication is
// exercised by e2e-electron, not by allowing renderer HTTP access to the sidecar.
export async function mockMlRequest(page: Page, path: string, handle: Handler) {
  let routes = handlers.get(page);
  if (!routes) {
    routes = [];
    handlers.set(page, routes);
    await page.exposeFunction("__e2eMlRequest", async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      const route = [...(handlers.get(page) ?? [])].reverse().find((candidate) => candidate.path === "*" || pathname === candidate.path);
      if (!route) throw new Error(`Unconfigured ML fixture operation: ${request.method} ${pathname}`);
      return route.handle(request);
    });
    await page.addInitScript(() => {
      const status = async () => ({ baseUrl: "http://127.0.0.1:8765", desktopBuild: "e2e", desktopVersion: "e2e", error: null, packaged: false, pid: null, running: true });
      const listeners = new Set<Parameters<NonNullable<Window["tanawMlService"]>["subscribeToReportEvents"]>[0]>();
      window.tanawMlService = {
        getStatus: status,
        restart: status,
        stopCamera: status,
        request: (request) => (window as unknown as { __e2eMlRequest: MlApi["request"] }).__e2eMlRequest(request),
        subscribeToReportEvents(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
      window.addEventListener("unload", () => listeners.clear());
      window.addEventListener("e2e-ml-live-event", (event) => {
        for (const listener of listeners) listener((event as CustomEvent).detail);
      });
    });
  }
  routes.push({ path, handle });
}

export async function mockRememberedSession(page: Page) {
  await page.addInitScript(() => {
    const key = "tanaw-e2e-remembered-session";
    window.tanawAuthSession = {
      load: async () => JSON.parse(window.localStorage.getItem(key) ?? "null") as unknown,
      save: async (session, persist) => {
        if (persist) window.localStorage.setItem(key, JSON.stringify(session));
        else window.localStorage.removeItem(key);
        return persist;
      },
      clear: async () => {
        window.localStorage.removeItem(key);
      },
    };
  });
}

export async function mockCameraSetup(page: Page, enterpriseId: string) {
  let cameras: Camera[] = [];
  // The idle camera editor needs service readiness, not simulated inference metrics.
  const health: Pick<
    MlHealth,
    "status" | "running" | "error" | "service_version" | "api_contract_version" | "tripwire_hot_update" | "active_camera_count" | "max_configured_cameras" | "max_concurrent_cameras"
  > = {
    status: "ok",
    running: false,
    error: null,
    service_version: "e2e",
    api_contract_version: 2,
    tripwire_hot_update: true,
    active_camera_count: 0,
    max_configured_cameras: 4,
    max_concurrent_cameras: 2,
  };
  await mockMlRequest(page, "/health", () => mlResponse({ status: 200, body: JSON.stringify(health) }));
  await mockMlRequest(page, "/cameras", (request) => {
    if (request.method === "PUT") cameras = (JSON.parse(request.body ?? "{}") as { cameras: Camera[] }).cameras;
    return mlResponse({ status: 200, body: JSON.stringify(cameras) });
  });
  const runtime: MlCameraStates = {
    enterprise_id: enterpriseId,
    enterprise_occupancy: 0,
    active_camera_count: 0,
    max_configured_cameras: 4,
    max_concurrent_cameras: 2,
    pending_camera_ids: [],
    cameras: [],
  };
  await mockMlRequest(page, "/cameras/runtime", () =>
    mlResponse({
      status: 200,
      body: JSON.stringify({
        ...runtime,
        cameras: cameras.map((camera) => ({
          camera_id: camera.id,
          counts: { entry: null, exit: null, occupancy: null, running: false, status: "stopped", error: null },
          detections: { running: false, status: "stopped", frame_width: 640, frame_height: 360, tracks: [] },
          health,
          area: { available: false, presence: null, active_visits: [] },
          session: {},
        })),
      }),
    }),
  );
  await page.addInitScript(() => {
    const records: Awaited<ReturnType<NonNullable<Window["tanawCameraCredentials"]>["load"]>> = {};
    window.tanawCameraCredentials = {
      load: async () => records,
      save: async (id, credential) => {
        records[id] = { passwordConfigured: Boolean(credential.password) || Boolean(records[id]?.passwordConfigured), username: credential.username };
        return records[id];
      },
      remove: async (id) => {
        delete records[id];
      },
      request: async (id, operation, payload) => {
        if (!records[id]?.passwordConfigured) throw new Error("Camera fixture credentials have not been saved");
        if (operation === "test") {
          // Like the ML service, a Tenda camera answers on one of several stream formats.
          const tenda = payload.camera_brand === "tenda" ? `rtsp://${String(payload.camera_host)}:8554/profile1` : null;
          return { ok: true, message: "Fixture camera connection verified", stream_url: tenda ?? payload.stream_url, width: 1280, height: 720 };
        }
        throw new Error(`Unconfigured camera credential operation: ${operation}`);
      },
    };
  });
}

/** Switches the enterprise theme with the topbar toggle (a reload would end the mocked session). */
export async function switchTheme(page: Page, theme: "light" | "dark") {
  const toggle = page.getByRole("button", { name: theme === "dark" ? "Switch to dark mode" : "Switch to light mode" });
  if (await toggle.isVisible()) await toggle.click();
  await expect(page.locator("html")).toHaveClass(theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
}
