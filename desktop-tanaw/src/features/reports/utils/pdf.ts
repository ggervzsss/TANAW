import type { DemoBreakdown, Metrics } from "../../../types/enterprise";
import { demographicCount, getDemographicTotals } from "./demographics";

export type DotReportPdf = {
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
  content.push(`${rgbFill(lightExportPalette.background)} 0 0 792 612 re f`);

  drawText(content, "TANAW - DOT Visitor Attraction Report", 50, 564, { align: "center", bold: true, maxWidth: 694, size: 15 });
  drawText(content, report.reportId, 50, 544, { align: "center", maxWidth: 694, size: 9 });
  content.push(`${rgbStroke(lightExportPalette.accent)} 1 w 50 532 m 744 532 l S`);
  drawText(content, "REPORTING PERIOD", 50, 512, { bold: true, size: 7 });
  drawText(content, report.period, 50, 498, { size: 9 });
  drawText(content, "UNIQUE COUNT CAP", 420, 512, { bold: true, size: 7 });
  drawText(content, report.metrics.unique.toLocaleString(), 420, 498, { size: 9 });
  drawText(content, "VISITOR ATTRACTION", 50, 466, { bold: true, size: 13 });

  const table = {
    x: 50,
    top: 448,
    code: 72,
    name: 154,
    demo: 42,
    grand: 90,
  };
  const demoX = table.x + table.code + table.name;
  const grandX = demoX + table.demo * 9;
  let top = table.top;

  drawCell(content, table.x, top, table.code, 112, ["Attraction", "Code"], { bold: true });
  drawCell(content, table.x + table.code, top, table.name, 112, ["Name/ Month"], { bold: true });
  drawCell(content, grandX, top, table.grand, 112, ["Grand Total", "Number of", "Visitors"], { bold: true });
  drawCell(content, demoX, top, table.demo * 9, 36, ["***Place of Residence"], { bold: true });

  top -= 36;
  drawCell(content, demoX, top, table.demo * 6, 24, ["Philippines"], { bold: true });
  drawCell(content, demoX + table.demo * 6, top, table.demo * 3, 24, ["Foreign Country Residence"], { bold: true, size: 7 });

  top -= 24;
  drawCell(content, demoX, top, table.demo * 3, 24, ["This Province"], { bold: true, size: 7 });
  drawCell(content, demoX + table.demo * 3, top, table.demo * 3, 24, ["Other Province"], { bold: true, size: 7 });
  drawCell(content, demoX + table.demo * 6, top, table.demo * 3, 24, [""], { bold: true, size: 7 });

  top -= 24;
  ["Male", "Female", "Total", "Male", "Female", "Total", "Male", "Female", "Total"].forEach((label, index) => {
    drawCell(content, demoX + table.demo * index, top, table.demo, 28, [label], { bold: true, size: 7 });
  });

  top -= 28;
  drawCell(content, table.x, top, table.code, 40, ["SPL-MKT-01"], { bold: true, size: 8 });
  drawCell(content, table.x + table.code, top, table.name, 40, ["Enterprise Node", report.period], { align: "left", bold: true, size: 8 });
  [tpm, tpf, tpm + tpf, opm, opf, opm + opf, fm, ff, fm + ff].forEach((value, index) => {
    drawCell(content, demoX + table.demo * index, top, table.demo, 40, [value ? String(value) : ""], { bold: value > 0, size: 8 });
  });
  drawCell(content, grandX, top, table.grand, 40, [totals.grandTotal ? String(totals.grandTotal) : ""], { bold: true, size: 10 });

  top -= 40;
  for (let row = 0; row < 6; row += 1) {
    drawCell(content, table.x, top, table.code, 28, [""]);
    drawCell(content, table.x + table.code, top, table.name, 28, [""]);
    for (let column = 0; column < 9; column += 1) {
      drawCell(content, demoX + table.demo * column, top, table.demo, 28, [""]);
    }
    drawCell(content, grandX, top, table.grand, 28, [""]);
    top -= 28;
  }

  if (report.notes.trim()) {
    drawText(content, "Supplementary Notes", 50, 92, { bold: true, size: 10 });
    wrapText(report.notes.trim(), 112)
      .slice(0, 4)
      .forEach((line, index) => {
        drawText(content, line, 50, 76 - index * 12, { size: 8 });
      });
  }

  return buildPdf(content.join("\n"));
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
  const escaped = escapePdf(value);
  const font = options.bold ? "F2" : "F1";
  const maxWidth = options.maxWidth ?? 0;
  const estimatedWidth = Math.min(maxWidth || Number.POSITIVE_INFINITY, value.length * size * 0.52);
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

function buildPdf(content: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
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
  const words = value.split(/\s+/);
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
  return value
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
