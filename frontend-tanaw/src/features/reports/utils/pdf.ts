import type { FinalReport, FinalReportSource, IntakeReport } from "@/shared/types";
import { combineDotDemographics, dotDemographicValue, getDotDemographics, type DotDemographicsResult } from "./dotDemographics";
import { recordedActor, recordedText } from "./reportPresentation";

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const FONT_ID = 3;

type PdfCommand = string;

type TableColumn = {
  label: string;
  width: number;
  align?: "left" | "right" | "center";
};

type TableCell = {
  value: string | number;
  align?: "left" | "right" | "center";
  bold?: boolean;
};

export function downloadIntakeReportPdf(report: IntakeReport) {
  downloadPdf(buildIntakeReportPdf(report), `${report.id}.pdf`);
}

export function buildIntakeReportPdf(report: IntakeReport) {
  const demographics = getDotDemographics(report.metrics.unique, report.demographics ?? report.payload?.demo);
  const rows: TableCell[][] = [
    [
      { value: `${recordedText(report.enterprise, "Not provided")}\n${recordedText(report.month, "Not provided")}`, align: "left", bold: true },
      { value: recordedText(report.code, "Not provided") },
      ...buildDemographicCells(demographics),
      { value: report.metrics.unique, bold: true },
    ],
  ];

  const commands: PdfCommand[] = [];
  drawTitle(commands, "TANAW - DOT Visitor Attraction Report", recordedText(report.id, "Not recorded"));
  drawMetadata(commands, [
    ["Enterprise", recordedText(report.enterprise, "Not provided")],
    ["Category", recordedText(report.category, "Not provided")],
    ["Barangay", recordedText(report.barangay, "Not provided")],
    ["Reporting Period", recordedText(report.period, "Not provided")],
    ["Submitted", recordedText(report.submittedAt ?? report.submitted)],
    ["Review Status", recordedText(report.status)],
  ]);
  drawDotTable(commands, 222, rows);
  drawText(commands, "Live Count Summary", MARGIN, 120, 11, true);
  drawText(commands, `Entries: ${formatNumber(report.metrics.entry)}   Exits: ${formatNumber(report.metrics.exit)}   Peak Occupancy: ${recordedText(report.metrics.peak)}`, MARGIN, 102, 9);
  drawText(commands, `Remarks: ${recordedText(report.remarks || report.notes)}`, MARGIN, 86, 9);
  drawText(commands, "Place-of-residence values are submitted data only; missing or inconsistent fields are not estimated.", MARGIN, 70, 8);

  return buildPdf([commands.join("\n")]);
}

export function downloadFinalReportPdf(report: FinalReport) {
  downloadPdf(buildFinalReportPdf(report), `${report.id}.pdf`);
}

export function buildFinalReportPdf(report: FinalReport) {
  const sourceRows = report.sources.map((source) => buildFinalReportSourceRow(source));
  const totalRows = buildFinalReportTotalRow(report);
  const pages: string[] = [];
  const rowsPerPage = 10;
  const pageCount = Math.max(1, Math.ceil(sourceRows.length / rowsPerPage));

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const commands: PdfCommand[] = [];
    const pageRows = sourceRows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    const isLastPage = pageIndex === pageCount - 1;

    drawTitle(commands, "TANAW - Consolidated DOT Visitor Attraction Report", recordedText(report.id, "Not recorded"));
    drawMetadata(commands, [
      ["Report Title", recordedText(report.title, "Not provided")],
      ["Reporting Period", recordedText(report.period, "Not provided")],
      ["Generated On", recordedText(report.generatedOn)],
      ["Prepared By", `${recordedActor(report.preparedBy)} (${recordedText(report.preparedRole, "Role not recorded")})`],
      ["Audit Status", recordedText(report.status)],
      ["Source Reports", String(report.sources.length)],
    ]);
    drawDotTable(commands, 222, isLastPage ? [...pageRows, totalRows] : pageRows);
    drawText(commands, `Page ${pageIndex + 1}`, PAGE_WIDTH - MARGIN - 40, 28, 8);
    pages.push(commands.join("\n"));
  }

  return buildPdf(pages);
}

function buildFinalReportSourceRow(source: FinalReportSource): TableCell[] {
  const demographics = getDotDemographics(source.unique, source.demographics);
  return [
    { value: recordedText(source.enterprise, "Not provided"), align: "left", bold: true },
    { value: recordedText(source.code, "Not provided") },
    ...buildDemographicCells(demographics),
    { value: source.unique, bold: true },
  ];
}

function buildFinalReportTotalRow(report: FinalReport): TableCell[] {
  const totals = combineDotDemographics(report.sources.map((source) => getDotDemographics(source.unique, source.demographics)));
  const visitorTotal = report.sources.length > 0 ? report.sources.reduce((total, source) => total + source.unique, 0) : "Insufficient source data";

  return [{ value: "Consolidated Total", align: "left", bold: true }, { value: "" }, ...buildDemographicCells(totals), { value: visitorTotal, bold: true }];
}

function buildDemographicCells(demographics: DotDemographicsResult): TableCell[] {
  return [
    { value: dotDemographicValue(demographics, "provMale") },
    { value: dotDemographicValue(demographics, "provFemale") },
    { value: dotDemographicValue(demographics, "provTotal"), bold: true },
    { value: dotDemographicValue(demographics, "otherMale") },
    { value: dotDemographicValue(demographics, "otherFemale") },
    { value: dotDemographicValue(demographics, "otherTotal"), bold: true },
    { value: dotDemographicValue(demographics, "foreignMale") },
    { value: dotDemographicValue(demographics, "foreignFemale") },
    { value: dotDemographicValue(demographics, "foreignTotal"), bold: true },
    { value: dotDemographicValue(demographics, "grandMale"), bold: true },
    { value: dotDemographicValue(demographics, "grandFemale"), bold: true },
  ];
}

function drawTitle(commands: PdfCommand[], title: string, artifactId: string) {
  drawText(commands, title, MARGIN, PAGE_HEIGHT - 45, 16, true);
  drawText(commands, artifactId, MARGIN, PAGE_HEIGHT - 64, 9);
  drawLine(commands, MARGIN, PAGE_HEIGHT - 76, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 76, 1);
}

function drawMetadata(commands: PdfCommand[], rows: [string, string][]) {
  const leftX = MARGIN;
  const rightX = 430;
  rows.forEach(([label, value], index) => {
    const x = index % 2 === 0 ? leftX : rightX;
    const y = PAGE_HEIGHT - 102 - Math.floor(index / 2) * 22;
    drawText(commands, label.toUpperCase(), x, y + 9, 7, true);
    drawText(commands, value, x, y - 4, 9);
  });
}

function drawDotTable(commands: PdfCommand[], topY: number, rows: TableCell[][]) {
  const columns: TableColumn[] = [
    { label: "Visitor Attraction / Name / Month", width: 150, align: "left" },
    { label: "Code", width: 48 },
    { label: "Prov M", width: 44, align: "right" },
    { label: "Prov F", width: 44, align: "right" },
    { label: "Prov T", width: 44, align: "right" },
    { label: "Other M", width: 44, align: "right" },
    { label: "Other F", width: 44, align: "right" },
    { label: "Other T", width: 44, align: "right" },
    { label: "Foreign M", width: 48, align: "right" },
    { label: "Foreign F", width: 48, align: "right" },
    { label: "Foreign T", width: 48, align: "right" },
    { label: "Grand M", width: 48, align: "right" },
    { label: "Grand F", width: 48, align: "right" },
    { label: "Total", width: 54, align: "right" },
  ];
  const tableX = MARGIN;
  const headerHeight = 34;
  const rowHeight = 36;

  drawFilledRect(commands, tableX, topY, sumWidths(columns), headerHeight, 0.92);
  let x = tableX;
  columns.forEach((column) => {
    drawRect(commands, x, topY, column.width, headerHeight);
    drawWrappedText(commands, column.label, x + 4, topY + headerHeight - 12, column.width - 8, 7, true, column.align ?? "center");
    x += column.width;
  });

  rows.forEach((row, rowIndex) => {
    const y = topY - (rowIndex + 1) * rowHeight;
    if (rowIndex === rows.length - 1 && row[0]?.value === "Consolidated Total") {
      drawFilledRect(commands, tableX, y, sumWidths(columns), rowHeight, 0.88);
    }
    let cellX = tableX;
    row.forEach((cell, cellIndex) => {
      const column = columns[cellIndex];
      drawRect(commands, cellX, y, column.width, rowHeight);
      drawWrappedText(commands, formatCell(cell.value), cellX + 4, y + rowHeight - 13, column.width - 8, 8, cell.bold, cell.align ?? column.align ?? "center");
      cellX += column.width;
    });
  });
}

function drawText(commands: PdfCommand[], text: string, x: number, y: number, size: number, bold = false) {
  commands.push(`BT /F1 ${size} Tf ${bold ? "0.08 g" : "0 g"} ${x} ${y} Td (${escapePdf(text)}) Tj ET`);
}

function drawWrappedText(commands: PdfCommand[], text: string, x: number, y: number, maxWidth: number, size: number, bold = false, align: "left" | "right" | "center" = "left") {
  const approximateChars = Math.max(4, Math.floor(maxWidth / (size * 0.52)));
  const lines = wrapText(text, approximateChars).slice(0, 3);
  lines.forEach((line, index) => {
    const lineWidth = Math.min(maxWidth, line.length * size * 0.52);
    const offset = align === "right" ? maxWidth - lineWidth : align === "center" ? (maxWidth - lineWidth) / 2 : 0;
    drawText(commands, line, x + offset, y - index * (size + 2), size, bold);
  });
}

function drawLine(commands: PdfCommand[], x1: number, y1: number, x2: number, y2: number, width: number) {
  commands.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
}

function drawRect(commands: PdfCommand[], x: number, y: number, width: number, height: number) {
  commands.push(`0 g 0.6 w ${x} ${y} ${width} ${height} re S`);
}

function drawFilledRect(commands: PdfCommand[], x: number, y: number, width: number, height: number, gray: number) {
  commands.push(`${gray} g ${x} ${y} ${width} ${height} re f 0 g`);
}

function downloadPdf(pdf: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFileName(fileName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildPdf(pages: string[]) {
  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const catalogId = 1;
  const pagesId = 2;

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[FONT_ID - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((content, index) => {
    const pageObjectId = 4 + index * 2;
    const contentObjectId = pageObjectId + 1;
    pageObjectIds.push(pageObjectId);
    objects[pageObjectId - 1] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${FONT_ID} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function wrapText(text: string, maxChars: number) {
  return text.split("\n").flatMap((line) => {
    const words = line.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    });
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  });
}

function escapePdf(value: string) {
  return value
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function sumWidths(columns: TableColumn[]) {
  return columns.reduce((total, column) => total + column.width, 0);
}

function formatCell(value: string | number) {
  return typeof value === "number" ? formatNumber(value) : value;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}
