import { Bell } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast/headless";
import { Button, Dialog } from "@/shared/ui-kit";
import { notifyEnterprise } from "@/shared/services/reporting";
import type { IntakeReport, ReportEnterprise } from "@/shared/types";
import { ReportStatusBadge } from "./ReportStatusBadge";

type EnterpriseReportsModalProps = {
  enterprise: ReportEnterprise;
  reports: IntakeReport[];
  currentReport?: IntakeReport;
  period: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenReport: (report: IntakeReport) => void;
};

export function EnterpriseReportsModal({ enterprise, reports, currentReport, period, isOpen, onClose, onOpenReport }: EnterpriseReportsModalProps) {
  const [notified, setNotified] = useState(false);
  const [isNotifying, setIsNotifying] = useState(false);
  const previousReports = reports.filter((report) => report.id !== currentReport?.id);
  const needsNotification = !currentReport || currentReport.status === "Returned";

  const handleNotify = async () => {
    setIsNotifying(true);
    try {
      await notifyEnterprise({
        enterpriseId: enterprise.id,
        title: "Compliance Report Follow-up",
        message: currentReport ? `Please revise and resubmit your compliance report for ${period}.` : `Please submit your compliance report for ${period}.`,
        type: "Staff Follow-up",
        severity: "Warning",
        sourceType: "Batch Reports",
        sourceId: enterprise.id,
      });
      setNotified(true);
      toast.success(`${enterprise.name} has been notified to submit their compliance report.`);
    } catch {
      toast.error("Unable to notify the establishment. Try again.");
    } finally {
      setIsNotifying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      title={enterprise.name}
      description={period}
      onClose={onClose}
      closeLabel="Close establishment submissions"
      size="lg"
      bodyClassName="space-y-5"
      footer={
        needsNotification && (
          <Button variant="secondary" leadingIcon={<Bell size={16} aria-hidden="true" />} onClick={handleNotify} disabled={notified} loading={isNotifying}>
            {notified ? "Reminder sent" : isNotifying ? "Sending reminder..." : "Send submission reminder"}
          </Button>
        )
      }
    >
      <ReportSection title="Selected submission" reports={currentReport ? [currentReport] : []} empty="No report submitted for this period." onOpenReport={onOpenReport} />
      {previousReports.length > 0 && <ReportSection title="Previous submissions" reports={previousReports} onOpenReport={onOpenReport} />}
    </Dialog>
  );
}

function ReportSection({ title, reports, empty, onOpenReport }: { title: string; reports: IntakeReport[]; empty?: string; onOpenReport: (report: IntakeReport) => void }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold text-(--tanaw-text)">{title}</h3>
      {reports.length > 0 ? (
        <ul className="rounded-tanaw-md divide-y divide-(--tanaw-border-soft) border border-(--tanaw-border-soft)">
          {reports.map((report) => (
            <li key={report.id}>
              <button
                type="button"
                onClick={() => onOpenReport(report)}
                className="rounded-tanaw-md flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold wrap-anywhere text-(--tanaw-text)">{report.period}</span>
                  <span className="block text-xs wrap-anywhere text-(--tanaw-text-muted)">{report.code}</span>
                </span>
                <ReportStatusBadge status={report.status} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-(--tanaw-text-muted)">{empty}</p>
      )}
    </section>
  );
}
