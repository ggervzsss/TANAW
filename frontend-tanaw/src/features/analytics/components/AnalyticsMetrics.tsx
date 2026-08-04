import { Activity, ClipboardCheck, Users } from "lucide-react";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
import { FilterSelect } from "@/shared/components/ui";
import type { StaffAnalyticsViewModel } from "../hooks";

export function AnalyticsMetrics({ analytics }: { analytics: StaffAnalyticsViewModel }) {
  return (
    <UnifiedMetricsHeader
      ariaLabel="Staff reporting overview"
      metrics={[
        { id: "entries", title: "Total Aggregated Entries", value: analytics.entries, description: analytics.trendLabel, tone: "success", icon: Activity, isLoading: analytics.reportsLoading },
        { id: "unique", title: "Est. Unique People", value: analytics.unique, description: "From reporting submissions", tone: "info", icon: Users, isLoading: analytics.reportsLoading },
        {
          id: "compliance",
          title: "Reports Compliance",
          value: `${analytics.submittedCount} / ${analytics.totalReports}`,
          description: `${analytics.submissionRate}% Submission Rate`,
          tone: "warning",
          icon: ClipboardCheck,
          isLoading: analytics.enterpriseLoading || analytics.reportsLoading,
        },
      ]}
      controlSegment={{
        id: "reporting-period",
        title: "Reporting Period",
        description: "Filter comparative data and live update history by calendar month.",
        content: (
          <FilterSelect
            value={analytics.activePeriod?.key ?? ""}
            onChange={analytics.setSelectedPeriodKey}
            options={analytics.periods.map((period) => [period.key, period.label] as const)}
            ariaLabel="Reporting period"
            className="w-full"
          />
        ),
      }}
    />
  );
}
