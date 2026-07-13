import { Download, Printer, ShieldCheck, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { useFinalReportDetail } from "@/shared/hooks/useReportWorkflow";
import { ModalPortal } from "@/shared/components/ui";
import { CITY_SEAL } from "@/shared/constants/branding";
import { downloadFinalReportSnapshotPdf } from "../utils/pdf";
import { readableToken } from "../utils/reportWorkflow";
import { FinalSnapshotFactTable } from "./ReportFactTables";
import { ReportStatusBadge } from "./ReportStatusBadge";

type FinalReportViewerProps = {
  reportFinalizationId: string;
  onClose: () => void;
};

export function FinalReportViewer({ reportFinalizationId, onClose }: FinalReportViewerProps) {
  const [requestedVersionId, setRequestedVersionId] = useState<string | undefined>();
  const detailQuery = useFinalReportDetail(reportFinalizationId, requestedVersionId);
  const report = detailQuery.data;

  return (
    <ModalPortal>
      <motion.div className="fixed inset-0 z-1300 flex items-center justify-center bg-[rgba(3,20,12,0.68)] p-4 backdrop-blur-[6px] print:bg-white print:p-0 print:backdrop-blur-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.section
          role="dialog"
          aria-modal="true"
          aria-label="Immutable final report"
          className="print-container relative z-1301 flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-white/85 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.36)] print:max-h-none print:border-none print:shadow-none"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
        >
          <header className="print-hide flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/70 px-6 py-4">
            <div><p className="font-mono text-[10px] font-bold tracking-[0.18em] text-emerald-700 uppercase">{reportFinalizationId}</p><h2 className="text-tanaw-navy mt-1 text-lg font-bold">Immutable Final Report Audit</h2></div>
            <div className="flex flex-wrap items-center gap-2">
              {report && (
                <label className="text-xs font-semibold text-slate-600">Version <select value={report.selectedVersionId} onChange={(event) => setRequestedVersionId(event.target.value)} className="ml-1 rounded-lg border border-slate-300 bg-white px-2 py-2">{report.versions.map((version) => <option key={version.finalReportVersionId} value={version.finalReportVersionId}>v{version.versionNumber} · {version.disposition}</option>)}</select></label>
              )}
              <button type="button" disabled={!report} onClick={() => report && downloadFinalReportSnapshotPdf(report)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50"><Download size={15} /> Snapshot PDF</button>
              <button type="button" disabled={!report} onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50"><Printer size={15} /> Print</button>
              <button type="button" onClick={onClose} aria-label="Close final report" className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500"><X size={20} /></button>
            </div>
          </header>

          <div className="tanaw-document-preview overflow-y-auto bg-white p-8 text-black print:overflow-visible print:p-0">
            {detailQuery.isLoading && <Notice text="Loading the requested immutable version…" />}
            {detailQuery.isError && <Notice error text="The requested immutable final-report version could not be loaded. TANAW will not substitute a list row or another version." />}
            {report && (
              <div className="space-y-7">
                <div className="border-b-2 border-black pb-4 text-center">
                  <img src={CITY_SEAL} className="mx-auto mb-3 h-16 w-16 grayscale" alt="San Pedro Seal" />
                  <h1 className="font-serif text-lg font-bold tracking-widest uppercase">City Government of San Pedro</h1>
                  <p className="mt-1 text-xs tracking-wider uppercase">Tourism & Economic Development Office</p>
                  <h2 className="mt-5 text-xl font-bold underline">Official TANAW Consolidated Report</h2>
                  <p className="mt-1 font-mono text-sm">{report.reportCode} · {report.reportingPeriod.label}</p>
                </div>

                <section className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="Selected version" value={`v${report.selectedVersion.versionNumber} · ${report.selectedVersion.disposition}`} badge={report.selectedVersion.disposition} />
                  <Detail label="Scope" value={`${report.selectedVersion.scope.label} · ${readableToken(report.selectedVersion.scope.type)}`} />
                  <Detail label="Prepared by" value={`${report.selectedVersion.preparedBy.name} · ${report.selectedVersion.preparedBy.role}`} />
                  <Detail label="Finalized at" value={formatTimestamp(report.selectedVersion.finalizedAt)} />
                  <Detail label="Source count" value={String(report.selectedVersion.sourceCount)} />
                  <Detail label="Scope members" value={String(report.selectedVersion.scope.memberCount)} />
                  <Detail label="Content hash" value={report.selectedVersion.contentHash} mono />
                  <Detail label="Current selection" value={report.selectedVersionIsCurrent ? "Current version" : "Historical immutable version"} />
                </section>

                <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-900"><ShieldCheck size={17} className="mr-2 inline" />Every identity, scope member, source revision, metric, demographic, actor, timestamp, and hash below comes from the selected immutable version or its recorded events. No live registry name or synthetic value is substituted.</p>

                <FinalSnapshotFactTable report={report} />

                <section>
                  <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Frozen scope members</h3>
                  <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase"><tr><th className="px-4 py-3">Enterprise</th><th className="px-4 py-3">Site</th><th className="px-4 py-3">Barangay</th><th className="px-4 py-3">Obligation ID</th></tr></thead><tbody className="divide-y divide-slate-100">{report.selectedVersion.scopeMembers.map((member) => <tr key={member.scopeMemberId}><td className="px-4 py-3"><strong>{member.enterpriseName}</strong><span className="mt-1 block font-mono text-[10px] text-slate-500">{member.enterpriseOfficialCode} · {member.enterpriseCategory ?? "Category not recorded"}</span></td><td className="px-4 py-3"><strong>{member.siteName}</strong><span className="mt-1 block font-mono text-[10px] text-slate-500">{member.siteCode}</span></td><td className="px-4 py-3">{member.frozenBarangay ?? "Not recorded"}</td><td className="px-4 py-3 font-mono text-[10px]">{member.reportingObligationId}</td></tr>)}</tbody></table></div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Exact source revisions</h3>
                  <ul className="grid gap-2 md:grid-cols-2">{report.selectedVersion.items.map((item) => <li key={item.finalReportItemId} className="rounded-xl border border-slate-200 p-3 text-xs"><strong className="font-mono">{item.reportRevisionId}</strong><p className="mt-1 break-all text-slate-500">Payload: {item.sourcePayloadHash}</p><p className="mt-1 break-all text-slate-500">Obligation: {item.reportingObligationId}</p></li>)}</ul>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Artifact generation records</h3>
                  <div className="grid gap-2 md:grid-cols-2">{report.selectedVersion.artifacts.map((artifact) => <div key={artifact.artifactId} className="rounded-xl border border-slate-200 p-3 text-xs"><div className="flex items-center justify-between gap-2"><strong>{artifact.templateVersion} · {artifact.mimeType}</strong><ReportStatusBadge status={artifact.status} /></div><p className="mt-2 break-all text-slate-500">{artifact.contentHash ?? "Content hash pending"}</p><p className="mt-1 text-slate-500">Attempts: {artifact.generationAttempts} · {artifact.generatedAt ? formatTimestamp(artifact.generatedAt) : "Not generated"}</p>{artifact.downloadAvailable && <p className="mt-2 font-semibold text-amber-700">Artifact is ready, but the backend has not exposed an authorized download route. The snapshot PDF above remains evidence-derived.</p>}</div>)}</div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Recorded finalization events</h3>
                  <ol className="space-y-2">{report.events.map((event) => <li key={event.finalReportEventId} className={`rounded-xl border p-3 text-xs ${event.finalReportVersionId === report.selectedVersionId ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{readableToken(event.eventType)} · version {event.resultingVersion}</strong><span>{formatTimestamp(event.occurredAt)}</span></div><p className="mt-1 text-slate-600">{event.actorDisplayName ?? "Actor not recorded"} · {event.actorRole ?? "Role not recorded"}</p>{event.reason && <p className="mt-1">Reason: {event.reason}</p>}</li>)}</ol>
                </section>
              </div>
            )}
          </div>
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}

function Detail({ label, value, mono = false, badge }: { label: string; value: string; mono?: boolean; badge?: "current" | "superseded" }) {
  return <div><p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">{label}</p><p className={`mt-1 wrap-break-word text-sm font-semibold ${mono ? "font-mono text-[10px]" : ""}`}>{value}</p>{badge && <div className="mt-2"><ReportStatusBadge status={badge} /></div>}</div>;
}

function Notice({ text, error = false }: { text: string; error?: boolean }) {
  return <p className={`rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{text}</p>;
}

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(timestamp) : value;
}
