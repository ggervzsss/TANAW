import type { EnterpriseReportDetail, FinalReportDetail } from "@/shared/types";
import { formatDecimal } from "../utils/decimal";
import { readableToken } from "../utils/reportWorkflow";

export function ReportMetricTable({ report }: { report: EnterpriseReportDetail }) {
  const revision = report.revisions.find((item) => item.reportRevisionId === report.currentRevisionId) ?? report.revisions.find((item) => item.isCurrent);
  if (!revision) return <EvidenceUnavailable message="The submitted report details are unavailable." />;

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Report totals</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Measure</th>
                <th className="px-4 py-3 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {revision.metrics.map((metric) => (
                <tr key={metric.metricFactId}>
                  <td className="px-4 py-3 font-semibold">{metricLabel(metric.definition)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold">
                    {formatDecimal(metric.value)} {readableToken(metric.unit)}
                  </td>
                </tr>
              ))}
              {revision.metrics.length === 0 && <EmptyTableRow colSpan={2} text="No totals were submitted." />}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Demographics</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Count</th>
                <th className="px-4 py-3 text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {revision.demographics.map((fact) => (
                <tr key={fact.demographicFactId}>
                  <td className="px-4 py-3 font-semibold">{fact.value}</td>
                  <td className="px-4 py-3 text-right font-mono">{fact.count.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono">{fact.percentage === null ? "—" : `${formatDecimal(fact.percentage)}%`}</td>
                </tr>
              ))}
              {revision.demographics.length === 0 && <EmptyTableRow colSpan={3} text="No demographics were submitted." />}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function metricLabel(definition: string) {
  const knownLabels: Record<string, string> = {
    entries_count: "Entries",
    exits_count: "Exits",
    peak_occupancy: "Peak occupancy",
    visitor_estimate: "Visitor estimate",
    total_visitors: "Total visitors",
  };
  const readable = knownLabels[definition] ?? readableToken(definition);
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function FinalSnapshotFactTable({ report }: { report: FinalReportDetail }) {
  const version = report.selectedVersion;
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Final totals</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Measure</th>
                <th className="px-4 py-3 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {version.metrics.map((metric) => (
                <tr key={metric.metricFactId}>
                  <td className="px-4 py-3 font-semibold">{metricLabel(metric.definition)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold">
                    {formatDecimal(metric.value)} {readableToken(metric.unit)}
                  </td>
                </tr>
              ))}
              {version.metrics.length === 0 && <EmptyTableRow colSpan={2} text="No totals are available." />}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Demographics</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Count</th>
                <th className="px-4 py-3 text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {version.demographics.map((fact) => (
                <tr key={fact.demographicFactId}>
                  <td className="px-4 py-3 font-semibold">{fact.value}</td>
                  <td className="px-4 py-3 text-right font-mono">{fact.count.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono">{fact.percentage === null ? "—" : `${formatDecimal(fact.percentage)}%`}</td>
                </tr>
              ))}
              {version.demographics.length === 0 && <EmptyTableRow colSpan={3} text="No demographics were included." />}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EvidenceUnavailable({ message }: { message: string }) {
  return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{message}</p>;
}

function EmptyTableRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-6 text-center text-slate-500">
        {text}
      </td>
    </tr>
  );
}
