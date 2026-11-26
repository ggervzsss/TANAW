import { describe, expect, it } from "vitest";
import type { BackendNotification } from "@/shared/services/operationalSync";
import { isStaffReportSubmissionNotification } from "../../../../src/shared/utils/notificationRules";

function notification(overrides: Partial<BackendNotification> = {}): BackendNotification {
  return {
    id: "notification-id",
    recipientAccountId: "staff-account",
    title: "Enterprise Report Submitted",
    message: "Test Enterprise submitted RPT-001 for July 2026.",
    type: "Enterprise Report Submitted",
    severity: "Info",
    sourceType: "enterprise.report",
    sourceId: "report-id",
    createdBy: "Test Enterprise",
    recipientRole: "staff",
    recipientEnterpriseId: null,
    createdAt: "2026-07-19T10:00:00Z",
    readAt: null,
    ...overrides,
  };
}

describe("isStaffReportSubmissionNotification", () => {
  it("keeps actionable report submission notifications", () => {
    expect(isStaffReportSubmissionNotification(notification())).toBe(true);
  });

  it.each([
    notification({ type: "Enterprise Support Ticket", sourceType: "support.ticket" }),
    notification({ type: "Report Ready to Consolidate" }),
    notification({ type: "Enterprise Report Submitted", sourceType: "Batch Reports" }),
  ])("rejects non-submission Staff notifications", (candidate) => {
    expect(isStaffReportSubmissionNotification(candidate)).toBe(false);
  });
});
