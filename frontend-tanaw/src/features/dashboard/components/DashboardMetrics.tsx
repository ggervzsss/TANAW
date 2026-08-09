import { AlertTriangle, Inbox, TicketCheck, UserRoundCog, WifiOff } from "lucide-react";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
import type { DashboardOverview } from "../model";

export function DashboardMetrics({ overview }: { overview: DashboardOverview }) {
  return (
    <UnifiedMetricsHeader
      ariaLabel="IT operations overview"
      metrics={[
        {
          id: "urgent-issues",
          title: "Urgent Issues",
          value: overview.urgentIssueCount,
          description: "Needs immediate action",
          tone: "danger",
          icon: AlertTriangle,
          isLoading: overview.loading.overall,
        },
        {
          id: "desktop-apps",
          title: "Desktop Apps",
          value: overview.unavailableDesktopAppCount,
          description: "Offline or delayed",
          tone: "warning",
          icon: WifiOff,
          isLoading: overview.loading.summary && !overview.summary,
        },
        {
          id: "support-requests",
          title: "Support Requests",
          value: overview.openSupportRequestCount,
          description: "Open enterprise requests",
          tone: "info",
          icon: TicketCheck,
          isLoading: overview.loading.support,
        },
        {
          id: "account-requests",
          title: "Account Requests",
          value: overview.pendingAccountRequestCount,
          description: "Waiting for IT review",
          tone: "teal",
          icon: UserRoundCog,
          isLoading: overview.loading.accounts,
        },
        { id: "email-problems", title: "Email Problems", value: overview.emailProblemCount, description: "Failed or uncertain", tone: "purple", icon: Inbox, isLoading: overview.loading.email },
      ]}
    />
  );
}
