import { Download, Printer, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { useFinalReportDetail } from "@/shared/hooks/useReportWorkflow";
import { ModalPortal } from "@/shared/components/ui";
import { CITY_SEAL } from "@/shared/constants/branding";
import { fetchFinalReportArtifact } from "@/shared/services/reporting";
import type { FinalReportDetail } from "@/shared/types";
import { readableToken } from "../utils/reportWorkflow";
import { FinalSnapshotFactTable } from "./ReportFactTables";
import { ReportStatusBadge } from "./ReportStatusBadge";

type FinalReportViewerProps = {
  reportFinalizationId: string;
  onClose: () => void;
};

export function FinalReportViewer({ reportFinalizationId, onClose }: FinalReportViewerProps) {
  const [requestedVersionId, setRequestedVersionId] = useState<string | undefined>();
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const detailQuery = useFinalReportDetail(reportFinalizationId, requestedVersionId);
  const report = detailQuery.data;
  const officialPdf = report?.selectedVersion.artifacts.find((artifact) => artifact.status === "ready" && artifact.downloadAvailable && artifact.mimeType === "application/pdf");

  const downloadOfficialPdf = async (artifactId: string) => {
    if (!report || downloadingArtifactId) return;
    setDownloadError(null);
    setDownloadingArtifactId(artifactId);
    try {
      const artifact = await fetchFinalReportArtifact(report.reportFinalizationId, report.selectedVersionId, artifactId);
      saveOfficialPdf(artifact.blob, `${report.reportCode}-v${report.selectedVersion.versionNumber}-official.pdf`);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "The official final-report artifact could not be downloaded.");
    } finally {
      setDownloadingArtifactId(null);
    }
  };

  return (
    <ModalPortal>
      <motion.div
        className="fixed inset-0 z-1300 flex items-center justify-center bg-[rgba(3,20,12,0.68)] p-4 backdrop-blur-[6px] print:bg-white print:p-0 print:backdrop-blur-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.section
          role="dialog"
          aria-modal="true"
          aria-label="Final report"
          className="print-container relative z-1301 flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-white/85 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.36)] print:max-h-none print:border-none print:shadow-none"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
        >
          <header className="print-hide flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/70 px-6 py-4">
            <div>
              <p className="text-[10px] font-bold tracking-[0.18em] text-emerald-700 uppercase">Official report</p>
              <h2 className="text-tanaw-navy mt-1 text-lg font-bold">{report?.reportCode ?? "Final Report"}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {report && (
                <label className="text-xs font-semibold text-slate-600">
                  Report version{" "}
                  <select value={report.selectedVersionId} onChange={(event) => setRequestedVersionId(event.target.value)} className="ml-1 rounded-lg border border-slate-300 bg-white px-2 py-2">
                    {report.versions.map((version) => (
                      <option key={version.finalReportVersionId} value={version.finalReportVersionId}>
                        Version {version.versionNumber}
                        {version.finalReportVersionId === report.currentVersionId ? " (current)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                disabled={!officialPdf || downloadingArtifactId !== null}
                onClick={() => officialPdf && void downloadOfficialPdf(officialPdf.artifactId)}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50"
              >
                <Download size={15} /> {downloadingArtifactId ? "Preparing PDF…" : "Official PDF"}
              </button>
              <button
                type="button"
                disabled={!report}
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50"
              >
                <Printer size={15} /> Print
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close final report"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500"
              >
                <X size={20} />
              </button>
            </div>
          </header>

          <div className="tanaw-document-preview overflow-y-auto bg-white p-8 text-black print:overflow-visible print:p-0">
            {detailQuery.isLoading && <Notice text="Loading final report…" />}
            {detailQuery.isError && <Notice error text="The final report could not be loaded. Close this window and try again." />}
            {downloadError && <Notice error text={downloadError} />}
            {report && (
              <div className="space-y-7">
                <div className="border-b-2 border-black pb-4 text-center">
                  <img src={CITY_SEAL} className="mx-auto mb-3 h-16 w-16 grayscale" alt="San Pedro Seal" />
                  <h1 className="font-serif text-lg font-bold tracking-widest uppercase">City Government of San Pedro</h1>
                  <p className="mt-1 text-xs tracking-wider uppercase">Tourism & Economic Development Office</p>
                  <h2 className="mt-5 text-xl font-bold underline">Official TANAW Consolidated Report</h2>
                  <p className="mt-1 font-mono text-sm">
                    {report.reportCode} · {report.reportingPeriod.label}
                  </p>
                </div>

                <section className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="Reporting month" value={report.reportingPeriod.label} />
                  <Detail label="Coverage" value={report.selectedVersion.scope.label} />
                  <Detail label="Prepared by" value={`${report.selectedVersion.preparedBy.name} · ${report.selectedVersion.preparedBy.role}`} />
                  <Detail label="Created" value={formatTimestamp(report.selectedVersion.finalizedAt)} />
                  <Detail label="Reports included" value={String(report.selectedVersion.sourceCount)} />
                  <Detail label="Enterprise sites" value={String(report.selectedVersion.scope.memberCount)} />
                </section>

                <FinalSnapshotFactTable report={report} />

                <section>
                  <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Enterprises included</h3>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase">
                        <tr>
                          <th className="px-4 py-3">Enterprise</th>
                          <th className="px-4 py-3">Site</th>
                          <th className="px-4 py-3">Barangay</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.selectedVersion.scopeMembers.map((member) => (
                          <tr key={member.scopeMemberId}>
                            <td className="px-4 py-3">
                              <strong>{member.enterpriseName}</strong>
                              <span className="mt-1 block text-[10px] text-slate-500">{member.enterpriseOfficialCode}</span>
                            </td>
                            <td className="px-4 py-3">
                              <strong>{member.siteName}</strong>
                              <span className="mt-1 block text-[10px] text-slate-500">{member.siteCode}</span>
                            </td>
                            <td className="px-4 py-3">{member.frozenBarangay ?? "Not recorded"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <FinalReportAuditDetails report={report} downloadingArtifactId={downloadingArtifactId} onDownloadArtifact={(artifactId) => void downloadOfficialPdf(artifactId)} />
              </div>
            )}
          </div>
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}

function FinalReportAuditDetails({
  report,
  downloadingArtifactId,
  onDownloadArtifact,
}: {
  report: FinalReportDetail;
  downloadingArtifactId: string | null;
  onDownloadArtifact: (artifactId: string) => void;
}) {
  return (
    <details className="print-hide rounded-2xl border border-slate-200 bg-slate-50">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">Audit details</summary>
      <div className="space-y-5 border-t border-slate-200 px-4 py-4">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Report ID" value={report.reportFinalizationId} mono />
          <Detail label="Selected version" value={`Version ${report.selectedVersion.versionNumber}`} badge={report.selectedVersion.disposition} />
          <Detail label="Content hash" value={report.selectedVersion.contentHash} mono />
          <Detail label="Selection" value={report.selectedVersionIsCurrent ? "Current version" : "Previous version"} />
        </section>

        <section>
          <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Source records</h3>
          <ul className="grid gap-2 md:grid-cols-2">
            {report.selectedVersion.items.map((item) => (
              <li key={item.finalReportItemId} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <strong className="font-mono">{item.reportRevisionId}</strong>
                <p className="mt-1 break-all text-slate-500">Payload: {item.sourcePayloadHash}</p>
                <p className="mt-1 break-all text-slate-500">Requirement: {item.reportingObligationId}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">PDF records</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {report.selectedVersion.artifacts.map((artifact) => (
              <div key={artifact.artifactId} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <strong>
                    {artifact.templateVersion} · {artifact.mimeType}
                  </strong>
                  <ReportStatusBadge status={artifact.status} />
                </div>
                <p className="mt-2 break-all text-slate-500">{artifact.contentHash ?? "Content hash pending"}</p>
                <p className="mt-1 text-slate-500">
                  Attempts: {artifact.generationAttempts} · {artifact.generatedAt ? formatTimestamp(artifact.generatedAt) : "Not generated"}
                </p>
                {artifact.status === "ready" && artifact.downloadAvailable && artifact.mimeType === "application/pdf" ? (
                  <button
                    type="button"
                    disabled={downloadingArtifactId !== null}
                    onClick={() => onDownloadArtifact(artifact.artifactId)}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800 disabled:opacity-50"
                  >
                    <Download size={13} /> {downloadingArtifactId === artifact.artifactId ? "Preparing…" : "Download verified official PDF"}
                  </button>
                ) : (
                  <p className="mt-2 font-semibold text-slate-500">
                    {artifact.status === "failed" ? `Generation failed${artifact.lastErrorCode ? `: ${artifact.lastErrorCode}` : "."}` : "Official download is not ready."}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Creation history</h3>
          <ol className="space-y-2">
            {report.events.map((event) => (
              <li
                key={event.finalReportEventId}
                className={`rounded-xl border p-3 text-xs ${event.finalReportVersionId === report.selectedVersionId ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    {readableToken(event.eventType)} · version {event.resultingVersion}
                  </strong>
                  <span>{formatTimestamp(event.occurredAt)}</span>
                </div>
                <p className="mt-1 text-slate-600">
                  {event.actorDisplayName ?? "Actor not recorded"} · {event.actorRole ?? "Role not recorded"}
                </p>
                {event.reason && <p className="mt-1">Reason: {event.reason}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </details>
  );
}

function Detail({ label, value, mono = false, badge }: { label: string; value: string; mono?: boolean; badge?: "current" | "superseded" }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={`mt-1 text-sm font-semibold wrap-break-word ${mono ? "font-mono text-[10px]" : ""}`}>{value}</p>
      {badge && (
        <div className="mt-2">
          <ReportStatusBadge status={badge} />
        </div>
      )}
    </div>
  );
}

function Notice({ text, error = false }: { text: string; error?: boolean }) {
  return <p className={`rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{text}</p>;
}

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(timestamp) : value;
}

function saveOfficialPdf(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
