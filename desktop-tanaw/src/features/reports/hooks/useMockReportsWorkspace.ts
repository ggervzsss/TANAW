import { useMemo, useState } from "react";
import { REPORTS_MOCK_DATA, sampleMetrics } from "../data/reportsMockData";
import type { useReportsWorkspace } from "./useReportsWorkspace";
import type { ReportLedgerRow } from "../model/report-ledger";
import { validateDemographicAllocation } from "../model/report-workspace";
import { downloadDotReportPdf } from "../utils/pdf";

type Workspace = ReturnType<typeof useReportsWorkspace>;
const records = [REPORTS_MOCK_DATA.current, ...REPORTS_MOCK_DATA.reports];

/** This branch has NO service hooks, persistence effects, IPC or submission callbacks. */
export function useMockReportsWorkspace(): Workspace {
  const [id, setId] = useState(REPORTS_MOCK_DATA.current.id);
  const activeReport = records.find((record) => record.id === id)!;
  const [drafts, setDrafts] = useState(() => Object.fromEntries(records.map((record) => [record.id, { ...record.demo }])));
  const [draftNotes, setDraftNotes] = useState(() => Object.fromEntries(records.map((record) => [record.id, record.notes ?? ""])));
  const notes = draftNotes[id];
  const [previewReport, setPreviewReport] = useState<Workspace["previewReport"]>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const demo = drafts[id];
  const displayedMetrics = sampleMetrics(activeReport);
  const isReadOnly = ["Submitted", "Resubmitted", "Consolidated"].includes(activeReport.status);
  const ledgerRows = useMemo<ReportLedgerRow[]>(
    () =>
      records.map((record) => ({
        key: record.id,
        kind: record.id === REPORTS_MOCK_DATA.current.id ? "current" : record.status === "Pending Submission" ? "pending" : "history",
        report: { ...record, demo: drafts[record.id], notes: draftNotes[record.id] },
        reportLabel: record.title,
        reportDescription: record.description,
        statusLabel: record.status,
      })),
    [drafts, draftNotes],
  );
  const preview: Workspace["handlePreviewReport"] = (report) => {
    const sample = records.find((record) => record.id === report.id);
    if (!sample) return;
    setPreviewReport({ demo: drafts[sample.id], metrics: sampleMetrics(sample), notes: draftNotes[sample.id], period: sample.period!, reportId: sample.id, sampleDaily: sample.daily });
  };
  return {
    enterpriseName: REPORTS_MOCK_DATA.enterpriseName,
    activeLedgerKey: id,
    activeReport,
    activeReportId: id,
    blockingMetricsError: "Mock data is for frontend visualization only. Real submission is disabled.",
    demo,
    displayedMetrics,
    isPeriodChanging: false,
    isReadOnly,
    isSubmitting: false,
    ledgerRows,
    notes,
    period: activeReport.period!,
    previewReport,
    previousDemo: REPORTS_MOCK_DATA.reports[0].demo,
    validationError: validateDemographicAllocation(displayedMetrics, demo),
    setDemo: (action) => setDrafts((current) => ({ ...current, [id]: typeof action === "function" ? action(current[id]) : action })),
    setNotes: (action) => setDraftNotes((current) => ({ ...current, [id]: typeof action === "function" ? action(current[id]) : action })),
    setPreviewReport,
    showConfirm,
    setShowConfirm,
    executeSubmit: async () => {
      setShowConfirm(false);
    },
    refreshRevisionCounts: async () => {},
    handleSelectLedgerRow: (row) => {
      setId(row.report.id);
      setPreviewReport(null);
    },
    handlePreviewReport: preview,
    handleDownloadReport: (report) => {
      const sample = records.find((record) => record.id === report.id);
      if (!sample) return;
      const metrics = sampleMetrics(sample);
      if (validateDemographicAllocation(metrics, drafts[sample.id])) {
        preview(report);
        return;
      }
      downloadDotReportPdf({
        enterpriseName: REPORTS_MOCK_DATA.enterpriseName,
        attractionType: REPORTS_MOCK_DATA.attractionType,
        reportId: sample.id,
        period: sample.period!,
        metrics,
        demo: drafts[sample.id],
        notes: draftNotes[sample.id],
        sampleDaily: sample.daily,
      });
    },
  };
}
