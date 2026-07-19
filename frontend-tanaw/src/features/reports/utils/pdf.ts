import type { FinalReport, FinalReportSource, IntakeReport } from "@/shared/types";
import { formatPhilippineDateTime, type SystemTimeFormat } from "@/shared/utils/dateTime";
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

type TableRow = {
  cells: TableCell[];
  height: number;
  total?: boolean;
};

const DOT_COLUMNS: TableColumn[] = [
  { label: "Name / Month", width: 134, align: "left" },
  { label: "Report Code", width: 64 },
  { label: "Male", width: 44, align: "right" },
  { label: "Female", width: 44, align: "right" },
  { label: "Total", width: 44, align: "right" },
  { label: "Male", width: 44, align: "right" },
  { label: "Female", width: 44, align: "right" },
  { label: "Total", width: 44, align: "right" },
  { label: "Male", width: 48, align: "right" },
  { label: "Female", width: 48, align: "right" },
  { label: "Total", width: 48, align: "right" },
  { label: "Male", width: 48, align: "right" },
  { label: "Female", width: 48, align: "right" },
  { label: "Total", width: 54, align: "right" },
];

const DOT_HEADER_HEIGHT = 62;

export function downloadIntakeReportPdf(report: IntakeReport, timeFormat: SystemTimeFormat = "12-hour") {
  const pdf = createIntakeReportPdf(report, timeFormat);
  downloadPdf(pdf, `${report.code}.pdf`);
}

export function createIntakeReportPdf(report: IntakeReport, timeFormat: SystemTimeFormat = "12-hour") {
  const demographics = getDotDemographics(report.metrics.unique, report.demographics ?? report.payload?.demo);
  const rows = createTableRows([
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
  ]);

  const commands: PdfCommand[] = [];
  initializePage(commands);
  drawTitle(commands, "TANAW - DOT Visitor Attraction Report", report.code, "Tourism Attraction Visitor Record - VAR 2");
  const metadataBottom = drawMetadata(commands, [
    ["Enterprise", report.enterprise],
    ["Category", report.category],
    ["Barangay", report.barangay],
    ["Municipality", "City of San Pedro, Laguna"],
    ["Reporting Period", report.period],
    ["Submitted", formatReportSubmittedDate(report.submittedAt ?? report.submitted, timeFormat)],
    ["Review Status", report.status],
    ["Report Code", report.code],
  ]);
  const tableBottom = drawDotTable(commands, Math.min(390, metadataBottom - 12), rows);
  let detailY = tableBottom - 22;
  drawText(commands, "Live Count Summary", MARGIN, detailY, 11, true);
  detailY -= 20;
  drawText(commands, `Entries: ${formatNumber(report.metrics.entry)}   Exits: ${formatNumber(report.metrics.exit)}   Peak Occupancy: ${report.metrics.peak}`, MARGIN, detailY, 9);
  detailY -= 20;
  const remarkLines = wrappedLines(`Remarks: ${report.remarks || report.notes || "None recorded."}`, PAGE_WIDTH - MARGIN * 2, 9);
  const firstPageRemarkCapacity = Math.max(1, Math.floor((detailY - 58) / 11) + 1);
  const firstPageRemarks = remarkLines.slice(0, firstPageRemarkCapacity);
  firstPageRemarks.forEach((line, index) => drawText(commands, line, MARGIN, detailY - index * 11, 9));
  drawWrappedText(
    commands,
    "Note: Demographic splits and unique visitors are estimates derived from TANAW local camera records. Source counts remain read-only.",
    MARGIN,
    39,
    PAGE_WIDTH - MARGIN * 2,
    7,
  );

  const pages = [commands];
  for (let offset = firstPageRemarks.length; offset < remarkLines.length; offset += 42) {
    const continuation: PdfCommand[] = [];
    initializePage(continuation);
    drawTitle(continuation, "TANAW - DOT Visitor Attraction Report", report.code, "Remarks continued");
    remarkLines.slice(offset, offset + 42).forEach((line, index) => drawText(continuation, line, MARGIN, 470 - index * 10, 8));
    pages.push(continuation);
  }
  pages.forEach((page, index) => drawText(page, `Page ${index + 1} of ${pages.length}`, PAGE_WIDTH - MARGIN - 58, 18, 8, false, "right", 58));

  return buildPdf(pages.map((page) => page.join("\n")));
}

export function downloadFinalReportPdf(report: FinalReport) {
  const pdf = createFinalReportPdf(report);
  downloadPdf(pdf, `${report.id}.pdf`);
}

export function createFinalReportPdf(report: FinalReport) {
  const sourceRows = createTableRows(report.sources.map((source) => buildFinalReportSourceRow(source, report.period)));
  const totalRow = createTableRows([buildFinalReportTotalRow(report)], true)[0];
  const metadataRows: [string, string][] = [
    ["Generated On", formatPhilippineDateTime(report.generatedOn, "12-hour", { dateStyle: "medium" })],
    ["Prepared By", `${report.preparedBy} (${report.preparedRole})`],
    ["Audit Status", report.status],
    ["Enterprise Reports", String(report.enterpriseCount)],
  ];
  const certification = `This document certifies the consolidated visitor analytics derived from TANAW live-count records for the stated period. The totals combine verified local camera records from ${report.enterpriseCount} enterprise reports.`;
  const estimationNote = "Residence and sex breakdowns may be estimated from validated unique-visitor totals when a source did not submit a complete allocation.";
  const metadataBottom = measureMetadataBottom(metadataRows, 442);
  const certificationY = metadataBottom - 3;
  const certificationBottom = measureWrappedBottom(certification, certificationY, PAGE_WIDTH - MARGIN * 2, 8);
  const estimationY = certificationBottom - 2;
  const tableTop = Math.min(350, measureWrappedBottom(estimationNote, estimationY, PAGE_WIDTH - MARGIN * 2, 7) - 8);
  const pageRows = paginateTableRows(sourceRows, totalRow, tableTop);
  const pages: string[] = [];
  const pageCount = pageRows.length;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const commands: PdfCommand[] = [];
    initializePage(commands);
    const isLastPage = pageIndex === pageCount - 1;

    drawTitle(commands, "City Government of San Pedro", report.id, "Tourism & Economic Development Office");
    drawText(commands, report.title, MARGIN, 486, 14, true, "center", PAGE_WIDTH - MARGIN * 2);
    drawText(commands, `Reporting Period: ${report.period}`, MARGIN, 468, 9, false, "center", PAGE_WIDTH - MARGIN * 2);
    drawMetadata(commands, metadataRows, 442);
    drawWrappedText(commands, certification, MARGIN, certificationY, PAGE_WIDTH - MARGIN * 2, 8);
    drawWrappedText(commands, estimationNote, MARGIN, estimationY, PAGE_WIDTH - MARGIN * 2, 7);
    drawDotTable(commands, tableTop, isLastPage ? [...pageRows[pageIndex], totalRow] : pageRows[pageIndex]);
    if (isLastPage) drawSignatures(commands, report.preparedBy, report.preparedRole);
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
    { value: totals.grandMale + totals.grandFemale, bold: true },
  ];
}

function createTableRows(rows: TableCell[][], total = false): TableRow[] {
  return rows.map((cells) => {
    const lineCount = cells.reduce((maximum, cell, index) => {
      const column = DOT_COLUMNS[index];
      return Math.max(maximum, wrappedLines(formatCell(cell.value), column.width - 8, 7).length);
    }, 1);
    return { cells, height: Math.max(25, lineCount * 9 + 8), total };
  });
}

function paginateTableRows(rows: TableRow[], totalRow: TableRow, tableTop: number) {
  const tableBodyTop = tableTop - DOT_HEADER_HEIGHT;
  const regularCapacity = tableBodyTop - 32;
  const finalCapacity = tableBodyTop - 88 - totalRow.height;
  const pages: TableRow[][] = [];
  const remaining = [...rows];

  if (remaining.length === 0) return [[]];

  while (remaining.length > 0) {
    const remainingHeight = remaining.reduce((sum, row) => sum + row.height, 0);
    if (remainingHeight <= finalCapacity) {
      pages.push(remaining);
      break;
    }

    const page: TableRow[] = [];
    let used = 0;
    while (remaining.length > 1 && used + remaining[0].height <= regularCapacity) {
      const row = remaining.shift();
      if (!row) break;
      page.push(row);
      used += row.height;
      const futureHeight = remaining.reduce((sum, futureRow) => sum + futureRow.height, 0);
      if (futureHeight <= finalCapacity) break;
    }

    if (page.length === 0 && remaining.length === 1 && remaining[0].height > finalCapacity) {
      const row = remaining.shift();
      if (row) pages.push([row]);
      pages.push([]);
      break;
    }
    if (page.length === 0) {
      const row = remaining.shift();
      if (row) page.push(row);
    }
    pages.push(page);
  }

  return pages;
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
  const valueWidths = [rightX - leftX - 30, PAGE_WIDTH - MARGIN - rightX];
  let y = startY;

  for (let index = 0; index < rows.length; index += 2) {
    const pair = rows.slice(index, index + 2);
    const lineCounts = pair.map(([, value], pairIndex) => wrappedLines(value, valueWidths[pairIndex], 9).length);
    const rowHeight = 18 + Math.max(...lineCounts) * 11;

    pair.forEach(([label, value], pairIndex) => {
      const x = pairIndex === 0 ? leftX : rightX;
      drawText(commands, label.toUpperCase(), x, y, 7, true);
      drawWrappedText(commands, value, x, y - 13, valueWidths[pairIndex], 9);
    });
    y -= rowHeight;
  }

  return y;
}

function measureMetadataBottom(rows: [string, string][], startY: number) {
  const valueWidths = [430 - MARGIN - 30, PAGE_WIDTH - MARGIN - 430];
  let y = startY;
  for (let index = 0; index < rows.length; index += 2) {
    const pair = rows.slice(index, index + 2);
    const lineCounts = pair.map(([, value], pairIndex) => wrappedLines(value, valueWidths[pairIndex], 9).length);
    y -= 18 + Math.max(...lineCounts) * 11;
  }
  return y;
}

function measureWrappedBottom(text: string, y: number, maxWidth: number, size: number) {
  return y - wrappedLines(text, maxWidth, size).length * (size + 2);
}

function drawDotTable(commands: PdfCommand[], topY: number, rows: TableRow[]) {
  const tableX = MARGIN;
  const nameWidth = DOT_COLUMNS[0].width;
  const codeWidth = DOT_COLUMNS[1].width;
  const domesticWidth = sumWidths(DOT_COLUMNS.slice(2, 8));
  const foreignWidth = sumWidths(DOT_COLUMNS.slice(8, 11));
  const residenceWidth = domesticWidth + foreignWidth;
  const grandWidth = sumWidths(DOT_COLUMNS.slice(11));
  const demoX = tableX + nameWidth + codeWidth;
  const grandX = demoX + residenceWidth;

  drawHeaderCell(commands, tableX, topY, nameWidth + codeWidth, 16, "Visitor Attraction");
  drawHeaderCell(commands, demoX, topY, residenceWidth, 16, "Place of Residence");
  drawHeaderCell(commands, grandX, topY, grandWidth, 44, "Grand Total Number of Visitors");
  drawHeaderCell(commands, tableX, topY - 16, nameWidth, 46, "Name / Month", "left");
  drawHeaderCell(commands, tableX + nameWidth, topY - 16, codeWidth, 46, "Report Code");
  drawHeaderCell(commands, demoX, topY - 16, domesticWidth, 14, "Philippines");
  drawHeaderCell(commands, demoX + domesticWidth, topY - 16, foreignWidth, 28, "Foreign Country Residence");
  drawHeaderCell(commands, demoX, topY - 30, sumWidths(DOT_COLUMNS.slice(2, 5)), 14, "This Province");
  drawHeaderCell(commands, demoX + sumWidths(DOT_COLUMNS.slice(2, 5)), topY - 30, sumWidths(DOT_COLUMNS.slice(5, 8)), 14, "Other Province");

  let headerX = demoX;
  DOT_COLUMNS.slice(2).forEach((column) => {
    drawHeaderCell(commands, headerX, topY - 44, column.width, 18, column.label, column.align ?? "center");
    headerX += column.width;
  });

  let rowTop = topY - DOT_HEADER_HEIGHT;
  rows.forEach((row) => {
    const y = rowTop - row.height;
    if (row.total) drawFilledRect(commands, tableX, y, sumWidths(DOT_COLUMNS), row.height, 0.88);
    let cellX = tableX;
    row.cells.forEach((cell, cellIndex) => {
      const column = DOT_COLUMNS[cellIndex];
      drawRect(commands, cellX, y, column.width, row.height);
      const lines = wrappedLines(formatCell(cell.value), column.width - 8, 7);
      const textTop = y + row.height / 2 + (lines.length * 9) / 2 - 7;
      drawWrappedText(commands, formatCell(cell.value), cellX + 4, textTop, column.width - 8, 7, cell.bold, cell.align ?? column.align ?? "center");
      cellX += column.width;
    });
    rowTop = y;
  });

  return rowTop;
}

function drawHeaderCell(commands: PdfCommand[], x: number, topY: number, width: number, height: number, label: string, align: "left" | "right" | "center" = "center") {
  const y = topY - height;
  drawFilledRect(commands, x, y, width, height, 0.92);
  drawRect(commands, x, y, width, height);
  const lines = wrappedLines(label, width - 8, 7);
  const textTop = y + height / 2 + (lines.length * 9) / 2 - 7;
  drawWrappedText(commands, label, x + 4, textTop, width - 8, 7, true, align);
}

function drawSignatures(commands: PdfCommand[], preparedBy: string, preparedRole: string) {
  const columns = [MARGIN, PAGE_WIDTH / 2 - 95, PAGE_WIDTH - MARGIN - 190];
  const labels = ["PREPARED BY", "CHECKED BY", "APPROVED BY"];
  const names = [preparedBy, "", ""];
  const roles = [preparedRole, "Tourism Audit Officer", "Head of Department"];

  columns.forEach((x, index) => {
    drawLine(commands, x, 76, x + 190, 76, 0.6);
    drawText(commands, labels[index], x, 60, 8, true, "center", 190);
    if (names[index]) {
      drawText(commands, names[index], x, 47, 7, true, "center", 190);
      drawText(commands, roles[index], x, 36, 7, false, "center", 190);
    } else {
      drawText(commands, roles[index], x, 47, 7, false, "center", 190);
    }
  });
}

function drawText(commands: PdfCommand[], text: string, x: number, y: number, size: number, bold = false, align: "left" | "right" | "center" = "left", maxWidth = 0) {
  const palette = paletteFor(commands);
  const sanitized = sanitizePdfText(text);
  const width = Math.min(maxWidth || Number.POSITIVE_INFINITY, sanitized.length * size * 0.52);
  const textX = align === "right" ? x + maxWidth - width : align === "center" ? x + (maxWidth - width) / 2 : x;
  commands.push(`BT /F${bold ? 2 : 1} ${size} Tf ${rgbFill(palette.text)} ${textX} ${y} Td (${escapePdf(sanitized)}) Tj ET`);
}

function drawWrappedText(commands: PdfCommand[], text: string, x: number, y: number, maxWidth: number, size: number, bold = false, align: "left" | "right" | "center" = "left") {
  const lines = wrappedLines(text, maxWidth, size);
  lines.forEach((line, index) => {
    const lineWidth = Math.min(maxWidth, line.length * size * 0.52);
    const offset = align === "right" ? maxWidth - lineWidth : align === "center" ? (maxWidth - lineWidth) / 2 : 0;
    drawText(commands, line, x + offset, y - index * (size + 2), size, bold);
  });
  return y - lines.length * (size + 2);
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
  objects[FONT_ID - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[BOLD_FONT_ID - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

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
    const words = line
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((word) => (word.length <= maxChars ? [word] : Array.from({ length: Math.ceil(word.length / maxChars) }, (_, index) => word.slice(index * maxChars, (index + 1) * maxChars))));
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

function wrappedLines(text: string, maxWidth: number, size: number) {
  const approximateChars = Math.max(4, Math.floor(maxWidth / (size * 0.52)));
  return wrapText(sanitizePdfText(text), approximateChars);
}

function escapePdf(value: string) {
  return Array.from(sanitizePdfText(value), (character) => {
    if (character === "\\") return "\\\\";
    if (character === "(") return "\\(";
    if (character === ")") return "\\)";
    const code = character.charCodeAt(0);
    return code > 0x7e ? `\\${code.toString(8).padStart(3, "0")}` : character;
  }).join("");
}

function sanitizePdfText(value: string) {
  return value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFC")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

export function formatReportSubmittedDate(value: string, timeFormat: SystemTimeFormat = "12-hour") {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${formatPhilippineDateTime(date, timeFormat)} Philippine Time`;
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
