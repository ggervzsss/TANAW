import type { FinalReport, IntakeReport } from "@/shared/types";
import { combineDotDemographics, dotDemographicValue, getDotDemographics, type DotDemographicsResult } from "../utils/dotDemographics";
import { recordedText } from "../utils/reportPresentation";

export function DotSingleReportTable({ report }: { report: IntakeReport }) {
  const d = getDotDemographics(report.metrics.unique, report.demographics ?? report.payload?.demo);

  return (
    <div className="w-full">
      <table className="dot-table mb-4 w-full border-collapse border border-black text-[10px] leading-tight">
        <DotTableHeader />
        <tbody>
          <tr className="border-t border-black bg-gray-50 font-bold">
            <td className="py-2 text-left font-bold">{recordedText(report.enterprise, "Not provided")}</td>
            <td>{recordedText(report.code, "Not provided")}</td>
            <td colSpan={12} />
          </tr>
          <tr>
            <td className="py-2 pl-6 text-left">{recordedText(report.month, "Not provided")}</td>
            <td />
            <DotDemographicCells demographics={d} />
            <td className="bg-gray-200 text-sm font-bold">{report.metrics.unique.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-5 text-xs text-gray-500 italic">
        Place-of-residence values are shown only when the submitted fields are complete and reconcile with the submitted visitor total. Missing or inconsistent values are not estimated.
      </p>
    </div>
  );
}

export function DotFinalReportTable({ report }: { report: FinalReport }) {
  const rows = report.sources.map((source) => ({ source, demographics: getDotDemographics(source.unique, source.demographics) }));
  const demographicsTotal = combineDotDemographics(rows.map(({ demographics }) => demographics));
  const visitorTotal = rows.length > 0 ? rows.reduce((total, { source }) => total + source.unique, 0).toLocaleString() : "Insufficient source data";

  return (
    <div className="w-full">
      <table className="dot-table mb-4 w-full border-collapse border border-black text-[10px] leading-tight">
        <DotTableHeader />
        <tbody>
          {rows.map(({ source, demographics: d }) => (
            <tr key={source.id} className="border-t border-black text-center">
              <td className="py-3 pl-2 text-left font-bold">
                {recordedText(source.enterprise, "Not provided")}
                <br />
                <span className="text-[9px] font-normal text-gray-600">{recordedText(report.period, "Not provided")}</span>
              </td>
              <td>{recordedText(source.code, "Not provided")}</td>
              <DotDemographicCells demographics={d} />
              <td className="bg-gray-200 text-sm font-bold">{source.unique.toLocaleString()}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-black bg-gray-200 text-center font-bold">
            <td colSpan={2} className="py-3 pr-4 text-right tracking-wide uppercase">
              Consolidated Total
            </td>
            <DotDemographicCells demographics={demographicsTotal} />
            <td className="bg-gray-300 text-base text-black">{visitorTotal}</td>
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
        <th colSpan={9}>Place of Residence (Submitted Data)</th>
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

function DotDemographicCells({ demographics }: { demographics: DotDemographicsResult }) {
  return (
    <>
      <td>{dotDemographicValue(demographics, "provMale")}</td>
      <td>{dotDemographicValue(demographics, "provFemale")}</td>
      <td className="bg-gray-50 font-semibold">{dotDemographicValue(demographics, "provTotal")}</td>
      <td>{dotDemographicValue(demographics, "otherMale")}</td>
      <td>{dotDemographicValue(demographics, "otherFemale")}</td>
      <td className="bg-gray-50 font-semibold">{dotDemographicValue(demographics, "otherTotal")}</td>
      <td>{dotDemographicValue(demographics, "foreignMale")}</td>
      <td>{dotDemographicValue(demographics, "foreignFemale")}</td>
      <td className="bg-gray-50 font-semibold">{dotDemographicValue(demographics, "foreignTotal")}</td>
      <td className="bg-gray-100 font-bold">{dotDemographicValue(demographics, "grandMale")}</td>
      <td className="bg-gray-100 font-bold">{dotDemographicValue(demographics, "grandFemale")}</td>
    </>
  );
}
