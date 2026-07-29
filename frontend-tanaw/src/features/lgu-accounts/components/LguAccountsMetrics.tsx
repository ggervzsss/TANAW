import { KeyRound, Shield, UserCheck, Users } from "lucide-react";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
import type { AccountSummary } from "@/shared/services/accountManagement";

type LguAccountsMetricsProps = {
  accounts: AccountSummary[];
  isLoading?: boolean;
};

export function LguAccountsMetrics({ accounts, isLoading = false }: LguAccountsMetricsProps) {
  return (
    <UnifiedMetricsHeader
      ariaLabel="LGU account summary"
      metrics={[
        {
          id: "active",
          title: "Active Accounts",
          value: accounts.filter((account) => account.status === "active" && account.isActivated).length,
          description: "Activated with access",
          tone: "success",
          icon: UserCheck,
          isLoading,
        },
        {
          id: "admins",
          title: "Admin Accounts",
          value: accounts.filter((account) => account.role === "admin").length,
          description: "System administrators",
          tone: "info",
          icon: Shield,
          isLoading,
        },
        {
          id: "it",
          title: "IT Accounts",
          value: accounts.filter((account) => account.role === "it").length,
          description: "IT personnel",
          tone: "teal",
          icon: KeyRound,
          isLoading,
        },
        {
          id: "staff",
          title: "Staff Accounts",
          value: accounts.filter((account) => account.role === "staff").length,
          description: "LGU staff members",
          tone: "purple",
          icon: Users,
          isLoading,
        },
      ]}
    />
  );
}
