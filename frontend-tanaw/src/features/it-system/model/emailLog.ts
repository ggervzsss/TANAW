import type { EmailDelivery } from "@/features/email-deliveries/services/emailDeliveryService";
import { compareDesc } from "./compare";

/*
 * The Email log tab: every email TANAW sent in the last seven days, in plain words. The outbox
 * statuses fold into three results: Delivered, Sending and Not delivered.
 */

/** How many days the Email log covers. */
export const EMAIL_LOG_DAYS = 7;

/** An email as the log reads it, with the recipient's account name and role. */
export type EmailLogEntry = EmailDelivery & {
  accountId?: string | null;
  recipientName?: string | null;
  recipientRole?: string | null;
};

export type EmailResult = "delivered" | "sending" | "failed";
export type EmailLogFilter = "all" | "problems";

export const emailLogFilterOptions: readonly { value: EmailLogFilter; label: string }[] = [
  { value: "all", label: "All emails" },
  { value: "problems", label: "Problems only" },
];

export function parseEmailLogFilter(value: string | null): EmailLogFilter {
  return value === "problems" ? "problems" : "all";
}

const RESULT_BY_STATUS: Record<string, EmailResult> = {
  accepted: "delivered",
  recorded: "delivered",
  queued: "sending",
  processing: "sending",
  retry_scheduled: "sending",
  terminal_failed: "failed",
  cancelled: "failed",
  expired: "failed",
  reconciliation_required: "failed",
};

export const EMAIL_RESULT_LABELS: Record<EmailResult, string> = {
  delivered: "Delivered",
  sending: "Sending",
  failed: "Not delivered",
};

const FAILURE_FALLBACKS: Record<string, string> = {
  terminal_failed: "The mail service could not deliver it.",
  cancelled: "Sending was cancelled.",
  expired: "It expired before it could be sent.",
  reconciliation_required: "The mail service did not confirm it. Check before sending again.",
};

/** The result of an email: Delivered (accepted or recorded), Sending (still in the outbox), or Not delivered. */
export function emailResult(delivery: Pick<EmailDelivery, "status">): EmailResult {
  return RESULT_BY_STATUS[delivery.status] ?? "failed";
}

/** The line under the result: why it failed, or what happens next. */
export function emailResultDetail(delivery: EmailLogEntry) {
  const result = emailResult(delivery);
  if (result === "failed") return delivery.failureReason?.trim() || FAILURE_FALLBACKS[delivery.status] || "It was not delivered.";
  if (delivery.status === "recorded") return "Saved to the local mail log";
  if (delivery.status === "retry_scheduled") return "Trying again shortly";
  if (delivery.status === "processing") return "Sending now";
  if (delivery.status === "queued") return delivery.manualRetryCount > 0 ? "Sending again" : "Waiting to send";
  return "";
}

export function isEmailProblem(delivery: EmailLogEntry) {
  return emailResult(delivery) === "failed" || delivery.canRetry;
}

/** The count on the Email log tab: emails that were not delivered. */
export function failedEmailCount(deliveries: readonly EmailLogEntry[]) {
  return deliveries.filter((delivery) => emailResult(delivery) === "failed").length;
}

const KIND_LABELS: Record<string, string> = {
  account_activation: "Sign-in invitation",
  password_reset: "Password reset code",
  business_email_change: "Email change",
  account_email_change_verification: "Email change code",
  account_email_change_request_notice: "Email change notice",
  account_email_change_approved_old: "Email change approved",
  account_email_change_approved_new: "Email change approved",
  request_reply: "Request reply",
  support_reply: "Request reply",
};

/** A friendly name for the kind of email, such as "Sign-in invitation". */
export function emailKindLabel(purpose: string) {
  const known = KIND_LABELS[purpose];
  if (known) return known;
  const words = purpose.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Email";
}

const ROLE_LABELS: Record<string, string> = {
  Admin: "Admin",
  "IT Personnel": "IT",
  "LGU Staff": "Staff",
  "Enterprise Account": "Enterprise",
};

/** "Grace Bautista, Staff": the account the email went to, when TANAW knows it. */
export function emailRecipientLine(delivery: EmailLogEntry) {
  const name = delivery.recipientName?.trim();
  const role = delivery.recipientRole ? (ROLE_LABELS[delivery.recipientRole] ?? delivery.recipientRole) : "";
  return [name, role].filter(Boolean).join(", ");
}

/** The emails for a filter, newest first. */
export function filterEmailLog(deliveries: readonly EmailLogEntry[], filter: EmailLogFilter) {
  return deliveries.filter((delivery) => filter === "all" || isEmailProblem(delivery)).sort((left, right) => compareDesc(left.createdAt, right.createdAt) || left.id.localeCompare(right.id));
}
