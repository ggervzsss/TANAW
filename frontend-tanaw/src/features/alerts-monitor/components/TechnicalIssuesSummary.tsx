import { AlertTriangle, Bell, CheckCircle2, Clock3 } from "lucide-react";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
import type { PriorityAlert } from "@/shared/types";

export function TechnicalIssuesSummary({ alerts, isLoading }: { alerts: PriorityAlert[]; isLoading: boolean }) {
  const activeAlerts = alerts.filter((alert) => alert.status !== "Resolved");
  return (
    <UnifiedMetricsHeader
      ariaLabel="Technical issue summary"
      metrics={[
        { id: "needs-attention", title: "Needs Attention", value: activeAlerts.length, description: "Open technical issues", tone: "danger", icon: Bell, isLoading },
        {
          id: "urgent",
          title: "Urgent",
          value: activeAlerts.filter((alert) => alert.urgency === "Urgent").length,
          description: "Needs immediate IT action",
          tone: "danger",
          icon: AlertTriangle,
          isLoading,
        },
        {
          id: "working",
          title: "Working on It",
          value: alerts.filter((alert) => alert.status === "In Review").length,
          description: "Currently being handled",
          tone: "warning",
          icon: Clock3,
          isLoading,
        },
        { id: "resolved", title: "Resolved", value: alerts.filter((alert) => alert.status === "Resolved").length, description: "Fixed by IT", tone: "success", icon: CheckCircle2, isLoading },
      ]}
    />
  );
}
