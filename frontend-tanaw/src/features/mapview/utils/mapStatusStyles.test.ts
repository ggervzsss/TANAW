import { describe, expect, it } from "vitest";
import { getDarkStatusBadgeClass, getEnterpriseStatusColor } from "./mapStatusStyles";

describe("enterprise map availability styles", () => {
  it.each(["Offline", "Inactive"] as const)("uses neutral gray styling for %s enterprises", (status) => {
    expect(getEnterpriseStatusColor(status)).toBe("#64748b");
    expect(getDarkStatusBadgeClass(status)).toContain("slate");
    expect(getDarkStatusBadgeClass(status)).not.toContain("red");
  });
});
