import type { EnterpriseReportDetail, FinalReportDetail } from "@/shared/types";
import { formatDecimal } from "../utils/decimal";
import { readableToken } from "../utils/reportWorkflow";

export function ReportMetricTable({ report }: { report: EnterpriseReportDetail }) {
  const revision = report.revisions.find((item) => item.reportRevisionId === report.currentRevisionId) ?? report.revisions.find((item) => item.isCurrent);
  if (!revision) return <EvidenceUnavailable message="The authoritative current revision was not returned." />;

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Recorded metric facts</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Definition</th>
                <th className="px-4 py-3">Recorded value</th>
                <th className="px-4 py-3">Provenance</th>
                <th className="px-4 py-3">Quality</th>
                <th className="px-4 py-3">Coverage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {revision.metrics.map((metric) => (
                <tr key={metric.metricFactId}>
                  <td className="px-4 py-3 font-semibold">
                    {readableToken(metric.definition)} <span className="font-mono text-[10px] text-slate-400">v{metric.definitionVersion}</span>
                  </td>
                  <td className="px-4 py-3 font-mono font-bold">{formatDecimal(metric.value)} {metric.unit}</td>
                  <td className="px-4 py-3">{readableToken(metric.provenance)}</td>
                  <td className="px-4 py-3">{readableToken(metric.quality)}</td>
                  <td className="px-4 py-3">{coverageText(metric.coverage)}</td>
                </tr>
              ))}
              {revision.metrics.length === 0 && <EmptyTableRow colSpan={5} text="No metric facts were recorded for this revision." />}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Recorded demographic facts</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase">
              <tr><th className="px-4 py-3">Dimension</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Count</th><th className="px-4 py-3">Percentage</th><th className="px-4 py-3">Evidence</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {revision.demographics.map((fact) => (
                <tr key={fact.demographicFactId}>
                  <td className="px-4 py-3 font-semibold">{readableToken(fact.dimension)}</td>
                  <td className="px-4 py-3">{fact.value}</td>
                  <td className="px-4 py-3 font-mono">{fact.count.toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono">{fact.percentage === null ? "Not recorded" : `${formatDecimal(fact.percentage)}%`}</td>
                  <td className="px-4 py-3">{readableToken(fact.provenance)} · {readableToken(fact.quality)}</td>
                </tr>
              ))}
              {revision.demographics.length === 0 && <EmptyTableRow colSpan={5} text="No demographic facts were recorded; TANAW does not estimate missing values." />}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function FinalSnapshotFactTable({ report }: { report: FinalReportDetail }) {
  const version = report.selectedVersion;
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Immutable consolidated metric facts</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase">
              <tr><th className="px-4 py-3">Definition</th><th className="px-4 py-3">Recorded value</th><th className="px-4 py-3">Aggregation</th><th className="px-4 py-3">Quality</th><th className="px-4 py-3">Source facts</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {version.metrics.map((metric) => (
                <tr key={metric.metricFactId}>
                  <td className="px-4 py-3 font-semibold">{readableToken(metric.definition)} <span className="font-mono text-[10px] text-slate-400">v{metric.definitionVersion}</span></td>
                  <td className="px-4 py-3 font-mono font-bold">{formatDecimal(metric.value)} {metric.unit}</td>
                  <td className="px-4 py-3">{readableToken(metric.aggregationMethod)}</td>
                  <td className="px-4 py-3">{readableToken(metric.quality)}</td>
                  <td className="px-4 py-3 font-mono">{metric.sourceFactCount}</td>
                </tr>
              ))}
              {version.metrics.length === 0 && <EmptyTableRow colSpan={5} text="No consolidated metric facts were recorded." />}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Immutable consolidated demographic facts</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase">
              <tr><th className="px-4 py-3">Dimension</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Count</th><th className="px-4 py-3">Percentage</th><th className="px-4 py-3">Evidence</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {version.demographics.map((fact) => (
                <tr key={fact.demographicFactId}>
                  <td className="px-4 py-3 font-semibold">{readableToken(fact.dimension)}</td>
                  <td className="px-4 py-3">{fact.value}</td>
                  <td className="px-4 py-3 font-mono">{fact.count.toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono">{fact.percentage === null ? "Not recorded" : `${formatDecimal(fact.percentage)}%`}</td>
                  <td className="px-4 py-3">{readableToken(fact.quality)} · {fact.sourceFactCount} source facts</td>
                </tr>
              ))}
              {version.demographics.length === 0 && <EmptyTableRow colSpan={5} text="No demographic facts exist in this immutable version." />}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function coverageText(coverage: { evidenceStatus: "recorded" | "not_recorded"; coverageRatio: number | null; monitoredSeconds: number | null; expectedSeconds: number | null; gapCount: number | null }) {
  if (coverage.evidenceStatus === "not_recorded") return "Not recorded";
  const ratio = coverage.coverageRatio === null ? "ratio unavailable" : `${(coverage.coverageRatio * 100).toFixed(1)}%`;
  return `${ratio} · ${coverage.monitoredSeconds ?? "?"}/${coverage.expectedSeconds ?? "?"} sec · ${coverage.gapCount ?? "?"} gaps`;
}

function EvidenceUnavailable({ message }: { message: string }) {
  return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{message}</p>;
}

function EmptyTableRow({ colSpan, text }: { colSpan: number; text: string }) {
  return <tr><td colSpan={colSpan} className="px-4 py-6 text-center text-slate-500">{text}</td></tr>;
}
