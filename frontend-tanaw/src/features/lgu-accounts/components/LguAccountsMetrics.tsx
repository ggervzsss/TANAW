import { KeyRound, Shield, UserCheck, Users } from "lucide-react";
import { MetricCard } from "@/shared/components/cards";
import type { AccountSummary } from "@/shared/services/accountManagement";

type LguAccountsMetricsProps = {
  accounts: AccountSummary[];
};

export function LguAccountsMetrics({ accounts }: LguAccountsMetricsProps) {
  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
      <MetricCard label="Active Accounts" value={accounts.filter((account) => account.status === "active" && account.isActivated).length} foot="Activated with access" color="#065f46" icon={UserCheck} />
      <MetricCard label="Admin Accounts" value={accounts.filter((account) => account.role === "admin").length} foot="System administrators" color="#2563eb" icon={Shield} />
      <MetricCard label="IT Accounts" value={accounts.filter((account) => account.role === "it").length} foot="IT personnel" color="#10b981" icon={KeyRound} />
      <MetricCard label="Staff Accounts" value={accounts.filter((account) => account.role === "staff").length} foot="LGU staff members" color="#7c3aed" icon={Users} />
    </section>
  );
}
