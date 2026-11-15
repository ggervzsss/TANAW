import { useState, type Dispatch, type SetStateAction } from "react";
import { Files, History } from "lucide-react";
import { DotFormModal } from "./DotFormModal";
import { ReportDraftPanel } from "./ReportDraftPanel";
import { ReportLedgerTable } from "./ReportLedgerTable";
import { SubmitReportDialog } from "./SubmitReportDialog";
import type { Camera, ReportRecord } from "../../../types/enterprise";
import { useReportsWorkspace } from "../hooks/useReportsWorkspace";
import { validateDemographicAllocation } from "../model/report-workspace";
import { USE_MOCK_DATA } from "../../dashboard/data/dashboardMockData";
import { REPORTS_MOCK_DATA } from "../data/reportsMockData";
import { useMockReportsWorkspace } from "../hooks/useMockReportsWorkspace";

type ReportsViewProps = {
  cameras?: Camera[];
  enterpriseName: string;
  reportsHistory: ReportRecord[];
  setReportsHistory: Dispatch<SetStateAction<ReportRecord[]>>;
};

export function ReportsView(props: ReportsViewProps) {
  return USE_MOCK_DATA ? <MockReportsView /> : <RealReportsView {...props} />;
}
function RealReportsView({ enterpriseName, reportsHistory, setReportsHistory }: ReportsViewProps) {
  const workspace = useReportsWorkspace({ enterpriseName, reportsHistory, setReportsHistory });
  return <ReportsWorkspace workspace={workspace} />;
}
function MockReportsView() {
  const workspace = useMockReportsWorkspace();
  return <ReportsWorkspace workspace={workspace} isMock />;
}
function ReportsWorkspace({ workspace, isMock = false }: { workspace: ReturnType<typeof useReportsWorkspace>; isMock?: boolean }) {
  const [tab, setTab] = useState<"create" | "history">("create");
  const [reviewedKey, setReviewedKey] = useState("");
  const [previewedLedgerKey, setPreviewedLedgerKey] = useState<string | null>(null);
  const {
    enterpriseName,
    activeLedgerKey,
    activeReport,
    activeReportId,
    blockingMetricsError,
    demo,
    displayedMetrics,
    executeSubmit,
    handleDownloadReport,
    handlePreviewReport,
    handleSelectLedgerRow,
    isPeriodChanging,
    isReadOnly,
    isSubmitting,
    ledgerRows,
    notes,
    period,
    previewReport,
    previousDemo,
    refreshRevisionCounts,
    setDemo,
    setNotes,
    setPreviewReport,
    setShowConfirm,
    showConfirm,
    validationError,
  } = workspace;
  const reviewKey = JSON.stringify([period, activeReportId, demo, notes, displayedMetrics.unique, displayedMetrics.counting?.snapshot_version]);
  const selectTab = (next: "create" | "history") => {
    if (next === "create" && previewedLedgerKey) {
      const row = ledgerRows.find((item) => item.key === previewedLedgerKey);
      if (row && row.key !== activeLedgerKey) handleSelectLedgerRow(row);
      setPreviewedLedgerKey(null);
    }
    setTab(next);
  };

  return (
    <div className="tanaw-reports-workspace" data-reports-surface="var1-workspace" data-reports-source={isMock ? "mock" : "real"}>
      {previewReport && (
        <DotFormModal
          demo={previewReport.demo}
          enterpriseName={enterpriseName}
          metrics={previewReport.metrics}
          notes={previewReport.notes}
          period={previewReport.period}
          reportId={previewReport.reportId}
          validationMessage={validateDemographicAllocation(previewReport.metrics, previewReport.demo)}
          sampleDaily={previewReport.sampleDaily}
          attractionType={isMock ? REPORTS_MOCK_DATA.attractionType : undefined}
          onClose={() => {
            if (
              previewReport.reportId === (activeReportId ?? "TANAW-DRAFT") &&
              !validateDemographicAllocation(previewReport.metrics, previewReport.demo) &&
              JSON.stringify(previewReport.demo) === JSON.stringify(demo)
            )
              setReviewedKey(reviewKey);
            setPreviewReport(null);
          }}
        />
      )}

      {!isMock && showConfirm && <SubmitReportDialog isSubmitting={isSubmitting} onCancel={() => setShowConfirm(false)} onConfirm={executeSubmit} />}

      <div className="reports-heading">
        <div>
          <h1>Reports</h1>
          <p>Create and manage your monthly tourism reports.</p>
        </div>
      </div>

      {isMock && (
        <p className="report-mock-banner" role="status" title={REPORTS_MOCK_DATA.disclosure}>
          {REPORTS_MOCK_DATA.disclosure}
        </p>
      )}
      <div className="reports-tabs" role="tablist" aria-label="Reports workspace">
        {(
          [
            ["create", "Create Reports", Files],
            ["history", "Reports History", History],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            id={`reports-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`reports-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => selectTab(id)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "create" : event.key === "End" ? "history" : tab === "create" ? "history" : "create";
              selectTab(next);
              document.getElementById(`reports-tab-${next}`)?.focus();
            }}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div id="reports-panel-create" role="tabpanel" aria-labelledby="reports-tab-create" hidden={tab !== "create"} className="reports-tab-panel">
        <ReportDraftPanel
          enterpriseName={enterpriseName}
          attractionType={isMock ? REPORTS_MOCK_DATA.attractionType : undefined}
          reviewed={reviewedKey === reviewKey}
          isMock={isMock}
          activeReport={activeReport}
          activeReportId={activeReportId}
          demo={demo}
          isReadOnly={isReadOnly}
          isPeriodChanging={isPeriodChanging}
          metrics={displayedMetrics}
          metricsError={blockingMetricsError}
          notes={notes}
          period={period}
          previousDemo={previousDemo}
          validationError={validationError}
          onSubmitPrompt={() => setShowConfirm(true)}
          onReview={() =>
            setPreviewReport({
              demo,
              metrics: displayedMetrics,
              notes,
              period,
              reportId: activeReportId ?? "TANAW-DRAFT",
              sampleDaily: isMock ? [REPORTS_MOCK_DATA.current, ...REPORTS_MOCK_DATA.reports].find((record) => record.id === activeReportId)?.daily : undefined,
            })
          }
          onRefreshCounts={refreshRevisionCounts}
          setDemo={setDemo}
          setNotes={setNotes}
        />
      </div>
      <div id="reports-panel-history" role="tabpanel" aria-labelledby="reports-tab-history" hidden={tab !== "history"} className="reports-tab-panel">
        <ReportLedgerTable
          activeLedgerKey={previewedLedgerKey ?? activeLedgerKey}
          ledgerRows={ledgerRows}
          onDownloadReport={handleDownloadReport}
          onPreviewReport={handlePreviewReport}
          onSelectReport={(row) => {
            // Previewing alone must not replace a draft or start its persistence hooks.
            setPreviewedLedgerKey(row.key);
          }}
        />
      </div>
    </div>
  );
}
