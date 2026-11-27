import { Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo } from "react";
import { PageMotion } from "@/shared/components/ui";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { Alert, Button, PortalPageHeader, SearchField, SegmentedControl } from "@/shared/ui-kit";
import { DeactivateDialog } from "../components/DeactivateDialog";
import { EmailChangeCallouts } from "../components/EmailChangeCallouts";
import { PersonnelDialog } from "../components/PersonnelDialog";
import { PersonnelTable, type PersonnelRow } from "../components/PersonnelTable";
import { usePersonnelPage } from "../hooks/usePersonnelPage";
import { describeAccess, describeLastSignIn, lockedRoleReason, personnelActions, personnelTag, roleLabelOf, type PersonnelRoleFilter } from "../model";

const ROLE_CHIPS: { value: PersonnelRoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "admin", label: "Admin" },
  { value: "staff", label: "Staff" },
  { value: "it", label: "IT" },
];

export function ITPersonnelPage() {
  const page = usePersonnelPage();
  const { dateFormat, timeFormat } = useSystemDisplayPreferences();

  const rows = useMemo<PersonnelRow[]>(
    () =>
      page.rows.map((account) => ({
        account,
        role: roleLabelOf(account.role),
        tag: personnelTag(account, page.viewerId),
        access: describeAccess(account, { dateFormat, timeFormat }),
        lastSignIn: describeLastSignIn(account, { dateFormat, timeFormat }),
        actions: personnelActions(account, page.accounts, page.viewerId),
      })),
    [page.rows, page.accounts, page.viewerId, dateFormat, timeFormat],
  );

  const filtered = page.query.trim() !== "" || page.role !== "all";
  const emptyText = filtered
    ? "No one matches this search and role."
    : page.showDeactivated
      ? "There are no LGU accounts yet."
      : "There are no active LGU accounts. Show deactivated accounts to see the rest.";

  return (
    <PageMotion>
      <PortalPageHeader
        title="LGU Personnel"
        description="The Admin, Staff and IT accounts of the LGU. Invite people, change their role, and turn access off when they leave."
        actions={
          <Button size="lg" leadingIcon={<Plus size={16} aria-hidden="true" />} onClick={page.openInvite}>
            Invite personnel
          </Button>
        }
      />

      <EmailChangeCallouts callouts={page.callouts} resolvingAccountId={page.resolvingAccountId} onResolve={page.resolveEmailChange} />

      <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="max-w-sm min-w-0 flex-1 basis-72">
          <label htmlFor="personnel-search" className="mb-1.5 block text-[13px] font-medium text-(--tanaw-text-secondary)">
            Search
          </label>
          <SearchField id="personnel-search" value={page.query} onChange={page.setQuery} placeholder="Name or email" label="Search" />
        </div>
        <div className="min-w-0">
          <span aria-hidden="true" className="mb-1.5 block text-[13px] font-medium text-(--tanaw-text-secondary)">
            Role
          </span>
          <div className="flex min-h-11 items-center">
            <SegmentedControl
              ariaLabel="Role"
              value={page.role}
              onChange={(value) => page.setRole(value as PersonnelRoleFilter)}
              options={ROLE_CHIPS.map((chip) => ({ ...chip, count: page.counts[chip.value] }))}
            />
          </div>
        </div>
        <label className="rounded-tanaw-md ease-tanaw-out -mx-2.5 inline-flex min-h-11 cursor-pointer items-center gap-2.5 px-2.5 text-sm font-medium text-(--tanaw-text) transition-colors duration-200 hover:bg-(--tanaw-control-hover)">
          <input type="checkbox" checked={page.showDeactivated} onChange={(event) => page.setShowDeactivated(event.target.checked)} className="it-personnel__check" />
          Show deactivated accounts
        </label>
      </div>

      {page.isError ? (
        <Alert
          tone="danger"
          title="The personnel list did not load"
          className="mt-4"
          action={
            <Button variant="secondary" onClick={page.retry}>
              Try again
            </Button>
          }
        >
          Check the connection, then try again.
        </Alert>
      ) : (
        <PersonnelTable
          rows={rows}
          isLoading={page.isLoading}
          emptyText={emptyText}
          onEdit={page.openEdit}
          onResend={page.resend}
          onDeactivate={page.askDeactivate}
          onActivate={page.activate}
          pendingAccountId={page.pendingAccountId}
        />
      )}
      <p className="mt-3.5 text-[0.8125rem] text-(--tanaw-text-muted)">TANAW always keeps at least one active IT account, and nobody can change the first IT account’s role or turn it off.</p>

      <AnimatePresence>
        {page.dialog && (page.dialog.mode === "invite" || page.dialogAccount) && (
          <PersonnelDialog
            key={page.dialog.mode === "edit" ? page.dialog.accountId : "invite"}
            account={page.dialogAccount}
            lockedRoleReason={page.dialogAccount ? lockedRoleReason(page.dialogAccount, page.accounts, page.viewerId) : null}
            onClose={page.closeDialog}
            onInvited={page.onInvited}
          />
        )}
        {page.confirmDeactivate && (
          <DeactivateDialog key="deactivate" name={page.confirmDeactivate.displayName} busy={page.isDeactivating} onCancel={page.cancelDeactivate} onConfirm={page.deactivate} />
        )}
      </AnimatePresence>
    </PageMotion>
  );
}
