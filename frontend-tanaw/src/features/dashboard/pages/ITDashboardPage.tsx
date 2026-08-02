import { PageHeader } from "@/shared/components/layout";
import { PageMotion } from "@/shared/components/ui";
import { CurrentWorkPanel, DashboardMetrics, DashboardSidePanels } from "../components";
import { useITDashboardOverview } from "../hooks";

export function ITDashboardPage() {
  const overview = useITDashboardOverview();
  return (
    <PageMotion className="pb-12">
      <PageHeader title="Overview" description="A simple view of the technical work that needs attention now." />
      <DashboardMetrics overview={overview} />
      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)]">
        <CurrentWorkPanel overview={overview} />
        <DashboardSidePanels overview={overview} />
      </div>
    </PageMotion>
  );
}
