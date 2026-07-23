import { Bell } from "lucide-react";
import { DetailField, EmptyState, ExpandableTableText, ModalFrame } from "@/shared/components/ui";
import type { AlertSeverity, PriorityAlert, PriorityAlertResolutionMode } from "@/shared/types";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";

type PriorityAlertListItemProps = {
  alert: PriorityAlert;
  onOpen: (alert: PriorityAlert) => void;
};

export function PriorityAlertListItem({ alert, onOpen }: PriorityAlertListItemProps) {
  const { timeFormat } = useSystemDisplayPreferences();
  return (
    <article className="tanaw-interactive-row cursor-pointer px-6 py-4" onClick={() => onOpen(alert)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SeverityBadge severity={alert.severity} />
        <ResolutionBadge mode={alert.resolutionMode} />
      </div>
      <p className="text-charcoal-800 mt-3 mb-1 text-sm font-semibold dark:text-slate-100">{alert.summary}</p>
      <p className="m-0 text-xs leading-relaxed text-gray-500 dark:text-slate-300">{alert.requiredAction}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold tracking-wide text-gray-400 uppercase dark:text-slate-400">
        <span>{alert.type}</span>
        <span>{alert.enterprise ?? alert.requester}</span>
        <time dateTime={alert.time}>{formatPhilippineDateTime(alert.time, timeFormat)}</time>
      </div>
    </article>
  );
}

export function AlertDetailsModal({ alert, onClose }: { alert: PriorityAlert; onClose: () => void }) {
  const { timeFormat } = useSystemDisplayPreferences();
  const expandableValue = (value: string, label: string) => (
    <ExpandableTableText primary={value} ariaLabel={label} twoLines className="leading-relaxed font-semibold" />
  );

  return (
    <ModalFrame title="Technical Issue Details" eyebrow={alert.id} onClose={onClose}>
      <div className="grid gap-4 md:grid-cols-2">
        <DetailField label="Problem" value={alert.type} />
        <DetailField label="Urgency" value={<SeverityBadge severity={alert.severity} label={alert.severity === "Critical" ? "Urgent" : alert.severity === "Warning" ? "Important" : "For Awareness"} />} />
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

export function AllAlertsModal({ alerts, onClose, onSelectAlert }: { alerts: PriorityAlert[]; onClose: () => void; onSelectAlert: (alert: PriorityAlert) => void }) {
  return (
    <ModalFrame title="All Priority Alerts" onClose={onClose} maxWidthClassName="max-w-4xl">
      <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-slate-200">
        {alerts.length === 0 && <AlertEmptyState />}
        {alerts.map((alert) => (
          <div key={alert.id} className="relative">
            <PriorityAlertListItem alert={alert} onOpen={onSelectAlert} />
            <div className="absolute right-6 bottom-4">
              <AlertStatusBadge status={alert.status} />
            </div>
          </div>
        ))}
      </div>
    </ModalFrame>
  );
}

export function SeverityBadge({ severity, label = severity }: { severity: AlertSeverity; label?: string }) {
  const classes: Record<AlertSeverity, string> = {
    Info: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200",
    Warning: "bg-yellow-50 text-yellow-700 dark:bg-yellow-400/15 dark:text-yellow-200",
    Critical: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200",
  };
  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold whitespace-nowrap uppercase ${classes[severity]}`}>{label}</span>;
}

export function ResolutionBadge({ mode }: { mode: PriorityAlertResolutionMode }) {
  const classes: Record<PriorityAlertResolutionMode, string> = {
    "On-site Visit Required": "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200",
    "In-system Action": "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
    "Staff Follow-up": "bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200",
    "Remote Review": "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200",
    "Admin Monitoring": "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200",
  };
  const labels: Record<PriorityAlertResolutionMode, string> = {
    "On-site Visit Required": "Visit Enterprise",
    "In-system Action": "Fix in TANAW",
    "Staff Follow-up": "Staff Follow-up",
    "Remote Review": "Check Remotely",
    "Admin Monitoring": "Admin Monitoring",
  };
  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold whitespace-nowrap uppercase ${classes[mode]}`}>{labels[mode]}</span>;
}

export function AlertStatusBadge({ status, label }: { status: PriorityAlert["status"]; label?: string }) {
  const classes: Record<PriorityAlert["status"], string> = {
    New: "border-red-200 bg-red-50 text-red-700 dark:border-red-300/30 dark:bg-red-500/15 dark:text-red-200",
    "In Review": "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-300/30 dark:bg-yellow-400/15 dark:text-yellow-200",
    Resolved: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/30 dark:bg-emerald-500/15 dark:text-emerald-200",
  };
  const resolvedLabel = label ?? (status === "New" ? "Needs Attention" : status === "In Review" ? "Working on It" : "Resolved");
  return <span className={`rounded border px-2.5 py-1 text-[10px] font-bold tracking-wide whitespace-nowrap uppercase ${classes[status]}`}>{resolvedLabel}</span>;
}

function AlertEmptyState() {
  return <EmptyState icon={Bell} title="No alerts" description="There are currently no priority alerts." />;
}
