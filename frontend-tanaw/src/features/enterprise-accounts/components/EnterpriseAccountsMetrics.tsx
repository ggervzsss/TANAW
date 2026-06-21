import { Building2, UserCheck, Users, XCircle } from "lucide-react";
import { MetricCard } from "@/shared/components/cards";
import type { AccountSummary } from "@/shared/services/accountManagement";

type EnterpriseAccountsMetricsProps = {
  accounts: AccountSummary[];
};

export function EnterpriseAccountsMetrics({ accounts }: EnterpriseAccountsMetricsProps) {
  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
      <MetricCard label="Enterprise Accounts" value={accounts.length} foot="Registered entities" color="#2563eb" icon={Building2} />
      <MetricCard label="Active Enterprises" value={accounts.filter((enterprise) => enterprise.status === "active").length} foot="Can access TANAW" color="#065f46" icon={UserCheck} />
      <MetricCard
        label="Inactive Enterprises"
        value={accounts.filter((enterprise) => enterprise.status === "inactive").length}
        foot="Access disabled"
        color="#64748b"
        footClassName="text-slate-600"
        icon={XCircle}
      />
      <MetricCard label="Barangays Covered" value={new Set(accounts.map((enterprise) => enterprise.barangay).filter(Boolean)).size} foot="With registered enterprises" color="#7c3aed" icon={Users} />
    </section>
  );
}
