import type { DailyOrigins, DemoBreakdown, Metrics } from "../../../types/enterprise";
import { countingNotes } from "./counting";
import { VAR1_COLUMN_WEIGHTS, VAR1_NOTE, VAR1_SEX_COLUMNS, var1DailyCells, var1DataNotes, var1Days, var1MonthlyCells, type Var1Day } from "../model/var1";

export type DotReportPdf = {
  enterpriseName: string;
  reportId: string;
  period: string;
  metrics: Metrics;
  demo: DemoBreakdown;
  /** Daily visitor origins; absent on reports made before daily entry. */
  origins?: DailyOrigins;
  notes: string;
  attractionType?: string;
};
type TextOptions = { align?: "center" | "left" | "right"; bold?: boolean; maxWidth?: number; size?: number; horizontalScale?: number };
type Color = readonly [number, number, number];
const BLACK: Color = [0, 0, 0];
const YELLOW: Color = [1, 1, 0];
const GREEN: Color = [146 / 255, 208 / 255, 80 / 255];
const TABLE_X = 25;
const TABLE_WIDTH = 806;
const ROW_HEIGHT = 17.25;
const weight = VAR1_COLUMN_WEIGHTS.reduce((total, value) => total + value, 0);
const widths = VAR1_COLUMN_WEIGHTS.map((value) => (TABLE_WIDTH * value) / weight);
const positions = widths.map((_, index) => TABLE_X + widths.slice(0, index).reduce((total, value) => total + value, 0));
const span = (start: number, length: number) => widths.slice(start, start + length).reduce((total, value) => total + value, 0);

export function downloadDotReportPdf(report: DotReportPdf) {
  const url = URL.createObjectURL(new Blob([createDotReportPdf(report)], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${report.reportId.replace(/[^a-zA-Z0-9._-]/g, "_")}-DOT-Visitor-Attraction.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Vector reconstruction of the supplied VAR 1 B1:R46 form, without its blank overflow pages. */
export function createDotReportPdf(report: DotReportPdf) {
  const days = var1Days(report.period, report.metrics, report.origins);
  const detailed = report.origins !== undefined;
  const first = whitePage();
  drawText(first, "Tourism Attraction Visitor Record", 28, 513, { bold: true, size: 10.725 });
  drawText(first, "(VAR 1)", 769, 513, { size: 10 });
  drawText(first, "( This recording form can be used instead of just counting the visitors )", 28, 498, { size: 9 });
  [
    ["Month/Year:", report.period],
    ["Name of City/Municipality:", "City of San Pedro, Laguna"],
    ["Name of attraction/ Spot:", report.enterpriseName],
  ].forEach(([label, value], index) => {
    const y = 476 - index * 15.75;
    drawText(first, label, 28, y, { align: "right", maxWidth: 172, size: 9 });
    drawText(first, value, 248, y, { maxWidth: 520, size: 9 });
    first.push(`0 0 0 RG 0.8 w 247 ${number(y - 3)} m 768 ${number(y - 3)} l S`);
  });
  drawText(first, "Type of Tourism Attraction:", 50, 414, { size: 9 });
  drawCell(first, 174, 426, 200, 17, [report.attractionType ?? ""], { align: "left", size: 9 });
  const bodyTop = drawHeader(first, 402);
  drawDays(first, days.slice(0, 14), bodyTop, detailed);
  const pages = [first];
  const continuation = whitePage();
  const totalTop = drawDays(continuation, days.slice(14), 524, detailed);
  drawCell(continuation, TABLE_X, totalTop, span(0, 2), 33.75, ["Total of this", "Month ****"], { bold: true, size: 9.75 }, GREEN);
  var1MonthlyCells(report.demo, report.metrics).forEach((value, index) =>
    drawCell(continuation, positions[index + 2], totalTop, widths[index + 2], 33.75, [cell(value)], { bold: true, size: 9.75 }, GREEN),
  );
  drawText(continuation, VAR1_NOTE, 28, totalTop - 47, { size: 7, maxWidth: 800 });
  var1DataNotes(report.demo, report.origins).forEach((note, index) => drawText(continuation, note, 28, totalTop - 59 - index * 12, { size: 7, maxWidth: 800 }));
  pages.push(continuation);

  // Supporting information is kept outside the official VAR 1 grid.
  const noteLines = [
    `Report ID: ${report.reportId}`,
    `Attraction: ${report.enterpriseName}`,
    `Reporting period: ${report.period}`,
    `Unique visitors: ${report.metrics.unique.toLocaleString("en-US")}`,
    countingNotes(report.metrics),
    report.notes.trim() ? `Operator notes: ${report.notes}` : "",
  ]
    .filter(Boolean)
    .flatMap((paragraph) => paragraph.split("\n").flatMap((line) => wrapText(line, 145)));
  if (report.notes.trim() || countingNotes(report.metrics)) {
    for (let offset = 0; offset < noteLines.length; offset += 38) {
      const page = whitePage();
      drawText(page, "VAR 1 - Supporting report details", 50, 550, { bold: true, size: 13 });
      noteLines.slice(offset, offset + 38).forEach((line, index) => drawText(page, line, 50, 522 - index * 12, { size: 8, maxWidth: 742 }));
      pages.push(page);
    }
  }
  pages.forEach((page, index) => {
    drawText(page, report.reportId, 25, 18, { size: 7 });
    drawText(page, `Page ${index + 1} of ${pages.length}`, 722, 18, { align: "right", maxWidth: 100, size: 7 });
  });
  return buildPdf(pages.map((page) => page.join("\n")));
}

function drawHeader(content: string[], top: number) {
  const heights = [16.5, 15, 28.5, 17.25];
  // Match the reference's 9.75pt condensed headings with standard PDF fonts.
  const options = { bold: true, size: 9.75, horizontalScale: 0.85 } as const;
  drawCell(content, positions[0], top, span(0, 2), heights[0], ["Date"], options, YELLOW);
  drawCell(content, positions[2], top, span(2, 12), heights[0], ["*** Place of Residence"], options, YELLOW);
  drawCell(content, positions[14], top, span(14, 3), heights[0] + heights[1] + heights[2], ["* Grand Total", "Number of", "Visitors"], options, YELLOW);
  const second = top - heights[0];
  drawCell(content, positions[0], second, widths[0], heights[1] + heights[2] + heights[3], ["Day"], options, YELLOW);
  drawCell(content, positions[1], second, widths[1], heights[1] + heights[2] + heights[3], ["Week Day", "(Mon-Sun)"], { bold: true, size: 6.5 }, YELLOW);
  drawCell(content, positions[2], second, span(2, 9), heights[1], ["Philippines"], options, YELLOW);
  drawCell(content, positions[11], second, span(11, 3), heights[1] + heights[2], ["Foreign Country Residence"], options, YELLOW);
  ["This City/Municipality", "This Province", "Other Province"].forEach((label, index) =>
    drawCell(content, positions[2 + index * 3], second - heights[1], span(2 + index * 3, 3), heights[2], [label], options, YELLOW),
  );
  const last = second - heights[1] - heights[2];
  for (let index = 2; index < 17; index += 1) drawCell(content, positions[index], last, widths[index], heights[3], [VAR1_SEX_COLUMNS[(index - 2) % 3]], options, YELLOW);
  return last - heights[3];
}

function drawDays(content: string[], days: Var1Day[], top: number, detailed: boolean) {
  days.forEach((day, row) => {
    const values = [String(day.day), day.weekday, ...var1DailyCells(day, detailed).map(cell)];
    values.forEach((value, column) => drawCell(content, positions[column], top - row * ROW_HEIGHT, widths[column], ROW_HEIGHT, [value], { size: 10.725 }));
  });
  return top - days.length * ROW_HEIGHT;
}
function cell(value: number | null) {
  return value === null ? "" : value.toLocaleString("en-US");
}
function whitePage() {
  return ["1 1 1 rg 0 0 842 595 re f"];
}
function number(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function drawCell(content: string[], x: number, top: number, width: number, height: number, lines: string[], options: TextOptions = {}, fill?: Color) {
  const y = top - height;
  if (fill) content.push(`${fill.join(" ")} rg ${number(x)} ${number(y)} ${number(width)} ${number(height)} re f`);
  content.push(`${BLACK.join(" ")} RG 0.6 w ${number(x)} ${number(y)} ${number(width)} ${number(height)} re S`);
  const size = options.size ?? 8;
  const lineHeight = size + 3;
  const startY = y + height / 2 + (lines.length * lineHeight) / 2 - size;
  lines.forEach((line, index) =>
    drawText(content, line, x + (options.align === "left" ? 5 : 0), startY - index * lineHeight, {
      ...options,
      size,
      align: options.align ?? "center",
      maxWidth: width - (options.align === "left" ? 10 : 0),
    }),
  );
}
function drawText(content: string[], value: string, x: number, y: number, options: TextOptions = {}) {
  const text = sanitize(value);
  let size = options.size ?? 10;
  const scale = options.horizontalScale ?? 1;
  const maxWidth = options.maxWidth ?? 0;
  if (maxWidth > 0 && text.length * size * 0.52 * scale > maxWidth) size = Math.max(4, maxWidth / (text.length * 0.52 * scale));
  const width = text.length * size * 0.52 * scale;
  const textX = options.align === "center" ? x + (maxWidth - width) / 2 : options.align === "right" ? x + maxWidth - width : x;
  const escaped = Array.from(text, (character) => {
    if (character === "\\" || character === "(" || character === ")") return `\\${character}`;
    return character.charCodeAt(0) > 0x7e ? `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}` : character;
  }).join("");
  content.push(`BT /${options.bold ? "F2" : "F1"} ${number(size)} Tf ${number(scale * 100)} Tz 0 0 0 rg ${number(textX)} ${number(y)} Td (${escaped}) Tj ET`);
}
function sanitize(value: string) {
  return value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFC")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}
function wrapText(value: string, maxLength: number) {
  const words = value
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => (word.length <= maxLength ? [word] : Array.from({ length: Math.ceil(word.length / maxLength) }, (_, index) => word.slice(index * maxLength, (index + 1) * maxLength))));
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + word.length + 1 > maxLength) {
      lines.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines;
}
function buildPdf(pages: string[]) {
  const objects: string[] = [];
  const pageIds: number[] = [];
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    objects[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  return pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}
