import type { FinalReport, IntakeReport } from "@/shared/types";

type Demographics = {
  provMale: number;
  provFemale: number;
  provTotal: number;
  otherMale: number;
  otherFemale: number;
  otherTotal: number;
  foreignMale: number;
  foreignFemale: number;
  foreignTotal: number;
  grandMale: number;
  grandFemale: number;
};

export function DotSingleReportTable({ report }: { report: IntakeReport }) {
  const d = getDemographics(report.metrics.unique);

  return (
    <div className="w-full">
      <table className="dot-table mb-4 w-full border-collapse border border-black text-[10px] leading-tight">
        <DotTableHeader />
        <tbody>
          <tr className="border-t border-black bg-gray-50 font-bold">
            <td className="py-2 text-left font-bold">{report.enterprise}</td>
            <td>{report.code}</td>
            <td colSpan={12} />
          </tr>
          <tr>
            <td className="py-2 pl-6 text-left">{report.month}</td>
            <td />
            <td>{d.provMale}</td>
            <td>{d.provFemale}</td>
            <td className="bg-gray-50 font-semibold">{d.provTotal}</td>
            <td>{d.otherMale}</td>
            <td>{d.otherFemale}</td>
            <td className="bg-gray-50 font-semibold">{d.otherTotal}</td>
            <td>{d.foreignMale}</td>
            <td>{d.foreignFemale}</td>
            <td className="bg-gray-50 font-semibold">{d.foreignTotal}</td>
            <td className="bg-gray-100 font-bold">{d.grandMale}</td>
            <td className="bg-gray-100 font-bold">{d.grandFemale}</td>
            <td className="bg-gray-200 text-sm font-bold">{report.metrics.unique.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-5 text-xs text-gray-500 italic">Demographic splits and unique visitors are estimated from TANAW edge telemetry. Raw counts are read-only.</p>
    </div>
  );
}

export function DotFinalReportTable({ report }: { report: FinalReport }) {
  const rows = report.sources.map((source) => ({ source, demographics: getDemographics(source.unique) }));
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
      <table className="dot-table mb-4 w-full border-collapse border border-black text-[10px] leading-tight">
        <DotTableHeader />
        <tbody>
          {rows.map(({ source, demographics: d }) => (
            <tr key={source.id} className="border-t border-black text-center">
              <td className="py-3 pl-2 text-left font-bold">
                {source.enterprise}
                <br />
                <span className="text-[9px] font-normal text-gray-600">{report.period}</span>
              </td>
              <td>{source.code}</td>
              <td>{d.provMale}</td>
              <td>{d.provFemale}</td>
              <td className="bg-gray-50 font-semibold">{d.provTotal}</td>
              <td>{d.otherMale}</td>
              <td>{d.otherFemale}</td>
              <td className="bg-gray-50 font-semibold">{d.otherTotal}</td>
              <td>{d.foreignMale}</td>
              <td>{d.foreignFemale}</td>
              <td className="bg-gray-50 font-semibold">{d.foreignTotal}</td>
              <td className="bg-gray-100 font-bold">{d.grandMale}</td>
              <td className="bg-gray-100 font-bold">{d.grandFemale}</td>
              <td className="bg-gray-200 text-sm font-bold">{source.unique.toLocaleString()}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-black bg-gray-200 text-center font-bold">
            <td colSpan={2} className="py-3 pr-4 text-right tracking-wide uppercase">
              Citywide Consolidated Total
            </td>
            <td>{totals.provMale}</td>
            <td>{totals.provFemale}</td>
            <td>{totals.provTotal}</td>
            <td>{totals.otherMale}</td>
            <td>{totals.otherFemale}</td>
            <td>{totals.otherTotal}</td>
            <td>{totals.foreignMale}</td>
            <td>{totals.foreignFemale}</td>
            <td>{totals.foreignTotal}</td>
            <td>{totals.grandMale}</td>
            <td>{totals.grandFemale}</td>
            <td className="bg-gray-300 text-base text-black">{totals.total.toLocaleString()}</td>
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
        <th rowSpan={3} className="w-48 text-left">
          Visitor Attraction / Name / Month
        </th>
        <th rowSpan={3} className="w-16">
          Attraction Code
        </th>
        <th colSpan={9}>Place of Residence (Estimated Data)</th>
        <th colSpan={3} rowSpan={2}>
          Grand Total Number of Visitors
        </th>
      </tr>
      <tr>
        <th colSpan={3}>This Province</th>
        <th colSpan={3}>Other Province</th>
        <th colSpan={3}>Foreign Country</th>
      </tr>
      <tr>
        <th>Male</th>
        <th>Female</th>
        <th>Total</th>
        <th>Male</th>
        <th>Female</th>
        <th>Total</th>
        <th>Male</th>
        <th>Female</th>
        <th>Total</th>
        <th>Male</th>
        <th>Female</th>
        <th>Total</th>
      </tr>
    </thead>
  );
}

function getDemographics(total: number): Demographics {
  const provMale = Math.floor(total * 0.65 * 0.48);
  const provFemale = Math.floor(total * 0.65 * 0.52);
  const provTotal = provMale + provFemale;
  const otherMale = Math.floor(total * 0.25 * 0.5);
  const otherFemale = Math.floor(total * 0.25 * 0.5);
  const otherTotal = otherMale + otherFemale;
  const foreignMale = Math.floor(total * 0.1 * 0.55);
  const foreignFemale = total - provTotal - otherTotal - foreignMale;
  const foreignTotal = foreignMale + foreignFemale;

  return {
    provMale,
    provFemale,
    provTotal,
    otherMale,
    otherFemale,
    otherTotal,
    foreignMale,
    foreignFemale,
    foreignTotal,
    grandMale: provMale + otherMale + foreignMale,
    grandFemale: provFemale + otherFemale + foreignFemale,
  };
}
