import { CalendarDays, Check, FileCheck2, History, ShieldAlert, UserCheck, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { ActivityDetailsModal, AdminActivityFilters, AdminActivityTable } from "../components";
import { useAdminActivityHistory } from "../hooks";
import type { ActivityGroup } from "../model";

export function AdminActivityHistoryPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const page = useAdminActivityHistory();
  const { activityGroup, timeRange, query, setActivityGroup, setTimeRange, setQuery } = page;
  const toggleGroup = (group: ActivityGroup) => setActivityGroup(activityGroup === group ? "All Activity" : group);
  const hasFilters = activityGroup !== "All Activity" || timeRange !== "All Time" || Boolean(query);
  const clearFilters = () => {
    setActivityGroup("All Activity");
    setTimeRange("All Time");
    setQuery("");
  };
  const quickFilters = [
    { label: "Today", count: page.metrics.todayCount, icon: CalendarDays, tone: "today", active: timeRange === "Today", toggle: () => setTimeRange(timeRange === "Today" ? "All Time" : "Today") },
    { label: "Report Updates", count: page.metrics.reportCount, icon: FileCheck2, tone: "reports", active: activityGroup === "Reports", toggle: () => toggleGroup("Reports") },
    { label: "Admin Activity", count: page.metrics.adminCount, icon: UserCheck, tone: "admin", active: activityGroup === "Admin Activity", toggle: () => toggleGroup("Admin Activity") },
    {
      label: "Important Updates",
      count: page.metrics.importantCount,
      icon: ShieldAlert,
      tone: "important",
      active: activityGroup === "Important Updates",
      toggle: () => toggleGroup("Important Updates"),
    },
  ];
  return (
    <PageMotion className="tanaw-data-page pb-12">
      <PageHeader title="Activity History" description="Review important report, Admin, account, issue, and security activity across TANAW." />
      <Panel className="tanaw-data-panel tanaw-admin-workspace tanaw-audit-workspace overflow-hidden">
        <section aria-label="Activity history summary" className="tanaw-audit-summary grid grid-cols-2 gap-2 px-4 pt-4 sm:grid-cols-4">
          {quickFilters.map(({ label, count, tone, icon: Icon, active, toggle }) => (
            <button
              type="button"
              key={label}
              aria-pressed={active}
              aria-controls="admin-activity-records"
              onClick={toggle}
              data-tone={tone}
              className="tanaw-audit-summary__metric flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left sm:px-3"
            >
              <span className="tanaw-audit-summary__icon grid size-7 shrink-0 place-items-center rounded-lg" aria-hidden="true">
                {active ? <Check size={15} /> : <Icon size={15} />}
              </span>
              <span className="flex-1 text-xs font-semibold">{label}</span>
              <span className="text-base font-bold tabular-nums">{page.isLoading || page.isError ? "—" : count}</span>
            </button>
          ))}
        </section>
        <header className="tanaw-audit-command">
          <div className="tanaw-audit-command__identity">
            <span className="tanaw-audit-command__icon" aria-hidden="true">
              <History size={19} />
            </span>
            <div>
              <h2>Activity records</h2>
              <p role="status">{page.isLoading ? "Loading records" : `${page.activities.length} ${page.activities.length === 1 ? "record" : "records"} in this view`}</p>
            </div>
          </div>
          <AdminActivityFilters
            activityGroup={page.activityGroup}
            query={page.query}
            timeRange={page.timeRange}
            onActivityGroupChange={page.setActivityGroup}
            onQueryChange={page.setQuery}
            onTimeRangeChange={page.setTimeRange}
          />
        </header>
        <div id="admin-activity-records" className="tanaw-audit-ledger" role="region" aria-label="Activity records">
          <div className="tanaw-audit-ledger__heading">
            <span>
              {activityGroup} <span aria-hidden="true">&middot;</span> {timeRange}
            </span>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="tanaw-audit-clear inline-flex min-h-7 items-center gap-1 font-semibold">
                <X size={13} aria-hidden="true" /> Clear filters
              </button>
            )}
          </div>
          {page.isError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-(--tanaw-border) px-4 py-3 text-sm">
              <p>Activity History could not be refreshed.</p>
              <button type="button" onClick={() => void page.refetch()} className="font-semibold text-(--tanaw-accent-ink) underline">
                Try again
              </button>
            </div>
          )}
          <AdminActivityTable activities={page.activities} isLoading={page.isLoading} timeFormat={timeFormat} onSelect={page.setSelectedActivity} />
          <div className="tanaw-data-footer flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
            <span>Showing {page.activities.length} records</span>
            <span>{page.timeRange}</span>
          </div>
        </div>
      </Panel>
      <AnimatePresence>
        {page.selectedActivity && <ActivityDetailsModal activity={page.selectedActivity} role="admin" timeFormat={timeFormat} onClose={() => page.setSelectedActivity(null)} />}
      </AnimatePresence>
    </PageMotion>
  );
}
