import { Printer, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { ModalPortal } from "@/shared/components/ui";
import type { IntakeReport } from "@/shared/types";
import { DotSingleReportTable } from "./DotReportTable";
import { ReportStatusBadge } from "./ReportStatusBadge";

type ReportReviewModalProps = {
  report: IntakeReport;
  isUpdating?: boolean;
  onClose: () => void;
  onAccept: (report: IntakeReport, remarks: string) => void;
  onReturn: (report: IntakeReport, remarks: string) => void;
};

export function ReportReviewModal({ report, isUpdating = false, onClose, onAccept, onReturn }: ReportReviewModalProps) {
  const [remarksDraft, setRemarksDraft] = useState(() => ({
    reportId: report.id,
    value: report.remarks ?? "",
  }));
  const remarks = remarksDraft.reportId === report.id ? remarksDraft.value : (report.remarks ?? "");

  return (
    <ModalPortal>
      <motion.div
        className="fixed inset-0 z-1300 flex items-center justify-center bg-[rgba(3,20,12,0.68)] p-4 backdrop-blur-[6px] print:bg-white print:p-0 print:backdrop-blur-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.section
          className="relative z-1301 flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-white/85 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.36)] ring-1 ring-black/4 print:max-h-none print:border-none print:shadow-none"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <div className="print-hide flex items-center justify-between gap-4 border-b border-emerald-100/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.92)_0%,rgba(255,255,255,0.98)_54%,rgba(255,251,235,0.78)_100%)] p-5">
            <div>
              <div className="mb-2 flex items-center gap-3">
                <h3 className="text-tanaw-navy text-lg font-bold">Review DOT Form Generation</h3>
                <ReportStatusBadge status={report.status} />
              </div>
              <p className="text-xs font-semibold text-gray-500">
                {report.enterprise} - {report.period}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="text-tanaw-green inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50"
              >
                <Printer size={15} /> Print PDF
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close report review"
                className="hover:text-tanaw-green flex h-9 w-9 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="grow overflow-y-auto bg-gray-100 p-6 print:bg-white print:p-0">
            <section className="bg-white p-6 text-black shadow-sm print:shadow-none">
              <DotSingleReportTable report={report} />
            </section>

            <div className="print-hide mt-6 rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
              <h4 className="text-tanaw-navy mb-4 text-sm font-semibold">Data Lineage & Telemetry Sources</h4>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-gray-200 text-gray-500">
                    <tr>
                      <th className="pb-2 font-semibold">Source Node / Camera</th>
                      <th className="pb-2 font-semibold">Last Timestamp Sync</th>
                      <th className="pb-2 text-right font-semibold">Unique Pax Contributed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr>
                      <td className="py-2 font-medium text-gray-800">Zone A - Main Entrance</td>
                      <td className="py-2 font-mono text-gray-500">{report.month} 31, 23:55:01</td>
                      <td className="text-tgreen-dark py-2 text-right font-mono font-bold">{Math.floor(report.metrics.unique * 0.7).toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-medium text-gray-800">Zone B - Rear Exit</td>
                      <td className="py-2 font-mono text-gray-500">{report.month} 31, 23:58:12</td>
                      <td className="text-tgreen-dark py-2 text-right font-mono font-bold">{(report.metrics.unique - Math.floor(report.metrics.unique * 0.7)).toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="print-hide mt-6 rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
              <h4 className="text-tanaw-navy mb-2 text-sm font-semibold">Data Protection & Remarks</h4>
              <p className="mb-4 text-xs text-gray-500">Values in the DOT form are read-only and populated directly from edge node telemetry.</p>
              <textarea
                value={remarks}
                onChange={(event) => setRemarksDraft({ reportId: report.id, value: event.target.value })}
                className="focus:border-tanaw-green focus:ring-tanaw-green/15 w-full rounded-xl border border-gray-300 bg-gray-50 p-3 text-sm text-gray-900 transition outline-none focus:ring-2"
                rows={3}
                placeholder="Add remarks for revision or consolidation notes..."
              />
            </div>
          </div>

          <div className="print-hide flex flex-wrap justify-end gap-3 border-t border-emerald-100 bg-white p-5">
            <button
              type="button"
              onClick={() => onReturn(report, remarks)}
              disabled={isUpdating}
              className="rounded-xl border border-red-200 px-5 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
            >
              {isUpdating ? "Updating..." : "Return for Revision"}
            </button>
            <button
              type="button"
              onClick={() => onAccept(report, remarks)}
              disabled={isUpdating}
              className="bg-tanaw-green hover:bg-tanaw-green/90 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-wait disabled:opacity-60"
            >
              {isUpdating ? "Updating..." : "Accept & Mark Ready"}
            </button>
          </div>
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}
