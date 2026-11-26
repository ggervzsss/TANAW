import { describe, expect, it } from "vitest";
import {
  mergeMissingOriginDays,
  dailyOriginsError,
  formatReportDate,
  missingDays,
  monthlyDemoFromDays,
  originsFromPayload,
  reportDays,
  reportingDateKey,
  setDayOrigin,
} from "../../../../../../src/features/reports/model/daily-origins";
import type { DailyOrigins, Metrics } from "../../../../../../src/types/enterprise";

const day = (business_date: string, unique_count: number) => ({
  business_date,
  covered_ms: 1000,
  qualified_observations: unique_count,
  identification_state: "available",
  unique_count,
});
const metrics = {
  entries: null,
  exits: null,
  peak: null,
  unique: 17,
  counting: { days: [day("2026-11-01", 12), day("2026-11-02", 0), day("2026-11-03", 5)] },
} as unknown as Metrics;

describe("daily visitor origins", () => {
  it("puts every visitor in This City until the user enters other origins, with nothing to confirm", () => {
    const days = reportDays("November 2026", metrics, {}, "2026-11-16");
    expect(days.slice(0, 3).map((item) => [item.thisCity, item.status])).toEqual([
      [12, "complete"],
      [0, "no-visitors"],
      [5, "complete"],
    ]);
    expect(days[3].status).toBe("no-visitors");
    expect(days[20].status).toBe("upcoming");
    expect(missingDays(days)).toEqual([]);
    expect(dailyOriginsError(days)).toBeNull();
  });

  it("deducts entered origins from This City and caps them at the day's visitors", () => {
    const [first] = reportDays("November 2026", metrics, {}, "2026-11-16");
    let origins = setDayOrigin({}, first, "otherCity", "male", "4");
    origins = setDayOrigin(origins, first, "foreign", "female", "3");
    let [updated] = reportDays("November 2026", metrics, origins, "2026-11-16");
    expect(updated.thisCity).toBe(5);
    expect(updated.status).toBe("complete");

    origins = setDayOrigin(origins, updated, "otherProvince", "male", "99");
    [updated] = reportDays("November 2026", metrics, origins, "2026-11-16");
    expect(origins["2026-11-01"].otherProvince.male).toBe(5);
    expect(updated.thisCity).toBe(0);

    origins = setDayOrigin(origins, updated, "otherProvince", "male", "-2");
    expect(origins["2026-11-01"].otherProvince.male).toBe(0);
  });

  it("flags a confirmed day again when a recount drops below its entered origins", () => {
    const origins: DailyOrigins = { "2026-11-03": { otherCity: { male: 4, female: 3 }, otherProvince: { male: 0, female: 0 }, foreign: { male: 0, female: 0 } } };
    const days = reportDays("November 2026", metrics, origins, "2026-11-16");
    expect(days[2].status).toBe("missing");
    expect(days[2].thisCity).toBe(0);
    expect(dailyOriginsError(days)).toBe("Lower the visitor origins for 1 day: they add up to more than TANAW counted.");
  });

  it("reads saved origins and ignores malformed entries", () => {
    expect(
      originsFromPayload({
        "2026-11-01": { otherCity: { male: 2, female: "x" }, foreign: { male: 1 } },
        "not-a-date": { otherCity: { male: 1, female: 1 } },
      }),
    ).toEqual({ "2026-11-01": { otherCity: { male: 2, female: 0 }, otherProvince: { male: 0, female: 0 }, foreign: { male: 1, female: 0 } } });
    expect(originsFromPayload(undefined)).toBeUndefined();
    expect(originsFromPayload([1])).toBeUndefined();
  });

  it("formats business dates in the reporting time zone", () => {
    expect(formatReportDate("2026-11-16")).toBe("November 16, 2026");
    expect(reportingDateKey(new Date("2026-11-15T17:30:00Z"))).toBe("2026-11-16");
  });
});

describe("This City male and female from TANAW's estimate", () => {
  const sexedDay = (business_date: string, unique_count: number, male_count: number | null, female_count: number | null) => ({
    ...day(business_date, unique_count),
    male_count,
    female_count,
  });
  const sexed = {
    entries: null,
    exits: null,
    peak: null,
    unique: 20,
    counting: { days: [sexedDay("2026-11-01", 10, 4, 6), sexedDay("2026-11-02", 10, null, null), sexedDay("2026-11-03", 5, 9, 9)] },
  } as unknown as Metrics;

  it("splits This City and deducts the operator's entries sex by sex", () => {
    const origins: DailyOrigins = { "2026-11-01": { otherCity: { male: 1, female: 2 }, otherProvince: { male: 0, female: 0 }, foreign: { male: 1, female: 0 } } };
    const [first, second, third] = reportDays("November 2026", sexed, origins, "2026-11-16");
    expect([first.systemMale, first.systemFemale, first.thisCity, first.thisCityMale, first.thisCityFemale]).toEqual([4, 6, 6, 2, 4]);
    // No estimate, or an estimate that does not split the counted visitors, gives a total only.
    expect([second.thisCityMale, second.thisCityFemale, second.thisCity]).toEqual([null, null, 10]);
    expect([third.systemMale, third.thisCityMale]).toEqual([null, null]);
  });

  it("keeps This City's total when the operator enters more of one sex than TANAW estimated", () => {
    const origins: DailyOrigins = { "2026-11-01": { otherCity: { male: 6, female: 0 }, otherProvince: { male: 0, female: 0 }, foreign: { male: 0, female: 0 } } };
    const [first] = reportDays("November 2026", sexed, origins, "2026-11-16");
    expect([first.thisCity, first.thisCityMale, first.thisCityFemale]).toEqual([4, 0, 4]);
  });

  it("derives monthly totals with estimated days split and the rest unspecified", () => {
    const origins: DailyOrigins = {
      "2026-11-01": { otherCity: { male: 1, female: 0 }, otherProvince: { male: 0, female: 0 }, foreign: { male: 0, female: 0 } },
    };
    const demo = monthlyDemoFromDays(reportDays("November 2026", sexed, origins, "2026-11-16"));
    expect(demo).toMatchObject({ thisCityMale: "3", thisCityFemale: "6", thisCityUnspecified: "15", thisProvMale: "4", thisProvFemale: "6", thisProvUnspecified: "15" });
  });

  it("leaves This City male and female blank in months without any estimate", () => {
    const demo = monthlyDemoFromDays(reportDays("November 2026", metrics, {}, "2026-11-16"));
    expect([demo.thisCityMale, demo.thisCityFemale, demo.thisCityUnspecified]).toEqual(["", "", "17"]);
  });
});

describe("origins confirmed by sample preparation after a report loaded", () => {
  const day = (otherCity: number) => ({ otherCity: { male: otherCity, female: 0 }, otherProvince: { male: 0, female: 0 }, foreign: { male: 0, female: 0 } });

  it("adds the stored days and keeps the days already shown", () => {
    const shown: DailyOrigins = { "2026-07-02": day(1) };
    const stored: DailyOrigins = { "2026-07-01": day(5), "2026-07-02": day(9) };

    expect(mergeMissingOriginDays(shown, stored)).toEqual({ "2026-07-01": day(5), "2026-07-02": day(1) });
  });

  it("returns the shown origins unchanged when nothing is new, so nothing is saved again", () => {
    const shown: DailyOrigins = { "2026-07-01": day(2) };

    expect(mergeMissingOriginDays(shown, { "2026-07-01": day(7) })).toBe(shown);
  });
});
