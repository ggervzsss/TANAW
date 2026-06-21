import { Bell } from "lucide-react";
import { DetailField, EmptyState, ModalFrame } from "@/shared/components/ui";
import type { AlertSeverity, PriorityAlert, PriorityAlertResolutionMode } from "@/shared/types";

type PriorityAlertListItemProps = {
  alert: PriorityAlert;
  onOpen: (alert: PriorityAlert) => void;
};

export function PriorityAlertListItem({ alert, onOpen }: PriorityAlertListItemProps) {
  return (
    <article className="cursor-pointer px-6 py-4 transition hover:bg-emerald-50" onClick={() => onOpen(alert)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SeverityBadge severity={alert.severity} />
        <ResolutionBadge mode={alert.resolutionMode} />
      </div>
      <p className="text-charcoal-800 mt-3 mb-1 text-sm font-semibold">{alert.summary}</p>
      <p className="m-0 text-xs leading-relaxed text-gray-500">{alert.requiredAction}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold tracking-wide text-gray-400 uppercase">
        <span>{alert.type}</span>
        <span>{alert.enterprise ?? alert.requester}</span>
        <span>{alert.time}</span>
      </div>
    </article>
  );
}

export function AlertDetailsModal({ alert, onClose }: { alert: PriorityAlert; onClose: () => void }) {
  const relatedEntity = alert.enterprise ? <DetailField label="Enterprise" value={alert.enterprise} /> : null;

  return (
    <ModalFrame title="Priority Alert Details" eyebrow={alert.id} onClose={onClose}>
      <div className="grid gap-4 md:grid-cols-2">
        <DetailField label="Type" value={alert.type} />
        <DetailField label="Severity" value={<SeverityBadge severity={alert.severity} />} />
        <DetailField label="Timestamp" value={alert.time} />
        <DetailField label="Status" value={<AlertStatusBadge status={alert.status} />} />
        <DetailField label="Requester" value={alert.requester} />
        <DetailField label="Resolution Mode" value={<ResolutionBadge mode={alert.resolutionMode} />} />
        {relatedEntity}
        <div className="md:col-span-2">
          <DetailField label="Summary" value={alert.summary} />
        </div>
        <div className="md:col-span-2">
          <DetailField label="Required Action" value={alert.requiredAction} />
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

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const classes: Record<AlertSeverity, string> = {
    Info: "bg-blue-50 text-blue-700",
    Warning: "bg-yellow-50 text-yellow-700",
    Critical: "bg-red-50 text-red-700",
  };
  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold whitespace-nowrap uppercase ${classes[severity]}`}>{severity}</span>;
}

export function ResolutionBadge({ mode }: { mode: PriorityAlertResolutionMode }) {
  const classes: Record<PriorityAlertResolutionMode, string> = {
    "On-site Visit Required": "bg-red-50 text-red-700",
    "In-system Action": "bg-emerald-50 text-emerald-700",
    "Staff Follow-up": "bg-amber-50 text-amber-700",
    "Remote Review": "bg-blue-50 text-blue-700",
    "Admin Monitoring": "bg-indigo-50 text-indigo-700",
  };
  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold whitespace-nowrap uppercase ${classes[mode]}`}>{mode}</span>;
}

export function AlertStatusBadge({ status }: { status: PriorityAlert["status"] }) {
  const classes: Record<PriorityAlert["status"], string> = {
    New: "border-red-200 bg-red-50 text-red-700",
    "In Review": "border-yellow-200 bg-yellow-50 text-yellow-700",
    Resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return <span className={`rounded border px-2.5 py-1 text-[10px] font-bold tracking-wide whitespace-nowrap uppercase ${classes[status]}`}>{status}</span>;
}

function AlertEmptyState() {
  return <EmptyState icon={Bell} title="No alerts" description="There are currently no priority alerts." />;
}
