import { AlertTriangle, Archive, ArchiveRestore, CheckCircle, Download, Printer, X } from "lucide-react";
import { motion } from "motion/react";
import toast from "react-hot-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useState } from "react";
import { ModalPortal } from "@/shared/components/ui";
import { CITY_SEAL } from "@/shared/constants/branding";
import { operationalFinalReportsQueryKey, operationalReportsQueryKey } from "@/shared/hooks/useOperationalSync";
import { returnFinalReportForRevision, updateFinalReportStatus } from "@/shared/services/reporting";
import type { FinalReport, FinalReportArchivedFromStatus, FinalReportStatus } from "@/shared/types";
import { DotFinalReportTable } from "./DotReportTable";
import { ReportActionConfirmDialog } from "./ReportActionConfirmDialog";
import { downloadFinalReportPdf } from "../utils/pdf";

type FinalReportViewerProps = {
  report: FinalReport;
  onClose: () => void;
};

type FinalReportConfirmAction = "archive" | "finalize" | "restore" | "return" | null;

export function FinalReportViewer({ report, onClose }: FinalReportViewerProps) {
  const queryClient = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<FinalReportConfirmAction>(null);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [returnRemarks, setReturnRemarks] = useState("");
  const statusMutation = useMutation({
    mutationFn: (status: FinalReportStatus) => updateFinalReportStatus(report.id, { status }),
    onSuccess: (updatedReport) => {
      queryClient.setQueryData<FinalReport[]>(operationalFinalReportsQueryKey, (current = []) => current.map((item) => (item.id === updatedReport.id ? updatedReport : item)));
      void queryClient.invalidateQueries({ queryKey: operationalFinalReportsQueryKey });
    },
  });
  const returnMutation = useMutation({
    mutationFn: () =>
      returnFinalReportForRevision(report.id, {
        sourceReportIds: selectedSourceIds,
        remarks: returnRemarks.trim(),
      }),
    onSuccess: (updatedReport) => {
      queryClient.setQueryData<FinalReport[]>(operationalFinalReportsQueryKey, (current = []) => current.map((item) => (item.id === updatedReport.id ? updatedReport : item)));
      void queryClient.invalidateQueries({ queryKey: operationalFinalReportsQueryKey });
      void queryClient.invalidateQueries({ queryKey: operationalReportsQueryKey });
      toast.success(`${report.id} returned for source report revision.`);
      setConfirmAction(null);
      setShowReturnDialog(false);
      setSelectedSourceIds([]);
      setReturnRemarks("");
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Final report could not be returned for revision.")),
  });
  const downloadReport = () => downloadFinalReportPdf(report);
  const canSubmitReturn = selectedSourceIds.length > 0 && returnRemarks.trim().length >= 5 && !returnMutation.isPending;
  const selectedReturnSources = report.sources.filter((source) => selectedSourceIds.includes(source.id));
  const confirmCopy = confirmAction ? finalReportConfirmCopy(confirmAction, report) : null;
  const confirmDetails = confirmAction
    ? finalReportConfirmDetails({
        action: confirmAction,
        report,
        returnRemarks,
        selectedSources: selectedReturnSources,
      })
    : [];

  const requestArchive = () => {
    if (statusMutation.isPending) return;
    setConfirmAction("archive");
  };

  const requestFinalize = () => {
    if (statusMutation.isPending) return;
    setConfirmAction("finalize");
  };

  const requestRestore = () => {
    if (statusMutation.isPending) return;
    setConfirmAction("restore");
  };

  const confirmStatusAction = () => {
    if (statusMutation.isPending) return;
    const action = confirmAction;
    if (action !== "archive" && action !== "finalize" && action !== "restore") return;
    const restoreStatus = getRestoreStatus(report);
    const nextStatus: FinalReportStatus = action === "archive" ? "Archived" : action === "finalize" ? "Finalized" : restoreStatus;
    statusMutation.mutate(nextStatus, {
      onSuccess: () => {
        setConfirmAction(null);
        if (action === "archive") toast.success(`${report.id} has been moved to Archives.`);
        if (action === "finalize") toast.success(`${report.id} marked as Finalized. Ready for DOT handoff.`);
        if (action === "restore") toast.success(`${report.id} has been restored as ${restoreStatus}.`);
        onClose();
      },
      onError: () => toast.error("Final report status could not be updated."),
    });
  };

  const handleSourceToggle = (sourceId: string) => {
    setSelectedSourceIds((current) => (current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]));
  };

  const closeReturnDialog = () => {
    if (returnMutation.isPending) return;
    setConfirmAction(null);
    setShowReturnDialog(false);
    setSelectedSourceIds([]);
    setReturnRemarks("");
  };

  const handleReturnForRevision = () => {
    if (!canSubmitReturn) {
      toast.error("Select at least one source report and enter audit remarks.");
      return;
    }
    setConfirmAction("return");
  };

  return (
    <>
      <ModalPortal>
        <motion.div
          className="fixed inset-0 z-1300 flex items-center justify-center bg-[rgba(3,20,12,0.68)] p-4 backdrop-blur-[6px] print:bg-white print:p-0 print:backdrop-blur-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.section
            className="print-container relative z-1301 flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-[30px] border border-white/85 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.36)] ring-1 ring-black/4 print:max-h-none print:border-none print:shadow-none dark:border-slate-600 dark:bg-[#121c31] dark:shadow-[0_34px_100px_rgba(0,0,0,0.52)] dark:ring-white/8"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="print-hide flex items-center justify-between gap-4 border-b border-emerald-100/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.92)_0%,rgba(255,255,255,0.98)_54%,rgba(255,251,235,0.78)_100%)] p-4 text-black dark:border-slate-600 dark:bg-[linear-gradient(135deg,#0f2d3c_0%,#172033_54%,#312638_100%)] dark:text-slate-100">
              <div>
                <p className="text-[10px] font-bold tracking-[0.18em] text-emerald-700 uppercase">{report.id}</p>
                <h3 className="text-tanaw-navy mt-1 text-lg font-bold">Official Artifact Viewer</h3>
                <p className="text-xs font-semibold text-gray-500">LGU official format with data lineage.</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {report.status === "Archived" ? (
                  <button
                    type="button"
                    onClick={requestRestore}
                    disabled={statusMutation.isPending}
                    className="bg-tanaw-green hover:bg-tanaw-green/90 inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:cursor-wait disabled:opacity-60"
                  >
                    <ArchiveRestore size={15} /> Restore
                  </button>
                ) : (
                  <>
                    {report.status === "Draft" && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowReturnDialog(true)}
                          disabled={statusMutation.isPending}
                          className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
                        >
                          <AlertTriangle size={15} /> Return for Revision
                        </button>
                        <button
                          type="button"
                          onClick={requestFinalize}
                          disabled={statusMutation.isPending}
                          className="bg-tanaw-green hover:bg-tanaw-green/90 inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:cursor-wait disabled:opacity-60"
                        >
                          <CheckCircle size={15} /> Mark as Finalized
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={requestArchive}
                      disabled={statusMutation.isPending}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-wait disabled:opacity-60"
                    >
                      <Archive size={15} /> Archive
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={downloadReport}
                  className="text-tanaw-green inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:bg-emerald-50 dark:border-emerald-300/20 dark:bg-[#172033] dark:text-emerald-200 dark:hover:bg-emerald-500/10"
                >
                  <Download size={15} /> Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="text-tanaw-green inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:bg-emerald-50 dark:border-emerald-300/20 dark:bg-[#172033] dark:text-emerald-200 dark:hover:bg-emerald-500/10"
                >
                  <Printer size={15} /> Print to PDF
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close final report"
                  className="hover:text-tanaw-green flex h-9 w-9 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 dark:border-emerald-300/20 dark:bg-[#172033] dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-emerald-200"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="tanaw-document-preview flex grow flex-col overflow-y-auto bg-white p-8 text-black print:overflow-visible print:p-0">
              <div className="print-hide mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h4 className="mb-3 text-sm font-bold text-gray-800">Version History & Audit Trail</h4>
                <ul className="space-y-2 font-mono text-xs text-gray-600">
                  <li className="flex items-center justify-between border-b border-gray-200 pb-2">
                    <span>v1.0 Draft aggregated by System Pipeline</span>
                    <span>{report.generatedOn} 04:15 AM</span>
                  </li>
                  {report.status === "Finalized" || (report.status === "Archived" && report.archivedFromStatus === "Finalized") ? (
                    <li className="flex items-center justify-between pt-1">
                      <span>v1.1 Finalized and authorized by {report.preparedBy}</span>
                      <span>{report.generatedOn} 09:30 AM</span>
                    </li>
                  ) : (
                    <li className="flex items-center justify-between pt-1">
                      <span>{report.status === "Returned for Revision" ? "v1.1 Returned for source report revision" : "v1.1 Awaiting final audit decision"}</span>
                      <span>{report.generatedOn} 09:30 AM</span>
                    </li>
                  )}
                </ul>
              </div>

              <div className="mb-6 border-b-2 border-black pb-4 text-center">
                <img src={CITY_SEAL} className="mx-auto mb-3 h-16 w-16 grayscale" alt="San Pedro Seal" />
                <h1 className="font-serif text-lg font-bold tracking-widest uppercase">City Government of San Pedro</h1>
                <p className="mt-1 text-xs tracking-wider uppercase">Tourism & Economic Development Office</p>
                <h2 className="mt-5 text-xl font-bold underline">{report.title}</h2>
                <p className="mt-1 font-mono text-sm">Reporting Period: {report.period}</p>
              </div>

              <p className="mb-6 text-justify text-sm leading-relaxed">
                This document certifies the consolidated visitor analytics derived from TANAW live-count records for the stated period. Aggregation relies on verified local camera records from{" "}
                {report.enterpriseCount} monitored enterprise nodes.
              </p>

              <DotFinalReportTable report={report} />

              <div className="mt-auto pt-10">
                <div className="mb-8 flex items-end justify-between">
                  <Signature label="Prepared By" sub={report.preparedRole} />
                  <div className="h-24 w-48" aria-hidden="true" />
                </div>
                <div className="flex items-end justify-between">
                  <Signature label="Checked By" sub="Tourism Audit Officer" />
                  <Signature label="Approved By" sub="Head of Department" />
                </div>
              </div>
            </div>
          </motion.section>
        </motion.div>
      </ModalPortal>

      {showReturnDialog && report.status === "Draft" && (
        <ModalPortal>
          <motion.div
            className="print-hide fixed inset-0 z-1400 flex min-h-dvh items-center justify-center overflow-y-auto bg-[rgba(3,20,12,0.72)] p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="return-final-report-title"
              className="relative z-1401 my-auto max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-hidden rounded-[28px] border border-red-100 bg-white text-slate-950 shadow-[0_34px_100px_rgba(20,2,2,0.36)] ring-1 ring-red-950/5 dark:border-red-300/25 dark:bg-[#121c31] dark:text-slate-100 dark:shadow-[0_34px_100px_rgba(0,0,0,0.52)] dark:ring-white/8"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <div className="h-1.5 bg-linear-to-r from-red-700 via-red-500 to-amber-400" />
              <header className="flex items-start justify-between gap-4 border-b border-red-100 bg-red-50/70 px-6 py-5 max-sm:px-5 dark:border-red-300/25 dark:bg-red-500/10">
                <div className="min-w-0">
                  <p className="mb-1 font-mono text-[10px] font-bold tracking-[0.18em] text-red-700 uppercase">{report.id}</p>
                  <h2 id="return-final-report-title" className="text-tanaw-navy text-xl leading-tight font-bold">
                    Return Final Report for Revision
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-red-800">
                    Select the source reports that need enterprise correction. Unselected reports will move back to Ready to Consolidate.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeReturnDialog}
                  disabled={returnMutation.isPending}
                  aria-label="Close return for revision dialog"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-100 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-300/25 dark:bg-[#172033] dark:text-slate-200 dark:hover:bg-red-500/10 dark:hover:text-red-200"
                >
                  <X size={19} />
                </button>
              </header>

              <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto px-6 py-5 max-sm:px-5">
                <div className="grid max-h-[38vh] gap-2 overflow-y-auto pr-1">
                  {report.sources.map((source) => (
                    <label key={source.id} className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-red-100 bg-white px-4 py-3 text-sm shadow-sm transition hover:border-red-200 hover:bg-red-50/60 dark:border-slate-700 dark:bg-[#172033] dark:hover:border-red-300/30 dark:hover:bg-red-500/10">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-900">{source.enterprise}</span>
                        <span className="mt-0.5 block font-mono text-xs text-slate-500">
                          {source.code} | Unique: {source.unique.toLocaleString()}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={selectedSourceIds.includes(source.id)}
                        onChange={() => handleSourceToggle(source.id)}
                        disabled={returnMutation.isPending}
                        className="h-4 w-4 shrink-0 accent-red-600"
                      />
                    </label>
                  ))}
                </div>

                <label className="mt-5 block">
                  <span className="text-xs font-bold tracking-[0.16em] text-red-800 uppercase">Audit remarks</span>
                  <textarea
                    value={returnRemarks}
                    onChange={(event) => setReturnRemarks(event.target.value)}
                    rows={4}
                    disabled={returnMutation.isPending}
                    className="mt-2 w-full resize-none rounded-xl border border-red-200 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                    placeholder="Describe the discrepancy and what the enterprise needs to correct."
                  />
                </label>
              </div>

              <footer className="flex flex-wrap justify-end gap-3 border-t border-red-100 bg-white px-6 py-4 max-sm:px-5 dark:border-red-300/25 dark:bg-[#121c31]">
                <button
                  type="button"
                  onClick={closeReturnDialog}
                  disabled={returnMutation.isPending}
                  className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleReturnForRevision}
                  disabled={!canSubmitReturn}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-200"
                >
                  <AlertTriangle size={15} /> {returnMutation.isPending ? "Returning..." : "Confirm Return for Revision"}
                </button>
              </footer>
            </motion.section>
          </motion.div>
        </ModalPortal>
      )}

      {confirmCopy && (
        <ReportActionConfirmDialog
          title={confirmCopy.title}
          eyebrow={confirmCopy.eyebrow}
          message={confirmCopy.message}
          tone={confirmCopy.tone}
          confirmLabel={confirmCopy.confirmLabel}
          pendingLabel={confirmCopy.pendingLabel}
          isPending={confirmAction === "return" ? returnMutation.isPending : statusMutation.isPending}
          isConfirmDisabled={confirmAction === "return" ? !canSubmitReturn : false}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            if (confirmAction === "return") {
              if (!canSubmitReturn) {
                toast.error("Select at least one source report and enter audit remarks.");
                return;
              }
              returnMutation.mutate();
              return;
            }
            confirmStatusAction();
          }}
          details={confirmDetails}
        />
      )}
    </>
  );
}

function finalReportConfirmCopy(action: Exclude<FinalReportConfirmAction, null>, report: FinalReport) {
  if (action === "finalize") {
    return {
      title: "Finalize draft report?",
      eyebrow: "Final audit decision",
      message: "This will mark the consolidated draft as Finalized and ready for official DOT handoff. Further source-report corrections should be handled before this action.",
      tone: "emerald" as const,
      confirmLabel: "Finalize Report",
      pendingLabel: "Finalizing...",
    };
  }

  if (action === "archive") {
    return {
      title: "Archive final report?",
      eyebrow: "Archive report",
      message: "This will move the final report out of the active audit list while preserving its current workflow status for restoration.",
      tone: "amber" as const,
      confirmLabel: "Archive Report",
      pendingLabel: "Archiving...",
    };
  }

  if (action === "restore") {
    const restoreStatus = getRestoreStatus(report);
    return {
      title: "Restore archived report?",
      eyebrow: "Restore report",
      message: `This will return the archived report to the active audit workflow as ${restoreStatus}.`,
      tone: "emerald" as const,
      confirmLabel: "Restore Report",
      pendingLabel: "Restoring...",
    };
  }

  return {
    title: "Return sources for revision?",
    eyebrow: "Source revision",
    message: "This will return the selected enterprise source reports for correction. Unselected source reports will remain ready for consolidation.",
    tone: "red" as const,
    confirmLabel: "Return for Revision",
    pendingLabel: "Returning...",
  };
}

function finalReportConfirmDetails({
  action,
  report,
  returnRemarks,
  selectedSources,
}: {
  action: Exclude<FinalReportConfirmAction, null>;
  report: FinalReport;
  returnRemarks: string;
  selectedSources: FinalReport["sources"];
}) {
  if (action === "return") {
    return [
      { label: "Final Report", value: report.id },
      { label: "Period", value: report.period },
      {
        label: "Sources",
        value: selectedSources.length > 0 ? selectedSources.map((source) => `${source.code} (${source.enterprise})`).join(", ") : "No source reports selected.",
      },
      { label: "Remarks", value: returnRemarks.trim() },
    ];
  }

  return [
    { label: "Final Report", value: report.id },
    { label: "Period", value: report.period },
    { label: "Current Status", value: report.status },
    { label: "Next Status", value: action === "archive" ? "Archived" : action === "finalize" ? "Finalized" : getRestoreStatus(report) },
  ];
}

function Signature({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="w-56 text-center">
      <div className="flex h-8 items-end justify-center border-b border-black" />
      <p className="mt-2 text-xs font-bold tracking-wide uppercase">{label}</p>
      <p className="mt-1 text-[10px] text-gray-500">{sub}</p>
    </div>
  );
}

function getRestoreStatus(report: FinalReport): FinalReportArchivedFromStatus {
  return report.archivedFromStatus ?? "Finalized";
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data && typeof error.response.data === "object" ? (error.response.data as { detail?: unknown }).detail : null;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}
