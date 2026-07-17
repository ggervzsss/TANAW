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
        <div className="animate-in fade-in w-full max-w-md rounded-2xl border-t-4 border-[#065f46] bg-white p-6 shadow-2xl" onPointerDown={(event) => event.stopPropagation()}>
          <div className="mb-2 flex items-start justify-between gap-4">
            <h3 className="flex items-center gap-2 text-lg font-bold text-[#111827]">
              <Send size={20} className="text-[#065f46]" /> Submit Monthly Report?
            </h3>
            <button onClick={onCancel} className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#111827]" aria-label="Close dialog">
              <X size={18} />
            </button>
          </div>
          <p className="mb-6 text-sm leading-relaxed text-gray-600">The report will be sent to staff for review. You can update it later only if staff returns it for changes.</p>
          <div className="flex justify-end gap-3">
            <button
              disabled={isSubmitting}
              onClick={onCancel}
              className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-bold text-[#111827] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Edit Draft
            </button>
            <button
              disabled={isSubmitting}
              onClick={onConfirm}
              className="flex items-center gap-2 rounded-xl bg-[#065f46] px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              <Check size={16} /> {isSubmitting ? "Submitting…" : "Submit Report"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
