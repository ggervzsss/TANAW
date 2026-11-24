import { Panel } from "@/shared/components/panel";
import { alertCountLabel, LiveAlertList } from "@/features/live-alerts";
import { useAlerts } from "@/shared/hooks/useAlerts";

/** IT's view of the alerts happening now, with the technical details the server sends to IT. */
export function LiveAlertsSection() {
  const { alerts, isLoading, isError } = useAlerts();
  return (
    <Panel className="mt-6 px-5 py-4">
      <section aria-labelledby="it-live-alerts-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 id="it-live-alerts-title" className="text-lg font-black text-slate-950">
            Alerts
          </h2>
          <p className="text-sm text-slate-500">{isLoading ? "Checking for alerts" : alertCountLabel(alerts.length)}</p>
        </div>
        <p className="mt-1 text-sm text-slate-500">Cameras not counting and places busier than usual, right now. They end by themselves.</p>
        {isError ? <p className="py-3 text-sm text-slate-500">Alerts could not be loaded.</p> : <LiveAlertList alerts={alerts} dashboardPath={null} />}
      </section>
    </Panel>
  );
}
