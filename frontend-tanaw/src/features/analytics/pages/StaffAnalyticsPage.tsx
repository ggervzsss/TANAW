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
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <EnterpriseTrafficChart analytics={analytics} />
        <CompliancePanel analytics={analytics} />
      </div>
    </PageMotion>
  );
}
