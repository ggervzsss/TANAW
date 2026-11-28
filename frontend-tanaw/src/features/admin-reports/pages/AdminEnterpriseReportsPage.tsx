import { FileSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { currentReportingMonth, monthIndexOf } from "@/features/reports/model/reportStatuses";
import { Alert, Button, EmptyState, MonthPicker, Pagination, PortalPageHeader, SearchField, Select, Skeleton } from "@/shared/ui-kit";
import { PhoneFilterSheet } from "@/features/admin-enterprises/components/PhoneFilterSheet";
import { EnterpriseReportList } from "../components/EnterpriseReportList";
import { EnterpriseReportModal } from "../components/EnterpriseReportModal";
import { useEnterpriseReportsData } from "../hooks/useEnterpriseReportsData";
import { buildReportRows, filterReportRows, type SubmissionFilter } from "../model/enterpriseReports";
import { readReportLink, withReportClosed, withReportMonth, withReportOpen } from "../model/reportLinks";
import { minMonth, monthFromKeyId, monthKeyId, monthOfDate, periodLabel, type MonthKey } from "../model/reportMonths";
import "../admin-reports.css";

const PAGE_SIZE = 10;

const SUBMISSION_OPTIONS = [
  ["all", "All statuses"],
  ["Submitted", "Submitted"],
  ["Awaiting correction", "Awaiting correction"],
  ["Pending", "Pending"],
  ["Missing", "Missing"],
] as const satisfies readonly (readonly [SubmissionFilter, string])[];

function defaultReportingMonth(today: Date): MonthKey {
  const { month, year } = currentReportingMonth(today);
  return { year, monthIndex: monthIndexOf(month) };
}

/**
 * Enterprise Reports (admin): who sent the monthly report for a reporting month, when it arrived and where
 * it is in review. The reporting month and an open enterprise live in the address
 * (`?enterprise=<enterpriseId>&month=October&year=2026`, see model/reportLinks.ts), so other screens can
 * link straight to one enterprise's report details.
 */
export function AdminEnterpriseReportsPage() {
  const [today] = useState(() => new Date());
  const [searchParams, setSearchParams] = useSearchParams();
  const link = readReportLink(searchParams);
  // One month object per month, so the lists below are not rebuilt on every render.
  const monthId = monthKeyId(link.month ?? defaultReportingMonth(today));
  const month = useMemo(() => monthFromKeyId(monthId) as MonthKey, [monthId]);

  const latestDue = useMemo(() => defaultReportingMonth(today), [today]);

  const [query, setQuery] = useState("");
  const [enterpriseId, setEnterpriseId] = useState("all");
  const [submission, setSubmission] = useState<SubmissionFilter>("all");
  const [page, setPage] = useState(1);

  const { profiles, reportIndex, reviewers, logs, finalReports, isLoading, isError, retry } = useEnterpriseReportsData();

  const allRows = useMemo(() => buildReportRows(profiles, reportIndex, reviewers, month, today), [month, profiles, reportIndex, reviewers, today]);
  const rows = useMemo(() => filterReportRows(allRows, { query, enterpriseId, submission }), [allRows, enterpriseId, query, submission]);
  const enterpriseOptions = useMemo(
    () => [
      { value: "all", label: "All enterprises" },
      ...allRows.map((row) => ({ value: row.enterprise.id, label: row.enterprise.name })).sort((left, right) => left.label.localeCompare(right.label)),
    ],
    [allRows],
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Months can be chosen from the first month any enterprise reports for, up to this month.
  const firstMonth = useMemo(() => profiles.reduce<MonthKey | null>((first, profile) => minMonth(first, profile.firstMonth), null), [profiles]);
  const openProfile = link.enterpriseId ? profiles.find((profile) => profile.id === link.enterpriseId) : undefined;
  const period = periodLabel(month);
  const filtered = query.trim() !== "" || enterpriseId !== "all" || submission !== "all";

  const changeMonth = (next: MonthKey) => {
    setPage(1);
    setSearchParams(withReportMonth(searchParams, next), { replace: true });
  };
  const changeQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };
  const changeEnterprise = (value: string) => {
    setEnterpriseId(value);
    setPage(1);
  };
  const changeSubmission = (value: string) => {
    setSubmission(value as SubmissionFilter);
    setPage(1);
  };
  const clearFilters = () => {
    setQuery("");
    setEnterpriseId("all");
    setSubmission("all");
    setPage(1);
  };
  const openEnterprise = (id: string) => setSearchParams(withReportOpen(searchParams, id, month));
  const closeEnterprise = () => setSearchParams(withReportClosed(searchParams));

  return (
    <div className="w-full">
      <PortalPageHeader
        title="Enterprise Reports"
        description={`Who sent their ${period} report, when it arrived, and where it is in review. Select an enterprise to see its report details.`}
        actions={
          <MonthPicker
            label="Reporting month"
            value={month}
            onChange={changeMonth}
            min={firstMonth}
            max={monthOfDate(today)}
            highlight={latestDue}
            highlightLabel="Latest month due"
            className="w-74 max-sm:w-full"
          />
        }
      />

      {/* The filters share the full width, the search taking the larger part, so no gap is left at the end of the row. */}
      <div className="mt-4 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] items-end gap-3 max-lg:grid-cols-2 max-md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 max-lg:col-span-2 max-md:col-span-1">
          <span aria-hidden="true" className="mb-2 block text-[13px] font-semibold text-(--tanaw-text-secondary)">
            Search reports
          </span>
          <SearchField value={query} onChange={changeQuery} placeholder="Enterprise, staff, or report ID" label="Search reports" />
        </div>
        <PhoneFilterSheet
          noun="reports"
          activeCount={(enterpriseId !== "all" ? 1 : 0) + (submission !== "all" ? 1 : 0)}
          onClear={() => {
            changeEnterprise("all");
            changeSubmission("all");
          }}
          resultLabel={isLoading ? undefined : `${rows.length} of ${allRows.length} ${allRows.length === 1 ? "enterprise" : "enterprises"}`}
        >
          <Select label="Enterprise" value={enterpriseId} onChange={changeEnterprise} options={enterpriseOptions} searchable />
          <Select label="Submission status" value={submission} onChange={changeSubmission} options={SUBMISSION_OPTIONS} />
        </PhoneFilterSheet>
      </div>
      <p role="status" className="mt-3 text-sm font-semibold text-(--tanaw-text) tabular-nums">
        {isLoading ? "Loading enterprises" : `${rows.length} of ${allRows.length} ${allRows.length === 1 ? "enterprise" : "enterprises"}`}
      </p>

      {isError ? (
        <Alert
          tone="danger"
          title="Reports could not be loaded"
          className="mt-4"
          action={
            <Button variant="secondary" size="sm" onClick={() => void retry()}>
              Try again
            </Button>
          }
        >
          Check the connection and try again.
        </Alert>
      ) : isLoading ? (
        <ReportListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FileSearch size={22} />}
          title={allRows.length === 0 ? `No enterprises to report for ${period}` : "No reports match"}
          description={allRows.length === 0 ? "Enterprises registered by this month will appear here." : "Try another enterprise or status, or clear the search."}
          action={
            filtered ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
          className="mt-4 border-t border-(--tanaw-border-soft)"
        />
      ) : (
        <>
          <EnterpriseReportList rows={pageRows} openEnterpriseId={openProfile?.id ?? null} onOpen={openEnterprise} />
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onChange={setPage}
            summary={`Showing ${pageRows.length} of ${rows.length} ${rows.length === 1 ? "enterprise" : "enterprises"}`}
            ariaLabel="Enterprise report pages"
            className="mt-4.5"
          />
        </>
      )}

      {openProfile && (
        <EnterpriseReportModal
          key={`${openProfile.id}-${monthId}`}
          profile={openProfile}
          viewedMonth={month}
          reportIndex={reportIndex}
          reviewers={reviewers}
          logs={logs}
          finalReports={finalReports}
          today={today}
          onClose={closeEnterprise}
        />
      )}
    </div>
  );
}

/**
 * The report list in its own shape while it loads: the real column headings, then one page of rows
 * with each bar in the box of the line it stands for (14px text at 1.5, 13px notes, 26px pills).
 */
function ReportListSkeleton() {
  return (
    <div className="mt-3.5 overflow-x-hidden max-md:mt-2" aria-hidden="true">
      <div className="min-[60rem]:min-w-225">
        <div className="tanaw-er-cols tanaw-er-head border-b border-(--tanaw-border-soft) px-3 py-3 max-md:hidden">
          <span>Enterprise</span>
          <span>Sent on</span>
          <span>Submission</span>
          <span>Staff review</span>
          <span>Reviewed by</span>
          <span />
        </div>
        {Array.from({ length: PAGE_SIZE }, (_, index) => (
          <div key={index} className="tanaw-er-item">
            <div className="tanaw-er-cols tanaw-er-skeleton-row px-3 py-3.5">
              <span className="block">
                <span className="flex h-5.25 items-center">
                  <Skeleton className="h-3.5 w-44" />
                </span>
                <span className="mt-0.5 flex h-[19.5px] items-center">
                  <Skeleton className="h-3 w-32" />
                </span>
              </span>
              <Skeleton className="h-3.5 w-16" />
              <Skeleton shape="pill" className="h-6.5 w-24" />
              <Skeleton shape="pill" className="h-6.5 w-24" />
              <Skeleton className="h-3.5 w-24" />
              <span />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
