import { Inbox, RefreshCw } from "lucide-react";
import { EmptyState } from "@/shared/components/ui";
import { formatPhilippineDateTime, type SystemTimeFormat } from "@/shared/utils/dateTime";
import type { EmailDelivery } from "../services";
import { EmailDeliveryStatus } from "./EmailDeliveryStatus";

type EmailDeliveriesListProps = {
  deliveries: EmailDelivery[];
  isLoading: boolean;
  isRetrying: boolean;
  problemsOnly: boolean;
  timeFormat: SystemTimeFormat;
  onRetry: (deliveryId: string) => void;
};

export function EmailDeliveriesList({ deliveries, isLoading, isRetrying, problemsOnly, timeFormat, onRetry }: EmailDeliveriesListProps) {
  return (
    <div className="divide-y divide-slate-100">
      {deliveries.map((delivery) => (
        <article key={delivery.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <EmailDeliveryStatus status={delivery.status} />
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
            <button
              type="button"
              onClick={() => onRetry(delivery.id)}
              disabled={isRetrying}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-bold text-amber-700 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={15} /> Retry safely
            </button>
          ) : null}
        </article>
      ))}
      {deliveries.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={problemsOnly ? "No email problems" : "No email delivery records"}
          description={isLoading ? "Checking email delivery..." : problemsOnly ? "There are no failed or uncertain emails that need IT attention." : "No records match the current search."}
        />
      ) : null}
    </div>
  );
}
