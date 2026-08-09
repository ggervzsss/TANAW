import { CalendarDays, FileCheck2, ShieldAlert, UserCheck } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { ActivityDetailsModal, AdminActivityFilters, AdminActivityTable } from "../components";
import { useAdminActivityHistory } from "../hooks";

export function AdminActivityHistoryPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const page = useAdminActivityHistory();
  return (
    <PageMotion className="tanaw-data-page pb-12">
      <PageHeader title="Activity History" description="Review important report, Admin, account, issue, and security activity across TANAW." />
      <UnifiedMetricsHeader
        ariaLabel="Activity history summary"
        metrics={[
          { id: "today", title: "Today", value: page.metrics.todayCount, description: "Activity recorded today", tone: "info", icon: CalendarDays, isLoading: page.isLoading },
          { id: "report-updates", title: "Report Updates", value: page.metrics.reportCount, description: "Staff reporting activity", tone: "teal", icon: FileCheck2, isLoading: page.isLoading },
          { id: "admin-activity", title: "Admin Activity", value: page.metrics.adminCount, description: "Actions by Admin accounts", tone: "success", icon: UserCheck, isLoading: page.isLoading },
          {
            id: "important-updates",
            title: "Important Updates",
            value: page.metrics.importantCount,
            description: "Issues and security records",
            tone: "warning",
            icon: ShieldAlert,
            isLoading: page.isLoading,
          },
        ]}
      />
      <Panel className="tanaw-data-panel mt-6 overflow-hidden">
        <AdminActivityFilters
          activityGroup={page.activityGroup}
          query={page.query}
          timeRange={page.timeRange}
          onActivityGroupChange={page.setActivityGroup}
          onQueryChange={page.setQuery}
          onTimeRangeChange={page.setTimeRange}
        />
        <AdminActivityTable activities={page.activities} isLoading={page.isLoading} timeFormat={timeFormat} onSelect={page.setSelectedActivity} />
        <div className="tanaw-data-footer flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
          <span>Showing {page.activities.length} records</span>
          <span>{page.timeRange}</span>
        </div>
      </Panel>
      <AnimatePresence>
        {page.selectedActivity && <ActivityDetailsModal activity={page.selectedActivity} role="admin" timeFormat={timeFormat} onClose={() => page.setSelectedActivity(null)} />}
      </AnimatePresence>
    </PageMotion>
  );
}
