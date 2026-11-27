import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useOperationalFinalReports } from "@/app/hooks/useOperationalSync";
import { listReportEnterprises } from "@/shared/services/reporting";
import type { FinalReport } from "@/shared/types";
import { PortalPageHeader, Select, StatusPill, Tabs, openRowFromClick } from "@/shared/ui-kit";
import { AnnualReportDialog } from "../components/AnnualReportDialog";
import { MonthlyReportDialog } from "../components/MonthlyReportDialog";
import { StaffTableSkeleton } from "../components/StaffTableSkeleton";
import { reportEnterprisesQueryKey } from "../hooks/useStaffReports";
import {
  annualReportRows,
  consolidatedReportYears,
  defaultConsolidatedYear,
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

/**
 * Staff Consolidated Reports. URL: `?tab=annual` (Monthly by default), `&year=2026`,
 * `&report=<final report id>` for an open monthly report and `&annual=2026` for an open annual report.
 */
export function StaffConsolidatedReportsPage() {
  const [params, setParams] = useSearchParams();
  const [currentYear] = useState(() => new Date().getFullYear());
  const reportsQuery = useOperationalFinalReports();
  const enterprisesQuery = useQuery({ queryKey: reportEnterprisesQueryKey, queryFn: listReportEnterprises });
  const reports = reportsQuery.data ?? EMPTY_REPORTS;
  const registered = enterprisesQuery.data?.length ?? null;
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
          <StaffTableSkeleton label="Loading consolidated reports…" cells={tab === "monthly" ? ["w-2/5", "w-28", "w-12", "w-16", "w-24", "w-24", "w-4"] : ["w-16", "w-16", "w-20", "w-24", "w-4"]} />
        ) : isError ? (
          <p role="alert" className="mt-3.5 text-sm text-(--tanaw-text-secondary)">
            Consolidated reports could not be loaded. Refresh the page to try again.
          </p>
        ) : tab === "monthly" ? (
          <MonthlyTable reports={monthly} year={year} registered={registered} onOpen={(report) => updateParams({ report: report.id })} />
        ) : (
          <AnnualTable rows={annual} onOpen={(row) => updateParams({ annual: String(row.year) })} />
        )}
      </div>

      {openMonthly && <MonthlyReportDialog key={openMonthly.id} report={openMonthly} onClose={() => updateParams({ report: null })} />}
      {annualYear !== null && !isLoading && <AnnualReportDialog key={annualYear} reports={reports} year={annualYear} onClose={() => updateParams({ annual: null })} />}
    </>
  );
}

function MonthlyTable({ reports, year, registered, onOpen }: { reports: readonly FinalReport[]; year: number; registered: number | null; onOpen: (report: FinalReport) => void }) {
  return (
    <>
      <div className="tanaw-staff-rise overflow-x-auto">
        <table className="tanaw-staff-table" aria-label={`Monthly reports for ${year}`}>
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
                  <th scope="row" className="font-semibold">
                    <button type="button" data-row-primary aria-label={`View the ${report.period} report`} onClick={() => onOpen(report)}>
                      {report.period}
                    </button>
                  </th>
                  <td className="tanaw-hide-sm text-(--tanaw-text-secondary) tabular-nums">{report.id}</td>
                  <td className="tanaw-num" title={registered ? `${report.enterpriseCount} of the ${registered} enterprises registered today` : undefined}>
                    {enterpriseCoverage(report.enterpriseCount, registered)}
                  </td>
                  <td className="tanaw-num font-semibold">{formatCount(report.totalUnique)}</td>
                  <td className="tanaw-hide-sm text-(--tanaw-text-secondary)">{formatGeneratedOn(report.generatedOn)}</td>
                  <td>
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </td>
                  <td>
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
        <table className="tanaw-staff-table" aria-label="Annual reports">
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
                <th scope="row" className="font-semibold">
                  <button type="button" data-row-primary aria-label={`View the ${row.year} annual report`} onClick={() => onOpen(row)}>
                    {row.year}
                  </button>
                </th>
                <td className="tanaw-num">{row.monthsIncluded} of 12</td>
                <td className="tanaw-num font-semibold">{formatCount(row.visitors)}</td>
                <td>
                  <StatusPill tone={row.complete ? "consolidated" : "waiting"}>{row.complete ? "Consolidated" : "Waiting"}</StatusPill>
                </td>
                <td>
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
      <p className="mt-3 text-[0.84375rem] text-(--tanaw-text-secondary)">The annual report adds up the finalized monthly reports. It shows Waiting until all 12 months are consolidated.</p>
    </>
  );
}
