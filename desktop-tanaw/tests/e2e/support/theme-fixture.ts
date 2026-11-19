import { readFileSync } from "node:fs";
import type { Camera } from "../../../src/types/enterprise";

export const themeUser = { id: "theme-operator", email: "theme@example.test", role: "enterprise", name: "Theme Operator", enterpriseId: "enterprise-1", enterpriseName: "TANAW Theme Review" };
const source = JSON.parse(readFileSync(new URL("../../../ml-service/tests/fixtures/reports/mixed-establishment-report.json", import.meta.url), "utf8"));
const camera: Camera = {
  id: 1,
  name: "Park Camera",
  zone: "Park",
  cameraBrand: "tapo",
  cameraHost: "192.168.1.11",
  rtsp: "rtsp://192.168.1.11/stream2",
  analysisMode: "open_space",
  openSpace: {
    zone_id: "main",
    zone_name: "Park",
    polygon: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
  },
  status: "stopped",
  processingProfile: "auto",
  confidence: 0.35,
  config: {
    reverse: false,
    tripwire: 50,
    roi: { top: 0, left: 0, width: 100, height: 100 },
    tripwires: { entry: { start: { x: 30, y: 10 }, end: { x: 30, y: 90 } }, exit: { start: { x: 70, y: 10 }, end: { x: 70, y: 90 } } },
  },
};

/** Test-only local API fixtures shared by Chromium and the real Electron bridge. */
export function themeServiceFixture() {
  const health = {
    status: "ok",
    running: false,
    model_ready: true,
    service_version: "theme-test",
    api_contract_version: 2,
    live_stream_frames_only: true,
    tripwire_hot_update: true,
    active_camera_count: 0,
    max_configured_cameras: 6,
    max_concurrent_cameras: 6,
  };
  const counting = { ...source.counting, enterprise_id: themeUser.enterpriseId, from_at: "2026-11-01T00:00:00+08:00", to_at: "2026-12-01T00:00:00+08:00" };
  const records = [
    ["October 2026", "Submitted"],
    ["August 2026", "Consolidated"],
    ["July 2026", "Returned for Revision"],
    ["June 2026", "Draft"],
  ].map(([period, status], index) => ({
    ...source,
    report_id: `THEME-REPORT-${index}`,
    period,
    sync_status: "synced",
    submitted_at: "2026-11-02T02:00:00Z",
    counting,
    payload: { ...source.payload, status, counting },
  }));
  const drafts = new Map<string, unknown>();
  return (request: { url: string; method?: string; body?: string }) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const endpoint = url.pathname;
    const reply = (body: unknown, status = 200) => ({ body, status });
    if (endpoint === "/health") return reply(health);
    if (endpoint === "/context/enterprise") return reply({ enterprise_id: themeUser.enterpriseId, enterprise_name: themeUser.enterpriseName, changed: false });
    if (endpoint === "/cameras") return reply([camera]);
    if (endpoint === "/cameras/runtime")
      return reply({
        enterprise_id: themeUser.enterpriseId,
        enterprise_occupancy: 0,
        active_camera_count: 0,
        pending_camera_ids: [],
        cameras: [
          {
            camera_id: 1,
            counts: { running: false, status: "stopped", entry: null, exit: null, occupancy: null, error: null },
            detections: { frame_width: 0, frame_height: 0, tracks: [] },
            health,
            area: { available: false, presence: null, active_visits: [] },
            session: {},
          },
        ],
      });
    if (endpoint === "/metrics/establishment/summary") return reply(counting);
    // The fixture's activity falls in one local hour (10 AM); the Dashboard reads it for Busiest Hour.
    if (endpoint === "/metrics/establishment/hourly")
      return reply({
        enterprise_id: themeUser.enterpriseId,
        from_at: url.searchParams.get("start"),
        to_at: url.searchParams.get("end"),
        timezone: "Asia/Manila",
        days_requested: 1,
        days_retained: 1,
        state: "available",
        hours: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          entries: hour === 10 ? counting.entries : 0,
          area_visits: 0,
          peak_occupancy: hour === 10 ? counting.peak_occupancy : null,
          covered_ms: hour === 10 ? counting.covered_ms : 0,
        })),
      });
    if (endpoint === "/metrics/establishment/live")
      return reply({ enterprise_id: themeUser.enterpriseId, occupancy: 2, partial_occupancy: 2, state: "estimated", contributions: [], missing_camera_ids: [], excluded_camera_ids: [] });
    if (endpoint === "/metrics/establishment/periods") return reply([{ period: "September 2026", metrics: { entries: 12, exits: 7, unique_count: 12, peak_occupancy: 5 }, counting }]);
    if (endpoint === "/reports/local") return reply(records);
    if (endpoint === "/reports/submissions") return reply([]);
    if (endpoint.startsWith("/reports/drafts/")) {
      if (request.method === "GET") return reply(drafts.get(endpoint) ?? null);
      const value = JSON.parse(request.body ?? "{}");
      drafts.set(endpoint, value);
      return reply(value);
    }
    if (endpoint === "/metrics/summary") return reply(source);
    if (endpoint === "/metrics/history") return reply({ hourly_density: [], historical: { Today: [], Week: [], Month: [] } });
    return reply({});
  };
}
