import type { DemoBreakdown, Metrics } from "../../../types/enterprise";

type DotReportPdf = {
  reportId: string;
  period: string;
  metrics: Metrics;
  demo: DemoBreakdown;
  notes: string;
};

export function downloadDotReportPdf(report: DotReportPdf) {
  const lines = [
    "TANAW - DOT Visitor Attraction Report",
    `Report ID: ${report.reportId}`,
    `Reporting Period: ${report.period}`,
    "",
    `Total Entries: ${report.metrics.entries}`,
    `Total Exits: ${report.metrics.exits}`,
    `Peak Occupancy: ${report.metrics.peak}`,
    `Estimated Unique Visitors: ${report.metrics.unique}`,
    "",
    "Demographics",
    `This Province - Male: ${report.demo.thisProvMale}, Female: ${report.demo.thisProvFemale}`,
    `Other Province - Male: ${report.demo.otherProvMale}, Female: ${report.demo.otherProvFemale}`,
    `Foreign - Male: ${report.demo.foreignMale}, Female: ${report.demo.foreignFemale}`,
    "",
    `Supplementary Notes: ${report.notes || "None"}`,
  ];
  const content = lines.map((line, index) => `BT /F1 11 Tf 50 ${760 - index * 24} Td (${escapePdf(line)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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

  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(report.reportId)}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
