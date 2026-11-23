/**
 * The six record statuses shared by the Admin and Staff portals. Report submission uses Submitted,
 * Pending and Missing; staff review uses Waiting, Reviewing and Consolidated. Request progress (Seen by IT,
 * In progress, Resolved, Declined by IT) reuses the pending, reviewing, consolidated and missing tints.
 */
export type RecordStatusTone = "submitted" | "consolidated" | "reviewing" | "pending" | "waiting" | "missing";

/** Text colour for a status when it is shown as plain text or a dot rather than a pill. */
export const recordStatusTextClass: Record<RecordStatusTone, string> = {
  submitted: "text-(--tanaw-st-submitted)",
  consolidated: "text-(--tanaw-st-consolidated)",
  reviewing: "text-(--tanaw-st-reviewing)",
  pending: "text-(--tanaw-st-pending)",
  waiting: "text-(--tanaw-st-waiting)",
  missing: "text-(--tanaw-st-missing)",
};
