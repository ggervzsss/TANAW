import type { FinalReportStatus, ReportStatus } from "@/shared/types";
import { Badge, type BadgeTone } from "../../../design-system";

function toneFor(status: ReportStatus | FinalReportStatus): BadgeTone {
  if (status === "Pending Review") return "warning";
  if (status === "Ready to Consolidate" || status === "Finalized") return "teal";
  if (status === "Returned" || status === "Returned for Revision" || status === "Missing") return "danger";
  if (status === "Consolidated" || status === "Draft") return "info";
  return "neutral";
}

export function ReportStatusBadge({ status }: { status: ReportStatus | FinalReportStatus }) {
  return <Badge tone={toneFor(status)}>{status}</Badge>;
}
