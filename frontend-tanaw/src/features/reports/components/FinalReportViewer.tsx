import { AlertTriangle, Archive, ArchiveRestore, CheckCircle, Download, Maximize2, Minimize2, X } from "lucide-react";
import { motion } from "motion/react";
import { ModalPortal } from "@/shared/components/ui";
import type { FinalReport } from "@/shared/types";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { DotFinalReportTable } from "./DotReportTable";
import { ReportActionConfirmDialog } from "./ReportActionConfirmDialog";
import { useFinalReportViewer } from "../hooks";

type FinalReportViewerProps = {
  report: FinalReport;
  onClose: () => void;
};

export function FinalReportViewer({ report, onClose }: FinalReportViewerProps) {
  const {
    canSubmitReturn,
    closeReturnDialog,
    confirmAction,
    confirmActionRequest,
    confirmCopy,
    confirmDetails,
    downloadReport,
    handleReturnForRevision,
    isFullscreen,
    returnMutation,
    returnRemarks,
    selectedSourceIds,
    setConfirmAction,
    setIsFullscreen,
    setReturnRemarks,
    setShowReturnDialog,
    showReturnDialog,
    statusMutation,
    timeFormat,
    toggleSource,
    viewerLayout,
    viewerRef,
  } = useFinalReportViewer(report, onClose);

  return (
    <>
      <ModalPortal>
        <motion.div
          className={`fixed inset-0 z-1300 flex items-center justify-center bg-[rgba(3,20,12,0.68)] backdrop-blur-[6px] ${viewerLayout.backdrop}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.section
            ref={viewerRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${report.id} official artifact viewer`}
            className={`relative z-1301 flex w-full flex-col overflow-hidden border-white/85 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.36)] ring-1 ring-black/4 transition-[width,height,max-width,max-height,border-radius] duration-200 dark:border-slate-600 dark:bg-[#121c31] dark:shadow-[0_34px_100px_rgba(0,0,0,0.52)] dark:ring-white/8 ${viewerLayout.panel}`}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="flex items-center justify-between gap-4 border-b border-emerald-100/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.92)_0%,rgba(255,255,255,0.98)_54%,rgba(255,251,235,0.78)_100%)] p-4 text-black dark:border-slate-600 dark:bg-[linear-gradient(135deg,#0f2d3c_0%,#172033_54%,#312638_100%)] dark:text-slate-100">
              <div>
                <p className="text-[10px] font-bold tracking-[0.18em] text-emerald-700 uppercase">{report.id}</p>
                <h3 className="text-tanaw-navy mt-1 text-lg font-bold">Official Artifact Viewer</h3>
                <p className="text-xs font-semibold text-gray-500">LGU official format with data lineage.</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {report.status === "Archived" ? (
                  <button
                    type="button"
                    onClick={() => setConfirmAction("restore")}
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
                          onClick={() => setConfirmAction("finalize")}
                          disabled={statusMutation.isPending}
                          className="bg-tanaw-green hover:bg-tanaw-green/90 inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:cursor-wait disabled:opacity-60"
                        >
                          <CheckCircle size={15} /> Mark as Finalized
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmAction("archive")}
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
                  onClick={() => setIsFullscreen((current) => !current)}
                  aria-label={isFullscreen ? "Exit fullscreen report view" : "Open fullscreen report view"}
                  aria-pressed={isFullscreen}
                  title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  className="hover:text-tanaw-green flex h-9 w-9 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 dark:border-emerald-300/20 dark:bg-[#172033] dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-emerald-200"
                >
                  {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
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

            <div className="tanaw-document-preview flex grow flex-col overflow-y-auto bg-white p-8 text-black">
              <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h4 className="mb-3 text-sm font-bold text-gray-800">Report History</h4>
                <ul className="space-y-2 font-mono text-xs text-gray-600">
                  <li className="flex items-center justify-between border-b border-gray-200 pb-2">
                    <span>v1.0 Draft combined by TANAW</span>
                    <span>{formatPhilippineDateTime(report.generatedOn, timeFormat, { dateStyle: "medium" })}</span>
                  </li>
                  {report.status === "Finalized" || (report.status === "Archived" && report.archivedFromStatus === "Finalized") ? (
                    <li className="flex items-center justify-between pt-1">
                      <span>v1.1 Finalized and authorized by {report.preparedBy}</span>
                      <span>{formatPhilippineDateTime(report.generatedOn, timeFormat, { dateStyle: "medium" })}</span>
                    </li>
                  ) : (
                    <li className="flex items-center justify-between pt-1">
                      <span>{report.status === "Returned for Revision" ? "v1.1 Returned for source report revision" : "v1.1 Awaiting final audit decision"}</span>
                      <span>{formatPhilippineDateTime(report.generatedOn, timeFormat, { dateStyle: "medium" })}</span>
                    </li>
                  )}
                </ul>
              </div>

              <div className="mb-6 border-b-2 border-black pb-4 text-center">
                <h1 className="font-serif text-lg font-bold tracking-widest uppercase">City Government of San Pedro</h1>
                <p className="mt-1 text-xs tracking-wider uppercase">Tourism & Economic Development Office</p>
                <h2 className="mt-5 text-xl font-bold underline">{report.title}</h2>
                <p className="mt-1 font-mono text-sm">Reporting Period: {report.period}</p>
                <p className="mt-2 font-mono text-[10px] tracking-widest uppercase">{report.id}</p>
              </div>

              <div className="mb-6 grid gap-x-8 gap-y-3 text-xs sm:grid-cols-2">
                <DocumentDetail label="Generated On" value={formatPhilippineDateTime(report.generatedOn, timeFormat, { dateStyle: "medium" })} />
                <DocumentDetail label="Prepared By" value={`${report.preparedBy} (${report.preparedRole})`} />
                <DocumentDetail label="Audit Status" value={report.status} />
                <DocumentDetail label="Enterprise Reports" value={String(report.enterpriseCount)} />
              </div>

              <p className="mb-6 text-justify text-sm leading-relaxed">
                This document certifies the consolidated visitor analytics derived from TANAW live-count records for the stated period. Aggregation relies on verified local camera records from{" "}
                {report.enterpriseCount} enterprise reports.
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
            className="fixed inset-0 z-1400 flex min-h-dvh items-center justify-center overflow-y-auto bg-[rgba(3,20,12,0.72)] p-4 backdrop-blur-sm"
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
                    <label
                      key={source.id}
                      className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-red-100 bg-white px-4 py-3 text-sm shadow-sm transition hover:border-red-200 hover:bg-red-50/60 dark:border-slate-700 dark:bg-[#172033] dark:hover:border-red-300/30 dark:hover:bg-red-500/10"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-900">{source.enterprise}</span>
                        <span className="mt-0.5 block font-mono text-xs text-slate-500">
                          {source.code} | Unique: {source.unique.toLocaleString()}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={selectedSourceIds.includes(source.id)}
                        onChange={() => toggleSource(source.id)}
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
                    className="mt-2 w-full resize-none rounded-xl border border-red-200 bg-white p-3 text-sm text-slate-900 transition outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-slate-50"
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
          onConfirm={confirmActionRequest}
          details={confirmDetails}
        />
      )}
    </>
  );
}

function DocumentDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-bold tracking-wider text-gray-500 uppercase">{label}</p>
      <p className="mt-0.5 font-semibold wrap-break-word">{value}</p>
    </div>
  );
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
