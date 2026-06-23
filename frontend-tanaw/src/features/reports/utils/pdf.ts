import type { FinalReport, FinalReportSource, IntakeReport } from "@/shared/types";
import { getDotDemographics } from "./dotDemographics";

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
  const demographics = getDotDemographics(report.metrics.unique);
  const rows: TableCell[][] = [
    [
      { value: `${report.enterprise}\n${report.month}`, align: "left", bold: true },
      { value: report.code },
      { value: demographics.provMale },
      { value: demographics.provFemale },
      { value: demographics.provTotal, bold: true },
      { value: demographics.otherMale },
      { value: demographics.otherFemale },
      { value: demographics.otherTotal, bold: true },
      { value: demographics.foreignMale },
      { value: demographics.foreignFemale },
      { value: demographics.foreignTotal, bold: true },
      { value: demographics.grandMale, bold: true },
      { value: demographics.grandFemale, bold: true },
      { value: report.metrics.unique, bold: true },
    ],
  ];

  const commands: PdfCommand[] = [];
  drawTitle(commands, "TANAW - DOT Visitor Attraction Report", report.id);
  drawMetadata(commands, [
    ["Enterprise", report.enterprise],
    ["Category", report.category],
    ["Barangay", report.barangay],
    ["Reporting Period", report.period],
    ["Submitted", report.submittedAt ?? report.submitted],
    ["Review Status", report.status],
  ]);
  drawDotTable(commands, 222, rows);
  drawText(commands, "Telemetry Summary", MARGIN, 120, 11, true);
  drawText(commands, `Entries: ${formatNumber(report.metrics.entry)}   Exits: ${formatNumber(report.metrics.exit)}   Peak Occupancy: ${report.metrics.peak}`, MARGIN, 102, 9);
  drawText(commands, `Remarks: ${report.remarks || report.notes || "None recorded."}`, MARGIN, 86, 9);

  downloadPdf([commands.join("\n")], `${report.id}.pdf`);
}

export function downloadFinalReportPdf(report: FinalReport) {
  const sourceRows = report.sources.map((source) => buildFinalReportSourceRow(source));
  const totalRows = buildFinalReportTotalRow(report);
  const pages: string[] = [];
  const rowsPerPage = 10;
  const pageCount = Math.max(1, Math.ceil(sourceRows.length / rowsPerPage));

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const commands: PdfCommand[] = [];
    const pageRows = sourceRows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    const isLastPage = pageIndex === pageCount - 1;

    drawTitle(commands, "TANAW - Consolidated DOT Visitor Attraction Report", report.id);
    drawMetadata(commands, [
      ["Report Title", report.title],
      ["Reporting Period", report.period],
      ["Generated On", report.generatedOn],
      ["Prepared By", `${report.preparedBy} (${report.preparedRole})`],
      ["Audit Status", report.status],
      ["Registered Sources", String(report.enterpriseCount)],
    ]);
    drawDotTable(commands, 222, isLastPage ? [...pageRows, totalRows] : pageRows);
    drawText(commands, `Page ${pageIndex + 1}`, PAGE_WIDTH - MARGIN - 40, 28, 8);
    pages.push(commands.join("\n"));
  }

  downloadPdf(pages, `${report.id}.pdf`);
}

function buildFinalReportSourceRow(source: FinalReportSource): TableCell[] {
  const demographics = getDotDemographics(source.unique);
  return [
    { value: source.enterprise, align: "left", bold: true },
    { value: source.code },
    { value: demographics.provMale },
    { value: demographics.provFemale },
    { value: demographics.provTotal, bold: true },
    { value: demographics.otherMale },
    { value: demographics.otherFemale },
    { value: demographics.otherTotal, bold: true },
    { value: demographics.foreignMale },
    { value: demographics.foreignFemale },
    { value: demographics.foreignTotal, bold: true },
    { value: demographics.grandMale, bold: true },
    { value: demographics.grandFemale, bold: true },
    { value: source.unique, bold: true },
  ];
}

function buildFinalReportTotalRow(report: FinalReport): TableCell[] {
  const totals = report.sources.reduce(
    (next, source) => {
      const demographics = getDotDemographics(source.unique);
      return {
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
      };
    },
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
    },
  );

  return [
    { value: "Citywide Consolidated Total", align: "left", bold: true },
    { value: "" },
    { value: totals.provMale, bold: true },
    { value: totals.provFemale, bold: true },
    { value: totals.provTotal, bold: true },
    { value: totals.otherMale, bold: true },
    { value: totals.otherFemale, bold: true },
    { value: totals.otherTotal, bold: true },
    { value: totals.foreignMale, bold: true },
    { value: totals.foreignFemale, bold: true },
    { value: totals.foreignTotal, bold: true },
    { value: totals.grandMale, bold: true },
    { value: totals.grandFemale, bold: true },
    { value: report.totalUnique, bold: true },
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
    if (rowIndex === rows.length - 1 && row[0]?.value === "Citywide Consolidated Total") {
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

function downloadPdf(pages: string[], fileName: string) {
  const pdf = buildPdf(pages);
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
    objects[pageObjectId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${FONT_ID} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
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
  return text
    .split("\n")
    .flatMap((line) => {
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
