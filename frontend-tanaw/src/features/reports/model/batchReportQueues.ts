import type { EnterpriseReportRow } from "../utils";

export function getBatchReportQueues(rows: readonly EnterpriseReportRow[]) {
  return {
    pending: rows.filter((row) => row.status === "Pending Review"),
    followUp: rows.filter((row) => row.status === "Missing" || row.status === "Returned"),
    ready: rows.filter((row) => row.status === "Ready to Consolidate"),
    completed: rows.filter((row) => row.status === "Consolidated"),
  };
}

export function searchBatchReportRows(rows: readonly EnterpriseReportRow[], query: string) {
  const search = query.trim().toLowerCase();
  if (!search) return rows;
  return rows.filter(({ enterprise, currentReport }) => [enterprise.name, enterprise.category, enterprise.barangay, currentReport?.code].some((value) => value?.toLowerCase().includes(search)));
}
