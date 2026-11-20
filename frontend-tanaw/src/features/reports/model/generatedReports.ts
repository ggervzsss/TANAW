import type { FinalReport } from "@/shared/types";

type GeneratedReportFilters = {
  query: string;
  month: string;
  year: string;
};

export function filterGeneratedReports(reports: readonly FinalReport[], { query, month, year }: GeneratedReportFilters) {
  const search = query.trim().toLowerCase();

  return reports.filter((report) => {
    const [reportMonth, reportYear] = report.period.split(" ");
    return (
      (!month || month === reportMonth) &&
      (!year || year === reportYear) &&
      (!search || report.id.toLowerCase().includes(search) || report.period.toLowerCase().includes(search) || report.sources.some((source) => source.enterprise.toLowerCase().includes(search)))
    );
  });
}
