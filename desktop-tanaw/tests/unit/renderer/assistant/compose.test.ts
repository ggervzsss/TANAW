import { describe, expect, it } from "vitest";
import { compose } from "../../../../src/features/dashboard/assistant/compose";
import { formatHourRange } from "../../../../src/features/dashboard/assistant/phrases";
import type { ReportRecord } from "../../../../src/types/enterprise";
import { CONTEXT, data, day, hourly, live, plan, summary } from "./fixtures";

const WEEK = { from_at: "2026-11-11T16:00:00+00:00", to_at: "2026-11-18T16:00:00+00:00" };
const weekDays = [
  day("2026-11-15", { unique_count: 80, peak_occupancy: 30 }),
  day("2026-11-16", { unique_count: 210, peak_occupancy: 64 }),
  day("2026-11-18", { unique_count: 132, peak_occupancy: 48 }),
];
const busyAfternoon = hourly({ 9: { entries: 10, peak_occupancy: 12 }, 14: { entries: 25, area_visits: 5, peak_occupancy: 48 }, 15: { entries: 40, peak_occupancy: 48 } });

describe("composing replies", () => {
  it("answers visitor questions in English and Tagalog with a dated basis", () => {
    const english = compose(plan("visitors"), data(), CONTEXT);
    expect(english.text).toBe("TANAW recorded about 132 visitors today.");
    expect(english.details).toEqual(["Entries: 150 · Exits: 120"]);
    expect(english.notes).toEqual([]);
    expect(english.basis).toMatch(/^Today · as of 3:42\s?PM$/i);
    const tagalog = compose(plan("visitors", "today", { language: "tl" }), data(), CONTEXT);
    expect(tagalog.text).toBe("Ngayong araw, tinatayang 132 bisita ang naitala ng TANAW.");
    expect(tagalog.details).toEqual(["Pumasok: 150 · Lumabas: 120"]);
    expect(tagalog.basis).toMatch(/^Ngayong araw · datos hanggang 3:42\s?PM$/i);
  });

  it("falls back to doorway entries when visitors were not recognized", () => {
    const reply = compose(plan("visitors"), data({ summary: summary({ identification_state: "unavailable" }) }), CONTEXT);
    expect(reply.text).toBe("Visitors could not be recognized today, so there is no visitor estimate. The doors recorded 150 entries.");
  });

  it("explains multi-day totals", () => {
    const reply = compose(plan("visitors", "week"), data({ summary: summary({ ...WEEK, days: weekDays, unique_count: 422 }) }), CONTEXT);
    expect(reply.text).toBe("TANAW recorded about 422 visitors in the past 7 days.");
    expect(reply.details).toContain("Each person counts once per day. Several days add the daily estimates together.");
  });

  it("names the busiest hour of a day from occupancy, with arrivals breaking ties", () => {
    const reply = compose(plan("busiest"), data({ hourly: busyAfternoon }), CONTEXT);
    expect(reply.text).toBe("The busiest time today was 3:00–4:00 PM, with up to 48 people inside at once. 40 arrived during that hour.");
    const tagalog = compose(plan("busiest", "today", { language: "tl" }), data({ hourly: busyAfternoon }), CONTEXT);
    expect(tagalog.text).toBe("Pinaka-busy ngayong araw bandang 3:00–4:00 PM, na may hanggang 48 tao sa loob nang sabay-sabay. 40 ang dumating sa oras na iyon.");
  });

  it("uses arrivals when occupancy was not recorded, and the 24-hour clock when chosen", () => {
    const arrivals = hourly({ 10: { entries: 3 }, 11: { area_visits: 7 } });
    const reply = compose(plan("busiest"), data({ hourly: arrivals }), { ...CONTEXT, timeFormat: "24-hour" });
    expect(reply.text).toBe("The busiest time today was 11:00–12:00, when 7 people arrived.");
  });

  it("falls back to the day's peak when hourly activity is unavailable", () => {
    for (const unavailable of [null, hourly({}, { state: "unavailable" })]) {
      const reply = compose(plan("busiest"), data({ hourly: unavailable }), CONTEXT);
      expect(reply.text).toBe("I don't have hourly activity for today, but the most people inside at once was 48.");
    }
  });

  it("names the busiest day of a longer period with its busiest time", () => {
    const reply = compose(plan("busiest", "week"), data({ summary: summary({ ...WEEK, days: weekDays }), hourly: busyAfternoon }), CONTEXT);
    expect(reply.text).toBe("Mon, Nov 16 was the busiest day in the past 7 days, with about 210 visitors.");
    expect(reply.details).toEqual(["Most people inside at once that day: 64", "Busiest time of day: 3:00–4:00 PM"]);
    const tagalog = compose(plan("busiest", "week", { language: "tl" }), data({ summary: summary({ ...WEEK, days: weekDays }), hourly: busyAfternoon }), CONTEXT);
    expect(tagalog.text).toBe("Ang Mon, Nov 16 ang pinaka-busy na araw nitong nakaraang 7 araw, na may tinatayang 210 bisita.");
  });

  it("answers a busiest-hour question about a longer period by hour of day", () => {
    const reply = compose(plan("busiest", "week", { granularity: "hour" }), data({ summary: summary({ ...WEEK, days: weekDays }), hourly: busyAfternoon }), CONTEXT);
    expect(reply.text).toBe("In the past 7 days, the busiest time of day was 3:00–4:00 PM, with up to 48 people inside at once. 40 arrived in that hour across those days.");
    expect(reply.details).toEqual(["Busiest day: Mon, Nov 16 (210 visitors)"]);
  });

  it("warns when hourly details are older than the retention window", () => {
    const reply = compose(plan("busiest", "month", { granularity: "hour" }), data({ summary: summary({ ...WEEK, days: weekDays }), hourly: { ...busyAfternoon, state: "partial" } }), CONTEXT);
    expect(reply.notes).toContain("Hourly details are kept for 30 days, so older days are not part of the busiest time.");
  });

  it("compares with the previous period in both directions", () => {
    const previous = summary({ from_at: "2026-11-16T16:00:00+00:00", to_at: "2026-11-17T16:00:00+00:00", unique_count: 110 });
    const up = compose(plan("compare"), data({ previous }), CONTEXT);
    expect(up.text).toBe("Today had about 132 visitors, 22 more than yesterday (20% higher).");
    expect(up.notes).toContain("Today is not over yet, so these numbers can still change.");
    const down = compose(plan("compare", "today", { language: "tl" }), data({ previous: { ...previous, unique_count: 165 } }), CONTEXT);
    expect(down.text).toBe("Ngayong araw, tinatayang 132 ang bisita, mas kaunti nang 33 kaysa sa kahapon (20% na pagbaba).");
    expect(compose(plan("compare"), data({ previous: { ...previous, unique_count: 132 } }), CONTEXT).text).toBe("Today had about 132 visitors, the same as yesterday.");
    expect(compose(plan("compare"), data({ previous: { ...previous, unique_count: 0 } }), CONTEXT).text).toBe("Today had about 132 visitors; yesterday had none.");
    expect(compose(plan("compare", "yesterday"), data({ previous }), CONTEXT).notes).toEqual([]);
  });

  it("says when there is nothing to compare with", () => {
    expect(compose(plan("compare"), data({ previous: null }), CONTEXT).text).toBe("There are no counts for yesterday to compare with.");
    expect(compose(plan("compare"), data({ previous: summary({ reconciliation_state: "not_collected" }) }), CONTEXT).text).toBe("There are no counts for yesterday to compare with.");
    expect(compose(plan("compare"), data({ previous: summary({ identification_state: "unavailable" }) }), CONTEXT).text).toBe(
      "I can't compare today with yesterday because one of them has no visitor estimate.",
    );
  });

  it("gives the male and female split only when it was estimated", () => {
    const estimated = summary({ male_count: 60, female_count: 72, sex_estimation_state: "estimated" });
    expect(compose(plan("sex"), data({ summary: estimated }), CONTEXT).text).toBe("Of about 132 visitors today, an estimated 60 were male (45%) and 72 were female (55%).");
    expect(compose(plan("sex", "today", { language: "tl" }), data({ summary: estimated }), CONTEXT).text).toBe("Sa tinatayang 132 bisita ngayong araw, mga 60 ang lalaki (45%) at 72 ang babae (55%).");
    expect(compose(plan("sex"), data({ summary: summary({ sex_estimation_state: "partial" }) }), CONTEXT).text).toMatch(/only some days/);
    expect(compose(plan("sex"), data(), CONTEXT).text).toBe("The male/female split is not available for today.");
  });

  it("reports entries and exits, or says they were not measured", () => {
    const reply = compose(plan("movement"), data({ summary: summary({ repeat_entry_count: 4 }) }), CONTEXT);
    expect(reply.text).toBe("Today, cameras recorded 150 entries and 120 exits.");
    expect(reply.details[0]).toBe("Returning entries (people who came back in): 4");
    expect(compose(plan("movement", "today", { language: "tl" }), data(), CONTEXT).text).toBe("Ngayong araw, 150 ang pumasok at 120 ang lumabas ayon sa mga camera.");
    expect(compose(plan("movement"), data({ summary: summary({ movement_state: "unavailable" }) }), CONTEXT).text).toMatch(/^Entries and exits were not measured today/);
  });

  it("answers how many people are inside now", () => {
    const reply = compose(plan("occupancy_now"), data({ live: live({ occupancy: 1 }) }), CONTEXT);
    expect(reply.text).toBe("About 1 person is inside right now.");
    expect(reply.details).toEqual(["Most people inside at once today: 48"]);
    expect(reply.basis).toMatch(/^Right now · as of/);
    expect(compose(plan("occupancy_now"), data({ live: live({ occupancy: null, state: "unavailable" }) }), CONTEXT).text).toMatch(/no cameras are counting/);
  });

  it("summarizes the latest saved report", () => {
    const report: ReportRecord = { id: "REP-1", date: "2026-07-29", period: "July 2026", status: "Submitted", entries: 60, exits: 50, peak: 18, unique: 40, submittedAt: "2026-07-29T08:00:00Z" };
    const reply = compose(plan("report"), data({ report }), CONTEXT);
    expect(reply.text).toBe("Your latest saved report covers July 2026. It records about 40 unique visitors, and its status is Submitted.");
    expect(reply.details).toEqual(["Entries: 60 · Exits: 50 · Most people inside at once: 18", "Saved on Jul 29, 2026", "Open Recent Reports or View All to see the full report."]);
    expect(reply.basis).toBe("Latest saved report");
    expect(compose(plan("report"), data({ report: null }), CONTEXT).text).toMatch(/^There are no saved reports yet/);
  });

  it("explains coverage as the dashboard does, measured up to now", () => {
    const tiny = summary({ covered_ms: 60_000 });
    const reply = compose(plan("coverage"), data({ summary: tiny, live: live({ missing_camera_ids: [2] }) }), CONTEXT);
    expect(reply.text).toBe("Cameras observed <1% of today so far.");
    expect(reply.details).toContain("Cameras offline right now: 1");
    expect(compose(plan("coverage", "yesterday"), data({ summary: summary({ covered_ms: 43_200_000, from_at: "2026-11-16T16:00:00+00:00", to_at: "2026-11-17T16:00:00+00:00" }) }), CONTEXT).text).toBe(
      "Cameras observed 50% of yesterday.",
    );
  });

  it("adds caveats for partial estimates, low coverage and offline cameras", () => {
    const reply = compose(plan("visitors"), data({ summary: summary({ reconciliation_state: "partial", covered_ms: 3_600_000 }), live: live({ state: "partial" }) }), CONTEXT);
    expect(reply.notes).toEqual([
      "These figures are partial estimates: some visitors could not be recognized or some days have no records.",
      "Cameras observed only 6% of this period, so actual numbers may be higher.",
      "Some cameras are offline. Figures include only the cameras that are running.",
    ]);
  });

  it("does not call a morning low coverage when cameras ran all morning", () => {
    expect(compose(plan("visitors"), data(), CONTEXT).notes).toEqual([]);
  });

  it("gives an overview with several insights", () => {
    const previous = summary({ from_at: "2026-11-16T16:00:00+00:00", to_at: "2026-11-17T16:00:00+00:00", unique_count: 110 });
    const reply = compose(plan("summary"), data({ summary: summary({ male_count: 60, female_count: 72, sex_estimation_state: "estimated" }), previous, hourly: busyAfternoon, live: live() }), CONTEXT);
    expect(reply.text).toBe("TANAW recorded about 132 visitors today.");
    expect(reply.details).toEqual([
      "Compared with yesterday: +22 visitors (+20%)",
      "Busiest time of day: 3:00–4:00 PM",
      "Inside right now: 12",
      "Male / female: 45% / 55%",
      "Entries: 150 · Exits: 120",
    ]);
  });

  it("says when an overview period did not change", () => {
    const previous = summary({ from_at: "2026-11-16T16:00:00+00:00", to_at: "2026-11-17T16:00:00+00:00" });
    expect(compose(plan("summary"), data({ previous }), CONTEXT).details[0]).toBe("Compared with yesterday: no change");
    expect(compose(plan("summary", "today", { language: "tl" }), data({ previous }), CONTEXT).details[0]).toBe("Kumpara sa kahapon: walang pagbabago");
  });

  it("says when nothing was recorded or the counts cannot be read", () => {
    expect(compose(plan("visitors"), data({ summary: summary({ reconciliation_state: "not_collected" }) }), CONTEXT).text).toBe(
      "No counts were recorded for today. Start your cameras in Camera Setup to collect activity.",
    );
    expect(compose(plan("visitors", "today", { language: "tl" }), data({ summary: null }), CONTEXT).text).toBe(
      "Walang naitalang bilang ngayong araw. Simulan ang mga camera sa Camera Setup para makapagtala.",
    );
    expect(compose(plan("busiest"), data({ failed: true }), CONTEXT).text).toMatch(/^I can't read your counts right now/);
  });

  it("offers suggestions for help, greetings and questions it cannot answer", () => {
    expect(compose(plan("help"), data(), CONTEXT)).toMatchObject({ suggest: true, basis: null });
    expect(compose(plan("help"), data(), CONTEXT).details).toHaveLength(8);
    expect(compose(plan("greeting", "today", { question: "Hello" }), data(), CONTEXT)).toMatchObject({ text: expect.stringMatching(/^Hello!/), suggest: true });
    expect(compose(plan("greeting", "today", { question: "Salamat po", language: "tl" }), data(), CONTEXT)).toMatchObject({ text: expect.stringMatching(/^Walang anuman!/), suggest: false });
    expect(compose(plan("unknown"), data(), CONTEXT)).toMatchObject({ text: expect.stringMatching(/^I can't answer that yet/), suggest: true });
  });

  it("formats hour ranges across noon and midnight", () => {
    expect(formatHourRange(11, "12-hour")).toBe("11:00 AM–12:00 PM");
    expect(formatHourRange(23, "12-hour")).toBe("11:00 PM–12:00 AM");
    expect(formatHourRange(0, "12-hour")).toBe("12:00–1:00 AM");
    expect(formatHourRange(23, "24-hour")).toBe("23:00–00:00");
  });
});
