import { FileSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { currentReportingMonth, monthIndexOf } from "@/features/reports/model/reportStatuses";
import {
  Alert,
  Button,
  DateRangePicker,
  EmptyState,
  Pagination,
  PortalPageHeader,
  SearchField,
  Select,
  Skeleton,
  monthRange,
  rangeEndMonth,
  type DateRange,
} from "@/shared/ui-kit";
import { EnterpriseReportList } from "../components/EnterpriseReportList";
import { EnterpriseReportModal } from "../components/EnterpriseReportModal";
import { useEnterpriseReportsData } from "../hooks/useEnterpriseReportsData";
import { buildReportRows, filterReportRows, type SubmissionFilter } from "../model/enterpriseReports";
import { readReportLink, withReportClosed, withReportMonth, withReportOpen } from "../model/reportLinks";
import { monthFromKeyId, monthKeyId, periodLabel, sameMonth, type MonthKey } from "../model/reportMonths";
import "../admin-reports.css";

const PAGE_SIZE = 10;

const SUBMISSION_OPTIONS = [
  ["all", "All statuses"],
  ["Submitted", "Submitted"],
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

  const [pickedRange, setPickedRange] = useState<DateRange | null>(null);
  const range = pickedRange && sameMonth(rangeEndMonth(pickedRange), month) ? pickedRange : monthRange(month.year, month.monthIndex, today);

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

  const openProfile = link.enterpriseId ? profiles.find((profile) => profile.id === link.enterpriseId) : undefined;
  const period = periodLabel(month);
  const filtered = query.trim() !== "" || enterpriseId !== "all" || submission !== "all";

  const applyRange = (next: DateRange) => {
    const end = rangeEndMonth(next);
    setPickedRange(next);
    setPage(1);
    setSearchParams(withReportMonth(searchParams, { year: end.year, monthIndex: end.monthIndex }), { replace: true });
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
          <DateRangePicker
            variant="field"
            label="Reporting month"
            ariaLabel="Choose the reporting month"
            value={range}
            onChange={applyRange}
            today={today}
            triggerLabel={period}
            className="min-w-60"
          />
        }
      />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-68 max-sm:w-full">
          <span aria-hidden="true" className="mb-2 block text-xs font-bold tracking-label text-(--tanaw-label) uppercase">
            Search reports
          </span>
          <SearchField value={query} onChange={changeQuery} placeholder="Enterprise, staff, or report ID" label="Search reports" />
        </div>
        <Select label="Enterprise" value={enterpriseId} onChange={changeEnterprise} options={enterpriseOptions} searchable className="w-60 max-sm:w-full" />
        <Select label="Submission status" value={submission} onChange={changeSubmission} options={SUBMISSION_OPTIONS} className="w-52 max-sm:w-full" />
        <p role="status" className="mb-2.5 ml-auto text-[0.84375rem] text-(--tanaw-text-secondary) tabular-nums max-sm:ml-0">
          {isLoading ? "Loading enterprises" : `${rows.length} of ${allRows.length} ${allRows.length === 1 ? "enterprise" : "enterprises"}`}
        </p>
      </div>

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
        <div className="mt-4 space-y-2" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
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
