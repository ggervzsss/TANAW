import { describe, expect, it } from "vitest";
import { defaultOpeningHours, openingHoursKey, savedOpeningHours, setDayHours, type OpeningHours } from "../../../../../src/features/profile/model/opening-hours";

describe("opening hours drafts", () => {
  it("start from the default week when none are saved", () => {
    expect(savedOpeningHours(null)).toEqual(defaultOpeningHours());
    expect(savedOpeningHours(undefined)).toEqual(defaultOpeningHours());
  });

  it("compare by content, whatever order the server sent the days and fields in", () => {
    const local = defaultOpeningHours();
    const fromServer = {
      days: [...local.days].reverse().map((entry) => ({ periods: entry.periods?.map((period) => ({ close: period.close, open: period.open })), mode: entry.mode, day: entry.day })),
    } as OpeningHours;
    expect(openingHoursKey(fromServer)).toBe(openingHoursKey(local));
  });

  it("notice a changed day", () => {
    const local = defaultOpeningHours();
    const closedMonday = setDayHours(local, { day: "monday", mode: "closed", periods: [] });
    expect(openingHoursKey(closedMonday)).not.toBe(openingHoursKey(local));
  });
});
