import { Inbox, Mail, MessageSquareText, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { EmptyState, PageMotion } from "@/shared/components/ui";
import { listDevDeliveries, type DevDelivery } from "@/shared/services/accountManagement";

type ChannelFilter = "all" | "email" | "sms";
const EMPTY_DELIVERIES: DevDelivery[] = [];

export function ITDevLogPage() {
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<ChannelFilter>("all");
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
        return haystack.includes(query.trim().toLowerCase()) && (channel === "all" || delivery.channel === channel);
      }),
    [channel, deliveries, query],
  );

  return (
    <PageMotion>
      <PageHeader title="Dev Log" description="Temporary development log for generated SMS and email credential messages." />

      <Panel className="overflow-hidden">
        <PanelHeader title="SMS / Email Credential Logs" icon={Inbox} />
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
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as ChannelFilter)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          >
            <option value="all">All Channels</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredDeliveries.map((delivery) => {
            const Icon = delivery.channel === "email" ? Mail : MessageSquareText;
            return (
              <article key={delivery.id} className="grid gap-4 p-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                <aside className="space-y-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black tracking-wide text-emerald-700 uppercase">
                    <Icon size={13} /> {delivery.channel}
                  </span>
                  <div>
                    <p className="text-sm font-black text-slate-950">{delivery.recipient}</p>
                    <p className="mt-1 font-mono text-[10px] font-bold text-slate-400">{new Date(delivery.createdAt).toLocaleString()}</p>
                  </div>
                  <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-600 uppercase">{delivery.status}</span>
                </aside>
                <section className="min-w-0">
                  <h2 className="mb-2 text-sm font-black text-slate-900">{delivery.subject}</h2>
                  <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed whitespace-pre-wrap text-slate-700">{delivery.body}</pre>
                </section>
              </article>
            );
          })}
          {filteredDeliveries.length === 0 && (
            <EmptyState
              icon={Inbox}
              title="No development messages"
              description={deliveriesQuery.isLoading ? "Loading development logs..." : "Account creation and credential resets will record SMS/email messages here."}
            />
          )}
        </div>
      </Panel>
    </PageMotion>
  );
}
