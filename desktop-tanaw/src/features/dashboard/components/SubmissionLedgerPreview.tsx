import { useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Files } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../../../components/Badge";
import type { ReportRecord } from "../../../types/enterprise";
import { routePaths } from "../../../app/router/routePaths";
import type { DashboardSampleReport } from "../data/dashboardMockData";

export function SubmissionLedgerPreview({
  reports,
  enterpriseName,
  onPreviewReport,
  sampleReports,
  onPreviewSampleReport,
}: {
  reports: ReportRecord[];
  enterpriseName: string;
  onPreviewReport: (report: ReportRecord) => void;
  sampleReports?: DashboardSampleReport[];
  onPreviewSampleReport?: (report: DashboardSampleReport) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number>();
  const entries = sampleReports
    ? sampleReports.map((sample) => ({
        id: sample.id,
        title: sample.title,
        description: sample.id + " · Sample report · visualization only",
        status: sample.status,
        preview: () => onPreviewSampleReport?.(sample),
      }))
    : reports.map((report) => ({
        id: report.id,
        title: "Tourism Report · " + (report.period ?? report.date),
        description: report.id + " · " + (report.syncStatus === "pending" ? "Pending synchronization" : "Submitted to LGU"),
        status: report.status,
        preview: () => onPreviewReport(report),
      }));
  const count = entries.length;
  const rowKeys = entries.map((entry) => entry.id).join("|");
  useLayoutEffect(() => {
    const container = list.current;
    if (!container || count <= 5) {
      setMaxHeight(undefined);
      return;
    }
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".recent-report-row")).slice(0, 5);
    const measure = () => {
      if (rows.length < 5) return;
      const first = rows[0].getBoundingClientRect();
      const last = rows[4].getBoundingClientRect();
      const style = getComputedStyle(container);
      // Measure five actual rows, including wrapped text at narrow widths.
      setMaxHeight(last.bottom - first.top + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    rows.forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [count, rowKeys]);
  return (
    <section className="design-card overview-reports">
      <header>
        <div>
          <h3>Recent Reports</h3>
          <p>
            Latest tourism reports from <b>{enterpriseName}</b> site
          </p>
        </div>
        <Link to={routePaths.enterpriseReports}>
          View All <ArrowRight size={20} />
        </Link>
      </header>
      {count ? (
        <div
          ref={list}
          className="recent-report-list"
          role="region"
          aria-label="Recent report list"
          tabIndex={count > 5 ? 0 : undefined}
          data-scrollable={count > 5}
          style={count > 5 ? { maxHeight: maxHeight ?? 343 } : undefined}
        >
          {entries.map((entry, index) => (
            <button key={entry.id + index} type="button" className="recent-report-row" onClick={entry.preview}>
              <Files size={28} />
              <span>
                <strong>{entry.title}</strong>
                <small>{entry.description}</small>
              </span>
              <Badge variant={entry.status === "Returned for Revision" ? "warning" : "success"}>{entry.status}</Badge>
            </button>
          ))}
        </div>
      ) : (
        <p className="recent-report-empty" role="status">
          Submitted tourism reports will appear here.
        </p>
      )}
    </section>
  );
}
