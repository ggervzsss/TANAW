import { ChevronRight } from "lucide-react";
import { Button, Skeleton, cn, openRowFromClick } from "@/shared/ui-kit";
import type { AccessSummary, PersonnelAccess, PersonnelAccount, PersonnelActions, PersonnelTag } from "../model";

export type PersonnelRow = {
  account: PersonnelAccount;
  role: string;
  tag: PersonnelTag | null;
  access: AccessSummary;
  lastSignIn: string;
  actions: PersonnelActions;
};

export type PersonnelRowHandlers = {
  onEdit: (account: PersonnelAccount) => void;
  onResend: (account: PersonnelAccount) => void;
  onDeactivate: (account: PersonnelAccount) => void;
  onActivate: (account: PersonnelAccount) => void;
  /** The account with a resend or status change on its way. */
  pendingAccountId: string | null;
};

type Props = PersonnelRowHandlers & {
  rows: PersonnelRow[];
  isLoading: boolean;
  emptyText: string;
};

const accessTone: Record<PersonnelAccess, string> = {
  active: "text-(--tanaw-accent-ink)",
  invited: "text-(--tanaw-warn-ink)",
  deactivated: "text-(--tanaw-text-muted)",
};

const accessDot: Record<PersonnelAccess, string> = {
  active: "bg-(--tanaw-accent-ink)",
  invited: "bg-(--tanaw-warn-ink)",
  deactivated: "bg-(--tanaw-text-muted)",
};

const headClass = "px-4 py-3 text-[0.6875rem] font-bold tracking-[0.12em] text-(--tanaw-text-secondary) uppercase";

/** The personnel list: a table on wide screens, stacked records on phones. */
export function PersonnelTable({ rows, isLoading, emptyText, ...handlers }: Props) {
  if (isLoading) {
    return (
      <div className="mt-4 grid gap-2" role="status" aria-busy="true" aria-label="Loading LGU personnel">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (!rows.length) {
    return <p className="rounded-tanaw-lg mt-4 border border-dashed border-(--tanaw-border) px-5 py-10 text-center text-sm text-(--tanaw-text-secondary)">{emptyText}</p>;
  }
  return (
    <>
      <div className="mt-4 hidden lg:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-(--tanaw-border-soft)">
              <th scope="col" className={cn(headClass, "w-[30%] pl-3")}>
                Person
              </th>
              <th scope="col" className={cn(headClass, "w-[10%]")}>
                Role
              </th>
              <th scope="col" className={cn(headClass, "w-[22%]")}>
                Access
              </th>
              <th scope="col" className={cn(headClass, "w-[16%]")}>
                Last signed in
              </th>
              <th scope="col" className={cn(headClass, "pr-3 text-right")}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.account.id}
                data-access={row.access.access}
                onClick={row.actions.canEdit ? openRowFromClick : undefined}
                className={cn("border-b border-(--tanaw-border-soft) align-top", row.actions.canEdit && "tanaw-row-link", row.access.access === "deactivated" && "opacity-70")}
              >
                <th scope="row" className="py-4 pr-4 pl-3 font-normal">
                  <PersonCell row={row} onEdit={handlers.onEdit} />
                </th>
                <td className="p-4 font-semibold text-(--tanaw-text)">{row.role}</td>
                <td className="p-4">
                  <AccessCell access={row.access} />
                </td>
                <td className="p-4 text-(--tanaw-text-secondary)">{row.lastSignIn}</td>
                <td className="py-4 pr-3 pl-4 text-right">
                  <RowActions row={row} {...handlers} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-4 grid gap-3 lg:hidden" aria-label="LGU personnel">
        {rows.map((row) => (
          <li
            key={row.account.id}
            data-access={row.access.access}
            onClick={row.actions.canEdit ? openRowFromClick : undefined}
            className={cn(
              "rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface) p-4",
              row.actions.canEdit && "tanaw-row-link",
              row.access.access === "deactivated" && "opacity-70",
            )}
          >
            <PersonCell row={row} onEdit={handlers.onEdit} />
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-xs font-bold tracking-[0.12em] text-(--tanaw-text-secondary) uppercase">Role</dt>
              <dd className="font-semibold">{row.role}</dd>
              <dt className="text-xs font-bold tracking-[0.12em] text-(--tanaw-text-secondary) uppercase">Access</dt>
              <dd>
                <AccessCell access={row.access} />
              </dd>
              <dt className="text-xs font-bold tracking-[0.12em] text-(--tanaw-text-secondary) uppercase">Last signed in</dt>
              <dd className="text-(--tanaw-text-secondary)">{row.lastSignIn}</dd>
            </dl>
            <div className="mt-3">
              <RowActions row={row} {...handlers} align="start" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The person's name and email. When the account can be edited, the name is the button that opens it. */
function PersonCell({ row, onEdit }: { row: PersonnelRow; onEdit: (account: PersonnelAccount) => void }) {
  const name = row.account.displayName;
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {row.actions.canEdit ? (
          <button type="button" data-row-primary aria-label={`Edit ${name}`} onClick={() => onEdit(row.account)} className="text-base font-bold text-(--tanaw-text)">
            {name}
          </button>
        ) : (
          <span className="text-base font-bold text-(--tanaw-text)">{name}</span>
        )}
        {row.tag && <span className="inline-flex min-h-6 items-center rounded-full bg-(--tanaw-surface-inset) px-2.5 text-xs font-bold text-(--tanaw-text-secondary)">{row.tag}</span>}
      </span>
      <span className="mt-0.5 block text-[0.8125rem] wrap-anywhere text-(--tanaw-text-secondary)">{row.account.email}</span>
    </>
  );
}

function AccessCell({ access }: { access: AccessSummary }) {
  return (
    <>
      <span className={cn("inline-flex items-center gap-1.5 font-semibold", accessTone[access.access])}>
        <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", accessDot[access.access])} />
        {access.label}
      </span>
      <span className="mt-0.5 block text-[0.8125rem] text-(--tanaw-text-muted)">{access.detail}</span>
    </>
  );
}

/** The actions besides opening the account, which the whole row does. */
function RowActions({ row, onResend, onDeactivate, onActivate, pendingAccountId, align = "end" }: PersonnelRowHandlers & { row: PersonnelRow; align?: "start" | "end" }) {
  const { account, actions } = row;
  const busy = pendingAccountId === account.id;
  return (
    <div className={cn("inline-flex flex-wrap items-center gap-2", align === "end" ? "justify-end" : "justify-start")}>
      {actions.resendLabel && (
        <Button variant="secondary" onClick={() => onResend(account)} loading={busy} aria-label={`${actions.resendLabel} to ${account.displayName}`}>
          {actions.resendLabel}
        </Button>
      )}
      {actions.canDeactivate && (
        <Button variant="danger" onClick={() => onDeactivate(account)} disabled={busy} aria-label={`Deactivate ${account.displayName}`}>
          Deactivate
        </Button>
      )}
      {actions.canActivate && (
        <Button variant="secondary" onClick={() => onActivate(account)} loading={busy} aria-label={`Activate ${account.displayName}`}>
          Activate
        </Button>
      )}
      {actions.lockNote && <span className="inline-flex min-h-10.5 items-center text-[0.8125rem] text-(--tanaw-text-muted)">{actions.lockNote}</span>}
      {actions.canEdit && align === "end" && <ChevronRight size={16} aria-hidden="true" className="tanaw-row-chevron" />}
    </div>
  );
}
