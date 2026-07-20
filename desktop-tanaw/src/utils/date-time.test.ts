import { describe, expect, it } from "vitest";
import { formatPhilippineDateTime, resolveSystemTimeFormat } from "./date-time";

describe("Philippine date and time formatting", () => {
  it("converts an instant to Philippine Time in 12-hour format", () => {
    const result = formatPhilippineDateTime("2026-07-19T18:05:00Z", "12-hour");

    expect(result).toContain("Jul 20, 2026");
    expect(result).toContain("2:05 AM");
  });

  it("supports the IT-selected 24-hour format", () => {
    const result = formatPhilippineDateTime("2026-07-19T18:05:00Z", "24-hour");

    expect(result).toContain("Jul 20, 2026");
    expect(result).toContain("02:05");
  });

  it("uses the user-friendly 12-hour format by default", () => {
    expect(resolveSystemTimeFormat(undefined)).toBe("12-hour");
    expect(resolveSystemTimeFormat("24-hour")).toBe("24-hour");
  });
});
