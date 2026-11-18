import { PHILIPPINE_TIME_ZONE, type SystemTimeFormat } from "../../../utils/date-time";
import type { Note } from "./facts";
import type { Language, PeriodKey } from "./types";

/**
 * All reply wording, in English and Tagalog. Keep terms consistent with the dashboard:
 * "visitors" / "bisita", "entries" / "pumasok", "exits" / "lumabas",
 * "people inside" / "tao sa loob". Native speakers should review Tagalog changes.
 */

export function formatNumber(value: number) {
  return value.toLocaleString("en-PH");
}

/** "2:00–3:00 PM", "11:00 AM–12:00 PM" or, in 24-hour format, "14:00–15:00". */
export function formatHourRange(hour: number, timeFormat: SystemTimeFormat) {
  const next = (hour + 1) % 24;
  if (timeFormat === "24-hour") return `${String(hour).padStart(2, "0")}:00–${String(next).padStart(2, "0")}:00`;
  const label = (value: number) => `${value % 12 === 0 ? 12 : value % 12}:00`;
  const meridiem = (value: number) => (value < 12 ? "AM" : "PM");
  return meridiem(hour) === meridiem(next) ? `${label(hour)}–${label(next)} ${meridiem(next)}` : `${label(hour)} ${meridiem(hour)}–${label(next)} ${meridiem(next)}`;
}

/** A business date such as "2026-11-18" as "Wed, Nov 18". */
export function formatBusinessDate(date: string) {
  const at = new Date(`${date}T12:00:00+08:00`);
  if (Number.isNaN(at.getTime())) return date;
  return at.toLocaleDateString("en-PH", { timeZone: PHILIPPINE_TIME_ZONE, weekday: "short", month: "short", day: "numeric" });
}

export function formatClock(now: Date, timeFormat: SystemTimeFormat) {
  return now.toLocaleTimeString("en-PH", { timeZone: PHILIPPINE_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: timeFormat !== "24-hour" });
}

export function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function percentChange(percent: number) {
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

export type Phrases = {
  /** Used inside sentences: "today", "in the past 7 days". */
  periodIn: Record<PeriodKey, string>;
  /** Used as a name: "today", "the past 7 days". */
  periodName: Record<PeriodKey, string>;
  /** Shown in the "Based on" line. */
  periodLabel: Record<PeriodKey, string>;
  /** The equal-length period before: "yesterday", "the previous 7 days". */
  previousName: Record<PeriodKey, string>;
  basis: (label: string, clock: string) => string;
  rightNow: string;
  latestReport: string;
  notes: (note: Note) => string;
  inProgress: string;
  noData: (period: PeriodKey) => string;
  loadFailed: string;
  visitors: {
    unique: (count: number, period: PeriodKey) => string;
    entriesOnly: (entries: number, period: PeriodKey) => string;
    unavailable: (period: PeriodKey) => string;
    movement: (entries: number, exits: number) => string;
    dailyBasis: string;
    partialIdentification: string;
  };
  busiest: {
    hour: (period: PeriodKey, hourRange: string, peak: number | null, arrivals: number) => string;
    hourAcrossDays: (period: PeriodKey, hourRange: string, peak: number | null, arrivals: number) => string;
    peakOnly: (period: PeriodKey, peak: number) => string;
    day: (period: PeriodKey, date: string, visitors: number | null, peak: number | null) => string;
    busiestTime: (hourRange: string) => string;
    busiestDay: (date: string, visitors: number | null) => string;
    dayPeak: (peak: number) => string;
  };
  occupancy: {
    now: (count: number) => string;
    unavailable: string;
    todayPeak: (peak: number) => string;
  };
  movement: {
    counts: (period: PeriodKey, entries: number, exits: number) => string;
    unavailable: (period: PeriodKey) => string;
    returns: (count: number) => string;
    entriesVsVisitors: string;
    partial: string;
  };
  sex: {
    split: (period: PeriodKey, male: number, female: number) => string;
    caveat: string;
    partial: (period: PeriodKey) => string;
    unavailable: (period: PeriodKey) => string;
    none: (period: PeriodKey) => string;
  };
  compare: {
    change: (period: PeriodKey, current: number, previous: number, difference: number, percent: number | null) => string;
    noPrevious: (period: PeriodKey) => string;
    noEstimate: (period: PeriodKey) => string;
    short: (period: PeriodKey, difference: number, percent: number | null) => string;
  };
  report: {
    none: string;
    latest: (period: string, unique: number, status: string) => string;
    counts: (entries: number | null, exits: number | null, peak: number | null) => string | null;
    submitted: (date: string) => string;
    open: string;
  };
  coverage: {
    observed: (period: PeriodKey, percent: string, ongoing: boolean) => string;
    unresolved: (count: number) => string;
    offline: (count: number) => string;
    general: string;
  };
  summary: {
    insideNow: (count: number) => string;
    sexShare: (malePercent: number, femalePercent: number) => string;
  };
  help: { text: string; topics: string[] };
  greeting: { hello: string; thanks: string };
  unknown: string;
};

const en: Phrases = {
  periodIn: { today: "today", yesterday: "yesterday", week: "in the past 7 days", month: "in the past 30 days" },
  periodName: { today: "today", yesterday: "yesterday", week: "the past 7 days", month: "the past 30 days" },
  periodLabel: { today: "Today", yesterday: "Yesterday", week: "Past 7 days", month: "Past 30 days" },
  previousName: { today: "yesterday", yesterday: "the day before", week: "the previous 7 days", month: "the previous 30 days" },
  basis: (label, clock) => `${label} · as of ${clock}`,
  rightNow: "Right now",
  latestReport: "Latest saved report",
  notes: (note) => {
    switch (note.key) {
      case "partial":
        return "These figures are partial estimates: some visitors could not be recognized or some days have no records.";
      case "low_coverage":
        return `Cameras observed only ${note.percent}% of this period, so actual numbers may be higher.`;
      case "cameras_offline":
        return "Some cameras are offline. Figures include only the cameras that are running.";
      case "hourly_partial":
        return "Hourly details are kept for 30 days, so older days are not part of the busiest time.";
      case "hourly_unavailable":
        return "Hourly activity is not available for this period.";
    }
  },
  inProgress: "Today is not over yet, so these numbers can still change.",
  noData: (period) => `No counts were recorded for ${en.periodName[period]}. Start your cameras in Camera Setup to collect activity.`,
  loadFailed: "I can't read your counts right now. Check that the TANAW counting service is running, then ask again.",
  visitors: {
    unique: (count, period) => `TANAW recorded about ${formatNumber(count)} ${count === 1 ? "visitor" : "visitors"} ${en.periodIn[period]}.`,
    entriesOnly: (entries, period) =>
      `Visitors could not be recognized ${en.periodIn[period]}, so there is no visitor estimate. The doors recorded ${formatNumber(entries)} ${entries === 1 ? "entry" : "entries"}.`,
    unavailable: (period) => `Visitor numbers are not available for ${en.periodName[period]}.`,
    movement: (entries, exits) => `Entries: ${formatNumber(entries)} · Exits: ${formatNumber(exits)}`,
    dailyBasis: "Each person counts once per day. Several days add the daily estimates together.",
    partialIdentification: "Some people could not be recognized, so the visitor number is an estimate.",
  },
  busiest: {
    hour: (period, hourRange, peak, arrivals) =>
      peak != null
        ? `The busiest time ${en.periodIn[period]} was ${hourRange}, with up to ${formatNumber(peak)} ${peak === 1 ? "person" : "people"} inside at once.${arrivals > 0 ? ` ${formatNumber(arrivals)} arrived during that hour.` : ""}`
        : `The busiest time ${en.periodIn[period]} was ${hourRange}, when ${formatNumber(arrivals)} ${arrivals === 1 ? "person" : "people"} arrived.`,
    hourAcrossDays: (period, hourRange, peak, arrivals) =>
      peak != null
        ? `${capitalize(en.periodIn[period])}, the busiest time of day was ${hourRange}, with up to ${formatNumber(peak)} ${peak === 1 ? "person" : "people"} inside at once.${arrivals > 0 ? ` ${formatNumber(arrivals)} arrived in that hour across those days.` : ""}`
        : `${capitalize(en.periodIn[period])}, the busiest time of day was ${hourRange}, when ${formatNumber(arrivals)} ${arrivals === 1 ? "person" : "people"} arrived across those days.`,
    peakOnly: (period, peak) => `I don't have hourly activity for ${en.periodName[period]}, but the most people inside at once was ${formatNumber(peak)}.`,
    day: (period, date, visitors, peak) =>
      visitors != null
        ? `${date} was the busiest day ${en.periodIn[period]}, with about ${formatNumber(visitors)} ${visitors === 1 ? "visitor" : "visitors"}.`
        : `${date} was the busiest day ${en.periodIn[period]}, with up to ${formatNumber(peak ?? 0)} ${peak === 1 ? "person" : "people"} inside at once.`,
    busiestTime: (hourRange) => `Busiest time of day: ${hourRange}`,
    busiestDay: (date, visitors) => (visitors != null ? `Busiest day: ${date} (${formatNumber(visitors)} ${visitors === 1 ? "visitor" : "visitors"})` : `Busiest day: ${date}`),
    dayPeak: (peak) => `Most people inside at once that day: ${formatNumber(peak)}`,
  },
  occupancy: {
    now: (count) => `About ${formatNumber(count)} ${count === 1 ? "person is" : "people are"} inside right now.`,
    unavailable: "I can't tell how many people are inside right now because no cameras are counting.",
    todayPeak: (peak) => `Most people inside at once today: ${formatNumber(peak)}`,
  },
  movement: {
    counts: (period, entries, exits) =>
      `${capitalize(en.periodIn[period])}, cameras recorded ${formatNumber(entries)} ${entries === 1 ? "entry" : "entries"} and ${formatNumber(exits)} ${exits === 1 ? "exit" : "exits"}.`,
    unavailable: (period) => `Entries and exits were not measured ${en.periodIn[period]}. An Entry / Exit camera counts doorway movement.`,
    returns: (count) => `Returning entries (people who came back in): ${formatNumber(count)}`,
    entriesVsVisitors: "Entries can be higher than visitors because one person may come in more than once.",
    partial: "Entries and exits were measured for only part of this period.",
  },
  sex: {
    split: (period, male, female) => {
      const total = male + female;
      return `Of about ${formatNumber(total)} ${total === 1 ? "visitor" : "visitors"} ${en.periodIn[period]}, an estimated ${formatNumber(male)} were male (${Math.round((male / total) * 100)}%) and ${formatNumber(female)} were female (${Math.round((female / total) * 100)}%).`;
    },
    caveat: "These are estimates from appearance and may not match how visitors identify.",
    partial: (period) => `The male/female split is available for only some days ${en.periodIn[period]}, so there is no total for the whole period.`,
    unavailable: (period) => `The male/female split is not available for ${en.periodName[period]}.`,
    none: (period) => `No visitors were recognized ${en.periodIn[period]}, so there is no male/female split.`,
  },
  compare: {
    change: (period, current, previous, difference, percent) => {
      const subject = `${capitalize(en.periodName[period])} had about ${formatNumber(current)} ${current === 1 ? "visitor" : "visitors"}`;
      const before = en.previousName[period];
      if (previous === 0) return `${subject}; ${before} had none.`;
      if (difference === 0) return `${subject}, the same as ${before}.`;
      const amount = formatNumber(Math.abs(difference));
      return difference > 0 ? `${subject}, ${amount} more than ${before} (${percent}% higher).` : `${subject}, ${amount} fewer than ${before} (${Math.abs(percent ?? 0)}% lower).`;
    },
    noPrevious: (period) => `There are no counts for ${en.previousName[period]} to compare with.`,
    noEstimate: (period) => `I can't compare ${en.periodName[period]} with ${en.previousName[period]} because one of them has no visitor estimate.`,
    short: (period, difference, percent) =>
      difference === 0
        ? `Compared with ${en.previousName[period]}: no change`
        : `Compared with ${en.previousName[period]}: ${signed(difference)} ${Math.abs(difference) === 1 ? "visitor" : "visitors"}${percent != null ? ` (${percentChange(percent)})` : ""}`,
  },
  report: {
    none: "There are no saved reports yet. Open Reports to prepare the current reporting period.",
    latest: (period, unique, status) =>
      `Your latest saved report covers ${period}. It records about ${formatNumber(unique)} unique ${unique === 1 ? "visitor" : "visitors"}, and its status is ${status}.`,
    counts: (entries, exits, peak) => {
      const parts = [
        entries != null ? `Entries: ${formatNumber(entries)}` : null,
        exits != null ? `Exits: ${formatNumber(exits)}` : null,
        peak != null ? `Most people inside at once: ${formatNumber(peak)}` : null,
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    },
    submitted: (date) => `Saved on ${date}`,
    open: "Open Recent Reports or View All to see the full report.",
  },
  coverage: {
    observed: (period, percent, ongoing) => `Cameras observed ${percent}% of ${en.periodName[period]}${ongoing ? " so far" : ""}.`,
    unresolved: (count) => `${formatNumber(count)} ${count === 1 ? "sighting" : "sightings"} could not be matched to a visitor, so visitor numbers are estimates.`,
    offline: (count) => `Cameras offline right now: ${formatNumber(count)}`,
    general: "Counts are estimates from what cameras can see. People outside camera views are not counted.",
  },
  summary: {
    insideNow: (count) => `Inside right now: ${formatNumber(count)}`,
    sexShare: (male, female) => `Male / female: ${male}% / ${female}%`,
  },
  help: {
    text: "I answer questions using this computer's visitor counts. You can ask about:",
    topics: [
      "Visitors today, yesterday, or in the past 7 or 30 days",
      "The busiest time or day",
      "People inside right now",
      "Entries and exits",
      "Male and female estimates",
      "Changes from the previous period",
      "Your latest saved report",
      "How complete the counts are",
    ],
  },
  greeting: {
    hello: "Hello! Ask me about your visitors, your busiest times, or your latest report.",
    thanks: "You're welcome! Ask me anything else about your visitor counts.",
  },
  unknown: "I can't answer that yet. I can tell you about visitor numbers, busiest times, people inside, entries and exits, and your latest report. Try one of these:",
};

const tl: Phrases = {
  periodIn: { today: "ngayong araw", yesterday: "kahapon", week: "nitong nakaraang 7 araw", month: "nitong nakaraang 30 araw" },
  periodName: { today: "ngayong araw", yesterday: "kahapon", week: "nakaraang 7 araw", month: "nakaraang 30 araw" },
  periodLabel: { today: "Ngayong araw", yesterday: "Kahapon", week: "Nakaraang 7 araw", month: "Nakaraang 30 araw" },
  previousName: { today: "kahapon", yesterday: "naunang araw", week: "naunang 7 araw", month: "naunang 30 araw" },
  basis: (label, clock) => `${label} · datos hanggang ${clock}`,
  rightNow: "Ngayon",
  latestReport: "Huling naka-save na report",
  notes: (note) => {
    switch (note.key) {
      case "partial":
        return "Tantiya pa lang at hindi kumpleto ang mga bilang na ito: may mga bisitang hindi nakilala o may mga araw na walang tala.";
      case "low_coverage":
        return `${note.percent}% lang ng panahong ito ang nasubaybayan ng mga camera, kaya maaaring mas mataas ang aktwal na bilang.`;
      case "cameras_offline":
        return "May mga camera na offline. Kasama lang sa bilang ang mga camera na gumagana.";
      case "hourly_partial":
        return "30 araw lang itinatago ang datos kada oras, kaya hindi kasama ang mas lumang araw sa pinaka-busy na oras.";
      case "hourly_unavailable":
        return "Walang datos kada oras para sa panahong ito.";
    }
  },
  inProgress: "Hindi pa tapos ang araw, kaya maaari pang magbago ang mga bilang.",
  noData: (period) => `Walang naitalang bilang ${tl.periodIn[period]}. Simulan ang mga camera sa Camera Setup para makapagtala.`,
  loadFailed: "Hindi ko mabasa ang mga bilang ngayon. Tiyaking tumatakbo ang TANAW counting service, saka magtanong ulit.",
  visitors: {
    unique: (count, period) => `${capitalize(tl.periodIn[period])}, tinatayang ${formatNumber(count)} bisita ang naitala ng TANAW.`,
    entriesOnly: (entries, period) => `Hindi nakilala ang mga bisita ${tl.periodIn[period]}, kaya walang tinatayang bilang ng bisita. Ayon sa mga pinto, ${formatNumber(entries)} ang pumasok.`,
    unavailable: (period) => `Walang bilang ng bisita ${tl.periodIn[period]}.`,
    movement: (entries, exits) => `Pumasok: ${formatNumber(entries)} · Lumabas: ${formatNumber(exits)}`,
    dailyBasis: "Isang beses lang binibilang ang bawat tao kada araw. Kapag ilang araw, pinagsasama ang bilang ng bawat araw.",
    partialIdentification: "May mga taong hindi nakilala, kaya tantiya ang bilang ng bisita.",
  },
  busiest: {
    hour: (period, hourRange, peak, arrivals) =>
      peak != null
        ? `Pinaka-busy ${tl.periodIn[period]} bandang ${hourRange}, na may hanggang ${formatNumber(peak)} tao sa loob nang sabay-sabay.${arrivals > 0 ? ` ${formatNumber(arrivals)} ang dumating sa oras na iyon.` : ""}`
        : `Pinaka-busy ${tl.periodIn[period]} bandang ${hourRange}, nang ${formatNumber(arrivals)} ang dumating.`,
    hourAcrossDays: (period, hourRange, peak, arrivals) =>
      peak != null
        ? `${capitalize(tl.periodIn[period])}, pinaka-busy tuwing ${hourRange}, na may hanggang ${formatNumber(peak)} tao sa loob nang sabay-sabay.${arrivals > 0 ? ` Sa kabuuan ng mga araw na iyon, ${formatNumber(arrivals)} ang dumating sa oras na ito.` : ""}`
        : `${capitalize(tl.periodIn[period])}, pinaka-busy tuwing ${hourRange}, nang ${formatNumber(arrivals)} ang dumating sa kabuuan ng mga araw na iyon.`,
    peakOnly: (period, peak) => `Walang datos kada oras ${tl.periodIn[period]}, pero ang pinakamaraming tao sa loob nang sabay-sabay ay ${formatNumber(peak)}.`,
    day: (period, date, visitors, peak) =>
      visitors != null
        ? `Ang ${date} ang pinaka-busy na araw ${tl.periodIn[period]}, na may tinatayang ${formatNumber(visitors)} bisita.`
        : `Ang ${date} ang pinaka-busy na araw ${tl.periodIn[period]}, na may hanggang ${formatNumber(peak ?? 0)} tao sa loob nang sabay-sabay.`,
    busiestTime: (hourRange) => `Pinaka-busy na oras: ${hourRange}`,
    busiestDay: (date, visitors) => (visitors != null ? `Pinaka-busy na araw: ${date} (${formatNumber(visitors)} bisita)` : `Pinaka-busy na araw: ${date}`),
    dayPeak: (peak) => `Pinakamaraming tao sa loob nang sabay-sabay noong araw na iyon: ${formatNumber(peak)}`,
  },
  occupancy: {
    now: (count) => `Tinatayang ${formatNumber(count)} tao ang nasa loob ngayon.`,
    unavailable: "Hindi ko masabi kung ilan ang nasa loob ngayon dahil walang camera na nagbibilang.",
    todayPeak: (peak) => `Pinakamaraming tao sa loob nang sabay-sabay ngayong araw: ${formatNumber(peak)}`,
  },
  movement: {
    counts: (period, entries, exits) => `${capitalize(tl.periodIn[period])}, ${formatNumber(entries)} ang pumasok at ${formatNumber(exits)} ang lumabas ayon sa mga camera.`,
    unavailable: (period) => `Hindi nasukat ang pumasok at lumabas ${tl.periodIn[period]}. Ang Entry / Exit camera ang nagbibilang ng galaw sa pinto.`,
    returns: (count) => `Bumalik at pumasok ulit: ${formatNumber(count)}`,
    entriesVsVisitors: "Maaaring mas marami ang pumasok kaysa sa bisita dahil puwedeng pumasok nang ilang beses ang isang tao.",
    partial: "Bahagi lang ng panahong ito ang nasukat para sa pumasok at lumabas.",
  },
  sex: {
    split: (period, male, female) => {
      const total = male + female;
      return `Sa tinatayang ${formatNumber(total)} bisita ${tl.periodIn[period]}, mga ${formatNumber(male)} ang lalaki (${Math.round((male / total) * 100)}%) at ${formatNumber(female)} ang babae (${Math.round((female / total) * 100)}%).`;
    },
    caveat: "Tantiya ito batay sa itsura at maaaring hindi tugma sa pagkakakilanlan ng bisita.",
    partial: (period) => `May hati ng lalaki at babae para lang sa ilang araw ${tl.periodIn[period]}, kaya walang kabuuan para sa buong panahon.`,
    unavailable: (period) => `Walang hati ng lalaki at babae ${tl.periodIn[period]}.`,
    none: (period) => `Walang nakilalang bisita ${tl.periodIn[period]}, kaya walang hati ng lalaki at babae.`,
  },
  compare: {
    change: (period, current, previous, difference, percent) => {
      const subject = `${capitalize(tl.periodIn[period])}, tinatayang ${formatNumber(current)} ang bisita`;
      const before = tl.previousName[period];
      if (previous === 0) return `${subject}; walang naitala sa ${before}.`;
      if (difference === 0) return `${subject}, kapareho ng ${before}.`;
      const amount = formatNumber(Math.abs(difference));
      return difference > 0
        ? `${subject}, mas marami nang ${amount} kaysa sa ${before} (${percent}% na pagtaas).`
        : `${subject}, mas kaunti nang ${amount} kaysa sa ${before} (${Math.abs(percent ?? 0)}% na pagbaba).`;
    },
    noPrevious: (period) => `Walang naitalang bilang sa ${tl.previousName[period]} na maihahambing.`,
    noEstimate: (period) => `Hindi ko maikumpara ang ${tl.periodName[period]} at ang ${tl.previousName[period]} dahil walang tinatayang bisita ang isa sa mga ito.`,
    short: (period, difference, percent) =>
      difference === 0
        ? `Kumpara sa ${tl.previousName[period]}: walang pagbabago`
        : `Kumpara sa ${tl.previousName[period]}: ${signed(difference)} bisita${percent != null ? ` (${percentChange(percent)})` : ""}`,
  },
  report: {
    none: "Wala pang naka-save na report. Buksan ang Reports para ihanda ang kasalukuyang reporting period.",
    latest: (period, unique, status) => `Ang huling naka-save na report ay para sa ${period}. Tinatayang ${formatNumber(unique)} na natatanging bisita ang nakatala, at ang status nito ay ${status}.`,
    counts: (entries, exits, peak) => {
      const parts = [
        entries != null ? `Pumasok: ${formatNumber(entries)}` : null,
        exits != null ? `Lumabas: ${formatNumber(exits)}` : null,
        peak != null ? `Pinakamaraming tao sa loob nang sabay-sabay: ${formatNumber(peak)}` : null,
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    },
    submitted: (date) => `Na-save noong ${date}`,
    open: "Buksan ang Recent Reports o View All para makita ang buong report.",
  },
  coverage: {
    observed: (period, percent, ongoing) => `Nasubaybayan ng mga camera ang ${percent}% ng ${tl.periodName[period]}${ongoing ? " hanggang ngayon" : ""}.`,
    unresolved: (count) => `${formatNumber(count)} na obserbasyon ang hindi naitugma sa isang bisita, kaya tantiya ang bilang ng bisita.`,
    offline: (count) => `Mga camera na offline ngayon: ${formatNumber(count)}`,
    general: "Tantiya ang mga bilang batay sa nakikita ng mga camera. Hindi nabibilang ang mga taong wala sa view ng camera.",
  },
  summary: {
    insideNow: (count) => `Nasa loob ngayon: ${formatNumber(count)}`,
    sexShare: (male, female) => `Lalaki / babae: ${male}% / ${female}%`,
  },
  help: {
    text: "Sumasagot ako gamit ang mga bilang ng bisita sa computer na ito. Maaari mong itanong ang:",
    topics: [
      "Bilang ng bisita ngayong araw, kahapon, o nitong nakaraang 7 o 30 araw",
      "Pinaka-busy na oras o araw",
      "Ilan ang nasa loob ngayon",
      "Ilan ang pumasok at lumabas",
      "Tantiya ng lalaki at babae",
      "Paghahambing sa naunang panahon",
      "Ang huling naka-save na report",
      "Gaano kakumpleto ang mga bilang",
    ],
  },
  greeting: {
    hello: "Kumusta! Magtanong tungkol sa mga bisita, sa pinaka-busy na oras, o sa huling report.",
    thanks: "Walang anuman! Magtanong lang ulit tungkol sa mga bilang ng bisita.",
  },
  unknown: "Hindi ko pa ito masagot. Masasabi ko ang bilang ng bisita, ang pinaka-busy na oras, ilan ang nasa loob, ilan ang pumasok at lumabas, at ang huling report. Subukan ang isa sa mga ito:",
};

export const PHRASES: Record<Language, Phrases> = { en, tl };
