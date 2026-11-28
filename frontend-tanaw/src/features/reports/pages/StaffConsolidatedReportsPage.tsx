import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useOperationalFinalReports } from "@/app/hooks/useOperationalSync";
import type { FinalReport } from "@/shared/types";
import { PortalPageHeader, Select, StatusPill, Tabs, openRowFromClick } from "@/shared/ui-kit";
import { AnnualReportDialog } from "../components/AnnualReportDialog";
import { MonthlyReportDialog } from "../components/MonthlyReportDialog";
import { StaffTableSkeleton, type StaffTableSkeletonColumn } from "../components/StaffTableSkeleton";
import {
  annualReportRows,
  consolidatedReportYears,
  defaultConsolidatedYear,
  draftMonthsNote,
  enterpriseCoverage,
  finalReportStatus,
  formatGeneratedOn,
  monthlyReportsForYear,
  parseConsolidatedTab,
  parseYear,
  type AnnualReportRow,
} from "../model/consolidatedReports";

const EMPTY_REPORTS: FinalReport[] = [];
const formatCount = (value: number | null) => (value === null ? "Not recorded" : value.toLocaleString("en-US"));
const opensReport = <span className="sr-only">Opens the report</span>;

/** The columns of MonthlyTable and AnnualTable, for their loading rows. */
const MONTHLY_COLUMNS: readonly StaffTableSkeletonColumn[] = [
  { header: "Month", width: "w-2/5" },
  { header: "Report ID", className: "tanaw-hide-sm", width: "w-28" },
  { header: "Enterprises", className: "tanaw-num", width: "w-12", cell: "stat", label: "Enterprises" },
  { header: "Visitors", className: "tanaw-num", width: "w-16", cell: "stat", label: "Visitors" },
  { header: "Generated", className: "tanaw-hide-sm", width: "w-24" },
  { header: "Status", pill: true },
  { header: opensReport, width: "w-4" },
];
const ANNUAL_COLUMNS: readonly StaffTableSkeletonColumn[] = [
  { header: "Year", width: "w-16" },
  { header: "Months included", className: "tanaw-num", width: "w-16", cell: "stat", label: "Months included" },
  { header: "Visitors", className: "tanaw-num", width: "w-20", cell: "stat", label: "Visitors" },
  { header: "Status", pill: true },
  { header: opensReport, width: "w-4" },
];

/**
 * Staff Consolidated Reports. URL: `?tab=annual` (Monthly by default), `&year=2026`,
 * `&report=<final report id>` for an open monthly report and `&annual=2026` for an open annual report.
 */
export function StaffConsolidatedReportsPage() {
  const [params, setParams] = useSearchParams();
  const [currentYear] = useState(() => new Date().getFullYear());
  const reportsQuery = useOperationalFinalReports();
  const reports = reportsQuery.data ?? EMPTY_REPORTS;
  const tab = parseConsolidatedTab(params.get("tab"));
  const year = parseYear(params.get("year")) ?? defaultConsolidatedYear(reports, currentYear);
  const years = consolidatedReportYears(reports, currentYear);
  const yearOptions = (years.includes(year) ? years : [year, ...years]).map(String);
  const monthly = monthlyReportsForYear(reports, year);
  const annual = annualReportRows(reports);
  const openMonthly = reports.find((report) => report.id === params.get("report"));
  const annualYear = parseYear(params.get("annual"));
  const isLoading = reportsQuery.isLoading;
  const isError = reportsQuery.isError;

  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  return (
    <>
      <PortalPageHeader
        title="Consolidated Reports"
        description="Open, download or print the reports for DOT."
        actions={tab === "monthly" && <Select ariaLabel="Year" value={String(year)} options={yearOptions} onChange={(value) => updateParams({ year: value })} className="min-w-28" />}
      />

      <Tabs
        ariaLabel="Report type"
        idPrefix="consolidated-reports"
        items={[
          { value: "monthly", label: "Monthly (VAR 2M)" },
          { value: "annual", label: "Annual (VAR 3M)" },
        ]}
        value={tab}
        onChange={(value) => updateParams({ tab: value === "annual" ? "annual" : null })}
      />
      <div role="tabpanel" id={`consolidated-reports-panel-${tab}`} aria-labelledby={`consolidated-reports-tab-${tab}`} className="pt-4">
        {isLoading ? (
          <StaffTableSkeleton label="Loading consolidated reports…" columns={tab === "monthly" ? MONTHLY_COLUMNS : ANNUAL_COLUMNS} />
        ) : isError ? (
          <p role="alert" className="mt-3.5 text-sm text-(--tanaw-text-secondary)">
            Consolidated reports could not be loaded. Refresh the page to try again.
          </p>
        ) : tab === "monthly" ? (
          <MonthlyTable reports={monthly} year={year} onOpen={(report) => updateParams({ report: report.id })} />
        ) : (
          <AnnualTable rows={annual} onOpen={(row) => updateParams({ annual: String(row.year) })} />
        )}
      </div>

      {openMonthly && <MonthlyReportDialog key={openMonthly.id} report={openMonthly} onClose={() => updateParams({ report: null })} />}
      {annualYear !== null && !isLoading && <AnnualReportDialog key={annualYear} reports={reports} year={annualYear} onClose={() => updateParams({ annual: null })} />}
    </>
  );
}

function MonthlyTable({ reports, year, onOpen }: { reports: readonly FinalReport[]; year: number; onOpen: (report: FinalReport) => void }) {
  return (
    <>
      <div className="tanaw-staff-rise overflow-x-auto">
        <table className="tanaw-staff-table tanaw-staff-table--stack" aria-label={`Monthly reports for ${year}`}>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className="tanaw-hide-sm">
                Report ID
              </th>
              <th scope="col" className="tanaw-num">
                Enterprises
              </th>
              <th scope="col" className="tanaw-num">
                Visitors
              </th>
              <th scope="col" className="tanaw-hide-sm">
                Generated
              </th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Opens the report</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => {
              const status = finalReportStatus(report.status);
              return (
                <tr key={report.id} onClick={openRowFromClick} className="tanaw-row-link">
                  <th scope="row" data-cell="name" className="font-semibold">
                    <button type="button" data-row-primary aria-label={`View the ${report.period} report`} onClick={() => onOpen(report)}>
                      {report.period}
                    </button>
                  </th>
                  <td className="tanaw-hide-sm text-(--tanaw-text-secondary) tabular-nums">{report.id}</td>
                  <td data-cell="stat" data-label="Enterprises" className="tanaw-num" title={report.enterpriseTotal ? `${report.enterpriseCount} of the ${report.enterpriseTotal} enterprises expected when it was last generated` : undefined}>
                    {enterpriseCoverage(report.enterpriseCount, report.enterpriseTotal || null)}
                  </td>
                  <td data-cell="stat" data-label="Visitors" className="tanaw-num font-semibold">
                    {formatCount(report.totalUnique)}
                  </td>
                  <td className="tanaw-hide-sm text-(--tanaw-text-secondary)">{formatGeneratedOn(report.generatedOn)}</td>
                  <td data-cell="pill">
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </td>
                  <td data-cell="action">
                    <ChevronRight size={16} aria-hidden="true" className="tanaw-row-chevron ml-auto" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {reports.length === 0 && (
        <p role="status" className="mt-3.5 text-sm text-(--tanaw-text-secondary)">
          No monthly reports for {year} yet. Generate one from Reports once a month&apos;s reports are accepted.
        </p>
      )}
    </>
  );
}

function AnnualTable({ rows, onOpen }: { rows: readonly AnnualReportRow[]; onOpen: (row: AnnualReportRow) => void }) {
  return (
    <>
      <div className="tanaw-staff-rise overflow-x-auto">
        <table className="tanaw-staff-table tanaw-staff-table--stack" aria-label="Annual reports">
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col" className="tanaw-num">
                Months included
              </th>
              <th scope="col" className="tanaw-num">
                Visitors
              </th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Opens the report</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.year} onClick={openRowFromClick} className="tanaw-row-link">
                <th scope="row" data-cell="name" className="font-semibold">
                  <button type="button" data-row-primary aria-label={`View the ${row.year} annual report`} onClick={() => onOpen(row)}>
                    {row.year}
                  </button>
                </th>
                <td data-cell="stat" data-label="Months included" className="tanaw-num">
                  {row.monthsIncluded} of 12
                  {draftMonthsNote(row.draftMonths) && <span className="block text-[0.8125rem] font-normal text-(--tanaw-text-secondary)">{draftMonthsNote(row.draftMonths)}</span>}
                </td>
                <td data-cell="stat" data-label="Visitors" className="tanaw-num font-semibold">
                  {formatCount(row.visitors)}
                </td>
                <td data-cell="pill">
                  <StatusPill tone={row.complete ? "consolidated" : "waiting"}>{row.complete ? "Consolidated" : "Waiting"}</StatusPill>
                </td>
                <td data-cell="action">
                  <ChevronRight size={16} aria-hidden="true" className="tanaw-row-chevron ml-auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p role="status" className="mt-3.5 text-sm text-(--tanaw-text-secondary)">
          No annual report yet. It starts once a monthly report is finalized.
        </p>
      )}
      <p className="mt-3 text-[0.84375rem] text-(--tanaw-text-secondary)">The annual report adds up the finalized monthly reports; a month that is still a draft is not counted until it is final. It shows Waiting until all 12 months are consolidated.</p>
    </>
  );
}
