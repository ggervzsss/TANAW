import { Inbox, Search } from "lucide-react";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { DevDeliveriesList } from "../components";
import { useDevDeliveries } from "../hooks";

export function ITDevLogPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const deliveries = useDevDeliveries();
  return (
    <PageMotion>
      <PageHeader title="Development Email" description="Development-only view of account activation and recovery messages sent by TANAW." />
      <Panel className="overflow-hidden">
        <PanelHeader title="Development Messages" icon={Inbox} />
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 p-4">
          <div className="relative min-w-0 flex-1 sm:min-w-80">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <input
              value={deliveries.query}
              onChange={(event) => deliveries.setQuery(event.target.value)}
              placeholder="Search recipient or message"
              className="focus:ring-tgreen-dark w-full rounded-lg border border-slate-300 bg-white py-2 pr-4 pl-9 text-sm text-slate-900 transition outline-none focus:ring-1"
            />
          </div>
        </div>
        <DevDeliveriesList deliveries={deliveries.filteredDeliveries} isLoading={deliveries.isLoading} timeFormat={timeFormat} />
      </Panel>
    </PageMotion>
  );
}
