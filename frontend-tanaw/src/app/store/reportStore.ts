import { create } from "zustand";
import { persist } from "zustand/middleware";
import { finalReports as initialFinalReports, intakeReports as initialReports, reportEnterprises } from "@/shared/data";
import type { FinalReport, FinalReportStatus, IntakeReport, ReportStatus } from "@/shared/types";
import { useSystemLogStore } from "./systemLogStore";

type ReportState = {
  reports: IntakeReport[];
  finalReports: FinalReport[];
  updateReportStatus: (reportId: string, status: ReportStatus, remarks?: string) => void;
  updateFinalReportStatus: (reportId: string, status: FinalReportStatus) => void;
  generateFinalReport: (reportIds: string[], preparedBy: string) => FinalReport | null;
  generateFinalReportFromReports: (reports: IntakeReport[], preparedBy: string) => FinalReport | null;
  syncCurrentSubmissionPeriod: () => void;
};

const REPORT_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type SubmissionPeriod = {
  month: string;
  monthIndex: number;
  period: string;
  periodKey: string;
  year: string;
};

export const useReportStore = create<ReportState>()(
  persist(
    (set, get) => ({
      reports: includeCurrentSubmissionPeriod(initialReports),
      finalReports: initialFinalReports,
      updateReportStatus: (reportId, status, remarks) => {
        const report = get().reports.find((item) => item.id === reportId);
        set((state) => ({
          reports: state.reports.map((item) => (item.id === reportId ? { ...item, status, remarks: remarks ?? item.remarks } : item)),
        }));

        if (report && report.status !== status) {
          useSystemLogStore.getState().recordLog({
            category: "Staff Operation",
            severity: status === "Returned" || status === "Missing" ? "Warning" : "Success",
            actor: "LGU Staff",
            actorRole: "LGU Staff",
            action: `Report ${status}`,
            target: report.id,
            summary: `Staff updated ${report.enterprise} report ${report.id} from ${report.status} to ${status}.`,
            sourceId: report.id,
            metadata: {
              previousStatus: report.status,
              newStatus: status,
              remarks: remarks ?? report.remarks ?? null,
            },
          });
        }
      },
      updateFinalReportStatus: (reportId, status) => {
        const report = get().finalReports.find((item) => item.id === reportId);
        set((state) => ({
          finalReports: state.finalReports.map((item) => (item.id === reportId ? applyFinalReportStatus(item, status) : item)),
        }));

        if (report && report.status !== status) {
          useSystemLogStore.getState().recordLog({
            category: "Staff Operation",
            severity: status === "Archived" || status === "Finalized" ? "Success" : "Info",
            actor: report.preparedBy,
            actorRole: "LGU Staff",
            action: `Final Report ${status}`,
            target: report.id,
            summary: `${report.preparedBy} changed final report ${report.id} from ${report.status} to ${status}.`,
            sourceId: report.id,
            metadata: {
              previousStatus: report.status,
              newStatus: status,
              period: report.period,
            },
          });
        }
      },
      generateFinalReport: (reportIds, preparedBy) => {
        const selectedReports = get().reports.filter((report) => reportIds.includes(report.id));
        if (selectedReports.length === 0) return null;

        const finalReport = buildFinalReport(selectedReports, preparedBy);

        set((state) => ({
          reports: state.reports.map((report) => (reportIds.includes(report.id) ? { ...report, status: "Consolidated" } : report)),
          finalReports: [finalReport, ...state.finalReports],
        }));

        useSystemLogStore.getState().recordLog({
          id: `LOG-FIN-${finalReport.id}`,
          category: "Staff Operation",
          severity: "Success",
          actor: preparedBy,
          actorRole: "LGU Staff",
          action: "Generate Final Report",
          target: finalReport.id,
          summary: `${preparedBy} generated ${finalReport.id} for ${finalReport.period} from ${selectedReports.length} ready submissions.`,
          sourceId: finalReport.id,
          metadata: {
            reportCount: selectedReports.length,
            enterpriseCount: finalReport.enterpriseCount,
          },
        });

        return finalReport;
      },
      generateFinalReportFromReports: (reports, preparedBy) => {
        if (reports.length === 0) return null;
        const finalReport = buildFinalReport(reports, preparedBy);

        set((state) => ({
          finalReports: [finalReport, ...state.finalReports],
        }));

        useSystemLogStore.getState().recordLog({
          id: `LOG-FIN-${finalReport.id}`,
          category: "Staff Operation",
          severity: "Success",
          actor: preparedBy,
          actorRole: "LGU Staff",
          action: "Generate Final Report",
          target: finalReport.id,
          summary: `${preparedBy} generated ${finalReport.id} for ${finalReport.period} from ${reports.length} ready submissions.`,
          sourceId: finalReport.id,
          metadata: {
            reportCount: reports.length,
            enterpriseCount: finalReport.enterpriseCount,
          },
        });

        return finalReport;
      },
      syncCurrentSubmissionPeriod: () =>
        set((state) => {
          const reports = includeCurrentSubmissionPeriod(state.reports);
          return reports === state.reports ? state : { reports };
        }),
    }),
    {
      name: "tanaw-report-workflow",
      version: 3,
      migrate: () => getInitialReportState(),
      merge: (_persistedState, currentState) => ({
        ...currentState,
        ...getInitialReportState(),
      }),
      partialize: (state) => ({
        reports: state.reports,
        finalReports: state.finalReports,
      }),
    },
  ),
);

function getInitialReportState() {
  return {
    reports: includeCurrentSubmissionPeriod(initialReports),
    finalReports: initialFinalReports,
  };
}

function includeCurrentSubmissionPeriod(reports: IntakeReport[]) {
  const currentPeriod = getCurrentSubmissionPeriod();
  const periodExists = reports.some((report) => report.month === currentPeriod.month && report.period.match(/\d{4}/)?.[0] === currentPeriod.year);

  return periodExists ? reports : [...reports, ...createMissingReports(currentPeriod)];
}

function getCurrentSubmissionPeriod(date = new Date()): SubmissionPeriod {
  const monthIndex = date.getMonth();
  const month = REPORT_MONTHS[monthIndex];
  const year = String(date.getFullYear());

  return {
    month,
    monthIndex,
    period: `${month} ${year}`,
    periodKey: `${year}${String(monthIndex + 1).padStart(2, "0")}`,
    year,
  };
}

function createMissingReports(period: SubmissionPeriod): IntakeReport[] {
  return reportEnterprises.map((enterprise, index) => ({
    id: `REP-${period.periodKey}-${String(index + 1).padStart(2, "0")}`,
    enterpriseId: enterprise.id,
    enterprise: enterprise.name,
    category: enterprise.category,
    barangay: enterprise.barangay,
    month: period.month,
    period: period.period,
    submitted: "Not submitted",
    status: "Missing",
    code: `AT-${String(index + 1).padStart(3, "0")}`,
    remarks: "Pending enterprise submission.",
    metrics: { entry: 0, exit: 0, unique: 0, peak: "N/A" },
  }));
}

function buildFinalReport(reports: IntakeReport[], preparedBy: string): FinalReport {
  const periodMonth = reports[0].month;
  const year = reports[0].period.match(/\d{4}/)?.[0] ?? new Date().getFullYear().toString();
  const id = `CON-${periodMonth.slice(0, 3).toUpperCase()}-${year}-${Date.now().toString().slice(-4)}`;

  return {
    id,
    title: "Citywide Tourism Aggregation",
    period: `${periodMonth} ${year}`,
    generatedOn: new Date().toISOString().slice(0, 10),
    preparedBy,
    preparedRole: "Staff Processing Division",
    status: "Draft",
    totalEntry: reports.reduce((total, report) => total + report.metrics.entry, 0),
    totalExit: reports.reduce((total, report) => total + report.metrics.exit, 0),
    totalUnique: reports.reduce((total, report) => total + report.metrics.unique, 0),
    enterpriseCount: new Set(reports.map((report) => report.enterpriseId)).size,
    sources: reports.map((report) => ({
      id: report.id,
      enterprise: report.enterprise,
      code: report.code,
      unique: report.metrics.unique,
      entry: report.metrics.entry,
      exit: report.metrics.exit,
      demographics: report.demographics ?? null,
    })),
  };
}

function applyFinalReportStatus(report: FinalReport, requestedStatus: FinalReportStatus): FinalReport {
  if (requestedStatus === "Archived") {
    return {
      ...report,
      status: "Archived",
      archivedFromStatus: report.status === "Archived" ? (report.archivedFromStatus ?? "Finalized") : report.status,
    };
  }

  if (report.status === "Archived" && requestedStatus === "Draft") {
    return { ...report, status: report.archivedFromStatus ?? "Finalized", archivedFromStatus: null };
  }

  return { ...report, status: requestedStatus, archivedFromStatus: null };
}

export function getReportEnterpriseName(enterpriseId: string) {
  return reportEnterprises.find((enterprise) => enterprise.id === enterpriseId)?.name ?? enterpriseId;
}
