import { describe, expect, it, vi } from "vitest";
import { getCurrentReportingPeriod, getReportingPeriodSubmissionError } from "./reporting-calendar";

describe("reporting calendar", () => {
  it("uses the Manila calendar month for the current workspace period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T16:30:00.000Z"));

    expect(getCurrentReportingPeriod()).toBe("September 2026");

    vi.useRealTimers();
  });

  it("opens submission on the Manila day after the reporting month closes", () => {
    expect(getReportingPeriodSubmissionError("July 2026", new Date("2026-07-31T15:59:59.000Z"))).toContain("Aug 1, 2026");
    expect(getReportingPeriodSubmissionError("July 2026", new Date("2026-07-31T16:00:00.000Z"))).toBeNull();
  });

  it("rejects ambiguous reporting period labels", () => {
    expect(getReportingPeriodSubmissionError("2026-07")).toContain("Month YYYY");
  });
});
