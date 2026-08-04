import { AnimatePresence } from "motion/react";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { ActivityDetailsModal, ITSystemLogFilters, ITSystemLogsTable } from "../components";
import { useITSystemLogsPage } from "../hooks";

export function ITSystemLogsPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const page = useITSystemLogsPage();
  return (
    <PageMotion>
      <PageHeader title="System Activity" description="A searchable history of important account changes, technical issues, and IT actions." />
      <Panel className="overflow-hidden">
        <ITSystemLogFilters
          accountFilter={page.accountFilter}
          accountOptions={page.accountOptions}
          query={page.query}
          showRoutine={page.showRoutineActivity}
          timeRange={page.timeRange}
          typeFilter={page.typeFilter}
          typeOptions={page.typeOptions}
          onAccountChange={page.changeAccountFilter}
          onQueryChange={page.setQuery}
          onRoutineChange={page.setShowRoutineActivity}
          onTimeRangeChange={page.setTimeRange}
          onTypeChange={page.changeTypeFilter}
        />
        <ITSystemLogsTable activities={page.activities} isLoading={page.isLoading} timeFormat={timeFormat} onSelect={page.setSelectedActivity} />
        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-[11px] font-bold tracking-wide text-gray-500 uppercase">
          <span>Showing {page.activities.length} activities</span>
          <span>{page.timeRange}</span>
        </div>
      </Panel>
      <AnimatePresence>
        {page.selectedActivity && <ActivityDetailsModal activity={page.selectedActivity} role="it" timeFormat={timeFormat} onClose={() => page.setSelectedActivity(null)} />}
      </AnimatePresence>
    </PageMotion>
  );
}
