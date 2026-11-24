import { TriangleAlert } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { useAlerts } from "@/shared/hooks/useAlerts";
import { Dialog, cn } from "@/shared/ui-kit";
import { alertCountLabel } from "../model/liveAlerts";
import { LiveAlertList } from "./LiveAlertList";

/**
 * The topbar alert icon: a warning triangle with the number of live alerts. It opens a dialog
 * listing them. For the Admin it replaces the notification bell.
 */
export function AlertsButton({ dashboardPath, className }: { dashboardPath: string | null; className?: string }) {
  const { alerts, isLoading } = useAlerts();
  const [open, setOpen] = useState(false);
  const count = alerts.length;
  const camera = alerts.some((alert) => alert.type === "Camera Not Counting");
  return (
    <>
      <button
        type="button"
        aria-label={`Alerts: ${alertCountLabel(count)}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn("relative flex h-11 w-11 items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg", className)}
      >
        <TriangleAlert size={18} aria-hidden="true" />
        {count > 0 && (
          <span
            aria-hidden="true"
            data-alert-count={count}
            className={cn("absolute -top-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-5 font-bold text-white", camera ? "bg-(--tanaw-danger)" : "bg-(--tanaw-warn-ink)")}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <Dialog title="Alerts" description={isLoading ? "Checking for alerts." : `${alertCountLabel(count)}. Alerts end by themselves when the problem clears.`} onClose={() => setOpen(false)} size="md">
            <LiveAlertList alerts={alerts} dashboardPath={dashboardPath} onNavigate={() => setOpen(false)} />
          </Dialog>
        )}
      </AnimatePresence>
    </>
  );
}
