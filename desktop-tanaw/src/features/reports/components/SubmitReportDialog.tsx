import { Check, Send, X } from "lucide-react";
import { ModalPortal } from "../../../components/ModalPortal";

type SubmitReportDialogProps = {
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function SubmitReportDialog({ isSubmitting, onCancel, onConfirm }: SubmitReportDialogProps) {
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-1100 flex items-center justify-center bg-[#111827]/70 p-4 backdrop-blur-md" onPointerDown={onCancel}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-report-submission-title"
          aria-describedby="confirm-report-submission-description"
          className="animate-in fade-in w-full max-w-md rounded-2xl border border-emerald-100 border-t-4 border-t-[#065f46] bg-white p-6 shadow-2xl dark:border-slate-600 dark:border-t-emerald-400 dark:bg-[#121c31] dark:shadow-[0_28px_80px_rgba(0,0,0,0.58)]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-start justify-between gap-4">
            <h3 id="confirm-report-submission-title" className="flex items-center gap-2 text-lg font-bold text-[#111827] dark:text-slate-100">
              <Send size={20} className="text-[#065f46] dark:text-emerald-300" /> Confirm Submission
            </h3>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-transparent p-1 text-gray-400 transition-colors hover:border-gray-200 hover:bg-gray-100 hover:text-[#111827] dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-[#1d2940] dark:hover:text-slate-100"
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>
          </div>
          <p id="confirm-report-submission-description" className="mb-6 text-sm leading-relaxed text-gray-600 dark:text-slate-300">
            Are you sure you want to submit this report to the LGU Admin? This action will finalize current system metrics and lock further edits.
          </p>
          <div className="flex justify-end gap-3">
            <button
              disabled={isSubmitting}
              onClick={onCancel}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-[#111827] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-[#172033] dark:text-slate-100 dark:hover:bg-[#1d2940]"
            >
              Edit Draft
            </button>
            <button
              disabled={isSubmitting}
              onClick={onConfirm}
              className="flex items-center gap-2 rounded-xl bg-[#065f46] px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              <Check size={16} /> {isSubmitting ? "Saving Locally..." : "Yes, Submit"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
