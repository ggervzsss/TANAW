import { ChevronRight } from "lucide-react";
import { Button, Skeleton, cn, openRowFromClick } from "@/shared/ui-kit";
import type { AccessSummary, PersonnelAccess, PersonnelAccount, PersonnelActions, PersonnelTag } from "../model";
import "../itPersonnel.css";

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

const headClass = "px-4 py-2.5 text-xs font-semibold tracking-label text-(--tanaw-label) uppercase";
const termClass = "text-[13px] text-(--tanaw-text-muted)";

/** The personnel list: a table on wide screens, stacked records on phones. */
export function PersonnelTable({ rows, isLoading, emptyText, ...handlers }: Props) {
  if (isLoading) return <PersonnelSkeleton />;
  if (!rows.length) {
    return <p className="mt-4 border-t border-(--tanaw-border-soft) px-5 py-10 text-center text-sm text-(--tanaw-text-secondary)">{emptyText}</p>;
  }
  return (
    <div className="it-personnel__list">
      <div className="mt-4 hidden lg:block">
        <table className="it-personnel__table w-full border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
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
                className={cn("align-top", row.actions.canEdit && "tanaw-row-link", row.access.access === "deactivated" && "opacity-70")}
              >
                <th scope="row" className="py-4 pr-4 pl-3 font-normal">
                  <PersonCell row={row} onEdit={handlers.onEdit} />
                </th>
                <td className="p-4 font-medium text-(--tanaw-text)">{row.role}</td>
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
      <ul className="mt-4 border-t border-(--tanaw-border-soft) lg:hidden" aria-label="LGU personnel">
        {rows.map((row) => (
          <li
            key={row.account.id}
            data-access={row.access.access}
            onClick={row.actions.canEdit ? openRowFromClick : undefined}
            className={cn("it-personnel__row py-4", row.actions.canEdit && "tanaw-row-link", row.access.access === "deactivated" && "opacity-70")}
          >
            <PersonCell row={row} onEdit={handlers.onEdit} />
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className={termClass}>Role</dt>
              <dd className="font-medium">{row.role}</dd>
              <dt className={termClass}>Access</dt>
              <dd>
                <AccessCell access={row.access} />
              </dd>
              <dt className={termClass}>Last signed in</dt>
              <dd className="text-(--tanaw-text-secondary)">{row.lastSignIn}</dd>
            </dl>
            <div className="mt-3">
              <RowActions row={row} {...handlers} align="start" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Table rows in the list's shape while the accounts load. */
function PersonnelSkeleton() {
  return (
    <div className="mt-4" role="status" aria-busy="true" aria-label="Loading LGU personnel">
      <Skeleton className="h-9 w-full rounded-[10px] max-lg:hidden" />
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="grid grid-cols-[30%_10%_22%_16%_minmax(0,1fr)] items-start gap-0 border-b border-(--tanaw-border-soft) py-4 max-lg:grid-cols-1">
          <div className="pl-3 max-lg:pl-0">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-52 max-w-full" />
          </div>
          <Skeleton className="ml-4 h-4 w-12 max-lg:hidden" />
          <div className="pl-4 max-lg:hidden">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
          <Skeleton className="ml-4 h-4 w-24 max-lg:hidden" />
          <Skeleton className="rounded-tanaw-md ml-auto h-10 w-28 max-lg:hidden" />
        </div>
      ))}
    </div>
  );
}

/** The person's name and email. When the account can be edited, the name is the button that opens it. */
function PersonCell({ row, onEdit }: { row: PersonnelRow; onEdit: (account: PersonnelAccount) => void }) {
  const name = row.account.displayName;
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {row.actions.canEdit ? (
          <button type="button" data-row-primary aria-label={`Edit ${name}`} onClick={() => onEdit(row.account)} className="text-base font-semibold text-(--tanaw-text)">
            {name}
          </button>
        ) : (
          <span className="text-base font-semibold text-(--tanaw-text)">{name}</span>
        )}
        {row.tag && <span className="rounded-tanaw-sm inline-flex min-h-6 items-center bg-(--tanaw-surface-inset) px-2 text-xs font-semibold text-(--tanaw-text-secondary)">{row.tag}</span>}
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
