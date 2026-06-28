import { FileText, RotateCcw, Send } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportDraftActionsProps = {
  activeReport: ReportRecord | null;
  isReadOnly: boolean;
  metricsError: string | null;
  validationError: string | null;
  onPreview: () => void;
  onSubmitPrompt: () => void;
};

export function ReportDraftActions({ activeReport, isReadOnly, metricsError, validationError, onPreview, onSubmitPrompt }: ReportDraftActionsProps) {
  const isSubmitDisabled = Boolean(metricsError) || Boolean(validationError);

  return (
    <div className="flex gap-3 pt-2">
      <button
        onClick={onPreview}
        className="flex flex-1 items-center justify-center gap-2 rounded-sm border-2 border-[#111827] bg-white py-2 text-xs font-bold tracking-wide text-[#111827] uppercase transition-colors hover:bg-[#111827] hover:text-white"
      >
        <FileText size={14} /> Preview {isReadOnly ? "" : "Draft"}
      </button>
      {!isReadOnly && (
        <button
          disabled={isSubmitDisabled}
          onClick={onSubmitPrompt}
          className={`flex flex-1 items-center justify-center gap-2 rounded-sm border-2 py-2 text-xs font-bold tracking-wide uppercase shadow-md transition-colors ${
            isSubmitDisabled ? "cursor-not-allowed border-gray-300 bg-gray-300 text-gray-500" : "border-[#065f46] bg-[#065f46] text-white hover:border-[#044a36] hover:bg-[#044a36]"
          }`}
        >
          {activeReport?.status === "Returned for Revision" ? <RotateCcw size={14} /> : <Send size={14} />}
          {activeReport?.status === "Returned for Revision" ? "Resubmit" : "Submit"}
        </button>
      )}
    </div>
  );
}
