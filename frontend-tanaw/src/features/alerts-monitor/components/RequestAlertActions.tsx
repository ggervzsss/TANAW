import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { activityLogsQueryKey } from "@/features/system-logs/hooks/useActivityLogs";
import { alertsQueryKey } from "@/shared/hooks/useAlerts";
import { updateAlertStatus } from "@/shared/services/alerts";
import type { PriorityAlert, PriorityAlertStatus } from "@/shared/types";
import { Button, cn } from "@/shared/ui-kit";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import type { AdminRequest } from "../model";

const doneMessages: Record<PriorityAlertStatus, string> = {
  New: "Alert reopened.",
  "In Review": "Alert marked in progress.",
  Resolved: "Alert marked resolved.",
};

/** Status buttons for an alert Admins handle themselves, such as a busier-than-usual enterprise. */
export function RequestAlertActions({ request }: { request: AdminRequest }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState({ text: "", failed: false });
  const mutation = useMutation({
    mutationFn: (next: PriorityAlertStatus) => updateAlertStatus(request.sourceId, next),
    onSuccess: (updated) => {
      queryClient.setQueryData<PriorityAlert[]>(alertsQueryKey, (current = []) => current.map((alert) => (alert.id === updated.id ? updated : alert)));
      void queryClient.invalidateQueries({ queryKey: alertsQueryKey });
      void queryClient.invalidateQueries({ queryKey: activityLogsQueryKey });
      setStatus({ text: doneMessages[updated.status], failed: false });
    },
    onError: (error) => setStatus({ text: getApiErrorMessage(error, "The alert could not be updated. Try again."), failed: true }),
  });

  if (!request.adminOwned) return null;
  const change = (next: PriorityAlertStatus) => {
    setStatus({ text: "", failed: false });
    mutation.mutate(next);
  };

  return (
    <section aria-labelledby="request-alert-actions" className="mt-5.5">
      <h3 id="request-alert-actions" className="text-base font-bold">
        Your response
      </h3>
      <p className="mt-1 text-[0.84375rem] text-(--tanaw-text-secondary)">Admins handle this alert. The change is shown to other Admin accounts and kept in Recent Activity.</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
        {request.progress === "attention" && (
          <Button variant="secondary" disabled={mutation.isPending} onClick={() => change("In Review")}>
            Mark in progress
          </Button>
        )}
        {request.progress !== "resolved" && (
          <Button variant="secondary" disabled={mutation.isPending} onClick={() => change("Resolved")}>
            Mark resolved
          </Button>
        )}
        {request.progress === "resolved" && (
          <Button variant="secondary" disabled={mutation.isPending} onClick={() => change("New")}>
            Reopen
          </Button>
        )}
        <p role="status" className={cn("text-[0.84375rem] font-semibold", status.failed ? "text-(--tanaw-error)" : "text-(--tanaw-accent-ink)")}>
          {status.text}
        </p>
      </div>
    </section>
  );
}
