import { busiestDay, busiestHour, coveragePercent, elapsedCoverage, hasObservations, hourlyNotes, sexSplit, summaryNotes, visitorChange, visitorTotal, type Note } from "./facts";
import { tokenize } from "./normalize";
import { formatBusinessDate, formatClock, formatHourRange, PHRASES, type Phrases } from "./phrases";
import { isSingleDay } from "./periods";
import type { AssistantData, ComposeContext, Plan, Reply } from "./types";
import type { EstablishmentSummary } from "../../camera/services/establishment.types";
import { reportingStatus } from "../../reports/model/report-status";

type Draft = { text: string; details?: string[]; notes?: Note[]; extraNotes?: string[]; basis?: "period" | "now" | "report" | null; suggest?: boolean };

function finish(plan: Plan, context: ComposeContext, phrases: Phrases, draft: Draft): Reply {
  const clock = formatClock(context.now, context.timeFormat);
  const label = draft.basis === "now" ? phrases.rightNow : draft.basis === "report" ? phrases.latestReport : draft.basis === "period" ? phrases.periodLabel[plan.period] : null;
  const notes = [...new Map((draft.notes ?? []).map((note) => [note.key, phrases.notes(note)])).values(), ...(draft.extraNotes ?? [])];
  return {
    language: plan.language,
    text: draft.text,
    details: draft.details ?? [],
    notes,
    basis: label ? (draft.basis === "report" ? label : phrases.basis(label, clock)) : null,
    suggest: draft.suggest ?? false,
  };
}

function visitorsDraft(plan: Plan, summary: EstablishmentSummary, phrases: Phrases): Draft {
  const total = visitorTotal(summary);
  const details: string[] = [];
  if (summary.movement_state !== "unavailable") details.push(phrases.visitors.movement(summary.entries, summary.exits));
  if (total?.kind === "unique" && total.partial) details.push(phrases.visitors.partialIdentification);
  if (!isSingleDay(plan.period) && total?.kind === "unique") details.push(phrases.visitors.dailyBasis);
  const text =
    total?.kind === "unique"
      ? phrases.visitors.unique(total.value, plan.period)
      : total?.kind === "entries"
        ? phrases.visitors.entriesOnly(total.value, plan.period)
        : phrases.visitors.unavailable(plan.period);
  return { text, details, basis: "period" };
}

function busiestDraft(plan: Plan, data: AssistantData, summary: EstablishmentSummary, phrases: Phrases, context: ComposeContext): Draft {
  const hour = busiestHour(data.hourly);
  const hourRange = hour ? formatHourRange(hour.hour, context.timeFormat) : null;
  const hourCaveats = hour ? hourlyNotes(data.hourly) : [];
  if (isSingleDay(plan.period)) {
    if (hour && hourRange) return { text: phrases.busiest.hour(plan.period, hourRange, hour.peak, hour.arrivals), notes: hourCaveats, basis: "period" };
    if (summary.peak_occupancy != null && summary.peak_occupancy > 0) return { text: phrases.busiest.peakOnly(plan.period, summary.peak_occupancy), basis: "period" };
    return { text: phrases.noData(plan.period), basis: "period" };
  }
  const day = busiestDay(summary);
  const dayDate = day ? formatBusinessDate(day.date) : null;
  if (plan.granularity === "hour" && hour && hourRange) {
    const details = day && dayDate ? [phrases.busiest.busiestDay(dayDate, day.visitors)] : [];
    return { text: phrases.busiest.hourAcrossDays(plan.period, hourRange, hour.peak, hour.arrivals), details, notes: hourCaveats, basis: "period" };
  }
  if (day && dayDate) {
    const details: string[] = [];
    if (day.visitors != null && day.peak != null && day.peak > 0) details.push(phrases.busiest.dayPeak(day.peak));
    if (hourRange) details.push(phrases.busiest.busiestTime(hourRange));
    const notes = plan.granularity === "hour" ? hourlyNotes(data.hourly) : hourCaveats;
    return { text: phrases.busiest.day(plan.period, dayDate, day.visitors, day.peak), details, notes, basis: "period" };
  }
  if (hour && hourRange) return { text: phrases.busiest.hourAcrossDays(plan.period, hourRange, hour.peak, hour.arrivals), notes: hourCaveats, basis: "period" };
  return { text: phrases.noData(plan.period), basis: "period" };
}

function compareDraft(plan: Plan, data: AssistantData, summary: EstablishmentSummary, phrases: Phrases): Draft {
  const extraNotes = plan.period !== "yesterday" ? [phrases.inProgress] : [];
  if (!data.previous || !hasObservations(data.previous)) return { text: phrases.compare.noPrevious(plan.period), basis: "period" };
  const change = visitorChange(summary, data.previous);
  if (!change) return { text: phrases.compare.noEstimate(plan.period), basis: "period" };
  return { text: phrases.compare.change(plan.period, change.current, change.previous, change.difference, change.percent), extraNotes, basis: "period" };
}

function sexDraft(plan: Plan, summary: EstablishmentSummary, phrases: Phrases): Draft {
  const split = sexSplit(summary);
  if (split.state === "estimated") {
    if (split.male + split.female === 0) return { text: phrases.sex.none(plan.period), basis: "period" };
    return { text: phrases.sex.split(plan.period, split.male, split.female), details: [phrases.sex.caveat], basis: "period" };
  }
  return { text: split.state === "partial" ? phrases.sex.partial(plan.period) : phrases.sex.unavailable(plan.period), basis: "period" };
}

function movementDraft(plan: Plan, summary: EstablishmentSummary, phrases: Phrases): Draft {
  if (summary.movement_state === "unavailable") return { text: phrases.movement.unavailable(plan.period), basis: "period" };
  const details: string[] = [];
  if (summary.repeat_entry_count > 0) details.push(phrases.movement.returns(summary.repeat_entry_count));
  details.push(phrases.movement.entriesVsVisitors);
  if (summary.movement_state === "partial") details.push(phrases.movement.partial);
  return { text: phrases.movement.counts(plan.period, summary.entries, summary.exits), details, basis: "period" };
}

function coverageDraft(plan: Plan, data: AssistantData, summary: EstablishmentSummary, phrases: Phrases, context: ComposeContext): Draft {
  const ongoing = plan.period !== "yesterday";
  const details: string[] = [];
  if (summary.unresolved_observations > 0) details.push(phrases.coverage.unresolved(summary.unresolved_observations));
  const offline = data.live?.missing_camera_ids?.length ?? 0;
  if (offline > 0) details.push(phrases.coverage.offline(offline));
  details.push(phrases.coverage.general);
  const notes = summaryNotes(summary, data.live, context.now).filter((note) => note.key !== "low_coverage" && note.key !== "cameras_offline");
  return { text: phrases.coverage.observed(plan.period, coveragePercent(elapsedCoverage(summary, context.now)), ongoing), details, notes, basis: "period" };
}

function summaryDraft(plan: Plan, data: AssistantData, summary: EstablishmentSummary, phrases: Phrases, context: ComposeContext): Draft {
  const base = visitorsDraft(plan, summary, phrases);
  const details: string[] = [];
  const change = visitorChange(summary, data.previous);
  if (change) details.push(phrases.compare.short(plan.period, change.difference, change.percent));
  const hour = busiestHour(data.hourly);
  if (!isSingleDay(plan.period)) {
    const day = busiestDay(summary);
    if (day) details.push(phrases.busiest.busiestDay(formatBusinessDate(day.date), day.visitors));
  }
  if (hour) details.push(phrases.busiest.busiestTime(formatHourRange(hour.hour, context.timeFormat)));
  if (data.live?.occupancy != null && plan.period !== "yesterday") details.push(phrases.summary.insideNow(data.live.occupancy));
  const split = sexSplit(summary);
  if (split.state === "estimated" && split.male + split.female > 0) {
    const male = Math.round((split.male / (split.male + split.female)) * 100);
    details.push(phrases.summary.sexShare(male, 100 - male));
  }
  details.push(...(base.details ?? []).filter((item) => item !== phrases.visitors.dailyBasis));
  return { text: base.text, details, notes: hour ? hourlyNotes(data.hourly).filter((note) => note.key === "hourly_partial") : [], basis: "period" };
}

function occupancyDraft(data: AssistantData, phrases: Phrases): Draft {
  const live = data.live;
  if (!live || live.occupancy == null) return { text: phrases.occupancy.unavailable, basis: "now" };
  const details: string[] = [];
  const peak = data.summary?.peak_occupancy;
  if (peak != null && peak > 0) details.push(phrases.occupancy.todayPeak(peak));
  return { text: phrases.occupancy.now(live.occupancy), details, basis: "now" };
}

function reportDraft(data: AssistantData, phrases: Phrases, context: ComposeContext): Draft {
  const report = data.report;
  if (!report) return { text: phrases.report.none, basis: null };
  const details: string[] = [];
  const counts = phrases.report.counts(report.entries, report.exits ?? null, report.peak ?? null);
  if (counts) details.push(counts);
  if (report.submittedAt) {
    const at = new Date(report.submittedAt);
    if (!Number.isNaN(at.getTime())) details.push(phrases.report.submitted(at.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" })));
  }
  details.push(phrases.report.open);
  // The same four statuses Reports History shows: Pending, Submitted, Missing or Consolidated.
  return { text: phrases.report.latest(report.period ?? report.date, report.unique, reportingStatus("history", report, context.now)), details, basis: "report" };
}

/** Write the reply for ``plan`` from ``data``. Every number comes from ``data``. */
export function compose(plan: Plan, data: AssistantData, context: ComposeContext): Reply {
  const phrases = PHRASES[plan.language];
  const done = (draft: Draft) => finish(plan, context, phrases, draft);
  switch (plan.intent) {
    case "help":
      return done({ text: phrases.help.text, details: phrases.help.topics, suggest: true });
    case "greeting": {
      const words = tokenize(plan.question);
      const thanks = words.some((word) => word === "thanks" || word === "salamat") || plan.question.toLowerCase().includes("thank you");
      return done({ text: thanks ? phrases.greeting.thanks : phrases.greeting.hello, suggest: !thanks });
    }
    case "unknown":
      return done({ text: phrases.unknown, suggest: true });
    case "report":
      return done(reportDraft(data, phrases, context));
    default:
      break;
  }
  if (data.failed) return done({ text: phrases.loadFailed, suggest: false });
  if (plan.intent === "occupancy_now") return done(occupancyDraft(data, phrases));
  const summary = data.summary;
  if (!hasObservations(summary)) return done({ text: phrases.noData(plan.period), basis: "period" });
  const notes = summaryNotes(summary, data.live, context.now);
  let draft: Draft;
  switch (plan.intent) {
    case "busiest":
      draft = busiestDraft(plan, data, summary, phrases, context);
      break;
    case "compare":
      draft = compareDraft(plan, data, summary, phrases);
      break;
    case "sex":
      draft = sexDraft(plan, summary, phrases);
      break;
    case "movement":
      draft = movementDraft(plan, summary, phrases);
      break;
    case "coverage":
      return done(coverageDraft(plan, data, summary, phrases, context));
    case "summary":
      draft = summaryDraft(plan, data, summary, phrases, context);
      break;
    default:
      draft = visitorsDraft(plan, summary, phrases);
  }
  return done({ ...draft, notes: [...notes, ...(draft.notes ?? [])] });
}
