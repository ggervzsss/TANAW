import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { emailDeliveriesQueryKey, isEmailProblem, ITEmailDeliveriesPage, listEmailDeliveries } from "@/features/email-deliveries";
import { LiveAlertList } from "@/features/live-alerts";
import { SupportTicketsPage } from "@/features/support-tickets";
import { PageHeader } from "@/shared/components/layout";
import { PageMotion } from "@/shared/components/ui";
import { useAlerts } from "@/shared/hooks/useAlerts";
import { isClosedRequest, listRequests, requestsQueryKey } from "@/shared/services/requests";

type WorkCenterView = "requests" | "alerts" | "email";

const workCenterViews: { id: WorkCenterView; label: string }[] = [
  { id: "requests", label: "Requests" },
  { id: "alerts", label: "Live Alerts" },
  { id: "email", label: "Email Problems" },
];

/**
 * IT's Work Center: requests to handle (help and account changes), the alerts happening now, and
 * emails that could not be delivered. Alerts are information only: they end by themselves.
 */
export function ITWorkCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseWorkCenterView(searchParams.get("view"));
  const { alerts, isLoading: alertsLoading } = useAlerts();
  const requestsQuery = useQuery({ queryKey: requestsQueryKey, queryFn: listRequests });
  const emailDeliveriesQuery = useQuery({ queryKey: emailDeliveriesQueryKey, queryFn: listEmailDeliveries });

  const viewCounts: Record<WorkCenterView, number> = {
    requests: (requestsQuery.data ?? []).filter((request) => !isClosedRequest(request)).length,
    alerts: alerts.length,
    email: (emailDeliveriesQuery.data ?? []).filter(isEmailProblem).length,
  };

  return (
    <PageMotion className="tanaw-data-page pb-12">
      <PageHeader title="Work Center" description="Requests to handle, what is happening right now, and emails that need attention." />

      <div role="tablist" aria-label="Work Center sections" className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        {workCenterViews.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            onClick={() => setSearchParams({ view: item.id })}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${
              view === item.id ? "bg-tanaw-civic text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:text-emerald-700"
            }`}
          >
            {item.label}
            <span className={`rounded-full px-2 py-0.5 text-[11px] leading-none ${view === item.id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"}`}>{viewCounts[item.id]}</span>
          </button>
        ))}
      </div>

      {view === "requests" && <SupportTicketsPage mode="it" embedded />}
      {view === "alerts" && (
        <section aria-label="Live alerts" className="rounded-2xl border border-(--tanaw-border-soft) bg-(--tanaw-surface) px-5 py-2">
          <LiveAlertList alerts={alerts} dashboardPath={null} emptyText={alertsLoading ? "Checking for alerts." : "No live alerts. Every place is counting normally."} />
        </section>
      )}
      {view === "email" && <ITEmailDeliveriesPage embedded problemsOnly />}
    </PageMotion>
  );
}

function parseWorkCenterView(value: string | null): WorkCenterView {
  if (value === "alerts" || value === "email") return value;
  return "requests";
}
