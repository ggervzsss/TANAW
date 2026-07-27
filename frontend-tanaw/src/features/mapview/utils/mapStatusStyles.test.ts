import { describe, expect, it } from "vitest";
import { getDarkMonitoringBadgeClass, getMonitoringStatusColor, getOccupancyBadgeClass, getOccupancyRingColor } from "./mapStatusStyles";

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
    ["Normal", "transparent", "sky"],
    ["No Data", "transparent", "slate"],
    ["Warning", "#facc15", "yellow"],
    ["High Occupancy", "#ef4444", "red"],
  ] as const)("uses a separate occupancy ring and badge for %s", (status, color, classColor) => {
    expect(getOccupancyRingColor(status)).toBe(color);
    expect(getOccupancyBadgeClass(status)).toContain(classColor);
  });
});
