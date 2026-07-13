import type { DemoBreakdown, DemographicEvidence, Metrics } from "../../../types/enterprise";
import { formatDemographicValue, getExplicitDemographicTotals, parseDemographicCount } from "./demographics";

type DotReportPdf = {
  attractionCode?: string | null;
  attractionName?: string | null;
  reportId: string;
  period: string;
  metrics: Metrics;
  demo: DemoBreakdown;
  demographicEvidence?: DemographicEvidence | null;
  notes: string;
};

type TextOptions = {
  align?: "center" | "left";
  bold?: boolean;
  size?: number;
};

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
  const hasEvidence = Boolean(report.demographicEvidence);
  const tpm = hasEvidence ? parseDemographicCount(report.demo.thisProvMale) : null;
  const tpf = hasEvidence ? parseDemographicCount(report.demo.thisProvFemale) : null;
  const opm = hasEvidence ? parseDemographicCount(report.demo.otherProvMale) : null;
  const opf = hasEvidence ? parseDemographicCount(report.demo.otherProvFemale) : null;
  const fm = hasEvidence ? parseDemographicCount(report.demo.foreignMale) : null;
  const ff = hasEvidence ? parseDemographicCount(report.demo.foreignFemale) : null;
  const totals = hasEvidence ? getExplicitDemographicTotals(report.demo) : null;
  const content: string[] = [];

  drawText(content, "TANAW - DOT Visitor Attraction Report", 50, 550, { bold: true, size: 12 });
  drawText(content, `Report ID: ${report.reportId}`, 50, 528, { size: 10 });
  drawText(content, `Reporting Period: ${report.period}`, 50, 512, { size: 10 });
  drawText(content, `Camera-derived venue-local unique estimate: ${report.metrics.unique.toLocaleString()}`, 50, 496, { size: 10 });
  drawText(content, "VISITOR ATTRACTION", 50, 462, { bold: true, size: 15 });

  const table = {
    x: 50,
    top: 430,
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
  drawCell(content, table.x, top, table.code, 40, [providedText(report.attractionCode)], { bold: true, size: 7 });
  drawCell(content, table.x + table.code, top, table.name, 40, [providedText(report.attractionName), report.period], { align: "left", bold: true, size: 8 });
  [tpm, tpf, explicitSum(tpm, tpf), opm, opf, explicitSum(opm, opf), fm, ff, explicitSum(fm, ff)].forEach((value, index) => {
    drawCell(content, demoX + table.demo * index, top, table.demo, 40, [formatDemographicValue(value)], {
      bold: value !== null,
      size: value === null ? 5.5 : 8,
    });
  });
  const grandTotal = totals?.grandTotal ?? null;
  drawCell(content, grandX, top, table.grand, 40, [formatDemographicValue(grandTotal)], {
    bold: grandTotal !== null,
    size: grandTotal === null ? 6 : 10,
  });

  top -= 40;
  for (let row = 0; row < 5; row += 1) {
    drawCell(content, table.x, top, table.code, 28, [""]);
    drawCell(content, table.x + table.code, top, table.name, 28, [""]);
    for (let column = 0; column < 9; column += 1) {
      drawCell(content, demoX + table.demo * column, top, table.demo, 28, [""]);
    }
    drawCell(content, grandX, top, table.grand, 28, [""]);
    top -= 28;
  }

  if (report.notes.trim()) {
    drawText(content, "Supplementary Notes", 50, 106, { bold: true, size: 10 });
    wrapText(report.notes.trim(), 112)
      .slice(0, 4)
      .forEach((line, index) => {
        drawText(content, line, 50, 90 - index * 13, { size: 9 });
      });
  }

  return buildPdf(content.join("\n"));
}

function drawCell(content: string[], x: number, top: number, width: number, height: number, lines: string[], options: TextOptions = {}) {
  const y = top - height;
  content.push(`0.72 0.72 0.72 RG ${formatNumber(x)} ${formatNumber(y)} ${formatNumber(width)} ${formatNumber(height)} re S`);
  const size = options.size ?? 8;
  const lineHeight = size + 3;
  const totalTextHeight = lines.length * lineHeight;
  const startY = y + height / 2 + totalTextHeight / 2 - size;

  lines.forEach((line, index) => {
    const textY = startY - index * lineHeight;
    const textX = options.align === "left" ? x + 8 : x + width / 2;
    drawText(content, line, textX, textY, {
      align: options.align ?? "center",
      bold: options.bold,
      size,
    });
  });
}

function drawText(content: string[], value: string, x: number, y: number, options: TextOptions = {}) {
  const size = options.size ?? 10;
  const escaped = escapePdf(value);
  const font = options.bold ? "F2" : "F1";
  const alignTransform = options.align === "center" ? `(${escaped}) stringwidth pop 2 div neg 0 rmoveto ` : "";
  content.push(`BT /${font} ${size} Tf ${formatNumber(x)} ${formatNumber(y)} Td ${alignTransform}(${escaped}) Tj ET`);
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

function explicitSum(first: number | null, second: number | null) {
  return first === null || second === null ? null : first + second;
}

function providedText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || "Not provided";
}
