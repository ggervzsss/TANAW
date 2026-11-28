import toast from "react-hot-toast/headless";
import type { FinalReport, IntakeReport } from "@/shared/types";
import { buildVar3, var2mFromFinalReport, var2mFromIntakeReport, type Var3Form } from "../model/varForms";
import { buildPdfDocument, downloadPdfDocument, printPdfDocument } from "./pdfDocument";
import { finishVarPdfPages, var2mPdfPages, var3PdfPages } from "./varPdf";

export function createIntakeReportPdf(report: IntakeReport) {
  return buildPdfDocument(finishVarPdfPages(var2mPdfPages(var2mFromIntakeReport(report)), report.code));
}

const PRINT_FALLBACK_MESSAGE = "This browser could not print the report, so the PDF was downloaded instead.";

function printOrDownload(pdf: string, fileName: string) {
  printPdfDocument(pdf, fileName, () => toast.error(PRINT_FALLBACK_MESSAGE));
}

export function downloadFinalReportPdf(report: FinalReport) {
  downloadPdfDocument(createFinalReportPdf(report), `${report.id}.pdf`);
}

/** Prints the same official VAR 2M sheet that Download PDF saves. */
export function printFinalReportPdf(report: FinalReport) {
  printOrDownload(createFinalReportPdf(report), `${report.id}.pdf`);
}

/** A draft carries "DRAFT - NOT FINAL" above the sheet and in its footer, outside the DOT grid. */
export function createFinalReportPdf(report: FinalReport) {
  const draft = report.status === "Draft" ? `DRAFT - NOT FINAL (${report.enterpriseCount} of ${Math.max(report.enterpriseTotal, report.enterpriseCount)} enterprises)` : undefined;
  return buildPdfDocument(finishVarPdfPages(var2mPdfPages(var2mFromFinalReport(report)), report.id, { draft }));
}

export function downloadAnnualReportPdf(reports: readonly FinalReport[], year: number) {
  downloadPdfDocument(createAnnualReportPdf(buildVar3(reports, year)), `VAR3M-${year}.pdf`);
}

/** Prints the same official VAR 3M sheet that Download PDF saves. */
export function printAnnualReportPdf(reports: readonly FinalReport[], year: number) {
  printOrDownload(createAnnualReportPdf(buildVar3(reports, year)), `VAR3M-${year}.pdf`);
}

export function createAnnualReportPdf(form: Var3Form) {
  return buildPdfDocument(finishVarPdfPages(var3PdfPages(form), `VAR 3M - ${form.municipality}, ${form.province} - ${form.year}`));
}
