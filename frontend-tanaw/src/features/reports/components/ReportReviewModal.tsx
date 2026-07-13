import axios from "axios";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, RotateCcw, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import toast from "react-hot-toast/headless";
import { ModalPortal } from "@/shared/components/ui";
import { useEnterpriseReportDetail } from "@/shared/hooks/useReportWorkflow";
import { reportWorkflowQueryKey, transitionEnterpriseReport } from "@/shared/services/reporting";
import type { EnterpriseReportDetail, ReportTransitionAction } from "@/shared/types";
import { downloadEnterpriseReportPdf } from "../utils/pdf";
import { readableToken } from "../utils/reportWorkflow";
import { ReportActionConfirmDialog } from "./ReportActionConfirmDialog";
import { ReportMetricTable } from "./ReportFactTables";
import { ReportStatusBadge } from "./ReportStatusBadge";

type ReportReviewModalProps = {
  enterpriseReportId: string;
  onClose: () => void;
};

export function ReportReviewModal({ enterpriseReportId, onClose }: ReportReviewModalProps) {
  const queryClient = useQueryClient();
  const detailQuery = useEnterpriseReportDetail(enterpriseReportId);
  const report = detailQuery.data;
  const [reason, setReason] = useState("");
  const [pendingAction, setPendingAction] = useState<ReportTransitionAction | null>(null);
  const transition = useMutation({
    mutationFn: ({ current, action }: { current: EnterpriseReportDetail; action: ReportTransitionAction }) => {
      const commandId = crypto.randomUUID();
      return transitionEnterpriseReport(current.enterpriseReportId, {
        contractVersion: 2,
        commandId,
        expectedVersion: current.logicalVersion,
        action,
        reason: action === "accept_revision" ? reason.trim() || null : reason.trim(),
      });
    },
    onSuccess: async (acknowledgement) => {
      await queryClient.invalidateQueries({ queryKey: reportWorkflowQueryKey });
      setPendingAction(null);
      setReason("");
      toast.success(`Report is now ${readableToken(acknowledgement.resource.workflowState)}.`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "The report transition could not be applied. Refresh the authoritative detail and try again.")),
  });

  const requestAction = (action: ReportTransitionAction) => {
    if (!report || transition.isPending) return;
    if (action !== "accept_revision" && !reason.trim()) {
      toast.error("An audit reason is required for this transition.");
      return;
    }
    setPendingAction(action);
  };

  return (
    <>
      <ModalPortal>
        <motion.div className="fixed inset-0 z-1300 flex items-center justify-center bg-[rgba(3,20,12,0.68)] p-4 backdrop-blur-[6px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="Enterprise report review"
            className="relative z-1301 flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-white/85 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.36)]"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-emerald-100 bg-emerald-50/70 px-6 py-5">
              <div>
                <p className="font-mono text-[10px] font-bold tracking-[0.18em] text-emerald-700 uppercase">{enterpriseReportId}</p>
                <h2 className="text-tanaw-navy mt-1 text-xl font-bold">Authoritative Report Evidence</h2>
                <p className="mt-1 text-sm text-slate-600">The selected ID is resolved through the v2 detail resource; list rows are never used as the audit record.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close report review" className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500"><X size={19} /></button>
            </header>

            <div className="overflow-y-auto px-6 py-5">
              {detailQuery.isLoading && <StateNotice tone="neutral" text="Loading the authoritative report detail…" />}
              {detailQuery.isError && <StateNotice tone="error" text="The authoritative report detail could not be loaded. No cached list row is shown as a fallback." />}
              {report && (
                <div className="space-y-6">
                  <section className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Detail label="Enterprise" value={`${report.enterprise.enterpriseName} (${report.enterprise.enterpriseCode})`} />
                    <Detail label="Site" value={`${report.site.siteName} (${report.site.siteCode})`} />
                    <Detail label="Reporting period" value={report.reportingPeriod.label} />
                    <div><p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">Workflow state</p><div className="mt-2"><ReportStatusBadge status={report.workflowState} /></div></div>
                    <Detail label="Current revision" value={`Revision ${report.currentRevision.revisionNumber} · ${report.currentRevisionId}`} mono />
                    <Detail label="Evidence" value={`${readableToken(report.currentRevision.evidenceStatus)} · ${readableToken(report.currentRevision.coverage.evidenceStatus)}`} />
                    <Detail label="Obligation" value={`${readableToken(report.obligation.eligibilityStatus)} · ${readableToken(report.obligation.eligibilityBasis)}`} />
                    <Detail label="Official totals" value={report.includedInOfficialTotals ? "Included" : "Excluded"} />
                  </section>

                  {(report.acceptanceBlocked || report.currentRevision.acceptanceBlocked) && (
                    <StateNotice tone="error" text="Acceptance is blocked by unresolved obligation or evidence rules. TANAW will not offer an accept action." />
                  )}

                  <ReportMetricTable report={report} />

                  <section>
                    <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Coverage gaps</h3>
                    {report.currentRevision.coverage.evidenceStatus === "not_recorded" ? (
                      <StateNotice tone="warning" text="Coverage evidence was not recorded. Missing evidence is shown explicitly and is not treated as zero gaps." />
                    ) : report.currentRevision.coverage.gaps.length === 0 ? (
                      <StateNotice tone="success" text="The recorded coverage evidence contains no gaps." />
                    ) : (
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {report.currentRevision.coverage.gaps.map((gap, index) => <li key={`${gap.reason}-${gap.durationSeconds}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{readableToken(gap.reason)} · {gap.durationSeconds.toLocaleString()} seconds</li>)}
                      </ul>
                    )}
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Immutable review events</h3>
                    <ol className="space-y-2">
                      {report.reviewEvents.map((event) => (
                        <li key={event.reviewEventId} className="rounded-xl border border-slate-200 p-3 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{readableToken(event.eventType)}</strong><span>{formatTimestamp(event.occurredAt)}</span></div>
                          <p className="mt-1 text-slate-600">{event.actor.displayName ?? "Actor not recorded"} · {event.actor.role ?? "Role not recorded"} · version {event.expectedVersion} → {event.resultingVersion}</p>
                          {event.reason && <p className="mt-1 text-slate-700">Reason: {event.reason}</p>}
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>
              )}
            </div>

            {report && (
              <footer className="flex flex-wrap items-end justify-between gap-4 border-t border-slate-200 bg-slate-50 px-6 py-4">
                <div className="min-w-64 grow">
                  <label htmlFor="report-transition-reason" className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">Audit reason</label>
                  <textarea id="report-transition-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={2000} placeholder="Required when returning or reopening" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => downloadEnterpriseReportPdf(report)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold"><Download size={15} /> Snapshot PDF</button>
                  {report.workflowState === "submitted" && (
                    <>
                      <button type="button" disabled={transition.isPending} onClick={() => requestAction("return_for_correction")} className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Return</button>
                      <button type="button" disabled={transition.isPending || report.acceptanceBlocked || report.currentRevision.acceptanceBlocked} onClick={() => requestAction("accept_revision")} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Accept exact revision</button>
                    </>
                  )}
                  {report.workflowState === "accepted" && <button type="button" disabled={transition.isPending} onClick={() => requestAction("reopen_before_finalization")} className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50"><RotateCcw size={15} /> Reopen before finalization</button>}
                </div>
              </footer>
            )}
          </motion.section>
        </motion.div>
      </ModalPortal>

      {pendingAction && report && (
        <ReportActionConfirmDialog
          title={actionTitle(pendingAction)}
          eyebrow="Version-checked transition"
          message={`Apply ${readableToken(pendingAction)} to revision ${report.currentRevisionId} at logical version ${report.logicalVersion}?`}
          tone={pendingAction === "accept_revision" ? "emerald" : "red"}
          confirmLabel="Apply transition"
          pendingLabel="Applying…"
          isPending={transition.isPending}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => transition.mutate({ current: report, action: pendingAction })}
          details={[{ label: "Enterprise", value: report.enterprise.enterpriseName }, { label: "Revision", value: report.currentRevisionId }, { label: "Expected version", value: String(report.logicalVersion) }, { label: "Reason", value: reason.trim() || "No optional reason recorded" }]}
        />
      )}
    </>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">{label}</p><p className={`mt-1 wrap-break-word text-sm font-semibold text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{value}</p></div>;
}

function StateNotice({ tone, text }: { tone: "neutral" | "error" | "warning" | "success"; text: string }) {
  const classes = { neutral: "border-slate-200 bg-slate-50 text-slate-700", error: "border-red-200 bg-red-50 text-red-800", warning: "border-amber-200 bg-amber-50 text-amber-800", success: "border-emerald-200 bg-emerald-50 text-emerald-800" }[tone];
  return <p className={`rounded-xl border p-4 text-sm ${classes}`}>{text}</p>;
}

function actionTitle(action: ReportTransitionAction) {
  if (action === "accept_revision") return "Accept this exact revision?";
  if (action === "return_for_correction") return "Return this report for correction?";
  return "Reopen this accepted report?";
}

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(timestamp) : value;
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data && typeof error.response.data === "object" ? (error.response.data as { detail?: unknown }).detail : null;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") return detail.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
