import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, Inbox, RefreshCw, Search } from "lucide-react";
import toast from "react-hot-toast/headless";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { EmptyState, PageMotion } from "@/shared/components/ui";
import { listEmailDeliveries, retryEmailDelivery, type EmailDelivery } from "@/shared/services/accountManagement";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { isEmailProblem } from "../utils/emailDelivery";

const EMPTY_DELIVERIES: EmailDelivery[] = [];

const STATUS_LABELS: Record<EmailDelivery["status"], string> = {
  queued: "Queued by TANAW",
  processing: "Processing",
  retry_scheduled: "Retry scheduled",
  accepted: "Accepted by Resend",
  recorded: "Recorded locally",
  terminal_failed: "Delivery failed",
  cancelled: "Cancelled",
  expired: "Expired",
  reconciliation_required: "Provider check required",
};

export function ITEmailDeliveriesPage({ embedded = false, problemsOnly = false }: { embedded?: boolean; problemsOnly?: boolean }) {
  const { timeFormat } = useSystemDisplayPreferences();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const deliveriesQuery = useQuery({
    queryKey: ["email-deliveries"],
    queryFn: listEmailDeliveries,
    refetchInterval: 5_000,
  });
  const retryMutation = useMutation({
    mutationFn: retryEmailDelivery,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["email-deliveries"] });
      toast.success("Email retry queued");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to retry this email")),
  });

  const deliveries = deliveriesQuery.data ?? EMPTY_DELIVERIES;
  const visibleDeliveries = useMemo(
    () => (problemsOnly ? deliveries.filter(isEmailProblem) : deliveries),
    [deliveries, problemsOnly],
  );
  const filteredDeliveries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return visibleDeliveries;
    return visibleDeliveries.filter((delivery) => `${delivery.recipient} ${delivery.purpose} ${STATUS_LABELS[delivery.status]}`.toLowerCase().includes(normalizedQuery));
  }, [query, visibleDeliveries]);

  return (
    <PageMotion>
      {!embedded && <PageHeader title="Email Delivery" description="Review emails sent by TANAW and retry failed deliveries when available." />}
      <Panel className="overflow-hidden">
        <PanelHeader title={problemsOnly ? "Email Problems" : "Sent Email History"} icon={Inbox} />
        <div className="border-b border-slate-200 bg-slate-50 p-4">
          <label className="relative block max-w-xl">
            <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <span className="sr-only">Search email delivery</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipient, purpose, or status" className="focus:ring-tanaw-green/20 w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-4 pl-9 text-sm outline-none focus:ring-4" />
          </label>
        </div>
        <div className="divide-y divide-slate-100">
          {filteredDeliveries.map((delivery) => (
            <article key={delivery.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <DeliveryStatus status={delivery.status} />
                  <span className="text-xs font-bold tracking-wide text-slate-500 uppercase">{delivery.purpose.replaceAll("_", " ")}</span>
                </div>
                <p className="truncate font-bold text-slate-950">{delivery.recipient}</p>
                <p className="text-xs text-slate-500">
                  Queued {formatPhilippineDateTime(delivery.createdAt, timeFormat)} · Attempt {delivery.attemptCount}/{delivery.maxAttempts}
                </p>
                {delivery.providerMessageId ? <p className="font-mono text-[11px] text-slate-500">Resend Reference: {delivery.providerMessageId}</p> : null}
                {delivery.failureReason ? <p className="max-w-3xl text-sm text-rose-700">{delivery.failureReason}</p> : null}
                {delivery.status === "accepted" ? <p className="text-xs text-slate-500">Resend accepted the email. Delivery or bounce details remain available in the Resend dashboard.</p> : null}
              </div>
              {delivery.canRetry ? (
                <button type="button" onClick={() => retryMutation.mutate(delivery.id)} disabled={retryMutation.isPending} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-bold text-amber-700 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50">
                  <RefreshCw size={15} /> Retry safely
                </button>
              ) : null}
            </article>
          ))}
          {filteredDeliveries.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={problemsOnly ? "No email problems" : "No email delivery records"}
              description={deliveriesQuery.isLoading ? "Checking email delivery..." : problemsOnly ? "There are no failed or uncertain emails that need IT attention." : "No records match the current search."}
            />
          ) : null}
        </div>
      </Panel>
    </PageMotion>
  );
}

function DeliveryStatus({ status }: { status: EmailDelivery["status"] }) {
  const isSuccess = status === "accepted" || status === "recorded";
  const isWaiting = status === "queued" || status === "processing" || status === "retry_scheduled";
  const Icon = isSuccess ? CheckCircle2 : isWaiting ? Clock3 : AlertTriangle;
  const className = isSuccess ? "bg-emerald-50 text-emerald-700" : isWaiting ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";
  return <span className={`${className} inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black tracking-wide uppercase`}><Icon size={13} /> {STATUS_LABELS[status]}</span>;
}
