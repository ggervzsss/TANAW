import { Copy, Inbox, Mail } from "lucide-react";
import toast from "react-hot-toast/headless";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { Badge, EmptyState, Skeleton } from "@/shared/ui-kit";
import type { DevDelivery } from "../services";
import { splitDevLogMessage } from "../utils/devLogMessage";

const rowGrid = "grid gap-4 border-b border-(--tanaw-border-soft) py-5 lg:grid-cols-[220px_minmax(0,1fr)]";

/** The messages as open rows split by hairlines: who and when on the left, the message on the right. */
export function DevDeliveriesList({ deliveries, isLoading, timeFormat }: { deliveries: DevDelivery[]; isLoading: boolean; timeFormat: SystemTimeFormat }) {
  if (isLoading && deliveries.length === 0) return <DevDeliveriesSkeleton />;
  if (deliveries.length === 0)
    return (
      <EmptyState
        icon={<Inbox size={22} />}
        title="No development messages"
        description="Account activation and recovery emails will appear here while running in development."
      />
    );
  return (
    <div className="tanaw-enter">
      {deliveries.map((delivery) => (
        <article key={delivery.id} className={rowGrid}>
          <aside className="space-y-2">
            <Badge tone="success">
              <Mail size={13} /> Email
            </Badge>
            <div>
              <p className="text-sm font-semibold wrap-anywhere text-(--tanaw-text)">{delivery.recipient}</p>
              <p className="mt-1 font-mono text-xs text-(--tanaw-text-muted)">{formatPhilippineDateTime(delivery.createdAt, timeFormat)}</p>
            </div>
            <Badge>{delivery.status}</Badge>
          </aside>
          <section className="min-w-0">
            <h3 className="mb-2 text-[0.9375rem] font-[650] text-(--tanaw-text)">{delivery.subject}</h3>
            <DevLogMessage body={delivery.body} />
          </section>
        </article>
      ))}
    </div>
  );
}

/** Message rows in their own shape while the log loads. */
function DevDeliveriesSkeleton() {
  return (
    <div role="status" aria-label="Loading development messages...">
      {[0, 1, 2].map((index) => (
        <div key={index} className={rowGrid}>
          <div className="space-y-2.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div>
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="rounded-tanaw-md mt-3 h-24 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DevLogMessage({ body }: { body: string }) {
  return (
    <pre className="rounded-tanaw-md max-h-64 overflow-auto bg-(--tanaw-surface-inset) p-4 text-[13px] leading-relaxed whitespace-pre-wrap text-(--tanaw-text-secondary)">
      {splitDevLogMessage(body).map((segment, index) =>
        segment.type === "text" ? (
          segment.value
        ) : (
          <span key={`${segment.value}-${index}`} className="inline-flex max-w-full items-center gap-1 align-middle">
            <a href={segment.value} target="_blank" rel="noreferrer" className="break-all text-(--tanaw-accent-ink) underline underline-offset-2 hover:text-(--tanaw-action-hover)">
              {segment.value}
            </a>
            <button
              type="button"
              onClick={() => void copyLink(segment.value)}
              className="rounded-tanaw-sm inline-flex size-6 shrink-0 items-center justify-center text-(--tanaw-accent-ink) transition-colors duration-150 hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
              aria-label="Copy link"
              title="Copy link"
            >
              <Copy size={13} aria-hidden="true" />
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
