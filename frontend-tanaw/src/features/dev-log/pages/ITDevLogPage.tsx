import { PageMotion } from "@/shared/components/ui";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { PortalPageHeader, SearchField } from "@/shared/ui-kit";
import { DevDeliveriesList } from "../components";
import { useDevDeliveries } from "../hooks";

/** Development Email: the activation and recovery messages TANAW sent, while running in development. */
export function ITDevLogPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const deliveries = useDevDeliveries();
  return (
    <PageMotion>
      <PortalPageHeader title="Development Email" description="Development-only view of account activation and recovery messages sent by TANAW." />
      <section aria-labelledby="dev-log-messages">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-(--tanaw-border-soft) pb-4">
          <h2 id="dev-log-messages" className="text-lg leading-snug font-[650] tracking-[-0.01em] text-(--tanaw-text)">
            Development Messages
          </h2>
          <div className="w-full max-w-sm min-w-0 sm:w-80">
            <SearchField value={deliveries.query} onChange={deliveries.setQuery} placeholder="Search recipient or message" />
          </div>
        </div>
        <DevDeliveriesList deliveries={deliveries.filteredDeliveries} isLoading={deliveries.isLoading} timeFormat={timeFormat} />
      </section>
    </PageMotion>
  );
}
