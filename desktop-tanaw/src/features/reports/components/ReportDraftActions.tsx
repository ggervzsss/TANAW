import { RotateCcw, Send } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportDraftActionsProps = {
  activeReport: ReportRecord | null;
  isReadOnly: boolean;
  metricsError: string | null;
  validationError: string | null;
  onSubmitPrompt: () => void;
};

export function ReportDraftActions({ activeReport, isReadOnly, metricsError, validationError, onSubmitPrompt }: ReportDraftActionsProps) {
  const isSubmitDisabled = Boolean(metricsError) || Boolean(validationError);

  if (isReadOnly) return null;

  return (
    <div className="pt-2">
      <button
        type="button"
        disabled={isSubmitDisabled}
        onClick={onSubmitPrompt}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold tracking-wide uppercase shadow-[0_10px_24px_rgba(6,95,70,0.14)] transition-colors ${
          isSubmitDisabled ? "cursor-not-allowed border-gray-300 bg-gray-300 text-gray-500" : "border-[#065f46] bg-[#065f46] text-white hover:border-[#044a36] hover:bg-[#044a36]"
        }`}
      >
        {activeReport?.status === "Returned for Revision" ? <RotateCcw size={14} /> : <Send size={14} />}
        {activeReport?.status === "Returned for Revision" ? "Resubmit Report" : "Submit Report"}
      </button>
    </div>
  );
}
