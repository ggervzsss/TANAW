import { formatMediumDate, formatShortDate } from "@/features/reports/model/reportStatuses";
import type { FinalReport, SystemLog } from "@/shared/types";
import type { ReportMonthEntry } from "./enterpriseReports";
import { SUBMIT_LOG_ACTION } from "./enterpriseReports";
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

type DatedEvent = Omit<ReportLogEvent, "tone"> & { at: number };

function formatTime(date: Date) {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/** "Nov 6, 9:14 AM" */
export function formatLogTime(date: Date) {
  return `${formatShortDate(date)}, ${formatTime(date)}`;
}

function remarksOf(log: SystemLog) {
  const remarks = log.metadata?.remarks;
  return typeof remarks === "string" && remarks.trim() ? remarks.trim() : null;
}

function reviewEvent(log: SystemLog, at: Date): DatedEvent | null {
  const base = { id: log.id, at: at.getTime(), when: formatLogTime(at) };
  const remarks = remarksOf(log);
  if (log.action === "Report Ready to Consolidate") {
    return { ...base, title: "Review completed", detail: `${log.actor} marked it ready for the city summary.${remarks ? ` ${remarks}` : ""}` };
  }
  if (log.action === "Report Returned") {
    return { ...base, title: "Returned for correction", detail: remarks ? `${log.actor}: ${remarks}` : `${log.actor} sent it back to the enterprise for correction.` };
  }
  if (log.action === "Report Consolidated") {
    return { ...base, title: "Added to city summary", detail: `${log.actor} marked it consolidated.` };
  }
  if (log.action === "Report Pending Review") {
    return { ...base, title: "Waiting for review", detail: `${log.actor} moved it back to waiting for review.` };
  }
  return null;
}

/**
 * The report log for one enterprise month, newest first. Every event comes from a record: the report's
 * own sent time, activity log entries for the report (submissions and staff review decisions), and the
 * city summaries that include it. A month without a report shows its due date instead.
 */
export function buildReportLog(entry: ReportMonthEntry, enterpriseName: string, logs: readonly SystemLog[], finalReports: readonly FinalReport[]): ReportLogEvent[] {
  const report = entry.report;
  if (!report) {
    if (entry.submission === "Missing") {
      return [{ id: `${entry.key}-due`, title: "Due date passed", when: formatShortDate(entry.dueAt), detail: `No report was received by ${formatMediumDate(entry.dueAt)}.`, tone: "missing" }];
    }
    return [{ id: `${entry.key}-due`, title: "Not sent yet", when: `Due ${formatShortDate(entry.dueAt)}`, detail: `The report is due ${formatMediumDate(entry.dueAt)}.`, tone: "pending" }];
  }

  const code = report.code;
  const events: DatedEvent[] = [];
  const reportLogs = logs.filter((log) => log.sourceId === report.id);
  const submissions = reportLogs
    .filter((log) => log.action === SUBMIT_LOG_ACTION)
    .map((log) => ({ log, at: parseTimestamp(log.timestamp) }))
    .filter((item): item is { log: SystemLog; at: Date } => item.at !== null)
    .sort((left, right) => left.at.getTime() - right.at.getTime());

  if (submissions.length > 0) {
    submissions.forEach(({ log, at }, index) => {
      events.push({
        id: log.id,
        at: at.getTime(),
        when: formatLogTime(at),
        title: index === 0 ? "Report submitted" : "Report resubmitted",
        detail: `${log.actor} sent ${code}.`,
      });
    });
  } else if (entry.sentAt) {
    events.push({ id: `${report.id}-sent`, at: entry.sentAt.getTime(), when: formatLogTime(entry.sentAt), title: "Report submitted", detail: `${enterpriseName} sent ${code}.` });
  }

  for (const log of reportLogs) {
    const at = parseTimestamp(log.timestamp);
    const event = at ? reviewEvent(log, at) : null;
    if (event) events.push(event);
  }

  for (const summary of finalReports) {
    if (!summary.sources.some((source) => source.id === report.id)) continue;
    const at = parseCalendarDate(summary.generatedOn);
    if (!at) continue;
    events.push({
      id: `${summary.id}-${report.id}`,
      // A summary has a date only; place it after anything else logged that day.
      at: at.getTime() + 86_399_999,
      when: formatShortDate(at),
      title: "Added to city summary",
      detail: `Included in ${summary.id}, prepared by ${summary.preparedBy}.`,
    });
  }

  return events
    .sort((left, right) => right.at - left.at)
    .map((event, index) => ({ id: event.id, title: event.title, when: event.when, detail: event.detail, tone: index === 0 ? "submitted" : "earlier" }));
}
