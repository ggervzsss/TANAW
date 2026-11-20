import { FilterSelect, PageMotion } from "@/shared/components/ui";
import { PageHeader } from "@/shared/components/layout";
import { BatchReportQueues, MonthlyGenerationPanel, EnterpriseReportsModal, MonthlyReportDialog, ReportActionConfirmDialog, ReportReviewModal } from "../components";
import { useBatchReportsPage } from "../hooks";
import { ALL_BARANGAYS_FILTER } from "../model";

export function StaffBatchReportsPage() {
  const batch = useBatchReportsPage();
  const { barangay, month, query, year } = batch.pageState;
  const period = `${month} ${year}`;
  const coverage = barangay === ALL_BARANGAYS_FILTER ? "All barangays" : barangay;
  const { pending, followUp, ready, completed } = batch.queues;
  const missingCount = followUp.filter((row) => row.status === "Missing").length;

  return (
    <PageMotion>
      <PageHeader title="Batch Reports" description="Review submissions and generate DOT reports." />
      <MonthlyGenerationPanel
        period={{ month, year }}
        coverage={coverage}
        enterpriseCount={batch.enterpriseRows.length}
        readyCount={ready.length}
        pendingCount={pending.length}
        missingCount={missingCount}
        returnedCount={followUp.length - missingCount}
        completedCount={completed.length}
        isLoading={batch.isLoadingRows}
        isError={batch.loadError}
        canGenerate={batch.allReady}
        isGenerating={batch.consolidateMutation.isPending}
        onGenerate={() => batch.setIsGenerateConfirmOpen(true)}
      >
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <span className="text-sm font-semibold text-(--tanaw-text)">Reporting period</span>
          <FilterSelect ariaLabel="Report month" value={month} options={batch.availableMonths} onChange={(value) => batch.updatePageState({ month: value })} />
          <FilterSelect ariaLabel="Report year" value={year} options={batch.availableYears} onChange={(value) => batch.updatePageState({ year: value })} />
        </div>
        <FilterSelect
          ariaLabel="Barangay"
          value={barangay}
          options={[[ALL_BARANGAYS_FILTER, "All barangays"], ...batch.availableBarangays]}
          onChange={(value) => batch.updatePageState({ barangay: value })}
          searchable
        />
      </MonthlyGenerationPanel>

      <BatchReportQueues
        queues={batch.queues}
        query={query}
        isLoading={batch.isLoadingRows}
        isError={batch.loadError}
        onQueryChange={(value) => batch.updatePageState({ query: value })}
        onOpenReport={batch.setSelectedReport}
        onFollowUp={batch.setSelectedEnterprise}
      />
      {batch.selectedEnterprise && (
        <EnterpriseReportsModal
          enterprise={batch.selectedEnterprise}
          period={period}
          currentReport={batch.enterpriseRows.find((row) => row.enterprise.id === batch.selectedEnterprise?.id)?.currentReport}
          reports={batch.reports.filter((report) => report.enterpriseId === batch.selectedEnterprise?.id)}
          isOpen={!batch.selectedReport}
          onClose={() => batch.setSelectedEnterprise(null)}
          onOpenReport={batch.setSelectedReport}
        />
      )}
      {batch.selectedReport && (
        <ReportReviewModal
          key={batch.selectedReport.id}
          report={batch.selectedReport}
          isUpdating={batch.updateStatusMutation.isPending}
          onClose={() => batch.setSelectedReport(null)}
          onAccept={(report, remarks) => batch.reviewReport(report, remarks, "Ready to Consolidate")}
          onReturn={(report, remarks) => batch.reviewReport(report, remarks, "Returned")}
        />
      )}
      {batch.isGenerateConfirmOpen && (
        <ReportActionConfirmDialog
          title="Generate monthly report?"
          message={`Combine ${ready.length} ready ${ready.length === 1 ? "submission" : "submissions"} for ${period}${barangay === ALL_BARANGAYS_FILTER ? "" : ` in ${barangay}`} into a monthly VAR 2M report.`}
          confirmLabel="Generate monthly report"
          pendingLabel="Generating..."
          isPending={batch.consolidateMutation.isPending}
          isConfirmDisabled={!batch.allReady}
          onCancel={() => batch.setIsGenerateConfirmOpen(false)}
          onConfirm={() => batch.consolidateMutation.mutate()}
        />
      )}
      {batch.selectedMonthlyReport && <MonthlyReportDialog report={batch.selectedMonthlyReport} onClose={() => batch.setSelectedMonthlyReport(null)} />}
    </PageMotion>
  );
}
