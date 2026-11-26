import { describe, expect, it } from "vitest";
import { formatPhilippineDate, formatPhilippineDateAndTime, formatPhilippineDateTime, formatPhilippineTime, resolveSystemDateFormat, resolveSystemTimeFormat } from "../../../../src/shared/utils/dateTime";

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

  it("uses a safe fallback for missing or invalid values", () => {
    expect(formatPhilippineDateTime(null, "12-hour")).toBe("Date unavailable");
    expect(formatPhilippineDateTime("not-a-date", "12-hour")).toBe("Date unavailable");
  });
});

describe("System date format", () => {
  const instant = "2026-11-25T07:51:00Z"; // 3:51 PM, Nov 25 in Manila

  it("formats the Philippine date in each system date format", () => {
    expect(formatPhilippineDate(instant, "MMM d, yyyy")).toBe("Nov 25, 2026");
    expect(formatPhilippineDate(instant, "d MMM yyyy")).toBe("25 Nov 2026");
    expect(formatPhilippineDate(instant, "MM/dd/yyyy")).toBe("11/25/2026");
    expect(formatPhilippineDate(instant, "yyyy-MM-dd")).toBe("2026-11-25");
  });

  it("uses the Manila calendar day, not the UTC one", () => {
    expect(formatPhilippineDate("2026-07-19T18:05:00Z", "yyyy-MM-dd")).toBe("2026-07-20");
  });

  it("formats times and falls back to the default date format", () => {
    expect(formatPhilippineTime(instant, "12-hour")).toBe("3:51 PM");
    expect(formatPhilippineTime(instant, "24-hour")).toBe("15:51");
    expect(formatPhilippineDateAndTime(instant)).toBe("Nov 25, 2026, 3:51 PM");
    expect(resolveSystemDateFormat("nonsense")).toBe("MMM d, yyyy");
    expect(resolveSystemDateFormat("yyyy-MM-dd")).toBe("yyyy-MM-dd");
    expect(formatPhilippineDate(null)).toBe("Date unavailable");
  });
});
