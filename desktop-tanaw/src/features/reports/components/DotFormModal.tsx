import { Download, FileText, Info, X } from "lucide-react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import { ModalPortal } from "../../../components/ModalPortal";
import type { DemoBreakdown, DemographicEvidence, Metrics, SystemLogPeriod } from "../../../types/enterprise";
import { formatDemographicValue, getExplicitDemographicTotals, hasAnyDemographicValue, parseDemographicCount } from "../utils/demographics";
import { downloadDotReportPdf } from "../utils/pdf";

type DotFormModalProps = {
  attractionCode?: string | null;
  attractionName?: string | null;
  demo: DemoBreakdown;
  demographicEvidence?: DemographicEvidence | null;
  metrics: Metrics;
  notes: string;
  onClose: () => void;
  period: SystemLogPeriod;
  reportId?: string;
  validationMessage?: string | null;
};

export function DotFormModal({
  attractionCode = null,
  attractionName = null,
  onClose,
  period,
  metrics,
  demo,
  demographicEvidence = null,
  notes,
  reportId = "TANAW-DRAFT",
  validationMessage = null,
}: DotFormModalProps) {
  const hasEvidence = Boolean(demographicEvidence);
  const tpm = hasEvidence ? parseDemographicCount(demo.thisProvMale) : null;
  const tpf = hasEvidence ? parseDemographicCount(demo.thisProvFemale) : null;
  const opm = hasEvidence ? parseDemographicCount(demo.otherProvMale) : null;
  const opf = hasEvidence ? parseDemographicCount(demo.otherProvFemale) : null;
  const fm = hasEvidence ? parseDemographicCount(demo.foreignMale) : null;
  const ff = hasEvidence ? parseDemographicCount(demo.foreignFemale) : null;
  const totals = hasEvidence ? getExplicitDemographicTotals(demo) : null;
  const hasEnteredDemographics = hasAnyDemographicValue(demo);
  const canDownload = !validationMessage && (!hasEnteredDemographics || hasEvidence);
  const evidenceMessage =
    validationMessage ?? (hasEnteredDemographics && !hasEvidence ? "Demographic provenance and quality were not recorded, so the entered values cannot be presented as official facts." : null);

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-1100 flex items-center justify-center bg-[#111827]/80 p-4 font-['Inter'] backdrop-blur-md sm:p-8 print:block print:bg-white print:p-0" onPointerDown={onClose}>
        <div
          className="animate-in fade-in flex h-full max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl print:m-0 print:h-auto print:max-h-none print:max-w-none print:shadow-none"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 p-4 print:hidden">
            <div className="flex items-center gap-3">
              <FileText size={20} className="text-[#111827]" />
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-[#111827]">DOT Form Preview</h3>
                <InfoTooltip content="DOT-style preview generated only from explicit operator demographic facts. The camera-derived unique estimate is a separate metric.">
                  <Info size={14} className="text-gray-400 transition-colors hover:text-[#065f46]" />
                </InfoTooltip>
              </div>
              <span className={`rounded-sm px-2 py-1 text-xs font-semibold ${canDownload ? "bg-[#065f46]/10 text-[#065f46]" : "bg-amber-100 text-amber-800"}`}>
                {canDownload ? "Ready for Export" : "Evidence Required"}
              </span>
            </div>
            <button onClick={onClose} className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-[#111827]" aria-label="Close preview">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-auto bg-white p-8 sm:p-12 print:overflow-visible print:p-8">
            <div className="mx-auto max-w-5xl">
              {evidenceMessage && (
                <div className="mb-5 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 print:hidden">
                  {evidenceMessage} Official PDF download remains disabled until the entered facts have explicit operator evidence.
                </div>
              )}
              <h2 className="mb-6 text-xl font-bold tracking-wide text-black uppercase">Visitor Attraction</h2>

              <div className="overflow-x-auto print:overflow-visible">
                <table className="mb-8 w-full border-collapse border-2 border-black text-center text-xs text-black">
                  <thead>
                    <tr>
                      <th rowSpan={4} className="w-20 border border-black p-2">
                        Attraction Code
                      </th>
                      <th rowSpan={4} className="w-48 border border-black p-2">
                        Name/ Month
                      </th>
                      <th colSpan={9} className="border border-black bg-gray-50 p-2 font-bold print:bg-transparent">
                        ***Place of Residence
                      </th>
                      <th rowSpan={4} className="w-24 border border-black p-2">
                        Grand Total Number of Visitors
                      </th>
                    </tr>
                    <tr>
                      <th colSpan={6} className="border border-black bg-gray-50 p-1 print:bg-transparent">
                        Philippines
                      </th>
                      <th colSpan={3} className="border border-black bg-gray-50 p-1 print:bg-transparent">
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
                      <th colSpan={3} className="border border-t-0 border-black p-1"></th>
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
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-black p-2 text-xs font-semibold">{providedText(attractionCode)}</td>
                      <td className="border border-black p-2 text-left align-top leading-tight">
                        <span className="font-bold">{providedText(attractionName)}</span>
                        <br />
                        <span className="text-[10px]">{period}</span>
                      </td>
                      <td className="border border-black p-2">{formatDemographicValue(tpm)}</td>
                      <td className="border border-black p-2">{formatDemographicValue(tpf)}</td>
                      <td className="border border-black bg-gray-50 p-2 font-bold print:bg-transparent">{formatDemographicValue(totals?.thisProvince ?? null)}</td>
                      <td className="border border-black p-2">{formatDemographicValue(opm)}</td>
                      <td className="border border-black p-2">{formatDemographicValue(opf)}</td>
                      <td className="border border-black bg-gray-50 p-2 font-bold print:bg-transparent">{formatDemographicValue(totals?.otherProvince ?? null)}</td>
                      <td className="border border-black p-2">{formatDemographicValue(fm)}</td>
                      <td className="border border-black p-2">{formatDemographicValue(ff)}</td>
                      <td className="border border-black bg-gray-50 p-2 font-bold print:bg-transparent">{formatDemographicValue(totals?.foreign ?? null)}</td>
                      <td className="border border-black bg-gray-100 p-2 text-sm font-bold print:bg-transparent">{formatDemographicValue(totals?.grandTotal ?? null)}</td>
                    </tr>
                    {[...Array(6)].map((_, i) => (
                      <tr key={i} className="h-8">
                        <td className="border border-black p-1"></td>
                        <td className="border border-black p-1"></td>
                        <td className="border border-black p-1"></td>
                        <td className="border border-black p-1"></td>
                        <td className="border border-black bg-gray-50 p-1 print:bg-transparent"></td>
                        <td className="border border-black p-1"></td>
                        <td className="border border-black p-1"></td>
                        <td className="border border-black bg-gray-50 p-1 print:bg-transparent"></td>
                        <td className="border border-black p-1"></td>
                        <td className="border border-black p-1"></td>
                        <td className="border border-black bg-gray-50 p-1 print:bg-transparent"></td>
                        <td className="border border-black bg-gray-100 p-1 print:bg-transparent"></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {notes && (
                <div className="mt-4 border border-black bg-gray-50/50 p-4">
                  <h4 className="mb-2 border-b border-gray-300 pb-1 text-xs font-bold uppercase">Supplementary Notes / Details</h4>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{notes}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-200 bg-gray-50 p-4 print:hidden">
            <button onClick={onClose} className="rounded-sm border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-[#111827] transition-colors hover:bg-gray-100">
              Close Preview
            </button>
            <button
              disabled={!canDownload}
              onClick={() => {
                if (canDownload) {
                  downloadDotReportPdf({
                    attractionCode,
                    attractionName,
                    reportId,
                    period,
                    metrics,
                    demo,
                    demographicEvidence,
                    notes,
                  });
                }
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

function providedText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || "Not provided";
}
