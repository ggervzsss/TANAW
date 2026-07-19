import { Activity, Bell, Building2, TicketCheck, Users, Wifi } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { AlertDetailsModal, PriorityAlertListItem } from "@/features/alerts-monitor/components";
import { MetricCard } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { DetailField, EmptyState, ExpandableTableText, ModalFrame, PageMotion, stagger } from "@/shared/components/ui";
import { useActivityLogs } from "@/shared/hooks/useActivityLogs";
import { useAlerts } from "@/shared/hooks/useAlerts";
import { useOperationalSummary } from "@/shared/hooks/useOperationalSync";
import { listEnterpriseAccounts, listLguAccounts } from "@/shared/services/accountManagement";
import type { PriorityAlert, SystemLog } from "@/shared/types";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { formatPhilippineDateTime, type SystemTimeFormat } from "@/shared/utils/dateTime";

export function ITDashboardPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const { logs, isLoading: logsLoading } = useActivityLogs();
  const operationalSummaryQuery = useOperationalSummary();
  const lguAccountsQuery = useQuery({ queryKey: ["lgu-accounts"], queryFn: listLguAccounts });
  const enterpriseAccountsQuery = useQuery({ queryKey: ["enterprise-accounts"], queryFn: listEnterpriseAccounts });
  const [selectedActivity, setSelectedActivity] = useState<SystemLog | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<PriorityAlert | null>(null);
  const { alerts } = useAlerts();
  const priorityAlerts = alerts.filter((alert) => alert.owner === "IT");
  const activeAlertsCount = priorityAlerts.filter((alert) => alert.status !== "Resolved").length;
  const lguAccounts = lguAccountsQuery.data ?? [];
  const enterpriseAccounts = enterpriseAccountsQuery.data ?? [];
  const operationalSummary = operationalSummaryQuery.data;
  const activeLguAccounts = lguAccounts.filter((account) => account.status === "active").length;
  const activeEnterprises = enterpriseAccounts.filter((enterprise) => enterprise.status === "active").length;
  const desktopAppsOnline = operationalSummary?.onlineGateways ?? enterpriseAccounts.filter((enterprise) => enterprise.gatewayStatus?.toLowerCase() === "connected").length;
  const recentActivities = logs.slice(0, 7);

  const actionableAlerts = priorityAlerts.filter((alert) => alert.status !== "Resolved").slice(0, 4);

  return (
    <PageMotion>
      <PageHeader title="Dashboard" description="Operational overview for accounts, desktop app connectivity, camera health, and recent system activity." />

      <motion.section className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-5" variants={stagger}>
        <MetricCard label="LGU Accounts" value={lguAccountsQuery.isLoading ? "..." : activeLguAccounts} foot="Active LGU accounts" color="#065f46" icon={Users} />
        <MetricCard label="Active Enterprises" value={enterpriseAccountsQuery.isLoading ? "..." : activeEnterprises} foot="Can access TANAW" color="#2563eb" icon={Building2} />
        <MetricCard
          label="Desktop Apps Online"
          value={operationalSummaryQuery.isLoading && !operationalSummary ? "..." : desktopAppsOnline}
          foot={operationalSummary ? `${operationalSummary.delayedGateways} delayed / ${operationalSummary.offlineGateways} offline` : "Connected desktop apps"}
          color="#10b981"
          icon={Wifi}
        />
        <MetricCard label="Priority Alerts" value={activeAlertsCount} foot="Requires IT action" color="#dc2626" footClassName="text-red-600" icon={Bell} />
      </motion.section>
      {(lguAccountsQuery.isError || enterpriseAccountsQuery.isError || operationalSummaryQuery.isError) && (
        <p className="mt-4 text-sm font-semibold text-red-600">Some dashboard metrics could not be loaded from the database. Refresh or check the API connection.</p>
      )}

      <div className="mt-7 grid grid-cols-[minmax(0,2fr)_minmax(360px,1fr)] gap-6 max-xl:grid-cols-1">
        <section className="tanaw-dashboard-panel shadow-panel overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-7 py-6 max-sm:flex-col max-sm:items-start max-sm:px-5">
            <div>
              <h3 className="text-charcoal-800 m-0 text-lg font-bold">Recent System Activity</h3>
              <p className="mt-1.5 mb-0 text-sm text-gray-500">Latest account, enterprise, configuration, and automated actions.</p>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 table-fixed text-left">
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[52%]" />
                  <col className="w-[30%]" />
                </colgroup>
                <thead className="bg-gray-50 text-[11px] font-bold tracking-wider text-gray-500 uppercase">
                  <tr>
                    <th className="py-3.5 pr-2 pl-4 whitespace-nowrap lg:pr-3 lg:pl-5">Date and Time</th>
                    {["Summary", "Name"].map((heading) => (
                      <th key={heading} className="px-4 py-3.5 whitespace-nowrap lg:px-5">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentActivities.map((activity) => {
                    return (
                      <tr key={activity.id} onClick={() => setSelectedActivity(activity)} className="hover:bg-tgreen-dark/5 cursor-pointer transition">
                        <td className="py-4 pr-2 pl-4 font-mono text-xs leading-snug text-gray-500 lg:pr-3 lg:pl-5">{formatCompactTimestamp(activity.timestamp, timeFormat)}</td>
                        <td className="text-charcoal-800 px-4 py-4 text-sm leading-snug font-semibold lg:px-5">
                          <ExpandableTableText primary={activity.summary} ariaLabel="activity summary" threshold={80} twoLines />
                        </td>
                        <td className="px-4 py-4 text-xs leading-snug font-semibold text-gray-600 lg:px-5">
                          <ExpandableTableText primary={activity.actor} ariaLabel="activity actor" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {recentActivities.length === 0 && (
              <EmptyState
                icon={Activity}
                title={logsLoading ? "Loading recent activity" : "No recent activity"}
                description={logsLoading ? "Fetching live activity records." : "System activity records will appear here once the logging source is connected."}
              />
            )}
          </div>
        </section>

        <aside className="grid gap-6">
          <section className="tanaw-dashboard-panel shadow-panel overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-7 py-6 max-sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-charcoal-800 m-0 text-lg font-bold">Priority Alerts</h3>
                  <p className="mt-1.5 mb-0 text-sm text-gray-500">Actionable tasks requiring IT intervention or approval.</p>
                </div>
                <Link to={routes.it.alerts} className="shrink-0 text-sm font-semibold text-emerald-600 transition hover:text-emerald-700">
                  View All Alerts
                </Link>
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {actionableAlerts.map((alert) => (
                <PriorityAlertListItem key={alert.id} alert={alert} onOpen={setSelectedAlert} />
              ))}
              {actionableAlerts.length === 0 && <EmptyState icon={Bell} title="No priority alerts" description="There are no unresolved IT alerts." />}
            </div>
          </section>
        </aside>
      </div>

      <AnimatePresence>
        {selectedActivity && <ActivityDetailsModal activity={selectedActivity} timeFormat={timeFormat} onClose={() => setSelectedActivity(null)} />}
        {selectedAlert && <AlertDetailsModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />}
      </AnimatePresence>
    </PageMotion>
  );
}

function formatCompactTimestamp(timestamp: string, timeFormat: SystemTimeFormat) {
  return formatPhilippineDateTime(timestamp, timeFormat);
}

function ActivityDetailsModal({ activity, timeFormat, onClose }: { activity: SystemLog; timeFormat: SystemTimeFormat; onClose: () => void }) {
  const navigate = useNavigate();
  const supportTicketId = getSupportTicketIdFromLog(activity);

  const openTicket = () => {
    if (!supportTicketId) return;
    onClose();
    navigate(`${routes.it.supportTickets}?ticket=${encodeURIComponent(supportTicketId)}`);
  };

  return (
    <ModalFrame title="Activity Details" eyebrow={activity.id} onClose={onClose}>
      <div className="grid gap-4 md:grid-cols-2">
        <DetailField label="Type" value={activity.category} />
        <DetailField
          label="Actor"
          value={<ExpandableTableText primary={`${activity.actor} (${activity.actorRole})`} ariaLabel="actor" threshold={72} twoLines collapsedLabel="Show more" expandedLabel="Show less" />}
        />
        <DetailField label="Date and Time" value={formatCompactTimestamp(activity.timestamp, timeFormat)} />
        <DetailField label="Target" value={<ExpandableTableText primary={activity.target} ariaLabel="target" threshold={72} twoLines collapsedLabel="Show more" expandedLabel="Show less" />} />
        <DetailField label="Action" value={<ExpandableTableText primary={activity.action} ariaLabel="action" threshold={72} twoLines collapsedLabel="Show more" expandedLabel="Show less" />} />
        <div className="md:col-span-2">
          <DetailField label="Summary" value={<ExpandableTableText primary={activity.summary} ariaLabel="summary" threshold={72} twoLines collapsedLabel="Show more" expandedLabel="Show less" />} />
        </div>
      </div>
      {supportTicketId && (
        <div className="mt-5 rounded-2xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-amber-50 p-4">
          <p className="text-sm font-semibold text-slate-700">
            This activity is tied to a support ticket. Open the ticket queue to inspect the full enterprise request, photos, status, and reply thread.
          </p>
          <button
            type="button"
            onClick={openTicket}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-xs font-black tracking-wide text-white uppercase shadow-sm transition hover:bg-emerald-800"
          >
            <TicketCheck size={14} />
            Open Ticket
          </button>
        </div>
      )}
    </ModalFrame>
  );
}

function getSupportTicketIdFromLog(log: SystemLog) {
  if (!log.sourceId) return null;

  const text = [log.action, log.target, log.summary, log.sourceId].join(" ").toLowerCase();
  return text.includes("ticket") || text.includes("tck-") ? log.sourceId : null;
}
