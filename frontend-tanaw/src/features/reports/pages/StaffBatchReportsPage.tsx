import { AnimatePresence } from "motion/react";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { BatchReportsMetrics, BatchReportsStatusNotice, BatchReportsTable, BatchReportsToolbar, EnterpriseReportsModal, ReportActionConfirmDialog, ReportReviewModal } from "../components";
import { useBatchReportsPage } from "../hooks";
import { ALL_BARANGAYS_FILTER } from "../model";

export function StaffBatchReportsPage() {
  const batch = useBatchReportsPage();
  const { barangay, month, query, year } = batch.pageState;

  return (
    <PageMotion>
      <PageHeader title="Batch Reports" description="Enterprise-level compliance review before DOT report consolidation." />
      {batch.loadError && <p className="mb-4 text-sm font-semibold text-red-600">Report intake data could not be loaded from the backend. Refresh or check the API connection.</p>}
      <BatchReportsMetrics
        reportEnterprises={batch.selectedReportEnterprises}
        readyReports={batch.readyReports}
        missingReports={batch.missingReports}
        archivedReports={batch.nonPeriodReports}
        isLoadingRegistry={batch.isLoadingRows}
      />
      <Panel className="mt-6 overflow-hidden">
        <BatchReportsToolbar
          query={query}
          barangayFilter={barangay}
          monthFilter={month}
          yearFilter={year}
          availableBarangays={batch.availableBarangays}
          availableMonths={batch.availableMonths}
          availableYears={batch.availableYears}
          allReady={batch.allReady && !batch.consolidateMutation.isPending}
          onQueryChange={(value) => batch.updatePageState({ query: value })}
          onBarangayChange={(value) => batch.updatePageState({ barangay: value })}
          onMonthChange={(value) => batch.updatePageState({ month: value })}
          onYearChange={(value) => batch.updatePageState({ year: value })}
          onGenerate={() => batch.setIsGenerateConfirmOpen(true)}
        />
        <BatchReportsStatusNotice
          allConsolidated={batch.allConsolidated}
          allReady={batch.allReady}
          filteredReportCount={batch.filteredByPeriod.length}
          readyReportCount={batch.readyReports.length}
          enterpriseCount={batch.selectedReportEnterprises.length}
        />
        <BatchReportsTable rows={batch.enterpriseRows} isLoading={batch.isLoadingRows} onSelectEnterprise={batch.setSelectedEnterprise} />
      </Panel>
      <AnimatePresence>
        {batch.selectedEnterprise && (
          <EnterpriseReportsModal
            enterprise={batch.selectedEnterprise}
            reports={batch.reports.filter((report) => report.enterpriseId === batch.selectedEnterprise?.id)}
            onClose={() => batch.setSelectedEnterprise(null)}
            onOpenReport={batch.setSelectedReport}
          />
        )}
        {batch.selectedReport && (
          <ReportReviewModal
            report={batch.selectedReport}
            isUpdating={batch.updateStatusMutation.isPending}
            onClose={() => batch.setSelectedReport(null)}
            onAccept={(report, remarks) => batch.reviewReport(report, remarks, "Ready to Consolidate")}
            onReturn={(report, remarks) => batch.reviewReport(report, remarks, "Returned")}
          />
        )}
        {batch.isGenerateConfirmOpen && (
          <ReportActionConfirmDialog
            title="Generate Final Report?"
            eyebrow="Final batch report"
            message="This will consolidate the accepted enterprise reports for the selected period and create a final report draft for audit. Source reports included in the batch will move forward in the workflow."
            tone="emerald"
            confirmLabel="Generate Final Report"
            pendingLabel="Generating..."
            isPending={batch.consolidateMutation.isPending}
            isConfirmDisabled={!batch.allReady || !batch.readyReports.length}
            onCancel={() => batch.setIsGenerateConfirmOpen(false)}
            onConfirm={() => batch.consolidateMutation.mutate()}
            details={[
              { label: "Period", value: `${month} ${year}` },
              { label: "Scope", value: barangay === ALL_BARANGAYS_FILTER ? "All barangays" : barangay },
              { label: "Reports", value: `${batch.readyReports.length} ready submissions` },
              { label: "Enterprises", value: `${batch.selectedReportEnterprises.length} covered enterprises` },
            ]}
          />
        )}
      </AnimatePresence>
    </PageMotion>
  );
}
