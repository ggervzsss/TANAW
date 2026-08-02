import { AnimatePresence } from "motion/react";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { ConfirmLguAccountStatus, ConfirmLguActivationResend, CreateLguAccountModal, LguAccountDetailsModal, LguAccountsMetrics, LguAccountsTable, LguAccountsToolbar } from "../components";
import { useLguAccountsPage } from "../hooks";

export function ITLguAccountsPage() {
  const page = useLguAccountsPage();
  return (
    <PageMotion>
      <PageHeader title="LGU Accounts" description="Create personnel accounts, send secure activation links, and manage access status." />
      <LguAccountsMetrics accounts={page.accounts} isLoading={page.isLoading} />
      <Panel className="mt-6 overflow-hidden">
        <LguAccountsToolbar
          query={page.query}
          role={page.role}
          status={page.status}
          onQueryChange={page.setQuery}
          onRoleChange={page.setRole}
          onStatusChange={page.setStatus}
          onCreate={page.openCreate}
        />
        <LguAccountsTable accounts={page.accounts} filteredAccounts={page.filteredAccounts} isLoading={page.isLoading} onSelectAccount={page.selectAccount} />
      </Panel>
      <AnimatePresence>
        {page.createOpen && <CreateLguAccountModal key="create-lgu-account" onClose={page.closeCreate} />}
        {page.currentSelectedAccount && (
          <LguAccountDetailsModal
            key={`lgu-account-details-${page.currentSelectedAccount.id}`}
            account={page.currentSelectedAccount}
            onClose={page.closeSelectedAccount}
            onAccountUpdated={page.selectAccount}
            onResendActivation={page.requestActivationResend}
            onRequestStatusChange={page.requestStatusChange}
          />
        )}
        {page.pendingActivationResend && (
          <ConfirmLguActivationResend
            key={`lgu-activation-resend-${page.pendingActivationResend.id}`}
            account={page.pendingActivationResend}
            isPending={page.isActivationPending}
            onClose={page.closeActivationResend}
            onConfirm={page.confirmActivationResend}
          />
        )}
        {page.pendingStatusChange && (
          <ConfirmLguAccountStatus
            key={`lgu-status-change-${page.pendingStatusChange.account.id}`}
            pendingStatusChange={page.pendingStatusChange}
            isPending={page.isStatusPending}
            onClose={page.closeStatusChange}
            onConfirm={page.confirmStatusChange}
          />
        )}
      </AnimatePresence>
    </PageMotion>
  );
}
