import { describe, expect, it } from "vitest";
import { getDarkStatusBadgeClass, getEnterpriseStatusColor } from "./mapStatusStyles";

describe("enterprise map availability styles", () => {
  it.each(["Offline", "Inactive"] as const)("uses neutral gray styling for %s enterprises", (status) => {
    expect(getEnterpriseStatusColor(status)).toBe("#64748b");
    expect(getDarkStatusBadgeClass(status)).toContain("slate");
    expect(getDarkStatusBadgeClass(status)).not.toContain("red");
  });

  it.each([
    ["Normal", "#055b25", "green"],
    ["Warning", "#ca8a04", "yellow"],
    ["High Occupancy", "#b91c1c", "red"],
    ["Issue", "#ea580c", "orange"],
  ] as const)("uses the semantic palette for %s", (status, color, classColor) => {
    expect(getEnterpriseStatusColor(status)).toBe(color);
    expect(getDarkStatusBadgeClass(status)).toContain(classColor);
  });
});
