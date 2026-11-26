import type { ApiSchemas } from "@/contracts/api";
import type { EmailDelivery } from "@/features/email-deliveries/services/emailDeliveryService";
import { isEmailProblem } from "@/features/email-deliveries/utils/emailDelivery";
import type { EnterpriseHealth } from "@/shared/services/enterpriseHealth";
import { isClosedRequest, type Request } from "@/shared/services/requests";
import type { AccountProfileChangeRequest, AccountSummary } from "@/shared/types";
import { formatPhilippineDate, formatPhilippineTime, PHILIPPINE_TIME_ZONE, type SystemDateFormat, type SystemTimeFormat } from "@/shared/utils/dateTime";
import { itOverviewPaths } from "./paths";

/*
 * The IT Overview's figures and section rows, worked out from the lists the screen loads. Every
 * function here is pure: the screen passes in the data, the signed-in person and the time.
 */

/** The account fields the API sends that the shared `AccountSummary` type does not list yet. */
export type OverviewAccount = AccountSummary & {
  invitation?: ApiSchemas["AccountInvitation"] | null;
  profileChangeRequests: (AccountProfileChangeRequest & { requestedByName?: string | null })[];
};

/** The email log fields the API sends that the shared `EmailDelivery` type does not list yet. */
export type OverviewEmail = EmailDelivery & { accountId?: string | null; recipientName?: string | null; recipientRole?: string | null };

export type DisplayFormats = { dateFormat: SystemDateFormat; timeFormat: SystemTimeFormat };

export type Viewer = { id: string; displayName: string; firstName?: string | null } | null;

/** How many rows each section shows before pointing to its full screen. */
export const OVERVIEW_SECTION_LIMIT = 5;

// ---------------------------------------------------------------------------------------------
// Time helpers (Philippine time)

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: PHILIPPINE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFormat = new Intl.DateTimeFormat("en-US", { timeZone: PHILIPPINE_TIME_ZONE, hour: "numeric", hourCycle: "h23" });

function toDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole calendar days between two moments in the Philippines: 0 today, 1 yesterday. */
export function philippineDaysBetween(earlier: Date, later: Date) {
  const day = (date: Date) => Date.parse(`${dayKeyFormat.format(date)}T00:00:00Z`);
  return Math.round((day(later) - day(earlier)) / 86_400_000);
}

/** "3:51 PM" today, "Yesterday, 3:51 PM", otherwise the date in the system date format. */
export function formatWhen(value: string | Date | null | undefined, now: Date, formats: DisplayFormats) {
  const date = toDate(value);
  if (!date) return "Date unavailable";
  const days = philippineDaysBetween(date, now);
  if (days <= 0) return formatPhilippineTime(date, formats.timeFormat);
  if (days === 1) return `Yesterday, ${formatPhilippineTime(date, formats.timeFormat)}`;
  return formatPhilippineDate(date, formats.dateFormat);
}

/** A moment inside a sentence: "3:51 PM", "yesterday, 3:51 PM" or "Nov 21, 2026". */
function whenInSentence(value: string | Date | null | undefined, now: Date, formats: DisplayFormats) {
  const text = formatWhen(value, now, formats);
  return text.startsWith("Yesterday") ? `y${text.slice(1)}` : text;
}

/** "today", "yesterday", "3 days ago" or "on Nov 2, 2026" for a past day. */
function daysAgoText(value: string | Date | null | undefined, now: Date, formats: DisplayFormats) {
  const date = toDate(value);
  if (!date) return "some time ago";
  const days = philippineDaysBetween(date, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `on ${formatPhilippineDate(date, formats.dateFormat)}`;
}

function minutesBetween(earlier: Date, later: Date) {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 60_000));
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

// ---------------------------------------------------------------------------------------------
// Header

/** "Good morning, Ana" by the hour in the Philippines and the person's first name. */
export function greeting(now: Date, viewer: Viewer) {
  const hour = Number(hourFormat.format(now)) % 24;
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const name = viewer?.firstName?.trim() || viewer?.displayName.trim().split(/\s+/)[0] || "";
  return name ? `Good ${part}, ${name}` : `Good ${part}`;
}

/** The line beside the greeting: whether the screen is current and when it last refreshed. */
export function statusLine(input: { isLoading: boolean; hasError: boolean; online: boolean; lastUpdatedAt: number; now: Date }) {
  if (input.isLoading && !input.lastUpdatedAt) return "Loading the latest information.";
  const minutes = input.lastUpdatedAt ? minutesBetween(new Date(input.lastUpdatedAt), input.now) : null;
  const last = minutes === null ? "" : minutes < 1 ? " Last update just now." : ` Last update ${plural(minutes, "min", "min")} ago.`;
  if (!input.online) return `You are offline.${last}`;
  if (input.hasError) return `Some information could not be loaded.${last}`;
  return `Connections are live.${last}`;
}

// ---------------------------------------------------------------------------------------------
// Requests waiting for IT

/** An open request nobody in IT has started on yet. */
export function isNotPickedUp(request: Request) {
  return !isClosedRequest(request) && !request.handledBy;
}

function isMine(request: Request, viewer: Viewer) {
  return Boolean(viewer && !isClosedRequest(request) && request.handledBy?.accountId === viewer.id);
}

function newestFirst<T>(time: (item: T) => string | null | undefined) {
  return (left: T, right: T) => (Date.parse(time(right) ?? "") || 0) - (Date.parse(time(left) ?? "") || 0);
}

export type RequestRow = {
  id: string;
  code: string;
  group: Request["group"];
  when: string;
  title: string;
  place: string;
  href: string;
  canStart: boolean;
  state: "waiting" | "started" | "mine";
  stateLabel: string;
};

/** Not picked up yet (newest first), then the open requests the viewer is handling. */
export function requestRows(requests: readonly Request[], viewer: Viewer, startedIds: ReadonlySet<string>, now: Date, formats: DisplayFormats): RequestRow[] {
  const waiting = requests.filter(isNotPickedUp).sort(newestFirst((request) => request.createdAt));
  const mine = requests.filter((request) => isMine(request, viewer)).sort(newestFirst((request) => request.handledAt ?? request.updatedAt));
  return [...waiting, ...mine].map((request) => {
    const canStart = isNotPickedUp(request);
    const state = canStart ? "waiting" : startedIds.has(request.id) ? "started" : "mine";
    return {
      id: request.id,
      code: request.code,
      group: request.group,
      when: formatWhen(request.createdAt, now, formats),
      title: request.title,
      place: request.enterpriseName || request.requesterName,
      href: itOverviewPaths.request(request.id),
      canStart,
      state,
      stateLabel: state === "waiting" ? "Not picked up yet" : state === "started" ? "You started on it just now" : "In progress, yours",
    };
  });
}

export function requestsFigure(requests: readonly Request[], viewer: Viewer) {
  const open = requests.filter((request) => !isClosedRequest(request));
  const value = open.filter(isNotPickedUp).length;
  const mine = open.filter((request) => isMine(request, viewer)).length;
  const note = open.length === 0 ? "No open requests" : `${plural(open.length, "open request")} in total, ${mine.toLocaleString("en-US")} with you`;
  return { value, note };
}

/** The list after IT starts on a request: the viewer is its owner from now. */
export function markRequestStarted(requests: readonly Request[] | undefined, requestId: string, viewer: { id: string; displayName: string }, at: string) {
  if (!requests) return requests;
  return requests.map((request) => (request.id === requestId ? { ...request, handledBy: { accountId: viewer.id, name: viewer.displayName }, handledAt: at } : request));
}

// ---------------------------------------------------------------------------------------------
// Connection problems

/** An active place that is open now (or whose hours are unknown); closed places are never a problem. */
function isWatched(place: EnterpriseHealth) {
  return place.accountState === "active" && place.openNow !== false;
}

function camerasNotCounting(place: EnterpriseHealth) {
  const list = place.cameras.list;
  if (list && list.length > 0) return list.filter((camera) => camera.status === "not_counting" || camera.status === "stopped");
  return null;
}

function notCountingCount(place: EnterpriseHealth) {
  return camerasNotCounting(place)?.length ?? Math.max(0, place.cameras.total - place.cameras.counting);
}

export function placesFigure(health: readonly EnterpriseHealth[]) {
  const watched = health.filter(isWatched);
  const offline = watched.filter((place) => place.app.status === "offline").length;
  const delayed = watched.filter((place) => place.app.status === "delayed").length;
  const value = offline + delayed;
  let note = "Every open place is sending data";
  if (offline && delayed) note = `${plural(offline, "desktop app")} offline, ${delayed.toLocaleString("en-US")} delayed`;
  else if (offline) note = `${plural(offline, "desktop app")} offline`;
  else if (delayed) note = `${plural(delayed, "desktop app")} delayed`;
  return { value, note };
}

export function camerasFigure(health: readonly EnterpriseHealth[]) {
  const watched = health.filter(isWatched);
  const value = watched.reduce((sum, place) => sum + notCountingCount(place), 0);
  const total = watched.reduce((sum, place) => sum + place.cameras.total, 0);
  const places = watched.filter((place) => place.cameras.total > 0).length;
  let note = `Of ${plural(total, "camera")} at ${plural(places, "place")}`;
  if (total === 0) note = "No cameras at open places right now";
  else if (value === 0) note = `All ${plural(total, "camera")} at open places are counting`;
  return { value, note };
}

export type ConnectionRow = {
  enterpriseId: string;
  place: string;
  kind: "offline" | "delayed" | "camera";
  label: string;
  detail: string;
  requestCode: string | null;
  href: string;
};

const connectionOrder: Record<ConnectionRow["kind"], number> = { offline: 0, delayed: 1, camera: 2 };

function stoppedWithApp(total: number) {
  if (total === 0) return "";
  if (total === 1) return " Its camera stopped counting with it.";
  if (total === 2) return " Both cameras stopped counting with it.";
  return ` All ${total.toLocaleString("en-US")} cameras stopped counting with it.`;
}

function sentence(text: string) {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function cameraDetail(place: EnterpriseHealth, now: Date, formats: DisplayFormats) {
  const cameras = camerasNotCounting(place);
  if (!cameras || cameras.length === 0) return "Some cameras are not sending counts.";
  if (cameras.length > 1) return sentence(cameras.map((camera) => camera.name).join(", "));
  const [camera] = cameras;
  const note = camera.note?.trim() ? sentence(camera.note) : camera.since ? `Not counting since ${whenInSentence(camera.since, now, formats)}.` : "Not counting right now.";
  return `${sentence(camera.name)} ${note}`;
}

/** Open requests about the desktop app or a camera, newest first, by enterprise. */
function openCameraRequests(requests: readonly Request[]) {
  const byPlace = new Map<string, string>();
  const relevant = requests.filter((request) => !isClosedRequest(request) && request.group === "Desktop app or camera problem" && request.enterpriseId);
  for (const request of [...relevant].sort(newestFirst((item) => item.createdAt))) {
    if (request.enterpriseId && !byPlace.has(request.enterpriseId)) byPlace.set(request.enterpriseId, request.code);
  }
  return byPlace;
}

/** Offline apps first, then delayed ones, then places with cameras not counting. */
export function connectionRows(health: readonly EnterpriseHealth[], requests: readonly Request[], now: Date, formats: DisplayFormats): ConnectionRow[] {
  const cameraRequests = openCameraRequests(requests);
  const rows: ConnectionRow[] = [];
  for (const place of health.filter(isWatched)) {
    const base = {
      enterpriseId: place.enterpriseId,
      place: place.name,
      requestCode: cameraRequests.get(place.enterpriseId) ?? cameraRequests.get(place.accountId) ?? null,
      href: itOverviewPaths.enterprise(place.enterpriseId),
    };
    const lastDataAt = toDate(place.app.lastDataAt);
    if (place.app.status === "offline") {
      const since = lastDataAt ? `No data since ${whenInSentence(lastDataAt, now, formats)}.` : "No data yet.";
      rows.push({ ...base, kind: "offline", label: "Desktop app offline", detail: `${since}${stoppedWithApp(place.cameras.total)}` });
    } else if (place.app.status === "delayed") {
      const minutes = lastDataAt ? minutesBetween(lastDataAt, now) : null;
      const last = minutes === null ? "Data is arriving late." : `Last data ${plural(Math.max(1, minutes), "min", "min")} ago.`;
      rows.push({ ...base, kind: "delayed", label: "Delayed", detail: `${last} Counts usually arrive every minute.` });
    } else if (place.app.status === "online") {
      const count = notCountingCount(place);
      if (count > 0) rows.push({ ...base, kind: "camera", label: `${plural(count, "camera")} not counting`, detail: cameraDetail(place, now, formats) });
    }
  }
  return rows.sort((left, right) => connectionOrder[left.kind] - connectionOrder[right.kind] || left.place.localeCompare(right.place));
}

// ---------------------------------------------------------------------------------------------
// Accounts waiting

export type AccountRow =
  | { id: string; accountId: string; source: "lgu" | "enterprise"; kind: string; name: string; detail: string; action: { type: "resend"; label: "Send again" | "Send a new link" } }
  | { id: string; accountId: string; source: "lgu"; kind: string; name: string; detail: string; action: { type: "review"; label: "Review"; href: string } };

const lguRoleLabels: Record<string, string> = { admin: "Admin", it: "IT", staff: "Staff" };

function lguRoleLabel(account: AccountSummary) {
  return lguRoleLabels[account.role] ?? account.title;
}

function isWaitingForActivation(account: OverviewAccount) {
  return !account.isActivated && account.status === "active";
}

function invitationRow(account: OverviewAccount, source: "lgu" | "enterprise", now: Date, formats: DisplayFormats): AccountRow {
  const invitation = account.invitation ?? null;
  const expired = !invitation || invitation.expired;
  const enterprise = source === "enterprise";
  const name = enterprise ? account.enterpriseName || account.displayName : account.displayName;
  const kind = enterprise ? "Enterprise invitation" : `${lguRoleLabel(account)} invitation`;
  let detail: string;
  if (!invitation) {
    detail = "Not activated yet, and no invitation link is waiting.";
  } else if (expired) {
    const expiresAt = toDate(invitation.expiresAt);
    detail = expiresAt && expiresAt <= now ? `The invitation link expired ${daysAgoText(expiresAt, now, formats)}.` : "The invitation link no longer works.";
  } else if (enterprise) {
    detail = `Invited ${daysAgoText(invitation.sentAt, now, formats)}. The owner has not set a password yet.`;
  } else {
    detail = `Invited as ${lguRoleLabel(account)} on ${formatPhilippineDate(invitation.sentAt, formats.dateFormat)}. Not activated yet.`;
  }
  return { id: `invite-${account.id}`, accountId: account.id, source, kind, name, detail, action: { type: "resend", label: expired ? "Send a new link" : "Send again" } };
}

/** LGU email changes the new address has verified, waiting for an IT approval. */
function emailChangeRows(accounts: readonly OverviewAccount[]): AccountRow[] {
  return accounts.flatMap((account) =>
    account.profileChangeRequests
      .filter((request) => request.type === "businessEmail" && request.isVerified)
      .map((request) => ({
        id: `email-${account.id}`,
        accountId: account.id,
        source: "lgu" as const,
        kind: "Email change",
        name: `${account.displayName}, ${lguRoleLabel(account)}`,
        detail: request.canApprove ? `Verified ${request.requestedValue}. Waiting for your approval.` : "Verified a new email. Another IT account has to approve it.",
        action: { type: "review" as const, label: "Review" as const, href: itOverviewPaths.personnel },
      })),
  );
}

/** Invitations not accepted (newest invitation first), then email changes waiting for approval. */
export function accountRows(lguAccounts: readonly OverviewAccount[], enterpriseAccounts: readonly OverviewAccount[], now: Date, formats: DisplayFormats): AccountRow[] {
  const invited = [
    ...enterpriseAccounts.filter(isWaitingForActivation).map((account) => ({ account, source: "enterprise" as const })),
    ...lguAccounts.filter(isWaitingForActivation).map((account) => ({ account, source: "lgu" as const })),
  ].sort(newestFirst(({ account }) => account.invitation?.sentAt ?? account.createdAt));
  return [...invited.map(({ account, source }) => invitationRow(account, source, now, formats)), ...emailChangeRows(lguAccounts)];
}

export function accountsFigure(rows: readonly AccountRow[]) {
  const invitations = rows.filter((row) => row.action.type === "resend").length;
  const emailChanges = rows.length - invitations;
  const invitationText = invitations === 1 ? "An invitation" : `${invitations.toLocaleString("en-US")} invitations`;
  const changeText = emailChanges === 1 ? "an email change" : `${emailChanges.toLocaleString("en-US")} email changes`;
  let note = "No invitations or email changes waiting";
  if (invitations && emailChanges) note = `${invitationText} not accepted and ${changeText} to approve`;
  else if (invitations) note = `${invitationText} not accepted yet`;
  else if (emailChanges) note = `${changeText.charAt(0).toUpperCase()}${changeText.slice(1)} to approve`;
  return { value: rows.length, note };
}

// ---------------------------------------------------------------------------------------------
// Emails that did not arrive

const invitationKinds: Record<string, string> = {
  Admin: "Admin invitation",
  "IT Personnel": "IT invitation",
  "LGU Staff": "Staff invitation",
  "Enterprise Account": "Enterprise invitation",
};

const emailKinds: Record<string, string> = {
  password_reset: "Password reset",
  business_email_change: "Email change code",
  account_email_change_verification: "Email change code",
  account_email_change_request_notice: "Email change notice",
  account_email_change_approved_old: "Email change confirmed",
  account_email_change_approved_new: "Email change confirmed",
  support_reply: "Request reply",
  request_reply: "Request reply",
};

/** A friendly name for the kind of email: "Enterprise invitation", "Password reset". */
export function emailKind(delivery: OverviewEmail) {
  if (delivery.purpose === "account_activation") return invitationKinds[delivery.recipientRole ?? ""] ?? "Invitation";
  const known = emailKinds[delivery.purpose];
  if (known) return known;
  const words = delivery.purpose.replace(/[_-]+/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Email";
}

function emailReason(delivery: OverviewEmail, now: Date, formats: DisplayFormats) {
  if (delivery.status === "terminal_failed") return delivery.failureReason?.trim() ? `Not delivered: ${sentence(delivery.failureReason)}` : "Not delivered.";
  if (delivery.status === "reconciliation_required") return "The mail service did not confirm that it was sent.";
  if (delivery.status === "retry_scheduled")
    return delivery.nextAttemptAt ? `Not sent yet. TANAW will try again at ${whenInSentence(delivery.nextAttemptAt, now, formats)}.` : "Not sent yet. TANAW will try again.";
  return "Not delivered.";
}

export type EmailRow = {
  id: string;
  kind: string;
  when: string;
  to: string;
  recipient: string | null;
  reason: string;
  tone: "problem" | "retried";
  canRetry: boolean;
};

/**
 * Problem emails, newest first. An email IT just sent again stays in the list with a note until the
 * screen is left, even though the mail server now has it.
 */
export function emailRows(deliveries: readonly OverviewEmail[], retriedIds: ReadonlySet<string>, now: Date, formats: DisplayFormats): EmailRow[] {
  return deliveries
    .filter((delivery) => isEmailProblem(delivery) || retriedIds.has(delivery.id))
    .sort(newestFirst((delivery) => delivery.createdAt))
    .map((delivery) => {
      const retried = retriedIds.has(delivery.id);
      const delivered = delivery.status === "accepted" || delivery.status === "recorded";
      const name = delivery.recipientName?.trim() || null;
      return {
        id: delivery.id,
        kind: emailKind(delivery),
        when: formatWhen(delivery.createdAt, now, formats),
        to: name ?? delivery.recipient,
        recipient: name ? delivery.recipient : null,
        reason: retried ? (delivered ? "Sent again. The mail server accepted it." : "Sent again just now. Waiting for the mail server.") : emailReason(delivery, now, formats),
        tone: retried ? "retried" : "problem",
        canRetry: !retried && delivery.canRetry,
      };
    });
}

/** The first rows of a section and how many more the full screen has. */
export function firstRows<T>(rows: readonly T[], limit = OVERVIEW_SECTION_LIMIT) {
  return { shown: rows.slice(0, limit), hidden: Math.max(0, rows.length - limit) };
}
