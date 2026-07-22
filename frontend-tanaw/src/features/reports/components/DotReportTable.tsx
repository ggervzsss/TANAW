import type { FinalReport, IntakeReport } from "@/shared/types";
import { getDotDemographics } from "../utils/dotDemographics";

export function DotSingleReportTable({ report }: { report: IntakeReport }) {
  const d = getDotDemographics(report.metrics.unique, report.demographics ?? report.payload?.demo);

  return (
    <div className="w-full">
      <table className="dot-table tanaw-official-report-table mb-4 w-full table-fixed border-collapse border border-black text-[10px] leading-tight">
        <DotTableColumns />
        <DotTableHeader />
        <tbody>
          <tr className="border-t border-black text-center">
            <td className="py-2 text-left font-bold">
              {report.enterprise}
              <br />
              <span className="text-[9px] font-normal text-gray-600">{report.month}</span>
            </td>
            <td className="tanaw-report-code-cell">{report.code}</td>
            <td>{d.provMale}</td>
            <td>{d.provFemale}</td>
            <td className="tanaw-report-total-cell">{d.provTotal}</td>
            <td>{d.otherMale}</td>
            <td>{d.otherFemale}</td>
            <td className="tanaw-report-total-cell">{d.otherTotal}</td>
            <td>{d.foreignMale}</td>
            <td>{d.foreignFemale}</td>
            <td className="tanaw-report-total-cell">{d.foreignTotal}</td>
            <td className="font-bold">{d.grandMale}</td>
            <td className="font-bold">{d.grandFemale}</td>
            <td className="tanaw-report-total-cell tanaw-report-final-total-cell text-sm">{report.metrics.unique.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-5 text-xs text-gray-500 italic">Demographic splits and unique visitors are estimated from TANAW local camera records. Raw counts are read-only.</p>
    </div>
  );
}

export function DotFinalReportTable({ report }: { report: FinalReport }) {
  const rows = report.sources.map((source) => ({ source, demographics: getDotDemographics(source.unique, source.demographics) }));
  const totals = rows.reduce(
    (next, { source, demographics }) => ({
      provMale: next.provMale + demographics.provMale,
      provFemale: next.provFemale + demographics.provFemale,
      provTotal: next.provTotal + demographics.provTotal,
      otherMale: next.otherMale + demographics.otherMale,
      otherFemale: next.otherFemale + demographics.otherFemale,
      otherTotal: next.otherTotal + demographics.otherTotal,
      foreignMale: next.foreignMale + demographics.foreignMale,
      foreignFemale: next.foreignFemale + demographics.foreignFemale,
      foreignTotal: next.foreignTotal + demographics.foreignTotal,
      grandMale: next.grandMale + demographics.grandMale,
      grandFemale: next.grandFemale + demographics.grandFemale,
      total: next.total + source.unique,
    }),
    {
      provMale: 0,
      provFemale: 0,
      provTotal: 0,
      otherMale: 0,
      otherFemale: 0,
      otherTotal: 0,
      foreignMale: 0,
      foreignFemale: 0,
      foreignTotal: 0,
      grandMale: 0,
      grandFemale: 0,
      total: 0,
    },
  );

  return (
    <div className="w-full">
      <table className="dot-table tanaw-official-report-table mb-4 w-full table-fixed border-collapse border border-black text-[10px] leading-tight">
        <DotTableColumns />
        <DotTableHeader />
        <tbody>
          {rows.map(({ source, demographics: d }) => (
            <tr key={source.id} className="border-t border-black text-center">
              <td className="py-3 pl-2 text-left font-bold">
                {source.enterprise}
                <br />
                <span className="text-[9px] font-normal text-gray-600">{report.period}</span>
              </td>
              <td className="tanaw-report-code-cell">{source.code}</td>
              <td>{d.provMale}</td>
              <td>{d.provFemale}</td>
              <td className="tanaw-report-total-cell">{d.provTotal}</td>
              <td>{d.otherMale}</td>
              <td>{d.otherFemale}</td>
              <td className="tanaw-report-total-cell">{d.otherTotal}</td>
              <td>{d.foreignMale}</td>
              <td>{d.foreignFemale}</td>
              <td className="tanaw-report-total-cell">{d.foreignTotal}</td>
              <td className="font-bold">{d.grandMale}</td>
              <td className="font-bold">{d.grandFemale}</td>
              <td className="tanaw-report-total-cell tanaw-report-final-total-cell text-sm">{source.unique.toLocaleString()}</td>
            </tr>
          ))}
          <tr className="tanaw-report-consolidated-row border-t-2 border-black text-center font-bold">
            <td colSpan={2} className="py-3 pr-4 text-right tracking-wide uppercase">
              Citywide Consolidated Total
            </td>
            <td>{totals.provMale}</td>
            <td>{totals.provFemale}</td>
            <td className="tanaw-report-total-cell">{totals.provTotal}</td>
            <td>{totals.otherMale}</td>
            <td>{totals.otherFemale}</td>
            <td className="tanaw-report-total-cell">{totals.otherTotal}</td>
            <td>{totals.foreignMale}</td>
            <td>{totals.foreignFemale}</td>
            <td className="tanaw-report-total-cell">{totals.foreignTotal}</td>
            <td>{totals.grandMale}</td>
            <td>{totals.grandFemale}</td>
            <td className="tanaw-report-total-cell tanaw-report-final-total-cell text-base">{totals.total.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DotTableHeader() {
  return (
    <thead className="bg-gray-100 font-bold">
      <tr>
        <th colSpan={2}>Visitor Attraction</th>
        <th colSpan={9}>Place of Residence</th>
        <th colSpan={3} rowSpan={3}>
          Grand Total Number of Visitors
        </th>
      </tr>
      <tr>
        <th rowSpan={3} className="w-48 text-left">
          Name / Month
        </th>
        <th rowSpan={3} className="w-16">
          Report Code
        </th>
        <th colSpan={6}>Philippines</th>
        <th colSpan={3} rowSpan={2}>
          Foreign Country Residence
        </th>
      </tr>
      <tr>
        <th colSpan={3}>This Province</th>
        <th colSpan={3}>Other Province</th>
      </tr>
      <tr>
        <th>Male</th>
        <th>Female</th>
        <th className="tanaw-report-total-cell">Total</th>
        <th>Male</th>
        <th>Female</th>
        <th className="tanaw-report-total-cell">Total</th>
        <th>Male</th>
        <th>Female</th>
        <th className="tanaw-report-total-cell">Total</th>
        <th>Male</th>
        <th>Female</th>
        <th className="tanaw-report-total-cell tanaw-report-final-total-cell">Total</th>
      </tr>
    </thead>
  );
}

function DotTableColumns() {
  return (
    <colgroup>
      <col className="w-[18%]" />
      <col className="w-[10%]" />
      {Array.from({ length: 12 }, (_, index) => (
        <col key={index} className="w-[6%]" />
      ))}
    </colgroup>
  );
}
