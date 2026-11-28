import { describe, expect, it } from "vitest";
import { closureMarkedBy, closureState, formatClosureDates, orderClosures } from "@/features/enterprise-accounts/model/closures";

const closure = (id: string, startDate: string, endDate: string) => ({ id, startDate, endDate });

describe("closureState", () => {
  it("places a closure before, during or after today", () => {
    expect(closureState(closure("a", "2026-12-24", "2026-12-26"), "2026-11-28")).toBe("upcoming");
    expect(closureState(closure("a", "2026-11-28", "2026-11-28"), "2026-11-28")).toBe("ongoing");
    expect(closureState(closure("a", "2026-11-20", "2026-11-30"), "2026-11-28")).toBe("ongoing");
    expect(closureState(closure("a", "2026-11-01", "2026-11-27"), "2026-11-28")).toBe("ended");
  });
});

describe("formatClosureDates", () => {
  it("says the year once when both days share it", () => {
    expect(formatClosureDates(closure("a", "2026-12-24", "2026-12-26"))).toBe("Dec 24 to Dec 26, 2026");
    expect(formatClosureDates(closure("a", "2026-12-25", "2026-12-25"))).toBe("Dec 25, 2026");
    expect(formatClosureDates(closure("a", "2026-12-30", "2027-01-02"))).toBe("Dec 30, 2026 to Jan 2, 2027");
  });

  it("follows the system date format", () => {
    expect(formatClosureDates(closure("a", "2026-12-24", "2026-12-26"), "d MMM yyyy")).toBe("24 Dec to 26 Dec 2026");
    expect(formatClosureDates(closure("a", "2026-12-24", "2026-12-26"), "MM/dd/yyyy")).toBe("12/24/2026 to 12/26/2026");
    expect(formatClosureDates(closure("a", "2026-12-24", "2026-12-26"), "yyyy-MM-dd")).toBe("2026-12-24 to 2026-12-26");
  });
});

describe("orderClosures", () => {
  it("lists the current closure, then upcoming ones soonest first, then ended ones latest first", () => {
    const ordered = orderClosures(
      [
        closure("ended-early", "2026-01-01", "2026-01-02"),
        closure("upcoming-late", "2027-01-01", "2027-01-01"),
        closure("ongoing", "2026-11-27", "2026-11-29"),
        closure("ended-late", "2026-11-01", "2026-11-03"),
        closure("upcoming-soon", "2026-12-24", "2026-12-26"),
      ],
      "2026-11-28",
    );
    expect(ordered.map((item) => item.id)).toEqual(["ongoing", "upcoming-soon", "upcoming-late", "ended-late", "ended-early"]);
  });
});

describe("closureMarkedBy", () => {
  it("says a closure the enterprise marked came from the desktop app", () => {
    expect(closureMarkedBy({ createdBy: "City Plaza" }, ["City Plaza", "City Plaza"])).toBe("Marked by City Plaza from the desktop app");
    expect(closureMarkedBy({ createdBy: "city plaza " }, [null, "City Plaza"])).toBe("Marked by city plaza from the desktop app");
  });

  it("names anyone else without a source", () => {
    expect(closureMarkedBy({ createdBy: "Juan Dela Cruz" }, ["City Plaza"])).toBe("Marked by Juan Dela Cruz");
    expect(closureMarkedBy({ createdBy: "  " }, ["City Plaza"])).toBeNull();
  });
});
