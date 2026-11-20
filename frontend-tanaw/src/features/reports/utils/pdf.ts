import type { FinalReport, IntakeReport } from "@/shared/types";
import { formatPhilippineDateTime, type SystemTimeFormat } from "@/shared/utils/dateTime";
import { buildVar2m, buildVar3, var2mFromFinalReport, type Var3Form } from "../model/varForms";
import { countingNotes, measuredCount } from "./counting";
import { buildPdfDocument, downloadPdfDocument } from "./pdfDocument";
import { wrappedPdfLines } from "./pdfText";
import { finishVarPdfPages, newPdfPage, pdfParagraph, pdfText, VAR_PAGE, var2mPdfPages, var3PdfPages, type PdfPage } from "./varPdf";

const USABLE_WIDTH = VAR_PAGE.width - VAR_PAGE.margin * 2;
const LINES_PER_PAGE = 46;

/** Supporting pages after the official form: lineage and camera evidence, never extra totals. */
function supportingPages(title: string, subtitle: string, lines: string[]): PdfPage[] {
  const wrapped = lines.flatMap((line) => wrappedPdfLines(line, USABLE_WIDTH, 8));
  const pages: PdfPage[] = [];
  for (let offset = 0; offset < wrapped.length; offset += LINES_PER_PAGE) {
    const page = newPdfPage();
    const top = VAR_PAGE.height - VAR_PAGE.margin;
    pdfText(page, title, VAR_PAGE.margin, top - 6, 12, { bold: true });
    pdfText(page, subtitle, VAR_PAGE.margin, top - 20, 8, { gray: true });
    wrapped.slice(offset, offset + LINES_PER_PAGE).forEach((line, index) => pdfText(page, line, VAR_PAGE.margin, top - 44 - index * 10, 8));
    pages.push(page);
  }
  return pages;
}

export function downloadIntakeReportPdf(report: IntakeReport, timeFormat: SystemTimeFormat = "12-hour") {
  downloadPdfDocument(createIntakeReportPdf(report, timeFormat), `${report.code}.pdf`);
}

/** One establishment's month as a single VAR 2M row, followed by its saved summary. */
export function createIntakeReportPdf(report: IntakeReport, timeFormat: SystemTimeFormat = "12-hour") {
  const form = buildVar2m(report.period, [{ id: report.id, name: report.enterprise, unique: report.metrics.unique, demographics: report.demographics ?? report.payload?.demo }]);
  const summary = [
    `Enterprise: ${report.enterprise}   Category: ${report.category}   Barangay: ${report.barangay}`,
    `Submitted: ${formatReportSubmittedDate(report.submittedAt ?? report.submitted, timeFormat)}   Review status: ${report.status}   Report code: ${report.code}`,
    `Entries: ${measuredCount(report.metrics.entry)}   Exits: ${measuredCount(report.metrics.exit)}   Peak Occupancy: ${measuredCount(report.metrics.peak)}`,
    "Visitor totals are camera estimates. Demographic allocations are entered by the establishment. Source counts remain read-only.",
    ...countingNotes(report.payload?.counting),
    `Operator notes: ${report.notes || "None recorded."}`,
    `Staff remarks: ${report.remarks || "None recorded."}`,
  ];
  const pages = [...var2mPdfPages(form), ...supportingPages("Saved Establishment Summary", `${report.enterprise} - ${report.period}`, summary)];
  return buildPdfDocument(finishVarPdfPages(pages, report.code));
}

export function downloadFinalReportPdf(report: FinalReport) {
  downloadPdfDocument(createFinalReportPdf(report), `${report.id}.pdf`);
}

/** The month's consolidated VAR 2M, then the establishment counting details behind it. */
export function createFinalReportPdf(report: FinalReport) {
  const reference = `${report.id} - Prepared by ${report.preparedBy} (${report.preparedRole}) - ${report.status}`;
  const evidence = report.sources.flatMap((source) => {
    const notes = countingNotes(source.counting);
    return notes.length ? [`${source.enterprise} - ${source.code}`, ...notes] : [];
  });
  const lines =
    evidence.length || report.totalEntry === null || report.totalExit === null
      ? [
          `Citywide arrivals: ${measuredCount(report.totalEntry)}. Citywide departures: ${measuredCount(report.totalExit)}. Missing source measurements make the citywide movement total unavailable. Each establishment total contributes once.`,
          ...evidence,
        ]
      : [];
  const pages = [...var2mPdfPages(var2mFromFinalReport(report)), ...supportingPages("Establishment Counting Details", "Supporting evidence - not additional visitor totals", lines)];
  return buildPdfDocument(finishVarPdfPages(pages, reference));
}

export function downloadAnnualReportPdf(reports: readonly FinalReport[], year: number) {
  downloadPdfDocument(createAnnualReportPdf(buildVar3(reports, year)), `VAR3M-${year}.pdf`);
}

export function createAnnualReportPdf(form: Var3Form) {
  const pages = var3PdfPages(form);
  const included = form.months.flatMap((month) => month.reportIds);
  const lineage = included.length ? [`Compiled from finalized monthly reports: ${included.join(", ")}.`] : [];
  if (lineage.length) {
    const last = pages[pages.length - 1];
    pdfParagraph(last, lineage[0], VAR_PAGE.margin, 40, USABLE_WIDTH, 7, { gray: true });
  }
  return buildPdfDocument(finishVarPdfPages(pages, `VAR 3M - ${form.municipality}, ${form.province} - ${form.year}`));
}

export function formatReportSubmittedDate(value: string, timeFormat: SystemTimeFormat = "12-hour") {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${formatPhilippineDateTime(date, timeFormat)} Philippine Time`;
}
