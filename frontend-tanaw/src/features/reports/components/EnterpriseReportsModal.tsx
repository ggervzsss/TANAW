import { Bell, FileText } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast/headless";
import { DetailField, EmptyState, ModalFrame } from "@/shared/components/ui";
import { notifyEnterprise } from "@/shared/services/reporting";
import type { IntakeReport, ReportEnterprise } from "@/shared/types";
import { ReportStatusBadge } from "./ReportStatusBadge";

type EnterpriseReportsModalProps = {
  enterprise: ReportEnterprise;
  reports: IntakeReport[];
  onClose: () => void;
  onOpenReport: (report: IntakeReport) => void;
};

export function EnterpriseReportsModal({ enterprise, reports, onClose, onOpenReport }: EnterpriseReportsModalProps) {
  const [notified, setNotified] = useState(false);
  const [isNotifying, setIsNotifying] = useState(false);
  const activeReports = reports.filter((report) => report.status !== "Consolidated");
  const archivedReports = reports.filter((report) => report.status === "Consolidated");
  const needsNotification = !activeReports.some((report) => report.status === "Ready to Consolidate");

  const handleNotify = async () => {
    setIsNotifying(true);
    try {
      await notifyEnterprise({
        enterpriseId: enterprise.id,
        title: "Compliance Report Follow-up",
        message: `${enterprise.name} has no report ready for consolidation. Please submit or revise the required compliance report.`,
        type: "Staff Follow-up",
        severity: "Warning",
        sourceType: "Batch Reports",
        sourceId: enterprise.id,
      });
      setNotified(true);
      toast.success(`${enterprise.name} has been notified to submit their compliance report.`);
    } catch {
      toast.error("Unable to notify enterprise. Check the API connection and try again.");
    } finally {
      setIsNotifying(false);
    }
  };

  return (
    <ModalFrame title={enterprise.name} eyebrow="Enterprise report details" onClose={onClose} maxWidthClassName="max-w-4xl">
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="grid gap-4 sm:grid-cols-2">
          <DetailField label="Category" value={enterprise.category} />
          <DetailField label="Barangay" value={enterprise.barangay} />
          <DetailField label="Compliance Owner" value={enterprise.complianceOwner} />
          <DetailField label="Open Submissions" value={activeReports.length.toLocaleString()} />
        </div>
        {needsNotification ? (
          <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 shadow-sm dark:border-amber-300/25 dark:bg-amber-400/10">
            <p className="text-[10px] font-bold tracking-[0.18em] text-amber-700 uppercase">Follow-up</p>
            <p className="mt-2 max-w-64 text-sm leading-relaxed font-semibold text-amber-950">No submission is ready to consolidate for the selected period.</p>
            <button
              type="button"
              onClick={handleNotify}
              disabled={notified || isNotifying}
              className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                notified ? "cursor-default bg-white/70 text-amber-500" : "bg-amber-600 text-white shadow-sm hover:bg-amber-700 disabled:cursor-wait disabled:bg-amber-500"
              }`}
            >
              <Bell size={15} />
              {notified ? "Notified" : isNotifying ? "Notifying..." : "Notify enterprise"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6">
        <ReportSection title="Current Submissions" reports={activeReports} empty="No active reports found." onOpenReport={onOpenReport} />
        <ReportSection title="Archived Submissions" reports={archivedReports} empty="No archived submissions yet." onOpenReport={onOpenReport} />
      </div>
    </ModalFrame>
  );
}

function ReportSection({ title, reports, empty, onOpenReport }: { title: string; reports: IntakeReport[]; empty: string; onOpenReport: (report: IntakeReport) => void }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-[#0f172a]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold tracking-[0.18em] text-slate-500 uppercase">{title}</h3>
        <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold text-emerald-700 shadow-sm ring-1 ring-emerald-100 dark:bg-[#121c31] dark:text-emerald-200 dark:ring-emerald-300/20">
          {reports.length} records
        </span>
      </div>
      <div className="space-y-3">
        {reports.map((report) => (
          <button
            key={report.id}
            onClick={() => onOpenReport(report)}
            className="w-full rounded-2xl border border-white bg-white p-4 text-left shadow-sm ring-1 ring-slate-900/4 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50/40 hover:shadow-md dark:border-slate-700 dark:bg-[#121c31] dark:ring-white/8 dark:hover:border-emerald-300/30 dark:hover:bg-emerald-500/10"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs font-bold text-gray-500">{report.code}</p>
                <p className="mt-1 text-sm font-bold text-gray-900">{report.period}</p>
                <p className="mt-1 text-xs text-gray-500">Submitted: {report.submitted}</p>
              </div>
              <ReportStatusBadge status={report.status} />
            </div>
          </button>
        ))}
        {reports.length === 0 && (
          <EmptyState icon={FileText} title={empty} description="Relevant submissions will appear here once reports are received from enterprises." minHeightClassName="min-h-40" />
        )}
      </div>
    </section>
  );
}
