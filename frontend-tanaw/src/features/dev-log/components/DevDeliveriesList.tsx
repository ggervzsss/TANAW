import { Copy, Inbox, Mail } from "lucide-react";
import toast from "react-hot-toast/headless";
import { EmptyState } from "@/shared/components/ui";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import type { DevDelivery } from "../services";
import { splitDevLogMessage } from "../utils/devLogMessage";

export function DevDeliveriesList({ deliveries, isLoading, timeFormat }: { deliveries: DevDelivery[]; isLoading: boolean; timeFormat: SystemTimeFormat }) {
  if (deliveries.length === 0)
    return (
      <EmptyState
        icon={Inbox}
        title="No development messages"
        description={isLoading ? "Loading development messages..." : "Account activation and recovery emails will appear here while running in development."}
      />
    );
  return (
    <div className="divide-y divide-slate-100">
      {deliveries.map((delivery) => (
        <article key={delivery.id} className="grid gap-4 p-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="space-y-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black tracking-wide text-emerald-700 uppercase">
              <Mail size={13} /> Email
            </span>
            <div>
              <p className="text-sm font-black text-slate-950">{delivery.recipient}</p>
              <p className="mt-1 font-mono text-[10px] font-bold text-slate-400">{formatPhilippineDateTime(delivery.createdAt, timeFormat)}</p>
            </div>
            <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-600 uppercase">{delivery.status}</span>
          </aside>
          <section className="min-w-0">
            <h2 className="mb-2 text-sm font-black text-slate-900">{delivery.subject}</h2>
            <DevLogMessage body={delivery.body} />
          </section>
        </article>
      ))}
    </div>
  );
}

function DevLogMessage({ body }: { body: string }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed whitespace-pre-wrap text-slate-700">
      {splitDevLogMessage(body).map((segment, index) =>
        segment.type === "text" ? (
          segment.value
        ) : (
          <span key={`${segment.value}-${index}`} className="inline-flex max-w-full items-center gap-1 align-middle">
            <a href={segment.value} target="_blank" rel="noreferrer" className="text-tgreen-dark break-all underline decoration-emerald-300 underline-offset-2 hover:text-emerald-700">
              {segment.value}
            </a>
            <button
              type="button"
              onClick={() => void copyLink(segment.value)}
              className="text-tgreen-dark inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-white transition hover:border-emerald-300 hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
              aria-label="Copy link"
              title="Copy link"
            >
              <Copy size={12} aria-hidden="true" />
            </button>
          </span>
        ),
      )}
    </pre>
  );
}

async function copyLink(link: string) {
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Link copied to clipboard");
  } catch {
    toast.error("Unable to copy the link");
  }
}
