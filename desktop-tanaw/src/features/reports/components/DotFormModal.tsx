import { Download, FileText, Info, X } from "lucide-react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import { ModalPortal } from "../../../components/ModalPortal";
import type { DemoBreakdown, Metrics, SystemLogPeriod } from "../../../types/enterprise";
import { demographicCount, getDemographicTotals } from "../utils/demographics";
import { downloadDotReportPdf } from "../utils/pdf";
import { formatReportingPeriodLabel } from "../utils/reporting-period";

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
  const periodLabel = formatReportingPeriodLabel(period);
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
      <div
        className="tanaw-dot-viewer fixed inset-0 z-1100 flex items-center justify-center bg-[#17212d]/84 p-3 font-sans backdrop-blur-md sm:p-6 print:block print:bg-white print:p-0"
        onPointerDown={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dot-form-preview-title"
          className="animate-in fade-in flex h-full max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-[26px] border border-white/55 bg-[#f8fafc] shadow-[0_34px_90px_rgba(2,8,23,0.42)] dark:border-slate-600/45 dark:bg-[#0d1725] print:m-0 print:h-auto print:max-h-none print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="tanaw-dot-viewer__header flex min-h-18 items-center justify-between gap-4 border-b border-slate-200/90 px-5 py-3.5 sm:px-6 dark:border-slate-700/80 print:hidden">
            <div className="flex min-w-0 items-center gap-3.5">
              <span
                className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm dark:border-emerald-300/18 dark:bg-emerald-300/10 dark:text-emerald-300"
                aria-hidden="true"
              >
                <FileText size={19} />
              </span>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <div className="flex items-center gap-1.5">
                  <h3 id="dot-form-preview-title" className="truncate font-bold text-[#111827] dark:text-slate-100">
                    DOT Form Preview
                  </h3>
                  <InfoTooltip content="Official DOT-style preview generated from the selected report demographics and unique count.">
                    <Info size={14} className="text-gray-400 transition-colors hover:text-[#065f46] dark:text-slate-500 dark:hover:text-emerald-300" />
                  </InfoTooltip>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide uppercase ${canDownload ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/18 dark:bg-emerald-300/10 dark:text-emerald-200" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/18 dark:bg-amber-300/10 dark:text-amber-200"}`}
                >
                  {canDownload ? "Ready for Export" : "Needs Allocation"}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white/85 text-gray-500 shadow-sm transition-[border-color,background-color,color] hover:border-slate-300 hover:bg-slate-100 hover:text-[#111827] dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label="Close preview"
            >
              <X size={18} />
            </button>
          </div>

          <div className="tanaw-dot-viewer__canvas flex-1 overflow-auto bg-[#dfe5e8] p-5 sm:p-8 dark:bg-[#111a24] print:overflow-visible print:bg-white print:p-8">
            <div className="enterprise-dot-document mx-auto w-full max-w-5xl min-w-245 rounded-[10px] bg-white p-8 text-[#111827] shadow-[0_18px_52px_rgba(15,23,42,0.22)] sm:p-10 print:max-w-none print:min-w-0 print:rounded-none print:p-0 print:shadow-none">
              {validationMessage && (
                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 print:hidden">
                  {validationMessage} Official PDF download is disabled until the demographic total matches the unique visitor count of {metrics.unique.toLocaleString()}.
                </div>
              )}
              <div className="mb-6 border-b border-amber-600/70 pb-4 text-center">
                <h2 className="text-xl font-bold tracking-wide uppercase">TANAW - DOT Visitor Attraction Report</h2>
                <p className="mt-1 text-xs text-slate-600">Tourism Attraction Visitor Record - VAR 2</p>
                <p className="mt-1 font-mono text-xs text-slate-500">{reportId}</p>
              </div>
              <div className="mb-6 grid gap-4 text-xs sm:grid-cols-3">
                <div>
                  <p className="font-bold tracking-wider text-slate-500 uppercase">Reporting Period</p>
                  <p className="mt-1 font-medium">{periodLabel}</p>
                </div>
                <div>
                  <p className="font-bold tracking-wider text-slate-500 uppercase">Municipality</p>
                  <p className="mt-1 font-medium">City of San Pedro, Laguna</p>
                </div>
                <div>
                  <p className="font-bold tracking-wider text-slate-500 uppercase">Unique Visitors</p>
                  <p className="mt-1 font-medium">{metrics.unique.toLocaleString()}</p>
                </div>
              </div>
              <h3 className="mb-4 text-base font-bold tracking-wide uppercase">Visitor Attraction</h3>

              <div className="overflow-x-auto print:overflow-visible">
                <table className="mb-8 w-full border-collapse border-2 border-black text-center text-xs text-black">
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

              <p className="text-[10px] text-slate-500">Demographic splits and unique visitors are estimates derived from TANAW local camera records.</p>

              {notes && (
                <div className="mt-4 border border-black bg-gray-50/50 p-4">
                  <h4 className="mb-2 border-b border-gray-300 pb-1 text-xs font-bold uppercase">Supplementary Notes / Details</h4>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{notes}</p>
                </div>
              )}
            </div>
          </div>

          <div className="tanaw-dot-viewer__footer flex min-h-18 flex-wrap items-center justify-end gap-3 border-t border-slate-200/90 px-5 py-3.5 sm:px-6 dark:border-slate-700/80 print:hidden">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-xl border border-gray-300 bg-white px-6 py-2 text-sm font-semibold text-[#111827] shadow-sm transition-colors hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Close Preview
            </button>
            <button
              type="button"
              disabled={!canDownload}
              onClick={() => {
                if (canDownload) downloadDotReportPdf({ enterpriseName, reportId, period: periodLabel, metrics, demo, notes });
              }}
              className={`flex min-h-11 items-center gap-2 rounded-xl px-6 py-2 text-sm font-semibold shadow-sm transition-[background-color,box-shadow] ${
                canDownload
                  ? "bg-[#065f46] text-white hover:bg-[#044a36] hover:shadow-md dark:bg-emerald-700 dark:hover:bg-emerald-600"
                  : "cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-slate-700 dark:text-slate-400"
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
