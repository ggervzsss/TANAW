import { Search } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useOperationalFinalReports } from "@/app/hooks/useOperationalSync";
import { Input } from "@/shared/ui-kit";
import { PageHeader } from "@/shared/components/layout";
import { FilterSelect, PageMotion } from "@/shared/components/ui";
import type { FinalReport } from "@/shared/types";
import { AnnualReportDialog, GeneratedReportsPanel, MonthlyReportDialog } from "../components";
import { filterGeneratedReports } from "../model/generatedReports";
import { MONTH_NAMES } from "../model/varForms";

const EMPTY_REPORTS: FinalReport[] = [];

export function StaffGeneratedReportsPage() {
  const reportsQuery = useOperationalFinalReports();
  const reports = reportsQuery.data ?? EMPTY_REPORTS;
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get("month") ?? "";
  const year = searchParams.get("year") ?? "";
  const [monthlyReportId, setMonthlyReportId] = useState<string | null>(null);
  const [isAnnualReportOpen, setIsAnnualReportOpen] = useState(false);
  const selectedReport = reports.find((report) => report.id === monthlyReportId);

  const periods = reports.map((report) => report.period.split(" "));
  const years = [...new Set(periods.map(([, reportYear]) => reportYear).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  const months = MONTH_NAMES.filter((option) => periods.some(([reportMonth]) => reportMonth === option));

  function updatePeriod(key: "month" | "year", value: string) {
    const nextParams = new URLSearchParams(searchParams);
    if (value) nextParams.set(key, value);
    else nextParams.delete(key);
    setSearchParams(nextParams, { replace: true });
  }

  return (
    <PageMotion>
      <PageHeader title="Generated Reports" description="Find and download consolidated DOT reports across all establishments." />
      <GeneratedReportsPanel
        reports={filterGeneratedReports(reports, { query: search, month, year })}
        isLoading={reportsQuery.isLoading}
        isError={reportsQuery.isError}
        isFiltered={Boolean(search.trim() || month || year)}
        onOpenReport={setMonthlyReportId}
        onOpenAnnualReport={() => setIsAnnualReportOpen(true)}
      >
        <Input
          type="search"
          aria-label="Search generated reports"
          placeholder="Search report ID, period, or establishment"
          leading={<Search size={16} aria-hidden="true" />}
          className="w-full sm:max-w-md sm:flex-1"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <FilterSelect ariaLabel="Report month" value={month} options={[["", "All months"], ...months]} onChange={(value) => updatePeriod("month", value)} />
        <FilterSelect ariaLabel="Report year" value={year} options={[["", "All years"], ...years]} onChange={(value) => updatePeriod("year", value)} />
      </GeneratedReportsPanel>
      {selectedReport && <MonthlyReportDialog key={selectedReport.id} report={selectedReport} onClose={() => setMonthlyReportId(null)} />}
      {isAnnualReportOpen && <AnnualReportDialog reports={reports} preferredYear={year ? Number(year) : undefined} onClose={() => setIsAnnualReportOpen(false)} />}
    </PageMotion>
  );
}
