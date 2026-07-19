import { Download, FileText, Info, X } from "lucide-react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import { ModalPortal } from "../../../components/ModalPortal";
import type { DemoBreakdown, Metrics, SystemLogPeriod } from "../../../types/enterprise";
import { demographicCount, getDemographicTotals } from "../utils/demographics";
import { downloadDotReportPdf } from "../utils/pdf";
import { formatReportingPeriodRange } from "../utils/reporting-period";

type DotFormModalProps = {
  demo: DemoBreakdown;
  enterpriseName: string;
  metrics: Metrics;
  notes: string;
  onClose: () => void;
  period: SystemLogPeriod;
  reportId?: string;
  validationMessage?: string | null;
};

export function DotFormModal({ onClose, enterpriseName, period, metrics, demo, notes, reportId = "TANAW-DRAFT", validationMessage = null }: DotFormModalProps) {
  const periodLabel = formatReportingPeriodRange(period);
  const tpm = demographicCount(demo.thisProvMale);
  const tpf = demographicCount(demo.thisProvFemale);
  const totalThisProv = tpm + tpf;

  const opm = demographicCount(demo.otherProvMale);
  const opf = demographicCount(demo.otherProvFemale);
  const totalOtherProv = opm + opf;

  const fm = demographicCount(demo.foreignMale);
  const ff = demographicCount(demo.foreignFemale);
  const totalForeign = fm + ff;
  const totals = getDemographicTotals(demo);
  const canDownload = !validationMessage;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-1100 flex items-center justify-center bg-[#111827]/80 p-4 font-['Inter'] backdrop-blur-md sm:p-8 print:block print:bg-white print:p-0" onPointerDown={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dot-form-preview-title"
          className="animate-in fade-in flex h-full max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-[#0b1220] print:m-0 print:h-auto print:max-h-none print:max-w-none print:shadow-none"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-[#111c2f] print:hidden">
            <div className="flex items-center gap-3">
              <FileText size={20} className="text-[#111827] dark:text-slate-200" />
              <div className="flex items-center gap-1.5">
                <h3 id="dot-form-preview-title" className="font-bold text-[#111827] dark:text-slate-100">
                  DOT Form Preview
                </h3>
                <InfoTooltip content="Official DOT-style preview generated from the selected report demographics and unique count.">
                  <Info size={14} className="text-gray-400 transition-colors hover:text-[#065f46]" />
                </InfoTooltip>
              </div>
              <span
                className={`rounded-sm px-2 py-1 text-xs font-semibold ${canDownload ? "bg-[#065f46]/10 text-[#065f46] dark:bg-emerald-400/15 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200"}`}
              >
                {canDownload ? "Ready for Export" : "Needs Allocation"}
              </span>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-[#111827] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label="Close preview"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-auto bg-white p-8 sm:p-12 dark:bg-[#0b1220] print:overflow-visible print:p-8">
            <div className="enterprise-dot-document mx-auto max-w-5xl text-[#111827] dark:text-slate-100">
              {validationMessage && (
                <div className="mb-5 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 print:hidden">
                  {validationMessage} Official PDF download is disabled until the demographic total matches the unique visitor count of {metrics.unique.toLocaleString()}.
                </div>
              )}
              <div className="mb-6 border-b border-amber-600/70 pb-4 text-center">
                <h2 className="text-xl font-bold tracking-wide uppercase">TANAW - DOT Visitor Attraction Report</h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Tourism Attraction Visitor Record - VAR 2</p>
                <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">{reportId}</p>
              </div>
              <div className="mb-6 grid gap-4 text-xs sm:grid-cols-3">
                <div>
                  <p className="font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">Reporting Period</p>
                  <p className="mt-1 font-medium">{periodLabel}</p>
                </div>
                <div>
                  <p className="font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">Municipality</p>
                  <p className="mt-1 font-medium">City of San Pedro, Laguna</p>
                </div>
                <div>
                  <p className="font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">Unique Visitors</p>
                  <p className="mt-1 font-medium">{metrics.unique.toLocaleString()}</p>
                </div>
              </div>
              <h3 className="mb-4 text-base font-bold tracking-wide uppercase">Visitor Attraction</h3>

              <div className="overflow-x-auto print:overflow-visible">
                <table className="mb-8 w-full border-collapse border-2 border-black text-center text-xs text-black dark:text-slate-100">
                  <thead>
                    <tr>
                      <th colSpan={2} className="border border-black p-2">
                        Visitor Attraction
                      </th>
                      <th colSpan={9} className="border border-black bg-gray-50 p-2 font-bold print:bg-transparent">
                        Place of Residence
                      </th>
                      <th colSpan={3} rowSpan={3} className="border border-black p-2">
                        Grand Total Number of Visitors
                      </th>
                    </tr>
                    <tr>
                      <th rowSpan={3} className="w-48 border border-black p-2">
                        Name / Month
                      </th>
                      <th rowSpan={3} className="w-20 border border-black p-2">
                        Report Code
                      </th>
                      <th colSpan={6} className="border border-black bg-gray-50 p-1 print:bg-transparent">
                        Philippines
                      </th>
                      <th colSpan={3} rowSpan={2} className="border border-black bg-gray-50 p-1 print:bg-transparent">
                        Foreign Country Residence
                      </th>
                    </tr>
                    <tr>
                      <th colSpan={3} className="border border-black p-1">
                        This province
                      </th>
                      <th colSpan={3} className="border border-black p-1">
                        Other Province
                      </th>
                    </tr>
                    <tr>
                      <th className="w-12 border border-black p-1">Male</th>
                      <th className="w-12 border border-black p-1">Female</th>
                      <th className="w-12 border border-black bg-gray-50 p-1 print:bg-transparent">Total</th>
                      <th className="w-12 border border-black p-1">Male</th>
                      <th className="w-12 border border-black p-1">Female</th>
                      <th className="w-12 border border-black bg-gray-50 p-1 print:bg-transparent">Total</th>
                      <th className="w-12 border border-black p-1">Male</th>
                      <th className="w-12 border border-black p-1">Female</th>
                      <th className="w-12 border border-black bg-gray-50 p-1 print:bg-transparent">Total</th>
                      <th className="w-12 border border-black p-1">Male</th>
                      <th className="w-12 border border-black p-1">Female</th>
                      <th className="w-12 border border-black bg-gray-50 p-1 print:bg-transparent">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-black p-2 text-left align-top leading-tight">
                        <span className="font-bold">{enterpriseName}</span>
                        <br />
                        <span className="text-[10px]">{periodLabel}</span>
                      </td>
                      <td className="border border-black p-2 text-xs font-semibold uppercase">{reportId}</td>
                      <td className="border border-black p-2">{tpm || ""}</td>
                      <td className="border border-black p-2">{tpf || ""}</td>
                      <td className="border border-black bg-gray-50 p-2 font-bold print:bg-transparent">{totalThisProv || ""}</td>
                      <td className="border border-black p-2">{opm || ""}</td>
                      <td className="border border-black p-2">{opf || ""}</td>
                      <td className="border border-black bg-gray-50 p-2 font-bold print:bg-transparent">{totalOtherProv || ""}</td>
                      <td className="border border-black p-2">{fm || ""}</td>
                      <td className="border border-black p-2">{ff || ""}</td>
                      <td className="border border-black bg-gray-50 p-2 font-bold print:bg-transparent">{totalForeign || ""}</td>
                      <td className="border border-black bg-gray-100 p-2 font-bold print:bg-transparent">{totals.male || ""}</td>
                      <td className="border border-black bg-gray-100 p-2 font-bold print:bg-transparent">{totals.female || ""}</td>
                      <td className="border border-black bg-gray-100 p-2 text-sm font-bold print:bg-transparent">{totals.grandTotal || ""}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] text-slate-500 dark:text-slate-400">Demographic splits and unique visitors are estimates derived from TANAW local camera records.</p>

              {notes && (
                <div className="mt-4 border border-black bg-gray-50/50 p-4 dark:border-slate-500 dark:bg-[#111c2f]">
                  <h4 className="mb-2 border-b border-gray-300 pb-1 text-xs font-bold uppercase">Supplementary Notes / Details</h4>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{notes}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-[#111c2f] print:hidden">
            <button
              onClick={onClose}
              className="rounded-sm border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-[#111827] transition-colors hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Close Preview
            </button>
            <button
              disabled={!canDownload}
              onClick={() => {
                if (canDownload) downloadDotReportPdf({ enterpriseName, reportId, period: periodLabel, metrics, demo, notes });
              }}
              className={`flex items-center gap-2 rounded-sm px-6 py-2 text-sm font-medium shadow-sm transition-colors ${
                canDownload ? "bg-[#065f46] text-white hover:bg-[#044a36]" : "cursor-not-allowed bg-gray-300 text-gray-500"
              }`}
            >
              <Download size={16} /> Download PDF
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
