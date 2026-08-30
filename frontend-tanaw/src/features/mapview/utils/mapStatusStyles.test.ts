import { describe, expect, it } from "vitest";
import { getDarkMonitoringBadgeClass, getMonitoringStatusColor, getMonitoringStatusPresentation, getOccupancyBadgeClass, getOccupancyRingColor, monitoringStatusLegend } from "./mapStatusStyles";

describe("enterprise map monitoring styles", () => {
  it.each(["Stopped", "Offline", "Not Configured"] as const)("uses neutral gray styling for %s enterprises", (status) => {
    expect(getMonitoringStatusColor(status)).toBe("#64748b");
    expect(getDarkMonitoringBadgeClass(status)).toContain("slate");
    expect(getDarkMonitoringBadgeClass(status)).not.toContain("red");
  });

  it.each([
    ["Fully Monitoring", "#16a34a", "green"],
    ["Partially Monitoring", "#ea580c", "orange"],
    ["Updates Delayed", "#ea580c", "orange"],
    ["Fault", "#dc2626", "red"],
  ] as const)("uses the semantic palette for %s", (status, color, classColor) => {
    expect(getMonitoringStatusColor(status)).toBe(color);
    expect(getDarkMonitoringBadgeClass(status)).toContain(classColor);
  });

  it.each([
    ["Fully Monitoring", "running"],
    ["Partially Monitoring", "partial"],
    ["Updates Delayed", "partial"],
    ["Stopped", "stopped"],
    ["Offline", "stopped"],
    ["Not Configured", "stopped"],
    ["Fault", "fault"],
  ] as const)("shares the %s presentation with markers and directory badges", (status, tone) => {
    const presentation = getMonitoringStatusPresentation(status);
    expect(presentation.tone).toBe(tone);
    expect(presentation.color).toBe(getMonitoringStatusColor(status));
    expect(presentation.badgeClass).toBe(getDarkMonitoringBadgeClass(status));
  });

  it("publishes the directory legend from the authoritative marker tones", () => {
    expect(monitoringStatusLegend).toEqual([
      { label: "All Running", tone: "running" },
      { label: "Partial", tone: "partial" },
      { label: "Stopped", tone: "stopped" },
      { label: "Fault", tone: "fault" },
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
