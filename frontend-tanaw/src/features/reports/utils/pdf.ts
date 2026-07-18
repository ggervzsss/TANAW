import type { FinalReport, FinalReportSource, IntakeReport } from "@/shared/types";
import { getDotDemographics } from "./dotDemographics";

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const FONT_ID = 3;
const BOLD_FONT_ID = 4;

type PdfCommand = string;

type PdfPalette = {
  background: [number, number, number];
  text: [number, number, number];
  muted: [number, number, number];
  border: [number, number, number];
  header: [number, number, number];
  total: [number, number, number];
  accent: [number, number, number];
};

const lightExportPalette: PdfPalette = {
  background: [1, 1, 1],
  text: [0.06, 0.09, 0.14],
  muted: [0.35, 0.4, 0.48],
  border: [0.38, 0.43, 0.5],
  header: [0.93, 0.95, 0.97],
  total: [0.83, 0.87, 0.91],
  accent: [0.71, 0.54, 0.1],
};

const commandPalettes = new WeakMap<PdfCommand[], PdfPalette>();

function initializePage(commands: PdfCommand[]) {
  commandPalettes.set(commands, lightExportPalette);
  commands.push(`${rgbFill(lightExportPalette.background)} 0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} re f`);
}

function paletteFor(commands: PdfCommand[]) {
  return commandPalettes.get(commands) ?? lightExportPalette;
}

function rgbFill([red, green, blue]: [number, number, number]) {
  return `${red} ${green} ${blue} rg`;
}

function rgbStroke([red, green, blue]: [number, number, number]) {
  return `${red} ${green} ${blue} RG`;
}

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
  const pdf = createIntakeReportPdf(report);
  downloadPdf(pdf, `${report.id}.pdf`);
}

export function createIntakeReportPdf(report: IntakeReport) {
  const demographics = getDotDemographics(report.metrics.unique, report.demographics ?? report.payload?.demo);
  const rows: TableCell[][] = [
    [{ value: report.enterprise, align: "left", bold: true }, { value: report.code }, ...Array.from({ length: 12 }, () => ({ value: "" }))],
    [
      { value: report.month, align: "left" },
      { value: "" },
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
  initializePage(commands);
  drawTitle(commands, "TANAW - DOT Visitor Attraction Report", report.id);
  drawMetadata(commands, [
    ["Enterprise", report.enterprise],
    ["Category", report.category],
    ["Barangay", report.barangay],
    ["Reporting Period", report.period],
    ["Submitted", report.submittedAt ?? report.submitted],
    ["Review Status", report.status],
  ]);
  drawDotTable(commands, 390, rows);
  drawText(commands, "Live Count Summary", MARGIN, 280, 11, true);
  drawText(commands, `Entries: ${formatNumber(report.metrics.entry)}   Exits: ${formatNumber(report.metrics.exit)}   Peak Occupancy: ${report.metrics.peak}`, MARGIN, 260, 9);
  drawWrappedText(commands, `Remarks: ${report.remarks || report.notes || "None recorded."}`, MARGIN, 240, PAGE_WIDTH - MARGIN * 2, 9);

  return buildPdf([commands.join("\n")]);
}

export function downloadFinalReportPdf(report: FinalReport) {
  const pdf = createFinalReportPdf(report);
  downloadPdf(pdf, `${report.id}.pdf`);
}

export function createFinalReportPdf(report: FinalReport) {
  const sourceRows = report.sources.map((source) => buildFinalReportSourceRow(source, report.period));
  const totalRows = buildFinalReportTotalRow(report);
  const pages: string[] = [];
  const rowsPerPage = 7;
  const pageCount = Math.max(1, Math.ceil(sourceRows.length / rowsPerPage));

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const commands: PdfCommand[] = [];
    initializePage(commands);
    const pageRows = sourceRows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    const isLastPage = pageIndex === pageCount - 1;

    drawTitle(commands, "City Government of San Pedro", report.id, "Tourism & Economic Development Office");
    drawText(commands, report.title, MARGIN, 486, 14, true, "center", PAGE_WIDTH - MARGIN * 2);
    drawText(commands, `Reporting Period: ${report.period}`, MARGIN, 468, 9, false, "center", PAGE_WIDTH - MARGIN * 2);
    drawMetadata(
      commands,
      [
        ["Generated On", report.generatedOn],
        ["Prepared By", `${report.preparedBy} (${report.preparedRole})`],
        ["Audit Status", report.status],
        ["Registered Sources", String(report.enterpriseCount)],
      ],
      442,
    );
    drawWrappedText(
      commands,
      `This document certifies the consolidated visitor analytics derived from TANAW live-count records for the stated period. Aggregation relies on verified local camera records from ${report.enterpriseCount} monitored enterprise nodes.`,
      MARGIN,
      390,
      PAGE_WIDTH - MARGIN * 2,
      8,
    );
    drawDotTable(commands, 350, isLastPage ? [...pageRows, totalRows] : pageRows);
    if (isLastPage) drawSignatures(commands, report.preparedRole);
    drawText(commands, `Page ${pageIndex + 1} of ${pageCount}`, PAGE_WIDTH - MARGIN - 58, 18, 8, false, "right", 58);
    pages.push(commands.join("\n"));
  }

  return buildPdf(pages);
}

function buildFinalReportSourceRow(source: FinalReportSource, period: string): TableCell[] {
  const demographics = getDotDemographics(source.unique, source.demographics);
  return [
    { value: `${source.enterprise}\n${period}`, align: "left", bold: true },
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
      const demographics = getDotDemographics(source.unique, source.demographics);
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

function drawTitle(commands: PdfCommand[], title: string, artifactId: string, subtitle?: string) {
  const usableWidth = PAGE_WIDTH - MARGIN * 2;
  drawText(commands, title, MARGIN, PAGE_HEIGHT - 45, 16, true, "center", usableWidth);
  if (subtitle) drawText(commands, subtitle, MARGIN, PAGE_HEIGHT - 62, 9, false, "center", usableWidth);
  drawText(commands, artifactId, MARGIN, PAGE_HEIGHT - 78, 8, false, "center", usableWidth);
  drawLine(commands, MARGIN, PAGE_HEIGHT - 88, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 88, 1);
}

function drawMetadata(commands: PdfCommand[], rows: [string, string][], startY = PAGE_HEIGHT - 115) {
  const leftX = MARGIN;
  const rightX = 430;
  rows.forEach(([label, value], index) => {
    const x = index % 2 === 0 ? leftX : rightX;
    const y = startY - Math.floor(index / 2) * 22;
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
  const rowHeight = 25;
  const headerY = topY - headerHeight;

  drawFilledRect(commands, tableX, headerY, sumWidths(columns), headerHeight, 0.92);
  let x = tableX;
  columns.forEach((column) => {
    drawRect(commands, x, headerY, column.width, headerHeight);
    drawWrappedText(commands, column.label, x + 4, topY - 12, column.width - 8, 7, true, column.align ?? "center");
    x += column.width;
  });

  rows.forEach((row, rowIndex) => {
    const y = headerY - (rowIndex + 1) * rowHeight;
    if (rowIndex === rows.length - 1 && row[0]?.value === "Citywide Consolidated Total") {
      drawFilledRect(commands, tableX, y, sumWidths(columns), rowHeight, 0.88);
    }
    let cellX = tableX;
    row.forEach((cell, cellIndex) => {
      const column = columns[cellIndex];
      drawRect(commands, cellX, y, column.width, rowHeight);
      drawWrappedText(commands, formatCell(cell.value), cellX + 4, y + rowHeight - 10, column.width - 8, 7, cell.bold, cell.align ?? column.align ?? "center");
      cellX += column.width;
    });
  });
}

function drawSignatures(commands: PdfCommand[], preparedRole: string) {
  const columns = [MARGIN, PAGE_WIDTH / 2 - 95, PAGE_WIDTH - MARGIN - 190];
  const labels = ["PREPARED BY", "CHECKED BY", "APPROVED BY"];
  const roles = [preparedRole, "Tourism Audit Officer", "Head of Department"];

  columns.forEach((x, index) => {
    drawLine(commands, x, 76, x + 190, 76, 0.6);
    drawText(commands, labels[index], x, 60, 8, true, "center", 190);
    drawText(commands, roles[index], x, 47, 7, false, "center", 190);
  });
}

function drawText(commands: PdfCommand[], text: string, x: number, y: number, size: number, bold = false, align: "left" | "right" | "center" = "left", maxWidth = 0) {
  const palette = paletteFor(commands);
  const width = Math.min(maxWidth || Number.POSITIVE_INFINITY, text.length * size * 0.52);
  const textX = align === "right" ? x + maxWidth - width : align === "center" ? x + (maxWidth - width) / 2 : x;
  commands.push(`BT /F${bold ? 2 : 1} ${size} Tf ${rgbFill(palette.text)} ${textX} ${y} Td (${escapePdf(text)}) Tj ET`);
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
  commands.push(`${rgbStroke(paletteFor(commands).accent)} ${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
}

function drawRect(commands: PdfCommand[], x: number, y: number, width: number, height: number) {
  commands.push(`${rgbStroke(paletteFor(commands).border)} 0.6 w ${x} ${y} ${width} ${height} re S`);
}

function drawFilledRect(commands: PdfCommand[], x: number, y: number, width: number, height: number, gray: number) {
  const palette = paletteFor(commands);
  const fill = gray <= 0.89 ? palette.total : palette.header;
  commands.push(`${rgbFill(fill)} ${x} ${y} ${width} ${height} re f`);
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
  objects[BOLD_FONT_ID - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((content, index) => {
    const pageObjectId = BOLD_FONT_ID + 1 + index * 2;
    const contentObjectId = pageObjectId + 1;
    pageObjectIds.push(pageObjectId);
    objects[pageObjectId - 1] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${FONT_ID} 0 R /F2 ${BOLD_FONT_ID} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
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
