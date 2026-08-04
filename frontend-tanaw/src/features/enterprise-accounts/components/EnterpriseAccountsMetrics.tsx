import { Building2, UserCheck, Users, XCircle } from "lucide-react";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
import type { AccountSummary } from "@/shared/types";

type EnterpriseAccountsMetricsProps = {
  accounts: AccountSummary[];
  isLoading?: boolean;
};

export function EnterpriseAccountsMetrics({ accounts, isLoading = false }: EnterpriseAccountsMetricsProps) {
  return (
    <UnifiedMetricsHeader
      ariaLabel="Enterprise account summary"
      metrics={[
        { id: "total", title: "Enterprise Accounts", value: accounts.length, description: "Registered entities", tone: "info", icon: Building2, isLoading },
        {
          id: "active",
          title: "Active Enterprises",
          value: accounts.filter((enterprise) => enterprise.status === "active" && enterprise.isActivated).length,
          description: "Activated with access",
          tone: "success",
          icon: UserCheck,
          isLoading,
        },
        {
          id: "inactive",
          title: "Inactive Enterprises",
          value: accounts.filter((enterprise) => enterprise.status === "inactive").length,
          description: "Access disabled",
          tone: "neutral",
          icon: XCircle,
          isLoading,
        },
        {
          id: "barangays",
          title: "Barangays Covered",
          value: new Set(accounts.map((enterprise) => enterprise.barangay).filter(Boolean)).size,
          description: "With registered enterprises",
          tone: "purple",
          icon: Users,
          isLoading,
        },
      ]}
    />
  );
}
