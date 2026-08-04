import { useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { sanPedroBarangays } from "@/shared/data/enterpriseOptions";
import type { AccountSummary } from "@/shared/types";
import { EnterpriseAccountsMetrics, EnterpriseAccountsTable, EnterpriseAccountsToolbar, EnterpriseDetailsModal, EnterpriseProfileRequestsPanel, RegisterEnterpriseModal } from "../components";
import { enterpriseAccountsQueryKey, listEnterpriseAccounts } from "../services";
import type { EnterpriseStatusFilter } from "../types";
import { filterEnterpriseAccounts } from "../utils";

const EMPTY_ACCOUNTS: AccountSummary[] = [];

export function ITEnterpriseAccountsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<EnterpriseStatusFilter>("all");
  const [barangay, setBarangay] = useState("All Barangays");
  const [selectedEnterprise, setSelectedEnterprise] = useState<AccountSummary | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  const accountsQuery = useQuery({ queryKey: enterpriseAccountsQueryKey, queryFn: listEnterpriseAccounts });
  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS;
  const currentSelectedEnterprise = selectedEnterprise ? (accounts.find((account) => account.id === selectedEnterprise.id) ?? selectedEnterprise) : null;
  const barangays = ["All Barangays", ...sanPedroBarangays];
  const filteredEnterprises = useMemo(() => filterEnterpriseAccounts(accounts, query, status, barangay), [accounts, barangay, query, status]);
  const handleEnterpriseUpdated = (updatedEnterprise: AccountSummary) => {
    setSelectedEnterprise((current) => (current?.id === updatedEnterprise.id ? updatedEnterprise : current));
  };

  return (
    <PageMotion>
      <PageHeader title="Enterprise Accounts" description="Register establishments, send secure activation links, and manage account access." />

      <EnterpriseAccountsMetrics accounts={accounts} isLoading={accountsQuery.isLoading} />
      <EnterpriseProfileRequestsPanel accounts={accounts} canResolve onAccountUpdated={handleEnterpriseUpdated} />

      <Panel className="mt-6 overflow-hidden">
        <EnterpriseAccountsToolbar
          query={query}
          status={status}
          barangay={barangay}
          barangays={barangays}
          onQueryChange={setQuery}
          onStatusChange={setStatus}
          onBarangayChange={setBarangay}
          onRegister={() => setRegisterOpen(true)}
        />
        <EnterpriseAccountsTable accounts={accounts} filteredEnterprises={filteredEnterprises} isLoading={accountsQuery.isLoading} onSelectEnterprise={setSelectedEnterprise} />
      </Panel>

      <AnimatePresence>
        {currentSelectedEnterprise && (
          <EnterpriseDetailsModal
            key={`enterprise-details-${currentSelectedEnterprise.id}`}
            enterprise={currentSelectedEnterprise}
            onClose={() => setSelectedEnterprise(null)}
            onEnterpriseUpdated={setSelectedEnterprise}
          />
        )}
        {registerOpen && <RegisterEnterpriseModal key="register-enterprise" onClose={() => setRegisterOpen(false)} />}
      </AnimatePresence>
    </PageMotion>
  );
}
