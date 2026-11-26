import type { ApiSchemas } from "@/contracts/api";
import type { EnterpriseHealth } from "@/shared/services/enterpriseHealth";
import type { AccountSummary } from "@/shared/types";
import { formatPhilippineDate, formatPhilippineTime, type SystemDateFormat, type SystemTimeFormat } from "@/shared/utils/dateTime";

/*
 * The IT Enterprises list: each enterprise account joined with its desktop app health, the "Show"
 * chips, the three figures and the text of each table cell. Pure functions, so they are unit-tested.
 */

/** The account fields the backend sends that the shared AccountSummary type does not list yet. */
export type EnterpriseAccount = AccountSummary & Pick<ApiSchemas["AccountSummary"], "invitation" | "deactivatedAt" | "deactivatedByName">;

export type AccountState = EnterpriseHealth["accountState"];
export type AppStatus = EnterpriseHealth["app"]["status"];
export type Tone = "ok" | "warn" | "danger" | "muted" | "ink";

/** A table cell: the bold state line and the smaller line under it. */
export type CellText = { label: string; tone: Tone; sub: string };

export type EnterpriseRow = {
  /** The account ID. */
  id: string;
  /** The enterprise ID used in links, or the account ID while it has none. */
  enterpriseId: string;
  name: string;
  category: string;
  barangay: string | null;
  email: string;
  accountState: AccountState;
  account: EnterpriseAccount;
  health: EnterpriseHealth | null;
};

export type ChipKey = "all" | "attention" | "pending" | "sending";

export const CHIPS: readonly { key: ChipKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "pending", label: "Invitation pending" },
  { key: "sending", label: "Sending data" },
];

export function parseChip(value: string | null): ChipKey {
  return CHIPS.find((chip) => chip.key === value)?.key ?? "all";
}

/** Deactivated, active, or waiting on an invitation that is still open or has expired. */
export function accountStateOf(account: EnterpriseAccount, health?: EnterpriseHealth | null): AccountState {
  if (account.status === "inactive") return "deactivated";
  if (account.isActivated) return "active";
  if (account.invitation) return account.invitation.expired ? "expired" : "invited";
  if (health && health.accountState !== "active") return health.accountState;
  return "expired";
}

export function enterpriseName(account: AccountSummary) {
  return account.enterpriseName ?? account.displayName;
}

/** Each account with its health (joined by account ID), A to Z by name. */
export function joinEnterprises(accounts: readonly EnterpriseAccount[], health: readonly EnterpriseHealth[]): EnterpriseRow[] {
  const healthByAccount = new Map(health.map((item) => [item.accountId, item]));
  return accounts
    .map((account) => {
      const item = healthByAccount.get(account.id) ?? null;
      return {
        id: account.id,
        enterpriseId: account.enterpriseId ?? item?.enterpriseId ?? account.id,
        name: enterpriseName(account),
        category: account.attraction?.category ?? account.category ?? item?.category ?? "Enterprise",
        barangay: account.barangay ?? item?.barangay ?? null,
        email: account.email,
        accountState: accountStateOf(account, item),
        account,
        health: item,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
}

/** "Park or open area · Brgy. San Antonio". */
export function placeLine(row: Pick<EnterpriseRow, "category" | "barangay">) {
  return row.barangay ? `${row.category} · Brgy. ${row.barangay}` : row.category;
}

/** Closed now by its opening hours or a closed day; no counts are expected then. */
export function isClosedNow(row: EnterpriseRow) {
  return row.health?.openNow === false;
}

/** An active, open place whose desktop app is late or silent, or with a camera not counting. */
export function needsAttention(row: EnterpriseRow) {
  if (row.accountState !== "active" || !row.health || isClosedNow(row)) return false;
  const { app, cameras } = row.health;
  return app.status === "delayed" || app.status === "offline" || (app.status !== "not_set_up" && cameras.counting < cameras.total);
}

export function isInvitationPending(row: EnterpriseRow) {
  return row.accountState === "invited" || row.accountState === "expired";
}

export function isSendingData(row: EnterpriseRow) {
  return row.accountState === "active" && row.health?.app.status === "online" && !needsAttention(row);
}

const chipTests: Record<ChipKey, (row: EnterpriseRow) => boolean> = {
  all: () => true,
  attention: needsAttention,
  pending: isInvitationPending,
  sending: isSendingData,
};

export function chipCounts(rows: readonly EnterpriseRow[]): Record<ChipKey, number> {
  return {
    all: rows.length,
    attention: rows.filter(needsAttention).length,
    pending: rows.filter(isInvitationPending).length,
    sending: rows.filter(isSendingData).length,
  };
}

/** Matches the enterprise name, barangay or owner email. */
export function matchesSearch(row: EnterpriseRow, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${row.name} ${row.barangay ?? ""} ${row.email}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function filterRows(rows: readonly EnterpriseRow[], chip: ChipKey, query: string) {
  return rows.filter((row) => chipTests[chip](row) && matchesSearch(row, query));
}

export type EnterpriseFigures = {
  total: number;
  active: number;
  waiting: number;
  deactivated: number;
  appsTotal: number;
  appsSending: number;
  delayed: number;
  offline: number;
  notSetUp: number;
  camerasTotal: number;
  camerasCounting: number;
  placesNotCounting: number;
  attention: number;
};

/** The three figures. Apps and cameras count active accounts only; cameras skip places closed now. */
export function summarizeEnterprises(rows: readonly EnterpriseRow[]): EnterpriseFigures {
  const active = rows.filter((row) => row.accountState === "active");
  const appStatus = (status: AppStatus) => active.filter((row) => (row.health?.app.status ?? "not_set_up") === status).length;
  const open = active.filter((row) => row.health && !isClosedNow(row) && row.health.app.status !== "not_set_up");
  return {
    total: rows.length,
    active: active.length,
    waiting: rows.filter(isInvitationPending).length,
    deactivated: rows.filter((row) => row.accountState === "deactivated").length,
    appsTotal: active.length,
    appsSending: appStatus("online"),
    delayed: appStatus("delayed"),
    offline: appStatus("offline"),
    notSetUp: appStatus("not_set_up"),
    camerasTotal: open.reduce((sum, row) => sum + (row.health?.cameras.total ?? 0), 0),
    camerasCounting: open.reduce((sum, row) => sum + (row.health?.cameras.counting ?? 0), 0),
    placesNotCounting: open.filter((row) => (row.health?.cameras.counting ?? 0) < (row.health?.cameras.total ?? 0)).length,
    attention: rows.filter(needsAttention).length,
  };
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

export function registeredNote(figures: EnterpriseFigures) {
  if (figures.total === 0) return "No enterprises registered yet";
  const parts = [`${figures.active.toLocaleString("en-US")} active`];
  if (figures.waiting > 0) parts.push(`${figures.waiting.toLocaleString("en-US")} waiting for the owner to sign in`);
  if (figures.deactivated > 0) parts.push(`${figures.deactivated.toLocaleString("en-US")} deactivated`);
  return parts.join(", ");
}

export function appsNote(figures: EnterpriseFigures) {
  if (figures.appsTotal === 0) return "No active enterprises yet";
  const parts: string[] = [];
  if (figures.delayed > 0) parts.push(`${figures.delayed.toLocaleString("en-US")} delayed`);
  if (figures.offline > 0) parts.push(`${figures.offline.toLocaleString("en-US")} offline`);
  if (figures.notSetUp > 0) parts.push(`${figures.notSetUp.toLocaleString("en-US")} not set up yet`);
  return parts.length > 0 ? parts.join(", ") : "All sending data";
}

export function camerasNote(figures: EnterpriseFigures) {
  if (figures.camerasTotal === 0) return "No cameras at open places";
  const notCounting = figures.camerasTotal - figures.camerasCounting;
  if (notCounting === 0) return "All counting";
  return `${notCounting.toLocaleString("en-US")} not counting at ${plural(figures.placesNotCounting, "place")}`;
}

// ---- Time words

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** "just now", "4 min ago", "3 hr ago", "2 days ago". */
export function timeAgo(value: string | null | undefined, now: Date) {
  const time = value ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) return "";
  const elapsed = Math.max(0, now.getTime() - time);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < 60 * MINUTE) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / (60 * MINUTE))} hr ago`;
  return plural(Math.floor(elapsed / DAY), "day") + " ago";
}

function manilaDayNumber(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Manila" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / DAY;
}

/** Calendar days between two moments in Manila: 0 today, 1 yesterday, -1 tomorrow. */
export function daysBetween(value: string, now: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return manilaDayNumber(now) - manilaDayNumber(date);
}

/** "today", "yesterday", "3 days ago" (within a week), else "on Nov 3, 2026". */
export function dayWords(value: string, now: Date, dateFormat: SystemDateFormat) {
  const days = daysBetween(value, now);
  if (days === null) return "";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (days > 1 && days < 7) return `${days} days ago`;
  return `on ${formatPhilippineDate(value, dateFormat)}`;
}

/** "3:51 PM" today, else "Nov 3, 2026". */
export function shortMoment(value: string, now: Date, dateFormat: SystemDateFormat, timeFormat: SystemTimeFormat) {
  return daysBetween(value, now) === 0 ? formatPhilippineTime(value, timeFormat) : formatPhilippineDate(value, dateFormat);
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

// ---- Table cells

export type DisplayFormats = { now: Date; dateFormat: SystemDateFormat; timeFormat: SystemTimeFormat };

/** Account: Active + email, Invitation sent + when, Invitation expired, Deactivated. */
export function accountCell(row: EnterpriseRow, { now, dateFormat }: DisplayFormats): CellText {
  const { account } = row;
  switch (row.accountState) {
    case "active":
      return { label: "Active", tone: "ok", sub: row.email };
    case "invited":
      return {
        label: "Invitation sent",
        tone: "ink",
        sub: account.invitation ? `${capitalize(dayWords(account.invitation.sentAt, now, dateFormat))}, not accepted yet` : `To ${row.email}`,
      };
    case "expired": {
      const expiresAt = account.invitation?.expiresAt;
      const expiredWhen = expiresAt && Date.parse(expiresAt) <= now.getTime() ? `The link expired ${dayWords(expiresAt, now, dateFormat)}` : "The link no longer works";
      return { label: "Invitation expired", tone: "warn", sub: expiredWhen };
    }
    case "deactivated":
      return {
        label: "Deactivated",
        tone: "muted",
        sub: account.deactivatedAt ? `${capitalize(dayWords(account.deactivatedAt, now, dateFormat))}${account.deactivatedByName ? ` by ${account.deactivatedByName}` : ""}` : "Cannot sign in",
      };
  }
}

export const RESEND_LABEL: Partial<Record<AccountState, string>> = { invited: "Send again", expired: "Send a new link" };

export function resendLabel(row: Pick<EnterpriseRow, "accountState">) {
  return RESEND_LABEL[row.accountState] ?? null;
}

export const APP_STATUS_TEXT: Record<AppStatus, { label: string; tone: Tone }> = {
  online: { label: "Online", tone: "ok" },
  delayed: { label: "Delayed", tone: "warn" },
  offline: { label: "Offline", tone: "danger" },
  not_set_up: { label: "Not set up yet", tone: "muted" },
};

/** Desktop app: Online, Delayed, Offline, Not set up yet or Closed, and when the last data came. */
export function appCell(row: EnterpriseRow, formats: DisplayFormats): CellText {
  const { now, dateFormat, timeFormat } = formats;
  const app = row.health?.app;
  const status = app?.status ?? "not_set_up";
  const lastDataAt = app?.lastDataAt ?? null;
  if (row.accountState === "invited" || row.accountState === "expired") return { label: "Not set up yet", tone: "muted", sub: "Waiting for the owner to sign in" };
  if (row.accountState === "deactivated") {
    return { label: "Signed out", tone: "muted", sub: lastDataAt ? `Last data ${shortMoment(lastDataAt, now, dateFormat, timeFormat)}` : "The account is deactivated" };
  }
  if (status === "not_set_up") return { label: "Not set up yet", tone: "muted", sub: "No data received yet" };
  if (isClosedNow(row)) return { label: "Closed", tone: "muted", sub: row.health?.closedReason || "Closed now" };
  if (status === "offline") return { label: "Offline", tone: "danger", sub: lastDataAt ? `No data since ${shortMoment(lastDataAt, now, dateFormat, timeFormat)}` : "No data received" };
  return { ...APP_STATUS_TEXT[status], sub: lastDataAt ? `Last data ${timeAgo(lastDataAt, now)}` : "" };
}

/** Cameras: "3 of 4 counting" and the first camera's problem. */
export function cameraCell(row: EnterpriseRow): CellText {
  const cameras = row.health?.cameras;
  if (!cameras || cameras.total === 0) {
    return { label: "No cameras yet", tone: "muted", sub: row.accountState === "active" ? "Added in the desktop app" : "" };
  }
  const label = `${cameras.counting.toLocaleString("en-US")} of ${cameras.total.toLocaleString("en-US")} counting`;
  if (row.accountState !== "active") return { label, tone: "muted", sub: "" };
  if (isClosedNow(row)) return { label, tone: "muted", sub: "Not expected while closed" };
  if (row.health?.app.status === "offline") return { label, tone: "warn", sub: "Stopped with the desktop app" };
  if (cameras.counting >= cameras.total) return { label, tone: "ink", sub: "" };
  const problem = (cameras.list ?? []).find((camera) => camera.status !== "counting");
  const note = problem ? (problem.note ?? `${problem.name} is not counting`) : "";
  return { label, tone: "warn", sub: note };
}

// ---- Manage an enterprise: header status line

/** One plain line under the enterprise name: what needs doing first. */
export function statusLine(row: EnterpriseRow): { text: string; tone: Tone } {
  if (row.accountState === "deactivated") return { text: "Deactivated. The desktop app cannot sign in.", tone: "muted" };
  if (row.accountState !== "active") return { text: "Waiting for the owner to sign in", tone: "muted" };
  const health = row.health;
  if (!health || health.app.status === "not_set_up") return { text: "Desktop app not set up yet", tone: "muted" };
  if (isClosedNow(row)) return { text: health.closedReason ? `Closed now: ${health.closedReason}` : "Closed now", tone: "muted" };
  if (health.app.status === "offline") return { text: "Desktop app offline", tone: "danger" };
  const { counting, total } = health.cameras;
  if (total === 0) return { text: health.app.status === "delayed" ? "Desktop app delayed" : "No cameras set up yet", tone: health.app.status === "delayed" ? "warn" : "muted" };
  if (counting < total) return { text: `${(total - counting).toLocaleString("en-US")} of ${plural(total, "camera")} not counting`, tone: "warn" };
  if (health.app.status === "delayed") return { text: "Desktop app delayed", tone: "warn" };
  return { text: total === 1 ? "The camera is counting" : `All ${total.toLocaleString("en-US")} cameras counting`, tone: "ok" };
}

/** The Access line on the sign-in account panel. */
export function accessText(row: EnterpriseRow, formats: DisplayFormats): { text: string; tone: Tone } {
  switch (row.accountState) {
    case "active":
      return { text: "Active, can sign in", tone: "ok" };
    case "invited":
      return { text: "Invitation sent, not accepted yet", tone: "ink" };
    case "expired":
      return { text: "Invitation expired", tone: "warn" };
    case "deactivated":
      return { text: `Deactivated. ${accountCell(row, formats).sub}`, tone: "muted" };
  }
}
