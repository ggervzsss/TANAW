import { useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { sanPedroBarangays } from "@/shared/data/enterpriseOptions";
import { type AccountSummary, listEnterpriseAccounts } from "@/shared/services/accountManagement";
import { EnterpriseAccountsMetrics, EnterpriseAccountsTable, EnterpriseAccountsToolbar, EnterpriseDetailsModal, EnterpriseProfileRequestsPanel, RegisterEnterpriseModal } from "../components";
import type { EnterpriseStatusFilter } from "../types";
import { filterEnterpriseAccounts } from "../utils";

const EMPTY_ACCOUNTS: AccountSummary[] = [];

type EnterpriseAccountsPageProps = {
  mode?: "it" | "admin";
};

export function ITEnterpriseAccountsPage({ mode = "it" }: EnterpriseAccountsPageProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<EnterpriseStatusFilter>("all");
  const [barangay, setBarangay] = useState("All Barangays");
  const [selectedEnterprise, setSelectedEnterprise] = useState<AccountSummary | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const canManageAccounts = mode === "it";

  const accountsQuery = useQuery({ queryKey: ["enterprise-accounts"], queryFn: listEnterpriseAccounts });
  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS;
  const barangays = ["All Barangays", ...sanPedroBarangays];
  const filteredEnterprises = useMemo(() => filterEnterpriseAccounts(accounts, query, status, barangay), [accounts, barangay, query, status]);
  const handleEnterpriseUpdated = (updatedEnterprise: AccountSummary) => {
    setSelectedEnterprise((current) => (current?.id === updatedEnterprise.id ? updatedEnterprise : current));
  };

  return (
    <PageMotion>
      <PageHeader
        title={mode === "it" ? "Enterprise Accounts" : "Enterprise Profile Requests"}
        description={mode === "it" ? "Register establishments, issue temporary credentials, and manage account access." : "Review enterprise profile change requests sent to IT personnel."}
      />

      <EnterpriseAccountsMetrics accounts={accounts} />
      <EnterpriseProfileRequestsPanel accounts={accounts} canResolve={canManageAccounts} onAccountUpdated={handleEnterpriseUpdated} />

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
          showRegister={canManageAccounts}
        />
        <EnterpriseAccountsTable accounts={accounts} filteredEnterprises={filteredEnterprises} isLoading={accountsQuery.isLoading} onSelectEnterprise={setSelectedEnterprise} />
      </Panel>

      <AnimatePresence>
        {selectedEnterprise && <EnterpriseDetailsModal enterprise={selectedEnterprise} readOnly={!canManageAccounts} onClose={() => setSelectedEnterprise(null)} onEnterpriseUpdated={setSelectedEnterprise} />}
        {registerOpen && canManageAccounts && <RegisterEnterpriseModal onClose={() => setRegisterOpen(false)} />}
      </AnimatePresence>
    </PageMotion>
  );
}
