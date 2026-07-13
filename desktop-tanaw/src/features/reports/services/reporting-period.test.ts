import { describe, expect, it } from "vitest";
import { canonicalReportingPeriodFromSource, getReportingPeriodSubmissionError, reportingPeriodContains } from "./reporting-period";

const JUNE = {
  period_id: "month:Asia/Manila:2026-06",
  period: "Jun 1 - Jun 30, 2026",
  starts_at_utc: "2026-05-31T16:00:00+00:00",
  ends_at_utc: "2026-06-30T16:00:00Z",
};

describe("canonical reporting periods", () => {
  it("normalizes the server natural key and exact Manila UTC bounds", () => {
    expect(canonicalReportingPeriodFromSource(JUNE)).toEqual({
      periodId: JUNE.period_id,
      label: JUNE.period,
      startsAtUtc: "2026-05-31T16:00:00.000Z",
      endsAtUtc: "2026-06-30T16:00:00.000Z",
    });
  });

  it("uses an inclusive start and exclusive end across the Manila month boundary", () => {
    const period = canonicalReportingPeriodFromSource(JUNE);
    expect(reportingPeriodContains(period, "2026-05-31T15:59:59.999Z")).toBe(false);
    expect(reportingPeriodContains(period, "2026-05-31T16:00:00.000Z")).toBe(true);
    expect(reportingPeriodContains(period, "2026-06-30T15:59:59.999Z")).toBe(true);
    expect(reportingPeriodContains(period, "2026-06-30T16:00:00.000Z")).toBe(false);
  });

  it("validates the December-to-January year transition", () => {
    const december = canonicalReportingPeriodFromSource({
      period_id: "month:Asia/Manila:2026-12",
      period: "Dec 1 - Dec 31, 2026",
      starts_at_utc: "2026-11-30T16:00:00Z",
      ends_at_utc: "2026-12-31T16:00:00Z",
    });
    expect(reportingPeriodContains(december, "2026-12-31T15:59:59.999Z")).toBe(true);
    expect(reportingPeriodContains(december, "2026-12-31T16:00:00Z")).toBe(false);
  });

  it.each([
    [{ ...JUNE, period_id: undefined }, "No canonical reporting period"],
    [{ ...JUNE, period_id: "June 2026" }, "Expected month:Asia/Manila:YYYY-MM"],
    [{ ...JUNE, starts_at_utc: undefined }, "missing its exact UTC source window"],
    [{ ...JUNE, ends_at_utc: "2026-07-31T16:00:00Z" }, "does not match the exact Asia/Manila calendar boundary"],
  ])("blocks a missing or invalid canonical period: %#", (source, message) => {
    expect(() => canonicalReportingPeriodFromSource(source)).toThrow(message);
  });

  it("opens submission at the exact UTC end of an explicitly selected period", () => {
    const period = canonicalReportingPeriodFromSource(JUNE);
    expect(getReportingPeriodSubmissionError(period, new Date("2026-06-30T15:59:59.999Z"))).toContain("Submission opens after");
    expect(getReportingPeriodSubmissionError(period, new Date("2026-06-30T16:00:00.000Z"))).toBeNull();
    expect(getReportingPeriodSubmissionError(null, new Date("2026-07-13T00:00:00Z"))).toContain("No canonical reporting period is selected");
  });
});
