import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast/headless";
import { DetailField, ModalFrame } from "@/shared/components/ui";
import { alertsQueryKey } from "@/shared/hooks/useAlerts";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { updateAlertStatus } from "@/shared/services/alerts";
import type { PriorityAlert, PriorityAlertStatus } from "@/shared/types";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { adminAlertLabel, adminAlertStatusLabel } from "../model";
import { AdminAlertStatusBadge, AdminUrgencyBadge } from "./AdminOperationsTables";

export function AdminSituationDetailsModal({ alert, onClose }: { alert: PriorityAlert; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { timeFormat } = useSystemDisplayPreferences();
  const statusMutation = useMutation({
    mutationFn: (status: PriorityAlertStatus) => updateAlertStatus(alert.id, status),
    onSuccess: async (updatedAlert) => {
      queryClient.setQueryData<PriorityAlert[]>(alertsQueryKey, (current = []) => current.map((item) => (item.id === updatedAlert.id ? updatedAlert : item)));
      await queryClient.invalidateQueries({ queryKey: alertsQueryKey });
      toast.success(`Situation marked as ${adminAlertStatusLabel(updatedAlert.status).toLowerCase()}.`);
    },
    onError: () => toast.error("Unable to update this situation. Please try again."),
  });

  return (
    <ModalFrame title={adminAlertLabel(alert)} eyebrow="Admin Situation" onClose={onClose} maxWidthClassName="max-w-4xl">
      <div className="grid gap-4 md:grid-cols-2">
        <DetailField label="Establishment" value={alert.enterprise ?? alert.requester} />
        <DetailField label="Date and Time" value={formatPhilippineDateTime(alert.time, timeFormat)} />
        <DetailField label="Urgency" value={<AdminUrgencyBadge alert={alert} />} />
        <DetailField label="Status" value={<AdminAlertStatusBadge status={alert.status} />} />
        <DetailField label="What Happened" value={alert.summary} />
        <DetailField label="Suggested Response" value={alert.requiredAction} />
      </div>
      <div className="tanaw-modal-action-panel mt-5 rounded-2xl border p-4 shadow-sm">
        <p className="tanaw-modal-action-panel__title text-sm font-black">Record the Admin response</p>
        <p className="tanaw-modal-action-panel__copy mt-1 text-xs font-semibold">This updates the situation for other Admin accounts and records the action in Activity History.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {alert.status !== "In Review" && alert.status !== "Resolved" && (
            <StatusButton label="Start Review" icon={Clock3} disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("In Review")} />
          )}
          {alert.status !== "Resolved" && <StatusButton label="Mark Resolved" icon={CheckCircle2} disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("Resolved")} />}
          {alert.status === "Resolved" && <StatusButton label="Reopen" icon={AlertTriangle} disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("New")} />}
        </div>
      </div>
    </ModalFrame>
  );
}

function StatusButton({ disabled, icon: Icon, label, onClick }: { disabled: boolean; icon: typeof Clock3; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-xs font-black tracking-wide text-white uppercase shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
