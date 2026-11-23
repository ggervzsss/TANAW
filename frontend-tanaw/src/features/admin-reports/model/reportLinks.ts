import { routes } from "@/app/routers/routes";
import { monthName, parseMonthParams, type MonthKey } from "./reportMonths";

/*
 * Enterprise Reports deep links. `/admin/reports?enterprise=<enterpriseId>&month=October&year=2026`
 * opens that enterprise's report details on October 2026, and the page shows that reporting month.
 * `month` and `year` without `enterprise` only choose the reporting month.
 */
export const REPORT_LINK_PARAMS = { enterprise: "enterprise", month: "month", year: "year" } as const;

/** The link that opens one enterprise's report details, optionally on a given month. */
export function adminEnterpriseReportPath(enterpriseId: string, month?: MonthKey | null) {
  const params = new URLSearchParams({ [REPORT_LINK_PARAMS.enterprise]: enterpriseId });
  if (month) {
    params.set(REPORT_LINK_PARAMS.month, monthName(month));
    params.set(REPORT_LINK_PARAMS.year, String(month.year));
  }
  return `${routes.admin.reports}?${params.toString()}`;
}

export type ReportLinkState = { enterpriseId: string | null; month: MonthKey | null };

export function readReportLink(params: URLSearchParams): ReportLinkState {
  const enterpriseId = params.get(REPORT_LINK_PARAMS.enterprise)?.trim() || null;
  return { enterpriseId, month: parseMonthParams(params.get(REPORT_LINK_PARAMS.month), params.get(REPORT_LINK_PARAMS.year)) };
}

/** A copy of `params` with the report details open for `enterpriseId` on `month`. */
export function withReportOpen(params: URLSearchParams, enterpriseId: string, month: MonthKey) {
  const next = new URLSearchParams(params);
  next.set(REPORT_LINK_PARAMS.enterprise, enterpriseId);
  next.set(REPORT_LINK_PARAMS.month, monthName(month));
  next.set(REPORT_LINK_PARAMS.year, String(month.year));
  return next;
}

/** A copy of `params` showing `month` as the reporting month. */
export function withReportMonth(params: URLSearchParams, month: MonthKey) {
  const next = new URLSearchParams(params);
  next.set(REPORT_LINK_PARAMS.month, monthName(month));
  next.set(REPORT_LINK_PARAMS.year, String(month.year));
  return next;
}

/** A copy of `params` with the report details closed. The month stays so the page keeps showing it. */
export function withReportClosed(params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.delete(REPORT_LINK_PARAMS.enterprise);
  return next;
}
