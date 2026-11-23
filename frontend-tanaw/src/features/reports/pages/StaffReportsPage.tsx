import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { Button, PortalPageHeader, Select, Tabs } from "@/shared/ui-kit";
import { EnterpriseReportDialog } from "../components/EnterpriseReportDialog";
import { ReportActionConfirmDialog } from "../components/ReportActionConfirmDialog";
import { ReportsProgressStrip } from "../components/ReportsProgressStrip";
import { StaffReportsTable } from "../components/StaffReportsTable";
import { useStaffReports } from "../hooks/useStaffReports";
import { currentReportingMonth } from "../model/reportStatuses";
import { formatReportingMonth, monthKey, parseMonthKey, reportingMonthOptions } from "../model/reportingMonth";
import { parseStaffReportsTab, rowInTab, staffReportsStatus, staffReportTabs, type StaffReportRow } from "../model/staffReports";

const STATUS_ID = "staff-reports-status";

/**
 * Staff Reports. URL: `?month=2026-10` (the reporting month, default the current one),
 * `&tab=waiting|reviewing|consolidated|not-sent` and `&report=<intake report id>` for the open report.
 */
export function StaffReportsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [today] = useState(() => new Date());
  const current = useMemo(() => currentReportingMonth(today), [today]);
  const monthParam = params.get("month");
  const month = useMemo(() => parseMonthKey(monthParam) ?? current, [current, monthParam]);
  const tab = parseStaffReportsTab(params.get("tab"));
  const reportId = params.get("report");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const data = useStaffReports(month, today);
  const { progress } = data;
  const monthLabel = formatReportingMonth(month);
  const openReport = reportId ? data.reports.find((report) => report.id === reportId) : undefined;
  const tabs = staffReportTabs(data.rows);
  const visibleRows = data.rows.filter((row) => rowInTab(row, tab));
  const monthOptions = reportingMonthOptions(data.reports, current).map((option) => [monthKey(option), formatReportingMonth(option)] as const);
  const statusText = staffReportsStatus(progress, month);

  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const closeReport = () => updateParams({ report: null });

  const status = data.isError
    ? { line: "Reports could not be loaded.", detail: "Refresh the page to try again." }
    : data.isLoading
      ? { line: "Loading reports…", detail: "" }
      : {
          line: statusText.line,
          detail: progress.generated ? (
            <>
              {statusText.detail}{" "}
              <Link to={`${routes.staff.consolidatedReports}?year=${month.year}`} className="font-semibold text-(--tanaw-accent-ink) underline-offset-4 hover:underline">
                Open consolidated reports
              </Link>
            </>
          ) : (
            statusText.detail
          ),
        };

  return (
    <>
      <PortalPageHeader
        title="Reports"
        description={`Accept each ${month.month} report, then generate the consolidated report.`}
        actions={
          <>
            <Select ariaLabel="Reporting month" value={monthKey(month)} options={monthOptions} onChange={(value) => updateParams({ month: value, report: null })} className="min-w-44" />
            <Button aria-describedby={STATUS_ID} disabled={!progress.canGenerate || data.isLoading || data.isError} loading={data.generate.isPending} onClick={() => setIsConfirmOpen(true)}>
              Generate consolidated report
            </Button>
          </>
        }
      />

      <ReportsProgressStrip id={STATUS_ID} progress={progress} status={status} />

      <Tabs
        ariaLabel="Filter by staff review"
        idPrefix="staff-reports"
        className="mt-4"
        items={tabs.map((item) => ({ ...item, count: data.isLoading || data.isError ? undefined : item.count }))}
        value={tab}
        onChange={(value) => updateParams({ tab: value === "all" ? null : value })}
      />
      <div role="tabpanel" id={`staff-reports-panel-${tab}`} aria-labelledby={`staff-reports-tab-${tab}`}>
        {data.isLoading || data.isError ? (
          <p role={data.isError ? "alert" : "status"} className="mt-3.5 text-sm text-(--tanaw-text-secondary)">
            {data.isError ? "Reports could not be loaded. Refresh the page to try again." : "Loading reports…"}
          </p>
        ) : (
          <StaffReportsTable
            rows={visibleRows}
            emptyMessage={data.rows.length ? "No reports in this view." : "No enterprises are registered yet."}
            remindingId={data.remind.isPending ? (data.remind.variables?.enterpriseId ?? null) : null}
            wasReminded={data.wasReminded}
            onOpen={(row: StaffReportRow) => row.report && updateParams({ report: row.report.id })}
            onRemind={(row) => data.remind.mutate(row)}
          />
        )}
      </div>

      {openReport && (
        <EnterpriseReportDialog
          key={openReport.id}
          report={openReport}
          isUpdating={data.review.isPending}
          onClose={closeReport}
          onAccept={(report) => data.review.mutate({ report, status: "Ready to Consolidate", remarks: "Accepted for consolidation." }, { onSuccess: closeReport })}
          onReturn={(report, remarks) => data.review.mutate({ report, status: "Returned", remarks }, { onSuccess: closeReport })}
        />
      )}

      {isConfirmOpen && (
        <ReportActionConfirmDialog
          title="Generate consolidated report?"
          message={generateMessage(monthLabel, progress.readyReportIds.length, progress.notSent.length)}
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

function generateMessage(monthLabel: string, accepted: number, notSent: number) {
  const reports = `${accepted} accepted ${accepted === 1 ? "report" : "reports"}`;
  const missing = notSent ? ` ${notSent} ${notSent === 1 ? "enterprise has" : "enterprises have"} not sent a report and will not be included.` : "";
  return `Combine the ${reports} into the ${monthLabel} monthly report (VAR 2M).${missing}`;
}
