import { Check, Database, Download, RefreshCw } from "lucide-react";
import { Card } from "../../../components/Card";

type DataArchivePanelProps = {
  isLoading: boolean;
  isSuccess: boolean;
  onRequestArchive: () => void;
};

export function DataArchivePanel({ isLoading, isSuccess, onRequestArchive }: DataArchivePanelProps) {
  return (
    <Card className="rounded-[28px] border-emerald-100/80 p-6 shadow-[0_18px_44px_rgba(15,23,42,0.07)]">
      <h3 className="mb-4 flex items-center gap-2 border-b border-emerald-100 pb-3 text-sm font-bold tracking-wider text-[#111827] uppercase">
        <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-50 text-[#065f46]">
          <Database size={16} />
        </span>
        Data Archiving
      </h3>
      <p className="mb-5 text-xs leading-relaxed font-medium text-gray-500">Request a secure package of all historical edge metrics, reports, and logs for compliance audits.</p>
      <button
        onClick={onRequestArchive}
        disabled={isLoading || isSuccess}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-emerald-100 bg-white px-4 py-2.5 text-sm font-bold text-[#111827] shadow-sm transition-colors hover:bg-emerald-50 hover:text-[#065f46] disabled:bg-gray-100 disabled:text-gray-400"
      >
        {isLoading ? <RefreshCw size={16} className="animate-spin" /> : isSuccess ? <Check size={16} className="text-green-600" /> : <Download size={16} />}
        {isLoading ? "Compiling Data..." : isSuccess ? "Archive Sent to Email" : "Request Data Archive"}
      </button>
    </Card>
  );
}
