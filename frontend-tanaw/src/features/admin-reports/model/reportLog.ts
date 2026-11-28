import { formatMediumDate, formatShortDate, reportSentAt, reportVersion } from "@/features/reports/model/reportStatuses";
import type { FinalReport, IntakeReport, SystemLog } from "@/shared/types";
import type { ReportMonthEntry } from "./enterpriseReports";
import { RETURN_LOG_ACTION, SUBMIT_LOG_ACTION } from "./enterpriseReports";
import { parseCalendarDate, parseTimestamp } from "./reportMonths";

/** The colour of an event's timeline dot. */
export type ReportLogTone = "submitted" | "pending" | "missing" | "earlier";

export type ReportLogEvent = {
  id: string;
  title: string;
  /** "Nov 6, 9:14 AM", "Nov 21" or "Due Dec 10". */
  when: string;
  detail: string;
  tone: ReportLogTone;
};

type DatedEvent = Omit<ReportLogEvent, "tone"> & { at: number; returned?: boolean };

function formatTime(date: Date) {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/** "Nov 6, 9:14 AM" */
export function formatLogTime(date: Date) {
  return `${formatShortDate(date)}, ${formatTime(date)}`;
}

function metadataText(log: SystemLog, key: string) {
  const value = log.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function remarksOf(log: SystemLog) {
  return metadataText(log, "remarks");
}

function reviewEvent(log: SystemLog, at: Date): DatedEvent | null {
  const base = { id: log.id, at: at.getTime(), when: formatLogTime(at) };
  const remarks = remarksOf(log);
  if (log.action === "Report Ready to Consolidate") {
    return { ...base, title: "Review completed", detail: `${log.actor} marked it ready for the city summary.${remarks ? ` ${remarks}` : ""}` };
  }
  if (log.action === "Report Consolidated") {
    return { ...base, title: "Added to city summary", detail: `${log.actor} marked it consolidated.` };
  }
  if (log.action === "Report Pending Review") {
    return { ...base, title: "Waiting for review", detail: `${log.actor} moved it back to waiting for review.` };
  }
  return null;
}

/** One version's submission: its earliest logged submission, or else its own sent time. */
function submissionEvent(version: IntakeReport, versionLogs: readonly SystemLog[], enterpriseName: string): DatedEvent | null {
  const corrected = reportVersion(version) > 1;
  const title = corrected ? "Corrected report submitted" : "Report submitted";
  const sent = corrected ? `${version.code} (version ${reportVersion(version)})` : version.code;
  // An enterprise sends each version once, so the earliest logged submission is the only one.
  const logged = versionLogs
    .filter((log) => log.action === SUBMIT_LOG_ACTION)
    .map((log) => ({ log, at: parseTimestamp(log.timestamp) }))
    .filter((item): item is { log: SystemLog; at: Date } => item.at !== null)
    .sort((left, right) => left.at.getTime() - right.at.getTime())[0];
  if (logged) return { id: logged.log.id, at: logged.at.getTime(), when: formatLogTime(logged.at), title, detail: `${logged.log.actor} sent ${sent}.` };
  const sentAt = reportSentAt(version);
  return sentAt ? { id: `${version.id}-sent`, at: sentAt.getTime(), when: formatLogTime(sentAt), title, detail: `${enterpriseName} sent ${sent}.` } : null;
}

/** A version's return for correction: its logged return, or else what the report itself records. */
function returnEvent(version: IntakeReport, versionLogs: readonly SystemLog[]): DatedEvent | null {
  const log = versionLogs.find((item) => item.action === RETURN_LOG_ACTION && parseTimestamp(item.timestamp));
  const at = log ? parseTimestamp(log.timestamp) : parseTimestamp(version.returnedAt);
  if (!at || (!log && version.status !== "Returned")) return null;
  const actor = log?.actor || version.returnedBy?.trim() || "Staff";
  const reason = (log && metadataText(log, "reason")) ?? version.returnedReason?.trim();
  return {
    id: log?.id ?? `${version.id}-returned`,
    at: at.getTime(),
    when: formatLogTime(at),
    title: "Returned for correction",
    detail: reason ? `${actor} returned ${version.code}: ${reason}` : `${actor} returned ${version.code}.`,
    returned: true,
  };
}

/**
 * The report log for one enterprise month, newest first, across every version of its report. Every
 * event comes from a record: each version's own sent time, activity log entries for it (submissions,
 * staff review decisions and returns for correction), and the city summaries that include it. A
 * month without a report shows its due date instead.
 */
export function buildReportLog(entry: ReportMonthEntry, enterpriseName: string, logs: readonly SystemLog[], finalReports: readonly FinalReport[]): ReportLogEvent[] {
  const report = entry.report;
  if (!report) {
    if (entry.submission === "Missing") {
      return [{ id: `${entry.key}-due`, title: "Due date passed", when: formatShortDate(entry.dueAt), detail: `No report was received by ${formatMediumDate(entry.dueAt)}.`, tone: "missing" }];
    }
    return [{ id: `${entry.key}-due`, title: "Not sent yet", when: `Due ${formatShortDate(entry.dueAt)}`, detail: `The report is due ${formatMediumDate(entry.dueAt)}.`, tone: "pending" }];
  }

  const versions = entry.versions.length ? entry.versions : [report];
  const events: DatedEvent[] = [];
  for (const version of versions) {
    const versionLogs = logs.filter((log) => log.sourceId === version.id);
    const submitted = submissionEvent(version, versionLogs, enterpriseName);
    if (submitted) events.push(submitted);
    const returned = returnEvent(version, versionLogs);
    if (returned) events.push(returned);
    for (const log of versionLogs) {
      const at = parseTimestamp(log.timestamp);
      const event = at ? reviewEvent(log, at) : null;
      if (event) events.push(event);
    }
  }

  const versionIds = new Set(versions.map((version) => version.id));
  for (const summary of finalReports) {
    const source = summary.sources.find((item) => versionIds.has(item.id));
    if (!source) continue;
    const at = parseCalendarDate(summary.generatedOn);
    if (!at) continue;
    events.push({
      id: `${summary.id}-${source.id}`,
      // A summary has a date only; place it after anything else logged that day.
      at: at.getTime() + 86_399_999,
      when: formatShortDate(at),
      title: "Added to city summary",
      detail: `Included in ${summary.id}, prepared by ${summary.preparedBy}.`,
    });
  }

  return events
    .sort((left, right) => right.at - left.at)
    .map((event, index) => ({ id: event.id, title: event.title, when: event.when, detail: event.detail, tone: index > 0 ? "earlier" : event.returned ? "pending" : "submitted" }));
}
