import { describe, expect, it } from "vitest";
import {
  getDarkMonitoringBadgeClass,
  getMapPinState,
  mapPinColors,
  getMonitoringStatusColor,
  getMonitoringStatusLabel,
  getMonitoringStatusPresentation,
  getOccupancyBadgeClass,
  getOccupancyRingColor,
  monitoringStatusLegend,
} from "../../../../../src/features/mapview/utils/mapStatusStyles";

describe("enterprise map monitoring styles", () => {
  it.each(["Stopped", "Offline"] as const)("uses cool blue styling for %s enterprises", (status) => {
    expect(getMonitoringStatusColor(status)).toBe("#266993");
    expect(getDarkMonitoringBadgeClass(status)).toContain("sky");
  });

  it.each([
    ["Fully Monitoring", "#16a34a", "green"],
    ["Partially Monitoring", "#9f6508", "amber"],
    ["Updates Delayed", "#9f6508", "amber"],
    ["Fault", "#ae274d", "rose"],
    ["Not Configured", "#665090", "violet"],
  ] as const)("uses the semantic palette for %s", (status, color, classColor) => {
    expect(getMonitoringStatusColor(status)).toBe(color);
    expect(getDarkMonitoringBadgeClass(status)).toContain(classColor);
  });

  it.each([
    ["Fully Monitoring", "running"],
    ["Partially Monitoring", "partial"],
    ["Updates Delayed", "partial"],
    ["Stopped", "inactive"],
    ["Offline", "inactive"],
    ["Not Configured", "unconfigured"],
    ["Fault", "fault"],
  ] as const)("shares the %s presentation with markers and directory badges", (status, tone) => {
    const presentation = getMonitoringStatusPresentation(status);
    expect(presentation.tone).toBe(tone);
    expect(presentation.color).toBe(getMonitoringStatusColor(status));
    expect(presentation.badgeClass).toBe(getDarkMonitoringBadgeClass(status));
  });

  it("differentiates faults, missing configuration, and inactive connections", () => {
    expect(getMonitoringStatusLabel("Fault")).toBe("Needs Attention");
    expect(getMonitoringStatusLabel("Not Configured")).toBe("Not Configured");
    expect(getMonitoringStatusLabel("Offline")).toBe("Offline");
    expect(getMonitoringStatusLabel("Stopped")).toBe("Stopped");
  });

  it("publishes the directory legend from the authoritative marker tones", () => {
    expect(monitoringStatusLegend.map(({ tone, label }) => ({ tone, label }))).toEqual([
      { label: "All Running", tone: "running" },
      { label: "Partial / Delayed", tone: "partial" },
      { label: "Stopped / Offline", tone: "inactive" },
      { label: "Needs Attention", tone: "fault" },
      { label: "Not Configured", tone: "unconfigured" },
    ]);
  });

  it.each([
    ["Normal", "transparent", "sky"],
    ["No Data", "transparent", "slate"],
    ["Warning", "#facc15", "yellow"],
    ["High Occupancy", "#ef4444", "red"],
  ] as const)("uses a separate occupancy ring and badge for %s", (status, color, classColor) => {
    expect(getOccupancyRingColor(status)).toBe(color);
    expect(getOccupancyBadgeClass(status)).toContain(classColor);
  });
});

describe("dashboard pin states", () => {
  it.each([
    ["Fully Monitoring", "ok"],
    ["Partially Monitoring", "partial"],
    ["Updates Delayed", "partial"],
    ["Fault", "partial"],
    ["Stopped", "offline"],
    ["Offline", "offline"],
    ["Not Configured", "offline"],
  ] as const)("colours %s pins as %s", (status, state) => {
    expect(getMapPinState(status)).toBe(state);
    expect(mapPinColors[state]).toMatch(/^#[0-9a-f]{6}$/);
  });
});
