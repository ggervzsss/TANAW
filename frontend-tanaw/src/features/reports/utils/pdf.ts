import type { EnterpriseReportDetail } from "@/shared/types";
import { formatDecimal } from "./decimal";
import { readableToken } from "./reportWorkflow";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 42;
const FONT_ID = 3;
const LINES_PER_PAGE = 42;

export function downloadEnterpriseReportPdf(report: EnterpriseReportDetail) {
  downloadPdf(buildEnterpriseReportPdf(report), `${report.enterpriseReportId}-revision-${report.currentRevision.revisionNumber}.pdf`);
}

export function buildEnterpriseReportPdf(report: EnterpriseReportDetail) {
  const revision = report.revisions.find((item) => item.reportRevisionId === report.currentRevisionId) ?? report.revisions.find((item) => item.isCurrent);
  const revisionEvents = report.reviewEvents.filter((event) => event.reportRevisionId === report.currentRevisionId);
  const lines = [
    `Enterprise: ${report.enterprise.enterpriseName} (${report.enterprise.enterpriseCode})`,
    `Site: ${report.site.siteName} (${report.site.siteCode})`,
    `Frozen barangay: ${report.site.frozenBarangay ?? "Not recorded"}`,
    `Reporting period: ${report.reportingPeriod.label} [${report.reportingPeriod.naturalKey}]`,
    `Workflow: ${report.workflowState}; logical version ${report.logicalVersion}`,
    `Current revision ID: ${report.currentRevisionId}`,
    `Payload hash: ${report.currentRevision.payloadHash}`,
    `Evidence: ${report.currentRevision.evidenceStatus}; coverage ${report.currentRevision.coverage.evidenceStatus}`,
    "",
    "RECORDED METRIC FACTS",
    ...report.currentRevision.metrics.map(
      (metric) =>
        `${readableToken(metric.definition)} v${metric.definitionVersion}: ${formatDecimal(metric.value)} ${metric.unit}; ${readableToken(metric.provenance)}; ${readableToken(metric.quality)}; coverage ${metric.coverage.evidenceStatus}`,
    ),
    ...(report.currentRevision.metrics.length === 0 ? ["No metric facts recorded."] : []),
    "",
    "RECORDED DEMOGRAPHIC FACTS",
    ...(revision?.demographics.map(
      (fact) => `${readableToken(fact.dimension)} / ${fact.value}: count ${fact.count}; percentage ${fact.percentage === null ? "Not recorded" : `${formatDecimal(fact.percentage)}%`}; ${readableToken(fact.provenance)}; ${readableToken(fact.quality)}`,
    ) ?? ["Authoritative current revision unavailable."]),
    ...(revision && revision.demographics.length === 0 ? ["No demographic facts recorded; no values were estimated."] : []),
    "",
    "RECORDED COVERAGE GAPS",
    ...(report.currentRevision.coverage.evidenceStatus === "not_recorded"
      ? ["Coverage evidence not recorded."]
      : report.currentRevision.coverage.gaps.length
        ? report.currentRevision.coverage.gaps.map((gap) => `${readableToken(gap.reason)}: ${gap.durationSeconds} seconds`)
        : ["No gaps in the recorded coverage evidence."]),
    "",
    "IMMUTABLE REVIEW EVENTS",
    ...revisionEvents.map((event) => `${event.occurredAt}: ${readableToken(event.eventType)}; ${event.actor.displayName ?? "Actor not recorded"}; ${event.actor.role ?? "Role not recorded"}; ${event.expectedVersion}->${event.resultingVersion}; ${event.reason ?? "No reason recorded"}`),
  ];
  return buildTextPdf("TANAW Official Enterprise Report Evidence", report.enterpriseReportId, lines);
}

function buildTextPdf(title: string, subtitle: string, rawLines: string[]) {
  const wrapped = rawLines.flatMap((line) => wrapText(line, 92));
  const pageCount = Math.max(1, Math.ceil(wrapped.length / LINES_PER_PAGE));
  const pages: string[] = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const commands: string[] = [];
    drawText(commands, title, MARGIN, PAGE_HEIGHT - 46, 15, true);
    drawText(commands, subtitle, MARGIN, PAGE_HEIGHT - 66, 8);
    drawLine(commands, MARGIN, PAGE_HEIGHT - 78, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 78, 1);
    wrapped.slice(pageIndex * LINES_PER_PAGE, (pageIndex + 1) * LINES_PER_PAGE).forEach((line, index) => {
      drawText(commands, line || " ", MARGIN, PAGE_HEIGHT - 101 - index * 16, 8, /^[A-Z][A-Z ]+$/.test(line));
    });
    drawText(commands, `Page ${pageIndex + 1} of ${pageCount}`, PAGE_WIDTH - MARGIN - 70, 24, 7);
    pages.push(commands.join("\n"));
  }
  return buildPdf(pages);
}

function drawText(commands: string[], text: string, x: number, y: number, size: number, bold = false) {
  commands.push(`BT /F1 ${size} Tf ${bold ? "0.08 g" : "0 g"} ${x} ${y} Td (${escapePdf(text)}) Tj ET`);
}

function drawLine(commands: string[], x1: number, y1: number, x2: number, y2: number, width: number) {
  commands.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
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
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[FONT_ID - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((content, index) => {
    const pageObjectId = 4 + index * 2;
    const contentObjectId = pageObjectId + 1;
    pageObjectIds.push(pageObjectId);
    objects[pageObjectId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${FONT_ID} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
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
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function wrapText(text: string, maxChars: number) {
  if (!text) return [""];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) lines.push(current);
      for (let index = 0; index < word.length; index += maxChars) lines.push(word.slice(index, index + maxChars));
      current = "";
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function escapePdf(value: string) {
  return value.replace(/[^\x20-\x7E]/g, " ").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
