import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { operationalFinalReportsQueryKey, operationalReportsQueryKey, useOperationalFinalReports, useOperationalReports } from "@/app/hooks/useOperationalSync";
import { createFinalReport, listReportEnterprises, notifyEnterprise, updateIntakeReportStatus } from "@/shared/services/reporting";
import type { FinalReport, IntakeReport, ReportEnterprise } from "@/shared/types";
import { formatShortDate, reportDueDate } from "../model/reportStatuses";
import { formatReportingMonth, type ReportingMonth } from "../model/reportingMonth";
import { consolidatedMessage, openConsolidatedReport, reminderFailedMessage, reminderSentMessage, staffReminder, staffReportRows, staffReportsProgress, type StaffReportRow } from "../model/staffReports";

const EMPTY_ENTERPRISES: ReportEnterprise[] = [];
const EMPTY_REPORTS: IntakeReport[] = [];
const EMPTY_FINAL_REPORTS: FinalReport[] = [];

export const reportEnterprisesQueryKey = ["report-enterprises"];

export function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data && typeof error.response.data === "object" ? (error.response.data as { detail?: unknown }).detail : null;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

/**
 * Enterprise reports for one month, with the accept, reminder and generate actions, and the month's
 * consolidated report (a Draft or the final report) if there is one.
 */
export function useStaffReports(month: ReportingMonth, today: Date) {
  const queryClient = useQueryClient();
  const preparedBy = useAuthStore((state) => state.user?.displayName) ?? "LGU Staff";
  const enterprisesQuery = useQuery({ queryKey: reportEnterprisesQueryKey, queryFn: listReportEnterprises });
  const reportsQuery = useOperationalReports();
  const finalReportsQuery = useOperationalFinalReports();
  const enterprises = enterprisesQuery.data ?? EMPTY_ENTERPRISES;
  const reports = reportsQuery.data ?? EMPTY_REPORTS;
  const consolidatedReport = openConsolidatedReport(finalReportsQuery.data ?? EMPTY_FINAL_REPORTS, month);
  const rows = useMemo(() => staffReportRows(enterprises, reports, month, today), [enterprises, reports, month, today]);
  const progress = useMemo(() => staffReportsProgress(rows), [rows]);
  const [remindedIds, setRemindedIds] = useState<ReadonlySet<string>>(() => new Set());
  const monthLabel = formatReportingMonth(month);

  const accept = useMutation({
    mutationFn: (report: IntakeReport) => updateIntakeReportStatus(report.id, { status: "Ready to Consolidate", remarks: "Accepted for consolidation." }),
    onSuccess: (updated) => {
      queryClient.setQueryData<IntakeReport[]>(operationalReportsQueryKey, (current = []) => current.map((report) => (report.id === updated.id ? updated : report)));
      void queryClient.invalidateQueries({ queryKey: operationalReportsQueryKey });
      toast.success(`${updated.enterprise}'s report was accepted.`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "The report could not be updated. Refresh the list and try again.")),
  });

  // Generating adds the accepted reports to the month's draft, or starts one. With nothing new to
  // add (a draft whose month is now complete), the month alone lets the draft be finalized.
  const generate = useMutation({
    mutationFn: () => createFinalReport({ reportIds: progress.readyReportIds, preparedBy, period: monthLabel }),
    onMutate: () => ({ hadDraft: consolidatedReport?.status === "Draft" }),
    onSuccess: (finalReport, _, context) => {
      const sourceIds = new Set(finalReport.sources.map((source) => source.id));
      queryClient.setQueryData<IntakeReport[]>(operationalReportsQueryKey, (current) => current?.map((report) => (sourceIds.has(report.id) ? { ...report, status: "Consolidated" } : report)));
      queryClient.setQueryData<FinalReport[]>(operationalFinalReportsQueryKey, (current) => (current ? [finalReport, ...current.filter((report) => report.id !== finalReport.id)] : current));
      void queryClient.invalidateQueries({ queryKey: operationalReportsQueryKey });
      void queryClient.invalidateQueries({ queryKey: operationalFinalReportsQueryKey });
      toast.success(consolidatedMessage(finalReport.period, finalReport.status, context.hadDraft));
    },
    onError: (error) => toast.error(apiErrorMessage(error, "The consolidated report could not be generated. Refresh the list and try again.")),
  });

  const remind = useMutation({
    mutationFn: (row: StaffReportRow) => {
      const reminder = staffReminder(row, monthLabel, formatShortDate(reportDueDate(month.month, month.year)));
      return notifyEnterprise({
        enterpriseId: row.enterpriseId,
        title: reminder.title,
        message: reminder.message,
        type: "Staff Follow-up",
        severity: reminder.severity,
        sourceType: "Reports",
        sourceId: row.enterpriseId,
      });
    },
    // The month the reminder was for, in case the staff member changes month before it finishes.
    onMutate: () => ({ monthLabel }),
    onSuccess: (_, row, sent) => {
      const label = sent?.monthLabel ?? monthLabel;
      setRemindedIds((current) => new Set(current).add(`${row.enterpriseId}:${label}`));
      toast.success(reminderSentMessage(row.name, label));
    },
    onError: (_, row, sent) => toast.error(reminderFailedMessage(row.name, sent?.monthLabel ?? monthLabel)),
  });

  return {
    enterprises,
    reports,
    rows,
    progress,
    consolidatedReport,
    isLoading: enterprisesQuery.isLoading || reportsQuery.isLoading || finalReportsQuery.isLoading,
    isError: enterprisesQuery.isError || reportsQuery.isError || finalReportsQuery.isError,
    accept,
    generate,
    remind,
    wasReminded: (row: StaffReportRow) => remindedIds.has(`${row.enterpriseId}:${monthLabel}`),
  };
}
