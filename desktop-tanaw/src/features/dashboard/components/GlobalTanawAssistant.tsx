import { useEffect, useState } from "react";
import type { ReportRecord } from "../../../types/enterprise";
import { useAuthStore } from "../../login/stores/auth-store";
import { loadLocalReportLedger } from "../services/report-ledger";
import { useAssistantStore } from "../stores/assistant-store";
import { TanawAssistant } from "./TanawAssistant";

/**
 * TANAW Insights for every enterprise page. The topbar launcher opens it anywhere; on the dashboard
 * its answers follow the chosen range and the report shown there, elsewhere they cover today and the
 * latest report saved on this computer.
 */
export function GlobalTanawAssistant() {
  const open = useAssistantStore((state) => state.open);
  const toggle = useAssistantStore((state) => state.toggle);
  const setOpen = useAssistantStore((state) => state.setOpen);
  const dashboard = useAssistantStore((state) => state.dashboard);
  const enterpriseId = useAuthStore((state) => state.user?.enterpriseId);
  const latestSaved = useLatestSavedReport(open && !dashboard, enterpriseId);

  // Signing out closes the panel, so the next session starts with it closed.
  useEffect(() => () => setOpen(false), [setOpen]);

  return <TanawAssistant key={enterpriseId ?? "anonymous"} open={open} onToggle={toggle} filter={dashboard?.filter ?? "Today"} report={dashboard ? dashboard.report : latestSaved} />;
}

/** The newest saved report, read each time the panel opens away from the dashboard. */
function useLatestSavedReport(enabled: boolean, enterpriseId: string | null | undefined) {
  const [latest, setLatest] = useState<{ enterpriseId: typeof enterpriseId; report: ReportRecord | null } | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    loadLocalReportLedger(enterpriseId)
      .then((reports) => {
        if (!disposed) setLatest({ enterpriseId, report: reports[0] ?? null });
      })
      .catch(() => {
        // Without the saved reports, report questions answer that none are saved yet.
        if (!disposed) setLatest({ enterpriseId, report: null });
      });
    return () => {
      disposed = true;
    };
  }, [enabled, enterpriseId]);
  return latest && latest.enterpriseId === enterpriseId ? latest.report : null;
}
