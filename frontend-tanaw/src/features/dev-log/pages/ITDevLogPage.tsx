import { Copy, Inbox, Mail, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { EmptyState, PageMotion } from "@/shared/components/ui";
import { listDevDeliveries, type DevDelivery } from "@/shared/services/accountManagement";
import { splitDevLogMessage } from "../utils/devLogMessage";

const EMPTY_DELIVERIES: DevDelivery[] = [];

async function copyLink(link: string) {
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Link copied to clipboard");
  } catch {
    toast.error("Unable to copy the link");
  }
}

function DevLogMessage({ body }: { body: string }) {
  const segments = splitDevLogMessage(body);

  return (
    <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed whitespace-pre-wrap text-slate-700">
      {segments.map((segment, index) => {
        if (segment.type === "text") return segment.value;

        return (
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
        );
      })}
    </pre>
  );
}

export function ITDevLogPage() {
  const [query, setQuery] = useState("");
  const deliveriesQuery = useQuery({
    queryKey: ["dev-deliveries"],
    queryFn: listDevDeliveries,
    refetchInterval: 10_000,
  });

  const deliveries = deliveriesQuery.data ?? EMPTY_DELIVERIES;
  const filteredDeliveries = useMemo(
    () =>
      deliveries.filter((delivery) => {
        const haystack = `${delivery.recipient} ${delivery.subject} ${delivery.body}`.toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
      }),
    [deliveries, query],
  );

  return (
    <PageMotion>
      <PageHeader title="Dev Log" description="Temporary development log for account activation and recovery email messages." />

      <Panel className="overflow-hidden">
        <PanelHeader title="Email Delivery Logs" icon={Inbox} />
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 p-4">
          <div className="relative min-w-0 flex-1 sm:min-w-80">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search recipient or message"
              className="focus:ring-tgreen-dark w-full rounded-lg border border-slate-300 bg-white py-2 pr-4 pl-9 text-sm text-slate-900 transition outline-none focus:ring-1"
            />
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredDeliveries.map((delivery) => {
            return (
              <article key={delivery.id} className="grid gap-4 p-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                <aside className="space-y-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black tracking-wide text-emerald-700 uppercase">
                    <Mail size={13} /> Email
                  </span>
                  <div>
                    <p className="text-sm font-black text-slate-950">{delivery.recipient}</p>
                    <p className="mt-1 font-mono text-[10px] font-bold text-slate-400">{new Date(delivery.createdAt).toLocaleString()}</p>
                  </div>
                  <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-600 uppercase">{delivery.status}</span>
                </aside>
                <section className="min-w-0">
                  <h2 className="mb-2 text-sm font-black text-slate-900">{delivery.subject}</h2>
                  <DevLogMessage body={delivery.body} />
                </section>
              </article>
            );
          })}
          {filteredDeliveries.length === 0 && (
            <EmptyState
              icon={Inbox}
              title="No development messages"
              description={deliveriesQuery.isLoading ? "Loading development logs..." : "Account activation and recovery emails will be recorded here."}
            />
          )}
        </div>
      </Panel>
    </PageMotion>
  );
}
