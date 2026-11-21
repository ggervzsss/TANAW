import { DetailField, ExpandableTableText, ModalFrame } from "@/shared/components/ui";
import type { AlertSeverity, PriorityAlert, PriorityAlertResolutionMode, TechnicalIssueUrgency } from "@/shared/types";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { Badge, type BadgeTone } from "../../../shared/ui-kit";

export function AlertDetailsModal({ alert, onClose }: { alert: PriorityAlert; onClose: () => void }) {
  const { timeFormat } = useSystemDisplayPreferences();
  const expandableValue = (value: string, label: string) => <ExpandableTableText primary={value} ariaLabel={label} twoLines className="leading-relaxed font-semibold" />;

  return (
    <ModalFrame title="Technical Issue Details" eyebrow={alert.id} onClose={onClose}>
      <div className="grid gap-4 md:grid-cols-2">
        <DetailField label="Problem" value={alert.type} />
        <DetailField label="Urgency" value={<UrgencyBadge urgency={alert.urgency} />} />
        <DetailField label="Date and Time" value={<time dateTime={alert.time}>{formatPhilippineDateTime(alert.time, timeFormat)}</time>} />
        <DetailField label="Status" value={<AlertStatusBadge status={alert.status} />} />
        <DetailField label="Reported By" value={alert.requester} />
        <DetailField label="How It Can Be Fixed" value={<ResolutionBadge mode={alert.resolutionMode} />} />
        <DetailField label="Affected Enterprise" value={expandableValue(alert.enterprise ?? "Not specified", "enterprise")} />
        <DetailField label="What Happened" value={expandableValue(alert.summary, "summary")} />
        <div className="md:col-span-2">
          <DetailField label="What to Do" value={expandableValue(alert.requiredAction, "required action")} />
        </div>
      </div>
    </ModalFrame>
  );
}

const urgencyTones: Record<TechnicalIssueUrgency, BadgeTone> = { Normal: "info", Important: "warning", Urgent: "danger" };
const severityTones: Record<AlertSeverity, BadgeTone> = { Info: "info", Warning: "warning", Critical: "danger" };
const resolutionTones: Record<PriorityAlertResolutionMode, BadgeTone> = {
  "On-site Visit Required": "danger",
  "In-system Action": "success",
  "Staff Follow-up": "warning",
  "Remote Review": "info",
  "Admin Monitoring": "purple",
};
const resolutionLabels: Record<PriorityAlertResolutionMode, string> = {
  "On-site Visit Required": "Visit Enterprise",
  "In-system Action": "Fix in TANAW",
  "Staff Follow-up": "Staff Follow-up",
  "Remote Review": "Check Remotely",
  "Admin Monitoring": "Admin Monitoring",
};
const statusTones: Record<PriorityAlert["status"], BadgeTone> = { New: "danger", "In Review": "warning", Resolved: "success" };

export function UrgencyBadge({ urgency }: { urgency: TechnicalIssueUrgency }) {
  return <Badge tone={urgencyTones[urgency]}>{urgency}</Badge>;
}

export function SeverityBadge({ severity, label = severity }: { severity: AlertSeverity; label?: string }) {
  return <Badge tone={severityTones[severity]}>{label}</Badge>;
}

export function ResolutionBadge({ mode }: { mode: PriorityAlertResolutionMode }) {
  return <Badge tone={resolutionTones[mode]}>{resolutionLabels[mode]}</Badge>;
}

export function AlertStatusBadge({ status, label }: { status: PriorityAlert["status"]; label?: string }) {
  const resolvedLabel = label ?? (status === "New" ? "Needs Attention" : status === "In Review" ? "Working on It" : "Resolved");
  return <Badge tone={statusTones[status]}>{resolvedLabel}</Badge>;
}
