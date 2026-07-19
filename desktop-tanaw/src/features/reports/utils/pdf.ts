import type { DemoBreakdown, Metrics } from "../../../types/enterprise";
import { demographicCount, getDemographicTotals } from "./demographics";

export type DotReportPdf = {
  enterpriseName: string;
  reportId: string;
  period: string;
  metrics: Metrics;
  demo: DemoBreakdown;
  notes: string;
};

type TextOptions = {
  align?: "center" | "left";
  bold?: boolean;
  maxWidth?: number;
  size?: number;
};

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
  text: [0.05, 0.08, 0.13],
  muted: [0.31, 0.37, 0.46],
  border: [0.4, 0.45, 0.52],
  header: [0.94, 0.96, 0.98],
  total: [0.86, 0.89, 0.93],
  accent: [0.72, 0.54, 0.1],
};

const contentPalettes = new WeakMap<string[], PdfPalette>();

export function downloadDotReportPdf(report: DotReportPdf) {
  const pdf = createDotReportPdf(report);
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(report.reportId)}-DOT-Visitor-Attraction.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function createDotReportPdf(report: DotReportPdf) {
  const tpm = demographicCount(report.demo.thisProvMale);
  const tpf = demographicCount(report.demo.thisProvFemale);
  const opm = demographicCount(report.demo.otherProvMale);
  const opf = demographicCount(report.demo.otherProvFemale);
  const fm = demographicCount(report.demo.foreignMale);
  const ff = demographicCount(report.demo.foreignFemale);
  const totals = getDemographicTotals(report.demo);
  const content: string[] = [];
  contentPalettes.set(content, lightExportPalette);
  content.push(`${rgbFill(lightExportPalette.background)} 0 0 842 595 re f`);

  drawText(content, "TANAW - DOT Visitor Attraction Report", 50, 564, { align: "center", bold: true, maxWidth: 742, size: 15 });
  drawText(content, "Tourism Attraction Visitor Record - VAR 2", 50, 550, { align: "center", maxWidth: 742, size: 8 });
  drawText(content, report.reportId, 50, 536, { align: "center", maxWidth: 742, size: 9 });
  content.push(`${rgbStroke(lightExportPalette.accent)} 1 w 50 524 m 792 524 l S`);
  drawText(content, "REPORTING PERIOD", 50, 506, { bold: true, size: 7 });
  drawText(content, report.period, 50, 492, { size: 9 });
  drawText(content, "MUNICIPALITY", 315, 506, { bold: true, size: 7 });
  drawText(content, "City of San Pedro, Laguna", 315, 492, { size: 9 });
  drawText(content, "UNIQUE VISITORS", 630, 506, { bold: true, size: 7 });
  drawText(content, report.metrics.unique.toLocaleString(), 630, 492, { size: 9 });

  const table = {
    x: 74,
    top: 448,
    name: 154,
    code: 72,
    demo: 42,
    grand: 30,
  };
  const demoX = table.x + table.name + table.code;
  const grandX = demoX + table.demo * 9;
  let top = table.top;

  drawCell(content, table.x, top, table.name + table.code, 36, ["Visitor Attraction"], { bold: true });
  drawCell(content, demoX, top, table.demo * 9, 36, ["Place of Residence"], { bold: true });
  drawCell(content, grandX, top, table.grand * 3, 84, ["Grand Total", "Number of Visitors"], { bold: true });

  top -= 36;
  drawCell(content, table.x, top, table.name, 76, ["Name / Month"], { bold: true });
  drawCell(content, table.x + table.name, top, table.code, 76, ["Report", "Code"], { bold: true });
  drawCell(content, demoX, top, table.demo * 6, 24, ["Philippines"], { bold: true });
  drawCell(content, demoX + table.demo * 6, top, table.demo * 3, 48, ["Foreign Country", "Residence"], { bold: true, size: 7 });

  top -= 24;
  drawCell(content, demoX, top, table.demo * 3, 24, ["This Province"], { bold: true, size: 7 });
  drawCell(content, demoX + table.demo * 3, top, table.demo * 3, 24, ["Other Province"], { bold: true, size: 7 });

  top -= 24;
  ["Male", "Female", "Total", "Male", "Female", "Total", "Male", "Female", "Total"].forEach((label, index) => {
    drawCell(content, demoX + table.demo * index, top, table.demo, 28, [label], { bold: true, size: 7 });
  });
  ["Male", "Female", "Total"].forEach((label, index) => {
    drawCell(content, grandX + table.grand * index, top, table.grand, 28, [label], { bold: true, size: 7 });
  });

  top -= 28;
  const enterpriseLines = [...wrapText(report.enterpriseName, 34), report.period];
  const rowHeight = Math.max(40, enterpriseLines.length * 11 + 12);
  drawCell(content, table.x, top, table.name, rowHeight, enterpriseLines, { align: "left", bold: true, size: 8 });
  drawCell(content, table.x + table.name, top, table.code, rowHeight, wrapText(report.reportId, 14), { bold: true, size: 8 });
  [tpm, tpf, tpm + tpf, opm, opf, opm + opf, fm, ff, fm + ff].forEach((value, index) => {
    drawCell(content, demoX + table.demo * index, top, table.demo, rowHeight, [value ? value.toLocaleString("en-US") : ""], { bold: value > 0, size: 8 });
  });
  [totals.male, totals.female, totals.grandTotal].forEach((value, index) => {
    drawCell(content, grandX + table.grand * index, top, table.grand, rowHeight, [value ? value.toLocaleString("en-US") : ""], { bold: true, size: 8 });
  });

  top -= rowHeight;
  const noteLines = wrapText(sanitizePdfText(report.notes.trim() || "None recorded."), 112);
  const notePages: string[][] = [];
  const firstPageNoteCapacity = Math.max(0, Math.floor((top - 88) / 12) + 1);
  const firstPageNotes = noteLines.slice(0, firstPageNoteCapacity);
  drawText(content, "Supplementary Notes", 50, top - 22, { bold: true, size: 10 });
  firstPageNotes.forEach((line, index) => {
    drawText(content, line, 50, top - 38 - index * 12, { size: 8 });
  });
  drawText(content, "Demographic splits and unique visitors are estimates derived from TANAW local camera records.", 50, 28, { size: 7 });

  for (let offset = firstPageNotes.length; offset < noteLines.length; offset += 40) {
    const continuation: string[] = [];
    contentPalettes.set(continuation, lightExportPalette);
    continuation.push(`${rgbFill(lightExportPalette.background)} 0 0 842 595 re f`);
    drawText(continuation, "TANAW - DOT Visitor Attraction Report", 50, 564, { align: "center", bold: true, maxWidth: 742, size: 15 });
    drawText(continuation, `${report.reportId} - Supplementary Notes`, 50, 542, { align: "center", maxWidth: 742, size: 9 });
    continuation.push(`${rgbStroke(lightExportPalette.accent)} 1 w 50 530 m 792 530 l S`);
    noteLines.slice(offset, offset + 40).forEach((line, index) => {
      drawText(continuation, line, 50, 506 - index * 12, { size: 8 });
    });
    notePages.push(continuation);
  }

  const pages = [content, ...notePages];
  pages.forEach((page, index) => {
    drawText(page, `Page ${index + 1} of ${pages.length}`, 722, 16, { align: "center", maxWidth: 70, size: 7 });
  });
  return buildPdf(pages.map((page) => page.join("\n")));
}

function drawCell(content: string[], x: number, top: number, width: number, height: number, lines: string[], options: TextOptions = {}) {
  const y = top - height;
  const palette = paletteFor(content);
  content.push(`${rgbStroke(palette.border)} ${formatNumber(x)} ${formatNumber(y)} ${formatNumber(width)} ${formatNumber(height)} re S`);
  const size = options.size ?? 8;
  const lineHeight = size + 3;
  const totalTextHeight = lines.length * lineHeight;
  const startY = y + height / 2 + totalTextHeight / 2 - size;

  lines.forEach((line, index) => {
    const textY = startY - index * lineHeight;
    const textX = options.align === "left" ? x + 8 : x;
    drawText(content, line, textX, textY, {
      align: options.align ?? "center",
      bold: options.bold,
      maxWidth: options.align === "left" ? width - 16 : width,
      size,
    });
  });
}

function drawText(content: string[], value: string, x: number, y: number, options: TextOptions = {}) {
  const size = options.size ?? 10;
  const sanitized = sanitizePdfText(value);
  const escaped = escapePdf(sanitized);
  const font = options.bold ? "F2" : "F1";
  const maxWidth = options.maxWidth ?? 0;
  const estimatedWidth = Math.min(maxWidth || Number.POSITIVE_INFINITY, sanitized.length * size * 0.52);
  const textX = options.align === "center" ? x + (maxWidth - estimatedWidth) / 2 : x;
  content.push(`BT /${font} ${size} Tf ${rgbFill(paletteFor(content).text)} ${formatNumber(textX)} ${formatNumber(y)} Td (${escaped}) Tj ET`);
}

function paletteFor(content: string[]) {
  return contentPalettes.get(content) ?? lightExportPalette;
}

function rgbFill([red, green, blue]: [number, number, number]) {
  return `${red} ${green} ${blue} rg`;
}

function rgbStroke([red, green, blue]: [number, number, number]) {
  return `${red} ${green} ${blue} RG`;
}

function buildPdf(pages: string[]) {
  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  pages.forEach((content, index) => {
    const pageObjectId = 5 + index * 2;
    const contentObjectId = pageObjectId + 1;
    pageObjectIds.push(pageObjectId);
    objects[pageObjectId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

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

function wrapText(value: string, maxLength: number) {
  const words = value
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => (word.length <= maxLength ? [word] : Array.from({ length: Math.ceil(word.length / maxLength) }, (_, index) => word.slice(index * maxLength, (index + 1) * maxLength))));
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
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

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
