import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { Button, MonthPicker, PortalPageHeader, type PickerMonth } from "@/shared/ui-kit";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import type { IntakeReport } from "@/shared/types";
import { EnterpriseReportDialog } from "../components/EnterpriseReportDialog";
import { ReportActionConfirmDialog } from "../components/ReportActionConfirmDialog";
import { ReturnReportDialog } from "../components/ReturnReportDialog";
import { StaffReportsFilters } from "../components/StaffReportsFilters";
import { StaffReportsTable } from "../components/StaffReportsTable";
import { StaffTableSkeleton, type StaffTableSkeletonColumn } from "../components/StaffTableSkeleton";
import { useStaffReports } from "../hooks/useStaffReports";
import { currentReportingMonth, monthIndexOf } from "../model/reportStatuses";
import { formatReportingMonth, monthKey, parseMonthKey, reportingMonth, reportingMonthOptions, type ReportingMonth } from "../model/reportingMonth";
import {
  EMPTY_STAFF_REPORT_FILTERS,
  filterStaffReportRows,
  generateConfirmMessage,
  hasStaffReportFilters,
  parseStaffReportFilters,
  staffReportFilterParams,
  staffReportsCaption,
  staffReportsSummary,
  type StaffReportFilters,
  type StaffReportRow,
} from "../model/staffReports";

const STATUS_ID = "staff-reports-status";

/** The columns of StaffReportsTable, for its loading rows. */
const STAFF_REPORT_COLUMNS: readonly StaffTableSkeletonColumn[] = [
  { header: "Enterprise", width: "w-3/5" },
  { header: "Report ID", className: "tanaw-hide-sm", width: "w-24", cell: "meta" },
  { header: "Sent", className: "tanaw-hide-sm", width: "w-28", cell: "meta" },
  { header: "Submission", pill: true },
  { header: "Staff review", pill: true },
  { header: <span className="sr-only">Action</span>, width: "w-16" },
];

/**
 * Staff Reports. URL: `?month=2026-10` (the reporting month, default the current one), the filters
 * `&q=&submission=submitted|pending|missing&review=waiting|reviewing|consolidated&barangay=`, and
 * `&report=<intake report id>` for the open report.
 */
function toPickerMonth({ month, year }: ReportingMonth): PickerMonth {
  return { year, monthIndex: monthIndexOf(month) };
}

export function StaffReportsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [today] = useState(() => new Date());
  const current = useMemo(() => currentReportingMonth(today), [today]);
  const monthParam = params.get("month");
  const month = useMemo(() => parseMonthKey(monthParam) ?? current, [current, monthParam]);
  const filters = useMemo(() => parseStaffReportFilters(params), [params]);
  const reportId = params.get("report");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [returning, setReturning] = useState<IntakeReport | null>(null);
  const data = useStaffReports(month, today);
  const { progress } = data;
  const monthLabel = formatReportingMonth(month);
  const openReport = reportId ? data.reports.find((report) => report.id === reportId) : undefined;
  const previousVersion = openReport?.previousVersionId ? data.reports.find((report) => report.id === openReport.previousVersionId) : undefined;
  const visibleRows = filterStaffReportRows(data.rows, filters);
  const filtered = hasStaffReportFilters(filters);
  // Any month from the oldest report up to the newest (at least the current reporting month).
  const knownMonths = reportingMonthOptions(data.reports, current);

  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const closeReport = () => updateParams({ report: null });
  const changeFilters = (patch: Partial<StaffReportFilters>) => updateParams(staffReportFilterParams({ ...filters, ...patch }));
  const clearFilters = () => updateParams(staffReportFilterParams(EMPTY_STAFF_REPORT_FILTERS));
  const canGenerate = progress.canGenerate && !data.isLoading && !data.isError;
  const summary = data.isError ? "Reports could not be loaded." : data.isLoading ? "Loading reports…" : staffReportsSummary(progress, month);

  return (
    <>
      <PortalPageHeader
        title="Reports"
        description={staffReportsCaption(month)}
        actions={
          <div className="tanaw-staff-reports-actions">
            <MonthPicker
              label="Reporting month"
              hideLabel
              value={toPickerMonth(month)}
              onChange={(value) => updateParams({ month: monthKey(reportingMonth(value.monthIndex, value.year)), report: null })}
              min={toPickerMonth(knownMonths[knownMonths.length - 1])}
              max={toPickerMonth(knownMonths[0])}
              highlight={toPickerMonth(current)}
              highlightLabel="Current reporting month"
              className="w-56"
            />
            {/* On a phone, Generate rides in a bar along the foot of the screen once it can be pressed (reports.css). */}
            <div className="tanaw-staff-generate" data-ready={canGenerate || undefined}>
              <Button aria-describedby={STATUS_ID} disabled={!canGenerate} loading={data.generate.isPending} onClick={() => setIsConfirmOpen(true)}>
                Generate consolidated report
              </Button>
            </div>
          </div>
        }
      />

      <StaffReportsFilters rows={data.rows} filters={filters} onChange={changeFilters} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 text-sm">
        <p role="status" className="flex flex-wrap items-center gap-x-3 font-semibold text-(--tanaw-text) tabular-nums">
          {data.isLoading || data.isError ? null : filtered ? `Showing ${visibleRows.length} of ${data.rows.length} enterprises` : `${data.rows.length} ${data.rows.length === 1 ? "enterprise" : "enterprises"}`}
          {filtered && (
            <button type="button" onClick={clearFilters} className="rounded-sm font-semibold text-(--tanaw-accent-ink) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)">
              Clear filters
            </button>
          )}
        </p>
        <p id={STATUS_ID} className="text-(--tanaw-text-secondary)">
          {summary}
          {progress.generated && !data.isLoading && !data.isError && (
            <>
              {" "}
              <Link to={`${routes.staff.consolidatedReports}?year=${month.year}`} className="font-semibold text-(--tanaw-accent-ink) underline-offset-4 hover:underline">
                Open consolidated reports
              </Link>
            </>
          )}
        </p>
      </div>
      <div className="mt-3">
        {data.isLoading ? (
          <StaffTableSkeleton label="Loading reports…" columns={STAFF_REPORT_COLUMNS} subline />
        ) : data.isError ? (
          <p role="alert" className="mt-3.5 text-sm text-(--tanaw-text-secondary)">
            Reports could not be loaded. Refresh the page to try again.
          </p>
        ) : (
          <StaffReportsTable
            rows={visibleRows}
            emptyMessage={data.rows.length ? "No enterprises match these filters. Try another status or barangay, or clear the search." : "No enterprises are registered yet."}
            remindingId={data.remind.isPending ? (data.remind.variables?.enterpriseId ?? null) : null}
            wasReminded={data.wasReminded}
            onOpen={(row: StaffReportRow) => row.report && updateParams({ report: row.report.id })}
            onRemind={(row) => data.remind.mutate(row)}
          />
        )}
      </div>
      <div aria-hidden="true" className="tanaw-staff-generate-spacer" />

      {openReport && (
        <EnterpriseReportDialog
          key={openReport.id}
          report={openReport}
          previousVersion={previousVersion}
          isUpdating={data.accept.isPending}
          onClose={closeReport}
          onAccept={(report) => data.accept.mutate(report, { onSuccess: closeReport })}
          onReturn={(report) => {
            data.returnReport.reset();
            setReturning(report);
          }}
        />
      )}

      {returning && (
        <ReturnReportDialog
          key={returning.id}
          report={returning}
          isPending={data.returnReport.isPending}
          error={data.returnReport.isError ? getApiErrorMessage(data.returnReport.error, "The report could not be returned. Check the connection and try again.") : null}
          onDismissError={() => data.returnReport.reset()}
          onCancel={() => setReturning(null)}
          onSubmit={(reason) =>
            data.returnReport.mutate(
              { report: returning, reason },
              {
                onSuccess: () => {
                  setReturning(null);
                  closeReport();
                },
              },
            )
          }
        />
      )}

      {isConfirmOpen && (
        <ReportActionConfirmDialog
          title="Generate consolidated report?"
          message={generateConfirmMessage(monthLabel, progress)}
          confirmLabel="Generate report"
          pendingLabel="Generating…"
          isPending={data.generate.isPending}
          onCancel={() => setIsConfirmOpen(false)}
          onConfirm={() =>
            data.generate.mutate(undefined, {
              onSuccess: (finalReport) => {
                setIsConfirmOpen(false);
                const year = /\d{4}/.exec(finalReport.period)?.[0] ?? String(month.year);
                navigate(`${routes.staff.consolidatedReports}?year=${year}&report=${encodeURIComponent(finalReport.id)}`);
              },
            })
          }
        />
      )}
    </>
  );
}
