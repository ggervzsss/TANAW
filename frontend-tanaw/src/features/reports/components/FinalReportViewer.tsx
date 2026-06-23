import { Archive, ArchiveRestore, CheckCircle, Download, Printer, X } from "lucide-react";
import { motion } from "motion/react";
import toast from "react-hot-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ModalPortal } from "@/shared/components/ui";
import { CITY_SEAL } from "@/shared/constants/branding";
import { operationalFinalReportsQueryKey } from "@/shared/hooks/useOperationalSync";
import { updateFinalReportStatus } from "@/shared/services/reporting";
import type { FinalReport, FinalReportStatus } from "@/shared/types";
import { DotFinalReportTable } from "./DotReportTable";
import { downloadFinalReportPdf } from "../utils/pdf";

type FinalReportViewerProps = {
  report: FinalReport;
  onClose: () => void;
};

export function FinalReportViewer({ report, onClose }: FinalReportViewerProps) {
  const queryClient = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: (status: FinalReportStatus) => updateFinalReportStatus(report.id, { status }),
    onSuccess: (updatedReport) => {
      queryClient.setQueryData<FinalReport[]>(operationalFinalReportsQueryKey, (current = []) => current.map((item) => (item.id === updatedReport.id ? updatedReport : item)));
      void queryClient.invalidateQueries({ queryKey: operationalFinalReportsQueryKey });
    },
  });
  const downloadReport = () => downloadFinalReportPdf(report);

  const handleArchive = () => {
    statusMutation.mutate("Archived", {
      onSuccess: () => {
        toast.success(`${report.id} has been moved to Archives.`);
        onClose();
      },
      onError: () => toast.error("Final report status could not be updated."),
    });
  };

  const handleFinalize = () => {
    statusMutation.mutate("Finalized", {
      onSuccess: () => {
        toast.success(`${report.id} marked as Finalized. Ready for DOT handoff.`);
        onClose();
      },
      onError: () => toast.error("Final report status could not be updated."),
    });
  };

  // TEMP TESTING ONLY: Restore button for final report archive test case. Remove after testing.
  const handleRestore = () => {
    statusMutation.mutate("Draft", {
      onSuccess: () => {
        toast.success(`${report.id} has been restored to Drafts.`);
        onClose();
      },
      onError: () => toast.error("Final report status could not be updated."),
    });
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
          className="print-container relative z-1301 flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-[30px] border border-white/85 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.36)] ring-1 ring-black/4 print:max-h-none print:border-none print:shadow-none"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <div className="print-hide flex items-center justify-between gap-4 border-b border-emerald-100/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.92)_0%,rgba(255,255,255,0.98)_54%,rgba(255,251,235,0.78)_100%)] p-4 text-black">
            <div>
              <p className="text-[10px] font-bold tracking-[0.18em] text-emerald-700 uppercase">{report.id}</p>
              <h3 className="text-tanaw-navy mt-1 text-lg font-bold">Official Artifact Viewer</h3>
              <p className="text-xs font-semibold text-gray-500">LGU official format with data lineage.</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {report.status === "Archived" ? (
                <button
                  type="button"
                  onClick={handleRestore}
                  className="bg-tanaw-green hover:bg-tanaw-green/90 inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition"
                >
                  <ArchiveRestore size={15} /> Restore
                </button>
              ) : (
                <>
                  {report.status === "Draft" && (
                    <button
                      type="button"
                      onClick={handleFinalize}
                      className="bg-tanaw-green hover:bg-tanaw-green/90 inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition"
                    >
                      <CheckCircle size={15} /> Mark as Finalized
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleArchive}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700"
                  >
                    <Archive size={15} /> Archive
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={downloadReport}
                className="text-tanaw-green inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:bg-emerald-50"
              >
                <Download size={15} /> Download PDF
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="text-tanaw-green inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:bg-emerald-50"
              >
                <Printer size={15} /> Print to PDF
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close final report"
                className="hover:text-tanaw-green flex h-9 w-9 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="flex grow flex-col overflow-y-auto bg-white p-8 text-black print:overflow-visible print:p-0">
            <div className="print-hide mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <h4 className="mb-3 text-sm font-bold text-gray-800">Version History & Audit Trail</h4>
              <ul className="space-y-2 font-mono text-xs text-gray-600">
                <li className="flex items-center justify-between border-b border-gray-200 pb-2">
                  <span>v1.0 Draft aggregated by System Pipeline</span>
                  <span>{report.generatedOn} 04:15 AM</span>
                </li>
                <li className="flex items-center justify-between pt-1">
                  <span>v1.1 Finalized and authorized by {report.preparedBy}</span>
                  <span>{report.generatedOn} 09:30 AM</span>
                </li>
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
              This document certifies the consolidated visitor analytics derived from the TANAW Edge Intelligence Network for the stated period. Aggregation relies on immutable edge telemetry over{" "}
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
