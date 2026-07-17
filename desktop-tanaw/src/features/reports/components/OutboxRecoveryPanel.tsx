import { AlertTriangle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Card } from "../../../components/Card";
import type { LocalSyncOutboxRecoveryItem } from "../../camera/services/ml-service";

type OutboxRecoveryPanelProps = {
  error: string | null;
  items: LocalSyncOutboxRecoveryItem[];
  retryingItemId: string | null;
  onRefresh: () => void;
  onRetry: (item: LocalSyncOutboxRecoveryItem, reason: string) => void;
};

export function OutboxRecoveryPanel({ error, items, retryingItemId, onRefresh, onRetry }: OutboxRecoveryPanelProps) {
  const [reasons, setReasons] = useState<Record<string, string>>({});

  if (!error && items.length === 0) return null;

  return (
    <Card className="overflow-hidden rounded-sm border border-amber-200 bg-amber-50/40 shadow-sm" data-testid="report-delivery-recovery">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-amber-200 px-5 py-4">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 text-amber-700" size={18} aria-hidden="true" />
          <div>
            <h3 className="text-sm font-bold tracking-wider text-amber-950 uppercase">Reports Waiting to Send</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-amber-900">These reports are safely stored on this device but have not reached the staff portal yet.</p>
          </div>
        </div>
        <button type="button" onClick={onRefresh} className="flex items-center gap-2 text-xs font-semibold text-amber-800 hover:text-amber-950">
          <RefreshCw size={14} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && <p className="border-b border-amber-200 px-5 py-3 text-xs font-semibold text-red-700">Delivery status could not be checked: {error}</p>}

      <div className="divide-y divide-amber-200">
        {items.map((item) => {
          const reason = reasons[item.outbox_item_id] ?? "";
          const isRetrying = retryingItemId === item.outbox_item_id;
          return (
            <section key={item.outbox_item_id} className="grid gap-4 bg-white/70 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold text-[#111827]">Report {item.report_id}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${item.status === "dead_letter" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}
                  >
                    {item.status === "dead_letter" ? "Needs attention" : "Will retry"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-600">
                  {item.attempt_count.toLocaleString()} send attempt{item.attempt_count === 1 ? "" : "s"}
                </p>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold text-gray-500">Issue type</dt>
                    <dd className="mt-0.5 wrap-break-word text-gray-900">{item.last_error_class ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">Last attempt</dt>
                    <dd className="mt-0.5 text-gray-900">{formatTimestamp(item.last_attempt_at)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-semibold text-gray-500">Reason</dt>
                    <dd className="mt-0.5 wrap-break-word text-gray-900">{item.last_error_message ?? "No failure detail was recorded."}</dd>
                  </div>
                </dl>
              </div>

              <div className="self-center">
                <label htmlFor={`requeue-reason-${item.outbox_item_id}`} className="text-xs font-semibold text-gray-700">
                  Note before retrying
                </label>
                <textarea
                  id={`requeue-reason-${item.outbox_item_id}`}
                  value={reason}
                  maxLength={500}
                  rows={2}
                  onChange={(event) => setReasons((current) => ({ ...current, [item.outbox_item_id]: event.target.value }))}
                  placeholder="Describe what was reviewed or corrected."
                  className="mt-1 w-full resize-none rounded-sm border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 outline-none focus:border-amber-700"
                />
                <button
                  type="button"
                  disabled={isRetrying || reason.trim().length < 3}
                  onClick={() => onRetry(item, reason.trim())}
                  className="mt-2 w-full rounded-sm bg-amber-800 px-3 py-2 text-xs font-bold tracking-wider text-white uppercase hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRetrying ? "Retrying…" : "Retry Sending"}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not attempted";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Invalid timestamp";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}
