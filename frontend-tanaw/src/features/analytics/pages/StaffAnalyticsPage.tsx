import { PageHeader } from "@/shared/components/layout";
import { PageMotion } from "@/shared/components/ui";
import { AnalyticsMetrics, CompliancePanel, EnterpriseTrafficChart } from "../components";
import { useStaffAnalytics } from "../hooks";

export function StaffAnalyticsPage() {
  const analytics = useStaffAnalytics();
  return (
    <PageMotion className="tanaw-staff-dashboard pb-12">
      <PageHeader title="Dashboard" description="Compare enterprise performance to identify discrepancies before consolidation." />
      <AnalyticsMetrics analytics={analytics} />
      <div className="mt-6 grid grid-cols-1 items-stretch gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,0.95fr)]">
        <EnterpriseTrafficChart analytics={analytics} />
        <CompliancePanel analytics={analytics} />
      </div>
    </PageMotion>
  );
}
