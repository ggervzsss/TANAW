import { Download, FileText, X } from "lucide-react";
import { ModalPortal } from "../../../components/ModalPortal";
import type { DemoBreakdown, Metrics, SystemLogPeriod } from "../../../types/enterprise";
import { downloadDotReportPdf } from "../utils/pdf";

type DotFormModalProps = {
  onClose: () => void;
  period: SystemLogPeriod;
  metrics: Metrics;
  demo: DemoBreakdown;
  notes: string;
  reportId?: string;
};

export function DotFormModal({ onClose, period, metrics, demo, notes, reportId = "TANAW-DRAFT" }: DotFormModalProps) {
  const tpm = parseInt(demo.thisProvMale || "0", 10);
  const tpf = parseInt(demo.thisProvFemale || "0", 10);
  const totalThisProv = tpm + tpf;

  const opm = parseInt(demo.otherProvMale || "0", 10);
  const opf = parseInt(demo.otherProvFemale || "0", 10);
  const totalOtherProv = opm + opf;

  const fm = parseInt(demo.foreignMale || "0", 10);
  const ff = parseInt(demo.foreignFemale || "0", 10);
  const totalForeign = fm + ff;

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
              <h3 className="font-bold text-[#111827]">DOT Form Preview</h3>
              <span className="rounded-sm bg-[#065f46]/10 px-2 py-1 text-xs font-semibold text-[#065f46]">Ready for Export</span>
            </div>
            <button onClick={onClose} className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-[#111827]" aria-label="Close preview">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-auto bg-white p-8 sm:p-12 print:overflow-visible print:p-8">
            <div className="mx-auto max-w-5xl">
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
                      <td className="border border-black p-2 text-xs font-semibold uppercase">SPL-MKT-01</td>
                      <td className="border border-black p-2 text-left align-top leading-tight">
                        <span className="font-bold">Enterprise Node</span>
                        <br />
                        <span className="text-[10px]">{period}</span>
                      </td>
                      <td className="border border-black p-2">{tpm || ""}</td>
                      <td className="border border-black p-2">{tpf || ""}</td>
                      <td className="border border-black bg-gray-50 p-2 font-bold print:bg-transparent">{totalThisProv || ""}</td>
                      <td className="border border-black p-2">{opm || ""}</td>
                      <td className="border border-black p-2">{opf || ""}</td>
                      <td className="border border-black bg-gray-50 p-2 font-bold print:bg-transparent">{totalOtherProv || ""}</td>
                      <td className="border border-black p-2">{fm || ""}</td>
                      <td className="border border-black p-2">{ff || ""}</td>
                      <td className="border border-black bg-gray-50 p-2 font-bold print:bg-transparent">{totalForeign || ""}</td>
                      <td className="border border-black bg-gray-100 p-2 text-sm font-bold print:bg-transparent">{metrics.unique}</td>
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
              onClick={() => downloadDotReportPdf({ reportId, period, metrics, demo, notes })}
              className="flex items-center gap-2 rounded-sm bg-[#065f46] px-6 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#044a36]"
            >
              <Download size={16} /> Download PDF
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
