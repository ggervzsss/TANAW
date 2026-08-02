import { AnimatePresence } from "motion/react";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { AlertDetailsModal, TechnicalIssuesSummary, TechnicalIssuesTable, TechnicalIssuesToolbar } from "../components";
import { useTechnicalIssuesPage } from "../hooks";

export function ITAlertsPage({ embedded = false }: { embedded?: boolean }) {
  const { timeFormat } = useSystemDisplayPreferences();
  const { alerts, closeAlert, filteredAlerts, filters, isLoading, openAlert, selectedAlert, setFilters, updateStatus } = useTechnicalIssuesPage();

  return (
    <PageMotion>
      {!embedded && <PageHeader title="Technical Issues" description="Problems with cameras, desktop applications, data updates, sign-ins, and account access that may need IT action." />}
      <TechnicalIssuesSummary alerts={alerts} isLoading={isLoading} />
      <Panel className="mt-6 overflow-hidden">
        <TechnicalIssuesToolbar filters={filters} setFilters={setFilters} />
        <TechnicalIssuesTable alerts={alerts} filteredAlerts={filteredAlerts} onOpen={openAlert} onStatusChange={updateStatus} timeFormat={timeFormat} />
      </Panel>
      <AnimatePresence>{selectedAlert && <AlertDetailsModal alert={selectedAlert} onClose={closeAlert} />}</AnimatePresence>
    </PageMotion>
  );
}
