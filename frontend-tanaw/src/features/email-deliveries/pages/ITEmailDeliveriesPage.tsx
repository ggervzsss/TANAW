import { Inbox } from "lucide-react";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { EmailDeliveriesList, EmailDeliveriesToolbar } from "../components";
import { useEmailDeliveries } from "../hooks";

export function ITEmailDeliveriesPage({ embedded = false, problemsOnly = false }: { embedded?: boolean; problemsOnly?: boolean }) {
  const { timeFormat } = useSystemDisplayPreferences();
  const emailDeliveries = useEmailDeliveries(problemsOnly);
  return (
    <PageMotion>
      {!embedded && <PageHeader title="Email Delivery" description="Review emails sent by TANAW and retry failed deliveries when available." />}
      <Panel className="overflow-hidden">
        <PanelHeader title={problemsOnly ? "Email Problems" : "Sent Email History"} icon={Inbox} />
        <EmailDeliveriesToolbar query={emailDeliveries.query} onQueryChange={emailDeliveries.setQuery} />
        <EmailDeliveriesList
          deliveries={emailDeliveries.deliveries}
          isLoading={emailDeliveries.isLoading}
          isRetrying={emailDeliveries.isRetrying}
          problemsOnly={problemsOnly}
          timeFormat={timeFormat}
          onRetry={emailDeliveries.retry}
        />
      </Panel>
    </PageMotion>
  );
}
