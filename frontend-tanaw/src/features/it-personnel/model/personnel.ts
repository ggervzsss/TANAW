import type { ApiSchemas } from "@/contracts/api";
import type { AccountProfileChangeRequest, AccountSummary } from "@/shared/types";
import { formatPhilippineDate, formatPhilippineDateAndTime, type SystemDateFormat, type SystemTimeFormat } from "@/shared/utils/dateTime";

/** A change request with the requester the API now names (`requestedByName`, `requestedByAccountId`). */
export type PersonnelChangeRequest = AccountProfileChangeRequest & {
  requestedByName?: string | null;
  requestedByAccountId?: string | null;
};

/** An LGU account as `GET /accounts/lgu` returns it, with the invitation and deactivation fields. */
export type PersonnelAccount = Omit<AccountSummary, "profileChangeRequests"> & {
  invitation?: ApiSchemas["AccountInvitation"] | null;
  deactivatedAt?: string | null;
  deactivatedByName?: string | null;
  profileChangeRequests: PersonnelChangeRequest[];
};

export type PersonnelRole = "admin" | "staff" | "it";
export type PersonnelRoleFilter = "all" | PersonnelRole;
export type PersonnelAccess = "active" | "invited" | "deactivated";
export type PersonnelFilters = { query: string; role: PersonnelRoleFilter; showDeactivated: boolean };
export type DateTimeFormats = { dateFormat: SystemDateFormat; timeFormat: SystemTimeFormat };

export const PERSONNEL_ROLES: readonly PersonnelRole[] = ["admin", "staff", "it"];

export const personnelRoleLabel: Record<PersonnelRole, string> = { admin: "Admin", staff: "Staff", it: "IT" };

export const personnelRoleAbout: Record<PersonnelRole, string> = {
  admin: "Sees the dashboard, map, enterprises and report status. Adds notes to requests.",
  staff: "Reviews enterprise reports and makes the monthly and annual reports for DOT.",
  it: "Handles requests, accounts, enterprises and system settings.",
};

export function roleLabelOf(role: string) {
  return personnelRoleLabel[role as PersonnelRole] ?? role;
}

/** Older responses may leave the list out; treat that as no requests. */
export function toPersonnelAccounts(accounts: readonly AccountSummary[]): PersonnelAccount[] {
  return accounts.map((account) => ({ ...account, profileChangeRequests: account.profileChangeRequests ?? [] }) as PersonnelAccount);
}

export function accessOf(account: Pick<PersonnelAccount, "status" | "isActivated">): PersonnelAccess {
  if (account.status === "inactive") return "deactivated";
  return account.isActivated ? "active" : "invited";
}

/** Accounts shown before the role and search filters: deactivated ones only when asked for. */
export function visiblePersonnel<T extends Pick<PersonnelAccount, "status">>(accounts: readonly T[], showDeactivated: boolean) {
  return showDeactivated ? [...accounts] : accounts.filter((account) => account.status !== "inactive");
}

/** The count on each Role chip, over the accounts the deactivated checkbox leaves visible. */
export function personnelRoleCounts(accounts: readonly Pick<PersonnelAccount, "status" | "role">[], showDeactivated: boolean): Record<PersonnelRoleFilter, number> {
  const visible = visiblePersonnel(accounts, showDeactivated);
  return {
    all: visible.length,
    admin: visible.filter((account) => account.role === "admin").length,
    staff: visible.filter((account) => account.role === "staff").length,
    it: visible.filter((account) => account.role === "it").length,
  };
}

/** Accounts matching the deactivated checkbox, the role chip and the search (name or email). */
export function filterPersonnel<T extends Pick<PersonnelAccount, "status" | "role" | "displayName" | "email">>(accounts: readonly T[], filters: PersonnelFilters) {
  const query = filters.query.trim().toLowerCase();
  return visiblePersonnel(accounts, filters.showDeactivated).filter(
    (account) => (filters.role === "all" || account.role === filters.role) && (!query || `${account.displayName} ${account.email}`.toLowerCase().includes(query)),
  );
}

/** Active IT and Admin accounts that can sign in, the ones TANAW must always keep at least one of. */
function activeSignInCount(accounts: readonly Pick<PersonnelAccount, "role" | "status" | "isActivated">[], role: PersonnelRole) {
  return accounts.filter((account) => account.role === role && account.status === "active" && account.isActivated).length;
}

export function isLastActiveOfRole(
  account: Pick<PersonnelAccount, "id" | "role" | "status" | "isActivated">,
  accounts: readonly Pick<PersonnelAccount, "role" | "status" | "isActivated">[],
  role: PersonnelRole,
) {
  return account.role === role && account.status === "active" && account.isActivated && activeSignInCount(accounts, role) <= 1;
}

export type AccessSummary = { access: PersonnelAccess; label: string; detail: string };

/** The Access column: the state and the line under it. */
export function describeAccess(account: PersonnelAccount, formats: DateTimeFormats): AccessSummary {
  const access = accessOf(account);
  if (access === "active") return { access, label: "Active", detail: "Can sign in" };
  if (access === "deactivated") {
    const when = account.deactivatedAt ? ` ${formatPhilippineDate(account.deactivatedAt, formats.dateFormat)}` : "";
    const by = account.deactivatedByName ? ` by ${account.deactivatedByName}` : "";
    return { access, label: "Deactivated", detail: `Turned off${when}${by}` };
  }
  const invitation = account.invitation;
  if (!invitation) return { access, label: "Invitation sent", detail: "Waiting for them to set a password" };
  if (invitation.expired) return { access, label: "Invitation sent", detail: "Invitation expired" };
  return {
    access,
    label: "Invitation sent",
    detail: `Sent ${formatPhilippineDate(invitation.sentAt, formats.dateFormat)}, expires ${formatPhilippineDate(invitation.expiresAt, formats.dateFormat)}`,
  };
}

export function describeLastSignIn(account: Pick<PersonnelAccount, "lastLoginAt">, formats: DateTimeFormats) {
  return account.lastLoginAt ? formatPhilippineDateAndTime(account.lastLoginAt, formats.dateFormat, formats.timeFormat) : "Never";
}

export type PersonnelTag = "You" | "First IT account" | "You · First IT account";

export function personnelTag(account: Pick<PersonnelAccount, "id" | "isProtectedDefault">, viewerId: string | null | undefined): PersonnelTag | null {
  const me = Boolean(viewerId) && account.id === viewerId;
  if (me && account.isProtectedDefault) return "You · First IT account";
  if (me) return "You";
  if (account.isProtectedDefault) return "First IT account";
  return null;
}

export type LockNote = "Protected" | "You" | "Last active IT account" | "Last active Admin account";

export type PersonnelActions = {
  canEdit: boolean;
  /** "Send invitation again", or "Send a new link" once the link expired; null when there is no invitation to send. */
  resendLabel: "Send invitation again" | "Send a new link" | null;
  canDeactivate: boolean;
  canActivate: boolean;
  /** Why Deactivate is missing on an account that can sign in. */
  lockNote: LockNote | null;
};

/**
 * Which row actions an account gets. The rules follow the API: the first IT account cannot be changed
 * or turned off, nobody turns off their own account, TANAW keeps at least one active IT and Admin
 * account, and an invitation that was never accepted cannot be deactivated.
 */
export function personnelActions(account: PersonnelAccount, accounts: readonly PersonnelAccount[], viewerId: string | null | undefined): PersonnelActions {
  const access = accessOf(account);
  const lockNote: LockNote | null =
    access !== "active"
      ? null
      : account.isProtectedDefault
        ? "Protected"
        : viewerId && account.id === viewerId
          ? "You"
          : isLastActiveOfRole(account, accounts, "it")
            ? "Last active IT account"
            : isLastActiveOfRole(account, accounts, "admin")
              ? "Last active Admin account"
              : null;
  return {
    canEdit: !account.isProtectedDefault && access !== "deactivated",
    resendLabel: access === "invited" ? (account.invitation?.expired ? "Send a new link" : "Send invitation again") : null,
    canDeactivate: access === "active" && lockNote === null,
    canActivate: access === "deactivated",
    lockNote,
  };
}

/** Roles the edit dialog can offer for this account; the API refuses the others. */
export function lockedRoleReason(account: PersonnelAccount, accounts: readonly PersonnelAccount[], viewerId: string | null | undefined) {
  if (account.role !== "it") return null;
  if (viewerId && account.id === viewerId) return "You cannot remove your own IT access.";
  if (isLastActiveOfRole(account, accounts, "it")) return "This is the last active IT account, so its role stays IT.";
  return null;
}

export type EmailChangeCallout = {
  accountId: string;
  title: string;
  from: string;
  to: string;
  verified: boolean;
  canApprove: boolean;
  /** The sentence after "From … to …". */
  status: string;
};

const OPEN_REQUEST_STATUSES: ReadonlySet<PersonnelChangeRequest["status"]> = new Set(["pending_verification", "verified", "pending_review"]);

/** One callout per LGU account with an open sign-in email change. */
export function emailChangeCallouts(accounts: readonly PersonnelAccount[]): EmailChangeCallout[] {
  return accounts.flatMap((account) => {
    const request = account.profileChangeRequests.find((item) => item.type === "businessEmail" && OPEN_REQUEST_STATUSES.has(item.status));
    if (!request) return [];
    const requester = request.requestedByName?.trim();
    const askedBySomeoneElse = Boolean(requester) && request.requestedByAccountId !== account.id && requester !== account.displayName;
    const title = askedBySomeoneElse ? `${requester} asked to change ${account.displayName}'s sign-in email` : `${account.displayName} asked to change the sign-in email`;
    const verified = request.isVerified;
    const canApprove = verified && request.canApprove;
    const status = !verified ? "Waiting for the new address to be verified." : canApprove ? "The new address is verified." : "The new address is verified. Another IT account has to approve it.";
    return [{ accountId: account.id, title, from: account.email, to: request.requestedValue, verified, canApprove, status }];
  });
}

export type PersonnelChange = { label: string; from: string; to: string };

type ChangePayload = { firstName: string; lastName: string; email: string; phone?: string; role: string };

/** What an edit changes, for the review step before saving. */
export function personnelChanges(account: PersonnelAccount, payload: ChangePayload): PersonnelChange[] {
  const changes: PersonnelChange[] = [];
  const fullName = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(" ") || "Not set";
  const currentName = fullName(account.firstName, account.lastName);
  const nextName = fullName(payload.firstName, payload.lastName);
  if (currentName !== nextName) changes.push({ label: "Name", from: currentName, to: nextName });
  if (account.email !== payload.email) changes.push({ label: "Work email", from: account.email, to: payload.email });
  if ((account.phone ?? "") !== (payload.phone ?? "")) changes.push({ label: "Phone", from: account.phone || "Not set", to: payload.phone || "Not set" });
  if (account.role !== payload.role) changes.push({ label: "Role", from: roleLabelOf(account.role), to: roleLabelOf(payload.role) });
  return changes;
}

/** How a new work email takes effect: right away for invitations, after verification once they have signed in. */
export function emailChangeEffect(account: Pick<PersonnelAccount, "isActivated">) {
  return account.isActivated ? "verify" : "immediate";
}
