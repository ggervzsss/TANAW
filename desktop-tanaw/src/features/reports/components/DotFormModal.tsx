import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Download, FileText, Maximize, Printer, Ratio, X, ZoomIn, ZoomOut } from "lucide-react";
import { ModalPortal } from "../../../components/ModalPortal";
import type { DemoBreakdown, Metrics, SystemLogPeriod } from "../../../types/enterprise";
import { useAuthStore } from "../../login/stores/auth-store";
import { downloadDotReportPdf, type DotReportPdf } from "../utils/pdf";
import { formatReportingPeriodLabel } from "../utils/reporting-period";
import { hasUnspecifiedCity, VAR1_COLUMN_WEIGHTS, VAR1_NOTE, VAR1_RESIDENCES, VAR1_SEX_COLUMNS, var1DailyCells, var1Days, var1MonthlyCells, type Var1DailyAllocation } from "../model/var1";
import { useReportPreviewZoom, REPORT_PAPER_WIDTH } from "../hooks/useReportPreviewZoom";
import { CountingDetails } from "./CountingDetails";

type Props = {
  demo: DemoBreakdown;
  enterpriseName: string;
  metrics: Metrics;
  notes: string;
  onClose: () => void;
  period: SystemLogPeriod;
  reportId?: string;
  validationMessage?: string | null;
  sampleDaily?: Var1DailyAllocation[];
  attractionType?: string;
};
const PAPER_WIDTH = REPORT_PAPER_WIDTH;

export function DotFormModal({ onClose, enterpriseName, period, metrics, demo, notes, reportId = "TANAW-DRAFT", validationMessage = null, sampleDaily, attractionType }: Props) {
  const reduceMotion = useReducedMotion();
  const category = useAuthStore((state) => state.user?.category);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  const [closing, setClosing] = useState(false);
  const { paper, ready: portalReady, attachCanvas, zoom, height, changeZoom, fitToPage, actualSize, minZoom, maxZoom } = useReportPreviewZoom(Boolean(reduceMotion));
  const close = useCallback(() => {
    if (reduceMotion) closeCallback.current();
    else setClosing(true);
  }, [reduceMotion]);
  const report: DotReportPdf = { demo, enterpriseName, metrics, notes, period: formatReportingPeriodLabel(period), reportId, attractionType: attractionType ?? category ?? undefined, sampleDaily };

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => closeCallback.current(), 260);
    return () => window.clearTimeout(timer);
  }, [closing]);
  useEffect(() => {
    if (!portalReady) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      if (event.key !== "Tab") return;
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"]') ?? []).filter((node) => node.getClientRects().length > 0);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keyboard, true);
      previous?.focus({ preventScroll: true });
    };
  }, [close, portalReady]);

  return (
    <ModalPortal>
      <motion.div
        className="tanaw-var1-viewer"
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.26 }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <motion.div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="var1-review-title"
          className="tanaw-var1-modal"
          initial={{ opacity: 0, scale: 0.99, y: 8 }}
          animate={{ opacity: closing ? 0 : 1, scale: closing ? 0.99 : 1, y: closing ? 8 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
          style={{ pointerEvents: closing ? "none" : undefined }}
        >
          <header className="var1-viewer-header">
            <FileText className="var1-viewer-icon" fill="currentColor" stroke="white" aria-hidden="true" />
            <div>
              <h2 id="var1-review-title">Review Report Form</h2>
              <p>Check the report before download / submitting the official PDF</p>
            </div>
            <button ref={closeButton} type="button" className="var1-close" aria-label="Close preview" onClick={close}>
              <X aria-hidden="true" />
            </button>
          </header>
          {sampleDaily && (
            <p className="report-mock-notice" role="status">
              Mock data · Frontend visualization only. This report is not saved or submitted.
            </p>
          )}
          {validationMessage && (
            <p className="var1-validation" role="status">
              {validationMessage} Complete the allocation before printing or downloading.
            </p>
          )}
          <div ref={attachCanvas} className="var1-viewer-canvas" tabIndex={0} aria-label="Scrollable VAR 1 report preview" data-report-zoom={zoom.toFixed(2)}>
            <div className="var1-scale-frame" style={{ width: PAPER_WIDTH * zoom, height: height * zoom }}>
              <div ref={paper} className="var1-document" style={{ width: PAPER_WIDTH, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                <Var1ReportDocument report={report} />
              </div>
            </div>
            <details className="var1-supporting-details">
              <summary>Report details and camera evidence</summary>
              <CountingDetails metrics={metrics} />
              {notes && <p>{notes}</p>}
            </details>
          </div>
          <footer className="var1-viewer-footer">
            <div className="var1-zoom-controls">
              <button type="button" className="reports-button" onClick={() => changeZoom(-0.1)} disabled={zoom <= minZoom + 0.001}>
                <ZoomOut aria-hidden="true" />
                Zoom Out
              </button>
              <button type="button" className="reports-button" onClick={() => changeZoom(0.1)} disabled={zoom >= maxZoom - 0.001}>
                <ZoomIn aria-hidden="true" />
                Zoom In
              </button>
              <button type="button" className="reports-button" onClick={fitToPage}>
                <Maximize aria-hidden="true" />
                Fit to Page
              </button>
              <button type="button" className="reports-button" onClick={actualSize}>
                <Ratio aria-hidden="true" />
                Actual Size (100%)
              </button>
            </div>
            <div className="var1-export-controls">
              <button type="button" className="reports-button" disabled={Boolean(validationMessage)} onClick={() => window.print()}>
                <Printer aria-hidden="true" />
                Print
              </button>
              <button type="button" className="reports-button reports-primary" disabled={Boolean(validationMessage)} onClick={() => downloadDotReportPdf(report)}>
                <Download aria-hidden="true" />
                Download PDF
              </button>
            </div>
          </footer>
        </motion.div>
      </motion.div>
    </ModalPortal>
  );
}

export function Var1ReportDocument({ report }: { report: DotReportPdf }) {
  const days = var1Days(report.period, report.metrics);
  const monthly = var1MonthlyCells(report.demo, report.metrics);
  const display = (value: number | null) => (value === null ? "" : value.toLocaleString());
  return (
    <>
      <header className="var1-document-heading">
        <h2>TOURISM ATTRACTION VISITOR RECORD</h2>
        <span>(VAR 1)</span>
        <p>( This recording form can be used instead of just counting the visitors )</p>
      </header>
      <dl className="var1-document-information">
        {[
          ["Month/Year", report.period],
          ["Name of City/Municipality", "City of San Pedro, Laguna"],
          ["Name of attraction/ Spot", report.enterpriseName],
          ["Type of Tourism Attraction", report.attractionType ?? ""],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <table className="var1-official-table" aria-label="Tourism Attraction Visitor Record VAR 1">
        <colgroup>
          {VAR1_COLUMN_WEIGHTS.map((width, index) => (
            <col key={index} style={{ width: `${(width / 809) * 100}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2}>Date</th>
            <th colSpan={12}>*** Place of Residence</th>
            <th colSpan={3} rowSpan={3}>
              * Grand Total
              <br />
              Number of
              <br />
              Visitors
            </th>
          </tr>
          <tr>
            <th rowSpan={3}>Day</th>
            <th rowSpan={3}>
              Week Day
              <br />
              (Mon-Sun)
            </th>
            <th colSpan={9}>Philippines</th>
            <th colSpan={3} rowSpan={2}>
              Foreign Country Residence
            </th>
          </tr>
          <tr>
            {VAR1_RESIDENCES.slice(0, 3).map((label) => (
              <th key={label} colSpan={3}>
                {label}
              </th>
            ))}
          </tr>
          <tr>{Array.from({ length: 5 }, (_, group) => VAR1_SEX_COLUMNS.map((label) => <th key={`${group}-${label}`}>{label}</th>))}</tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date} data-var1-date={day.date}>
              <th scope="row">{day.day}</th>
              <td>{day.weekday}</td>
              {var1DailyCells(day, report.sampleDaily).map((value, index) => (
                <td key={index}>{display(value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2} scope="row">
              Total of this
              <br />
              Month ****
            </th>
            {monthly.map((value, index) => (
              <td key={index}>{display(value)}</td>
            ))}
          </tr>
        </tfoot>
      </table>
      {!days.length && <p className="var1-data-note">The saved reporting month could not be recognized. No daily dates have been invented.</p>}
      <p className="var1-official-note">{VAR1_NOTE}</p>
      <p className="var1-data-note">Sex and residence allocations are monthly. Unrecorded daily breakdowns are left blank.</p>
      {hasUnspecifiedCity(report.demo) && <p className="var1-data-note">This Province includes existing allocations with an unspecified city split.</p>}
    </>
  );
}
