import {
  formatShortDate,
  isReturned,
  newerReport,
  reportDueDate,
  reportSentAt,
  reviewStatus,
  submissionNote,
  submissionStatus,
  type ReviewStatus,
  type SubmissionStatus,
} from "@/features/reports/model/reportStatuses";
import type { AccountSummary, FinalReport, IntakeReport, MapEnterprise, ReportEnterprise, SystemLog } from "@/shared/types";
import {
  addMonths,
  minMonth,
  monthKeyId,
  monthName,
  monthOfDate,
  monthOrdinal,
  parseTimestamp,
  periodLabel,
  reportMonthOf,
  type MonthKey,
} from "./reportMonths";

/** One enterprise as the Enterprise Reports page shows it, joined from the report, account and map lists. */
export type EnterpriseReportProfile = {
  id: string;
  name: string;
  barangay: string;
  category: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  /** "6, all monitoring"; null when the map has no camera summary for it. */
  cameras: string | null;
  /** When the enterprise account was created; null when the account list is not available. */
  registeredAt: Date | null;
  /** The first month a report is expected: the registration month, or an earlier month it already reported. */
  firstMonth: MonthKey | null;
};

/** One enterprise's report status for one month, from its latest report version. */
export type ReportMonthEntry = {
  key: string;
  month: MonthKey;
  period: string;
  /** The latest version; a returned one stays here until its corrected version arrives. */
  report: IntakeReport | undefined;
  /** Every version of the month's report, newest first (more than one after a return). */
  versions: readonly IntakeReport[];
  reportCode: string | null;
  sentAt: Date | null;
  dueAt: Date;
  submission: SubmissionStatus;
  submissionNote: string | null;
  review: ReviewStatus;
  reviewedBy: string | null;
};

export type EnterpriseReportRow = { enterprise: EnterpriseReportProfile; entry: ReportMonthEntry };

export type SubmissionFilter = "all" | SubmissionStatus;

export type ReportRowFilters = { query: string; enterpriseId: string; submission: SubmissionFilter };

export const SUBMIT_LOG_ACTION = "Submit Enterprise Report";
export const RETURN_LOG_ACTION = "Return Enterprise Report";
/** Report actions in the activity log that record a staff review decision, by the action name the backend writes. */
export const REVIEW_LOG_ACTIONS = new Set(["Report Ready to Consolidate", "Report Consolidated", RETURN_LOG_ACTION]);

const SUBMISSION_ORDER: Record<SubmissionStatus, number> = { Missing: 0, "Awaiting correction": 1, Pending: 2, Submitted: 3 };

/** "6, all monitoring", "6, 4 monitoring", "None set up", or null without a camera summary. */
export function cameraSummary(enterprise: Pick<MapEnterprise, "cameraMonitoring"> | undefined) {
  const cameras = enterprise?.cameraMonitoring;
  if (!cameras) return null;
  const total = cameras.configuredCameraCount;
  if (total <= 0) return "None set up";
  const monitoring = Math.min(cameras.healthyCameraCount, total);
  if (monitoring === total) return `${total}, all monitoring`;
  return `${total}, ${monitoring === 0 ? "none" : monitoring} monitoring`;
}

function contactName(account: AccountSummary | undefined) {
  if (!account) return null;
  const manager = account.managerName?.trim();
  if (manager) return manager;
  const name = [account.firstName, account.lastName].filter(Boolean).join(" ").trim();
  return name || null;
}

/** Joins the enterprises that send reports with their accounts (contact, registration) and map entries (cameras). */
export function buildEnterpriseProfiles(
  enterprises: readonly ReportEnterprise[],
  accounts: readonly AccountSummary[],
  mapEnterprises: readonly MapEnterprise[],
  reports: readonly IntakeReport[],
): EnterpriseReportProfile[] {
  const accountById = new Map(accounts.filter((account) => account.enterpriseId).map((account) => [account.enterpriseId as string, account]));
  const mapById = new Map(mapEnterprises.map((enterprise) => [enterprise.id, enterprise]));
  const earliestReport = new Map<string, MonthKey>();
  for (const report of reports) {
    const month = reportMonthOf(report);
    if (!month) continue;
    const current = earliestReport.get(report.enterpriseId) ?? null;
    earliestReport.set(report.enterpriseId, minMonth(current, month) as MonthKey);
  }

  return enterprises.map((enterprise) => {
    const account = accountById.get(enterprise.id);
    const registeredAt = parseTimestamp(account?.createdAt);
    return {
      id: enterprise.id,
      name: enterprise.name,
      barangay: enterprise.barangay,
      category: enterprise.category,
      contactPerson: contactName(account),
      email: account?.email ?? null,
      phone: account?.phone?.trim() || null,
      cameras: cameraSummary(mapById.get(enterprise.id)),
      registeredAt,
      firstMonth: minMonth(registeredAt ? monthOfDate(registeredAt) : null, earliestReport.get(enterprise.id) ?? null),
    };
  });
}

/** Whether a report was expected from the enterprise for this month (registered by then, or registration unknown). */
export function isRegisteredBy(profile: Pick<EnterpriseReportProfile, "firstMonth">, month: MonthKey) {
  return !profile.firstMonth || monthOrdinal(profile.firstMonth) <= monthOrdinal(month);
}

/** Each enterprise's report versions per month, newest first. */
export type ReportIndex = Map<string, IntakeReport[]>;

function reportIndexKey(enterpriseId: string, month: MonthKey) {
  return `${enterpriseId}|${monthKeyId(month)}`;
}

/** Newer version first; for the same version, the one sent later. */
function compareNewestFirst(left: IntakeReport, right: IntakeReport) {
  if (left === right) return 0;
  return newerReport(left, right) === right ? 1 : -1;
}

/**
 * Each enterprise's report versions per month, newest first. The first one is the month's report:
 * a corrected version replaces the returned one before it.
 */
export function indexReports(reports: readonly IntakeReport[]): ReportIndex {
  const index: ReportIndex = new Map();
  for (const report of reports) {
    const month = reportMonthOf(report);
    if (!month) continue;
    const key = reportIndexKey(report.enterpriseId, month);
    index.set(key, [...(index.get(key) ?? []), report]);
  }
  for (const versions of index.values()) versions.sort(compareNewestFirst);
  return index;
}

/**
 * Who reviewed each report, by report id: the staff member behind the latest review decision in the
 * activity log, or else whoever prepared the city summary that consolidated it.
 */
export function reviewersByReport(logs: readonly SystemLog[], finalReports: readonly FinalReport[]) {
  const reviewers = new Map<string, { name: string; at: number }>();
  for (const report of finalReports) {
    const at = parseTimestamp(report.generatedOn)?.getTime() ?? 0;
    for (const source of report.sources) {
      const current = reviewers.get(source.id);
      if (!current || at > current.at) reviewers.set(source.id, { name: report.preparedBy, at });
    }
  }
  const fromLogs = new Map<string, { name: string; at: number }>();
  for (const log of logs) {
    if (!log.sourceId || !REVIEW_LOG_ACTIONS.has(log.action)) continue;
    const at = parseTimestamp(log.timestamp)?.getTime() ?? 0;
    const current = fromLogs.get(log.sourceId);
    if (!current || at > current.at) fromLogs.set(log.sourceId, { name: log.actor, at });
  }
  for (const [id, reviewer] of fromLogs) reviewers.set(id, reviewer);
  return new Map([...reviewers].map(([id, reviewer]) => [id, reviewer.name]));
}

export function buildMonthEntry(enterpriseId: string, month: MonthKey, reports: ReportIndex, reviewers: Map<string, string>, today: Date): ReportMonthEntry {
  const versions = reports.get(reportIndexKey(enterpriseId, month)) ?? [];
  const report = versions[0];
  const name = monthName(month);
  // A returned report names who returned it, even before the activity log has loaded.
  const returnedBy = isReturned(report) ? report?.returnedBy?.trim() || null : null;
  return {
    key: monthKeyId(month),
    month,
    period: periodLabel(month),
    report,
    versions,
    reportCode: report?.code ?? null,
    sentAt: report ? reportSentAt(report) : null,
    dueAt: reportDueDate(name, month.year),
    submission: submissionStatus(report, name, month.year, today),
    submissionNote: submissionNote(report, name, month.year, today),
    review: reviewStatus(report),
    reviewedBy: report ? (returnedBy ?? reviewers.get(report.id) ?? null) : null,
  };
}

/** One row per enterprise registered by the month, sorted Missing, Awaiting correction, Pending, then Submitted, then by name. */
export function buildReportRows(
  profiles: readonly EnterpriseReportProfile[],
  reports: ReportIndex,
  reviewers: Map<string, string>,
  month: MonthKey,
  today: Date,
): EnterpriseReportRow[] {
  return profiles
    .filter((profile) => isRegisteredBy(profile, month))
    .map((enterprise) => ({ enterprise, entry: buildMonthEntry(enterprise.id, month, reports, reviewers, today) }))
    .sort((left, right) => SUBMISSION_ORDER[left.entry.submission] - SUBMISSION_ORDER[right.entry.submission] || left.enterprise.name.localeCompare(right.enterprise.name));
}

/** Search matches the enterprise, its barangay, the report ID or the reviewer. */
export function filterReportRows(rows: readonly EnterpriseReportRow[], filters: ReportRowFilters) {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.enterpriseId !== "all" && row.enterprise.id !== filters.enterpriseId) return false;
    if (filters.submission !== "all" && row.entry.submission !== filters.submission) return false;
    if (!query) return true;
    return [row.enterprise.name, row.enterprise.barangay, row.entry.reportCode, row.entry.reviewedBy].some((value) => value?.toLowerCase().includes(query));
  });
}

/** The years the enterprise has been registered, newest first. */
export function historyYears(profile: Pick<EnterpriseReportProfile, "firstMonth">, today: Date) {
  const last = today.getFullYear();
  const first = Math.min(profile.firstMonth?.year ?? last, last);
  return Array.from({ length: last - first + 1 }, (_, index) => last - index);
}

/** The months of a year the enterprise was registered for, up to this month, newest first. */
export function historyMonths(profile: Pick<EnterpriseReportProfile, "firstMonth">, year: number, today: Date): MonthKey[] {
  const yearStart: MonthKey = { year, monthIndex: 0 };
  const start = profile.firstMonth && monthOrdinal(profile.firstMonth) > monthOrdinal(yearStart) ? profile.firstMonth : yearStart;
  const current = monthOfDate(today);
  const yearEnd: MonthKey = { year, monthIndex: 11 };
  const end = monthOrdinal(current) < monthOrdinal(yearEnd) ? current : yearEnd;
  const months: MonthKey[] = [];
  for (let month = end; monthOrdinal(month) >= monthOrdinal(start); month = addMonths(month, -1)) months.push(month);
  return months;
}

export type YearSummary = {
  year: number;
  submitted: number;
  /** Months already due or already sent: submitted, awaiting correction, plus missing. */
  due: number;
  pending: ReportMonthEntry[];
  missing: ReportMonthEntry[];
  /** Months whose report was returned and whose corrected version has not arrived yet. */
  awaitingCorrection: ReportMonthEntry[];
};

export function summarizeYear(year: number, entries: readonly ReportMonthEntry[]): YearSummary {
  const submitted = entries.filter((entry) => entry.submission === "Submitted").length;
  const missing = entries.filter((entry) => entry.submission === "Missing");
  const pending = entries.filter((entry) => entry.submission === "Pending");
  const awaitingCorrection = entries.filter((entry) => entry.submission === "Awaiting correction");
  return { year, submitted, due: submitted + awaitingCorrection.length + missing.length, pending, missing, awaitingCorrection };
}

/** "9 of 10 submitted", or "None due yet" for a year with nothing due. */
export function yearOptionNote(summary: YearSummary) {
  return summary.due === 0 ? "None due yet" : `${summary.submitted} of ${summary.due} submitted`;
}

/** "November, due Dec 10", or "None in 2025". */
export function pendingNote(summary: YearSummary) {
  if (summary.pending.length === 0) return `None in ${summary.year}`;
  return summary.pending.map((entry) => `${monthName(entry.month)}, due ${formatShortDate(entry.dueAt)}`).join("; ");
}

/** "July, August" in month order. */
function monthList(entries: readonly ReportMonthEntry[]) {
  return [...entries]
    .sort((left, right) => monthOrdinal(left.month) - monthOrdinal(right.month))
    .map((entry) => monthName(entry.month))
    .join(", ");
}

/** "July, August", or "None in 2025". */
export function missingNote(summary: YearSummary) {
  return summary.missing.length === 0 ? `None in ${summary.year}` : monthList(summary.missing);
}

/** "October", or "None in 2025". */
export function awaitingCorrectionNote(summary: YearSummary) {
  return summary.awaitingCorrection.length === 0 ? `None in ${summary.year}` : monthList(summary.awaitingCorrection);
}

/** The months shown before "Show all": six, or all when the opened month is further back. */
export const HISTORY_PREVIEW_MONTHS = 6;

export function needsAllMonths(months: readonly MonthKey[], focus: MonthKey | null) {
  if (!focus) return false;
  const position = months.findIndex((month) => month.year === focus.year && month.monthIndex === focus.monthIndex);
  return position >= HISTORY_PREVIEW_MONTHS;
}
