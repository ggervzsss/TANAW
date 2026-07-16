import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Inbox, Mail, Search } from "lucide-react";
import toast from "react-hot-toast/headless";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { EmptyState, PageMotion } from "@/shared/components/ui";
import { listDevDeliveries, type DevDelivery } from "@/shared/services/accountManagement";

const EMPTY_DELIVERIES: DevDelivery[] = [];

export function ITDevLogPage() {
  const [query, setQuery] = useState("");
  const deliveriesQuery = useQuery({
    queryKey: ["dev-deliveries"],
    queryFn: listDevDeliveries,
    refetchInterval: 5_000,
  });

  const deliveries = deliveriesQuery.data ?? EMPTY_DELIVERIES;
  const filteredDeliveries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return deliveries;
    return deliveries.filter((delivery) => {
      const haystack = `${delivery.recipient} ${delivery.subject} ${delivery.body} ${delivery.actionLink ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [deliveries, query]);

  return (
    <PageMotion>
      <PageHeader title="Dev Log" description="Development-only email log for account activation, recovery, and verification messages." />

      <Panel className="overflow-hidden">
        <PanelHeader title="Email Development Log" icon={Inbox} />
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 p-4">
          <label className="relative min-w-0 flex-1 sm:min-w-80">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <span className="sr-only">Search development email logs</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search recipient, subject, link, or message"
              className="focus:ring-tanaw-green/20 w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-4 pl-9 text-sm text-slate-900 transition outline-none focus:ring-4"
            />
          </label>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredDeliveries.map((delivery) => (
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
              <section className="min-w-0 space-y-3">
                <h2 className="text-sm font-black text-slate-900">{delivery.subject}</h2>
                {delivery.actionLink ? <DevActionLink delivery={delivery} /> : null}
                <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed whitespace-pre-wrap text-slate-700">{delivery.body}</pre>
              </section>
            </article>
          ))}
          {filteredDeliveries.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No development messages"
              description={deliveriesQuery.isLoading ? "Loading development logs..." : "Account activation, recovery, and verification emails will be recorded here."}
            />
          ) : null}
        </div>
      </Panel>
    </PageMotion>
  );
}

function DevActionLink({ delivery }: { delivery: DevDelivery }) {
  const copyLink = async () => {
    if (!delivery.actionLink) return;
    try {
      await navigator.clipboard.writeText(delivery.actionLink);
      toast.success("Account link copied");
    } catch {
      toast.error("Unable to copy account link");
    }
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-black tracking-wide text-emerald-700 uppercase">Account link</p>
          <p className="mt-1 truncate font-mono text-xs text-emerald-950">{delivery.actionLink}</p>
        </div>
        <button type="button" onClick={copyLink} title={delivery.actionLabel ?? "Copy account link"} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white transition hover:-translate-y-0.5 hover:bg-emerald-800">
          <Copy size={14} /> Copy Link
        </button>
      </div>
    </div>
  );
}
