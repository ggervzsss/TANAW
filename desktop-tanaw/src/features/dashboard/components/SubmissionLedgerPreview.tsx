import { useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Info } from "lucide-react";
import { Badge } from "../../../components/Badge";
import { Card } from "../../../components/Card";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { ReportRecord } from "../../../types/enterprise";
import { getDemographicEvidenceStatus } from "../../reports/utils/demographics";
import { emptyDemo } from "../utils/reportLedger";

type SubmissionLedgerPreviewProps = {
  reports: ReportRecord[];
  onPreviewReport: (report: ReportRecord) => void;
};

const reportsPerPage = 4;

export function SubmissionLedgerPreview({ reports, onPreviewReport }: SubmissionLedgerPreviewProps) {
  const [page, setPage] = useState(0);
  const maxPage = Math.max(0, Math.ceil(reports.length / reportsPerPage) - 1);
  const currentPage = Math.min(page, maxPage);
  const visibleReports = reports.slice(currentPage * reportsPerPage, currentPage * reportsPerPage + reportsPerPage);
  const previewSlots = Array.from({ length: reportsPerPage }, (_, index) => visibleReports[index] ?? null);
  const start = reports.length === 0 ? 0 : currentPage * reportsPerPage + 1;
  const end = Math.min(reports.length, currentPage * reportsPerPage + reportsPerPage);

  return (
    <Card className="border border-gray-200 p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(15,23,42,0.1)] dark:border-slate-700 dark:hover:shadow-[0_18px_44px_rgba(0,0,0,0.35)]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold tracking-wider text-[#111827] uppercase dark:text-slate-100">Preview</h3>
            <InfoTooltip content="Recent DOT report records available for review or export.">
              <Info size={14} className="text-gray-400 transition-colors hover:text-[#065f46] dark:text-slate-500 dark:hover:text-emerald-300" />
            </InfoTooltip>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Submission Ledger records from local desktop reports.</p>
        </div>
        <FileText size={18} className="text-[#065f46] dark:text-emerald-300" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {previewSlots.map((report, index) =>
          report ? (
            <button
              key={report.id}
              type="button"
              onClick={() => onPreviewReport(report)}
              className="min-h-38 rounded-lg border border-gray-200 bg-gray-50 p-4 text-left shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-1 hover:border-[#065f46]/40 hover:bg-white hover:shadow-[0_18px_36px_rgba(15,23,42,0.12)] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:outline-none dark:border-slate-700 dark:bg-slate-900/70 dark:hover:border-emerald-300/40 dark:hover:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs font-bold text-[#065f46] dark:text-emerald-300">{report.id}</p>
                  <h4 className="mt-2 text-base font-bold text-[#111827] dark:text-slate-100">{report.period ?? report.date}</h4>
                </div>
                <Badge variant={report.status === "Consolidated" ? "success" : report.status === "Returned for Revision" ? "warning" : "info"}>{report.status}</Badge>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="font-bold tracking-wider text-gray-400 uppercase dark:text-slate-500">Camera estimate</p>
                  <p className="mt-1 font-mono text-lg font-bold text-[#111827] dark:text-slate-100">{report.unique.toLocaleString()}</p>
                </div>
                <div>
                  <p className="font-bold tracking-wider text-gray-400 uppercase dark:text-slate-500">Demographics</p>
                  <p className="mt-1 font-semibold text-gray-600 dark:text-slate-200">{evidenceLabel(report)}</p>
                </div>
              </div>
              <p className="mt-4 text-[11px] font-bold tracking-wider text-gray-400 uppercase dark:text-slate-400">Open DOT Preview</p>
            </button>
          ) : (
            <div
              key={`empty-preview-${currentPage}-${index}`}
              className="flex min-h-38 flex-col justify-between rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-left dark:border-slate-700 dark:bg-slate-900/45"
            >
              <div>
                <p className="font-mono text-xs font-bold text-slate-400 dark:text-slate-600">EMPTY SLOT</p>
                <h4 className="mt-2 text-base font-bold text-slate-500 dark:text-slate-300">No report yet</h4>
              </div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Submitted ledger records will appear here when available.</p>
            </div>
          ),
        )}
      </div>

      <div className="mt-5 flex items-center justify-end gap-3 text-sm font-bold text-[#111827] dark:text-slate-100">
        <button
          type="button"
          disabled={currentPage === 0}
          onClick={() => setPage((value) => Math.max(0, value - 1))}
          className="rounded-sm border border-gray-200 p-1 text-gray-500 transition hover:text-[#065f46] disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:text-emerald-300"
          aria-label="Previous submission ledger preview page"
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {start} - {end}
        </span>
        <button
          type="button"
          disabled={currentPage >= maxPage}
          onClick={() => setPage((value) => Math.min(maxPage, value + 1))}
          className="rounded-sm border border-gray-200 p-1 text-gray-500 transition hover:text-[#065f46] disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:text-emerald-300"
          aria-label="Next submission ledger preview page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </Card>
  );
}

function evidenceLabel(report: ReportRecord) {
  const status = getDemographicEvidenceStatus(report.demo ?? emptyDemo());
  if (status.validationMessage) return "Invalid facts";
  if (!status.hasAnyValue) return "Not provided";
  return report.demographicEvidence ? "Explicit operator facts" : "Evidence not confirmed";
}
