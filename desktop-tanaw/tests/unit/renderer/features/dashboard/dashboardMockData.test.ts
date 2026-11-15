import { afterEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_MOCK_DATA, getDashboardMockData, getDashboardMockReply } from "../../../../../src/features/dashboard/data/dashboardMockData";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("frontend-only Dashboard samples", () => {
  it("keeps reference values and complete hourly charts in the single fixture", () => {
    expect(DASHBOARD_MOCK_DATA.stats).toEqual({ occupancy: 462, entries: 1248, exits: 786, unique: 1112 });
    expect(DASHBOARD_MOCK_DATA.traffic.reduce((sum, row) => sum + row.entries, 0)).toBe(1248);
    expect(DASHBOARD_MOCK_DATA.traffic.reduce((sum, row) => sum + row.exits, 0)).toBe(786);
    expect(Math.max(...DASHBOARD_MOCK_DATA.occupancy.map((row) => row.occupancy))).toBe(156);
    expect(DASHBOARD_MOCK_DATA.demographics.gender.reduce((sum, row) => sum + row.percent, 0)).toBe(100);
    expect(DASHBOARD_MOCK_DATA.demographics.residence.map((row) => row.percent)).toEqual([62.7, 27.1, 9.5, 3.2]);
    expect(DASHBOARD_MOCK_DATA.reports.every((report) => report.kind === "dashboard-sample" && report.id.startsWith("MOCK-"))).toBe(true);
    expect(DASHBOARD_MOCK_DATA.reports.every((report) => !("demo" in report) && !("payload" in report) && !("metrics" in report))).toBe(true);
  });

  it("builds coherent period totals without mutating the sample day", () => {
    const before = JSON.stringify(DASHBOARD_MOCK_DATA);
    for (const [period, length] of [
      ["Week", 7],
      ["Month", 30],
    ] as const) {
      const selected = getDashboardMockData(period);
      expect(selected.traffic).toHaveLength(length);
      expect(selected.occupancy).toHaveLength(length);
      expect(selected.stats.entries).toBe(selected.traffic.reduce((sum, row) => sum + row.entries, 0));
      expect(selected.stats.exits).toBe(selected.traffic.reduce((sum, row) => sum + row.exits, 0));
    }
    expect(JSON.stringify(DASHBOARD_MOCK_DATA)).toBe(before);
  });

  it("answers suggestions and unknown input locally", () => {
    for (const suggestion of DASHBOARD_MOCK_DATA.assistant.suggestions) expect(getDashboardMockReply(suggestion.question)).toBe(suggestion.answer);
    expect(getDashboardMockReply("unrecognized question")).toBe(DASHBOARD_MOCK_DATA.assistant.fallback);
  });

  it("disables mock mode explicitly without any persisted setting", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_USE_MOCK_DATA", "false");
    expect((await import("../../../../../src/features/dashboard/data/dashboardMockData")).USE_MOCK_DATA).toBe(false);
    vi.resetModules();
    vi.stubEnv("VITE_USE_MOCK_DATA", "true");
    expect((await import("../../../../../src/features/dashboard/data/dashboardMockData")).USE_MOCK_DATA).toBe(true);
  });
});
