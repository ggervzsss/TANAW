import { describe, expect, it } from "vitest";
import {
  WEEKDAYS,
  dayBreakNote,
  formatClock,
  formatDayHours,
  formatIsoDay,
  isClosedOn,
  openingStatus,
  philippineMoment,
  type DayHours,
  type OpeningHours,
  type Weekday,
} from "@/features/enterprise-accounts/model/openingHours";

const hoursDay = (day: Weekday, ...periods: Array<[string, string]>): DayHours => ({ day, mode: "hours", periods: periods.map(([open, close]) => ({ open, close })) });

/** Weekdays 8 AM to 12 PM and 1 PM to 5 PM, Saturday 8 AM to 9 PM, closed on Sunday. */
const weekly: OpeningHours = {
  days: WEEKDAYS.map((day) =>
    day === "sunday" ? { day, mode: "closed", periods: [] } : day === "saturday" ? hoursDay(day, ["08:00", "21:00"]) : hoursDay(day, ["08:00", "12:00"], ["13:00", "17:00"]),
  ),
};

/** A moment in Philippine time. 2026-11-23 is a Monday, 2026-11-28 a Saturday, 2026-11-29 a Sunday. */
const at = (isoDate: string, clock: string) => new Date(`${isoDate}T${clock}:00+08:00`);

describe("formatClock", () => {
  it("drops zero minutes in 12-hour time", () => {
    expect(formatClock("08:00")).toBe("8 AM");
    expect(formatClock("12:00")).toBe("12 PM");
    expect(formatClock("13:00")).toBe("1 PM");
    expect(formatClock("00:00")).toBe("12 AM");
    expect(formatClock("24:00")).toBe("12 AM");
  });

  it("keeps minutes that are not zero", () => {
    expect(formatClock("13:30")).toBe("1:30 PM");
    expect(formatClock("09:05")).toBe("9:05 AM");
    expect(formatClock("00:45")).toBe("12:45 AM");
  });

  it("shows two-digit hours and minutes in 24-hour time", () => {
    expect(formatClock("08:00", "24-hour")).toBe("08:00");
    expect(formatClock("13:30", "24-hour")).toBe("13:30");
    expect(formatClock("24:00", "24-hour")).toBe("24:00");
  });
});

describe("formatDayHours", () => {
  it("joins a split day with 'and'", () => {
    expect(formatDayHours(hoursDay("monday", ["08:00", "12:00"], ["13:00", "17:00"]))).toBe("8 AM to 12 PM and 1 PM to 5 PM");
    expect(formatDayHours(hoursDay("monday", ["13:00", "17:00"], ["08:00", "12:00"]))).toBe("8 AM to 12 PM and 1 PM to 5 PM");
    expect(formatDayHours(hoursDay("monday", ["06:00", "09:00"], ["10:00", "12:30"], ["13:30", "17:00"]))).toBe("6 AM to 9 AM, 10 AM to 12:30 PM and 1:30 PM to 5 PM");
  });

  it("follows the time format", () => {
    expect(formatDayHours(hoursDay("monday", ["08:00", "12:00"], ["13:00", "17:30"]), "24-hour")).toBe("08:00 to 12:00 and 13:00 to 17:30");
  });

  it("names closed and all-day days", () => {
    expect(formatDayHours({ day: "sunday", mode: "closed", periods: [] })).toBe("Closed");
    expect(formatDayHours({ day: "sunday", mode: "open24h", periods: [] })).toBe("Open 24 hours");
  });
});

describe("dayBreakNote", () => {
  it("calls a midday break a lunch break", () => {
    expect(dayBreakNote(hoursDay("monday", ["08:00", "12:00"], ["13:00", "17:00"]))).toBe("Lunch break");
    expect(dayBreakNote(hoursDay("monday", ["08:00", "11:30"], ["13:30", "17:00"]))).toBe("Lunch break");
  });

  it("notes other breaks plainly", () => {
    expect(dayBreakNote(hoursDay("monday", ["06:00", "09:00"], ["15:00", "21:00"]))).toBe("Break");
    expect(dayBreakNote(hoursDay("monday", ["06:00", "09:00"], ["10:00", "12:00"], ["13:00", "17:00"]))).toBe("2 breaks");
  });

  it("has no note without a gap", () => {
    expect(dayBreakNote(hoursDay("monday", ["08:00", "17:00"]))).toBeNull();
    expect(dayBreakNote(hoursDay("monday", ["08:00", "12:00"], ["12:00", "17:00"]))).toBeNull();
    expect(dayBreakNote({ day: "sunday", mode: "closed", periods: [] })).toBeNull();
  });
});

describe("philippineMoment", () => {
  it("reads the day and time in Philippine time, whatever the device's zone", () => {
    expect(philippineMoment(new Date("2026-11-22T16:30:00Z"))).toEqual({ date: "2026-11-23", weekday: "monday", minutes: 30 });
    expect(philippineMoment(at("2026-11-29", "23:59"))).toEqual({ date: "2026-11-29", weekday: "sunday", minutes: 23 * 60 + 59 });
  });
});

describe("isClosedOn", () => {
  it("includes both ends of the range", () => {
    const closures = [{ startDate: "2026-12-24", endDate: "2026-12-26" }];
    expect(isClosedOn(closures, "2026-12-23")).toBe(false);
    expect(isClosedOn(closures, "2026-12-24")).toBe(true);
    expect(isClosedOn(closures, "2026-12-26")).toBe(true);
    expect(isClosedOn(closures, "2026-12-27")).toBe(false);
  });
});

describe("formatIsoDay", () => {
  it("leaves out the current year", () => {
    expect(formatIsoDay("2026-12-27", "MMM d, yyyy", "2026")).toBe("Dec 27");
    expect(formatIsoDay("2027-01-04", "MMM d, yyyy", "2026")).toBe("Jan 4, 2027");
    expect(formatIsoDay("2026-12-27", "d MMM yyyy", "2026")).toBe("27 Dec");
    expect(formatIsoDay("2026-12-27", "MM/dd/yyyy", "2026")).toBe("12/27/2026");
    expect(formatIsoDay("2026-12-27", "yyyy-MM-dd", "2026")).toBe("2026-12-27");
  });
});

describe("openingStatus", () => {
  const status = (now: Date, options: { hours?: OpeningHours | null; closures?: Array<{ startDate: string; endDate: string }>; timeFormat?: "12-hour" | "24-hour" } = {}) =>
    openingStatus({ hours: options.hours === undefined ? weekly : options.hours, closures: options.closures ?? [], now, timeFormat: options.timeFormat });

  it("says when an open place closes", () => {
    expect(status(at("2026-11-23", "09:00"))).toEqual({ tone: "open", label: "Open now, until 12 PM" });
    expect(status(at("2026-11-23", "13:00"))).toEqual({ tone: "open", label: "Open now, until 5 PM" });
    expect(status(at("2026-11-28", "10:00"))).toEqual({ tone: "open", label: "Open now, until 9 PM" });
    expect(status(at("2026-11-28", "10:00"), { timeFormat: "24-hour" })).toEqual({ tone: "open", label: "Open now, until 21:00" });
  });

  it("runs periods without a gap together", () => {
    const hours: OpeningHours = { days: WEEKDAYS.map((day) => hoursDay(day, ["08:00", "12:00"], ["12:00", "18:30"])) };
    expect(status(at("2026-11-23", "09:00"), { hours })).toEqual({ tone: "open", label: "Open now, until 6:30 PM" });
  });

  it("says when a closed place opens next", () => {
    expect(status(at("2026-11-23", "07:00"))).toEqual({ tone: "closed", label: "Closed now, opens 8 AM" });
    expect(status(at("2026-11-23", "12:30"))).toEqual({ tone: "closed", label: "Closed now, opens 1 PM" });
    expect(status(at("2026-11-23", "17:00"))).toEqual({ tone: "closed", label: "Closed now, opens tomorrow at 8 AM" });
    // Saturday night: Sunday is closed, so it opens on Monday.
    expect(status(at("2026-11-28", "22:00"))).toEqual({ tone: "closed", label: "Closed now, opens Monday at 8 AM" });
    expect(status(at("2026-11-29", "10:00"))).toEqual({ tone: "closed", label: "Closed now, opens tomorrow at 8 AM" });
  });

  it("shows a place open all day", () => {
    const hours: OpeningHours = { days: WEEKDAYS.map((day) => ({ day, mode: "open24h", periods: [] })) };
    expect(status(at("2026-11-23", "03:00"), { hours })).toEqual({ tone: "open", label: "Open now, all day" });
  });

  it("says when a temporary closure ends", () => {
    const closures = [{ startDate: "2026-11-23", endDate: "2026-11-25" }];
    expect(status(at("2026-11-23", "10:00"), { closures })).toEqual({ tone: "temporarilyClosed", label: "Temporarily closed, opens Thursday at 8 AM" });
    const long = [{ startDate: "2026-11-20", endDate: "2026-12-26" }];
    expect(status(at("2026-11-23", "10:00"), { closures: long })).toEqual({ tone: "temporarilyClosed", label: "Temporarily closed, opens Dec 28 at 8 AM" });
  });

  it("skips closures on the way to the next opening", () => {
    expect(status(at("2026-11-23", "18:00"), { closures: [{ startDate: "2026-11-24", endDate: "2026-11-24" }] })).toEqual({ tone: "closed", label: "Closed now, opens Wednesday at 8 AM" });
  });

  it("has no status without hours, unless a closure covers today", () => {
    expect(status(at("2026-11-23", "10:00"), { hours: null })).toBeNull();
    expect(status(at("2026-11-23", "10:00"), { hours: null, closures: [{ startDate: "2026-11-23", endDate: "2026-11-24" }] })).toEqual({
      tone: "temporarilyClosed",
      label: "Temporarily closed, opens Wednesday",
    });
  });

  it("says only that the place is closed when it never opens", () => {
    const hours: OpeningHours = { days: WEEKDAYS.map((day) => ({ day, mode: "closed", periods: [] })) };
    expect(status(at("2026-11-23", "10:00"), { hours })).toEqual({ tone: "closed", label: "Closed now" });
  });
});
