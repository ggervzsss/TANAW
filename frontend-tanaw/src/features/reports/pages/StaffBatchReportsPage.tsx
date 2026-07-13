import { AnimatePresence } from "motion/react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { operationalFinalReportsQueryKey, operationalReportsQueryKey, useOperationalReports } from "@/shared/hooks/useOperationalSync";
import { createFinalReport, listReportEnterprises, updateIntakeReportStatus } from "@/shared/services/reporting";
import type { IntakeReport, ReportEnterprise, ReportStatus } from "@/shared/types";
import { BatchReportsMetrics, BatchReportsStatusNotice, BatchReportsTable, BatchReportsToolbar, EnterpriseReportsModal, ReportActionConfirmDialog, ReportReviewModal } from "../components";
import { getAvailableMonths, getAvailableYears, getCurrentSubmissionPeriod, getDefaultSubmissionPeriod, getEnterpriseReportRows, reportMatchesPeriod } from "../utils";

const EMPTY_REPORT_ENTERPRISES: ReportEnterprise[] = [];
const EMPTY_REPORTS: IntakeReport[] = [];
const ALL_BARANGAYS_FILTER = "all";

export function StaffBatchReportsPage() {
  const authUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const reportEnterprisesQuery = useQuery({ queryKey: ["report-enterprises"], queryFn: listReportEnterprises });
  const reportsQuery = useOperationalReports();
  const reportEnterprises = reportEnterprisesQuery.data ?? EMPTY_REPORT_ENTERPRISES;
  const reports = reportsQuery.data ?? EMPTY_REPORTS;
  const currentPeriod = getCurrentSubmissionPeriod();
  const defaultPeriod = getDefaultSubmissionPeriod(reports, currentPeriod);
  const [query, setQuery] = useState("");
  const [barangayFilter, setBarangayFilter] = useState(ALL_BARANGAYS_FILTER);
  const [monthFilter, setMonthFilter] = useState(defaultPeriod.month);
  const [yearFilter, setYearFilter] = useState(defaultPeriod.year);
  const [selectedEnterprise, setSelectedEnterprise] = useState<ReportEnterprise | null>(null);
  const [selectedReport, setSelectedReport] = useState<IntakeReport | null>(null);
  const [isGenerateConfirmOpen, setIsGenerateConfirmOpen] = useState(false);

  const availableMonths = useMemo(() => getAvailableMonths(reports, currentPeriod), [currentPeriod, reports]);
  const availableYears = useMemo(() => getAvailableYears(reports, currentPeriod), [currentPeriod, reports]);
  const availableBarangays = useMemo(
    () => Array.from(new Set(reportEnterprises.map((enterprise) => enterprise.barangay).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [reportEnterprises],
  );
  const selectedReportEnterprises = useMemo(
    () => (barangayFilter === ALL_BARANGAYS_FILTER ? reportEnterprises : reportEnterprises.filter((enterprise) => enterprise.barangay === barangayFilter)),
    [barangayFilter, reportEnterprises],
  );
  const selectedEnterpriseIds = useMemo(() => new Set(selectedReportEnterprises.map((enterprise) => enterprise.id)), [selectedReportEnterprises]);
  const reportsForSelectedBarangay = useMemo(
    () => (barangayFilter === ALL_BARANGAYS_FILTER ? reports : reports.filter((report) => selectedEnterpriseIds.has(report.enterpriseId))),
    [barangayFilter, reports, selectedEnterpriseIds],
  );
  const filteredByPeriod = useMemo(() => reportsForSelectedBarangay.filter((report) => reportMatchesPeriod(report, monthFilter, yearFilter)), [reportsForSelectedBarangay, monthFilter, yearFilter]);
  const nonPeriodReports = useMemo(
    () => reportsForSelectedBarangay.filter((report) => !filteredByPeriod.includes(report) || report.status === "Consolidated"),
    [reportsForSelectedBarangay, filteredByPeriod],
  );
  const readyReports = filteredByPeriod.filter((report) => report.status === "Ready to Consolidate");
  const enterpriseRows = useMemo(
    () => getEnterpriseReportRows(selectedReportEnterprises, filteredByPeriod, nonPeriodReports, query),
    [filteredByPeriod, nonPeriodReports, query, selectedReportEnterprises],
  );
  const missingReports = enterpriseRows.filter((row) => row.status === "Missing");
  const allReady =
    selectedReportEnterprises.length > 0 &&
    selectedReportEnterprises.every((enterprise) => filteredByPeriod.find((report) => report.enterpriseId === enterprise.id)?.status === "Ready to Consolidate");
  const allConsolidated =
    selectedReportEnterprises.length > 0 && selectedReportEnterprises.every((enterprise) => filteredByPeriod.find((report) => report.enterpriseId === enterprise.id)?.status === "Consolidated");

  const updateStatusMutation = useMutation({
    mutationFn: ({ report, status, remarks }: { report: IntakeReport; status: Extract<ReportStatus, "Ready to Consolidate" | "Returned">; remarks: string }) =>
      updateIntakeReportStatus(report.id, { status, remarks }),
    onSuccess: (updatedReport) => {
      queryClient.setQueryData<IntakeReport[]>(operationalReportsQueryKey, (current = []) => current.map((report) => (report.id === updatedReport.id ? updatedReport : report)));
      void queryClient.invalidateQueries({ queryKey: operationalReportsQueryKey });
      setSelectedReport(null);
      toast.success(`${updatedReport.code} updated to ${updatedReport.status}.`);
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error, "Report status could not be updated. Refresh the report list and try again."));
    },
  });

  const consolidateMutation = useMutation({
    mutationFn: async () => {
      if (!allReady || readyReports.length === 0) throw new Error("No ready reports available for consolidation.");
      const preparedBy = authUser?.displayName?.trim();
      if (!preparedBy) throw new Error("An authenticated preparer identity is required before generating a final report.");
      return createFinalReport({
        reportIds: readyReports.map((report) => report.id),
        preparedBy,
      });
    },
    onSuccess: (finalReport) => {
      void queryClient.invalidateQueries({ queryKey: operationalReportsQueryKey });
      void queryClient.invalidateQueries({ queryKey: operationalFinalReportsQueryKey });
      setIsGenerateConfirmOpen(false);
      toast.success(`${finalReport.id} generated for Final Reports Audit.`);
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error, "Final report could not be generated."));
    },
  });

  const handleGenerate = () => {
    if (!allReady || consolidateMutation.isPending) return;
    setIsGenerateConfirmOpen(true);
  };

  const confirmGenerate = () => {
    if (!allReady || consolidateMutation.isPending) return;
    consolidateMutation.mutate();
  };

  const handleAccept = (report: IntakeReport, remarks: string) => {
    if (report.status !== "Pending Review") {
      toast.error("Only reports pending review can be accepted.");
      return;
    }
    updateStatusMutation.mutate({
      report,
      status: "Ready to Consolidate",
      remarks: remarks.trim() || "Accepted for consolidation.",
    });
  };

  const handleReturn = (report: IntakeReport, remarks: string) => {
    if (report.status !== "Pending Review") {
      toast.error("Only reports pending review can be returned.");
      return;
    }
    updateStatusMutation.mutate({
      report,
      status: "Returned",
      remarks: remarks.trim() || "Returned for revision after staff review.",
    });
  };

  const isLoadingRows = reportEnterprisesQuery.isLoading || reportsQuery.isLoading;
  const loadError = reportEnterprisesQuery.isError || reportsQuery.isError;

  return (
    <PageMotion>
      <PageHeader title="Batch Reports" description="Enterprise-level compliance review before DOT report consolidation." />

      {loadError && <p className="mb-4 text-sm font-semibold text-red-600">Report intake data could not be loaded from the backend. Refresh or check the API connection.</p>}

      <BatchReportsMetrics
        reportEnterprises={selectedReportEnterprises}
        readyReports={readyReports}
        missingReports={missingReports}
        archivedReports={nonPeriodReports}
        isLoadingRegistry={isLoadingRows}
      />

      <Panel className="mt-6 overflow-hidden">
        <BatchReportsToolbar
          query={query}
          barangayFilter={barangayFilter}
          monthFilter={monthFilter}
          yearFilter={yearFilter}
          availableBarangays={availableBarangays}
          availableMonths={availableMonths}
          availableYears={availableYears}
          allReady={allReady && !consolidateMutation.isPending}
          onQueryChange={setQuery}
          onBarangayChange={setBarangayFilter}
          onMonthChange={setMonthFilter}
          onYearChange={setYearFilter}
          onGenerate={handleGenerate}
        />
        <BatchReportsStatusNotice
          allConsolidated={allConsolidated}
          allReady={allReady}
          filteredReportCount={filteredByPeriod.length}
          readyReportCount={readyReports.length}
          enterpriseCount={selectedReportEnterprises.length}
        />
        <BatchReportsTable rows={enterpriseRows} isLoading={isLoadingRows} onSelectEnterprise={setSelectedEnterprise} />
      </Panel>

      <AnimatePresence>
        {selectedEnterprise && (
          <EnterpriseReportsModal
            enterprise={selectedEnterprise}
            reports={reports.filter((report) => report.enterpriseId === selectedEnterprise.id)}
            onClose={() => setSelectedEnterprise(null)}
            onOpenReport={setSelectedReport}
          />
        )}
        {selectedReport && (
          <ReportReviewModal report={selectedReport} isUpdating={updateStatusMutation.isPending} onClose={() => setSelectedReport(null)} onAccept={handleAccept} onReturn={handleReturn} />
        )}
        {isGenerateConfirmOpen && (
          <ReportActionConfirmDialog
            title="Generate Final Report?"
            eyebrow="Final batch report"
            message="This will consolidate the accepted enterprise reports for the selected period and create a final report draft for audit. Source reports included in the batch will move forward in the workflow."
            tone="emerald"
            confirmLabel="Generate Final Report"
            pendingLabel="Generating..."
            isPending={consolidateMutation.isPending}
            isConfirmDisabled={!allReady || readyReports.length === 0}
            onCancel={() => setIsGenerateConfirmOpen(false)}
            onConfirm={confirmGenerate}
            details={[
              { label: "Period", value: `${monthFilter} ${yearFilter}` },
              { label: "Scope", value: barangayFilter === ALL_BARANGAYS_FILTER ? "All barangays" : barangayFilter },
              { label: "Reports", value: `${readyReports.length} ready submissions` },
              { label: "Enterprises", value: `${selectedReportEnterprises.length} covered enterprises` },
            ]}
          />
        )}
      </AnimatePresence>
    </PageMotion>
  );
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data && typeof error.response.data === "object" ? (error.response.data as { detail?: unknown }).detail : null;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
