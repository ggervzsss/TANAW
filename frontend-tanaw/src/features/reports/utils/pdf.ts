import type { FinalReport, IntakeReport } from "@/shared/types";
import { buildVar3, var2mFromFinalReport, var2mFromIntakeReport, type Var3Form } from "../model/varForms";
import { buildPdfDocument, downloadPdfDocument } from "./pdfDocument";
import { finishVarPdfPages, var2mPdfPages, var3PdfPages } from "./varPdf";

export function downloadIntakeReportPdf(report: IntakeReport) {
  downloadPdfDocument(createIntakeReportPdf(report), `${report.code}.pdf`);
}

export function createIntakeReportPdf(report: IntakeReport) {
  return buildPdfDocument(finishVarPdfPages(var2mPdfPages(var2mFromIntakeReport(report)), report.code));
}

export function downloadFinalReportPdf(report: FinalReport) {
  downloadPdfDocument(createFinalReportPdf(report), `${report.id}.pdf`);
}

export function createFinalReportPdf(report: FinalReport) {
  return buildPdfDocument(finishVarPdfPages(var2mPdfPages(var2mFromFinalReport(report)), report.id));
}

export function downloadAnnualReportPdf(reports: readonly FinalReport[], year: number) {
  downloadPdfDocument(createAnnualReportPdf(buildVar3(reports, year)), `VAR3M-${year}.pdf`);
}

export function createAnnualReportPdf(form: Var3Form) {
  return buildPdfDocument(finishVarPdfPages(var3PdfPages(form), `VAR 3M - ${form.municipality}, ${form.province} - ${form.year}`));
}
