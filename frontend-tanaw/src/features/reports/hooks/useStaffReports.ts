import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { operationalFinalReportsQueryKey, operationalReportsQueryKey, useOperationalReports } from "@/app/hooks/useOperationalSync";
import { createFinalReport, listReportEnterprises, notifyEnterprise, updateIntakeReportStatus } from "@/shared/services/reporting";
import type { FinalReport, IntakeReport, ReportEnterprise } from "@/shared/types";
import { formatShortDate, reportDueDate } from "../model/reportStatuses";
import { formatReportingMonth, type ReportingMonth } from "../model/reportingMonth";
import { staffReportRows, staffReportsProgress, type StaffReportRow } from "../model/staffReports";

const EMPTY_ENTERPRISES: ReportEnterprise[] = [];
const EMPTY_REPORTS: IntakeReport[] = [];

export const reportEnterprisesQueryKey = ["report-enterprises"];

type ReviewDecision = { report: IntakeReport; status: "Ready to Consolidate" | "Returned"; remarks: string };

export function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data && typeof error.response.data === "object" ? (error.response.data as { detail?: unknown }).detail : null;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

/** Enterprise reports for one month, with the review, reminder and generate actions. */
export function useStaffReports(month: ReportingMonth, today: Date) {
  const queryClient = useQueryClient();
  const preparedBy = useAuthStore((state) => state.user?.displayName) ?? "LGU Staff";
  const enterprisesQuery = useQuery({ queryKey: reportEnterprisesQueryKey, queryFn: listReportEnterprises });
  const reportsQuery = useOperationalReports();
  const enterprises = enterprisesQuery.data ?? EMPTY_ENTERPRISES;
  const reports = reportsQuery.data ?? EMPTY_REPORTS;
  const rows = useMemo(() => staffReportRows(enterprises, reports, month, today), [enterprises, reports, month, today]);
  const progress = useMemo(() => staffReportsProgress(rows), [rows]);
  const [remindedIds, setRemindedIds] = useState<ReadonlySet<string>>(() => new Set());
  const monthLabel = formatReportingMonth(month);

  const review = useMutation({
    mutationFn: ({ report, status, remarks }: ReviewDecision) => updateIntakeReportStatus(report.id, { status, remarks }),
    onSuccess: (updated) => {
      queryClient.setQueryData<IntakeReport[]>(operationalReportsQueryKey, (current = []) => current.map((report) => (report.id === updated.id ? updated : report)));
      void queryClient.invalidateQueries({ queryKey: operationalReportsQueryKey });
      toast.success(updated.status === "Returned" ? `${updated.enterprise}'s report was returned for correction.` : `${updated.enterprise}'s report was accepted.`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "The report could not be updated. Refresh the list and try again.")),
  });

  const generate = useMutation({
    mutationFn: () => createFinalReport({ reportIds: progress.readyReportIds, preparedBy }),
    onSuccess: (finalReport) => {
      const sourceIds = new Set(finalReport.sources.map((source) => source.id));
      queryClient.setQueryData<IntakeReport[]>(operationalReportsQueryKey, (current) => current?.map((report) => (sourceIds.has(report.id) ? { ...report, status: "Consolidated" } : report)));
      queryClient.setQueryData<FinalReport[]>(operationalFinalReportsQueryKey, (current) => (current ? [finalReport, ...current.filter((report) => report.id !== finalReport.id)] : current));
      void queryClient.invalidateQueries({ queryKey: operationalReportsQueryKey });
      void queryClient.invalidateQueries({ queryKey: operationalFinalReportsQueryKey });
      toast.success(`The ${finalReport.period} consolidated report was generated.`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "The consolidated report could not be generated. Refresh the list and try again.")),
  });

  const remind = useMutation({
    mutationFn: (row: StaffReportRow) => {
      const due = formatShortDate(reportDueDate(month.month, month.year));
      return notifyEnterprise({
        enterpriseId: row.enterpriseId,
        title: "Monthly report reminder",
        message: row.submission === "Missing" ? `Please send your ${monthLabel} monthly report. It was due ${due}.` : `Please send your ${monthLabel} monthly report by ${due}.`,
        type: "Staff Follow-up",
        severity: row.submission === "Missing" ? "Warning" : "Info",
        sourceType: "Reports",
        sourceId: row.enterpriseId,
      });
    },
    onSuccess: (_, row) => {
      setRemindedIds((current) => new Set(current).add(`${row.enterpriseId}:${monthLabel}`));
      toast.success(`Reminder sent to ${row.name}.`);
    },
    onError: (_, row) => toast.error(`The reminder to ${row.name} could not be sent. Try again.`),
  });

  return {
    enterprises,
    reports,
    rows,
    progress,
    isLoading: enterprisesQuery.isLoading || reportsQuery.isLoading,
    isError: enterprisesQuery.isError || reportsQuery.isError,
    review,
    generate,
    remind,
    wasReminded: (row: StaffReportRow) => remindedIds.has(`${row.enterpriseId}:${monthLabel}`),
  };
}
